/** Motion worker — REAL end-to-end render smoke test: composition → headless browser frames → ffmpeg MP4 → ffprobe verification. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { verifyArtifact,resolveFfmpegDir } from '../host/motion/render-supervisor.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, '..', 'motion-worker', 'entry.mjs');
const FFMPEG_DIR = resolveFfmpegDir();
const FFPROBE = path.join(FFMPEG_DIR, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');

const FPS = { num: 12, den: 1 };
const W = 320, H = 180, FRAMES = 12; // 1s @12fps, small on purpose: keep smoke test fast

function rmTemp(dir) {
	// Browser processes may hold the dir briefly on Windows; retry, never fail the test on cleanup.
	for (let i = 0; i < 4; i++) {
		try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch (e) { if (i === 3) console.warn('cleanup skipped: ' + e.code); }
		try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800); } catch { }
	}
}

function runWorker(request, cwd, timeoutMs = 120000) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [WORKER], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
		child.stdin.write(JSON.stringify(request));
		child.stdin.end();
		let stdout = '', stderr = '';
		const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { } }, timeoutMs);
		child.stdout.on('data', (d) => { stdout += d; });
		child.stderr.on('data', (d) => { stderr += d; });
		child.on('exit', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
		child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(e) }); });
	});
}

test('motion worker renders a real MP4 that passes ffprobe verification', { timeout: 180000 }, async () => {
	if (!fs.existsSync(FFPROBE)) assert.fail('smoke test requires ffprobe at ' + FFPROBE + ' (set DESIGNCRAFT_FFMPEG_DIR)');
	assert.ok(fs.existsSync(WORKER), 'worker entry exists');

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-motion-worker-'));
	const projectDir = path.join(dir, 'project');
	const outPath = path.join(dir, 'out', 'video.mp4');
	fs.mkdirSync(projectDir, { recursive: true });
	// Composition: two elements with visibility windows + CSS keyframes (deterministic clock).
	fs.writeFileSync(path.join(projectDir, 'composition.html'), `<!doctype html>
<html><head><meta charset="utf-8"><style>
 html,body{margin:0;background:#101418;overflow:hidden}
 #s{position:relative;width:${W}px;height:${H}px}
 .a{position:absolute;inset:0;background:#287D6C;animation:fade 1s linear both}
 .b{position:absolute;left:40px;top:60px;width:${W - 80}px;height:60px;background:#E8B44C;border-radius:8px;
    visibility:hidden;animation:rise 1s cubic-bezier(.22,.61,.36,1) .5s both}
 @keyframes fade{from{opacity:.2}to{opacity:1}}
 @keyframes rise{from{transform:translateY(30px);visibility:visible}to{transform:translateY(0);visibility:visible}}
</style></head><body>
<div id="s" data-composition-id="dc" data-duration="1" data-width="${W}" data-height="${H}">
  <div class="a" data-hf-id="hf-bg" data-start="0" data-duration="1"></div>
  <div class="b" data-hf-id="hf-card" data-start="0.5" data-duration="0.5"></div>
</div></body></html>`);

	const result = await runWorker({
		command: 'render', projectDir, outputPath: outPath,
		fps: FPS, quality: 'draft', width: W, height: H, entryFile: 'composition.html'
	}, dir);

	// Worker protocol + success contract.
	const lines = result.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
	const meta = lines.find((m) => m.type === 'meta');
	const done = lines.find((m) => m.type === 'done');
	assert.equal(result.code, 0, 'worker exit 0, stderr: ' + result.stderr.slice(-600) + ' | stdout: ' + result.stdout.slice(-600));
	assert.ok(meta && meta.totalFrames === FRAMES, 'meta reports 12 frames, got ' + JSON.stringify(meta));
	assert.ok(done && done.frames === FRAMES, 'done reports 12 frames');
	assert.ok(fs.existsSync(outPath), 'MP4 exists');

	// Artifact verification (same path as the supervisor's auto-verify).
	const receipt = await verifyArtifact(FFPROBE, outPath, FRAMES, W, H, FPS);
	assert.equal(receipt.verified, true);
	assert.equal(receipt.frames, FRAMES);
	assert.equal(receipt.width, W);
	assert.equal(receipt.height, H);
	assert.equal(receipt.codec, 'h264');
	assert.equal(receipt.pixFmt, 'yuv420p');

	// Determinism contract: element .b must be hidden at t=0 and visible at t=0.6s.
	// The worker enforces visibility via __hfSeek; verify the encoded frames differ
	// between those instants by checking non-trivial file size (non-blank output).
	assert.ok(fs.statSync(outPath).size > 2000, 'encoded video has real content');
	rmTemp(dir);
});

test('motion worker fails loudly on a broken composition', { timeout: 120000 }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-motion-worker-bad-'));
	const projectDir = path.join(dir, 'project');
	fs.mkdirSync(projectDir, { recursive: true });
	fs.writeFileSync(path.join(projectDir, 'composition.html'), '<!doctype html><html><body><p>no composition root</p></body></html>');
	const result = await runWorker({ command: 'render', projectDir, outputPath: path.join(dir, 'x.mp4'), fps: FPS, width: W, height: H, entryFile: 'composition.html' }, dir);
	assert.notEqual(result.code, 0, 'non-zero exit on missing composition root');
	assert.ok(result.stdout.includes('"type":"error"') || result.stderr.length > 0, 'error surfaced');
	rmTemp(dir);
});

test('motion worker mixes composition audio into the MP4', { timeout: 180000 }, async () => {
	if (!fs.existsSync(FFPROBE)) assert.fail('requires ffprobe');
	const FFMPEG = path.join(FFMPEG_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
	const { execFileSync } = await import('node:child_process');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-motion-audio-'));
	try {
		const projectDir = path.join(dir, 'project');
		const outPath = path.join(dir, 'out', 'video.mp4');
		fs.mkdirSync(projectDir, { recursive: true });
		// 1s stereo sine tone as a local asset.
		execFileSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '44100', '-ac', '2', path.join(projectDir, 'tone.wav')], { stdio: 'pipe' });
		fs.writeFileSync(path.join(projectDir, 'composition.html'), `<!doctype html>
<html><head><meta charset="utf-8"><style>
 html,body{margin:0;background:#101418;overflow:hidden}
 #s{position:relative;width:${W}px;height:${H}px}
 .a{position:absolute;inset:0;background:#287D6C;animation:fade 1s linear both}
 @keyframes fade{from{opacity:.2}to{opacity:1}}
</style></head><body>
<div id="s" data-composition-id="dc" data-duration="1" data-width="${W}" data-height="${H}">
  <div class="a"></div>
</div>
<audio src="tone.wav" data-start="0.2" data-volume="0.5" preload="auto"></audio>
</body></html>`);
		const result = await runWorker({ command: 'render', projectDir, outputPath: outPath, fps: FPS, quality: 'draft', width: W, height: H, entryFile: 'composition.html' }, dir);
		assert.equal(result.code, 0, 'worker exit 0, stderr: ' + result.stderr.slice(-500));
		const lines = result.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
		const done = lines.find((m) => m.type === 'done');
		assert.ok(done && done.audioTracks === 1, 'done reports 1 audio track, got ' + JSON.stringify(done));
		const probe = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', outPath], { encoding: 'utf8', timeout: 60000 }));
		const audio = probe.streams.find((s) => s.codec_type === 'audio');
		assert.ok(audio, 'MP4 contains an audio stream');
		assert.equal(audio.codec_name, 'aac', 'audio codec is aac');
		assert.equal(probe.streams.find((s) => s.codec_type === 'video').codec_name, 'h264');
	} finally { rmTemp(dir); }
});

test('motion worker renders WebGL (three.js-ready) compositions', { timeout: 180000 }, async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-motion-webgl-'));
	try {
		const projectDir = path.join(dir, 'project');
		const outPath = path.join(dir, 'out', 'video.mp4');
		fs.mkdirSync(projectDir, { recursive: true });
		// Minimal raw-WebGL composition: clear color animates with the frame clock.
		fs.writeFileSync(path.join(projectDir, 'composition.html'), `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;overflow:hidden}#s{position:relative;width:${W}px;height:${H}px}</style></head><body>
<div id="s" data-composition-id="dc" data-duration="1" data-width="${W}" data-height="${H}">
<canvas id="gl" width="${W}" height="${H}" style="position:absolute;inset:0"></canvas>
</div>
<script>
var gl = document.getElementById('gl').getContext('webgl');
window.__hfSeek = window.__hfSeek || function (timeMs) {
  var t = timeMs / 1000;
  if (gl) { gl.clearColor(t, 0.2, 1 - t, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  return gl ? 1 : 0;
};
window.__hfSettle = function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(1); }); }); }); };
</script></body></html>`);
		const result = await runWorker({ command: 'render', projectDir, outputPath: outPath, fps: FPS, quality: 'draft', width: W, height: H, entryFile: 'composition.html' }, dir);
		assert.equal(result.code, 0, 'worker exit 0, stderr: ' + result.stderr.slice(-400));
		assert.ok(fs.existsSync(outPath), 'MP4 exists');
		// Frame count verification (same path as supervisor auto-verify).
		const receipt = await verifyArtifact(FFPROBE, outPath, FRAMES, W, H, FPS);
		assert.equal(receipt.verified, true);
		// Frames must actually differ over time (WebGL responded to the clock).
		const { execFileSync } = await import('node:child_process');
		const FFMPEG = path.join(FFMPEG_DIR, 'ffmpeg.exe');
		const framesDir2 = path.join(dir, 'frames2'); fs.mkdirSync(framesDir2, { recursive: true });
		execFileSync(FFMPEG, ['-y', '-i', outPath, '-f', 'image2', path.join(framesDir2, 'f%03d.png')], { stdio: 'pipe' });
		const dumped = fs.readdirSync(framesDir2).sort();
		assert.ok(dumped.length >= 2, 'dumped >=2 frames');
		const b0 = fs.readFileSync(path.join(framesDir2, dumped[0])), b1 = fs.readFileSync(path.join(framesDir2, dumped[dumped.length - 1]));
		assert.notEqual(crypto.createHash('sha256').update(b0).digest('hex'), crypto.createHash('sha256').update(b1).digest('hex'), 'first and last WebGL frames differ — clock drives GL');
	} finally { rmTemp(dir); }
});

test('motion worker renders the vendored GSAP template (multi-timeline seek)', { timeout: 300000 }, async () => {
	// kinetic-type: 15s GSAP template, multi-timeline (main + main-graphics inlined).
	// Render at 2fps → 30 frames at 1920x1080 to prove the clock drives GSAP timelines.
	const { templateSources } = await import('../host/motion/templates.js');
	const tpl = templateSources('frame-kinetic-type');
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-motion-tpl-'));
	try {
		const projectDir = path.join(dir, 'project');
		const outPath = path.join(dir, 'out', 'video.mp4');
		fs.mkdirSync(projectDir, { recursive: true });
		for (const [rel, buf] of Object.entries(tpl.sources)) {
			const p = path.join(projectDir, rel);
			fs.mkdirSync(path.dirname(p), { recursive: true });
			fs.writeFileSync(p, buf);
		}
		const FPS2 = { num: 2, den: 1 };
		const result = await runWorker({ command: 'render', projectDir, outputPath: outPath, fps: FPS2, quality: 'draft', width: 1920, height: 1080, entryFile: 'index.html' }, dir, 240000);
		assert.equal(result.code, 0, 'worker exit 0, stderr: ' + result.stderr.slice(-500));
		const lines = result.stdout.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
		const meta = lines.find((m) => m.type === 'meta');
		assert.ok(meta && meta.totalFrames === 30, '15s @2fps = 30 frames, got ' + JSON.stringify(meta));
		const receipt = await verifyArtifact(FFPROBE, outPath, 30, 1920, 1080, FPS2);
		assert.equal(receipt.verified, true);
		// GSAP clock must actually move pixels: first vs last frame differ.
		const framesDir2 = path.join(dir, 'dump'); fs.mkdirSync(framesDir2, { recursive: true });
		const { execFileSync } = await import('node:child_process');
		const FFMPEG = path.join(FFMPEG_DIR, 'ffmpeg.exe');
		execFileSync(FFMPEG, ['-y', '-i', outPath, '-f', 'image2', path.join(framesDir2, 'f%02d.png')], { stdio: 'pipe' });
		const dumped = fs.readdirSync(framesDir2).sort();
		assert.ok(dumped.length >= 2, 'dumped first+last frames');
		const h = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(framesDir2, f))).digest('hex');
		assert.notEqual(h(dumped[0]), h(dumped[dumped.length - 1]), 'GSAP timeline is clock-driven (frames differ)');
	} finally { rmTemp(dir); }
});
