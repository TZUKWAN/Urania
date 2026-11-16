import {createHash} from 'node:crypto';
import {SafetyError,assertSafeJson} from './safety.js';

export function openAiSvgToolDefinition(manager,service){
 return {name:'designcraft_openai_svg',
  description:'Generate an actual static SVG with an OpenAI Image API model only when the user explicitly requests the potentially billable operation. catalog returns models actually listed by the DSH OpenAI connection whose documented family supports SVG; this is not proof the account can run them. start submits a single SVG request and returns a durable job, not a finished asset. list/status report saved state; stop stops local waiting only. recover_saved checks already-written result receipts and never sends a second generation request. open imports a saved SVG as a new native Vector source with a durable provenance receipt; reconcile checks an existing import reservation without repeating it. OpenAI image editing does not support SVG output: do not claim it edited the previous SVG, and use existing native vector edit and apply_instance for in-place changes. If result or import is uncertain, inspect saved state before retrying. Actual visual quality and editability require verification.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['catalog','start','list','status','stop','recover_saved','open','reconcile']},provider:{type:'string'},model:{type:'string'},prompt:{type:'string'},id:{type:'string'},operationKey:{type:'string'}}},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},
  timeoutMs:180000,isConcurrencySafe:args=>['catalog','list','status'].includes(args.action),
  async execute(args,exec){
   let root,session;try{
    assertSafeJson(args);exec.signal?.throwIfAborted();session=exec.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('需要有工作区的当前 DSH 对话',422);root=manager.scope(session.id);const current=()=>{if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已切换，请回原项目核对 SVG 任务',409);};let result;
    if(args.action==='catalog')result=await service.catalog(args.provider);
    else if(args.action==='list')result={jobs:service.list(root)};
    else if(args.action==='status')result={job:service.get(root,args.id)};
    else if(args.action==='stop')result={stopped:service.stop(root,args.id)};
    else if(args.action==='recover_saved')result=service.recoverSaved(root,args.id);
    else if(args.action==='reconcile')result=await service.reconcile(root,args.id,exec.signal,current);
    else if(args.action==='start'){
     const key=args.operationKey||exec.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('提交 SVG 请求需要稳定操作身份',422);const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex');result=await service.start(root,{provider:args.provider,model:args.model,prompt:args.prompt,operationId},exec.signal);
    }else if(args.action==='open'){
     const key=args.operationKey||exec.callId;if(typeof key!=='string'||!key)throw new SafetyError('打开 SVG 需要稳定操作身份',422);result=await service.open(root,session.id,args.id,key,exec.signal);
    }else throw new SafetyError('未知 OpenAI SVG 操作',422);
    current();return {json:JSON.stringify({ok:true,...result})};
   }catch(error){let retained;try{if(root&&session&&manager.scope(session.id)===root)retained=error.retained;}catch{}return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),...(retained?{retained}:{}),readStateBeforeRetry:true})};}
  }
 };
}
export function registerOpenAiSvgTool(ctx,manager,service){ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(openAiSvgToolDefinition(manager,service));scope.effect(()=>()=>dispose?.(),'designcraft: OpenAI SVG');});}
