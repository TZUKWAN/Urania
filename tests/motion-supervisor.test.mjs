/** Motion render supervisor — lifecycle, progress parsing, retention, cancel, auto-verify wiring. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startRender, getRenderStatus, cancelRender, getActiveRenderCount } from '../host/motion/render-supervisor.js';

function makeWorker(code, body) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-supervisor-worker-'));
	const file = path.join(dir, 'fake-worker.mjs');
	fs.writeFileSync(file, body);
	return file;
}

const OK_WORKER = `import fs from 'node:fs';
import path from 'node:path';
const req = await new Promise((r) => { let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>r(JSON.parse(d))); });
console.log(JSON.stringify({ type:'progress', frame: 5, totalFrames: 10 }));
if (req.emit) { console.log(JSON.stringify({ type:'progress', frame: 10, totalFrames: 10 })); }
fs.mkdirSync(path.dirname(req.outputPath), { recursive: true });
fs.writeFileSync(req.outputPath, Buffer.alloc(64, 1));
process.exit(0);
`;
const FAIL_WORKER = `console.error('boom: 磁盘已满');
process.exit(3);
`;
const SLOW_WORKER = `setTimeout(() => process.exit(0), 60000);
`;

function waitStatus(jobId, predicate, timeoutMs = 15000) {
	return new Promise((resolve, reject) => {
		const started = Date.now();
		const poll = setInterval(() => {
			const st = getRenderStatus(jobId);
			if (st && predicate(st)) { clearInterval(poll); resolve(st); }
			else if (Date.now() - started > timeoutMs) { clearInterval(poll); reject(new Error('等待渲染状态超时, last=' + JSON.stringify(st && { status: st.status, progress: st.progress }))); }
		}, 100);
	});
}

test('supervisor: ok worker → completed, progress parsed, terminal record retained', async () => {
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-supervisor-out-'));
	const outputPath = path.join(outDir, 'video.mp4');
	const { jobId } = startRender(makeWorker('ok', OK_WORKER), outDir, outputPath, { width: 64, height: 64, timeoutMs: 15000 });
	assert.equal(getActiveRenderCount(), 1);
	const st = await waitStatus(jobId, (s) => s.status !== 'running');
	assert.equal(st.status, 'completed');
	assert.equal(st.exitCode, 0);
	assert.equal(st.progress, 50, 'only the first progress line (5/10) arrived before worker wrote output');
	assert.ok(fs.existsSync(outputPath), 'worker wrote the output');
	assert.ok(getRenderStatus(jobId), 'finished record retrievable via getRenderStatus');
	assert.ok(getActiveRenderCount() === 0, 'active slot released');
});

test('supervisor: failing worker → failed with error surfaced', async () => {
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-supervisor-fail-'));
	const { jobId } = startRender(makeWorker('fail', FAIL_WORKER), outDir, path.join(outDir, 'v.mp4'), { timeoutMs: 15000 });
	const st = await waitStatus(jobId, (s) => s.status !== 'running');
	assert.equal(st.status, 'failed');
	assert.equal(st.exitCode, 3);
	assert.match(st.error, /boom|磁盘|退出码 3/, 'error carries worker detail');
});

test('supervisor: cancel kills a running job → cancelled', async () => {
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-supervisor-slow-'));
	const { jobId } = startRender(makeWorker('slow', SLOW_WORKER), outDir, path.join(outDir, 'v.mp4'), { timeoutMs: 60000 });
	await new Promise((r) => setTimeout(r, 400));
	assert.ok(cancelRender(jobId), 'cancel accepted');
	const st = await waitStatus(jobId, (s) => s.status !== 'running');
	assert.equal(st.status, 'cancelled');
});

test('supervisor: worker entry missing → immediate structured failure', async () => {
	const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-supervisor-miss-'));
	assert.throws(() => startRender(path.join(outDir, 'nope.mjs'), outDir, path.join(outDir, 'v.mp4'), {}), /worker 入口不存在/);
});
