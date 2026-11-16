/**
 * Motion reference measurement — ported from nexu-io/open-design
 * apps/daemon/src/media/motion-reference.ts (Apache-2.0), adapted to the
 * DesignCraft motion workspace and the locally pinned ffmpeg.
 *
 * Turns a user's reference video into measured facts the agent can rebuild a
 * film from: duration/size/fps, audio presence, shot cuts, a frame at every
 * shot, a contact sheet, and the soundtrack as WAV ready to drop into a
 * composition as an <audio> asset.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MOTION_REFERENCE_MAX_BYTES = 200 * 1024 * 1024;
export const MOTION_REFERENCE_MAX_SECONDS = 180;
const MAX_FRAMES = 24;
const MIN_FRAME_GAP_SECONDS = 0.4;
const SCENE_THRESHOLD = 0.3;
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

function run(cmd, args, timeoutMs = 120000) {
	const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
	return { code: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Probe by parsing `ffmpeg -i` stderr (no ffprobe dependency). */
export function parseProbe(stderr) {
	const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
	const durationSec = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0;
	const video = /Stream #\S+.*?Video:([^\n]*)/.exec(stderr);
	const desc = video?.[1] ?? '';
	const size = /\b(\d{2,5})x(\d{2,5})\b/.exec(desc);
	const fpsM = /([\d.]+)\s*fps/.exec(desc) ?? /([\d.]+)\s*tbr/.exec(desc);
	const hasVideo = !!video;
	const hasAudio = /Stream #\S+.*?Audio:/.test(stderr);
	return {
		durationSec, hasVideo, hasAudio,
		width: size ? Number(size[1]) : 0,
		height: size ? Number(size[2]) : 0,
		fps: fpsM ? Number(fpsM[1]) : 0
	};
}

/** Scene-cut timestamps via the select/showinfo filter. */
export function detectCuts(ffmpegPath, videoPath, durationSec) {
	const out = run(ffmpegPath, ['-i', videoPath, '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-an', '-f', 'null', '-'], 180000);
	const cuts = [];
	for (const m of out.stderr.matchAll(/pts_time:([\d.]+)/g)) {
		const t = Number(m[1]);
		if (Number.isFinite(t) && t > 0.05 && t < durationSec - 0.05) cuts.push(+t.toFixed(3));
	}
	return [...new Set(cuts)].sort((a, b) => a - b);
}

/**
 * Measure a reference video into `outDir`.
 * @returns {{facts:object, factsMd:string, files:{frames:string[],contactSheet:string,audio:string|null}}}
 */
export function measureReference(ffmpegPath, videoPath, outDir) {
	if (!ffmpegPath || !fs.existsSync(ffmpegPath)) throw Object.assign(new Error('ffmpeg not found: ' + ffmpegPath), { code: 'E_FFMPEG', status: 500 });
	if (!fs.existsSync(videoPath)) throw Object.assign(new Error('视频不存在: ' + videoPath), { code: 'E_NO_VIDEO', status: 404 });
	const ext = path.extname(videoPath).toLowerCase();
	if (!VIDEO_EXTENSIONS.has(ext)) throw Object.assign(new Error('不是视频文件: ' + ext), { code: 'E_NOT_VIDEO', status: 400 });
	const sizeBytes = fs.statSync(videoPath).size;
	if (sizeBytes > MOTION_REFERENCE_MAX_BYTES) throw Object.assign(new Error('视频超过 200MB 上限'), { code: 'E_TOO_LARGE', status: 400 });

	const probe = parseProbe(run(ffmpegPath, ['-i', videoPath]).stderr);
	if (!probe.hasVideo || !probe.durationSec) throw Object.assign(new Error('无法解析视频流'), { code: 'E_PROBE', status: 400 });
	if (probe.durationSec > MOTION_REFERENCE_MAX_SECONDS) throw Object.assign(new Error('视频超过 180 秒上限'), { code: 'E_TOO_LONG', status: 400 });

	fs.rmSync(outDir, { recursive: true, force: true });
	fs.mkdirSync(outDir, { recursive: true });

	const cuts = detectCuts(ffmpegPath, videoPath, probe.durationSec);
	// 帧位：每个分镜取一帧 + 均匀补足
	const picks = [];
	const take = (t) => { if (picks.every((p) => Math.abs(p - t) >= MIN_FRAME_GAP_SECONDS)) picks.push(+t.toFixed(3)); };
	for (const c of cuts) { if (picks.length >= MAX_FRAMES) break; take(Math.min(c + 0.1, probe.durationSec - 0.1)); }
	for (let i = 0; picks.length < MAX_FRAMES && i < MAX_FRAMES; i++) {
		take(probe.durationSec * (i + 0.5) / MAX_FRAMES);
	}
	const frames = [];
	for (let i = 0; i < picks.length; i++) {
		const f = path.join(outDir, 'frame-' + String(i).padStart(2, '0') + '.png');
		const r = run(ffmpegPath, ['-ss', String(picks[i]), '-i', videoPath, '-frames:v', '1', '-y', f], 60000);
		if (r.code === 0 && fs.existsSync(f)) frames.push({ at: picks[i], path: f });
	}
	// 拼图（2 行 6 列缩略）
	const sheet = path.join(outDir, 'contact-sheet.png');
	if (frames.length > 0) {
		run(ffmpegPath, ['-framerate', '1', '-i', path.join(outDir, 'frame-%02d.png'), '-vf', 'scale=320:-1,tile=6x2', '-frames:v', '1', '-y', sheet], 120000);
	}
	// 音轨抽成 WAV，可直接作 <audio> 资产
	let audio = null;
	if (probe.hasAudio) {
		const wav = path.join(outDir, 'soundtrack.wav');
		const r = run(ffmpegPath, ['-i', videoPath, '-vn', '-acodec', 'pcm_s16le', '-ar', '44100', '-ac', '2', '-y', wav], 180000);
		if (r.code === 0 && fs.existsSync(wav)) audio = wav;
	}
	const facts = {
		source: videoPath, durationSec: +probe.durationSec.toFixed(3),
		width: probe.width, height: probe.height, fps: probe.fps,
		hasAudio: probe.hasAudio, cuts, frames: frames.map((f) => f.at),
		contactSheet: fs.existsSync(sheet) ? sheet : null, audio
	};
	const factsMd = [
		'# Motion Reference Facts', '',
		`- source: ${path.basename(videoPath)}`,
		`- duration: ${facts.durationSec}s · ${facts.width}x${facts.height} · ${facts.fps}fps`,
		`- audio: ${facts.hasAudio ? 'yes' : 'no'}${audio ? ' (soundtrack.wav ready as <audio> asset)' : ''}`,
		`- shot cuts: ${cuts.length ? cuts.join(', ') : '(none detected — single shot)'}`,
		`- frames: ${frames.length} (frame-XX.png at the timestamps in \`frames\`)`,
		'', 'Replication rules: match the shot rhythm first, then per-shot composition;',
		'keep total duration within ±10% unless the user says otherwise.'
	].join('\n');
	fs.writeFileSync(path.join(outDir, 'facts.md'), factsMd);
	return { facts, factsMd, files: { frames, contactSheet: facts.contactSheet, audio } };
}
