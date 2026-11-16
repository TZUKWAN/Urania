/** Explicit multi-source updates: native Web prepares bytes; this coordinator
 * owns source claims, CAS commits, durable receipts and idempotent progress. */
import {SafetyError,assertSafeJson} from './safety.js';
import {validateNativeIdentity} from '../client/native-contract.js';
import {sameUint64} from '../client/native-protocol.js';
const LIVE_MS=30000;
export class LinkedUpdates {
 constructor(manager){this.manager=manager;}
 job(view,{jobId,epoch},actions=['apply_linked','resume_linked']){
  const job=this.manager.jobs.get(jobId);
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.root!==view.root||job.epoch!==epoch||!actions.includes(job.action)||job.status!=='running'||!job.executionStartedAt)throw new SafetyError('关联动作已过期或未获执行许可',409);
  return job;
 }
 release(job){
  if(job.linkedSaving)return;
  for(const key of job.linkedClaimKeys||[])if(this.manager.claims.get(key)==='linked:'+job.id)this.manager.claims.delete(key);
  job.linkedClaimKeys=[];
 }
 async membership(view,body){
  const job=this.job(view,body,['link_instances','unlink_instance']),graph=this.manager.graph(view.root);
  job.projectMutation=job.action==='link_instances'?await graph.linkInstances({operationId:job.id,instanceIds:job.payload.instanceIds}):await graph.unlinkInstance(job.payload.instanceId);
  if(!await this.manager.record(job))throw new SafetyError('关联关系已保留，操作确认尚未落盘',503);
  return job.projectMutation;
 }
 async reconcile(root,update){
  const m=this.manager,graph=m.graph(root);
  for(const sourceId of Object.keys(update.sources)){
   if(update.committed[sourceId])continue;
   const version=(await m.store(root).versions(sourceId)).find(item=>item.operation?.action==='linked-update'&&item.operation.updateId===update.id);
   if(version)await graph.completeLinkedSource({updateId:update.id,sourceId,sourceRevision:version.revision});
  }
  return (await graph.read()).manifest.updates[update.id];
 }
 async prepare(view,body){
  const m=this.manager,job=this.job(view,body),graph=m.graph(view.root);
  let update;
  if(job.action==='apply_linked'){
   if(!job.material||!job.instanceEdit||job.material.asset.sourceId!==job.instanceEdit.sourceId)throw new SafetyError('尚未保存本次实际图片编辑结果',409);
   ({update}=await graph.prepareLinkedUpdate({operationId:job.id,editId:job.instanceEdit.id,assetId:job.material.asset.id,linkId:job.payload.linkId,instanceIds:job.payload.instanceIds,layoutPolicy:job.payload.layoutPolicy}));
  }else update=(await graph.read()).manifest.updates?.[job.payload.updateId];
  if(!update)throw new SafetyError('待恢复的关联更新不存在',404);
  update=await this.reconcile(view.root,update);if(job.action==='resume_linked')update=await graph.refreshLinkedUpdate(update.id);job.linkedUpdateId=update.id;
  const manifest=(await graph.read()).manifest,targets=[];
  try{
   for(const [sourceId,target]of Object.entries(update.sources)){
    const key=m.leaseKey(view,sourceId),owner=m.views.get(m.leases.get(key)),claim=m.claims.get(key);
    if(claim&&claim!=='linked:'+job.id||owner&&owner.id!==view.id&&(owner.saving||owner.switching||Date.now()-owner.lastSeen<LIVE_MS))throw new SafetyError('关联设计正在另一窗口编辑，请先保存并结束该窗口的编辑',423);
    const source=await m.store(view.root).source(sourceId);
    const expected=update.committed[sourceId]?source.revision:target.baseRevision;
    if(owner?.id===view.id&&(!sameUint64(view.savedEngineRevision,view.document?.revision)||view.sourceRevision!==expected))throw new SafetyError('当前设计需要先保存并与关联更新版本一致',409);
    if(source.revision!==expected)throw new SafetyError('关联设计已有新版本；本次没有覆盖，请保留待恢复更新并核对该设计',409);
    m.claims.set(key,'linked:'+job.id);(job.linkedClaimKeys||=[]).push(key);
    if(update.committed[sourceId]){for(const instanceId of target.instanceIds)await graph.instance(instanceId,{sourceId});continue;}
    if(!['deckcraft','vectorcraft'].includes(source.meta.engine)||target.engine&&target.engine!==source.meta.engine)throw new SafetyError('关联源的实际引擎不一致',409);
    const pages=new Map(),nativeIds=[];
    for(const instanceId of target.instanceIds){
     const instance=manifest.instances[instanceId];if(instance?.linkId!==update.linkId)throw new SafetyError('关联成员已改变',409);
     nativeIds.push(instance.nativeId);
     if(source.meta.engine==='deckcraft'){
      const page=target.pages?.[instanceId];if(page?.kind!=='slide')throw new SafetyError('关联幻灯片页面已改变',409);
      if(!pages.has(page.id))pages.set(page.id,{id:page.id,ids:[]});pages.get(page.id).ids.push(Number(instance.nativeId));
     }
    }
    const frames=await graph.linkedFrames(update,sourceId);
    targets.push({sourceId,engine:source.meta.engine,baseRevision:target.baseRevision,title:source.meta.title,sourceHash:source.meta.sourceHash,frames,...(source.meta.engine==='deckcraft'?{pages:[...pages.values()]}:{nativeIds})});
   }
   job.linkedUpdate=update;if(!await m.record(job))throw new SafetyError('关联更新记录尚未落盘，没有开始原生替换',503);
   return {projectId:manifest.id,update,asset:(await graph.asset(update.assetId)).asset,targets};
  }catch(error){this.release(job);throw error;}
 }
 async source(view,body){
  const m=this.manager,job=this.job(view,body),update=(await m.graph(view.root).read()).manifest.updates?.[job.linkedUpdateId],target=update?.sources[body.sourceId];
  if(!target||update.committed[body.sourceId]||m.claims.get(m.leaseKey(view,body.sourceId))!=='linked:'+job.id)throw new SafetyError('关联源未获独占准备许可或已完成，未重复读取执行',409);
  const source=await m.store(view.root).source(body.sourceId);
  if(source.revision!==target.baseRevision)throw new SafetyError('关联设计在准备期间已更新，未覆盖',409);
  return {job,update,target,source};
 }
 async commit(view,body,input){
  const m=this.manager,job=this.job(view,body);if(job.linkedSaving)throw new SafetyError('关联源正在提交',423);
  job.linkedSaving=true;
  try{
   const {update,target,source}=await this.source(view,body);assertSafeJson(body.engineState);validateNativeIdentity(body.engineState);
   const chunks=[];let count=0;for await(const chunk of input){count+=chunk.byteLength;if(count>256*1024*1024)throw new SafetyError('关联源超过256MiB预算',413);chunks.push(chunk);view.lastSeen=Date.now();}
   this.job(view,body);const bytes=Buffer.concat(chunks);await m.graph(view.root).verifyLinkedSource(update.id,body.sourceId,bytes);
   const result=await m.store(view.root).commit(body.sourceId,{engine:source.meta.engine,title:source.meta.title,baseRevision:target.baseRevision,bytes,engineState:body.engineState,actor:job.initiator,operation:{action:'linked-update',id:update.id.slice(7),updateId:update.id,linkId:update.linkId,assetId:update.assetId,baseRevision:target.baseRevision,instanceIds:target.instanceIds}});
   // A lost response here is recovered from the source receipt, never by replaying the command.
   const progress=await m.graph(view.root).completeLinkedSource({updateId:update.id,sourceId:body.sourceId,sourceRevision:result.revision});
   job.linkedUpdate=progress.update;await m.record(job);m.onChange(view.root,{kind:'native-source',id:body.sourceId,revision:result.revision});
   return {revision:result.revision,update:progress.update};
  }finally{job.linkedSaving=false;if(job.status!=='running')this.release(job);}
 }
}
