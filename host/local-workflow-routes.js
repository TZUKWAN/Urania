import {createHash} from 'node:crypto';
import {LocalDesignWorkflows} from './local-design-workflows.js';
import {SafetyError} from './safety.js';
export async function dispatchLocalWorkflow(service,root,action,input,{sessionId,callId,signal,current,actor='agent'}={}){
 current?.();let result;
 switch(action){
  case 'catalog':result=service.catalog();break;
  case 'list':result=service.list(root);break;
  case 'status':result=await service.status(root,input.runId);break;
  case 'read':result=service.readRule(root,input,actor);break;
  case 'prepare':{const key=input.operationKey||callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('本地工作流需要稳定操作身份',422);const operationId=createHash('sha256').update(sessionId+'\0'+key).digest('hex');result={...await service.prepare(root,input,operationId,signal,current),operationKey:key};break;}
  case 'publish_html':result=await service.publishHtml(root,{...input,actor},signal,current);break;
  case 'publish_report':result=await service.publishReport(root,{...input,sessionId,actor},signal,current);break;
  case 'attach':result=await service.attach(root,{...input,actor},signal,current);break;
  case 'complete':result=await service.finish(root,input,signal,current);break;
  case 'cancel':result=service.cancel(root,input);break;
  case 'recover_lock':result=service.recoverLock(root,input);break;
  default:throw new SafetyError('未知本地设计工作流操作',422);
 }
 current?.();return result;
}
export function localWorkflowRoutes(manager,{guard,readJsonBody,sendJson}){
 return [{kind:'exact',path:'/designcraft/api/v2/studio/local-workflows',handler:guard(async(req,res)=>{
  if(req.method!=='POST')throw new SafetyError('POST required',405);const body=await readJsonBody(req,16*1024*1024),view=manager.getView(req.headers['x-designcraft-view'],req.headers['x-designcraft-capability']),root=view.root;
  const current=()=>{if(res.destroyed||manager.getView(req.headers['x-designcraft-view'],req.headers['x-designcraft-capability'])!==view||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，未继续本地工作流',409);};
  const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);if(res.destroyed)controller.abort();
  try{const service=new LocalDesignWorkflows(manager,manager.openDesignLibrary),result=await dispatchLocalWorkflow(service,root,body.action,body,{sessionId:view.sessionId,signal:controller.signal,current,actor:'manual'});sendJson(res,200,{ok:true,...result});}finally{res.off('close',abort);}
 })}];
}
