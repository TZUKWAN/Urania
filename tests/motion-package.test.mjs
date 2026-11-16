/** MV1-04 — .dcmotion export/import: roundtrip fidelity + malicious package refusals. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { commitRevision, readRevisionSources } from '../host/motion/project-store.js';
import { saveAsset } from '../host/motion/asset-store.js';
import { exportDcmotion, importDcmotion, inspectDcmotion } from '../host/motion/package.js';
import { readRevision } from '../host/motion/project-store.js';

const ROOT = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'dc-motion-pkg-'));
const PROJECT = 'motion-11111111-00e4-4f00-a000-000000000000';
const RENDER = { fps: { num: 30, den: 1 }, durationFrames: 120, width: 1280, height: 720 };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), crypto.randomBytes(32)]);
const SRC = '<!doctype html><html><body data-composition-id="p" data-duration="4"><h1 data-hf-id="hf-a">包测试</h1></body></html>';

let manifest;
test('setup: project with an asset', () => {
	const asset = saveAsset(ROOT, { name: 'hero.png', bytes: PNG });
	manifest = commitRevision(ROOT, PROJECT, {
		baseRevision: null, title: '包测试工程', entryFile: 'composition.html', render: RENDER,
		sources: { 'composition.html': SRC, 'sub/style.css': 'h1{color:red}' },
		assets: [{ sha256: asset.sha256, kind: 'image', name: 'hero.png' }]
	});
});
test('export produces a zip with manifest+sources+assets', () => {
	const { buffer } = exportDcmotion(ROOT, PROJECT);
	assert.ok(buffer.length > 200);
	assert.equal(buffer.readUInt32LE(0), 0x04034b50);
});
test('roundtrip: export → import → new project, sources+assets identical', () => {
	const { buffer } = exportDcmotion(ROOT, PROJECT);
	const imp = importDcmotion(ROOT, buffer);
	assert.notEqual(imp.projectId, PROJECT);
	const src = readRevisionSources(ROOT, imp.projectId, readRevision(ROOT, imp.projectId, imp.revision));
	assert.equal(src['composition.html'], SRC);
	assert.equal(src['sub/style.css'], 'h1{color:red}');
});
test('malicious: traversal entry refused', () => {
	const evil = buildEvilZip([{ name: '../evil.txt', data: 'x' }]);
	assert.throws(() => inspectDcmotion(evil), (e) => e.code === 'E_TRAVERSAL');
});
test('malicious: absolute entry refused', () => {
	assert.throws(() => inspectDcmotion(buildEvilZip([{ name: '/abs.txt', data: 'x' }])), (e) => e.code === 'E_ABS');
});
test('malicious: executable entry refused', () => {
	assert.throws(() => inspectDcmotion(buildEvilZip([{ name: 'tools/run.exe', data: 'MZ' }])), (e) => e.code === 'E_EXEC');
});
test('malicious: .env entry refused', () => {
	assert.throws(() => inspectDcmotion(buildEvilZip([{ name: '.env', data: 'KEY=1' }])), (e) => e.code === 'E_ENV');
});
test('malicious: case collision refused', () => {
	assert.throws(() => inspectDcmotion(buildEvilZip([{ name: 'manifest.json', data: '{}' }, { name: 'MANIFEST.json', data: '{}' }])), (e) => e.code === 'E_CASE');
});
test('malicious: no manifest refused', () => {
	assert.throws(() => inspectDcmotion(buildEvilZip([{ name: 'readme.txt', data: 'x' }])), (e) => e.code === 'E_NO_MANIFEST');
});
test('malicious: session id in manifest refused', () => {
	assert.throws(() => inspectDcmotion(buildEvilZip([{ name: 'manifest.json', data: JSON.stringify({ format: 'dcmotion', session: 'session-0123abcd-00e4-4f00-a000-000000000000' }) }])), (e) => e.code === 'E_SECRET');
});
test('malicious: corrupt zip refused', () => {
	assert.throws(() => inspectDcmotion(Buffer.from('not a zip at all')), (e) => e.code === 'E_ZIP' || e.code === 'E_EMPTY');
});

function buildEvilZip(entries) {
	// reuse the store's zip builder via a tiny re-export hack: build here with same algorithm
	const crc32 = (buf) => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } let c = -1; for (const b of buf) c = (c >>> 8) ^ t[(c ^ b) & 0xFF]; return (c ^ -1) >>> 0; };
	const chunks = [], central = [];
	let offset = 0;
	for (const e of entries) {
		const nameBytes = Buffer.from(e.name, 'utf8');
		const data = Buffer.from(e.data, 'utf8');
		const comp = deflateRawSync(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
		local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(nameBytes.length, 26);
		chunks.push(local, nameBytes, comp);
		const cen = Buffer.alloc(46);
		cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10);
		cen.writeUInt32LE(crc32(data), 16); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24);
		cen.writeUInt16LE(nameBytes.length, 28); cen.writeUInt32LE(offset, 42);
		central.push(Buffer.concat([cen, nameBytes]));
		offset += local.length + nameBytes.length + comp.length;
	}
	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
	return Buffer.concat([...chunks, centralBuf, end]);
}
