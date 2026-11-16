/**
 * Motion project store — immutable revisions + content-addressed blobs + atomic head CAS.
 * Layout: <projectDir>/design/.designcraft/motion/projects/<projectId>/
 *   head.json                  {revision, updatedAt}
 *   revisions/<revision>.json  normalized manifest (immutable once written)
 *   blobs/<sha256>             source file bytes (content-addressed)
 *
 * Contracts (MV1-02):
 *   - write full revision BEFORE updating head (crash between = orphan, head intact)
 *   - head CAS: update only from the exact base revision the caller saw
 *   - restore never rewrites history: it creates a NEW revision with parent = old head
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateProjectId, validateRevision, validateRevisionManifest, canonicalRevisionSha, SchemaError, safeRelativePath, validateSources } from './schema.js';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export class StoreError extends Error {
	constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}

function projectsRoot(root) { return path.join(root, 'design', '.designcraft', 'motion', 'projects'); }
function projectDir(root, projectId) { return path.join(projectsRoot(root), projectId); }
function headPath(root, projectId) { return path.join(projectDir(root, projectId), 'head.json'); }
function revisionPath(root, projectId, revision) { return path.join(projectDir(root, projectId), 'revisions', revision + '.json'); }
function blobPath(root, projectId, sha) { return path.join(projectDir(root, projectId), 'blobs', sha); }

function atomicWrite(file, data) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = path.join(path.dirname(file), '.tmp-' + crypto.randomBytes(6).toString('hex'));
	fs.writeFileSync(tmp, data);
	fs.renameSync(tmp, file);
}

function readHead(root, projectId) {
	const hp = headPath(root, projectId);
	if (!fs.existsSync(hp)) return null;
	return JSON.parse(fs.readFileSync(hp, 'utf8'));
}

export function listProjects(root) {
	const base = projectsRoot(root);
	if (!fs.existsSync(base)) return [];
	return fs.readdirSync(base)
		.filter(name => name.startsWith('motion-'))
		.map(name => {
			const head = readHead(root, name);
			if (!head) return null;
			const revPath = revisionPath(root, name, head.revision);
			if (!fs.existsSync(revPath)) return null;
			const manifest = JSON.parse(fs.readFileSync(revPath, 'utf8'));
			return { projectId: name, revision: head.revision, title: manifest.title, updatedAt: head.updatedAt };
		})
		.filter(Boolean)
		.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

export function readHeadRevision(root, projectId) {
	validateProjectId(projectId);
	const head = readHead(root, projectId);
	if (!head) throw new StoreError('E_NO_PROJECT', 'project not found: ' + projectId, 404);
	return head;
}

export function readRevision(root, projectId, revision) {
	validateProjectId(projectId);
	validateRevision(revision);
	const file = revisionPath(root, projectId, revision);
	if (!fs.existsSync(file)) throw new StoreError('E_NO_REVISION', 'revision not found: ' + revision, 404);
	return validateRevisionManifest(JSON.parse(fs.readFileSync(file, 'utf8')), { requireRevision: true });
}

/** Read a source file's bytes by its content address (must be in the revision's sources). */
export function readSourceBytes(root, projectId, manifest, relPath) {
	safeRelativePath(relPath);
	const entry = manifest.sources[relPath];
	if (!entry) throw new StoreError('E_NO_SOURCE', 'source not in revision: ' + relPath, 404);
	const file = blobPath(root, projectId, entry.sha256);
	if (!fs.existsSync(file)) throw new StoreError('E_NO_BLOB', 'blob missing (store corruption): ' + entry.sha256, 500);
	const bytes = fs.readFileSync(file);
	if (sha256(bytes) !== entry.sha256) throw new StoreError('E_BLOB_CORRUPT', 'blob hash mismatch: ' + relPath, 500);
	return bytes;
}

export function readRevisionSources(root, projectId, manifest) {
	const out = {};
	for (const rel of Object.keys(manifest.sources)) out[rel] = readSourceBytes(root, projectId, manifest, rel).toString(manifest.sources[rel].encoding === 'binary' ? 'base64' : 'utf8');
	return out;
}

/**
 * Commit a new revision. Caller supplies the full manifest WITH sources (bytes map),
 * plus expectedBaseRevision (head CAS). Returns the normalized manifest with its revision sha.
 */
export function commitRevision(root, projectId, { baseRevision, title, entryFile, render, sources, parameters, assets, parentRevision }) {
	validateProjectId(projectId);
	const head = readHead(root, projectId);
	if (!head && baseRevision) throw new StoreError('E_BASE_MISMATCH', 'project has no head but a base was supplied', 409);
	if (head && !baseRevision) throw new StoreError('E_BASE_MISMATCH', 'baseRevision required (project has a head)', 409);
	if (head && head.revision !== baseRevision) {
		throw new StoreError('E_BASE_MISMATCH', 'head moved: expected ' + (baseRevision || 'null').slice(0, 12) + ' but head is ' + head.revision.slice(0, 12), 409);
	}

	// stage blobs first (content-addressed, idempotent)
	for (const [rel, body] of Object.entries(sources)) {
		safeRelativePath(rel);
		const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
		const dir = path.dirname(blobPath(root, projectId, sha256(buf)));
		fs.mkdirSync(dir, { recursive: true });
		const target = blobPath(root, projectId, sha256(buf));
		if (!fs.existsSync(target)) atomicWrite(target, buf);
	}

	// build manifest, compute canonical revision sha
	const candidate = {
		schemaVersion: 1, projectId, parentRevision: head ? head.revision : null,
		title, authoringFormat: 'hyperframes-html', entryFile, render,
		sources: {}, parameters: parameters || [], assets: assets || [],
		createdAt: new Date().toISOString()
	};
	for (const [rel, body] of Object.entries(sources)) {
		const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
		candidate.sources[rel] = { bytes: buf.length, sha256: sha256(buf), encoding: Buffer.isBuffer(body) ? 'binary' : 'utf8' };
	}
	const revision = canonicalRevisionSha(candidate);
	candidate.revision = revision;
	const normalized = validateRevisionManifest(candidate);

	// write revision BEFORE head (crash = orphan revision, head intact)
	revPathExistsGuard(root, projectId, revision);
	const revFile = revisionPath(root, projectId, revision);
	if (!fs.existsSync(revFile)) atomicWrite(revFile, JSON.stringify(normalized, null, 1));

	// head CAS: compare-and-swap on the previous revision
	const hp = headPath(root, projectId);
	const current = readHead(root, projectId);
	const currentRev = current ? current.revision : null;
	const expectedRev = baseRevision || null;
	if (currentRev !== expectedRev) throw new StoreError('E_BASE_MISMATCH', 'head CAS failed (concurrent write)', 409);
	atomicWrite(hp, JSON.stringify({ revision, updatedAt: new Date().toISOString() }));
	return normalized;
}

function revPathExistsGuard(root, projectId, revision) {
	// identical revision content under the same projectId = idempotent re-commit, allowed
}

/** List all revisions of a project (history view). */
export function listRevisions(root, projectId) {
	validateProjectId(projectId);
	const dir = path.join(projectDir(root, projectId), 'revisions');
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
		const manifest = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
		return { revision: manifest.revision, parentRevision: manifest.parentRevision, title: manifest.title, createdAt: manifest.createdAt, entryFile: manifest.entryFile };
	}).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
}

/** Restore an old revision as a NEW revision (never rewrites history). */
export function restoreRevision(root, projectId, { revision: oldRevision, baseRevision }) {
	validateRevision(oldRevision);
	const old = readRevision(root, projectId, oldRevision);
	const head = readHead(root, projectId);
	if (!head || head.revision !== baseRevision) throw new StoreError('E_BASE_MISMATCH', 'restore base mismatch: head is ' + (head ? head.revision.slice(0, 12) : 'null'), 409);
	const sources = {};
	for (const [rel, entry] of Object.entries(old.sources)) {
		const bytes = readSourceBytes(root, projectId, old, rel);
		sources[rel] = entry.encoding === 'binary' ? bytes : bytes.toString('utf8');
	}
	return commitRevision(root, projectId, {
		baseRevision, title: old.title + ' (restored ' + oldRevision.slice(0, 8) + ')',
		entryFile: old.entryFile, render: old.render, sources,
		parameters: old.parameters, assets: old.assets
	});
}
