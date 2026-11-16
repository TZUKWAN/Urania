import {createHash} from 'node:crypto';
import {prepareWorkflowImage,listWorkflowImages,recoverWorkflowImage,openWorkflowImage,reconcileWorkflowImage} from './workflow-image-import.js';
import {SafetyError,assertSafeJson} from './safety.js';

export function replicateWorkflowToolDefinition(manager,service){
 return {name:'designcraft_replicate_workflow',
  description:'Use real Replicate predictions in the current DSH project. model and versions show actual provider metadata. inspect reads a specified fixed version OpenAPI schema and schemaHash, or version=official for a model the service actually marks official and whose model metadata contains a usable schema. Official model weights can change; schemaHash alone does not pin them, and a returned hidden version is recorded as hidden. start requires that exact fixed version or official mode and schemaHash, actual JSON input and optional project assetRefs ({pointer,asset}); Files up to 256 KiB are embedded; larger explicitly referenced project files are uploaded to the official Files API (32 MiB total limit), with encrypted local file identity and durable states. Uploads are hosted by Replicate and may be accessible through their file URLs; treat the file identifier as sensitive. Submit only when the user explicitly requests the potentially billable operation. start returns a durable local task, not a finished output. list/status report saved records; stop only stops local waiting; recover fetches the same accepted prediction ID without a second submission; reconcile_upload checks a single uncertain upload against actual account file metadata without uploading; resume_unsent accepts the original exact input and assetRefs only when no prediction was sent and no upload is uncertain; cancel_remote explicitly requests remote cancellation after local waiting stops. Uncertain acceptance or cancellation must not be automatically retried. prepare_image binds one actual completed PNG/JPEG output by job ID and exact output pointer; images lists saved sources, open_image imports one into an independent native Photo source, and reconcile_image checks an existing reservation without another service request. Downloaded output files are project assets, unrecognized links and secrets are hidden. Output URLs may expire. This generic protocol does not prove every model, its visual semantics, license or any OD external workflow is verified.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
   action:{type:'string',enum:['model','versions','inspect','start','list','status','stop','recover','reconcile_upload','resume_unsent','cancel_remote','prepare_image','images','recover_image','open_image','reconcile_image']},model:{type:'string'},version:{type:'string'},schemaHash:{type:'string'},id:{type:'string'},imageId:{type:'string'},pointer:{type:'string'},candidate:{type:'string'},operationKey:{type:'string'},input:{type:'object'},assetRefs:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['pointer','asset'],properties:{pointer:{type:'string'},asset:{type:'string'}}}}
  }},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},
  timeoutMs:120000,isConcurrencySafe:args=>['model','versions','inspect','list','status','images'].includes(args.action),
  async execute(args,exec){
   let root,session;try{
    assertSafeJson(args);exec.signal?.throwIfAborted();session=exec.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('需要有工作区的当前 DSH 对话',422);root=manager.scope(session.id);let result;
    if(args.action==='model')result=await service.modelInfo(args.model,exec.signal);
    else if(args.action==='versions')result=await service.versions(args.model,exec.signal);
    else if(args.action==='inspect')result=await service.inspect(args.model,args.version,exec.signal);
    else if(args.action==='list')result={jobs:service.list(root)};
    else if(args.action==='status')result={job:service.get(root,args.id)};
    else if(args.action==='stop')result={stopped:service.stop(root,args.id)};
    else if(args.action==='recover')result=service.recover(root,args.id);
    else if(args.action==='reconcile_upload')result=await service.reconcileUpload(root,args.id,args.pointer,exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='resume_unsent')result=await service.resumeUnsent(root,args.id,{input:args.input,assetRefs:args.assetRefs||[]},exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='cancel_remote')result=await service.cancelRemote(root,args.id,exec.signal);
    else if(args.action==='prepare_image')result=await prepareWorkflowImage(root,'replicate',args.id,args.pointer,exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='images'){const value=await listWorkflowImages(root);result={items:value.items.filter(item=>item.provider==='replicate'),imports:value.imports,pending:value.pending};}
    else if(args.action==='recover_image')result=await recoverWorkflowImage(root,args.candidate,exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='reconcile_image')result=await reconcileWorkflowImage(manager,root,args.id,exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    else if(args.action==='open_image'){const key=args.operationKey||exec.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('工作流图片导入需要稳定身份',422);result=await openWorkflowImage(manager,root,session.id,args.imageId,key,exec.signal);}
    else if(args.action==='start'){
     const key=args.operationKey||exec.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('提交 Replicate 请求需要稳定操作身份',422);const operationId=createHash('sha256').update(session.id+'\0'+key).digest('hex');result=await service.start(root,{model:args.model,version:args.version,schemaHash:args.schemaHash,input:args.input,assetRefs:args.assetRefs||[],operationId},exec.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换',409);});
    }else throw new SafetyError('未知 Replicate 工作流操作',422);
    if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已切换，请回原项目核对任务',409);return {json:JSON.stringify({ok:true,...result})};
   }catch(error){let retained;try{if(root&&session&&manager.scope(session.id)===root)retained=error.retained;}catch{}return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),...(retained?{retained}:{}),readStatusBeforeRetry:true})};}
  }
 };
}
export function registerReplicateWorkflowTool(ctx,manager,service){ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(replicateWorkflowToolDefinition(manager,service));scope.effect(()=>()=>dispose?.(),'designcraft: Replicate workflows');});}
