import {createHash} from 'node:crypto';
import {SafetyError,assertSafeJson} from './safety.js';

export function veniceVideoToolDefinition(manager,service){
 return {name:'designcraft_venice_video',
  description:'Use Venice video queue in the current DSH project. models reads actual provider metadata and specHash; quote obtains the real estimated price. start requires a matching specHash and an explicit user request for the potentially billable generation. Supported inputs are prompt, declared duration/resolution/aspect ratio and an optional project image only when the model explicitly declares image support. No unsupported consent, voice, reference or enhancement fields are guessed. start creates a durable task, not a finished video. list/status inspect saved state; stop only stops local waiting; recover fetches the existing queue ID and does not submit again. Some Venice models return a private URL only once; it is protected with Windows current-user DPAPI and excluded from project packages. A crash before the link is protected or a different Windows user can make it unrecoverable. cleanup deletes Venice stored media and revoke_link invalidates the private link; perform either only when the user explicitly asks and after the local video has been saved and checked. Uncertain operations are not repeated automatically. Do not claim any model or video was verified without a real result.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
   action:{type:'string',enum:['models','quote','start','list','status','stop','recover','cleanup','revoke_link']},provider:{type:'string'},model:{type:'string'},specHash:{type:'string'},id:{type:'string'},operationKey:{type:'string'},
   input:{type:'object',additionalProperties:false,required:['prompt','duration'],properties:{prompt:{type:'string'},duration:{type:'string'},resolution:{type:'string'},aspect_ratio:{type:'string'},imageAsset:{type:'string'}}}
  }},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},
  timeoutMs:120000,isConcurrencySafe:args=>['models','quote','list','status'].includes(args.action),
  async execute(args,exec){
   try{
    assertSafeJson(args);exec.signal?.throwIfAborted();const session=exec.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('需要有工作区的当前 DSH 对话',422);const root=manager.scope(session.id);let result;
    if(args.action==='models')result=await service.models(args.provider,exec.signal);
    else if(args.action==='quote')result=await service.quote(args.provider,args.model,args.specHash,args.input,exec.signal);
    else if(args.action==='list')result={jobs:service.list(root)};
    else if(args.action==='status')result={job:service.get(root,args.id)};
    else if(args.action==='stop')result={stopped:service.stop(root,args.id)};
    else if(args.action==='recover')result=service.recover(root,args.id);
    else if(args.action==='cleanup')result=await service.cleanup(root,args.id,exec.signal);
    else if(args.action==='revoke_link')result=await service.revokeLink(root,args.id,exec.signal);
    else if(args.action==='start'){
     const key=args.operationKey||exec.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('提交视频请求需要稳定的操作身份',422);
     const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex');result=await service.start(root,{provider:args.provider,model:args.model,specHash:args.specHash,input:args.input,operationId},exec.signal);
    }else throw new SafetyError('未知 Venice 视频操作',422);
    if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已切换，请回原项目核对任务',409);return {json:JSON.stringify({ok:true,...result})};
   }catch(error){return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),readStatusBeforeRetry:true})};}
  }
 };
}
export function registerVeniceVideoTool(ctx,manager,service){ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(veniceVideoToolDefinition(manager,service));scope.effect(()=>()=>dispose?.(),'designcraft: Venice video workflows');});}
