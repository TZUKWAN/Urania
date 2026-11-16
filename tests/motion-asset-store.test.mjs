/** MV1-03 — asset store: content addressing, idempotency, kind/ext consistency, refusal paths. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { saveAsset, readAssetMeta, readAssetBytes, verifyManifestAssets, AssetError } from '../host/motion/asset-store.js';

const ROOT = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'dc-motion-assets-'));
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47]), crypto.randomBytes(64)]); // png magic + noise
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

test('save image asset', () => {
	const r = saveAsset(ROOT, { name: 'hero.png', bytes: PNG });
	assert.equal(r.kind, 'image');
	assert.equal(r.sha256, sha(PNG));
	assert.ok(fs.existsSync(path.join(ROOT, 'design', '.designcraft', 'motion', 'assets', r.sha256, 'asset.png')));
});
test('idempotent by content (same bytes → same dir)', () => {
	const r1 = saveAsset(ROOT, { name: 'a.png', bytes: PNG });
	const r2 = saveAsset(ROOT, { name: 'b.png', bytes: PNG });
	assert.equal(r1.sha256, r2.sha256);
});
test('meta read back', () => {
	const r = saveAsset(ROOT, { name: 'hero.png', bytes: PNG });
	const meta = readAssetMeta(ROOT, r.sha256);
	assert.equal(meta.kind, 'image');
	assert.equal(meta.license, 'user-provided');
});
test('bytes read back + hash verified', () => {
	const r = saveAsset(ROOT, { name: 'hero.png', bytes: PNG });
	const { bytes } = readAssetBytes(ROOT, r.sha256);
	assert.ok(bytes.equals(PNG));
});
test('wrong kind for extension refused', () => {
	assert.throws(() => saveAsset(ROOT, { name: 'x.png', kind: 'video', bytes: PNG }), (e) => e instanceof AssetError && e.code === 'E_KIND_EXT');
});
test('unknown extension refused', () => {
	assert.throws(() => saveAsset(ROOT, { name: 'x.xyz', bytes: PNG }), (e) => e instanceof AssetError && e.code === 'E_EXT');
});
test('empty asset refused', () => {
	assert.throws(() => saveAsset(ROOT, { name: 'x.png', bytes: Buffer.alloc(0) }), (e) => e instanceof AssetError && e.code === 'E_EMPTY');
});
test('verifyManifestAssets: present ok', () => {
	const r = saveAsset(ROOT, { name: 'hero.png', bytes: PNG });
	verifyManifestAssets(ROOT, { assets: [{ sha256: r.sha256 }] });
});
test('verifyManifestAssets: missing refused', () => {
	assert.throws(() => verifyManifestAssets(ROOT, { assets: [{ sha256: 'f'.repeat(64) }] }), (e) => e instanceof AssetError && e.code === 'E_MISSING_ASSETS');
});
