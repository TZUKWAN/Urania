import {createHash} from 'node:crypto';
import {SafetyError} from './safety.js';

export function pixelbinRoutes(manager,service,{guard,readJsonBody,sendJson}){
 const base='/designcraft/api/v2/studio/pixelbin';
 return [{kind:'exact',path:base,handler:guard(async(request,response)=>{
  if(request.method!=='POST')throw new SafetyError('POST required',405);const body=await readJsonBody(request,512*1024),view=manager.getView(request.headers['x-designcraft-view'],request.headers['x-designcraft-capability']);
  if(!body.epoch||body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);const root=manager.scope(view.sessionId,view.root),owner=createHash('sha256').update(view.sessionId+'\0'+root).digest('hex');
  const write=['start','capture','recover-asset','open','reconcile','upload','save-remote','operation-recover'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);
  const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
  const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对 PixelBin 记录',409);if(write)manager.fileActionIdle(view,body.epoch);};
  try{
   let result;
   if(body.action==='auth-status')result=await service.oauth.status(controller.signal);
   else if(body.action==='auth-begin')result=await service.oauth.begin(owner,controller.signal);
   else if(body.action==='auth-check')result=await service.oauth.check(owner,body.authId,controller.signal);
   else if(body.action==='auth-candidates')result={items:await service.oauth.pendingCredentials(controller.signal)};
   else if(body.action==='auth-recover')result=await service.oauth.recover(body.candidate,controller.signal);
   else if(body.action==='auth-select')result=await service.oauth.select(body.source,controller.signal);
   else if(body.action==='auth-disconnect')result=await service.oauth.disconnect();
   else if(body.action==='catalog')result=await service.catalog(controller.signal);
   else if(body.action==='read')result=await service.read(root,{tool:body.tool,args:body.args,schemaSha256:body.schemaSha256},controller.signal);
   else if(body.action==='snapshot')result=service.readSnapshot(root,body.snapshotId,{offset:body.offset??0,limit:12000});
   else if(body.action==='estimate')result=await service.estimate(root,{args:body.args,schemaSha256:body.schemaSha256},controller.signal);
   else if(body.action==='jobs')result={jobs:service.list(root)};
   else if(body.action==='job')result={job:service.get(root,body.id)};
   else if(body.action==='result')result=service.readResult(root,body.id,{offset:body.offset??0,limit:12000});
   else if(body.action==='refresh')result=await service.refresh(root,body.id,body.schemaSha256,controller.signal,current);
   else if(body.action==='stop')result={stopped:service.stop(root,body.id)};
   else if(body.action==='candidates')result=service.candidates(root,body.snapshotId);
   else if(body.action==='capture')result=await service.capture(root,body.snapshotId,body.candidateId,controller.signal,current);
   else if(body.action==='assets')result=await service.assets(root);
   else if(body.action==='recover-asset')result=await service.recoverAsset(root,body.candidate,controller.signal,current);
   else if(body.action==='reconcile')result=await service.reconcile(root,body.id,controller.signal,current);
   else if(body.action==='operations')result={operations:service.operations.list(root)};
   else if(body.action==='operation-status')result={operation:service.operations.get(root,body.id)};
   else if(body.action==='operation-result')result=service.operations.readResult(root,body.id,{offset:body.offset??0,limit:12000});
   else if(body.action==='operation-recover')result=service.operations.recoverSaved(root,body.id,current);
   else if(body.action==='operation-stop')result={stopped:service.operations.stop(root,body.id)};
   else if(['start','upload','save-remote'].includes(body.action)){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('PixelBin 操作身份无效',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');
    result=body.action==='start'?await service.start(root,{args:body.args,schemaSha256:body.schemaSha256,estimateId:body.estimateId,operationId},controller.signal,current):await service.operations.start(root,{operation:body.action==='upload'?'upload':'save',args:body.args,schemaSha256:body.schemaSha256,sourceAsset:body.sourceAsset,allowPublic:body.allowPublic===true,operationId},controller.signal,current);
   }else if(body.action==='open'){
    const key='ui-open-'+String(body.assetId||'');result=await service.open(root,view.sessionId,body.assetId,key,controller.signal);
   }else throw new SafetyError('未知 PixelBin 操作',422);
   if(body.action==='open'){if(manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对图片导入',409);}else current();sendJson(response,200,{ok:true,...result});
  }catch(error){
   let retained;try{if(manager.active.get(view.sessionId)===view.id&&view.epoch===body.epoch&&manager.scope(view.sessionId)===root)retained=error.retained;}catch{}
   if(retained&&!response.destroyed&&!response.writableEnded){sendJson(response,error.status||500,{ok:false,error:String(error.message||error),...retained,readStateBeforeRetry:true});return;}throw error;
  }finally{response.off('close',abort);}
 })}];
}
