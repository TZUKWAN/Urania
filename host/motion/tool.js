/** Motion authoring uses the actual DSH execution identity, never a body actor. */
import {motionHandleAction} from './routes.js';
import {requireDesignScope} from '../design-scope.js';
import {assertSafeJson} from '../safety.js';
export function motionToolDefinition(manager){
 return {
  name:'designcraft_motion',
  description:'Create and edit real editable HTML/CSS/JS animation projects in this project design session. List templates, create/open, then read_source for exact source and write_sources with the CURRENT leaseId, viewEpoch and baseRevision. Reopen after each saved revision. Use stable operationKey for mutation retries. For reusable native material, first derive a real PNG/SVG through designcraft_editor, then import_native with that project assetId and current motion lease/base. The returned asset.path is a local composition URL; nativeSource preserves the exact immutable native revision, source hash and derivative hash. Reopen before writing code that uses this URL. IDs/time ranges refer to real data-hf-id and frames. Generated code runs in an unprivileged preview: bundle resources locally; never call DSH, parent DOM or network services from a composition. Render starts a real job; query render_status before reporting MP4 completion. export_project is an editable package, not a rendered video.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
   action:{type:'string',enum:['doctor','list_projects','templates','create','create_from_template','open','read_source','write_sources','import_native','update_selection','restore','export_project','import_project','reference','close_lease','operation_status','render','render_status','cancel_render','verify_artifact']},
   root:{type:'string'},projectId:{type:'string'},assetId:{type:'string'},templateId:{type:'string'},title:{type:'string'},render:{type:'object'},sources:{type:'object',additionalProperties:{type:'string'}},operationKey:{type:'string'},baseRevision:{type:'string'},leaseId:{type:'string'},viewEpoch:{type:'string'},revision:{type:'string'},dataBase64:{type:'string'},video:{type:'string'},file:{type:'string'},offset:{type:'integer',minimum:0},length:{type:'integer',minimum:1,maximum:64000},hfIds:{type:'array',items:{type:'string'}},timeRange:{type:'object'},jobId:{type:'string'},message:{type:'string'}
  }},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},
  timeoutMs:90000,isConcurrencySafe:args=>['templates','list_projects','read_source','operation_status','render_status'].includes(args.action),
  async execute(args,execution){
   try{
    assertSafeJson(args);const session=execution.agent?.session;
    if(!session?.id||!session.header?.cwd)throw new Error('当前 DSH 对话没有工作区');
    const root=requireDesignScope(manager,session.id,args.root||session.header.cwd),url=new URL('http://motion.invalid/');url.searchParams.set('root',root);
    const result=await motionHandleAction(args.action==='list_projects'?'projects':args.action,args.action==='list_projects'?'GET':'POST',{...args,root},url,{execution,resolveScope:()=>root});
    return {json:JSON.stringify({ok:true,...result})};
   }catch(error){return {json:JSON.stringify({ok:false,status:error.status||409,error:String(error.code?error.code+': '+error.message:error.message||error),readStateBeforeRetry:true})};}
  }
 };
}
export function registerMotionTool(ctx,manager){ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(motionToolDefinition(manager));scope.effect(()=>()=>dispose?.(),'designcraft: scoped motion authoring');});}

