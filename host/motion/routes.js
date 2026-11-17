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
import {workspacePath} from '../safety.js';
import {readAssetBytes} from './asset-store.js';
import {resolveProjectResource} from './resource-path.js';

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
function sourceContents(root,projectId,manifest){return Object.fromEntries(Object.entries(manifest.sources).map(([rel,entry])=>{const bytes=readSourceBytes(root,projectId,manifest,rel);return [rel,entry.encoding==='binary'?bytes:bytes.toString('utf8')];}));}

export function motionHandleAction(sub, method, body, url, services) {
	return handle(sub, method, body, url, services);
}

export function motionRoutes(services, {guard,resolveHttpScope}={}) {
	const admit=guard||(()=>(_req,res)=>sendJson(res,503,{ok:false,error:'DSH 身份验证服务尚未就绪'}));
	return [
		{
			// 前缀注册不能带尾斜杠：DSH webserver 的 prefix 匹配是
			// pathname.startsWith(prefix + '/')，带尾斜杠会要求双斜杠才命中，
			// 路由永远匹配不上（请求落到 fallback，POST 收到 405）。
			kind: 'prefix', path: '/designcraft/api/v1/motion',
			handler: admit(async (req, res) => {
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
					if(typeof resolveHttpScope!=='function')throw Object.assign(new Error('DSH 项目会话校验尚未就绪'),{status:503});
					const identity=await resolveHttpScope(req,body,url);
					const requestServices={...services,execution:{agent:{session:identity.sessionId}},resolveScope:()=>identity.root,
						parentOrigin:(req.socket?.encrypted?'https://':'http://')+req.headers.host};
					const result = await handle(sub, req.method, body, url, requestServices, res);
					if (result !== undefined) sendJson(res, 200, { ok: true, ...(result || {}) });
				} catch (e) {
					const status = e.status || (e.code ? 409 : 500);
					sendJson(res, status, { ok: false, error: e.code ? e.code + ': ' + e.message : String(e?.message || e) });
				}
			})
		}
	];
}

async function handle(sub, method, body, url, services, res) {
	const actor=services?.execution?.agent?.session;
	const sessionId=typeof actor==='string'?actor:actor?.id;
	if(!sessionId)throw new SchemaError('E_SESSION','当前项目设计会话尚未就绪');
	const requestedRoot=url.searchParams.get('root')||body.root;
	const root=safeRoot(services?.resolveScope?await services.resolveScope(sessionId,requestedRoot):requestedRoot);

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
			// Never execute generated HTML in the authenticated DSH origin.
			throw Object.assign(new SchemaError('E_PREVIEW_ORIGIN','动画预览已迁移到独立受限来源，请重新打开'),{status:410});

		}
		if (sub === 'artifact') {
			const projectId = validateProjectId(url.searchParams.get('projectId'));
			const operationKey = validateOperationKey(url.searchParams.get('operationKey'));
			const mp4 = path.join(root, 'design', '.designcraft', 'motion', 'artifacts', operationKey, 'video.mp4');
			if (!fs.existsSync(mp4)) throw new SchemaError('E_NO_ARTIFACT', '产物不存在', 404);
			res.writeHead(200, { 'content-type': 'video/mp4', 'content-disposition': 'attachment; filename="motion.mp4"', 'cache-control': 'no-store' });
			const stream=fs.createReadStream(mp4);res.once('close',()=>stream.destroy());stream.once('error',()=>res.destroy());stream.pipe(res);
			return undefined;
		}
	}

	// -- writes --
	if (method !== 'POST') throw new SchemaError('E_METHOD', 'POST required for write actions', 405);

	switch (sub) {
		case 'doctor': {
			const {checkMotionRuntime}=await import('./runtime-env.js');
			try{const report=checkMotionRuntime();return {available:true,versions:report.versions,requirements:report.requirements};}
			catch(error){return {available:false,component:error.component||'runtime',error:'动画导出环境尚未就绪：'+(error.component||'运行环境'),recovery:error.recovery||'请运行 motion-doctor 检查并安装缺失组件'};}
		}
		case 'read_source': {
			const projectId=validateProjectId(body.projectId),revision=body.revision||readHeadRevision(root,projectId).revision;
			const manifest=readRevision(root,projectId,validateRevision(revision));
			if(!body.file)return {projectId,revision,manifest};
			if(!manifest.sources[body.file])throw new SchemaError('E_SOURCE','文件不属于此修订');
			if(!/\.(?:html?|css|js|mjs|json|txt|svg|md)$/i.test(body.file))return {projectId,revision,file:body.file,binary:true,...manifest.sources[body.file]};
			const text=readSourceBytes(root,projectId,manifest,body.file).toString('utf8'),offset=body.offset??0,length=body.length??32000;
			if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>64000)throw new SchemaError('E_RANGE','源码读取范围无效');
			return {projectId,revision,file:body.file,content:text.slice(offset,offset+length),offset,totalCharacters:text.length,truncated:offset+length<text.length,sha256:manifest.sources[body.file].sha256};
		}
		case 'preview_session': {
			if(!services.previewHost||!services.parentOrigin)throw Object.assign(new Error('独立预览服务未就绪'),{status:503});
			const projectId=validateProjectId(body.projectId),revision=validateRevision(body.revision);
			validateLease(body.leaseId,{projectId,sessionId,root,baseRevision:revision,viewEpoch:body.viewEpoch});
			return services.previewHost.create({root,sessionId,projectId,revision,leaseId:body.leaseId,viewEpoch:body.viewEpoch,parentOrigin:services.parentOrigin});
		}
		case 'operation_status': return getOperation(root,body.operationKey);
		case 'reference': {
			// Measure a user's reference video into facts + frames + soundtrack
			// (ported from open-design motion-reference). video must live under root.
			const video = String(body.video || '');
			let resolved;try{resolved=resolveProjectResource(root,video);}catch(error){throw new SchemaError('E_PATH',error.message);}
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
				const lease = mintLease({ root,projectId, sessionId, baseRevision: manifest.revision, viewEpoch: crypto.randomBytes(8).toString('hex') });
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
				const lease = mintLease({ root,projectId, sessionId, baseRevision: manifest.revision, viewEpoch: crypto.randomBytes(8).toString('hex') });
				return { projectId, revision: manifest.revision, leaseId: lease.leaseId, viewEpoch: lease.viewEpoch, sessionId };
			}).then(op => op.receipt);
		}
		case 'open': {
			const projectId = validateProjectId(body.projectId);
			const head = readHeadRevision(root, projectId);
			const lease = mintLease({ root,projectId, sessionId, baseRevision: head.revision, viewEpoch: crypto.randomBytes(8).toString('hex') });
			return { projectId, revision: head.revision, leaseId: lease.leaseId, viewEpoch: lease.viewEpoch, sessionId };
		}
		case 'write_sources': {
			const { projectId, baseRevision, leaseId, viewEpoch, operationKey, sources, message } = body;
			admitWrite({ root,leaseId, sessionId, projectId, baseRevision, viewEpoch });
			validateOperationKey(operationKey);
			// convert {path: stringContent} to {path: {bytes, sha256}} for validation
			const normalizedSources = {};
			for (const [rel, content] of Object.entries(sources)) {
				const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
				normalizedSources[rel] = { bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
			}
			validateSources(normalizedSources);
			return withOperation(root, operationKey, { op: 'write_sources', projectId, baseRevision, sources: normalizedSources }, () => {
				// read current sources, apply patch, commit
				const head = readHeadRevision(root, projectId);
				const current = readRevision(root, projectId, head.revision);
				const currentSources = sourceContents(root,projectId,current);
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
		case 'import_native': {
			const {projectId,baseRevision,leaseId,viewEpoch,operationKey,assetId}=body;
			admitWrite({root,leaseId,sessionId,projectId,baseRevision,viewEpoch});validateOperationKey(operationKey);
			return withOperation(root,operationKey,{op:'import_native',projectId,baseRevision,assetId},async()=>{
				const {importSavedNativeAsset}=await import('./native-import.js'),asset=await importSavedNativeAsset(root,assetId),current=readRevision(root,projectId,baseRevision);
				const sources=sourceContents(root,projectId,current),assets=[...(current.assets||[])];
				const existing=assets.find(a=>a.path===asset.path);if(existing&&JSON.stringify(existing.nativeSource)!==JSON.stringify(asset.nativeSource))throw new SchemaError('E_NATIVE_IDENTITY','Existing media path refers to another native source');
				if(!existing)assets.push(asset);
				const manifest=commitRevision(root,projectId,{baseRevision,title:current.title,entryFile:current.entryFile,render:current.render,sources,parameters:current.parameters,assets});
				return {projectId,revision:manifest.revision,sourcePersisted:true,asset};
			}).then(op=>op.receipt);
		}
		case 'update_selection': {
			const { leaseId, baseRevision, hfIds, timeRange } = body;
			const lease = updateLeaseSelection(leaseId, { root,sessionId,hfIds, timeRange, baseRevision });
			return { selectionStamp: lease.selectionStamp, timeRange: lease.timeRange };
		}
		case 'close': {
			const { projectId, leaseId } = body;
			if (leaseId){validateLease(leaseId,{root,sessionId,projectId});revokeLease(leaseId);}
			else if (projectId) revokeProjectLeases(projectId,{root,sessionId});
			services.previewHost?.revoke(sessionId,{leaseId,projectId});
			return { closed: true };
		}
		case 'restore': {
			const { projectId, baseRevision, revision: oldRevision } = body;
			validateProjectId(projectId);
			admitWrite({root,sessionId,projectId,baseRevision,leaseId:body.leaseId,viewEpoch:body.viewEpoch});
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
			revokeProjectLeases(projectId,{root,sessionId});services.previewHost?.revoke(sessionId,{projectId});
			return { closed: true };
		}
		case 'render': {
			const { projectId, baseRevision, leaseId, viewEpoch, operationKey } = body;
			validateProjectId(projectId);
			admitWrite({ root,leaseId, sessionId, projectId, baseRevision, viewEpoch });
			validateOperationKey(operationKey);
			return withOperation(root, operationKey, { op: 'render', projectId, baseRevision }, async () => {
				const manifest = readRevision(root, projectId, baseRevision);
				const render = manifest.render;
				const artifactDir = workspacePath(root,path.join('design', '.designcraft', 'motion', 'artifacts', operationKey));
				const outputPath = path.join(artifactDir, 'video.mp4');
				fs.mkdirSync(artifactDir, { recursive: true });
				// Materialize the revision's sources (content-addressed blobs) into a
				// real directory the worker can load from disk.
				const srcDir = workspacePath(root,path.join(artifactDir, 'src'));
				fs.rmSync(srcDir, { recursive: true, force: true });
				fs.mkdirSync(srcDir, { recursive: true });
				const sources = Object.fromEntries(Object.keys(manifest.sources).map(rel=>[rel,readSourceBytes(root,projectId,manifest,rel)]));
				for (const [rel, content] of Object.entries(sources)) {
					const dest = path.join(srcDir, rel);
					fs.mkdirSync(path.dirname(dest), { recursive: true });
					fs.writeFileSync(dest, Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8'));
				}
				for(const asset of manifest.assets||[]){const rel=asset.path||asset.file||asset.name;if(sources[rel])continue;const destination=workspacePath(srcDir,rel),bytes=readAssetBytes(root,asset.sha256).bytes;fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,bytes);}
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
			if(!st.outputPath||!path.resolve(st.outputPath).startsWith(path.resolve(root,'design/.designcraft/motion/artifacts')+path.sep))throw new SchemaError('E_JOB_SCOPE','渲染任务不属于此项目');
			return {
				jobId: st.jobId, status: st.status, progress: st.progress || 0,
				outputPath: st.outputPath || null, error: st.error || null,
				receipt: st.receipt || null
			};
		}
		case 'cancel_render': {
			const { cancelRender,getRenderStatus } = await import('./render-supervisor.js');
			const st=getRenderStatus(String(body.jobId||''));
			if(!st?.outputPath||!path.resolve(st.outputPath).startsWith(path.resolve(root,'design/.designcraft/motion/artifacts')+path.sep))throw new SchemaError('E_JOB_SCOPE','渲染任务不属于此项目');
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
			const result = await verifyArtifact(ffprobePath, outputPath, manifest.render.durationFrames, manifest.render.width, manifest.render.height, manifest.render.fps);
			return { artifactValidated: true, ...result };
		}
		default:
			throw new SchemaError('E_ACTION', 'unknown motion action: ' + sub, 400);
	}
}

