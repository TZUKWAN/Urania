/**
 * Motion render worker — real frame-accurate HTML composition renderer.
 *
 * Protocol: reads one JSON request from stdin:
 *   { command:'render', projectDir, outputPath, fps:{num,den}, width, height,
 *     entryFile, quality:'draft'|'high' }
 * Emits JSON lines on stdout ({type:'progress'|'done'|'error', ...}); logs to stderr.
 * Exit 0 on success, non-zero on failure.
 *
 * Pipeline: headless Edge/Chrome (CDP) → deterministic frame clock
 * (window.__hfSeek(timeMs): visibility windows + paused animation seek)
 * → Page.captureScreenshot per frame → PNGs → ffmpeg (libx264, yuv420p, faststart).
 *
 * Determinism contract: compositions must be pure functions of the frame clock
 * (no Date.now/rAF timers/unseeded randomness — enforced by the skill); this worker
 * only advances the clock and captures, so the same revision always encodes the
 * same frames.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const log = (...args) => { try { process.stderr.write('[motion-worker] ' + args.join(' ') + '\n'); } catch { } };
const emit = (obj) => { try { process.stdout.write(JSON.stringify(obj) + '\n'); } catch { } };

function readRequest() {
	return new Promise((resolve, reject) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', (c) => { data += c; if (data.length > 1024 * 1024) reject(new Error('request too large')); });
		process.stdin.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid request JSON: ' + e.message)); } });
		process.stdin.on('error', reject);
	});
}

function resolveBrowserPath() {
	const candidates = [
		process.env.DESIGNCRAFT_BROWSER_PATH,
		'C:/Program Files/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
		'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
	].filter(Boolean);
	for (const p of candidates) { try { if (fs.existsSync(p)) return p; } catch { } }
	throw new Error('未找到可用的 Chromium 浏览器（Chrome/Edge），可通过 DESIGNCRAFT_BROWSER_PATH 指定');
}

function resolveFfmpegPath() {
	const dir = process.env.DESIGNCRAFT_FFMPEG_DIR || 'D:/MDHPROJECT/ffmpeg/ffmpeg-9.0.2-essentials_build/bin';
	const exe = path.join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
	if (!fs.existsSync(exe)) throw new Error('未找到 ffmpeg: ' + exe + '（可通过 DESIGNCRAFT_FFMPEG_DIR 指定）');
	return exe;
}

function run(exe, args, { timeoutMs = 10 * 60 * 1000 } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
		let stdout = '', stderr = '';
		const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } reject(new Error(exe + ' 超时')); }, timeoutMs);
		child.stdout.on('data', (d) => { stdout += d; });
		child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 1024 * 1024) stderr = stderr.slice(-512 * 1024); });
		child.on('error', (e) => { clearTimeout(timer); reject(e); });
		child.on('exit', (code) => { clearTimeout(timer); code === 0 ? resolve({ stdout, stderr }) : reject(new Error(exe + ' 退出码 ' + code + ': ' + stderr.slice(-800))); });
	});
}

/** Minimal CDP client over the DevTools WebSocket (Node ≥22 global WebSocket). */
class CdpClient {
	constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map(); }
	static async connect(url, timeoutMs = 20000) {
		const ws = new WebSocket(url);
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('CDP WebSocket 连接超时')), timeoutMs);
			ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
			ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP WebSocket 连接失败')); }, { once: true });
		});
		return new CdpClient(ws);
	}
	attach() {
		this.ws.addEventListener('message', (ev) => {
			let msg; try { msg = JSON.parse(ev.data); } catch { return; }
			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error('CDP ' + msg.error.message + (msg.error.data ? ' | ' + msg.error.data : ''))) : resolve(msg.result);
			} else if (msg.method && this.handlers.has(msg.method)) {
				for (const fn of this.handlers.get(msg.method)) { try { fn(msg.params); } catch { } }
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.id;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params }));
			setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 调用超时: ' + method)); } }, 120000);
		});
	}
	on(method, fn) {
		if (!this.handlers.has(method)) this.handlers.set(method, new Set());
		this.handlers.get(method).add(fn);
	}
	close() { try { this.ws.close(); } catch { } }
}

/** Launch headless Chromium with CDP and return {client, browser}. */
async function launchBrowser({ width, height, userDataDir }) {
	const browserExe = resolveBrowserPath();
	const args = [
		// 不要加 --disable-gpu：它会阻断 headless WebGL（three.js/Canvas3D 合成渲不出来）。
		// --enable-unsafe-swiftshader 允许软件 WebGL 兜底（Chrome 128+）。
		'--headless=new', '--no-first-run', '--no-default-browser-check',
		'--disable-extensions', '--disable-background-timer-throttling',
		'--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
		'--enable-unsafe-swiftshader',
		'--hide-scrollbars', '--mute-audio', '--force-device-scale-factor=1',
		`--remote-debugging-port=0`, `--user-data-dir=${userDataDir}`,
		`--window-size=${width},${height}`, 'about:blank'
	];
	const browser = spawn(browserExe, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
	// DevTools endpoint discovery, two channels: (1) the "DevTools listening on
	// ws://…" stderr line (fast path), (2) polling <user-data-dir>/DevToolsActivePort —
	// Chromium writes it once the server is up, which is the only reliable signal
	// when the Windows launcher process exits silently (observed with Edge).
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = '', settled = false;
		const portFile = path.join(userDataDir, 'DevToolsActivePort');
		const finish = (u) => { if (!settled) { settled = true; clearInterval(poll); clearTimeout(timer); resolve(u); } };
		const timer = setTimeout(() => finish(null), 30000);
		const poll = setInterval(() => {
			try {
				const [port, browserPath] = fs.readFileSync(portFile, 'utf8').split('\n');
				if (port && /^\d+$/.test(port.trim())) finish('ws://127.0.0.1:' + port.trim() + (browserPath || '').trim());
			} catch { }
		}, 250);
		browser.stderr.on('data', (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) finish(m[1]);
		});
		browser.on('exit', (code) => {
			setTimeout(() => { // give the DevToolsActivePort poll a beat after launcher exit
				if (!settled) { settled = true; clearInterval(poll); clearTimeout(timer); reject(new Error('浏览器提前退出，码 ' + code + '，stderr: ' + buf.slice(-300))); }
			}, 1500);
		});
	});
	if (!wsUrl) throw new Error('未能在 30 秒内发现浏览器 DevTools 端口');
	// Wait for the page target, then connect to its ws endpoint directly.
	const port = new URL(wsUrl).port;
	let pageTarget = null;
	for (let i = 0; i < 50; i++) {
		try {
			const list = JSON.parse(await (await fetch('http://127.0.0.1:' + port + '/json/list')).text());
			pageTarget = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
			if (pageTarget) break;
		} catch { }
		await new Promise((r) => setTimeout(r, 200));
	}
	if (!pageTarget) throw new Error('未找到可用的页面调试目标');
	const client = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
	client.attach();
	return { client, browser, browserWsUrl: wsUrl };
}

const FRAME_SEEK_SOURCE = String.raw`
window.__hfSeek = window.__hfSeek || function (timeMs) {
  const root = document.querySelector('[data-composition-id]');
  if (!root) return 0;
  const t = timeMs / 1000;
  for (const el of root.querySelectorAll('[data-start],[data-duration]')) {
    const s = parseFloat(el.dataset.start || '0');
    const d = el.dataset.duration !== undefined ? parseFloat(el.dataset.duration) : NaN;
    const visible = t >= s && (!isFinite(d) || t < s + d);
    el.style.visibility = visible ? 'visible' : 'hidden';
  }
  // GSAP timelines (multi-composition templates): pause + seek every registered one.
  const map = window.__timelines || {};
  for (const id in map) {
    const tl = map[id];
    if (tl && typeof tl.seek === 'function') {
      try { tl.pause(); tl.seek(Math.min(t, tl.duration() || t), false); } catch (e) { }
    }
  }
  const anims = document.getAnimations();
  for (const a of anims) { try { a.pause(); a.currentTime = timeMs; } catch (e) { } }
  return anims.length;
};
window.__hfSettle = function () {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(document.getAnimations().length))));
};
`;

/**
 * Scan the composition's <audio> tags for local files and build ffmpeg mux inputs.
 * <audio src="a.mp3" data-start="0.5" data-duration="3" data-volume="0.8">
 * start/duration are composition-clock seconds; volume clamps to [0,1].
 * Remote/data sources are skipped (offline constraint); missing files warn+skip.
 */
function scanAudioTracks(projectDir, entryFile, log) {
	const htmlPath = path.join(projectDir, entryFile);
	const html = fs.readFileSync(htmlPath, 'utf8');
	const out = [];
	const tags = html.match(/<audio\b[^>]*>/gi) || [];
	for (const tag of tags) {
		const srcM = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
		const file = srcM && (srcM[1] || srcM[2] || srcM[3]);
		if (!file || /^(https?:|data:|blob:|\/\/)/i.test(file)) continue;
		const abs = path.resolve(projectDir, decodeURIComponent(file.split('?')[0].split('#')[0]));
		if (!fs.existsSync(abs)) { log('audio source missing, skipped: ' + file); continue; }
		const attr = (name, dflt) => {
			const m = new RegExp('data-' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
			if (!m) return dflt;
			const v = parseFloat(m[1] || m[2] || m[3]);
			return Number.isFinite(v) ? v : dflt;
		};
		const hasDur = /data-duration\s*=/i.test(tag);
		out.push({
			file: abs,
			start: Math.max(0, attr('start', 0)),
			dur: hasDur ? attr('duration', NaN) : NaN,
			vol: Math.min(1, Math.max(0, attr('volume', 1)))
		});
	}
	return out;
}

/** Build ffmpeg args mixing N audio tracks over the frame sequence. */
function audioMuxArgs(tracks) {
	const inputs = [];
	for (const t of tracks) inputs.push('-i', t.file);
	const chains = tracks.map((t, i) => {
		const parts = [];
		if (Number.isFinite(t.dur)) parts.push(`atrim=0:${t.dur.toFixed(3)},asetpts=PTS-STARTPTS`);
		if (t.vol !== 1) parts.push(`volume=${t.vol}`);
		parts.push(`adelay=${Math.round(t.start * 1000)}:all=1`);
		return `[${i + 1}:a]${parts.join(',')}[a${i}]`;
	});
	// Single track: the chain output is final. Multi track: amix them.
	const filterComplex = tracks.length === 1
		? chains[0]
		: chains.join(';') + ';' + tracks.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${tracks.length}:normalize=0[aout]`;
	return { inputs, filterComplex, outLabel: tracks.length === 1 ? '[a0]' : '[aout]' };
}



async function main() {
	const req = await readRequest();
	if (req.command !== 'render') throw new Error('未知命令: ' + req.command);
	const { projectDir, outputPath, width, height } = req;
	if (!projectDir || !outputPath || !width || !height) throw new Error('缺少 projectDir/outputPath/width/height');
	const fpsNum = req.fps?.num || 30, fpsDen = req.fps?.den || 1;
	const entryFile = req.entryFile || 'index.html';
	const entryPath = path.join(projectDir, entryFile);
	if (!fs.existsSync(entryPath)) throw new Error('合成入口不存在: ' + entryPath);

	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	const framesDir = path.join(path.dirname(outputPath), '.frames-' + path.basename(outputPath, '.mp4'));
	fs.rmSync(framesDir, { recursive: true, force: true });
	fs.mkdirSync(framesDir, { recursive: true });
	const userDataDir = path.join(path.dirname(outputPath), '.browser-' + Date.now());

	const { client, browser, browserWsUrl } = await launchBrowser({ width, height, userDataDir });
	const tempPaths = [framesDir, userDataDir];
	try {
		await client.send('Page.enable');
		await client.send('Runtime.enable');
		await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
		await client.send('Page.navigate', { url: pathToFileURL(entryPath).href });
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('合成加载超时')), 30000);
			client.on('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
		});
		// Expose the frame clock (compositions may ship their own __hfSeek; keep it).
		const inject = await client.send('Runtime.evaluate', { expression: FRAME_SEEK_SOURCE, returnByValue: true });
		if (inject.exceptionDetails) throw new Error('注入帧时钟失败: ' + (inject.exceptionDetails.text || ''));

		// Composition geometry from the DOM (authoritative), validated against request.
		const meta = await client.send('Runtime.evaluate', {
			expression: `(()=>{const r=document.querySelector('[data-composition-id]');return r?{duration:parseFloat(r.dataset.duration||'0'),width:parseInt(r.dataset.width||'0'),height:parseInt(r.dataset.height||'0')}:null})()`,
			returnByValue: true
		});
		if (meta.exceptionDetails || !meta.result?.value) throw new Error('合成缺少 data-composition-id 根元素');
		const { duration } = meta.result.value;
		if (!isFinite(duration) || duration <= 0) throw new Error('合成 data-duration 无效: ' + duration);
		const totalFrames = Math.max(1, Math.round(duration * fpsNum / fpsDen));
		emit({ type: 'meta', totalFrames, durationSeconds: duration });

		// Capture frames.
		const clip = { x: 0, y: 0, width, height, scale: 1 };
		for (let frame = 0; frame < totalFrames; frame++) {
			const timeMs = Math.round(frame * 1000 * fpsDen / fpsNum);
			const seek = await client.send('Runtime.evaluate', { expression: `__hfSeek(${timeMs})`, returnByValue: true });
			if (seek.exceptionDetails) throw new Error('帧 ' + frame + ' 时钟推进失败: ' + (seek.exceptionDetails.exception?.description || seek.exceptionDetails.text));
			await client.send('Runtime.evaluate', { expression: '__hfSettle()', awaitPromise: true, returnByValue: true });
			const shot = await client.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
			fs.writeFileSync(path.join(framesDir, 'f' + String(frame).padStart(6, '0') + '.png'), Buffer.from(shot.data, 'base64'));
			if (frame % 2 === 0 || frame === totalFrames - 1) emit({ type: 'progress', frame: frame + 1, totalFrames });
		}

		// Encode with ffmpeg: exact frame count, h264 yuv420p, faststart for playback.
		// Composition <audio> tracks (local files only) are mixed in via filter_complex:
		// per-track trim/volume/delay → amix → AAC; -shortest keeps the video length.
		const ffmpeg = resolveFfmpegPath();
		const tracks = scanAudioTracks(projectDir, entryFile, log);
		if (tracks.length > 0) log(`mixing ${tracks.length} audio track(s)`);
		const baseArgs = [
			'-y', '-framerate', `${fpsNum}/${fpsDen}`, '-start_number', '0', '-i', path.join(framesDir, 'f%06d.png')
		];
		let encodeArgs;
		if (tracks.length > 0) {
			const mux = audioMuxArgs(tracks);
			encodeArgs = [
				...baseArgs, ...mux.inputs,
				'-filter_complex', mux.filterComplex,
				'-map', '0:v', '-map', mux.outLabel,
				'-frames:v', String(totalFrames), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
				'-pix_fmt', 'yuv420p', '-vf', `scale=${width}:${height}:flags=lanczos`,
				'-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', outputPath
			];
		} else {
			encodeArgs = [
				...baseArgs,
				'-frames:v', String(totalFrames), '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
				'-pix_fmt', 'yuv420p', '-vf', `scale=${width}:${height}:flags=lanczos`, '-movflags', '+faststart', outputPath
			];
		}
		await run(ffmpeg, encodeArgs, { timeoutMs: 15 * 60 * 1000 });
		emit({ type: 'done', frames: totalFrames, width, height, fps: `${fpsNum}/${fpsDen}`, audioTracks: tracks.length, outputPath });
		process.exitCode = 0;
	} finally {
		try { client.close(); } catch { }
		// Shut the whole launched browser down via CDP (dedicated user-data-dir —
		// never touches the user's own browser processes). Browser.close never
		// replies once the browser tears itself down, so race it with a short
		// timer instead of waiting for the response.
		try {
			const bc = await CdpClient.connect(browserWsUrl, 8000);
			bc.attach();
			await Promise.race([
				bc.send('Browser.close').catch(() => { }),
				new Promise((r) => setTimeout(r, 5000))
			]);
			try { bc.close(); } catch { }
		} catch {
			try { browser.kill('SIGTERM'); } catch { }
			setTimeout(() => { try { browser.kill('SIGKILL'); } catch { } }, 2000);
		}
		for (const p of tempPaths) { try { fs.rmSync(p, { recursive: true, force: true }); } catch { } }
	}
}

main().catch((e) => {
	emit({ type: 'error', message: String(e?.message || e) });
	log(String(e?.stack || e));
	process.exit(1);
}).finally(() => {
	// All artifacts are written and temp dirs cleaned above; hard-exit so any
	// lingering browser/CDP socket can't keep the worker alive.
	setTimeout(() => process.exit(process.exitCode || 0), 200);
});
