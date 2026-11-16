import {SafetyError} from './safety.js';
import {prepareWorkflowImage,listWorkflowImages,recoverWorkflowImage,openWorkflowImage,reconcileWorkflowImage} from './workflow-image-import.js';

export function workflowImageRoutes(manager,fal,replicate,{guard,readJsonBody,sendJson}){
 return [{kind:'exact',path:'/designcraft/api/v2/studio/workflow-images',handler:guard(async(request,response)=>{
  if(request.method!=='POST')throw new SafetyError('POST required',405);const body=await readJsonBody(request,64*1024),view=manager.getView(request.headers['x-designcraft-view'],request.headers['x-designcraft-capability']);if(!body.epoch||body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);const root=manager.scope(view.sessionId,view.root),write=['prepare','recover','open','reconcile'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);
  const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对工作流图片',409);if(write)manager.fileActionIdle(view,body.epoch);};
  try{let result;
   if(body.action==='list'){
    const jobs=[...fal.list(root).map(job=>({provider:'fal',job})),...replicate.list(root).map(job=>({provider:'replicate',job}))],outputs=[];
    for(const {provider,job}of jobs)if(job.status==='ready')for(const item of job.outputs||[])if(['image/png','image/jpeg'].includes(item.detectedMime)&&item.bytes<=16*1024*1024)outputs.push({provider,jobId:job.id,model:job.model,pointer:item.pointer,asset:item.asset,bytes:item.bytes,sha256:item.sha256});
    result={outputs,sources:await listWorkflowImages(root),note:'列表来自已保存的任务；打开前会重新核对实际来源和图片字节。'};
   }else if(body.action==='prepare')result=await prepareWorkflowImage(root,body.provider,body.jobId,body.pointer,controller.signal,current);
   else if(body.action==='recover')result=await recoverWorkflowImage(root,body.candidate,controller.signal,current);
   else if(body.action==='reconcile')result=await reconcileWorkflowImage(manager,root,body.id,controller.signal,current);
   else if(body.action==='open')result=await openWorkflowImage(manager,root,view.sessionId,body.imageId,'ui-open-'+String(body.imageId||''),controller.signal);
   else throw new SafetyError('未知工作流图片动作',422);
   if(body.action==='open'){if(manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对图片导入',409);}else current();sendJson(response,200,{ok:true,...result});
  }catch(error){let retained;try{if(manager.active.get(view.sessionId)===view.id&&view.epoch===body.epoch&&manager.scope(view.sessionId)===root)retained=error.retained;}catch{}if(retained&&!response.destroyed&&!response.writableEnded){sendJson(response,error.status||500,{ok:false,error:String(error.message||error),...retained,readStateBeforeRetry:true});return;}throw error;}
  finally{response.off('close',abort);}
 })}];
}
