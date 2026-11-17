import {assertSafeJson,SafetyError} from './safety.js';

import {uint64Schema} from '../client/native-protocol.js';

import {SOURCE_FORMATS} from '../client/native-contract.js';
import {EditorFenceTickets} from './editor-fence-tickets.js';

const SOURCE_FENCED_ACTIONS=new Set(['execute','undo','inspect_node','save','derive','place','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','brand','recover_feedback']);
const BASE_FENCED_ACTIONS=new Set(['execute','undo','derive','place','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','brand','recover_feedback']);
function requireExecutionFields(args){
 if(args.action==='open'&&(typeof args.sourceId!=='string'||!args.sourceId.trim())){
  const error=new SafetyError('open 必须明确提供顶层 sourceId；payload.id、payload.sourceId 或名称不能指定目标。当前作品没有重新打开或切换。请使用已有目标作品的真实 sourceId，再调用 open。',422);
  error.missingExecutionFields=['sourceId'];error.retryInstruction='For open, put the intended EXISTING target source ID in TOP-LEVEL sourceId, not payload.id or payload.sourceId. Do not reopen the current work to repair arguments.';throw error;
 }
 if(!SOURCE_FENCED_ACTIONS.has(args.action))return;
 const missing=[];
 for(const key of ['sourceId','epoch'])if(typeof args[key]!=='string'||!args[key].trim())missing.push(key);
 if(BASE_FENCED_ACTIONS.has(args.action)){
  if(!args.base||typeof args.base!=='object'||Array.isArray(args.base))missing.push('base');
  else for(const key of ['uid','revision','engine','selectionStamp'])if(args.base[key]===undefined)missing.push('base.'+key);
 }
 if(missing.length){
  const error=new SafetyError('编辑器操作缺少必需字段：'+missing.join('、')+'。先调用 state，再原样复制 view.sourceId、view.epoch 和完整 view.base 到顶层；不要为补参数重新打开作品。',422);
  error.missingExecutionFields=missing;throw error;
 }
}


export function editorToolDefinition(manager){
 const tickets=new EditorFenceTickets();

 return {name:'designcraft_editor',

  description:'FIRST call state. If view.recoveryRequired or a rejected feedback draft blocks editing, call recover_feedback with fresh sourceId/epoch/base. It durably preserves that candidate as an independent work, returns to the latest saved original and does not complete the feedback request. Then read state and continue the intended local edits. To open a DIFFERENT existing work, action=open REQUIRES the intended target in TOP-LEVEL sourceId; payload.id/payload.sourceId are not targets. Never reopen an already active work just to repair arguments. view.base.selectionStamp is a SHORT opaque context ticket: copy it unchanged, never rebuild it or copy the long view.document.selectionStamp. It retains the exact complete native selection/page/tool fence; stale contexts are still refused. Every execute/undo/mutation requires THREE top-level fences copied from that result: sourceId=view.sourceId, epoch=view.epoch, base=the COMPLETE view.base. Do not omit epoch or put it inside base/payload. If missingExecutionFields is returned, read state and supply the named fields; preserve the current native App and do not call open as a workaround. Commands that target objects also require the observed IDs in payload.params. Use brand_state to read project colors and the actual selected fill. With a fresh editor base and observed project revision, brand supports create, attach, disable, enable, recolor and resume. For recolor use the full enabled bindingIds list and exact overrideIds for local colors; use two empty arrays only when brand_state shows no enabled bindings. Resume a pending update by its updateId. brand_state also returns fontState: use brand with font-create, font-attach, font-disable, font-change, font-resume or font-cancel. font-attach needs the selected nativeId and its sourceRevision; font-change needs the complete bindingIds and exact overrideIds from the latest fontState. New bindings use native object identity so unrelated edits can be preserved; older unmarked bindings remain conservative until explicitly rebound. Never change the reserved identity marker directly. apply_linked layoutPolicy defaults to fixed, or fit-0 through fit-8 to preserve source proportions at the chosen local anchor (row-major, center is fit-4). Edit the SAME persistent native App displayed in this DSH conversation. state reports the actual live engines and available bridge capabilities; use only commands admitted by the active engine. For a pinned OpenDesign brand, designcraft_resources style returns the actual short resource id and primary color for brand create. For an explicitly selected saved theme-factory color, read designcraft_resources external_theme, then pass its bundleId, file, gitSha1 and sha256 as payload.themeSource with the chosen actual color in primary. This only creates a brand with a source record; it does not modify existing objects or install fonts. Copy view.base exactly for execute/undo: it includes uid, revision, engine, selectionStamp and any native object selection. Do not rebuild a partial base or drop its native selection/page/tool fence. nativeSelection preserves the actual engine selection; raster masks and slide context must not be guessed as Vector object lists. Large uint64 IDs are exact decimal strings: for an ID inside unconstrained command params use {$u64:"decimal-id"}, or copy view.idArguments[].argument; never Number(id). inspect_node payload.id accepts the exact decimal string directly. If view.requiresReload is true, preserve the source and ask for the editor to reload; do not fall back to legacy .dc.json routes. commands gives actual command descriptions. Use designcraft_resources for original OD reference data. new creates a native design in a registered engine; create_svg imports real SVG into Vector editable paths/text and saves it. undo requires fresh sourceId/epoch/base plus payload.jobId from an undoAvailable recentJob. Bare undo/redo/history and batch bypasses are refused; later manual edits or unprovable history return conflicts, never whole-source rollback. Never modify source files behind the live App. Completion requires a real durable checkpoint. Failed/uncertain steps may have applied: read state before retrying. Use the normal DSH conversation, no second agent. project reads the actual project assets and saved-source uses. derive requires the current sourceId/epoch/base and payload.format svg or png; it atomically pairs actual source bytes with a derivative, then registers that exact saved version. place requires the current sourceId/epoch/base plus payload.assetId from project, and optional payload.at [x,y] in document coordinates; it creates a real embedded native object and saves its explicit provenance. These are immutable snapshots. convert_svg with payload.instanceId explicitly converts a supported Deck SVG picture into real editable shapes or text, retains the original SVG hidden, saves a checkpoint and reports text-layout limitations; unsupported inputs fail without replacing the source. Never call the raw conversion command through execute. A saved conversion with a lost acknowledgement appears in project.recoverableConversions; reconcile_svg_conversion with payload.jobId verifies the saved receipt without executing conversion again. edit_instance with payload.instanceId from project starts an independent editable fork from the exact source version bound to that use; optional payload.editId resumes its pending edit. It preserves the original source shared by other uses. apply_instance from that independent editing view captures actual PNG/source and updates only the original native picture contents while retaining its layout/crop/effects. A source with an interrupted committed update appears in project.recoverableInstanceUpdates; reconcile_instance_update with payload.jobId repairs its graph from the durable native source receipt without executing replacement again. link_instances with explicit payload.instanceIds creates opt-in membership for 2..100 uses of the same asset; ordinary uses stay independent. unlink_instance detaches payload.instanceId. apply_linked from an independent editing view requires payload.linkId and the exact complete payload.instanceIds from project.links; it explicitly updates only that unchanged linked group, retaining each actual native picture properties across saved slide designs. Each source has a CAS commit and native receipt. Partial progress remains in project.updates; resume_linked with payload.updateId first reconciles saved receipts, then processes only unfinished sources. Independent apply_instance detaches that use from its linked group. open_asset with payload.assetId opens its current original design, keeping one saved parent App paused for return. return_to_design uses the current sourceId/epoch/base when view.navigation.canReturn is true. A normal return reuses the original live App/history/view only if its durable source head stayed unchanged; an external update is reopened instead. Source editing does not automatically replace frozen material snapshots. If placement was saved but its relation was interrupted, read project.recoverablePlacements and use reconcile_placement with payload.jobId; it repairs from durable source receipts without executing placement again.',

  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
   feedbackId:{type:'string',description:'When executing a persisted UraniaFeedback request, copy its submissionId here. First read designcraft_feedback. This binds actual native jobs to the request; state/open/navigation still require all normal native fences.'},

   action:{type:'string',enum:['state','project','brand_state','brand','new','create_svg','open','commands','execute','undo','inspect_node','save','derive','place','reconcile_placement','open_asset','return_to_design','edit_instance','apply_instance','reconcile_instance_update','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','reconcile_svg_conversion','recover_feedback']},sourceId:{type:'string',description:'For open, REQUIRED at the top level: the intended existing target source ID, not payload.id/payload.sourceId. For execute/undo and current-source actions, copy the latest state view.sourceId exactly.'},epoch:{type:'string',description:'For execute/undo and current-source actions, REQUIRED at the top level: copy the latest state view.epoch exactly. It is separate from base and is NOT the sourceRevision. Missing epoch is an invalid argument; read state and supply it, do not reopen the source.'},

   base:{type:'object',description:'For execute/undo and mutations, REQUIRED at the top level alongside sourceId AND epoch: copy the entire latest view.base including selection when present. Do not reconstruct it.',additionalProperties:false,required:['uid','revision','engine','selectionStamp'],properties:{uid:uint64Schema,revision:uint64Schema,engine:{type:'string',enum:Object.keys(SOURCE_FORMATS)},selectionStamp:{type:'string',description:'Copy the SHORT opaque ticket from the latest state view.base.selectionStamp exactly; do not rebuild selection JSON or copy view.document.selectionStamp.'},selection:{type:'array',items:uint64Schema}}},

   payload:{type:'object',properties:{title:{type:'string'},svg:{type:'string'},width:{type:'number'},height:{type:'number'},engine:{type:'string'},query:{type:'string'},name:{type:'string'},primary:{type:'string'},font:{type:'string'},nativeId:uint64Schema,brandId:{type:'string'},bindingId:{type:'string'},bindingIds:{type:'array',items:{type:'string'},maxItems:100},overrideIds:{type:'array',items:{type:'string'},maxItems:100},sourceRevision:{type:'string'},revision:{type:['string','null']},resourceId:{type:'string'},themeSource:{type:'object',additionalProperties:false,required:['bundleId','file','gitSha1','sha256'],properties:{bundleId:{type:'string'},file:{type:'string'},gitSha1:{type:'string'},sha256:{type:'string'}}},layoutPolicy:{type:'string',pattern:'^(fixed|fit-[0-8])$'},command:{type:'string'},params:{type:'object'},id:uint64Schema,jobId:{type:'string'},assetId:{type:'string'},instanceId:{type:'string'},editId:{type:'string'},updateId:{type:'string'},linkId:{type:'string'},instanceIds:{type:'array',items:{type:'string'},minItems:2,maxItems:100},format:{type:'string',enum:['svg','png']},at:{type:'array',items:{type:'number'},minItems:2,maxItems:2}}}

  }},

  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},

  timeoutMs:90000,isConcurrencySafe:args=>['state','project','brand_state'].includes(args.action),

  async execute(args,exec){

   try{

    assertSafeJson(args);const session=exec.agent?.session;

    if(!session?.id||!session.header?.cwd)throw new SafetyError('当前 DSH 对话没有工作区',422);

    requireExecutionFields(args);

    let result;
    if(args.action==='state'){
     result={ok:true,...await manager.state(session.id)};
     if(result.view?.base&&result.view.sourceId&&result.view.epoch)result={...result,view:{...result.view,base:tickets.issue(session.id,result.view)}};
    }else result=args.action==='project'?{ok:true,project:await manager.projectState(session.id)}:args.action==='brand_state'?{ok:true,...await manager.brandState(session.id)}:args.action==='reconcile_placement'?await manager.reconcileForSession(session.id,args.payload||{}):args.action==='reconcile_instance_update'?await manager.reconcileUpdateForSession(session.id,args.payload||{}):args.action==='reconcile_svg_conversion'?await manager.reconcileConversionForSession(session.id,args.payload||{}):await manager.request(session.id,{...tickets.resolve(session.id,args),operationId:exec.callId},exec.signal);

    if(result.view?.recoveryRequired||!result.ok&&/待处理草稿|候选已隔离/.test(result.error||''))result={...result,recoveryRequired:true,readStateBeforeRetry:false,recoveryInstruction:'Call state, then recover_feedback with its exact sourceId/epoch/base. This preserves the rejected candidate as an independent work and reopens the latest saved original. Then read state before continuing. Do not repeat execute/save/open/undo or edit source files to bypass the draft.'};
    return {json:JSON.stringify(result)};

   }catch(error){return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),readStateBeforeRetry:true,...(error.missingExecutionFields?{missingExecutionFields:error.missingExecutionFields,retryInstruction:error.retryInstruction||'Call state, then copy view.sourceId, view.epoch and the complete view.base into the next call. Preserve the current App; do not use open to repair missing arguments.'}:{})})};}

  }

 };

}



export function registerEditorTools(ctx,manager){

 ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(editorToolDefinition(manager));scope.effect(()=>()=>dispose?.(),'designcraft: professional editor tools');});

}

