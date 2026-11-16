/**
 * Motion schema — single authority for project/revision/asset/operation/reference
 * validation. All other motion paths import from here; no second source of truth.
 *
 * Contracts (EXECUTION_PLAN §6, MV1-01):
 *   - projectId: "motion-<uuid>"
 *   - revision: sha256 of the canonical manifest (64 hex)
 *   - render fps: {num,den} rational; first version only 24/25/30 with den=1
 *   - durationFrames: positive integer
 *   - authoringFormat: "hyperframes-html"
 *   - sources: relative paths, no traversal, no absolute, budgeted
 *   - time ranges: [startFrame, endFrame), integers, end <= durationFrames
 */
import path from 'node:path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;
const OPERATION_KEY_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const FPS_WHITELIST = new Set([24, 25, 30]);
const MAX_WIDTH = 1920, MAX_HEIGHT = 1920, MAX_PIXELS = 2073600;
const MAX_DURATION_FRAMES = 180 * 60; // 180s at 60fps ceiling; actual fps capped to 30
const MAX_SOURCE_FILES = 512;
const MAX_SOURCE_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCES_TOTAL_BYTES = 8 * 1024 * 1024;

export class SchemaError extends Error {
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

const fail = (code, msg) => { throw new SchemaError(code, msg); };
const isStr = (v) => typeof v === 'string';
const isInt = (v) => Number.isInteger(v);

/** Safe relative path inside a project: no traversal, no absolute, no drive, posix form. */
export function safeRelativePath(raw, { allowSubdirs = true } = {}) {
	if (!isStr(raw)) fail('E_PATH_TYPE', 'path must be a string');
	if (raw.length === 0 || raw.length > 256) fail('E_PATH_LEN', 'path length 1..256');
	if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/')) fail('E_PATH_ABS', 'absolute path refused');
	if (raw.includes('\\')) fail('E_PATH_SEP', 'use posix separators');
	const parts = raw.split('/');
	if (!allowSubdirs && parts.length !== 1) fail('E_PATH_SUBDIR', 'subdirectories not allowed here');
	for (const part of parts) {
		if (part === '' || part === '.' || part === '..') fail('E_PATH_TRAVERSAL', 'path traversal refused');
		if (/^[ .]+$/i.test(part) || /[\0:*"<>|]/.test(part)) fail('E_PATH_CHAR', 'illegal path segment');
	}
	if (/\.(exe|bat|cmd|ps1|sh|dll|so|msi|scr|com|vbs|js\.node)$/i.test(raw)) fail('E_PATH_EXEC', 'executable extension refused');
	return raw;
}

export function validateProjectId(id) {
	if (!isStr(id) || !id.startsWith('motion-')) fail('E_PROJECT_ID', 'projectId must be motion-<uuid>');
	if (!UUID_RE.test(id.slice('motion-'.length))) fail('E_PROJECT_ID', 'projectId uuid malformed');
	return id;
}

export function validateRevision(rev) {
	if (!isStr(rev) || !SHA256_RE.test(rev)) fail('E_REVISION', 'revision must be a 64-hex sha256');
	return rev;
}

export function validateOperationKey(key) {
	if (!isStr(key) || !OPERATION_KEY_RE.test(key)) fail('E_OP_KEY', 'operationKey must be 1..128 of [a-zA-Z0-9._-], leading alnum');
	return key;
}

export function validateRender(render) {
	if (!render || typeof render !== 'object') fail('E_RENDER', 'render required');
	const { fps, durationFrames, width, height } = render;
	if (!fps || typeof fps !== 'object' || !isInt(fps.num) || !isInt(fps.den)) fail('E_FPS_SHAPE', 'fps must be {num,den} integers');
	if (fps.den !== 1) fail('E_FPS_DEN', 'first version restricts fps.den to 1');
	if (!FPS_WHITELIST.has(fps.num)) fail('E_FPS_VALUE', 'fps must be 24/25/30 in first version');
	if (!isInt(durationFrames) || durationFrames <= 0 || durationFrames > MAX_DURATION_FRAMES) fail('E_FRAMES', 'durationFrames must be 1..' + MAX_DURATION_FRAMES);
	if (!isInt(width) || !isInt(height) || width <= 0 || height <= 0) fail('E_SIZE', 'width/height positive integers required');
	if (width > MAX_WIDTH || height > MAX_HEIGHT) fail('E_SIZE_MAX', `max edge is ${MAX_WIDTH}`);
	if (width * height > MAX_PIXELS) fail('E_PIXELS_MAX', 'max area is ' + MAX_PIXELS);
	return {
		fps: { num: fps.num, den: fps.den },
		durationFrames,
		width, height,
		background: isStr(render.background) ? render.background : undefined
	};
}

/** Validate the sources map of a revision: { "relative/path": {bytes, sha256, encoding} } */
export function validateSources(sources, { rootKind = 'sources' } = {}) {
	if (!sources || typeof sources !== 'object' || Array.isArray(sources)) fail('E_SOURCES', rootKind + ' must be an object');
	const keys = Object.keys(sources);
	if (keys.length === 0) fail('E_SOURCES_EMPTY', 'at least one source file required (entry)');
	if (keys.length > MAX_SOURCE_FILES) fail('E_SOURCES_COUNT', 'max ' + MAX_SOURCE_FILES + ' files');
	let total = 0;
	const out = {};
	for (const rel of keys) {
		safeRelativePath(rel);
		const entry = sources[rel];
		if (!entry || typeof entry !== 'object') fail('E_SOURCE_ENTRY', 'source entry must be an object: ' + rel);
		if (!isInt(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_SOURCE_FILE_BYTES) fail('E_SOURCE_BYTES', 'file bytes 0..' + MAX_SOURCE_FILE_BYTES + ': ' + rel);
		total += entry.bytes;
		if (total > MAX_SOURCES_TOTAL_BYTES) fail('E_SOURCES_TOTAL', 'total text budget ' + MAX_SOURCES_TOTAL_BYTES + ' exceeded');
		if (!isStr(entry.sha256) || !SHA256_RE.test(entry.sha256)) fail('E_SOURCE_SHA', 'source sha256 required: ' + rel);
		if (entry.encoding !== undefined && entry.encoding !== 'utf8' && entry.encoding !== 'binary') fail('E_SOURCE_ENCODING', 'encoding must be utf8|binary');
		out[rel] = { bytes: entry.bytes, sha256: entry.sha256, encoding: entry.encoding || 'utf8' };
	}
	return out;
}

/** Time range: [startFrame, endFrame) within the revision. */
export function validateTimeRange(range, render) {
	if (!range || typeof range !== 'object') fail('E_RANGE', 'time range required');
	const { startFrame, endFrame } = range;
	if (!isInt(startFrame) || !isInt(endFrame)) fail('E_RANGE_INT', 'frame indices must be integers');
	if (startFrame < 0 || endFrame <= startFrame) fail('E_RANGE_ORDER', 'need 0 <= startFrame < endFrame');
	if (render && endFrame > render.durationFrames) fail('E_RANGE_END', 'endFrame beyond durationFrames');
	return { startFrame, endFrame };
}

/** HfId set for a selection reference: unique non-empty strings. */
export function validateHfIdSet(ids) {
	if (!Array.isArray(ids) || ids.length === 0) fail('E_SEL_EMPTY', 'selection needs at least one HfId');
	if (ids.length > 256) fail('E_SEL_MAX', 'max 256 selected elements');
	const seen = new Set();
	for (const id of ids) {
		if (!isStr(id) || id.length === 0 || id.length > 128) fail('E_SEL_ID', 'HfId malformed');
		if (seen.has(id)) fail('E_SEL_DUP', 'duplicate HfId in selection');
		seen.add(id);
	}
	return ids;
}

/** Full revision manifest validation (canonical form). Mutates nothing; returns normalized copy.
 *  opts.requireRevision: when false (store commit-time), manifest.revision may be absent
 *  (it is being computed); when true (read-time), it must be a valid sha256. */
export function validateRevisionManifest(manifest, opts = {}) {
	const requireRevision = opts.requireRevision !== false;
	if (!manifest || typeof manifest !== 'object') fail('E_MANIFEST', 'manifest required');
	if (manifest.schemaVersion !== 1) fail('E_SCHEMA_VERSION', 'schemaVersion must be 1');
	validateProjectId(manifest.projectId);
	if (requireRevision) validateRevision(manifest.revision);
	else if (manifest.revision !== undefined) validateRevision(manifest.revision);
	if (manifest.authoringFormat !== 'hyperframes-html') fail('E_FORMAT', 'authoringFormat must be hyperframes-html');
	if (!isStr(manifest.entryFile)) fail('E_ENTRY', 'entryFile required');
	safeRelativePath(manifest.entryFile);
	if (manifest.parentRevision !== null && manifest.parentRevision !== undefined) validateRevision(manifest.parentRevision);
	if (!isStr(manifest.title) || manifest.title.length > 200) fail('E_TITLE', 'title 1..200 chars');
	const render = validateRender(manifest.render);
	const sources = validateSources(manifest.sources);
	const entry = sources[manifest.entryFile];
	if (!entry) fail('E_ENTRY_MISSING', 'entryFile must exist in sources');
	return {
		schemaVersion: 1,
		projectId: manifest.projectId,
		revision: manifest.revision || null,
		parentRevision: manifest.parentRevision ?? null,
		title: manifest.title,
		authoringFormat: 'hyperframes-html',
		entryFile: manifest.entryFile,
		render,
		sources,
		parameters: Array.isArray(manifest.parameters) ? manifest.parameters : [],
		assets: Array.isArray(manifest.assets) ? manifest.assets : [],
		createdAt: manifest.createdAt || null
	};
}

/** Compute canonical revision sha256 from a normalized manifest (revisions field excluded). */
export function canonicalRevisionSha(manifest) {
	const normalized = validateRevisionManifest(manifest, { requireRevision: false });
	const canonical = {
		schemaVersion: 1, projectId: normalized.projectId, parentRevision: normalized.parentRevision,
		title: normalized.title, authoringFormat: normalized.authoringFormat, entryFile: normalized.entryFile,
		render: normalized.render, sources: normalized.sources,
		parameters: normalized.parameters, assets: normalized.assets
	};
	return cryptoSha256(JSON.stringify(canonical));
}
import crypto from 'node:crypto';
function cryptoSha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

export const BUDGETS = Object.freeze({
	MAX_WIDTH, MAX_HEIGHT, MAX_PIXELS, MAX_DURATION_FRAMES,
	MAX_SOURCE_FILES, MAX_SOURCE_FILE_BYTES, MAX_SOURCES_TOTAL_BYTES,
	MAX_ASSET_SINGLE_BYTES: 256 * 1024 * 1024,
	MAX_ASSETS_TOTAL_BYTES: 1024 * 1024 * 1024,
	MAX_RENDER_MINUTES: 20,
	MAX_TEMP_GIB: 8,
	MAX_CONCURRENT_RENDERS_PER_INSTANCE: 1,
	EDIT_COMPUTE_SECONDS: 30,
	PREVIEW_READY_SECONDS: 30
});

export const FFPS = { num: 30, den: 1 };
export const pathJoin = path.posix.join;
