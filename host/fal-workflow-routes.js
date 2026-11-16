/** User-operated fal model workflows in the current DesignCraft view. */
import {createHash} from 'node:crypto';
import * as store from './docstore.js';
import {SafetyError} from './safety.js';
import {detectFalStorageMedia} from './fal-storage-upload.js';
import {detectModelMedia} from './fal-workflow-service.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const availableAsset=/\.(?:zip|png|jpe?g|webp|gif|avif|heic|wav|mp3|flac|ogg|m4a|mp4|webm|glb|pdf)$/i;
export function falWorkflowRoutes(manager,service,{guard,readJsonBody,sendJson}){
 let imports=0;
 const viewFor=request=>manager.getView(request.headers['x-designcraft-view'],request.headers['x-designcraft-capability']);
 const scope=(view,epoch)=>{if(!epoch||view.epoch!==epoch||manager.active.get(view.sessionId)!==view.id)throw new SafetyError('设计工作区已切换',409);return manager.scope(view.sessionId,view.root);};
 return [
  {kind:'exact',path:'/designcraft/api/v2/studio/fal-workflow-file',handler:guard(async(request,response)=>{
   if(request.method!=='POST')throw new SafetyError('POST required',405);const view=viewFor(request),q=new URL(request.url,'http://localhost').searchParams,epoch=q.get('epoch'),root=scope(view,epoch);manager.fileActionIdle(view,epoch);
   if(imports>=2)throw new SafetyError('项目素材导入繁忙，请稍后再试',429);imports++;
   try{
    if(Number(request.headers['content-length'])>64*1024*1024)throw new SafetyError('项目素材超过 64 MiB',413);
    const chunks=[];let length=0;for await(const chunk of request){length+=chunk.length;if(length>64*1024*1024)throw new SafetyError('项目素材超过 64 MiB',413);chunks.push(Buffer.from(chunk));}if(!length)throw new SafetyError('项目素材为空',422);
    const bytes=Buffer.concat(chunks,length),[mime,ext]=detectFalStorageMedia(bytes,detectModelMedia),digest=sha(bytes);if(scope(view,epoch)!==root)throw new SafetyError('设计工作区已切换',409);manager.fileActionIdle(view,epoch);
    const saved=store.saveAsset(root,'falstore-input-'+digest.slice(0,24)+ext,bytes);sendJson(response,200,{ok:true,asset:saved.name,bytes:bytes.length,sha256:digest,mime,note:'已保存项目原件，尚未向 fal 上传。'});
   }finally{imports--;}
  })},
  {kind:'exact',path:'/designcraft/api/v2/studio/fal-workflow',handler:guard(async(request,response)=>{
   if(request.method!=='POST')throw new SafetyError('POST required',405);const body=await readJsonBody(request,512*1024),view=viewFor(request),root=scope(view,body.epoch),write=['start','resume_storage','recover','restore_pending'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);
   const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);const current=()=>{if(scope(view,body.epoch)!==root)throw new SafetyError('设计工作区已切换，请回原项目核对 fal 任务',409);if(write)manager.fileActionIdle(view,body.epoch);};
   try{
    let result;
    if(body.action==='search')result=await service.search(body.provider,{query:body.query||'',category:body.category||'',cursor:body.cursor||''},controller.signal);
    else if(body.action==='inspect')result=await service.inspect(body.provider,body.model,controller.signal);
    else if(body.action==='inputs'){
     const offset=body.offset??0;if(!Number.isSafeInteger(offset)||offset<0)throw new SafetyError('素材分页无效',422);const items=store.listAssets(root).filter(item=>availableAsset.test(item.name)&&!/^fal(?:store|remote)-secret-/.test(item.name));
     if(items.length>10000)throw new SafetyError('项目素材超过列表预算',413);result={items:items.slice(offset,offset+100),offset,nextOffset:offset+100<items.length?offset+100:null,note:'按扩展名列出项目素材，提交时仍按实际文件内容检查。'};
    }else if(body.action==='list'){
     const jobs=service.list(root).map(job=>({id:job.id,model:job.model,provider:job.provider,status:job.status,remote:job.remote,createdAt:job.createdAt,finishedAt:job.finishedAt,outputs:job.outputs.length,uploads:(job.uploads||[]).map(({pointer,state})=>({pointer,state})),remoteLinks:(job.remoteLinks||[]).map(({pointer})=>({pointer}))}));result={jobs};
    }else if(body.action==='status')result={job:service.get(root,body.id)};
    else if(body.action==='pending')result={items:service.pending(root,body.id)};
    else if(body.action==='restore_pending')result=service.restorePending(root,body.id,body.name,body.sha256);
    else if(body.action==='stop')result={stopped:service.stop(root,body.id)};
    else if(body.action==='recover')result=service.recover(root,body.id);
    else if(body.action==='cancel_remote')result=await service.cancelRemote(root,body.id,controller.signal);
    else if(body.action==='resume_storage')result=await service.resumeStorage(root,{id:body.id,input:body.input,assetRefs:body.assetRefs||[],storageAssetRefs:body.storageAssetRefs||[],remoteOutputRefs:body.remoteOutputRefs||[],allowPublicUpload:body.allowPublicUpload===true},controller.signal,current);
    else if(body.action==='start'){
     if(!UUID.test(body.operationKey||''))throw new SafetyError('fal 操作身份无效',422);const operationId=sha(Buffer.from(view.sessionId+'\0'+body.operationKey));
     result=await service.start(root,{provider:body.provider,model:body.model,schemaSha256:body.schemaSha256,input:body.input,assetRefs:body.assetRefs||[],storageAssetRefs:body.storageAssetRefs||[],remoteOutputRefs:body.remoteOutputRefs||[],captureRemoteOutputs:body.captureRemoteOutputs===true,allowPublicUpload:body.allowPublicUpload===true,operationId},controller.signal,current);
    }else throw new SafetyError('未知 fal 工作流操作',422);
    current();sendJson(response,200,{ok:true,...result});
   }finally{response.off('close',abort);}
  })}
 ];
}
