import {DesignPlans} from './design-plans.js';
import {readFile,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import * as assets from './docstore.js';
import {SafetyError,workspacePath} from './safety.js';
import {sameUint64} from '../client/native-protocol.js';
import {previewImageSize} from './image-header.js';
import {imageBaselineMatches} from '../client/image-adoption.js';
import {VENICE_IMAGE_MODES} from './venice-image-transform.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Real image jobs shared by the native workspace and its DSH conversation. */
export class StudioImage {
 constructor(manager,images){this.manager=manager;this.images=images;}
 root(view){return this.manager.scope(view.sessionId,view.root);}
 async start(view,payload,{signal}={}){
  signal?.throwIfAborted();this.manager.fileActionIdle(view,payload.epoch);
  const root=this.root(view),mode=payload.mode||'generate';
  if(VENICE_IMAGE_MODES.includes(mode)){
   if(payload.resolution!=null&&payload.resolution!==''||payload.aspectRatio!=null&&payload.aspectRatio!==''||payload.transparentBackground!=null||payload.quality!=null||payload.styleReferenceAssets!=null||payload.styleReferenceHashes!=null||payload.styleReferenceStrength!=null)throw new SafetyError('图片放大和背景移除不接受生成模型的尺寸、画质、透明背景或风格参考参数',422);
   const current=()=>{if(this.manager.active.get(view.sessionId)!==view.id||view.epoch!==payload.epoch||this.manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，未发送图片处理请求',409);this.manager.fileActionIdle(view,payload.epoch);};
   return this.images.startVeniceTransform({root,sessionId:view.sessionId,operationId:payload.operationId,mode,provider:payload.provider,referenceAssets:payload.referenceAssets,referenceHashes:payload.referenceHashes,scale:payload.scale,creativity:payload.creativity,count:payload.count,model:payload.model,prompt:payload.prompt},{signal,assertCurrent:current});
  }
  if(mode==='edit'){
   if(view.engine!=='photocraft'||!view.ready||!view.document?.nativeSelection?.data?.rasterSelection)throw new SafetyError('请先在当前原生图片中创建选区',422);
   if(payload.sourceId!==view.sourceId||payload.sourceRevision!==view.sourceRevision||payload.selectionStamp!==view.document.selectionStamp||!sameUint64(view.savedEngineRevision,view.document.revision))throw new SafetyError('图片或选区已改变，请重新保存并选择',409);
   const current=await this.manager.store(root).head(view.sourceId);
   if(!current||current.revision!==view.sourceRevision)throw new SafetyError('图片源已有新版本，请重新打开',409);
  }
  const current=()=>{if(this.manager.active.get(view.sessionId)!==view.id||view.epoch!==payload.epoch||this.manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，未提交图片请求',409);this.manager.fileActionIdle(view,payload.epoch);if(mode==='edit'&&(payload.sourceId!==view.sourceId||payload.sourceRevision!==view.sourceRevision||payload.selectionStamp!==view.document?.selectionStamp||!sameUint64(view.savedEngineRevision,view.document?.revision)))throw new SafetyError('图片或选区在准备期间已改变，未提交请求',409);};
  return this.images.startStudio({root,sessionId:view.sessionId,operationId:payload.operationId,mode,sourceId:mode==='edit'?view.sourceId:undefined,sourceRevision:mode==='edit'?view.sourceRevision:undefined,provider:payload.provider,planId:payload.planId,planRevision:payload.planRevision,...(payload.connectionFingerprint!==undefined?{connectionFingerprint:payload.connectionFingerprint}:{}),model:payload.model,prompt:payload.prompt,count:payload.count,resolution:payload.resolution,aspectRatio:payload.aspectRatio,referenceAssets:payload.referenceAssets,...(mode==='generate'&&payload.referenceHashes!==undefined?{referenceHashes:payload.referenceHashes}:{}),...(mode==='edit'&&payload.editReferenceHashes!==undefined?{editReferenceHashes:payload.editReferenceHashes}:{}),...(payload.styleReferenceAssets!==undefined?{styleReferenceAssets:payload.styleReferenceAssets}:{}),...(payload.styleReferenceHashes!==undefined?{styleReferenceHashes:payload.styleReferenceHashes}:{}),...(payload.styleReferenceStrength!==undefined?{styleReferenceStrength:payload.styleReferenceStrength}:{}),transparentBackground:payload.transparentBackground,quality:payload.quality},{signal,assertCurrent:current});
 }
 list(view){return this.images.list(this.root(view)).filter(job=>job.studio);}
 get(view,id){const job=this.images.get(this.root(view),id);if(!job.studio)throw new SafetyError('图片任务不属于专业工作区',404);return job;}
 cancel(view,id){this.get(view,id);return this.images.cancel(this.root(view),id);}
 recoverFal(view,id){this.get(view,id);return this.images.recoverFal(this.root(view),id);}
 convertReturned(view,id,outputId){this.get(view,id);return this.images.convertReturned(this.root(view),id,outputId);}
 cancelRemoteFal(view,id,signal){this.get(view,id);return this.images.cancelRemoteFal(this.root(view),id,signal);}
 file(view,id,candidateId,variant){
  const root=this.root(view),job=this.get(view,id);
  if(variant==='returned'){
   const output=Array.isArray(job.returnedImages)?job.returnedImages.find(item=>item.id===candidateId):null;
   if(!output||!['image/png','image/jpeg','image/webp'].includes(output.mime))throw new SafetyError('服务原图不存在',404);
   const bytes=assets.readAsset(root,output.asset);if(!bytes||bytes.length!==output.bytes||digest(bytes)!==output.sha256)throw new SafetyError('服务原图完整性失败',409);
   return {bytes,output,type:output.mime};
  }
  const candidate=job.candidates.find(item=>item.id===candidateId);
  if(!candidate||!['source','preview'].includes(variant))throw new SafetyError('图片候选不存在',404);
  const bytes=assets.readAsset(root,variant==='source'?candidate.native.source:candidate.asset);
  if(!bytes)throw new SafetyError('候选源文件不存在',404);
  if(variant==='source'&&digest(bytes)!==candidate.sourceHash)throw new SafetyError('图片候选源文件完整性失败',409);
  return {bytes,candidate,type:variant==='source'?'application/octet-stream':'image/png'};
 }
 async matches(view,id,candidateId){
  const root=this.root(view),{candidate}=this.file(view,id,candidateId,'source'),store=this.manager.store(root),matches=[];let scanned=0;
  for(const source of await store.list()){
   if(source.error||source.engine!=='photocraft')continue;
   const versions=await store.versions(source.id);scanned+=versions.length;if(scanned>20000)throw new SafetyError('图片候选历史核对超过预算，请拆分项目',413);
   const adoption=versions.find(version=>version.operation?.action==='image-adopt'&&version.operation.imageJobId===id&&version.operation.candidateId===candidateId&&version.operation.sourceHash===candidate.sourceHash);
   if(adoption){matches.push({sourceId:source.id,sourceRevision:adoption.revision,currentRevision:source.revision,title:source.title,inPlace:true});continue;}
   const file=workspacePath(root,join(store.directory(source.id),'originals',candidate.sourceHash+'.pcraft'));
   try{if((await stat(file)).size<=64*1024*1024&&digest(await readFile(file))===candidate.sourceHash)matches.push({sourceId:source.id,sourceRevision:source.revision,title:source.title});}
   catch(error){if(error.code!=='ENOENT')throw error;}
  }
  return matches;
 }
 admission(view,epoch,operationJobId){
  if(!operationJobId)return this.manager.fileActionIdle(view,epoch);
  const job=this.manager.jobs.get(operationJobId);
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||!['image_adopt','image_undo'].includes(job.action)||job.status!=='running'||!job.executionStartedAt||job.cancelRequested||view.saving||view.switching)throw new SafetyError('图片采用或撤销动作没有有效许可',409);
 }
 async link(view,{id,candidateId,sourceId,epoch,operationJobId}){
  this.admission(view,epoch,operationJobId);
  const match=(await this.matches(view,id,candidateId)).find(item=>item.sourceId===sourceId);
  if(!match)throw new SafetyError('导入的原生图片与候选字节不一致，未登记采用',409);
  return this.images.linkStudio(this.root(view),id,candidateId,sourceId,match.sourceRevision);
 }
 async prepareInPlace(view,{id,candidateId,epoch,operationJobId}){
  this.admission(view,epoch,operationJobId);
  if(operationJobId){const operation=this.manager.jobs.get(operationJobId);if(operation.payload.id!==id||operation.payload.candidateId!==candidateId)throw new SafetyError('图片候选不属于当前采用动作',409);}
  const job=this.get(view,id),baseline=job.studio?.source,{candidate}=this.file(view,id,candidateId,'source');
  if(job.mode!=='edit'||!baseline||view.engine!=='photocraft'||view.sourceId!==baseline.sourceId||!sameUint64(view.savedEngineRevision,view.document?.revision))throw new SafetyError('原图片已改变；请打开独立候选，未覆盖后续修改',409);
  const head=await this.manager.store(view.root).head(view.sourceId);if(head?.revision!==view.sourceRevision||!imageBaselineMatches({...head?.meta,revision:head?.revision},job))throw new SafetyError('原图片已有其他保存版本，未覆盖',409);
  if(['queued','running'].includes(job.status))throw new SafetyError('图片任务尚未完成',409);
  const plan={id:randomUUID(),epoch,sourceId:view.sourceId,baseRevision:head.revision,imageJobId:id,candidateId,sourceHash:candidate.sourceHash,...(operationJobId?{operationJobId}:{})};view.imagePlan=plan;return {plan};
 }
 async prepareUndo(view,{epoch,operationJobId}){
  this.admission(view,epoch,operationJobId);
  if(operationJobId&&this.manager.jobs.get(operationJobId)?.action!=='image_undo')throw new SafetyError('当前动作不是图片撤销',409);
  if(view.engine!=='photocraft'||!view.sourceId||!sameUint64(view.savedEngineRevision,view.document?.revision))throw new SafetyError('请先保存当前图片',409);
  const store=this.manager.store(view.root),head=await store.head(view.sourceId),op=head?.meta.operation;
  if(!head||head.revision!==view.sourceRevision||op?.action!=='image-adopt')throw new SafetyError('图片采用后已有其他修改，未自动撤销',409);
  const job=this.get(view,op.imageJobId),candidate=job.candidates.find(item=>item.id===op.candidateId);
  if(!candidate||candidate.sourceHash!==op.sourceHash||job.studio?.source?.sourceId!==view.sourceId||op.originalRevision&&job.studio.source.sourceRevision!==op.originalRevision)throw new SafetyError('原图片候选回执不完整，未撤销',409);
  if(!op.originalRevision&&op.baseRevision!==job.studio.source.sourceRevision){const base=await store.source(view.sourceId,op.baseRevision);if(base.meta.sourceHash!==job.studio.source.sourceHash)throw new SafetyError('原图片候选基线不一致，未撤销',409);}
  const original=await store.source(view.sourceId,job.studio.source.sourceRevision);if(original.meta.sourceHash!==job.studio.source.sourceHash)throw new SafetyError('原图片基线摘要不一致，未撤销',409);
  const plan={type:'undo',id:randomUUID(),epoch,sourceId:view.sourceId,baseRevision:head.revision,restoreRevision:original.revision,imageJobId:op.imageJobId,candidateId:op.candidateId,sourceHash:original.meta.sourceHash,...(operationJobId?{operationJobId}:{})};
  view.imagePlan=plan;return {plan};
 }
 async undoSource(view,{epoch,planId}){
  const plan=view.imagePlan;if(!plan||plan.type!=='undo'||plan.id!==planId||plan.epoch!==epoch||view.epoch!==epoch||plan.sourceId!==view.sourceId||plan.baseRevision!==view.sourceRevision)throw new SafetyError('图片撤销许可已过期',409);
  const source=await this.manager.store(view.root).read(plan.sourceId,plan.restoreRevision);
  if(source.meta.sourceHash!==plan.sourceHash)throw new SafetyError('图片撤销源完整性失败',409);return source;
 }
 async reconcileInPlace(view,{id,candidateId,planId,sourceId,baseRevision,type,restoreRevision}){
  const job=this.get(view,id),candidate=job.candidates.find(item=>item.id===candidateId);
  const undo=type==='undo';
  if(!candidate||!/^[-a-f0-9]{36}$/.test(planId||'')||view.sourceId!==sourceId||job.studio?.source?.sourceId!==sourceId||undo&&job.studio.source.sourceRevision!==restoreRevision)throw new SafetyError('图片候选核对身份无效',409);
  const store=this.manager.store(view.root),versions=await store.versions(sourceId),found=versions.filter(version=>version.operation?.action===(undo?'image-revert':'image-adopt')&&version.operation.id===planId&&version.operation.imageJobId===id&&version.operation.candidateId===candidateId&&version.operation.baseRevision===baseRevision&&(undo?version.operation.restoreRevision===restoreRevision:version.operation.sourceHash===candidate.sourceHash));
  if(found.length!==1)throw new SafetyError('未找到唯一的已保存图片候选回执；不会重复采用',409);
  if(!undo){const op=found[0].operation;if(op.originalRevision&&op.originalRevision!==job.studio.source.sourceRevision)throw new SafetyError('图片候选核对基线不一致',409);if(!op.originalRevision&&op.baseRevision!==job.studio.source.sourceRevision&&(await store.source(sourceId,op.baseRevision)).meta.sourceHash!==job.studio.source.sourceHash)throw new SafetyError('图片候选核对基线不一致',409);}
  return {receipt:{sourceId,sourceRevision:found[0].revision,imageJobId:id,candidateId,sourceHash:found[0].operation.sourceHash,kind:undo?'undo':'adopt'},currentRevision:versions[0]?.revision};
 }
}

export function studioImageRoutes(service,{guard,readJsonBody,sendJson}){
 const base='/designcraft/api/v2/studio/image',viewFor=req=>service.manager.getView(req.headers['x-designcraft-view'],req.headers['x-designcraft-capability']);
 return [
  {kind:'exact',path:base+'-reference',handler:guard(async(req,res)=>{
   if(req.method!=='POST')throw new SafetyError('POST required',405);
   const view=viewFor(req),q=new URL(req.url,'http://localhost').searchParams;
   if(q.get('epoch')!==view.epoch)throw new SafetyError('设计工作区已切换',409);
   const chunks=[];let length=0;for await(const chunk of req){length+=chunk.length;if(length>8*1024*1024)throw new SafetyError('参考图超过8MiB预算',413);chunks.push(chunk);}
   const bytes=Buffer.concat(chunks,length),png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216;
   if(!png&&!jpeg)throw new SafetyError('参考图必须是实际 PNG 或 JPEG',422);
   const size=previewImageSize(bytes),saved=assets.saveAsset(service.root(view),'image-reference-'+randomUUID()+(png?'.png':'.jpg'),bytes);
   if(q.get('epoch')!==view.epoch)throw new SafetyError('工作区已切换，参考原件已保留但未附加',409);
   sendJson(res,200,{ok:true,name:saved.name,bytes:bytes.length,sha256:digest(bytes),width:size.width,height:size.height});
  })},
  {kind:'exact',path:base+'-undo-source',handler:guard(async(req,res)=>{
   if(req.method!=='GET')throw new SafetyError('GET required',405);
   const view=viewFor(req),q=new URL(req.url,'http://localhost').searchParams,source=await service.undoSource(view,{epoch:q.get('epoch'),planId:q.get('planId')});
   res.writeHead(200,{'content-type':'application/octet-stream','content-length':source.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-source-sha256':source.meta.sourceHash});res.end(source.bytes);
  })},
  {kind:'exact',path:base,handler:guard(async(req,res)=>{
   if(req.method!=='POST')throw new SafetyError('POST required',405);
   const body=await readJsonBody(req,1024*1024),view=viewFor(req);
   if(body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);
   let result;
   switch(body.action){
    case 'plans':result={plans:new DesignPlans(service.root(view)).list()};break;
    case 'api-settings':result=await service.images.providers.imageSettings.describe();break;
    case 'save-api-settings':
    case 'clear-api-settings':{
     const assertCurrent=()=>{const current=viewFor(req);if(res.destroyed||body.epoch!==current.epoch||current.root!==view.root)throw new SafetyError('设计工作区已切换或请求已结束，请重新打开设置',409);};
     result=await service.images.providers.imageSettings.save(body.config,{clear:body.action==='clear-api-settings',assertCurrent});service.images.providers.cache.clear();break;
    }
    case 'catalog':result=await service.images.providers.catalogue(body.provider);break;
    case 'transform-catalog':result=await service.images.providers.transformCatalogue();break;
    case 'list':result={jobs:service.list(view)};break;
    case 'start':{
     const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};
     res.once('close',abort);if(res.destroyed)controller.abort();
     try{result=await service.start(view,body,{signal:controller.signal});}finally{res.off('close',abort);}
     break;
    }
    case 'cancel':result={cancelled:service.cancel(view,body.id)};break;
    case 'recover-fal':result=service.recoverFal(view,body.id);break;
    case 'convert-returned':result=service.convertReturned(view,body.id,body.outputId);break;
    case 'cancel-remote-fal':result=await service.cancelRemoteFal(view,body.id);break;
    case 'matches':result={sources:await service.matches(view,body.id,body.candidateId)};break;
    case 'link':result={job:await service.link(view,body)};break;
    case 'prepare-inplace':result=await service.prepareInPlace(view,body);break;
    case 'prepare-undo':result=await service.prepareUndo(view,body);break;
    case 'reconcile-inplace':result=await service.reconcileInPlace(view,body);break;
    default:throw new SafetyError('未知图片工作区操作',422);
   }
   sendJson(res,200,{ok:true,...result});
  })},
  {kind:'exact',path:base+'-file',handler:guard(async(req,res)=>{
   if(req.method!=='GET')throw new SafetyError('GET required',405);
   const q=new URL(req.url,'http://localhost').searchParams,view=viewFor(req);
   if(q.get('epoch')!==view.epoch)throw new SafetyError('设计工作区已切换',409);
   const result=service.file(view,q.get('id'),q.get('candidateId'),q.get('variant'));
   res.writeHead(200,{'content-type':result.type,'content-length':result.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff','x-content-sha256':digest(result.bytes)});res.end(result.bytes);
  })}
 ];
}

export function registerStudioImageTool(ctx,service){
 ctx.inject(['tools'],scope=>{
  const dispose=scope.tools.register({name:'designcraft_image_studio',description:'Generate images or precisely edit the active Photo selection using a real configured DSH image provider. First read designcraft_editor state. edit requires its exact live sourceId, epoch, base and saved native selection; a fresh source checkpoint is captured before the paid request. Venice payload.resolution and payload.aspectRatio may be set only to values in the actual selected model catalogue for the active generation or edit endpoint; single-image edits may explicitly disallow changing aspect ratio, and precise selection edits do not accept an aspect-ratio parameter. For exact OpenAI models named in official documentation, the returned resolution choices are conservative pixel sizes; independent generation can use one as payload.resolution, while precise selection edit cannot change size. Venice and OpenAI payload.quality may be set only to an available qualityGenerate or, with reference images or selection edit, qualityEdit value. OpenAI options come from official model documentation; Venice options come from its actual catalogue. Quality and size affect cost; omission uses the service default. For an explicitly requested Venice text-to-image job, styleReferenceAssets may name real saved PNG/JPEG files only when the actual model catalogue declares styleReferenceMax; optional styleReferenceStrength requires its separate capability. Style references cannot be combined with ordinary image references or selection edits and may incur additional fees. For an independent Venice or OpenAI generation, payload.transparentBackground=true is allowed only for the selected model with transparentGenerate or, with reference images, transparentEdit. Venice flags come from its actual model catalogue; OpenAI flags identify exact models named in official documentation, and gpt-image-2 transparency is preview. It is unavailable for local selection edit; returned transparency and visual quality still require checking. transform_catalog lists locally configured Venice connections, not verified account access. When explicitly requested, start can use payload.mode venice_upscale or venice_remove_background with provider and exactly one real saved PNG/JPEG referenceAssets name; upscale accepts scale 2 or 4 and creativity 0 to 0.02. These synchronous external operations can be billable, return a separate candidate, and do not modify the source. Their actual size, alpha and image quality require checking; uncertain requests cannot be retrieved or automatically repeated. Optional payload.planId and payload.planRevision pin an exact saved DesignCraft plan; the job/candidate trace records actual bytes but does not certify model compliance. start only queues a job; status lists real saved candidates and any additional returnedImages. convert_returned converts one already saved outputId into a candidate without another service call; its acceptance is not completion, so inspect status. adopt requires the real job id, candidateId and fresh sourceId/epoch/base, and applies a selected edit candidate to the same unchanged native Photo source after an exact content proof. undo restores the immediately preceding source only when no later saved edits exist. Parent poster/slide navigation is retained; then designcraft_editor apply_instance can return the image to its original layout. Do not retry interrupted or uncertain paid requests or unconfirmed adoptions automatically; inspect durable status first.',
   parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['catalog','transform_catalog','list','status','start','cancel','recover_fal','convert_returned','cancel_remote_fal','adopt','undo']},id:{type:'string'},outputId:{type:'string'},candidateId:{type:'string'},sourceId:{type:'string'},epoch:{type:'string'},base:{type:'object'},payload:{type:'object'}}},
   output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},timeoutMs:90000,isConcurrencySafe:args=>['catalog','transform_catalog','list','status'].includes(args.action),
   async execute(args,exec){try{
    const session=exec.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('当前 DSH 对话没有工作区',422);
    const manager=service.manager,view=manager.views.get(manager.active.get(session.id));
    if(!view||view.root!==manager.scope(session.id)||Date.now()-view.lastSeen>=30000)throw new SafetyError('请先打开当前对话的设计工作区',409);
    const payload=args.payload||{};let result;
    if(args.action==='catalog')result=await service.images.providers.catalogue(payload.provider);
    else if(args.action==='transform_catalog')result=await service.images.providers.transformCatalogue();
    else if(args.action==='list')result={jobs:service.list(view)};
    else if(args.action==='status')result={job:service.get(view,args.id)};
    else if(args.action==='cancel')result={cancelled:service.cancel(view,args.id)};
    else if(args.action==='recover_fal')result=service.recoverFal(view,args.id);
    else if(args.action==='convert_returned')result=service.convertReturned(view,args.id,args.outputId);
    else if(args.action==='cancel_remote_fal')result=await service.cancelRemoteFal(view,args.id,exec.signal);
    else if(args.action==='adopt'){
     if(args.sourceId!==view.sourceId||args.epoch!==view.epoch||!manager.matchesBase(view,args.base))throw new SafetyError('图片或选区已变化，请先读取工作区状态',409);
     result=await manager.request(session.id,{action:'image_adopt',sourceId:args.sourceId,epoch:args.epoch,base:args.base,payload:{id:args.id,candidateId:args.candidateId},operationId:exec.callId},exec.signal);
    }
    else if(args.action==='undo'){
     if(args.sourceId!==view.sourceId||args.epoch!==view.epoch||!manager.matchesBase(view,args.base))throw new SafetyError('图片或选区已变化，请先读取工作区状态',409);
     result=await manager.request(session.id,{action:'image_undo',sourceId:args.sourceId,epoch:args.epoch,base:args.base,operationId:exec.callId},exec.signal);
    }
    else{
     if(payload.mode==='edit'){
      if(args.sourceId!==view.sourceId||args.epoch!==view.epoch||!manager.matchesBase(view,args.base))throw new SafetyError('图片引用或选区已改变，请先读取工作区状态',409);
      const stamp=view.document.selectionStamp;
      await manager.request(session.id,{action:'save',sourceId:view.sourceId,epoch:view.epoch,base:args.base,operationId:exec.callId},exec.signal);
      if(view.document?.selectionStamp!==stamp)throw new SafetyError('保存时图片选区已改变，未提交生图请求',409);
     }
     const raw=createHash('sha256').update(String(exec.callId||randomUUID())).digest('hex').slice(0,32),operationId=raw.slice(0,8)+'-'+raw.slice(8,12)+'-'+raw.slice(12,16)+'-'+raw.slice(16,20)+'-'+raw.slice(20);
     result=await service.start(view,{...payload,operationId,epoch:view.epoch,sourceId:view.sourceId,sourceRevision:view.sourceRevision,selectionStamp:view.document?.selectionStamp},{signal:exec.signal});
    }
    return {json:JSON.stringify({ok:true,...result})};
   }catch(error){return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),readStateBeforeRetry:true})};}}
  });
  scope.effect(()=>()=>dispose?.(),'designcraft: studio image tools');
 });
}
