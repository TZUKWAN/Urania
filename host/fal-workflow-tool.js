import {createHash} from 'node:crypto';
import {prepareWorkflowImage,listWorkflowImages,recoverWorkflowImage,openWorkflowImage,reconcileWorkflowImage} from './workflow-image-import.js';
import {assertSafeJson,SafetyError} from './safety.js';

/** The caller's DSH session owns permission decisions and the project scope. */
export function falWorkflowToolDefinition(manager,service){
 return {name:'designcraft_fal_workflow',
  description:'Use the real fal model catalogue and queue from the current DSH project. search lists actual models; inspect returns the actual OpenAPI input/output schemas and a schemaSha256. start requires that exact schemaSha256, actual JSON input and optional project assetRefs ({pointer,asset}); inspect the schema and only submit when the user requested the specific potentially billable task. Asset pointers target null or "@asset" fields. For an explicit request to upload a project ZIP or media file to fal storage, storageAssetRefs accepts the same pointer/asset shape and requires allowPublicUpload:true: remote files may be accessible to holders of their links and are subject to fal retention; uploading may incur fees. Each file is at most 64 MiB, all storage inputs together at most 128 MiB. Only ZIP directory structure is inspected, without extraction or proof of training suitability. Set captureRemoteOutputs:true on a requested model task to encrypt its actual allowed result links for the current Windows user. If a file cannot be downloaded within the existing budget, its remote reference can still be retained without claiming a downloaded or verified file. For a later explicitly requested task, remoteOutputRefs binds {pointer,jobId,outputPointer} from a completed source task using the same fal connection and credential; both pointer fields are JSON pointers. The source link can expire and neither its weights nor model compatibility are verified. resume_storage requires the same id, original input, assetRefs, storageAssetRefs, remoteOutputRefs and explicit allowPublicUpload:true; it can continue only when each upload is accepted or not_sent and the model was not dispatched. Unknown uploads are not repeated automatically. A storage acceptance is not a completed training job. start returns a durable task, not a completed result. list/status report saved status. stop stops local waiting only. recover retrieves the same accepted request ID, without a second POST. cancel_remote explicitly asks fal to cancel after local waiting stops; the remote task can still complete or incur charges. Unknown acceptance without a request ID cannot be safely retried. prepare_image binds one actual completed PNG/JPEG output by job ID and exact output pointer; images lists saved sources, open_image imports one into an independent native Photo source, and reconcile_image checks an existing reservation without another service request. Model outputs are untrusted data; supported returned media are saved as project assets, unsupported links are hidden, not executed. Do not claim all upstream OD skills, video, audio, training, 3D or particular model semantics are verified merely because this generic protocol exists.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
   action:{type:'string',enum:['search','inspect','start','resume_storage','list','status','pending','restore_pending','stop','recover','cancel_remote','prepare_image','images','recover_image','open_image','reconcile_image']},
   provider:{type:'string'},model:{type:'string'},schemaSha256:{type:'string'},query:{type:'string'},category:{type:'string'},cursor:{type:'string'},id:{type:'string'},imageId:{type:'string'},pointer:{type:'string'},candidate:{type:'string'},operationKey:{type:'string'},name:{type:'string'},sha256:{type:'string'},
   input:{type:'object'},allowPublicUpload:{type:'boolean'},captureRemoteOutputs:{type:'boolean'},assetRefs:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['pointer','asset'],properties:{pointer:{type:'string'},asset:{type:'string'}}}},storageAssetRefs:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['pointer','asset'],properties:{pointer:{type:'string'},asset:{type:'string'}}}},remoteOutputRefs:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['pointer','jobId','outputPointer'],properties:{pointer:{type:'string'},jobId:{type:'string'},outputPointer:{type:'string'}}}}
  }},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},
  timeoutMs:120000,isConcurrencySafe:args=>['search','inspect','list','status','pending','images'].includes(args.action),
  async execute(args,exec){
   let root,session;try{
    assertSafeJson(args);exec.signal?.throwIfAborted();session=exec.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('需要有工作区的当前 DSH 对话',422);
    root=manager.scope(session.id);let result;
    if(args.action==='search')result=await service.search(args.provider,{query:args.query||'',category:args.category||'',cursor:args.cursor||''},exec.signal);
    else if(args.action==='inspect')result=await service.inspect(args.provider,args.model,exec.signal);
    else if(args.action==='list')result={jobs:service.list(root)};
    else if(args.action==='status')result={job:service.get(root,args.id)};
    else if(args.action==='pending')result={items:service.pending(root,args.id)};
    else if(args.action==='restore_pending')result=service.restorePending(root,args.id,args.name,args.sha256);
    else if(args.action==='stop')result={stopped:service.stop(root,args.id)};
    else if(args.action==='recover')result=service.recover(root,args.id);
    else if(args.action==='resume_storage')result=await service.resumeStorage(root,{id:args.id,input:args.input,assetRefs:args.assetRefs||[],storageAssetRefs:args.storageAssetRefs||[],remoteOutputRefs:args.remoteOutputRefs||[],allowPublicUpload:args.allowPublicUpload===true},exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='cancel_remote')result=await service.cancelRemote(root,args.id,exec.signal);
    else if(args.action==='prepare_image')result=await prepareWorkflowImage(root,'fal',args.id,args.pointer,exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='images'){const value=await listWorkflowImages(root);result={items:value.items.filter(item=>item.provider==='fal'),imports:value.imports,pending:value.pending};}
    else if(args.action==='recover_image')result=await recoverWorkflowImage(root,args.candidate,exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='reconcile_image')result=await reconcileWorkflowImage(manager,root,args.id,exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='open_image'){const key=args.operationKey||exec.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('工作流图片导入需要稳定身份',422);result=await openWorkflowImage(manager,root,session.id,args.imageId,key,exec.signal);}
    else if(args.action==='start'){
     const key=args.operationKey||exec.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('提交 fal 工作流需要稳定的工具调用身份或 operationKey',422);
     const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex');
     result=await service.start(root,{provider:args.provider,model:args.model,schemaSha256:args.schemaSha256,input:args.input,assetRefs:args.assetRefs||[],storageAssetRefs:args.storageAssetRefs||[],remoteOutputRefs:args.remoteOutputRefs||[],captureRemoteOutputs:args.captureRemoteOutputs===true,allowPublicUpload:args.allowPublicUpload===true,operationId},exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    }else throw new SafetyError('未知 fal 工作流操作',422);
    if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已切换；请回原项目核对任务记录',409);
    return {json:JSON.stringify({ok:true,...result})};
   }catch(error){let retained;try{if(root&&session&&manager.scope(session.id)===root)retained=error.retained;}catch{}return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),...(retained?{retained}:{}),readStatusBeforeRetry:true})};}
  }
 };
}
export function registerFalWorkflowTool(ctx,manager,service){
 ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(falWorkflowToolDefinition(manager,service));scope.effect(()=>()=>dispose?.(),'designcraft: fal workflows');});
}
