import {createHash} from 'node:crypto';
import {SafetyError,assertSafeJson} from './safety.js';

export function veniceAudioToolDefinition(manager,service){
 return {name:'designcraft_venice_audio',
  description:'Use Venice music and sound-effects models in the current DSH project. models reads the real model catalogue and specHash; quote asks Venice for the actual estimated price; start requires that specHash and an explicit user request for the potentially billable generation. Input supports prompt and model-declared music options. start returns an accepted local task, not a completed audio file. list/status report durable status. stop stops local waiting only; recover retrieves the same existing queue ID without a new paid submission. cleanup deletes Venice stored media and must only be called when the user explicitly asks for that cleanup; it first checks the saved local audio. If acceptance or cleanup is uncertain, inspect records and do not automatically repeat the operation. This tool does not implement video, speech-to-speech or voice cloning. Do not claim it works or that generated audio meets a brief without a real result and verification.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
   action:{type:'string',enum:['models','quote','start','list','status','stop','recover','cleanup']},provider:{type:'string'},model:{type:'string'},specHash:{type:'string'},id:{type:'string'},operationKey:{type:'string'},
   input:{type:'object',additionalProperties:false,required:['prompt'],properties:{prompt:{type:'string'},lyrics_prompt:{type:'string'},duration_seconds:{type:'number'},force_instrumental:{type:'boolean'},lyrics_optimizer:{type:'boolean'},loop:{type:'boolean'},voice:{type:'string'},language_code:{type:'string'},speed:{type:'number'}}}
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
    else if(args.action==='start'){
     const key=args.operationKey||exec.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('提交音频请求需要稳定的操作身份',422);
     const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex');result=await service.start(root,{provider:args.provider,model:args.model,specHash:args.specHash,input:args.input,operationId},exec.signal);
    }else throw new SafetyError('未知 Venice 音频操作',422);
    if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已切换，请回原项目核对任务',409);return {json:JSON.stringify({ok:true,...result})};
   }catch(error){return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),readStatusBeforeRetry:true})};}
  }
 };
}
export function registerVeniceAudioTool(ctx,manager,service){ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(veniceAudioToolDefinition(manager,service));scope.effect(()=>()=>dispose?.(),'designcraft: Venice audio workflows');});}
