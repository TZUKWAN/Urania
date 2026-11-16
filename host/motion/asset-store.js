/**
 * Motion asset store — content-addressed media/font storage with provenance.
 * Layout: <projectDir>/design/.designcraft/motion/assets/<sha256>/asset.<ext>
 *         + <sha256>.meta.json (media params, license, source)
 * Contracts (MV1-03):
 *   - streaming-friendly bounded writes, hash verified after write
 *   - no external URL fetches here (import routes resolve URLs upstream)
 *   - every asset referenced from a revision must exist here
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SchemaError } from './schema.js';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const EXT_BY_KIND = { image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'], video: ['mp4', 'webm', 'mov'], audio: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'], font: ['ttf', 'otf', 'woff', 'woff2'] };
const KIND_BY_EXT = {};
for (const [kind, exts] of Object.entries(EXT_BY_KIND)) for (const e of exts) KIND_BY_EXT[e] = kind;
const MAX_SINGLE = 256 * 1024 * 1024;

export class AssetError extends Error {
	constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

function assetsRoot(root) { return path.join(root, 'design', '.designcraft', 'motion', 'assets'); }
function assetDir(root, sha) { return path.join(assetsRoot(root), sha); }

function detectKind(name, declaredKind) {
	const ext = path.extname(name).slice(1).toLowerCase();
	if (declaredKind) {
		if (!EXT_BY_KIND[declaredKind]) throw new AssetError('E_KIND', 'unknown asset kind: ' + declaredKind);
		if (KIND_BY_EXT[ext] && KIND_BY_EXT[ext] !== declaredKind) throw new AssetError('E_KIND_EXT', 'extension .' + ext + ' does not match kind ' + declaredKind);
		return declaredKind;
	}
	if (!KIND_BY_EXT[ext]) throw new AssetError('E_EXT', 'unknown asset extension: ' + ext);
	return KIND_BY_EXT[ext];
}

/** Save an asset (Buffer). Returns {sha256, kind, bytes, name}. Idempotent by content. */
export function saveAsset(root, { name, kind, bytes, license, source }) {
	if (!Buffer.isBuffer(bytes)) throw new AssetError('E_BYTES', 'asset bytes must be a Buffer');
	if (bytes.length === 0) throw new AssetError('E_EMPTY', 'empty asset refused');
	if (bytes.length > MAX_SINGLE) throw new AssetError('E_TOO_BIG', 'asset exceeds ' + MAX_SINGLE + ' bytes');
	if (typeof name !== 'string' || !name || name.length > 200) throw new AssetError('E_NAME', 'asset name required (1..200)');
	const resolvedKind = detectKind(name, kind);
	const hash = sha256(bytes);
	const dir = assetDir(root, hash);
	const ext = path.extname(name).slice(1).toLowerCase() || 'bin';
	const file = path.join(dir, 'asset.' + ext);
	const metaFile = path.join(dir, 'meta.json');
	if (!fs.existsSync(file)) {
		fs.mkdirSync(dir, { recursive: true });
		const tmp = path.join(dir, '.tmp-' + crypto.randomBytes(6).toString('hex'));
		fs.writeFileSync(tmp, bytes);
		const verify = sha256(fs.readFileSync(tmp));
		if (verify !== hash) { try { fs.unlinkSync(tmp); } catch { } throw new AssetError('E_HASH', 'write verify failed'); }
		fs.renameSync(tmp, file);
	}
	if (!fs.existsSync(metaFile)) {
		fs.writeFileSync(metaFile, JSON.stringify({
			sha256: hash, kind: resolvedKind, name, bytes: bytes.length, ext,
			license: license || 'user-provided', source: source || 'user-upload',
			savedAt: new Date().toISOString()
		}, null, 1));
	}
	return { sha256: hash, kind: resolvedKind, bytes: bytes.length, name, file: 'design/.designcraft/motion/assets/' + hash + '/asset.' + ext };
}

export function readAssetMeta(root, sha) {
	const metaFile = path.join(assetDir(root, sha), 'meta.json');
	if (!fs.existsSync(metaFile)) throw new AssetError('E_NO_ASSET', 'asset not found: ' + sha, 404);
	return JSON.parse(fs.readFileSync(metaFile, 'utf8'));
}

export function readAssetBytes(root, sha) {
	const meta = readAssetMeta(root, sha);
	const file = path.join(assetDir(root, sha), 'asset.' + meta.ext);
	if (!fs.existsSync(file)) throw new AssetError('E_NO_BLOB', 'asset blob missing', 500);
	const bytes = fs.readFileSync(file);
	if (sha256(bytes) !== sha) throw new AssetError('E_CORRUPT', 'asset hash mismatch', 500);
	return { bytes, meta };
}

/** Verify all assets referenced by a manifest exist. */
export function verifyManifestAssets(root, manifest) {
	const missing = [];
	for (const a of manifest.assets || []) {
		if (!fs.existsSync(path.join(assetDir(root, a.sha256), 'meta.json'))) missing.push(a.sha256);
	}
	if (missing.length) throw new AssetError('E_MISSING_ASSETS', 'missing assets: ' + missing.join(', '), 409);
	return true;
}
