import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import * as assets from './docstore.js';
import {captureNativeSelection} from './photo-mask.js';
import {SafetyError} from './safety.js';
import {sameUint64} from '../client/native-protocol.js';

/** A Photo selection is saved and copied from its real coverage surface, not its bounds. */
export function registerSelectionTool(ctx,manager){
 ctx.inject(['tools'],scope=>{
  const dispose=scope.tools.register({name:'designcraft_selection',description:'Inspect or capture the actual native Photo raster selection in the current DesignCraft workspace. Read designcraft_editor state first and pass its exact sourceId, epoch and base. capture_mask checkpoints the real .pcraft and exports its full alpha coverage as an immutable PNG asset. The bounds are descriptive only. If the user changes the source or selection during capture, the saved mask is marked stale and must not be applied as the current selection.',
   parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['inspect','capture_mask']},sourceId:{type:'string'},epoch:{type:'string'},base:{type:'object'}}},
   output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},timeoutMs:90000,isConcurrencySafe:args=>args.action==='inspect',
   async execute(args,exec){try{
    const session=exec.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('当前 DSH 对话没有工作区',422);
    const view=manager.views.get(manager.active.get(session.id));
    if(!view||view.root!==manager.scope(session.id)||Date.now()-view.lastSeen>=30000||view.engine!=='photocraft')throw new SafetyError('请先打开当前对话的原生图片',409);
    if(args.sourceId!==view.sourceId||args.epoch!==view.epoch||!manager.matchesBase(view,args.base))throw new SafetyError('图片或选区已变化，请重新读取状态',409);
    const selected=view.document?.nativeSelection?.data?.rasterSelection;if(!selected)throw new SafetyError('当前原生图片没有活动选区',422);
    if(args.action==='inspect')return {json:JSON.stringify({ok:true,sourceId:view.sourceId,sourceRevision:view.sourceRevision,engineUid:view.document.uid,engineRevision:view.document.revision,selection:selected,coordinateSpace:'image-pixels'})};
    const identity={sourceId:view.sourceId,epoch:view.epoch,uid:view.document.uid,revision:view.document.revision,stamp:view.document.selectionStamp};
    await manager.request(session.id,{action:'save',sourceId:identity.sourceId,epoch:identity.epoch,base:args.base,operationId:exec.callId},exec.signal);
    if(view.sourceId!==identity.sourceId||view.epoch!==identity.epoch||!sameUint64(view.document?.uid,identity.uid)||!sameUint64(view.document?.revision,identity.revision)||view.document?.selectionStamp!==identity.stamp)throw new SafetyError('保存时选区已变化，未提取旧选区',409);
    const source=await manager.store(view.root).source(view.sourceId,view.sourceRevision),bytes=await readFile(source.path);
    if(bytes.length>64*1024*1024)throw new SafetyError('原生图片源超过蒙版提取预算',413);
    const retained=assets.saveAsset(view.root,'selection-source-'+randomUUID()+'.pcraft',bytes),captured=await captureNativeSelection(view.root,retained.name,{signal:exec.signal});
    const stale=view.sourceId!==identity.sourceId||view.epoch!==identity.epoch||view.sourceRevision!==source.revision||!sameUint64(view.document?.uid,identity.uid)||!sameUint64(view.document?.revision,identity.revision)||view.document?.selectionStamp!==identity.stamp;
    return {json:JSON.stringify({ok:true,stale,sourceId:identity.sourceId,sourceRevision:source.revision,sourceHash:source.meta.sourceHash,selectionStampSha256:createHash('sha256').update(identity.stamp).digest('hex'),maskAsset:captured.maskAsset,width:captured.width,height:captured.height,encoding:captured.encoding,bounds:captured.bounds,coordinateSpace:'image-pixels',...(stale?{warning:'选区或作品在提取期间已改变，蒙版保留但不再代表当前选区'}:{})})};
   }catch(error){return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),readStateBeforeRetry:true})};}}
  });
  scope.effect(()=>()=>dispose?.(),'designcraft: native selection tool');
 });
}
