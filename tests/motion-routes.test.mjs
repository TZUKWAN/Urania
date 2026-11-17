/** MV2-01/02 — motion routes: create/open/write_sources/restore + session/lease admission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { motionHandleAction } from '../host/motion/routes.js';

const ROOT = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'dc-motion-routes-'));
const SESSION = 'session-dcdesign-test123';
const url = (root = ROOT) => new URL('http://localhost/?root=' + encodeURIComponent(root));
const services = { execution: { agent: { session: SESSION } } };

const RENDER = { fps: { num: 30, den: 1 }, durationFrames: 120, width: 1280, height: 720 };

test('create: no session → E_SESSION', async () => {
	await assert.rejects(() => motionHandleAction('create', 'POST', { title: 'T', render: RENDER }, url(), {}), (e) => e.code === 'E_SESSION');
});
test('create: valid → projectId+lease', async () => {
	const r = await motionHandleAction('create', 'POST', { title: '测试动画', render: RENDER, operationKey: 'create-1' }, url(), services);
	assert.ok(r.projectId.startsWith('motion-'));
	assert.ok(r.leaseId);
	assert.equal(r.sessionId, SESSION);
});
test('open: returns lease with correct session', async () => {
	const created = await motionHandleAction('create', 'POST', { title: 'T2', render: RENDER, operationKey: 'create-2' }, url(), services);
	const opened = await motionHandleAction('open', 'POST', { projectId: created.projectId }, url(), services);
	assert.equal(opened.projectId, created.projectId);
	assert.equal(opened.sessionId, SESSION);
});
test('write_sources: with valid lease → new revision', async () => {
	const created = await motionHandleAction('create', 'POST', { title: 'T3', render: RENDER, operationKey: 'create-3' }, url(), services);
	const r = await motionHandleAction('write_sources', 'POST', {
		projectId: created.projectId, baseRevision: created.revision, leaseId: created.leaseId, viewEpoch: created.viewEpoch,
		operationKey: 'ws-1',
		sources: { 'composition.html': '<!doctype html><html><body data-composition-id="p" data-duration="4"><h1 data-hf-id="hf-a">v2</h1></body></html>' }
	}, url(), services);
	assert.equal(r.sourcePersisted, true);
	assert.ok(r.revision);
});
test('write_sources: stale baseRevision → E_STALE_BASE', async () => {
	const created = await motionHandleAction('create', 'POST', { title: 'T4', render: RENDER, operationKey: 'create-4' }, url(), services);
	const head = await motionHandleAction('open', 'POST', { projectId: created.projectId }, url(), services);
	// advance head
	await motionHandleAction('write_sources', 'POST', {
		projectId: created.projectId, baseRevision: created.revision, leaseId: created.leaseId, viewEpoch: created.viewEpoch,
		operationKey: 'ws-4a', sources: { 'composition.html': '<html>v3</html>' }
	}, url(), services);
	// now write with the OLD base
	await assert.rejects(() => motionHandleAction('write_sources', 'POST', {
		projectId: created.projectId, baseRevision: created.revision, leaseId: created.leaseId, viewEpoch: created.viewEpoch,
		operationKey: 'ws-4b', sources: { 'composition.html': '<html>v4</html>' }
	}, url(), services), (e) => ['E_STALE_BASE', 'E_BASE_MISMATCH'].includes(e.code) || String(e.message).includes('head moved'));
});
test('write_sources: no session → E_SESSION', async () => {
	await assert.rejects(() => motionHandleAction('write_sources', 'POST', {
		projectId: 'motion-0123abcd-00e4-4f00-a000-000000000000', baseRevision: 'a'.repeat(64), leaseId: 'fake', viewEpoch: 'x',
		operationKey: 'ws-no-session', sources: { 'a.html': 'x' }
	}, url(), {}), (e) => e.code === 'E_LEASE' || e.code === 'E_SESSION');
});
test('restore: old revision → new head', async () => {
	const c1 = await motionHandleAction('create', 'POST', { title: 'R1', render: RENDER, operationKey: 'restore-c1' }, url(), services);
	const r1 = c1.revision;
	await motionHandleAction('write_sources', 'POST', {
		projectId: c1.projectId, baseRevision: r1, leaseId: c1.leaseId, viewEpoch: c1.viewEpoch,
		operationKey: 'restore-ws', sources: { 'composition.html': '<html>v2</html>' }
	}, url(), services);
	const head = await motionHandleAction('open', 'POST', { projectId: c1.projectId }, url(), services);
	await assert.rejects(()=>motionHandleAction('restore','POST',{projectId:c1.projectId,baseRevision:head.revision,revision:r1,operationKey:'restore-no-lease'},url(),services),e=>e.code==='E_LEASE');
	const restored = await motionHandleAction('restore', 'POST', {
		projectId: c1.projectId, baseRevision: head.revision, leaseId:head.leaseId,viewEpoch:head.viewEpoch,revision: r1, operationKey: 'restore-r1'
	}, url(), services);
	assert.equal(restored.sourcePersisted, true);
});
test('close_lease: subsequent writes rejected', async () => {
	const created = await motionHandleAction('create', 'POST', { title: 'CL', render: RENDER, operationKey: 'close-c1' }, url(), services);
	await motionHandleAction('close_lease', 'POST', { projectId: created.projectId }, url(), services);
	await assert.rejects(() => motionHandleAction('write_sources', 'POST', {
		projectId: created.projectId, baseRevision: created.revision, leaseId: created.leaseId, viewEpoch: created.viewEpoch,
		operationKey: 'close-ws', sources: { 'a.html': 'x' }
	}, url(), services), (e) => e.code === 'E_LEASE_REVOKED');
});
test('list_projects returns all', async () => {
	const all = await motionHandleAction('list_projects', 'GET', {}, url(), services);
	assert.ok(all.projects.length >= 4);
});

/* ---- audit additions: preview/artifact/export/verify coverage ---- */
function mockRes() {
	const chunks = [];
	return {
		chunks, headers: null,
		writeHead(status, headers) { this.headers = { status, headers }; },
		end(data) { if (data) chunks.push(data); this.ended = true; },
		destroyed: false, writableEnded: false
	};
}
test('create: default template carries frame-clock runtime + composition root', async () => {
	const created = await motionHandleAction('create', 'POST', { title: '模板', render: RENDER, operationKey: 'tpl-1' }, url(), services);
	const head = await motionHandleAction('open', 'POST', { projectId: created.projectId }, url(), services);
	const proj = await motionHandleAction('project', 'GET', {}, new URL('http://localhost/?root=' + encodeURIComponent(ROOT) + '&projectId=' + created.projectId), services);
	const html = proj.sources['composition.html'];
	assert.ok(html.includes('data-composition-id="dc"'), 'composition root present');
	assert.ok(html.includes('__hfSeek')&&html.includes('__hfPlay')&&html.includes('__hfPause')&&html.includes('hf-preview'), 'frame clock runtime: seek/play/pause + time reporting');
	assert.ok(html.includes("querySelectorAll('audio[src]')")&&html.includes('createAudioSync')&&html.includes('data-hf-status'), 'audio sync runtime + status hint present');
	assert.ok(html.includes('__timelines'), 'GSAP dual-clock support present');
	assert.ok(html.includes('data-hf-id'), 'editable ids present');
});
test('export_project returns base64 payload', async () => {
	const created = await motionHandleAction('create', 'POST', { title: 'EXP', render: RENDER, operationKey: 'exp-1' }, url(), services);
	const r = await motionHandleAction('export_project', 'POST', { projectId: created.projectId, operationKey: 'exp-2' }, url(), services);
	assert.ok(r.dataBase64.length > 100, 'base64 payload present');
	assert.ok(r.fileCount >= 1);
});
test('verify_artifact: missing artifact → E_NO_ARTIFACT', async () => {
	const created = await motionHandleAction('create', 'POST', { title: 'VA', render: RENDER, operationKey: 'va-1' }, url(), services);
	await assert.rejects(() => motionHandleAction('verify_artifact', 'POST', {
		projectId: created.projectId, baseRevision: created.revision, operationKey: 'va-missing'
	}, url(), services), (e) => e.code === 'E_NO_ARTIFACT');
});
test('verify_artifact: bad projectId rejected', async () => {
	await assert.rejects(() => motionHandleAction('verify_artifact', 'POST', {
		projectId: '../evil', baseRevision: 'x'.repeat(64), operationKey: 'va-bad'
	}, url(), services), (e) => !!e.code);
});
test('render action rejects unauthenticated write (no lease)', async () => {
	const created = await motionHandleAction('create', 'POST', { title: 'RD', render: RENDER, operationKey: 'rd-1' }, url(), services);
	await assert.rejects(() => motionHandleAction('render', 'POST', {
		projectId: created.projectId, baseRevision: created.revision, viewEpoch: created.viewEpoch, operationKey: 'rd-2'
	}, url(), services), (e) => ['E_LEASE', 'E_LEASE_REVOKED', 'E_SESSION'].includes(e.code));
});

/* ---- vendored templates + reference measurement ---- */
test('templates: list includes vendored hyperframes templates with render params', async () => {
	const r = await motionHandleAction('templates', 'POST', {}, url(), services);
	assert.ok(Array.isArray(r.templates) && r.templates.length >= 6, 'at least 6 templates, got ' + (r.templates || []).length);
	const kinetic = r.templates.find((t) => t.id === 'frame-kinetic-type');
	assert.ok(kinetic, 'kinetic-type present');
	assert.ok(kinetic.render && kinetic.render.durationFrames > 0 && kinetic.render.width === 1920, 'render params parsed from html');
	assert.ok(r.templates.every((t) => typeof t.title === 'string'), 'titles present');
});
test('create_from_template: seeds a full GSAP project (index.html + fonts)', async () => {
	const r = await motionHandleAction('create_from_template', 'POST', { templateId: 'frame-glitch-title', title: 'T-GL', operationKey: 'tplc-1' }, url(), services);
	assert.ok(r.projectId.startsWith('motion-'));
	const proj = await motionHandleAction('project', 'GET', {}, new URL('http://localhost/?root=' + encodeURIComponent(ROOT) + '&projectId=' + r.projectId), services);
	assert.equal(proj.manifest.entryFile, 'index.html');
	assert.ok(proj.sources['index.html'].includes('tailwind.css') || proj.sources['index.html'].length > 2000, 'index.html seeded');
	assert.ok(proj.sources['fonts.css'], 'fonts.css seeded');
	assert.ok(Object.keys(proj.sources).some((k) => k.startsWith('fonts/')), 'font files seeded');
	await assert.rejects(() => motionHandleAction('create_from_template', 'POST', { templateId: '../evil', operationKey: 'tplc-2' }, url(), services), (e) => e.code === 'E_TEMPLATE');
});
test('reference: measures a real video into facts/frames/audio', async () => {
	const {resolveMotionPaths}=await import('../host/motion/runtime-env.js');const FFMPEG=resolveMotionPaths({components:['ffmpeg']}).ffmpegPath;
	const { execFileSync } = await import('node:child_process');
	const videoPath = path.join(ROOT, 'ref-sample.mp4');
	execFileSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x180:rate=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', videoPath], { stdio: 'pipe' });
	const r = await motionHandleAction('reference', 'POST', { video: 'ref-sample.mp4' }, url(), services);
	assert.ok(r.referenceId.startsWith('ref-'));
	assert.ok(r.facts.durationSec >= 1.9 && r.facts.durationSec <= 2.2, 'duration ~2s, got ' + r.facts.durationSec);
	assert.equal(r.facts.width, 320);
	assert.ok(r.facts.hasAudio, 'audio detected');
	assert.ok(r.audio && r.audio.endsWith('.wav'), 'soundtrack wav extracted');
	assert.ok(r.frames.length >= 3, 'frames extracted: ' + r.frames.length);
	assert.ok(fs.existsSync(path.join(ROOT, r.factsPath)), 'facts.md written inside root');
	await assert.rejects(() => motionHandleAction('reference', 'POST', { video: '../outside.mp4' }, url(), services), (e) => e.code === 'E_PATH');
	fs.rmSync(videoPath, { force: true });
});

test('frame runtime injection: bare compositions get the clock, shipped ones untouched', async () => {
	const { injectFrameRuntime } = await import('../host/motion/frame-runtime.js');
	const bare = '<!doctype html><html><body><div data-composition-id="dc" data-duration="1" data-width="64" data-height="64"></div></body></html>';
	const injected = injectFrameRuntime(bare);
	assert.ok(injected.includes('__hfSeek') && injected.includes('__hfPlay') && injected.includes('data-hf-frame-runtime'), 'runtime injected into bare html');
	assert.equal(injectFrameRuntime(injected), injected, 'idempotent: already-injected html untouched');
	const shipped = '<html><body><script>window.__hfSeek=function(){}</script></body></html>';
	assert.equal(injectFrameRuntime(shipped), shipped, 'composition-shipped runtime respected');
});
