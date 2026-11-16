import {localWorkflowRoutes} from './local-workflow-routes.js';
import {deckLocalInputRoutes} from './deck-local-inputs.js';
import {openLinkedMedia,commitLinkedMedia} from './media-link.js';
import {editorAssetRoutes,EDITOR_SHARED_MODULES} from './editor-assets.js';
import {EditorSessions,editorEngines} from './editor-session.js';
import {reserveDesignAssistantSession} from './design-assistant-session.js';
import {editorRoutes} from './editor-routes.js';
import {htmlRoutes} from './html-routes.js';
import {registerHtmlTool} from './html-tools.js';
import {installedVersion} from './installed-version.js';
import {registerEditorTools} from './editor-tools.js';
import {OpenDesignLibrary} from './open-design-library.js';
import {registerOpenDesignTools} from './open-design-tools.js';
import {DshImageProviders} from './image-provider.js';
import {ImageApiSettings} from './image-api-settings.js';
import {ImageJobs} from './image-jobs.js';
import {StudioImage,studioImageRoutes,registerStudioImageTool} from './studio-image.js';
import {legacyMigrationRoutes} from './legacy-migration.js';
import {nativeVariantRoutes,registerNativeVariantTool} from './native-variants.js';
import {registerSelectionTool} from './selection-tool.js';
import {registerDesignPlanTool} from './design-plan-tool.js';
import {registerDesignBriefTool} from './opendesign-brief-tool.js';
import {FalWorkflows} from './fal-workflow-service.js';
import {registerFalWorkflowTool} from './fal-workflow-tool.js';
import {falWorkflowRoutes} from './fal-workflow-routes.js';
import {FalRealtime} from './fal-realtime.js';
import {registerFalRealtimeTool} from './fal-realtime-tool.js';
import {falRealtimeRoutes} from './fal-realtime-routes.js';
import {VeniceAudio} from './venice-audio.js';
import {registerVeniceAudioTool} from './venice-audio-tool.js';
import {motionRoutes} from './motion/routes.js';
import {VeniceVideo} from './venice-video.js';
import {registerVeniceVideoTool} from './venice-video-tool.js';
import {FigmaSource} from './figma-source.js';
import {registerFigmaSourceTool} from './figma-source-tool.js';
import {ReplicateWorkflows} from './replicate-workflow.js';
import {registerReplicateWorkflowTool} from './replicate-workflow-tool.js';
import {OpenAiSvg} from './openai-svg.js';
import {registerOpenAiSvgTool} from './openai-svg-tool.js';
import {StitchService} from './stitch-service.js';
import {registerStitchTool} from './stitch-tool.js';
import {PixelbinService} from './pixelbin-service.js';
import {registerPixelbinTool} from './pixelbin-tool.js';
import {PixelbinOperations} from './pixelbin-operations.js';
import {pixelbinRoutes} from './pixelbin-routes.js';
import {FigmaMcpService} from './figma-mcp-service.js';
import {registerFigmaMcpTool} from './figma-mcp-tool.js';
import {figmaMcpRoutes} from './figma-mcp-routes.js';
import {EcommerceWorkflow} from './ecommerce-workflow.js';
import {registerEcommerceTool} from './ecommerce-tool.js';
import {ecommerceRoutes} from './ecommerce-routes.js';
import {workflowImageRoutes} from './workflow-image-routes.js';
import {StockImages} from './stock-images.js';
import {registerStockTool} from './stock-tool.js';
import {stockRoutes} from './stock-routes.js';
/**
 * DesignCraft for DSH — versioned workspace and supervised engine routes.
 *
 * Serves /designcraft/api/v1/* on the DSH web server:
 *   docs CRUD + assets + commands + SSE change feed + client module files
 *   + client-rendered PDF assembly + export downloads.
 *
 * WYSIWYG pipeline: bounded fs watcher + shallow poll sweep → SSE broadcast →
 * client re-fetch → canvas re-render. Self-writes (writer:'ui') are suppressed
 * so the editor that saved does not re-pull its own change.
 *
 * Safety: every route wrapped; route registration failures warn and continue;
 * SSE disconnects cleaned up; watcher lifecycle ref-counted per workspace.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './docstore.js';
import {catalog} from './commands.js';
import { JobSupervisor } from './jobs.js';
import {WorkspaceNative} from './workspace-native.js';
import {designResourceCatalog,readDesignResource,applyDesignResource} from './design-resources.js';
import {registerDesignTools} from './dsh-tools.js';
import {saveAssetStream} from './asset-stream.js';
import {previewImageSize} from './image-header.js';

const PKG_ID = 'designcraft';
const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
// Capture metadata when this host module loads; later disk edits do not masquerade
// as a reload of this running backend.
const HOST_PACKAGE=JSON.parse(readFileSync(join(PKG_DIR,'package.json'),'utf8'));
const HOST_LOADED_AT=new Date().toISOString();

export const name = 'designcraft';
export const inject = ['webServer'];

/* ---------------- shared plumbing ---------------- */

function sendJson(response, status, payload) {
	if (response.destroyed || response.writableEnded) return;
	const body = JSON.stringify(payload);
	response.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'access-control-allow-origin': 'same-origin'
	});
	response.end(body);
}

function sendFailure(response,error) {
	const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
	sendJson(response,status,{ok:false,error:String(error?.message || error), ...(error?.current ? {current:error.current} : {}),...(error?.candidate?{candidate:error.candidate}:{})});
}

function readJsonBody(request, limit = 64 * 1024) {
	return new Promise((resolvePromise, rejectPromise) => {
		let size = 0;
		const chunks = [];
		request.on('data', (chunk) => {
			size += chunk.length;
			if (size > limit) {
				rejectPromise(new store.StoreError('请求体过大', 413));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on('end', () => {
			try {
				const text = Buffer.concat(chunks).toString('utf8');
				resolvePromise(text ? JSON.parse(text) : {});
			} catch {
				rejectPromise(new store.StoreError('JSON 解析失败', 400));
			}
		});
		request.on('error', rejectPromise);
	});
}

function sameOrigin(request) {
	const origin = request.headers.origin;
	if (!origin) return true;
	try {
		return new URL(origin).host === request.headers.host;
	} catch {
		return false;
	}
}

/* ---------------- per-root broadcaster + watcher manager ---------------- */

class RootHub {
	constructor() {
		this.disposed = false;
		this.hubs = new Map(); // resolvedRoot → { subscribers:Set, watcher, lastTouch }
		this.gcTimer = setInterval(()=>this.gc(),15000);
		this.gcTimer.unref?.();
	}

	hub(root) {
		if(this.disposed)throw new store.StoreError('监听服务已停止',503);
		const resolved = resolve(root);
		let hub = this.hubs.get(resolved);
		if (!hub) {
			this.gc();
			if (this.hubs.size >= 64) throw new store.StoreError('同时监听的工作区过多，请关闭未使用的工作区',429);
			hub = { subscribers: new Set(), watcher: null, lastTouch: 0 };
			hub.watcher = store.createWatcher(resolved, (event) => {
				for (const send of hub.subscribers) {
					try { send('event', event); } catch { /* dead subscriber */ }
				}
			});
			this.hubs.set(resolved, hub);
		}
		hub.lastTouch = Date.now();
		return hub;
	}

	subscribe(root, send) {
		const hub = this.hub(root);
		hub.subscribers.add(send);
		return () => {
			hub.subscribers.delete(send);
			hub.lastTouch = Date.now();
			this.gc();
		};
	}

	gc() {
		const now = Date.now();
		for (const [key, hub] of this.hubs) {
			if (hub.subscribers.size === 0 && now - hub.lastTouch > 60000) {
				try { hub.watcher?.close(); } catch { }
				this.hubs.delete(key);
			}
		}
	}

	dispose() {
		this.disposed = true;
		clearInterval(this.gcTimer);
		for (const hub of this.hubs.values()) { try { hub.watcher?.close(); } catch { } }
		this.hubs.clear();
	}
}

/* ---------------- routes ---------------- */

function buildRoutes(ctx, hub, jobs, native, status, images, media, editors, studioImage, openDesignLibrary, stitch, pixelbin, figmaMcp, ecommerce, falWorkflows, replicateWorkflows, falRealtime) {
	const guard = (handler) => (request, response) => {
		// WebServer is a raw route registry: custom routes do not inherit /api admission.
		// Use DSH's signed browser/API Peer and Host/Origin fence before any private I/O.
		const connection=ctx.get('connection');
		if(!connection?.admit){sendJson(response,503,{ok:false,error:'DSH 身份验证服务尚未就绪'});return;}
		const admission=connection.admit(request);
		if('rejection' in admission){sendJson(response,admission.rejection,{ok:false,error:'DSH 身份验证或请求来源检查失败'});return;}
		if(admission.peer?.principal?.kind!=='owner'){sendJson(response,403,{ok:false,error:'设计工作区文件接口仅对工作区所有者开放'});return;}
		if (!sameOrigin(request)) {
			sendJson(response, 403, { ok: false, error: 'cross-origin refused' });
			return;
		}
		try {
			const result = ctx.waterfall('connection/request',request,response,()=>handler(request,response));
			if (result && typeof result.catch === 'function') {
				result.catch((error) => {
					sendFailure(response,error);
				});
			}
		} catch (error) {
			sendFailure(response,error);
		}
	};

	const queryOf = (request) => new URL(request.url, 'http://localhost').searchParams;

	const routes = [
        {kind:'exact',path:'/designcraft/api/v1/assistant/session',handler:guard(async(req,res)=>{
          if(req.method!=='POST')throw new store.StoreError('POST required',405);
          const body=await readJsonBody(req,4096),session=reserveDesignAssistantSession({...body,resolveWorkspace:id=>ctx.get('workspaceRegistry')?.get(id)});
          sendJson(res,200,{ok:true,session});
        })},
        {kind:'exact',path:'/designcraft/api/v1/versions',handler:guard((req,res)=>{
          if(req.method!=='GET')throw new store.StoreError('GET required',405);
          sendJson(res,200,{host:{version:HOST_PACKAGE.version,uiBuild:HOST_PACKAGE.designcraftUiBuild,loadedAt:HOST_LOADED_AT},disk:installedVersion(PKG_DIR)});
        })},
		{
			kind: 'exact', path: '/designcraft/api/v1/health',
		handler: guard((_req, res) => sendJson(res, 200, { ok: true, plugin: PKG_ID, version:HOST_PACKAGE.version,uiBuild:HOST_PACKAGE.designcraftUiBuild,hostLoadedAt:HOST_LOADED_AT,protocolVersion:2,
      workspaceCapabilities:{studio:{engines:Object.keys(editorEngines),imageServiceIntegrated:true,imageServiceValidated:false,htmlSourceIntegrated:true,htmlConversionValidated:false,legacyMigrationIntegrated:true,legacyMigrationValidated:false,nativeVariantsIntegrated:true,nativeVariantsValidated:false,brandFontBindings:true,brandFontBindingsValidated:false,openDesignWorkflowIntegrated:false,linkedMediaIntegrated:true,linkedMediaFormats:['png','svg'],brandColorBindings:true},compatibility:{imageGeneration:true,localRepaint:true,workVariants:true,linkedMedia:true}},
      legacyCapabilityScope:'Flat capabilities except professionalEditor/editorExecutionAdmission/nativeLiveness/nativeFileActions describe compatibility workflows; see workspaceCapabilities.studio for the live professional workspace.',
      capabilities:{professionalEditor:1,editorExecutionAdmission:typeof editors.begin==='function',nativeLiveness:editors.supportsNativeLiveness===true,nativeFileActions:typeof editors.copySource==='function'&&typeof editors.unselect==='function',revisionedWrites:true,recoveryHistory:true,nativeObjects:true,designResources:true,dshTool:status.toolReady,streamAssets:true,preciseReferences:2,nativeDirectEditing:true,multiSelection:true,imageGeneration:true,localRepaint:true,workVariants:true,linkedMedia:true} }))
		},
		{
			kind: 'exact', path: '/designcraft/api/v1/catalog',
			handler: guard((_req, res) => sendJson(res, 200, { ok: true, ...catalog() }))
		},
		{
			kind: 'exact', path: '/designcraft/api/v1/state',
			handler: guard(async(request, res) => {
				const root = store.validateRoot(queryOf(request).get('root'));
				const state=await jobs.run('state',{root});
				sendJson(res, 200, {
					ok: true,
					docs: state.docs,
					assets: state.assets,
					tasks: state.tasks.map(t => ({ id: t.id, kind: t.kind, docId: t.docId, payload: t.payload, status:'blocked',error:'旧版未执行任务，需要重新提交命令。' })),
					jobs:[...jobs.list(root).filter(job=>!['state','read-doc'].includes(job.kind)),...native.list(root),...images.list(root)],
					templates: catalog().templates,
					designSystems: catalog().designSystems,
                    designResources:designResourceCatalog(),dshToolReady:status.toolReady
				});
			})
		},
		{
			kind: 'exact', path: '/designcraft/api/v1/doc',
			handler: guard(async(request, res) => {
				if (request.method === 'GET') {
					const q = queryOf(request);
					const root = store.validateRoot(q.get('root'));
					const { doc, revision, mtime } = await jobs.run('read-doc',{root,id:q.get('id')});
					sendJson(res, 200, { ok: true, doc, revision, mtime });
					return;
				}
				if (request.method === 'POST') {
					readJsonBody(request,20*1024*1024).then((body) => {
						const root = store.validateRoot(body.root);
					const result = store.writeDoc(root, String(body.id), body.doc, String(body.writer || 'host'), {baseRevision:body.baseRevision});
						hub.hub(root).watcher.markSelfWrite(join(store.designDir(root), result.id + '.dc.json'));
						// emit to *other* subscribers (self already has it); suppression via markSelfWrite keeps watchers quiet
						for (const send of hub.hub(root).subscribers) { try { send('event',{kind:'doc',name:result.id,revision:result.revision,writer:body.writer || 'host'}); } catch {} }
						sendJson(res, 200, { ok: true, ...result });
					}).catch((error) => sendFailure(res,error));
					return;
				}
				sendJson(res, 405, { ok: false, error: 'method not allowed' });
			})
		},
		{
			kind: 'exact', path: '/designcraft/api/v1/doc/create',
			handler: guard((request, res) => {
				readJsonBody(request,20*1024*1024).then((body) => {
					const root = store.validateRoot(body.root);
					const created = store.createDoc(root, body.doc || {});
					hub.hub(root).watcher.markSelfWrite(join(store.designDir(root), created.id + '.dc.json'));
					for (const send of hub.hub(root).subscribers) { try { send('event',{kind:'doc',name:created.id,revision:created.revision}); } catch {} }
					sendJson(res, 200, { ok: true, ...created });
				}).catch((error) => sendFailure(res,error));
			})
		},
		{
			kind: 'exact', path: '/designcraft/api/v1/doc/delete',
			handler: guard((request, res) => {
				readJsonBody(request).then((body) => {
					const root = store.validateRoot(body.root);
					const deleted = store.deleteDoc(root, String(body.id), {baseRevision:body.baseRevision});
					hub.hub(root).watcher.markSelfWrite(join(store.designDir(root), deleted.id + '.dc.json'));
					for (const send of hub.hub(root).subscribers) { try { send('event',{kind:'doc',name:deleted.id,deleted:true}); } catch {} }
					sendJson(res, 200, { ok: true, ...deleted });
				}).catch((error) => sendFailure(res,error));
			})
		},
    {
      kind:'exact',path:'/designcraft/api/v1/asset/upload',
      handler:guard(async(request,res)=>{
        if(request.method!=='POST')throw new store.StoreError('POST required',405);
        const q=queryOf(request),root=store.validateRoot(q.get('root'));
        if(Number(request.headers['content-length'])>64*1024*1024)throw new store.StoreError('素材超过64MB上传预算',413);
        const saved=await saveAssetStream(root,q.get('name'),request);
        for(const send of hub.hub(root).subscribers){try{send('event',{kind:'asset',name:saved.name});}catch{}}
        sendJson(res,200,{ok:true,...saved});
      })
    },
		{
			kind: 'exact', path: '/designcraft/api/v1/asset',
			handler: guard((request, res) => {
				if (request.method === 'GET') {
					const q = queryOf(request);
					const root = store.validateRoot(q.get('root'));
					const buffer = store.readAsset(root, q.get('name'));
					if (!buffer) { sendJson(res, 404, { ok: false, error: 'asset not found' }); return; }
                    const type=store.assetContentType(q.get('name')),download=q.get('download')==='1';
                    if(type.startsWith('image/')&&!download)previewImageSize(buffer);
                    res.writeHead(200,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",'referrer-policy':'no-referrer',...(download?{'content-disposition':'attachment; filename="'+encodeURIComponent(q.get('name'))+'"'}:{})});
					res.end(buffer);
					return;
				}
				if (request.method === 'POST') {
					readJsonBody(request,8*1024*1024).then((body) => {
						const root = store.validateRoot(body.root);
						const buffer = Buffer.from(String(body.dataBase64 || ''), 'base64');
						const saved = store.saveAsset(root, String(body.name || 'asset.bin'), buffer);
						if (!body.silent) {
							for (const send of hub.hub(root).subscribers) { try { send('event', { kind: 'asset', name: saved.name, at: new Date().toISOString() }); } catch { } }
						}
						sendJson(res, 200, { ok: true, ...saved });
					}).catch((error) => sendFailure(res,error));
					return;
				}
				sendJson(res, 405, { ok: false, error: 'method not allowed' });
			})
		},
    {
      kind:'exact',path:'/designcraft/api/v1/resources',
      handler:guard((_request,res)=>sendJson(res,200,{ok:true,resources:designResourceCatalog()}))
    },
    {
      kind:'exact',path:'/designcraft/api/v1/resources/read',
      handler:guard((request,res)=>{const q=queryOf(request);sendJson(res,200,{ok:true,...readDesignResource(q.get('id'),q.get('file')||'DESIGN.md')});})
    },
    {
      kind:'exact',path:'/designcraft/api/v1/resources/apply',
      handler:guard(async(request,res)=>{
        if(request.method!=='POST')throw new store.StoreError('POST required',405);
        const body=await readJsonBody(request,64*1024),root=store.validateRoot(body.root);
        const sourceMode=store.readDoc(root,body.id).doc.native?.deck?.mode==='source';
        const result=sourceMode?await native.run({root,id:body.id,operation:'deck.design',resourceId:body.resourceId,baseRevision:body.baseRevision}):applyDesignResource(root,body.id,body.resourceId,body.baseRevision);
        for(const send of hub.hub(root).subscribers){try{send('event',{kind:'doc',name:body.id,revision:result.revision,writer:'open-design'});}catch{}}
        sendJson(res,200,{ok:true,...result});
      })
    },
    {
      kind:'exact',path:'/designcraft/api/v1/native/catalog',
      handler:guard((_request,res)=>sendJson(res,200,{ok:true,...native.catalog()}))
    },
    {
      kind:'exact',path:'/designcraft/api/v1/native/operation',
      handler:guard(async(request,res)=>{
        if(request.method!=='POST')throw new store.StoreError('POST required',405);
        const body=await readJsonBody(request,1024*1024),root=store.validateRoot(body.root),controller=new AbortController();
        res.once('close',()=>{if(!res.writableEnded)controller.abort();});
        const result=await native.run({...body,root},{signal:controller.signal});
        for(const send of hub.hub(root).subscribers){try{send('event',{kind:'doc',name:body.id,revision:result.revision,writer:'native'});}catch{}}
        sendJson(res,200,result);
      })
    },
		{
			kind: 'exact', path: '/designcraft/api/v1/command',
			handler: guard((request, res) => {
				if (request.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST required' }); return; }
				readJsonBody(request,20*1024*1024).then(async(body) => {
					const root = store.validateRoot(body.root);
					const controller=new AbortController();
					res.once('close',()=>{if(!res.writableEnded)controller.abort();});
					const result = await jobs.run('commands',{root,commands:body.commands||[],options:{stopOnError:body.stopOnError!==false,baseRevisions:body.baseRevisions||{},requireRevision:true}},{signal:controller.signal});
					for (const send of hub.hub(root).subscribers) { try { send('event', { kind: 'batch', at: new Date().toISOString() }); } catch { } }
					sendJson(res, 200, { ok: result.results.every(r => r.ok), ...result });
				}).catch((error) => sendFailure(res,error));
			})
		},
		{
			kind: 'exact', path: '/designcraft/api/v1/events',
			handler: guard((request, response) => {
				const q = queryOf(request);
				const root = store.validateRoot(q.get('root'));
				response.writeHead(200, {
					'content-type': 'text/event-stream; charset=utf-8',
					'cache-control': 'no-store',
					'connection': 'keep-alive',
					'x-accel-buffering': 'no'
				});
				const send = (event, data) => {
					if (response.destroyed) return;
					response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
				};
				send('hello', { at: new Date().toISOString() });
				const unsubscribe = hub.subscribe(root, send);
				const heartbeat = setInterval(() => {
					try { if (!response.destroyed) response.write(': ping\n\n'); } catch { }
				}, 15000);
				const cleanup = () => {
					clearInterval(heartbeat);
					try { unsubscribe(); } catch { }
				};
				request.on('close', cleanup);
				response.on('close', cleanup);
				response.on('error', cleanup);
			})
		},
		{
			kind: 'exact', path: '/designcraft/api/v1/export/client-pdf',
			handler: guard((request, res) => {
				if (request.method !== 'POST') { sendJson(res, 405, { ok: false, error: 'POST required' }); return; }
				readJsonBody(request,20*1024*1024).then(async(body) => {
					const root = store.validateRoot(body.root);
					if (!Array.isArray(body.pages)||!body.pages.length) throw new store.StoreError('没有页面数据',400);
					const saved=await jobs.run('client-pdf',{root,pages:body.pages,out:String(body.out||'export.pdf')});
					sendJson(res, 200, { ok: true, ...saved });
				}).catch((error) => sendFailure(res,error));
			})
		},
		{
			kind:'exact',path:'/designcraft/api/v1/jobs',
			handler:guard((request,res)=>{const root=store.validateRoot(queryOf(request).get('root'));sendJson(res,200,{ok:true,jobs:[...jobs.list(root),...native.list(root),...images.list(root)]});})
		},
		{
			kind:'exact',path:'/designcraft/api/v1/jobs/cancel',
			handler:guard(async(request,res)=>{
				const body=await readJsonBody(request),root=store.validateRoot(body.root);
				if(![...jobs.list(root),...native.list(root),...images.list(root)].some(job=>job.id===body.id))throw new store.StoreError('任务不存在',404);
				sendJson(res,200,{ok:true,cancelled:jobs.cancel(body.id)||native.cancel(body.id)||(String(body.id).startsWith('image-')&&images.cancel(root,body.id))});
			})
		},
		{
			kind:'exact',path:'/designcraft/api/v1/history',
			handler:guard((request,res)=>{
				if (request.method !== 'GET') { sendJson(res,405,{ok:false,error:'GET required'}); return; }
				const q=queryOf(request),root=store.validateRoot(q.get('root'));
				sendJson(res,200,{ok:true,history:store.listDocHistory(root,q.get('id'))});
			})
		},
		{
			kind:'exact',path:'/designcraft/api/v1/history/restore',
			handler:guard(async(request,res)=>{
				if (request.method !== 'POST') { sendJson(res,405,{ok:false,error:'POST required'}); return; }
				const body=await readJsonBody(request),root=store.validateRoot(body.root);
				const result=store.restoreDocHistory(root,String(body.id),String(body.revision),body.baseRevision);
				for (const send of hub.hub(root).subscribers) { try { send('event',{kind:'doc',name:result.id,revision:result.revision}); } catch {} }
				sendJson(res,200,{ok:true,...result});
			})
		},
		{
			kind: 'exact', path: '/designcraft/api/v1/download',
			handler: guard((request, res) => {
				const q = queryOf(request);
				const root = store.validateRoot(q.get('root'));
				const buffer = store.readExport(root, q.get('name'));
				if (!buffer) { sendJson(res, 404, { ok: false, error: 'export not found' }); return; }
				res.writeHead(200, {
					'content-type': store.assetContentType(q.get('name')),
					'content-disposition': `attachment; filename="${encodeURIComponent(q.get('name'))}"`,
					'cache-control': 'no-store'
				});
				res.end(buffer);
			})
		}
	];

  routes.push(
   {kind:'exact',path:'/designcraft/api/v1/image/catalog',handler:guard(async(req,res)=>{if(req.method!=='GET')throw new store.StoreError('GET required',405);const result=await images.providers.catalogue(queryOf(req).get('provider')||undefined);sendJson(res,200,{ok:true,...result});})},
   {kind:'exact',path:'/designcraft/api/v1/image/jobs',handler:guard((req,res)=>{if(req.method!=='GET')throw new store.StoreError('GET required',405);const root=store.validateRoot(queryOf(req).get('root'));sendJson(res,200,{ok:true,jobs:images.list(root)});})},
   {kind:'exact',path:'/designcraft/api/v1/image/start',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req);sendJson(res,202,{ok:true,...await images.start(body)});})},
   {kind:'exact',path:'/designcraft/api/v1/image/recover-fal',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req);sendJson(res,202,{ok:true,...images.recoverFal(store.validateRoot(body.root),body.id)});})},
   {kind:'exact',path:'/designcraft/api/v1/image/convert-returned',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req);sendJson(res,202,{ok:true,...images.convertReturned(store.validateRoot(body.root),body.id,body.outputId)});})},
   {kind:'exact',path:'/designcraft/api/v1/image/cancel-remote-fal',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req);sendJson(res,200,{ok:true,...await images.cancelRemoteFal(store.validateRoot(body.root),body.id)});})},
   {kind:'exact',path:'/designcraft/api/v1/image/adopt',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req),result=await images.adopt(body);for(const send of hub.hub(store.validateRoot(body.root)).subscribers)try{send('event',{kind:'doc',name:result.id,revision:result.revision});}catch{}sendJson(res,200,result);})},
   {kind:'exact',path:'/designcraft/api/v1/image/cancel',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req);sendJson(res,200,{ok:true,cancelled:images.cancel(store.validateRoot(body.root),body.id)});})}
  );

  routes.push(
   {kind:'exact',path:'/designcraft/api/v1/variants',handler:guard(async(req,res)=>{if(req.method!=='GET')throw new store.StoreError('GET required',405);const q=queryOf(req),root=store.validateRoot(q.get('root'));sendJson(res,200,await jobs.run('variant-list',{root,docId:q.get('id')}));})},
   {kind:'exact',path:'/designcraft/api/v1/variants/fork',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req),root=store.validateRoot(body.root),result=await jobs.run('variant-fork',{...body,root});for(const send of hub.hub(root).subscribers)try{send('event',{kind:'variant',id:result.id,groupId:result.group.id});}catch{}sendJson(res,200,result);})},
   {kind:'exact',path:'/designcraft/api/v1/variants/adopt',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req),root=store.validateRoot(body.root),result=await jobs.run('variant-adopt',{...body,root});for(const send of hub.hub(root).subscribers)try{send('event',{kind:'doc',id:result.id});}catch{}sendJson(res,200,result);})},
   {kind:'exact',path:'/designcraft/api/v1/preview',handler:guard((req,res)=>{if(req.method!=='GET')throw new store.StoreError('GET required',405);res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#eef0f1;font:12px sans-serif}#view{height:100%;display:flex;align-items:center;justify-content:center}#status{position:absolute;top:0;padding:8px;color:#9c4230}canvas{max-width:100%;max-height:100%}</style></head><body><div id="view"></div><div id="status">正在渲染真实作品…</div><script type="module" src="./client/preview-view.js"></script></body></html>');})},
   {kind:'exact',path:'/designcraft/api/v1/preview/document',handler:guard(async(req,res)=>{if(req.method!=='GET')throw new store.StoreError('GET required',405);const q=queryOf(req),root=store.validateRoot(q.get('root'));sendJson(res,200,await jobs.run('preview-info',{root,docId:q.get('id'),pageId:q.get('pageId')}));})}
  );

  for(const kind of ['open','commit'])routes.push({kind:'exact',path:'/designcraft/api/v1/media/'+kind,handler:guard(async(req,res)=>{if(req.method!=='POST')throw new store.StoreError('POST required',405);const body=await readJsonBody(req),root=store.validateRoot(body.root),result=await media[kind]({...body,root});for(const send of hub.hub(root).subscribers)try{send('event',{kind:'doc',id:result.id});}catch{}sendJson(res,200,result);})});

	// serve client ES modules from the package (engine, tools, ui, ...)
	const clientFiles = [...EDITOR_SHARED_MODULES,'html-sandbox.js','html-workspace.js','figma-mcp-panel.js','brief-dimensions.js','image-adoption.js','studio-image-workspace.js','image-api-settings.js','deck-local-tools.js','local-workflow-panel.js','mathml-to-omml.js','stock-panel.js','fal-realtime-panel.js','fal-workflow-panel.js','pixelbin-workspace.js','ecommerce-panel.js','workflow-image-panel.js','legacy-migration-workspace.js','native-context-tools.js','ai-canvas.js','chat-split.js','design-session.js','native-ai-input.js','selection-ai.js','brand-panel.js','native-workspace.js','native-controller.js','native-reference.js','editor-surface.js','variant-ui.js', 'preview-view.js', 'image-ui.js', 'svg-export.js', 'selection.js', 'engine.js', 'vector-nodes.js', 'dsh-context.js', 'path.js', 'svgtools.js', 'sync.js', 'merge.js', 'recovery.js', 'tools.js', 'deck.js', 'actions.js', 'ui.js', 'motion-workspace.js', 'motion-reference.js'];
	for (const file of clientFiles) {
		routes.push({
			kind: 'exact', path: '/designcraft/api/v1/client/' + file,
			handler: guard((_request, response) => {
				try {
					const code = readFileSync(join(PKG_DIR, 'client', file), 'utf8');
					response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
					response.end(code);
				} catch (error) {
					response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
					response.end('// client module missing: ' + file);
				}
			})
		});
	}

	routes.push(...editorRoutes(ctx,editors,{guard,readJsonBody,sendJson}));
	routes.push(...htmlRoutes(editors,{guard,readJsonBody,sendJson,library:openDesignLibrary,stitch}));
	routes.push(...pixelbinRoutes(editors,pixelbin,{guard,readJsonBody,sendJson}));
	routes.push(...figmaMcpRoutes(editors,figmaMcp,{guard,readJsonBody,sendJson}));
	routes.push(...ecommerceRoutes(editors,ecommerce,{guard,readJsonBody,sendJson}));
	routes.push(...workflowImageRoutes(editors,falWorkflows,replicateWorkflows,{guard,readJsonBody,sendJson}));
	routes.push(...falWorkflowRoutes(editors,falWorkflows,{guard,readJsonBody,sendJson}));
	routes.push(...falRealtimeRoutes(editors,falRealtime,falWorkflows,{guard,readJsonBody,sendJson}));
	routes.push(...stockRoutes(editors,editors.stockImages,{guard,readJsonBody,sendJson}));
	routes.push(...studioImageRoutes(studioImage,{guard,readJsonBody,sendJson}));
 routes.push(...deckLocalInputRoutes(editors,{guard,readJsonBody,sendJson}));
 routes.push(...localWorkflowRoutes(editors,{guard,readJsonBody,sendJson}));
	routes.push(...legacyMigrationRoutes(editors,{guard,readJsonBody,sendJson}));
	routes.push(...nativeVariantRoutes(editors,{guard,readJsonBody,sendJson}));
	return routes;
}

/* ---------------- skill registration ---------------- */

function parseSkillMarkdown(raw, source) {
	const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
	if (!m) return { description: 'DesignCraft 设计套件', whenToUse: undefined, content: raw };
	const fm = m[1];
	const get = (key) => {
		const r = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(fm);
		return r ? r[1].trim().replace(/^["']|["']$/g, '') : undefined;
	};
	return { description: get('description'), whenToUse: get('whenToUse'), content: raw.slice(m[0].length) };
}

function registerSkill(ctx) {
	try {
		const skillPath = join(PKG_DIR, 'skills', 'designcraft', 'SKILL.md');
		const raw = readFileSync(skillPath, 'utf8');
		const { description, whenToUse, content } = parseSkillMarkdown(raw, skillPath);
		ctx.inject(['skills'], (scope) => {
			const dispose = scope.skills.register({
				name: 'designcraft',
				description: description || 'DesignCraft 设计套件：图片编辑、矢量插画、演示文稿与设计系统的统一工作区',
				whenToUse: whenToUse || '用户要做设计、海报、PPT、修图、矢量图；工作区存在 design/ 目录或 .dc.json 文件',
				invocation: { modelInvocable: true, userInvocable: true },
				provider: 'designcraft',
				source: 'plugin:designcraft',
				content,
				path: skillPath,
				resourceBase: { kind: 'directory', path: dirname(skillPath) }
			});
			scope.effect(() => dispose, 'designcraft: dispose skill');
		});
	} catch (error) {
		console.warn('[urania] skill registration skipped:', String(error));
	}
}

/* ---------------- plugin entry ---------------- */

export function apply(ctx,config={}) {
  if(!config||typeof config!=='object')config={};
	const hub = new RootHub();
	ctx.effect(() => () => { try { hub.dispose(); } catch { } }, 'designcraft: hub lifetime');
	const jobs=new JobSupervisor({onChange:record=>{
		if(['state','read-doc'].includes(record.kind))return;
		for(const send of hub.hub(record.root).subscribers){try{send('event',{kind:'job',job:{id:record.id,kind:record.kind,status:record.status,progress:record.progress,error:record.error}});}catch{}}
	}});
	ctx.effect(()=>()=>jobs.dispose(),'designcraft: compute lifetime');

  const native=new WorkspaceNative({onChange:record=>{
    for(const send of hub.hub(record.root).subscribers){try{send('event',{kind:'job',job:{id:record.id,kind:record.kind,status:record.status,progress:record.progress,error:record.error}});}catch{}}
  }});
  ctx.effect(()=>()=>native.dispose(),'designcraft: native lifetime');
  const status={toolReady:false};
  const broadcast=(root,event)=>{for(const send of hub.hub(root).subscribers){try{send('event',event);}catch{}}};
  const editors=new EditorSessions({resolveScope:id=>ctx.get('sessions')?.get(id)?.header?.cwd,onChange:broadcast});
  ctx.effect(()=>()=>editors.dispose(),'designcraft: professional editor sessions');
  registerEditorTools(ctx,editors);
  const stockImages=new StockImages({version:HOST_PACKAGE.version});editors.stockImages=stockImages;registerStockTool(ctx,editors,stockImages);
  ctx.effect(()=>()=>stockImages.dispose(),'designcraft: public image search lifetime');
  // Lazy source-data loading: a missing/corrupt OD index reports a tool failure,
  // rather than preventing the continuous native editor from loading.
  const openDesignLibrary=new OpenDesignLibrary();editors.openDesignLibrary=openDesignLibrary;registerOpenDesignTools(ctx,openDesignLibrary,editors);
  registerHtmlTool(ctx,openDesignLibrary,editors);
  registerDesignPlanTool(ctx,editors,openDesignLibrary);
  registerDesignBriefTool(ctx,editors,openDesignLibrary);
  const images=new ImageJobs({providers:new DshImageProviders(ctx,config.imageConnections||[],new ImageApiSettings(ctx)),native,compute:(kind,payload)=>jobs.run(kind,payload),onChange:record=>broadcast(record.root,{kind:'image-job',id:record.id,status:record.status})});
  const falWorkflows=new FalWorkflows(ctx,images.providers);registerFalWorkflowTool(ctx,editors,falWorkflows);
  ctx.effect(()=>()=>falWorkflows.dispose(),'designcraft: fal workflow lifetime');
  const falRealtime=new FalRealtime(falWorkflows);registerFalRealtimeTool(ctx,editors,falRealtime,falWorkflows);
  ctx.effect(()=>()=>{void falRealtime.dispose();},'designcraft: fal realtime lifetime');
  const veniceAudio=new VeniceAudio(ctx,images.providers);registerVeniceAudioTool(ctx,editors,veniceAudio);
  ctx.effect(()=>()=>veniceAudio.dispose(),'designcraft: Venice audio lifetime');
  const veniceVideo=new VeniceVideo(veniceAudio);registerVeniceVideoTool(ctx,editors,veniceVideo);
  ctx.effect(()=>()=>veniceVideo.dispose(),'designcraft: Venice video lifetime');
  const figmaSource=new FigmaSource(ctx,editors);registerFigmaSourceTool(ctx,editors,figmaSource);
  const replicateWorkflows=new ReplicateWorkflows(ctx);registerReplicateWorkflowTool(ctx,editors,replicateWorkflows);
  ctx.effect(()=>()=>replicateWorkflows.dispose(),'designcraft: Replicate workflow lifetime');
  const openAiSvg=new OpenAiSvg(images.providers,editors);registerOpenAiSvgTool(ctx,editors,openAiSvg);
  ctx.effect(()=>()=>openAiSvg.dispose(),'designcraft: OpenAI SVG lifetime');
  const figmaMcp=new FigmaMcpService(ctx,editors,broadcast);registerFigmaMcpTool(ctx,editors,figmaMcp);
  ctx.effect(()=>()=>figmaMcp.dispose(),'designcraft: Figma MCP lifetime');
  const stitch=new StitchService(ctx,broadcast);registerStitchTool(ctx,editors,stitch);
  ctx.effect(()=>()=>stitch.dispose(),'designcraft: Stitch MCP lifetime');
  const pixelbin=new PixelbinService(ctx,editors,broadcast);pixelbin.operations=new PixelbinOperations(pixelbin.oauth,broadcast);registerPixelbinTool(ctx,editors,pixelbin);
  ctx.effect(()=>()=>pixelbin.dispose(),'designcraft: PixelBin MCP lifetime');
  ctx.effect(()=>()=>pixelbin.operations.dispose(),'designcraft: PixelBin operations lifetime');
  editors.images=images;
  const studioImage=new StudioImage(editors,images);registerStudioImageTool(ctx,studioImage);
  const ecommerce=new EcommerceWorkflow(editors,images,broadcast);registerEcommerceTool(ctx,editors,ecommerce);
  registerNativeVariantTool(ctx,editors);
  registerSelectionTool(ctx,editors);
  ctx.effect(()=>()=>images.dispose(),'designcraft: image jobs lifetime');
  const media={open:(input,signal)=>openLinkedMedia(input,{jobs,signal}),commit:(input,signal)=>commitLinkedMedia(input,{jobs,signal})};
  registerDesignTools(ctx,{jobs,native,images,media,broadcast},ready=>{status.toolReady=ready;});
	registerSkill(ctx);

	// 路由注册走声明式 inject（文件顶部 export const inject = ['webServer']）：
	// apply 里直接 ctx.webServer.register。不要改回嵌套 ctx.inject(['webServer'], cb) ——
	// cordis 4.1（DSH 桌面 0.2.2-rc.1）下嵌套 inject 拿到的是影子实例，注册不会生效
	//（与生产可用的 dsh-plugin-mobile-gateway 同模式：声明 inject + ctx.webServer.register）。
	if (!ctx.webServer || typeof ctx.webServer.register !== 'function') {
		console.warn('[urania] webServer 服务不可用，HTTP API 与编辑器资源未注册');
		return;
	}
	{
		const routes = [...buildRoutes(ctx, hub, jobs, native, status, images, media, editors, studioImage, openDesignLibrary, stitch, pixelbin, figmaMcp, ecommerce, falWorkflows, replicateWorkflows, falRealtime),...editorAssetRoutes(PKG_DIR)];
		const disposers = [];
		const motionRouteList = motionRoutes({ execution: { agent: { session: 'host' } } });
		for (const route of motionRouteList) {
			try {
				const offMotion = ctx.webServer.register(route);
				if (typeof offMotion === 'function') disposers.push(offMotion);
			} catch (error) {
				console.warn('[urania] motion route failed to register:', route.path, String(error));
			}
		}
		for (const route of routes) {
			try {
				const off = ctx.webServer.register(route);
				if (typeof off === 'function') disposers.push(off);
			} catch (error) {
				console.warn('[urania] route failed to register:', route.path, String(error));
			}
		}
		ctx.effect(() => () => {
			for (const off of disposers) { try { off(); } catch { } }
		}, 'designcraft: routes');
	}
}
