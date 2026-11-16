/**
 * Motion render supervisor — independent from the old JobSupervisor.
 * Own budget (20min, 8GiB temp), explicit env whitelist, structured IPC,
 * process-tree cleanup on cancel, auto artifact verification on completion.
 * One render per instance. Finished jobs are retained (bounded) so
 * render_status can observe 'completed'/'failed' after the process exits.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const activeJobs = new Map();   // jobId → live record
const finishedJobs = new Map(); // jobId → terminal record (bounded, newest kept)
const FINISHED_LIMIT = 10;

export function getActiveRenderCount() { return activeJobs.size; }

export function resolveFfmpegDir() {
	return process.env.DESIGNCRAFT_FFMPEG_DIR || 'D:/MDHPROJECT/ffmpeg/ffmpeg-9.0.2-essentials_build/bin';
}

/**
 * Spawn a trusted render worker process.
 * @param {string} workerEntry - absolute path to motion-worker/entry.mjs
 * @param {string} projectDir - composition project directory
 * @param {string} outputPath - MP4 output path
 * @param {object} opts - {fps:{num,den}, quality, width, height, entryFile, timeoutMs,
 *                         verify:{durationFrames,width,height,fps}} — verify triggers
 *                         automatic ffprobe validation when the worker exits 0.
 */
export function startRender(workerEntry, projectDir, outputPath, opts = {}) {
	if (activeJobs.size >= 1) throw Object.assign(new Error('同一实例同时只允许一个渲染任务'), { code: 'E_CONCURRENT', status: 409 });
	if (!fs.existsSync(workerEntry)) throw Object.assign(new Error('渲染 worker 入口不存在: ' + workerEntry), { code: 'E_WORKER_MISSING', status: 500 });
	const jobId = crypto.randomUUID();
	const tempDir = path.join(path.dirname(outputPath), '.motion-' + jobId);
	fs.mkdirSync(tempDir, { recursive: true });
	const logPath = path.join(tempDir, 'render.log');
	const timeoutMs = opts.timeoutMs || 20 * 60 * 1000;
	const envWhitelist = {};
	for (const k of ['SYSTEMROOT', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'PATH', 'OS', 'USERPROFILE', 'ELECTRON_RUN_AS_NODE']) {
		if (process.env[k] !== undefined) envWhitelist[k] = process.env[k];
	}
	const request = JSON.stringify({
		command: 'render', projectDir, outputPath,
		fps: opts.fps || { num: 30, den: 1 },
		quality: opts.quality || 'draft',
		width: opts.width || 1280, height: opts.height || 720,
		entryFile: opts.entryFile || 'index.html'
	});
	const child = spawn(process.execPath, [workerEntry], {
		cwd: tempDir, env: envWhitelist,
		stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false
	});
	const record = { jobId, process: child, tempDir, logPath, startedAt: Date.now(), status: 'running', progress: 0, outputPath, logTail: '' };
	activeJobs.set(jobId, record);
	const appendLog = (chunk) => {
		try { fs.appendFileSync(logPath, chunk); } catch { }
		record.logTail = (record.logTail + chunk).slice(-4000);
	};
	child.stdin.on('error', () => { /* worker died before reading stdin; exit handler records failure */ });
	child.stdin.write(request);
	child.stdin.end();
	// Worker protocol: JSON lines on stdout ({type:'progress',frame,totalFrames}), logs on stderr.
	let stdoutBuf = '';
	child.stdout.on('data', (d) => {
		stdoutBuf += d.toString();
		let idx;
		while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
			const line = stdoutBuf.slice(0, idx).trim();
			stdoutBuf = stdoutBuf.slice(idx + 1);
			if (!line) continue;
			appendLog(line + '\n');
			try {
				const msg = JSON.parse(line);
				if (msg.type === 'progress' && msg.totalFrames > 0) record.progress = Math.min(100, Math.round(100 * msg.frame / msg.totalFrames));
				else if (msg.type === 'error') record.workerError = msg.message;
			} catch { }
		}
	});
	child.stderr.on('data', (d) => appendLog(d.toString()));
	const timeout = setTimeout(() => { record.cancelReason = 'timeout'; cancelRender(jobId, 'timeout'); }, timeoutMs);
	child.on('error', (err) => {
		clearTimeout(timeout);
		activeJobs.delete(jobId);
		record.status = 'failed';
		record.error = 'worker 启动失败: ' + err.message;
		finishRecord(record);
	});
	child.on('exit', (code, signal) => {
		clearTimeout(timeout);
		activeJobs.delete(jobId);
		if (record.finished) return; // already finalized (e.g. by cancelRender)
		record.finishedAt = Date.now();
		record.exitCode = code;
		if (record.status !== 'cancelled') {
			record.status = code === 0 ? 'completed' : 'failed';
		}
		if (record.status === 'cancelled') record.error = record.error || ('已取消 (' + (record.cancelReason || 'user') + ')');
		else if (record.status === 'failed') record.error = record.workerError || (record.logTail.match(/Error:[^\n]*/)?.[0]) || ('worker 退出码 ' + code);
		// Automatic artifact validation for successful renders.
		if (record.status === 'completed' && fs.existsSync(outputPath) && opts.verify) {
			try {
				record.receipt = verifyArtifact(path.join(resolveFfmpegDir(), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'),
					outputPath, opts.verify.durationFrames, opts.verify.width, opts.verify.height, opts.verify.fps);
			} catch (e) {
				record.status = 'failed';
				record.error = '产物验证失败: ' + e.message;
			}
		} else if (record.status === 'completed' && !fs.existsSync(outputPath)) {
			record.status = 'failed';
			record.error = 'worker 报告完成但产物不存在';
		}
		finishRecord(record);
	});
	return { jobId, record, child };
}

function finishRecord(record) {
	if (record.finished) return;
	record.finished = true;
	finishedJobs.set(record.jobId, { ...record, process: undefined });
	while (finishedJobs.size > FINISHED_LIMIT) {
		const oldest = finishedJobs.keys().next().value;
		finishedJobs.delete(oldest);
	}
	try { if (record.tempDir) fs.rmSync(record.tempDir, { recursive: true, force: true }); } catch { }
}

export function cancelRender(jobId, reason = 'user-cancel') {
	const record = activeJobs.get(jobId);
	if (!record) return false;
	record.status = 'cancelled';
	record.cancelReason = reason;
	try {
		if (process.platform === 'win32') {
			spawn('taskkill', ['/pid', String(record.process.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
		} else {
			record.process.kill('SIGTERM');
		}
	} catch { }
	// Release the single render slot immediately — a slow-exiting cancelled job
	// must not block the next render (exit handler skips re-finalizing).
	activeJobs.delete(jobId);
	finishRecord(record);
	return true;
}

/** Poll a render job: live first, then terminal records. Null when unknown. */
export function getRenderStatus(jobId) {
	return activeJobs.get(jobId) || finishedJobs.get(jobId) || null;
}

/** Verify an MP4 artifact: ffprobe + decode frame count + hash. Returns receipt or throws. */
export function verifyArtifact(ffprobePath, mp4Path, expectedFrames, expectedWidth, expectedHeight, expectedFps) {
	const probe = JSON.parse(execFileSync(ffprobePath, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', mp4Path], { encoding: 'utf8', timeout: 60000 }));
	const vs = probe.streams.find(s => s.codec_type === 'video');
	if (!vs) throw new Error('无视频流');
	if (vs.codec_name !== 'h264') throw new Error('编码 ' + vs.codec_name + ' ≠ h264');
	if (vs.width !== expectedWidth || vs.height !== expectedHeight) throw new Error('尺寸 ' + vs.width + 'x' + vs.height + ' ≠ ' + expectedWidth + 'x' + expectedHeight);
	if (vs.pix_fmt !== 'yuv420p') throw new Error('像素格式 ' + vs.pix_fmt + ' ≠ yuv420p');
	const nb = execFileSync(ffprobePath, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', mp4Path], { encoding: 'utf8', timeout: 120000 }).trim();
	if (Number(nb) !== expectedFrames) throw new Error('解码帧数 ' + nb + ' ≠ ' + expectedFrames);
	const hash = crypto.createHash('sha256').update(fs.readFileSync(mp4Path)).digest('hex');
	return { verified: true, frames: Number(nb), width: vs.width, height: vs.height, codec: vs.codec_name, pixFmt: vs.pix_fmt, fps: vs.avg_frame_rate, sha256: hash, bytes: fs.statSync(mp4Path).size };
}
