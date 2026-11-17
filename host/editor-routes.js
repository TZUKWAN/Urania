import {previewPlanMigration,migratePlanResources} from './design-plan-migration.js';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {SafetyError} from './safety.js';
import {editorEngines} from './editor-session.js';
import {Worker} from 'node:worker_threads';
import {exportCheckpoint} from './source-export.js';
import {recordPptxExport,readPptxReceipt} from './export-receipt.js';
import {designDiagnostics} from './design-diagnostics.js';
import {selectedObjectIds} from '../client/native-contract.js';
import {openNativeSession,nativeProjectFonts} from './native.js';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {previewImageSize} from './image-header.js';
import {createHash} from 'node:crypto';
import {workspacePath,assertImageSize} from './safety.js';
import {DesignPlans} from './design-plans.js';
import {createPlanSourceLink,unlinkPlanSource,readPlanSourceLink,listPlanSourceLinks,recoverPlanSourceLink} from './design-plan-links.js';
import {verifyBriefRule,resolveDesignBrief,renderDesignBrief} from './opendesign-design-brief.js';
import {createBriefJob,inspectBriefJob,listBriefJobs,recoverBriefJob} from './opendesign-brief-job.js';
import {restoreDesignPlan,recoverDesignPlan} from './design-plan-restore.js';

export function editorRoutes(ctx,manager,{guard,readJsonBody,sendJson}){
 const root='/designcraft/api/v2/studio';
 const viewFor=req=>manager.getView(req.headers['x-designcraft-view'],req.headers['x-designcraft-capability']);
 let packaging=false;
 const previewCache=new Map(),previewFlights=new Map();let previewBytes=0;
 const joinPreview=(shared,signal)=>{
  if(signal?.aborted){if(!shared.waiters&&!shared.done){shared.promise.catch(()=>{});shared.controller.abort();}return Promise.reject(new SafetyError('预览读取已停止',499));}
  shared.waiters++;
  return new Promise((resolve,reject)=>{
   let settled=false;
   const finish=()=>{if(settled)return false;settled=true;signal?.removeEventListener('abort',abort);shared.waiters--;if(!shared.waiters&&!shared.done)shared.controller.abort();return true;};
   const abort=()=>{if(finish())reject(new SafetyError('预览读取已停止',499));};
   signal?.addEventListener('abort',abort,{once:true});shared.promise.then(value=>{if(finish())resolve(value);},error=>{if(finish())reject(error);});if(signal?.aborted)abort();
  });
 };
 const renderPreview=async(view,source,signal)=>{
  const fonts=await nativeProjectFonts(view.root,signal),key=view.root.toLowerCase()+'\0'+source.meta.engine+':'+source.meta.sourceHash+':'+fonts.fingerprint,existing=previewCache.get(key);
  if(existing){previewCache.delete(key);previewCache.set(key,existing);return {bytes:existing,fontCount:fonts.items.length};}
  const current=previewFlights.get(key);if(current&&!current.controller.signal.aborted)return {bytes:await joinPreview(current,signal),fontCount:fonts.items.length};
  if(current)previewFlights.delete(key);
  if(previewFlights.size>=24)throw new SafetyError('作品预览正在排队，请稍后查看',429);
  const shared={controller:new AbortController(),waiters:0,done:false,promise:null};
  shared.promise=(async()=>{
   const session=await openNativeSession(source.meta.engine,view.root,{signal:shared.controller.signal,projectFonts:fonts});
   try{
    let bytes;
    if(source.meta.engine==='vectorcraft'){
     await session.call('open_file',{path:source.path});const result=await session.call('render_preview',{max_side:480,artboard:0});
     const image=result.content.find(item=>item.type==='image'&&item.mimeType==='image/png');if(!image)throw new SafetyError('矢量源未返回预览',422);bytes=Buffer.from(image.data,'base64');
    }else if(source.meta.engine==='deckcraft'){
     await session.call('open_presentation',{path:source.path});const result=await session.call('render_slide',{slide:0,scale:.5});
     const image=result.content.find(item=>item.type==='image'&&item.mimeType==='image/png');if(!image)throw new SafetyError('演示源没有可预览的首页',422);bytes=Buffer.from(image.data,'base64');
    }else{
     await session.call('doc_open',{path:source.path});const path=join(session.directory,'overview.png');await session.call('doc_export',{path});bytes=await readFile(path);
    }
    if(!bytes.length||bytes.length>16*1024*1024)throw new SafetyError('作品预览超过16MiB预算',413);previewImageSize(bytes);
    if((await nativeProjectFonts(view.root,shared.controller.signal)).fingerprint!==fonts.fingerprint)throw new SafetyError('预览期间项目字体已改变，请重新查看',409);
    while(previewCache.size>=32||previewBytes+bytes.length>32*1024*1024){const oldest=previewCache.keys().next().value;if(!oldest)break;previewBytes-=previewCache.get(oldest).length;previewCache.delete(oldest);}
    previewCache.set(key,bytes);previewBytes+=bytes.length;return bytes;
   }finally{await session.close();}
  })().finally(()=>{shared.done=true;if(previewFlights.get(key)===shared)previewFlights.delete(key);});
  previewFlights.set(key,shared);return {bytes:await joinPreview(shared,signal),fontCount:fonts.items.length};
 };
 return [
  {kind:'exact',path:root+'/overview-preview',handler:guard(async(req,res)=>{
   if(req.method!=='GET')throw new SafetyError('GET required',405);
   const view=viewFor(req),query=new URL(req.url,'http://localhost').searchParams,epoch=query.get('epoch');
   if(epoch!==view.epoch)throw new SafetyError('作品总览已切换',409);
   const source=await manager.store(view.root).source(query.get('id'),query.get('revision'));
   const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
   try{
    const {bytes,fontCount}=await renderPreview(view,source,controller.signal);
    if(view.epoch!==epoch||manager.active.get(view.sessionId)!==view.id)throw new SafetyError('工作区已切换，未返回其他项目的预览',409);
    res.writeHead(200,{'content-type':'image/png','content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-source-revision':source.revision,'x-project-font-count':String(fontCount)});res.end(bytes);
   }finally{res.off('close',abort);}
  })},
  {kind:'exact',path:root+'/export',handler:guard(async(req,res)=>{
   if(req.method!=='GET')throw new SafetyError('GET required',405);
   const view=viewFor(req),q=new URL(req.url,'http://localhost').searchParams;
   manager.fileActionIdle(view,q.get('epoch'));
   const id=q.get('id'),revision=q.get('revision');
   if(id!==view.sourceId||!revision||revision!==view.sourceRevision)throw new SafetyError('请先保存并重新选择需要导出的作品',409);
   const store=manager.store(view.root),controller=new AbortController();
   const abort=()=>controller.abort();res.on('close',abort);
   try{
    const result=await exportCheckpoint(store,id,revision,q.get('format'),controller.signal);
    if(view.epoch!==q.get('epoch')||view.sourceRevision!==revision||(await store.head(id))?.revision!==revision)throw new SafetyError('导出期间作品已改变，请重试',409);
    res.writeHead(200,{'content-type':result.type,'content-length':result.bytes.length,'cache-control':'no-store','x-source-revision':revision,'x-content-type-options':'nosniff','x-export-warnings':Buffer.from(JSON.stringify(result.warnings||[])).toString('base64url')});res.end(result.bytes);
   }finally{res.off('close',abort);}
  })},
  {kind:'exact',path:root+'/export-receipt',handler:guard(async(req,res)=>{
   const view=viewFor(req),q=new URL(req.url,'http://localhost').searchParams;manager.fileActionIdle(view,q.get('epoch'));
   if(req.method==='GET'){sendJson(res,200,{ok:true,receipt:readPptxReceipt(view.root,q.get('operationId'))});return;}
   if(req.method!=='POST')throw new SafetyError('需要 GET 或 POST',405);
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>128*1024*1024)throw new SafetyError('导出文件超过128MiB预算',413);chunks.push(chunk);}
   let warnings=[];const value=req.headers['x-export-warnings'];if(value){if(value.length>30000)throw new SafetyError('导出告警超过预算',413);warnings=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));}
   const receipt=await recordPptxExport(manager,view,{operationId:q.get('operationId'),sourceId:q.get('id'),revision:q.get('revision'),epoch:q.get('epoch'),bytes:Buffer.concat(chunks),warnings});sendJson(res,200,{ok:true,receipt});
  })},
  {kind:'exact',path:root+'/diagnostics',handler:guard(async(req,res)=>{
   if(req.method!=='GET')throw new SafetyError('需要 GET',405);const view=viewFor(req),epoch=new URL(req.url,'http://localhost').searchParams.get('epoch');if(epoch!==view.epoch)throw new SafetyError('诊断视图已切换',409);sendJson(res,200,{ok:true,report:designDiagnostics(manager,view)});
  })},
  {kind:'exact',path:root+'/project-package',handler:guard(async(req,res)=>{
   if(req.method!=='GET')throw new SafetyError('GET required',405);
   const view=viewFor(req),epoch=new URL(req.url,'http://localhost').searchParams.get('epoch');
   manager.fileActionIdle(view,epoch);
   if(packaging)throw new SafetyError('另一个项目正在打包，请稍后重试',429);
   packaging=true;let worker,timer;
   try{
    worker=new Worker(new URL('./package-worker.js',import.meta.url),{workerData:{root:manager.scope(view.sessionId,view.root)},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:384}});
    const data=await new Promise((resolve,reject)=>{
     timer=setTimeout(()=>reject(new SafetyError('项目打包超时，请缩小项目或稍后重试',504)),120000);
     worker.once('message',result=>result.error?reject(new SafetyError(result.error,result.status)):resolve(Buffer.from(result.bytes.buffer,result.bytes.byteOffset,result.bytes.byteLength)));
     worker.once('error',reject);worker.once('exit',()=>reject(new SafetyError('打包进程已退出',503)));
    });
    if(view.epoch!==epoch||manager.active.get(view.sessionId)!==view.id)throw new SafetyError('工作区已切换，未下载其他项目',409);
    res.writeHead(200,{'content-type':'application/zip','content-length':data.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(data);
   }finally{clearTimeout(timer);if(worker)await worker.terminate();packaging=false;}
  })},
  {kind:'exact',path:root,handler:guard(async(req,res)=>{
   if(req.method!=='POST')throw new SafetyError('POST required',405);
   const body=await readJsonBody(req,2*1024*1024);let result;
   if(body.action==='register')result=manager.register(body);
   else{
    const view=manager.getView(body.viewId,body.token);
    switch(body.action){
     case 'runtime':{
      const backend=new URL(ctx.get('webServer').getOrigin());backend.hostname='designcraft.localhost';
      result={origin:backend.origin,engines:editorEngines,operationAdmission:true};break;
     }
     case 'state':result=await manager.state(view.sessionId,view.root);break;
     case 'project':result={project:await manager.projectState(view.sessionId,view.root)};break;
     case 'plan-list':
      if(body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);
      result={items:new DesignPlans(manager.scope(view.sessionId,view.root)).list()};break;
     case 'plan-read':
      if(body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);
      result=new DesignPlans(manager.scope(view.sessionId,view.root)).read(body.id,body.revision);break;
     case 'plan-history':
      if(body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);
      result={items:new DesignPlans(manager.scope(view.sessionId,view.root)).history(body.id)};break;
     case 'plan-recoverable':
      if(body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);
      result=new DesignPlans(manager.scope(view.sessionId,view.root)).recoverable(body.id);break;
     case 'plan-candidate':
      if(body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);
      result=new DesignPlans(manager.scope(view.sessionId,view.root)).unpublished(body.id,body.revision);break;
     case 'plan-brief-resolve':
     case 'plan-brief-create':
     case 'plan-brief-status':
     case 'plan-brief-list':
     case 'plan-brief-recover':{
      if(body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);const root=manager.scope(view.sessionId,view.root),write=['plan-brief-create','plan-brief-recover'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对设计简报',409);if(write)manager.fileActionIdle(view,body.epoch);},controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
      try{if(body.action==='plan-brief-resolve'){const rule=await verifyBriefRule(manager.openDesignLibrary,controller.signal),spec=resolveDesignBrief({title:body.title,brief:body.brief,mode:body.mode||'natural',dimensions:body.dimensions||{}}),rendered=renderDesignBrief(spec,body.brief);result={rule,spec,design:rendered.design,note:'仅按固定规则解析，未保存作品。'};}
       else if(body.action==='plan-brief-create'){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('设计简报需要稳定操作身份',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await createBriefJob(manager.openDesignLibrary,root,{title:body.title,brief:body.brief,mode:body.mode||'natural',dimensions:body.dimensions||{}},operationId,controller.signal,current,event=>manager.onChange(root,event));}
       else if(body.action==='plan-brief-status')result=await inspectBriefJob(root,body.id);else if(body.action==='plan-brief-list')result=await listBriefJobs(root,{offset:body.offset??0,limit:30});else result=await recoverBriefJob(root,body.candidate,controller.signal,current);current();}
      finally{res.off('close',abort);}break;
     }
     case 'plan-create':
     case 'plan-save':{
      manager.fileActionIdle(view,body.epoch);const root=manager.scope(view.sessionId,view.root),current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对设计计划',409);manager.fileActionIdle(view,body.epoch);},plans=new DesignPlans(root);let id,baseRevision,sources;
      if(body.action==='plan-create'){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('新计划需要稳定操作身份',422);id='plan-'+createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex').slice(0,32);baseRevision=null;sources=[];}
      else{if(!/^[a-f0-9]{64}$/.test(body.baseRevision||''))throw new SafetyError('修改计划需要准确基础版本',422);id=body.id;baseRevision=body.baseRevision;sources=plans.read(id,baseRevision).plan.sources;}
      current();result=plans.save({id,baseRevision,title:body.title,brief:body.brief,content:body.content,sources});try{manager.onChange(root,{kind:'design-plan',id,revision:result.revision});}catch{}current();break;
     }
     case 'plan-links':
     case 'plan-verify-link':{
      if(body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);const root=manager.scope(view.sessionId,view.root);result=body.action==='plan-links'?await listPlanSourceLinks(root,{planId:body.id,offset:body.offset??0,limit:30}):await readPlanSourceLink(root,body.id);if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目查看关联',409);break;
     }
     case 'plan-link':
     case 'plan-unlink':
     case 'plan-recover-link':{
      manager.fileActionIdle(view,body.epoch);const root=manager.scope(view.sessionId,view.root),sourceId=view.sourceId,sourceRevision=view.sourceRevision,current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root||body.action==='plan-link'&&(view.sourceId!==sourceId||view.sourceRevision!==sourceRevision))throw new SafetyError('工作区或已保存作品版本已切换，请先核对关联',409);manager.fileActionIdle(view,body.epoch);};
      const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
      try{if(body.action==='plan-link'){if(!sourceId||!sourceRevision||body.sourceId!==sourceId||body.sourceRevision!==sourceRevision||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('请选择当前已保存作品和稳定操作身份',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await createPlanSourceLink(root,{planId:body.id,planRevision:body.revision,sourceType:'native',sourceId,sourceRevision,actor:'manual',operationId},controller.signal,current);}else if(body.action==='plan-unlink')result=await unlinkPlanSource(root,body.id,controller.signal,current);else result=await recoverPlanSourceLink(root,body.candidate,controller.signal,current);}
      finally{res.off('close',abort);}break;
     }
     case 'plan-migration_preview':result=previewPlanMigration(manager.scope(view.sessionId,view.root),body);break;
     case 'plan-migrate_resources':manager.fileActionIdle(view,body.epoch);result=migratePlanResources(manager,manager.scope(view.sessionId,view.root),body,undefined,()=>manager.fileActionIdle(view,body.epoch));break;
     case 'plan-restore':
     case 'plan-recover':{
      manager.fileActionIdle(view,body.epoch);
      const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
      try{const operation=body.action==='plan-restore'?restoreDesignPlan:recoverDesignPlan;result=await operation(manager,manager.openDesignLibrary,manager.scope(view.sessionId,view.root),body,controller.signal,()=>manager.fileActionIdle(view,body.epoch));}
      finally{res.off('close',abort);}
      break;
     }
     case 'project-action':{
      if(!['derive','place','open_asset','return_to_design','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','brand'].includes(body.editorAction))throw new SafetyError('未支持的素材动作',422);
      result=await manager.request(view.sessionId,{action:body.editorAction,sourceId:body.sourceId,epoch:body.epoch,base:body.base,payload:body.payload,operationId:body.operationId,initiator:'manual'});break;
     }
     case 'context-command':{
      if(body.epoch!==view.epoch||body.sourceId!==view.sourceId||!manager.matchesBase(view,body.base))throw new SafetyError('对象选区已改变，请重新选择',409);
      const ids=selectedObjectIds(view.document),engine=view.engine,what=body.command,value=body.value;let command,params={};
      const edges={left:['horizontal','left'],center:['horizontal','center'],right:['horizontal','right'],top:['vertical','top'],middle:['vertical','center'],bottom:['vertical','bottom']};
      if(Object.hasOwn(edges,what)&&ids.length>=2&&['vectorcraft','deckcraft','photocraft'].includes(engine)){
       const [axis,edge]=edges[what];
       if(engine==='photocraft'){const names={left:'leftEdges',center:'horizontalCenters',right:'rightEdges',top:'topEdges',middle:'verticalCenters',bottom:'bottomEdges'};command='layer.align.'+names[what];params={to:'layers'};}
       else{command=engine==='vectorcraft'?'object.align':'arrange.align';params=engine==='vectorcraft'?{[axis]:edge,to:'selection'}:{edge:what,to:'selection'};}
      }else if(['distribute-h','distribute-v'].includes(what)&&ids.length>=3&&['vectorcraft','deckcraft','photocraft'].includes(engine)){
       const axis=what==='distribute-h'?'horizontal':'vertical';
       if(engine==='photocraft')command='layer.distribute.'+(axis==='horizontal'?'horizontally':'vertically');
       else{command=engine==='vectorcraft'?'object.distributeSpacing':'arrange.distribute';params=engine==='vectorcraft'?{axis,to:'selection'}:{dir:axis,to:'selection'};}
      }else if(['group','ungroup'].includes(what)&&ids.length>=(what==='group'?2:1)&&['vectorcraft','deckcraft','photocraft'].includes(engine))command=engine==='photocraft'?(what==='group'?'layer.groupLayers':'layer.ungroupLayers'):(engine==='vectorcraft'?'object.':'arrange.')+what;
      else if(what==='fill'&&ids.length===1&&['vectorcraft','deckcraft'].includes(engine)&&typeof value==='string'&&/^#[a-f0-9]{6}$/i.test(value)){command=engine==='vectorcraft'?'paint.setFill':'shape.fill';params={color:value};}
      else if(what==='font'&&ids.length===1&&typeof value==='string'&&value.trim()&&value.length<=200&&!/[\x00-\x1f]/.test(value)){
       command=engine==='vectorcraft'?'text.setStyle':engine==='deckcraft'?'format.font':'type.setStyle';params=engine==='deckcraft'?{family:value.trim()}:{font:value.trim()};
      }
      else if(what==='font-latin-ea'&&engine==='deckcraft'&&ids.length===1&&typeof value==='string'&&value.trim()&&value.length<=200&&!/[\x00-\x1f]/.test(value)){command='format.fontLatinEastAsian';params={family:value.trim()};}
      else if(what==='photo-mask'&&engine==='photocraft'&&ids.length===1){
       const find=nodes=>{for(const node of nodes||[]){if(String(node.id)===String(ids[0]))return node;const child=find(node.children);if(child)return child;}};
       const layer=find(view.document.layers);if(!layer||layer.hasMask!==false)throw new SafetyError('所选图层已有蒙版或状态不可核对，未替换原蒙版',409);
       command='layer.layerMask.revealAll';
      }
      else if(what==='photo-hue-adjustment'&&engine==='photocraft'&&ids.length===1)command='layer.newAdjustmentLayer.hueSaturation';
      else if(what==='photo-opacity'&&engine==='photocraft'&&ids.length===1&&typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1){command='layer.setProps';params={opacity:value};}
      else if(what==='clear-selection'&&engine==='photocraft'&&view.document.nativeSelection?.data?.rasterSelection)command='select.deselect';
      else throw new SafetyError('当前选区不支持此上下文操作',422);
      result=await manager.request(view.sessionId,{action:'execute',sourceId:view.sourceId,epoch:view.epoch,base:body.base,payload:{command,params},operationId:body.operationId,initiator:'manual'});break;
     }
     case 'reconcile-placement':result=await manager.reconcilePlacement(view,body);break;
     case 'instance-links':result=await manager.linked.membership(view,body);break;
     case 'prepare-linked-update':result=await manager.linked.prepare(view,body);break;
     case 'confirm-linked':result=await manager.confirmLinked(view,body);break;
     case 'brand-state':
      if(body.epoch!==view.epoch)throw new SafetyError('当前设计已切换',409);
      result={...await manager.brands.inspect(view),fontState:await manager.fonts.inspect(view)};break;
     case 'brand-start':result=await (manager.jobs.get(body.jobId)?.payload?.command?.startsWith('font-')?manager.fonts:manager.brands).start(view,body);break;
     case 'instance-edit':result=await manager.startInstanceEdit(view,body);break;
     case 'source-origins':result=await manager.sourceOrigins(view,body);break;
     case 'prepare-instance-apply':result=await manager.prepareInstanceApply(view,body);break;
     case 'record-legacy-native-kind':result=await manager.recordLegacyNativeKind(view,body);break;
     case 'prepare-svg-conversion':result=await manager.prepareSvgConversion(view,body);break;
     case 'record-svg-conversion':result=await manager.recordSvgConversion(view,body);break;
     case 'reconcile-svg-conversion':result=await manager.reconcileSvgConversion(view,body);break;
     case 'reconcile-instance-update':result=await manager.reconcileInstanceUpdate(view,body);break;
     case 'heartbeat':result={ready:view.ready,epoch:view.epoch};break;
     case 'select':result=await manager.select(view,body);break;
     case 'copy':result=await manager.copySource(view,body);break;
     case 'unselect':result=await manager.unselect(view,body);break;
     case 'report':result=manager.report(view,body);break;
     case 'poll':result=manager.poll(view);break;
     case 'begin':result=manager.begin(view,body);break;
     case 'finish':result=await manager.finish(view,body);break;
     case 'close':result=manager.close(view);break;
     default:throw new SafetyError('未知设计工作区请求',422);
    }
   }
   sendJson(res,200,{ok:true,...result});
  })},
  {kind:'exact',path:root+'/material',handler:guard(async(req,res)=>{
   const view=viewFor(req);
   if(req.method==='GET'){
    const query=new URL(req.url,'http://localhost').searchParams;
    if(query.get('epoch')!==view.epoch)throw new SafetyError('素材读取上下文已过期',409);
    const variant=query.get('variant');if(variant&&!['preview','source'].includes(variant))throw new SafetyError('素材读取变体无效',422);
    const data=await manager.graph(view.root)[variant==='preview'?'preview':variant==='source'?'assetSource':'asset'](query.get('id'));
    const format=data.format||data.asset.format,mime=format==='source'?'application/octet-stream':format==='svg'?'image/svg+xml':'image/png';
    res.writeHead(200,{'content-type':mime,'content-length':data.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; img-src data:; sandbox",'x-material-sha256':data.sha256||data.asset.sha256});
    res.end(data.bytes);return;
   }
   if(req.method!=='POST')throw new SafetyError('GET or POST required',405);
   if(Number(req.headers['content-length']||0)>8*1024*1024)throw new SafetyError('素材封包超过8MiB预算',413);
   const header=req.headers['x-designcraft-material'];if(typeof header!=='string'||header.length>8192)throw new SafetyError('缺少素材版本标识',422);
   const body=JSON.parse(Buffer.from(header,'base64url').toString('utf8'));
   const result=await manager.addMaterial(view,body,req);sendJson(res,200,{ok:true,...result});
  })},
  {kind:'exact',path:root+'/input',handler:guard(async(req,res)=>{
   if(req.method!=='POST')throw new SafetyError('POST required',405);
   const view=viewFor(req),query=new URL(req.url,'http://localhost').searchParams;
   if(Number(req.headers['content-length']||0)>256*1024*1024)throw new SafetyError('导入源超过256MiB预算',413);
   const result=await manager.preserveInput(view,{epoch:req.headers['x-designcraft-epoch'],sourceId:query.get('id'),name:query.get('name'),jobId:req.headers['x-designcraft-job']},req);
   sendJson(res,200,{ok:true,...result});
  })},
  {kind:'exact',path:root+'/photo-import',handler:guard(async(req,res)=>{
   if(req.method!=='POST')throw new SafetyError('POST required',405);
   const view=viewFor(req),body=await readJsonBody(req,8192);manager.fileActionIdle(view,body.epoch);
   if(typeof body.sourceId!=='string'||!/^import-[a-f0-9-]{36}$/.test(body.sourceId)||!/^[a-f0-9]{64}$/.test(body.sha256||''))throw new SafetyError('图片导入身份无效',422);
   const store=manager.store(view.root),directory=store.directory(body.sourceId);
   if(await store.head(body.sourceId))throw new SafetyError('图片导入目标已存在，未覆盖',409);
   const metadata=JSON.parse(await readFile(workspacePath(view.root,join(directory,'originals',body.sha256+'.json'),{mustExist:true}),'utf8'));
   if(metadata.sha256!==body.sha256||!new RegExp('^'+body.sha256+'\\.(psd|psb|webp|tif|tiff)$').test(metadata.file||'')||metadata.bytes>256*1024*1024)throw new SafetyError('图片导入原件身份无效',422);
   const source=workspacePath(view.root,join(directory,'originals',metadata.file),{mustExist:true}),hash=createHash('sha256');
   for await(const chunk of createReadStream(source))hash.update(chunk);
   if(hash.digest('hex')!==body.sha256)throw new SafetyError('图片导入原件摘要不一致',409);
   const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
   const session=await openNativeSession('photocraft',view.root,{signal:controller.signal});
   try{
    const opened=await session.call('doc_open',{path:source}),info=(await session.call('doc_inspect',{})).data;assertImageSize(info.width,info.height);
    const output=join(session.directory,'imported.pcraft');await session.call('doc_save',{path:output});const bytes=await readFile(output);
    if(!bytes.length||bytes.length>256*1024*1024)throw new SafetyError('转换后的图片源为空或超过预算',413);
    if(view.epoch!==body.epoch||manager.active.get(view.sessionId)!==view.id)throw new SafetyError('转换期间工作区已切换，原始文件已保留',409);
    const warnings=(opened.data?.warnings||[]).filter(item=>typeof item==='string').slice(0,20).map(item=>item.slice(0,200));
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-source-sha256':createHash('sha256').update(bytes).digest('hex'),'x-import-warnings':Buffer.from(JSON.stringify(warnings)).toString('base64url')});res.end(bytes);
   }finally{res.off('close',abort);await session.close();}
  })},
  ...['linked','brand'].map(kind=>({kind:'exact',path:root+'/'+kind+'-source',handler:guard(async(req,res)=>{
   const view=viewFor(req),query=new URL(req.url,'http://localhost').searchParams,body={epoch:req.headers['x-designcraft-epoch']||query.get('epoch'),jobId:query.get('jobId'),sourceId:query.get('sourceId')};
   const updates=kind==='brand'?(manager.jobs.get(query.get('jobId'))?.fontTransactionId?manager.fonts:manager.brands):manager.linked;
   if(req.method==='GET'){
    const {source}=await updates.source(view,body);
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':source.meta.bytes,'cache-control':'no-store','x-source-revision':source.revision,'x-source-sha256':source.meta.sourceHash});await pipeline(createReadStream(source.path),res);return;
   }
   if(req.method!=='POST')throw new SafetyError('GET or POST required',405);
   const header=req.headers['x-designcraft-state'];if(typeof header!=='string'||header.length>4096)throw new SafetyError('关联源缺少有界原生状态',422);
   body.engineState=JSON.parse(Buffer.from(header,'base64url').toString('utf8'));
   const result=await updates.commit(view,body,req);sendJson(res,200,{ok:true,...result});
  })})),
  {kind:'exact',path:root+'/source',handler:guard(async(req,res)=>{
   const view=viewFor(req);
   if(req.method==='GET'){
    const query=new URL(req.url,'http://localhost').searchParams;
    if(query.get('epoch')!==view.epoch||query.get('id')!==view.sourceId)throw new SafetyError('源引用已过期',409);
    const source=await manager.store(view.root).source(view.sourceId);
    if(query.get('revision')!==source.revision)throw new SafetyError('专业源在打开期间被更新，请重新读取',409);
    res.writeHead(200,{'content-type':'application/octet-stream','content-length':source.meta.bytes,'cache-control':'no-store','x-source-revision':source.revision,'x-content-type-options':'nosniff'});
    await pipeline(createReadStream(source.path),res);return;
   }
   if(req.method!=='POST')throw new SafetyError('GET or POST required',405);
   if(Number(req.headers['content-length']||0)>256*1024*1024)throw new SafetyError('专业源超过256MiB预算',413);
   const stateHeader=req.headers['x-designcraft-state'];
   if(typeof stateHeader!=='string'||stateHeader.length>4096)throw new SafetyError('缺少引擎保存标识或标识过大',422);
   const engineState=JSON.parse(Buffer.from(stateHeader,'base64url').toString('utf8'));
   const placementHeader=req.headers['x-designcraft-placement'];if(placementHeader&&placementHeader.length>4096)throw new SafetyError('素材回执过大',413);
   const placement=placementHeader?JSON.parse(Buffer.from(placementHeader,'base64url').toString('utf8')):undefined;
   const updateHeader=req.headers['x-designcraft-instance-update'];if(updateHeader&&updateHeader.length>4096)throw new SafetyError('原位回写回执超过预算',413);
   const instanceUpdate=updateHeader?JSON.parse(Buffer.from(updateHeader,'base64url').toString('utf8')):undefined;
   const imageHeader=req.headers['x-designcraft-image-adoption'];if(imageHeader&&imageHeader.length>4096)throw new SafetyError('图片候选回执超过预算',413);
   const imageAdoption=imageHeader?JSON.parse(Buffer.from(imageHeader,'base64url').toString('utf8')):undefined;
   try{const result=await manager.save(view,{epoch:req.headers['x-designcraft-epoch'],baseRevision:req.headers['x-source-revision']||null,engineState,jobId:req.headers['x-designcraft-job'],placement,instanceUpdate,originAssignment:req.headers['x-designcraft-origin-plan'],imageAdoption},req);sendJson(res,200,{ok:true,...result});}
   catch(error){if(error.feedbackRejected)sendJson(res,error.status||409,{ok:false,error:error.message,feedbackRejected:true});else throw error;}
  })}
 ];
}
