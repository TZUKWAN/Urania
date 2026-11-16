/**
 * Source patch constraints — base SHA verification, path whitelist, budget enforcement.
 * Used by write_sources and apply_ops to ensure source integrity.
 */
import crypto from 'node:crypto';
import { SchemaError, safeRelativePath, validateSources } from './schema.js';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** Verify each patched file's base SHA against the current source. */
export function verifyBaseShas(currentSources, patches) {
	for (const [rel, patch] of Object.entries(patches)) {
		if (patch.baseSha === undefined) continue; // new file or full overwrite
		const current = currentSources[rel];
		if (!current) throw new SchemaError('E_BASE_NEW', 'base SHA supplied for non-existent file: ' + rel);
		const currentSha = current.sha256 || sha256(Buffer.from(current, 'utf8'));
		if (patch.baseSha !== currentSha) throw new SchemaError('E_BASE_SHA', 'base SHA mismatch for ' + rel + ': expected ' + patch.baseSha.slice(0, 12) + ' got ' + currentSha.slice(0, 12));
	}
}

/** Convert {path: stringContent} to validated {path: {bytes, sha256}} sources. */
export function normalizeSourceContent(sources) {
	const out = {};
	for (const [rel, content] of Object.entries(sources)) {
		safeRelativePath(rel);
		const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
		out[rel] = { bytes: buf.length, sha256: sha256(buf) };
	}
	return validateSources(out);
}
