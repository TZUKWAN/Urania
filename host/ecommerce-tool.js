import {createHash} from 'node:crypto';
import {SafetyError,assertSafeJson} from './safety.js';

export function ecommerceToolDefinition(manager,service){
 return {name:'designcraft_ecommerce',
  description:'Create a reference-product ecommerce image set in the current DSH project using the existing image provider, not an extra agent or simulated images. plan requires at least one real saved PNG/JPEG reference image, productName, user-provided identity, feature, provider and model; environment is optional. It reads the actual model catalogue, preserves reference bytes, and creates main, feature and lifestyle slots with stable identities. The requested aspect is sent only when the selected model actually advertises it; otherwise it is a composition request and actual dimensions may differ. Only when the user explicitly requests generation, start_slot submits the chosen slot using the existing image service. It can incur cost, and reusing a slot never automatically repeats an uncertain request. list/status inspect actual plans and job states, recover_plan restores a complete local temporary plan without generation, cancel_slot stops local waiting only, and finalize requires three real ready candidates. If a slot has multiple candidates, pass selected mapping of slot to actual candidateId. finalize preserves the reference images, actual previews, image-manifest.json and ecommerce-gallery.html in a versioned HTML source; it does not prove fidelity, product claims or marketplace compliance. Inspect results and preserve hand edits; do not invent visual identity or performance claims.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['plan','list','status','recover_plan','start_slot','cancel_slot','finalize']},operationKey:{type:'string'},id:{type:'string'},candidate:{type:'string'},slot:{type:'string',enum:['main','feature','lifestyle']},input:{type:'object'},selected:{type:'object'}}},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},timeoutMs:180000,isConcurrencySafe:args=>['list','status'].includes(args.action),
  async execute(args,execution){let root,session;try{
   assertSafeJson(args);execution.signal?.throwIfAborted();session=execution.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('需要有工作区的当前 DSH 对话',422);root=manager.scope(session.id);const current=()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换，请回原项目核对电商图记录',409);};let result;
   if(args.action==='list')result={plans:await service.list(root),pending:await service.pending(root)};
   else if(args.action==='recover_plan')result=await service.recoverPlan(root,args.candidate,execution.signal,current);
   else if(args.action==='status')result=await service.status(root,args.id);
   else if(args.action==='start_slot')result=await service.startSlot(root,session.id,args.id,args.slot,execution.signal,current);
   else if(args.action==='cancel_slot')result=await service.cancelSlot(root,args.id,args.slot);
   else if(args.action==='finalize')result=await service.finalize(root,args.id,args.selected,execution.signal,current);
   else if(args.action==='plan'){const key=args.operationKey||execution.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('电商图计划需要稳定操作身份',422);const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex');result=await service.plan(root,args.input,operationId,execution.signal,current);}
   else throw new SafetyError('未知电商图动作',422);current();return {json:JSON.stringify({ok:true,...result})};
  }catch(error){let retained;try{if(root&&session&&manager.scope(session.id)===root)retained=error.retained;}catch{}return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),...(retained?{retained}:{}),readStateBeforeRetry:true})};}}
 };
}
export function registerEcommerceTool(ctx,manager,service){ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(ecommerceToolDefinition(manager,service));scope.effect(()=>()=>dispose?.(),'designcraft: ecommerce workflow');});}
