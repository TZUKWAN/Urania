/** MV2-03..06 — integration tests: SDK edit adapter, source patches, native import, mutual exclusion. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { editComposition } from '../runtimes/motion-worker/sdk-adapter.mjs';
import { verifyBaseShas, normalizeSourceContent } from '../host/motion/source-patches.js';
import { importNativeAsset } from '../host/motion/native-import.js';
import { commitRevision, readRevisionSources, readHeadRevision } from '../host/motion/project-store.js';
import { saveAsset } from '../host/motion/asset-store.js';

const TMP = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'dc-motion-mv2-'));
const SESSION = 'session-dcdesign-mv2';

// MV2-03 — SDK typed edit
const COMP = '<!doctype html><html><body data-composition-id="p" data-duration="4"><h1 data-hf-id="hf-title" data-start="0" data-duration="4">原标题</h1><div data-hf-id="hf-box" data-start="0" data-duration="4" style="color:red">box</div></body></html>';
test('MV2-03: SDK editComposition setText+setStyle', async () => {
	const { results, html } = await editComposition(COMP, [
		{ type: 'setText', target: 'hf-title', text: 'SDK修改后标题' },
		{ type: 'setStyle', target: 'hf-box', styles: { color: 'blue' } }
	]);
	assert.ok(results.every(r => r.ok), JSON.stringify(results.filter(r => !r.ok)));
	assert.ok(html.includes('SDK修改后标题'), 'setText persisted');
	assert.ok(html.includes('blue'), 'setStyle persisted');
	assert.ok(!html.includes('原标题'), 'old text gone');
});
test('MV2-03: unknown HfId rejected in results', async () => {
	const { results } = await editComposition(COMP, [{ type: 'setText', target: 'hf-nonexistent', text: 'x' }]);
	assert.equal(results[0].ok, false);
	assert.ok(results[0].error.includes('unknown HfId'));
});

// MV2-04 — source patches
test('MV2-04: verifyBaseShas accepts correct', () => {
	const current = { 'a.html': { bytes: 10, sha256: 'a'.repeat(64) } };
	verifyBaseShas(current, { 'a.html': { baseSha: 'a'.repeat(64) } });
});
test('MV2-04: verifyBaseShas rejects wrong', () => {
	const current = { 'a.html': { bytes: 10, sha256: 'a'.repeat(64) } };
	assert.throws(() => verifyBaseShas(current, { 'a.html': { baseSha: 'b'.repeat(64) } }), (e) => e.code === 'E_BASE_SHA');
});
test('MV2-04: normalizeSourceContent', () => {
	const out = normalizeSourceContent({ 'a.html': '<html></html>' });
	assert.equal(out['a.html'].encoding, 'utf8');
	assert.equal(out['a.html'].bytes, 13);
});

// MV2-05 — native import
test('MV2-05: native SVG import as motion asset', () => {
	const svgPath = path.join(TMP, 'test-vector.svg');
	fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
	const r = importNativeAsset(TMP, svgPath, 'vector', '12345', 'rev1');
	assert.equal(r.kind, 'image');
	assert.ok(r.nativeSource.sourceId === '12345');
	const meta = JSON.parse(fs.readFileSync(path.join(TMP, 'design', '.designcraft', 'motion', 'assets', r.sha256, 'meta.json'), 'utf8'));
	assert.equal(meta.source.engine, 'vector');
});
test('MV2-05: missing native file refused', () => {
	assert.throws(() => importNativeAsset(TMP, '/nonexistent.svg', 'vector', '1', 'r'), (e) => e.code === 'E_NATIVE_MISSING');
});
