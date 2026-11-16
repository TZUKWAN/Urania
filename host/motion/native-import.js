/**
 * Native asset bridge — import real Vector/Photo/Deck saved outputs as motion assets.
 * Reads from existing native source store; never modifies the original native file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { saveAsset } from './asset-store.js';
import { SchemaError } from './schema.js';
import crypto from 'node:crypto';

/**
 * Import a native engine's saved output file as a motion asset.
 * @param {string} root - workspace root
 * @param {string} nativePath - absolute path to the native saved file (SVG/PNG/HTML)
 * @param {string} engine - 'vector' | 'photo' | 'deck'
 * @param {string} sourceId - native source ID (uint64 string contract)
 * @param {string} revision - native source revision
 */
export function importNativeAsset(root, nativePath, engine, sourceId, revision) {
	if (!fs.existsSync(nativePath)) throw new SchemaError('E_NATIVE_MISSING', 'native file not found: ' + nativePath, 404);
	const ext = path.extname(nativePath).slice(1).toLowerCase();
	const kind = { svg: 'image', png: 'image', jpg: 'image', html: 'image' }[ext];
	if (!kind) throw new SchemaError('E_NATIVE_EXT', 'unsupported native extension: ' + ext);
	const bytes = fs.readFileSync(nativePath);
	const name = path.basename(nativePath);
	const asset = saveAsset(root, {
		name, kind, bytes,
		license: 'native-import',
		source: { engine, sourceId, revision, originalPath: nativePath, importedAt: new Date().toISOString() }
	});
	return { ...asset, nativeSource: { engine, sourceId, revision, originalSha256: crypto.createHash('sha256').update(bytes).digest('hex') } };
}


