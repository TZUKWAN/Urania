import {createHash} from 'node:crypto';
import {SafetyError} from './safety.js';

export function ecommerceRoutes(manager,service,{guard,readJsonBody,sendJson}){
 return [{kind:'exact',path:'/designcraft/api/v2/studio/ecommerce',handler:guard(async(request,response)=>{
  if(request.method!=='POST')throw new SafetyError('POST required',405);const body=await readJsonBody(request,128*1024),view=manager.getView(request.headers['x-designcraft-view'],request.headers['x-designcraft-capability']);if(!body.epoch||body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);const root=manager.scope(view.sessionId,view.root),write=['plan','recover-plan','start-slot','cancel-slot','finalize'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);
  const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对电商图记录',409);if(write)manager.fileActionIdle(view,body.epoch);};
  try{let result;
   if(body.action==='list')result={plans:await service.list(root),pending:await service.pending(root)};
   else if(body.action==='recover-plan')result=await service.recoverPlan(root,body.candidate,controller.signal,current);
   else if(body.action==='status')result=await service.status(root,body.id);
   else if(body.action==='start-slot')result=await service.startSlot(root,view.sessionId,body.id,body.slot,controller.signal,current);
   else if(body.action==='cancel-slot')result=await service.cancelSlot(root,body.id,body.slot);
   else if(body.action==='finalize')result=await service.finalize(root,body.id,body.selected,controller.signal,current);
   else if(body.action==='plan'){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('电商图计划身份无效',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await service.plan(root,body.input,operationId,controller.signal,current);}
   else throw new SafetyError('未知电商图动作',422);current();sendJson(response,200,{ok:true,...result});
  }catch(error){let retained;try{if(manager.active.get(view.sessionId)===view.id&&view.epoch===body.epoch&&manager.scope(view.sessionId)===root)retained=error.retained;}catch{}if(retained&&!response.destroyed&&!response.writableEnded){sendJson(response,error.status||500,{ok:false,error:String(error.message||error),...retained,readStateBeforeRetry:true});return;}throw error;}
  finally{response.off('close',abort);}
 })}];
}
