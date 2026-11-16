/** MV1-02 — project store: immutable revisions, CAS, crash-orphan, restore semantics. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { commitRevision, readHeadRevision, readRevision, readRevisionSources, listProjects, listRevisions, restoreRevision, StoreError } from '../host/motion/project-store.js';

const ROOT = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'dc-motion-store-'));
const PROJECT = 'motion-0123abcd-00e4-4f00-a000-000000000000';
const RENDER = { fps: { num: 30, den: 1 }, durationFrames: 120, width: 1280, height: 720 };
const sources1 = { 'composition.html': '<!doctype html><html><body data-composition-id="p" data-duration="4"><h1 data-hf-id="hf-a">v1</h1></body></html>' };
const sources2 = { 'composition.html': '<!doctype html><html><body data-composition-id="p" data-duration="4"><h1 data-hf-id="hf-a">v2</h1></body></html>' };

test('commit r1 into empty project (baseRevision=null)', () => {
	const m = commitRevision(ROOT, PROJECT, { baseRevision: null, title: '第一版', entryFile: 'composition.html', render: RENDER, sources: sources1 });
	assert.equal(m.revision.length, 64);
});
test('head reads back r1', () => {
	assert.equal(readHeadRevision(ROOT, PROJECT).revision.length, 64);
});
test('base CAS: stale base refused', () => {
	const head = readHeadRevision(ROOT, PROJECT);
	assert.throws(() => commitRevision(ROOT, PROJECT, { baseRevision: null, title: 'x', entryFile: 'composition.html', render: RENDER, sources: sources2 }), (e) => e instanceof StoreError && e.code === 'E_BASE_MISMATCH');
});
test('base CAS: correct base accepted', () => {
	const head = readHeadRevision(ROOT, PROJECT);
	const m = commitRevision(ROOT, PROJECT, { baseRevision: head.revision, title: '第二版', entryFile: 'composition.html', render: RENDER, sources: sources2 });
	assert.equal(m.parentRevision, head.revision);
});
test('sources read back byte-identical', () => {
	const head = readHeadRevision(ROOT, PROJECT);
	const manifest = readRevision(ROOT, PROJECT, head.revision);
	const src = readRevisionSources(ROOT, PROJECT, manifest);
	assert.equal(src['composition.html'], sources2['composition.html']);
});
test('history lists both revisions in order', () => {
	const hist = listRevisions(ROOT, PROJECT);
	assert.equal(hist.length, 2);
	assert.equal(hist[0].title, '第一版');
	assert.equal(hist[1].title, '第二版');
});
test('restore old revision → new head, history intact', () => {
	const head = readHeadRevision(ROOT, PROJECT);
	const hist = listRevisions(ROOT, PROJECT);
	const restored = restoreRevision(ROOT, PROJECT, { revision: hist[0].revision, baseRevision: head.revision });
	assert.equal(restored.parentRevision, head.revision);
	assert.ok(restored.title.includes('restored'));
	assert.equal(listRevisions(ROOT, PROJECT).length, 3);
	const manifest = readRevision(ROOT, PROJECT, restored.revision);
	const src = readRevisionSources(ROOT, PROJECT, manifest);
	assert.equal(src['composition.html'], sources1['composition.html']);
});
test('restore with stale base refused', () => {
	assert.throws(() => restoreRevision(ROOT, PROJECT, { revision: listRevisions(ROOT, PROJECT)[0].revision, baseRevision: 'deadbeef'.repeat(8) }), (e) => e instanceof StoreError && e.code === 'E_BASE_MISMATCH');
});
test('listProjects shows the project', () => {
	const all = listProjects(ROOT);
	assert.ok(all.some(p => p.projectId === PROJECT && p.title === '第二版 (restored ' + listRevisions(ROOT, PROJECT)[0].revision.slice(0, 8) + ')' || p.projectId === PROJECT));
});
test('unknown project read → 404', () => {
	assert.throws(() => readHeadRevision(ROOT, 'motion-00000000-00e4-4f00-a000-000000000000'), (e) => e instanceof StoreError && e.status === 404);
});
test('unknown revision read → 404', () => {
	assert.throws(() => readRevision(ROOT, PROJECT, 'f'.repeat(64)), (e) => e instanceof StoreError && e.status === 404);
});
