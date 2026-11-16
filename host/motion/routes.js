/**
 * Motion routes — /designcraft/api/v1/motion/*
 * Read actions return actual state; write actions require lease + base + operationKey.
 * Auth: sameOrigin fence (checked by the route caller); sessionId comes from execution.agent.session.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
	validateProjectId, validateRevision, validateOperationKey, validateRender,
	validateSources, validateHfIdSet, SchemaError
} from './schema.js';
import {
	listProjects, readHeadRevision, readRevision, readRevisionSources, readSourceBytes,
	commitRevision, listRevisions, restoreRevision
} from './project-store.js';
import { exportDcmotion, importDcmotion } from './package.js';
import { mintLease, validateLease, revokeLease, revokeProjectLeases, admitWrite, updateLeaseSelection } from './sessions.js';
import { withOperation, getOperation } from './operations.js';
import { compositionTemplate } from './composition-template.js';
import { templateSources } from './templates.js';

function sendJson(res, status, payload) {
	if (res.destroyed || res.writableEnded) return;
	res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
	res.end(JSON.stringify(payload));
}

function safeRoot(rootStr) {
	const resolved = path.resolve(rootStr || '');
	if (!fs.existsSync(resolved)) throw new SchemaError('E_ROOT', 'workspace not found: ' + rootStr, 400);
	return resolved;
}

export function motionHandleAction(sub, method, body, url, services) {
	return handle(sub, method, body, url, services);
}

export function motionRoutes(services) {
	return [
		{
			// 前缀注册不能带尾斜杠：DSH webserver 的 prefix 匹配是
			// pathname.startsWith(prefix + '/')，带尾斜杠会要求双斜杠才命中，
			// 路由永远匹配不上（请求落到 fallback，POST 收到 405）。
			kind: 'prefix', path: '/designcraft/api/v1/motion',
			handler: async (req, res) => {
				const url = new URL(req.url, 'http://localhost');
				const sub = url.pathname.slice('/designcraft/api/v1/motion/'.length);
				let body = {};
				if (req.method === 'POST') {
					body = await new Promise((resolve, reject) => {
						let d = '';
						req.on('data', c => { d += c; if (d.length > 8 * 1024 * 1024) { reject(Object.assign(new Error('body too large'), { status: 413 })); req.destroy(); } });
						req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(new Error('invalid JSON')); } });
						req.on('error', reject);
					});
				}
				try {
					const result = await handle(sub, req.method, body, url, services, res);
					if (result !== undefined) sendJson(res, 200, { ok: true, ...(result || {}) });
				} catch (e) {
					const status = e.status || (e.code ? 409 : 500);
					sendJson(res, status, { ok: false, error: e.code ? e.code + ': ' + e.message : String(e?.message || e) });
				}
			}
		}
	];
}

async function handle(sub, method, body, url, services, res) {
	const root = safeRoot(url.searchParams.get('root') || body.root);
	const sessionId = services?.execution?.agent?.session || body.sessionId || null;

	// -- reads --
	if (sub === 'list_projects') sub = 'projects';
	if (method === 'GET') {
		if (sub === 'projects') return { projects: listProjects(root) };
		if (sub === 'templates') {
			const { listTemplates } = await import('./templates.js');
			return { templates: listTemplates() };
		}
		if (sub === 'revisions') {
			const projectId = validateProjectId(url.searchParams.get('projectId'));
			return { revisions: listRevisions(root, projectId) };
		}
		if (sub === 'project') {
			const projectId = validateProjectId(url.searchParams.get('projectId'));
			const head = readHeadRevision(root, projectId);
			const manifest = readRevision(root, projectId, head.revision);
			const sources = readRevisionSources(root, projectId, manifest);
			return { manifest, sources, sessionId };
		}
		if (sub === 'operation') {
			return getOperation(root, url.searchParams.get('operationKey'));
		}
		if (sub === 'preview' || sub.startsWith('preview/')) {
			// Path-style serving (preview/<file>) so composition-relative assets
			// (fonts.css, fonts/*, assets/*) resolve against the preview directory.
			// Serve a revision source file for the preview iframe / worker parity.
			// HTML compositions lacking the frame runtime get it injected server-side
			// (same pattern as open-design's injectMotionSourcePlayer), so vendor
			// templates and AI-authored sources both play in the live preview.
			if (!res) throw new SchemaError('E_HTTP', 'preview requires the HTTP transport', 400);
			const projectId = validateProjectId(url.searchParams.get('projectId'));
			const revision = validateRevision(url.searchParams.get('revision'));
			const rel = sub.startsWith('preview/') ? decodeURIComponent(sub.slice('preview/'.length)) : String(url.searchParams.get('file') || '');
			const manifest = readRevision(root, projectId, revision);
			if (!manifest.sources[rel]) throw new SchemaError('E_SOURCE', 'file not in revision sources: ' + rel, 404);
			let bytes = readSourceBytes(root, projectId, manifest, rel);
			const ext = path.extname(rel).toLowerCase();
			if (ext === '.html') {
				const { injectFrameRuntime } = await import('./frame-runtime.js');
				const injected = injectFrameRuntime(bytes.toString('utf8'));
				if (injected !== bytes.toString('utf8')) bytes = Buffer.from(injected, 'utf8');
			}
			const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.m4a': 'audio/mp4' };
			res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
			res.end(bytes);
			return undefined;
		}
		if (sub === 'artifact') {
			const projectId = validateProjectId(url.searchParams.get('projectId'));
			const operationKey = validateOperationKey(url.searchParams.get('operationKey'));
			const mp4 = path.join(root, 'design', '.designcraft', 'motion', 'artifacts', operationKey, 'video.mp4');
			if (!fs.existsSync(mp4)) throw new SchemaError('E_NO_ARTIFACT', '产物不存在', 404);
			res.writeHead(200, { 'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="motion.mp4"', 'cache-control': 'no-store' });
			res.end(fs.readFileSync(mp4));
			return undefined;
		}
	}

	// -- writes --
	if (method !== 'POST') throw new SchemaError('E_METHOD', 'POST required for write actions', 405);

	switch (sub) {
		case 'reference': {
			// Measure a user's reference video into facts + frames + soundtrack
			// (ported from open-design motion-reference). video must live under root.
			const video = String(body.video || '');
			const resolved = path.resolve(root, video);
			if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) throw new SchemaError('E_PATH', 'video must be inside the workspace root', 400);
			const { measureReference } = await import('./reference-measure.js');
			const { resolveFfmpegDir } = await import('./render-supervisor.js');
			const ffmpegPath = path.join(resolveFfmpegDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
			const id = 'ref-' + crypto.createHash('sha1').update(resolved).digest('hex').slice(0, 10);
			const outDir = path.join(root, 'design', '.designcraft', 'motion', 'references', id);
			const result = measureReference(ffmpegPath, resolved, outDir);
			const rel = (p) => p ? path.relative(root, p).split(path.sep).join('/') : null;
			return {
				referenceId: id,
				facts: result.facts,
				factsPath: rel(path.join(outDir, 'facts.md')),
				frames: result.files.frames.map((f) => ({ at: f.at, path: rel(f.path) })),
				contactSheet: rel(result.files.contactSheet),
				audio: rel(result.files.audio)
			};
		}
		case 'templates': {
			// POST alias so the designcraft_motion tool can list templates too.
			const { listTemplates } = await import('./templates.js');
			return { templates: listTemplates() };
		}
		case 'create_from_template': {
			const { templateId, title } = body;
			if (!sessionId || typeof sessionId !== 'string') throw new SchemaError('E_SESSION', 'dedicated design session required for motion create');
			if (!templateId || typeof templateId !== 'string') throw new SchemaError('E_TEMPLATE', 'templateId required');
			return withOperation(root, body.operationKey, { op: 'create_from_template', templateId, title }, () => {
				const tpl = templateSources(templateId);
				const projectId = 'motion-' + crypto.randomUUID();
				const manifest = commitRevision(root, projectId, {
					baseRevision: null, title: title || tpl.title, entryFile: tpl.entryFile, render: tpl.render,
					sources: tpl.sources
				});
				const lease = mintLease({ projectId, sessionId, baseRevision: manifest.revision, viewEpoch: crypto.randomBytes(8).toString('hex') });
				return { projectId, revision: manifest.revision, leaseId: lease.leaseId, viewEpoch: lease.viewEpoch, sessionId, template: templateId, title: title || tpl.title, render: tpl.render, entryFile: tpl.entryFile };
			}).then(op => op.receipt);
		}
		case 'create': {
			const { title, render } = body;
			if (!sessionId || typeof sessionId !== 'string') throw new SchemaError('E_SESSION', 'dedicated design session required for motion create');
			if (!title || typeof title !== 'string') throw new SchemaError('E_TITLE', 'title required');
			validateRender(render);
			return withOperation(root, body.operationKey, { op: 'create', title, render }, () => {
				const projectId = 'motion-' + crypto.randomUUID();
				const manifest = commitRevision(root, projectId, {
					baseRevision: null, title, entryFile: 'composition.html', render,
					sources: compositionTemplate(render)
				});
				const lease = mintLease({ projectId, sessionId, baseRevision: manifest.revision, viewEpoch: crypto.randomBytes(8).toString('hex') });
				return { projectId, revision: manifest.revision, leaseId: lease.leaseId, viewEpoch: lease.viewEpoch, sessionId };
			}).then(op => op.receipt);
		}
		case 'open': {
			const projectId = validateProjectId(body.projectId);
			const head = readHeadRevision(root, projectId);
			const lease = mintLease({ projectId, sessionId, baseRevision: head.revision, viewEpoch: crypto.randomBytes(8).toString('hex') });
			return { projectId, revision: head.revision, leaseId: lease.leaseId, viewEpoch: lease.viewEpoch, sessionId };
		}
		case 'write_sources': {
			const { projectId, baseRevision, leaseId, viewEpoch, operationKey, sources, message } = body;
			admitWrite({ leaseId, sessionId, projectId, baseRevision, viewEpoch });
			validateOperationKey(operationKey);
			// convert {path: stringContent} to {path: {bytes, sha256}} for validation
			const normalizedSources = {};
			for (const [rel, content] of Object.entries(sources)) {
				const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
				normalizedSources[rel] = { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
			}
			validateSources(normalizedSources);
			return withOperation(root, operationKey, { op: 'write_sources', projectId, baseRevision, sources: Object.keys(sources) }, () => {
				// read current sources, apply patch, commit
				const head = readHeadRevision(root, projectId);
				const current = readRevision(root, projectId, head.revision);
				const currentSources = readRevisionSources(root, projectId, current);
				const merged = { ...currentSources };
				for (const [rel, content] of Object.entries(sources)) {
					if (typeof content !== 'string' && !Buffer.isBuffer(content)) throw new SchemaError('E_SOURCE_CONTENT', 'source content must be string/buffer: ' + rel);
					merged[rel] = content;
				}
				const manifest = commitRevision(root, projectId, {
					baseRevision, title: current.title, entryFile: current.entryFile,
					render: current.render, sources: merged, parameters: current.parameters, assets: current.assets
				});
				return { projectId, revision: manifest.revision, sourcePersisted: true, sourcesWritten: Object.keys(sources) };
			}).then(op => op.receipt);
		}
		case 'update_selection': {
			const { leaseId, baseRevision, hfIds, timeRange } = body;
			const lease = updateLeaseSelection(leaseId, { hfIds, timeRange, baseRevision });
			return { selectionStamp: lease.selectionStamp, timeRange: lease.timeRange };
		}
		case 'close': {
			const { projectId, leaseId } = body;
			if (leaseId) revokeLease(leaseId);
			else if (projectId) revokeProjectLeases(projectId);
			return { closed: true };
		}
		case 'restore': {
			const { projectId, baseRevision, revision: oldRevision } = body;
			validateProjectId(projectId);
			return withOperation(root, body.operationKey, { op: 'restore', projectId, baseRevision, oldRevision }, () => {
				const manifest = restoreRevision(root, projectId, { revision: oldRevision, baseRevision });
				return { projectId, revision: manifest.revision, sourcePersisted: true };
			}).then(op => op.receipt);
		}
		case 'export_project': {
			const projectId = validateProjectId(body.projectId);
			return withOperation(root, body.operationKey, { op: 'export_project', projectId }, () => {
				const { buffer, fileCount } = exportDcmotion(root, projectId);
				return { fileCount, bytes: buffer.length, dataBase64: buffer.toString('base64') };
			}).then(op => op.receipt);
		}
		case 'import_project': {
			return withOperation(root, body.operationKey, { op: 'import_project' }, () => {
				const buf = Buffer.from(body.dataBase64, 'base64');
				return importDcmotion(root, buf);
			}).then(op => op.receipt);
		}
		case 'close_lease': {
			const { projectId } = body;
			revokeProjectLeases(projectId);
			return { closed: true };
		}
		case 'render': {
			const { projectId, baseRevision, leaseId, viewEpoch, operationKey } = body;
			validateProjectId(projectId);
			admitWrite({ leaseId, sessionId, projectId, baseRevision, viewEpoch });
			validateOperationKey(operationKey);
			return withOperation(root, operationKey, { op: 'render', projectId, baseRevision }, async () => {
				const manifest = readRevision(root, projectId, baseRevision);
				const render = manifest.render;
				const artifactDir = path.join(root, 'design', '.designcraft', 'motion', 'artifacts', operationKey);
				const outputPath = path.join(artifactDir, 'video.mp4');
				fs.mkdirSync(artifactDir, { recursive: true });
				// Materialize the revision's sources (content-addressed blobs) into a
				// real directory the worker can load from disk.
				const srcDir = path.join(artifactDir, 'src');
				fs.rmSync(srcDir, { recursive: true, force: true });
				fs.mkdirSync(srcDir, { recursive: true });
				const sources = readRevisionSources(root, projectId, manifest);
				for (const [rel, content] of Object.entries(sources)) {
					const dest = path.join(srcDir, rel);
					fs.mkdirSync(path.dirname(dest), { recursive: true });
					fs.writeFileSync(dest, Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'));
				}
				const { startRender } = await import('./render-supervisor.js');
				const workerEntry = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../motion-worker/entry.mjs');
				const { jobId } = startRender(workerEntry, srcDir, outputPath, {
					fps: render.fps, quality: 'draft', width: render.width, height: render.height,
					entryFile: manifest.entryFile, timeoutMs: 20 * 60 * 1000,
					verify: { durationFrames: render.durationFrames, width: render.width, height: render.height, fps: render.fps }
				});
				return { jobId, status: 'rendering', outputPath };
			}).then(op => op.receipt);
		}
		case 'render_status': {
			const { getRenderStatus } = await import('./render-supervisor.js');
			const st = getRenderStatus(String(body.jobId || ''));
			if (!st) return { jobId: body.jobId || null, status: 'not-found' };
			return {
				jobId: st.jobId, status: st.status, progress: st.progress || 0,
				outputPath: st.outputPath || null, error: st.error || null,
				receipt: st.receipt || null
			};
		}
		case 'cancel_render': {
			const { cancelRender } = await import('./render-supervisor.js');
			return { cancelled: cancelRender(String(body.jobId || '')) };
		}
		case 'verify_artifact': {
			const { projectId, baseRevision, operationKey } = body;
			validateProjectId(projectId);
			validateOperationKey(operationKey);
			const manifest = readRevision(root, projectId, baseRevision);
			const outputPath = path.join(root, 'design', '.designcraft', 'motion', 'artifacts', operationKey, 'video.mp4');
			if (!fs.existsSync(outputPath)) throw new SchemaError('E_NO_ARTIFACT', '产物不存在: ' + outputPath, 404);
			const { verifyArtifact, resolveFfmpegDir } = await import('./render-supervisor.js');
			const ffprobePath = path.join(resolveFfmpegDir(), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
			const result = verifyArtifact(ffprobePath, outputPath, manifest.render.durationFrames, manifest.render.width, manifest.render.height, manifest.render.fps);
			return { artifactValidated: true, ...result };
		}
		default:
			throw new SchemaError('E_ACTION', 'unknown motion action: ' + sub, 400);
	}
}

