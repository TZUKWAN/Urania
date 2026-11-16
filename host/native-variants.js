import {createReadStream} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {SafetyError} from './safety.js';
import {sameUint64} from '../client/native-protocol.js';

function relationSignature(manifest,sourceId){
 const byId=(a,b)=>String(a.id).localeCompare(String(b.id));
 const instances=Object.values(manifest.instances||{}).filter(row=>row.sourceId===sourceId).sort(byId);
 const links=Object.values(manifest.links||{}).filter(link=>instances.some(row=>row.linkId===link.id)).sort(byId);
 const colors=Object.values(manifest.brandState?.bindings||{}).filter(row=>row.sourceId===sourceId).sort(byId);
 const fonts=Object.values(manifest.fontState?.bindings||{}).filter(row=>row.sourceId===sourceId).sort(byId);
 const brands=[...new Set([...colors,...fonts].map(row=>row.brandId))].sort().map(id=>({id,color:manifest.brandState?.brands?.[id]?.primary||null,font:manifest.fontState?.tokens?.[id]||null}));
 return createHash('sha256').update(JSON.stringify({instances,links,colors,fonts,brands})).digest('hex');
}

/** Work branches are real native sources. Adoption is a strict source CAS. */
export class NativeVariants {
 constructor(manager){this.manager=manager;}
 async list(view){
  const graph=this.manager.graph(view.root),snapshot=await graph.read(),groups=[];
  for(const group of Object.values(snapshot.manifest.workVariants||{})){
   let original;try{original=await graph.sources.head(group.originalSourceId);}catch{}
   const branches=[];
   for(const branch of group.branches){let head;try{head=await graph.sources.head(branch.sourceId);}catch{}branches.push({...branch,revision:head?.revision||null,modified:!!head&&head.revision!==branch.forkRevision,title:head?.meta.title||branch.label});}
   const op=original?.meta.operation;
   const canAdopt=(original?.revision===group.baseRevision||op?.action==='variant-revert'&&op.groupId===group.id&&op.restoredRevision===group.baseRevision)&&!!group.baseRelationSignature&&relationSignature(snapshot.manifest,group.originalSourceId)===group.baseRelationSignature;
   groups.push({...group,originalRevision:original?.revision||null,canAdopt,adoption:op?.action==='variant-adopt'&&op.groupId===group.id?{...op,revision:original.revision}:null,branches});
  }
  return {revision:snapshot.revision,groups:groups.sort((a,b)=>b.at.localeCompare(a.at))};
 }
 async fork(view,{epoch,sourceRevision,groupId,label,operationId}){
  this.manager.fileActionIdle(view,epoch);
  if(!view.sourceId||view.sourceRevision!==sourceRevision||!sameUint64(view.savedEngineRevision,view.document?.revision))throw new SafetyError('请先保存当前作品再建立方案',409);
  if(typeof label!=='string'||!label.trim()||label.length>80)throw new SafetyError('方案名称需为1至80字',422);
  if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId))throw new SafetyError('方案操作身份无效',422);
  const graph=this.manager.graph(view.root);let state=await graph.read(),group;
  if(!groupId&&['vectorcraft','deckcraft'].includes(view.engine)){await graph.synchronizeSource({sourceId:view.sourceId,sourceRevision});state=await graph.read();}
  if(groupId){
   group=state.manifest.workVariants?.[groupId];
   if(!group||group.originalSourceId!==view.sourceId&&!group.branches.some(row=>row.sourceId===view.sourceId))throw new SafetyError('方案组不属于当前作品',409);
  }else{
   const source=await graph.sources.source(view.sourceId,sourceRevision),id='variants-'+operationId;
   group=state.manifest.workVariants?.[id];
   if(group){if(group.originalSourceId!==view.sourceId||group.baseRevision!==source.revision)throw new SafetyError('方案操作身份已用于其他作品',409);}
   else{const signature=relationSignature(state.manifest,view.sourceId),next=await graph.change(state.revision,value=>{(value.workVariants||={})[id]={id,originalSourceId:view.sourceId,baseRevision:source.revision,baseRelationSignature:signature,title:source.meta.title,engine:source.meta.engine,at:new Date().toISOString(),branches:[]};});state=next;group=next.manifest.workVariants[id];}
  }
  if(group.branches.length>=20)throw new SafetyError('一组最多20个方案',413);
  const base=await graph.sources.source(group.originalSourceId,group.baseRevision),id='variant-'+operationId;
  let branch=await graph.sources.head(id);
  const origin={action:'variant-fork',operationId,sourceId:group.originalSourceId,revision:group.baseRevision,sourceHash:base.meta.sourceHash};
  if(!branch){
   try{branch=await graph.sources.commitStream(id,createReadStream(base.path),{engine:base.meta.engine,title:(group.title+' · '+label.trim()).slice(0,200),engineState:base.meta.engineState,actor:'manual',origin});}
   catch(error){branch=await graph.sources.head(id);if(!branch)throw error;}
  }
  const lineage=await graph.sources.lineage(id),first=lineage[0];
  if(JSON.stringify(first.meta.origin)!==JSON.stringify(origin)||first.meta.sourceHash!==base.meta.sourceHash)throw new SafetyError('方案身份已用于其他源，未覆盖',409);
  const existing=group.branches.find(row=>row.sourceId===id);
  if(!existing){
   const latest=await graph.read();group=latest.manifest.workVariants?.[group.id];
   if(!group||group.baseRevision!==base.revision||group.branches.length>=20)throw new SafetyError('方案组已改变，独立源仍保留在作品列表',409);
   const saved=await graph.change(latest.revision,value=>{value.workVariants[group.id].branches.push({sourceId:id,label:label.trim(),forkRevision:first.revision,at:new Date().toISOString()});});state=saved;
  }
  return {groupId:group.id,sourceId:id,revision:branch.revision,projectRevision:state.revision};
 }
 async adopt(view,{epoch,groupId,sourceId,operationId}){
  this.manager.fileActionIdle(view,epoch);
  if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId))throw new SafetyError('方案操作身份无效',422);
  const graph=this.manager.graph(view.root),state=await graph.read(),group=state.manifest.workVariants?.[groupId],branch=group?.branches.find(row=>row.sourceId===sourceId);
  if(!group||!branch||view.sourceId!==sourceId||view.navigation?.canReturn||!sameUint64(view.savedEngineRevision,view.document?.revision))throw new SafetyError('请先打开并保存需要采用的方案，返回来源编辑后再处理',409);
  if(!group.baseRelationSignature||relationSignature(state.manifest,group.originalSourceId)!==group.baseRelationSignature)throw new SafetyError('原作的素材或品牌关系在分叉后发生变化，双方均已保留，请先逐项比较',409);
  const candidate=await graph.sources.source(sourceId),current=await graph.sources.head(group.originalSourceId);
  if(candidate.revision!==view.sourceRevision||candidate.revision===branch.forkRevision)throw new SafetyError('方案尚未保存实际修改，或当前版本已改变',409);
  const prior=current?.meta.operation;
  if(current?.revision!==group.baseRevision&&!(prior?.action==='variant-revert'&&prior.groupId===groupId&&prior.restoredRevision===group.baseRevision)){
   if(prior?.action==='variant-adopt'&&prior.id===operationId&&prior.groupId===groupId&&prior.variantId===sourceId&&prior.variantRevision===candidate.revision)return {sourceId:group.originalSourceId,revision:current.revision,alreadyAdopted:true};
   throw new SafetyError('原作自分叉后已修改，双方均已保留；请逐项比较后处理冲突',409);
  }
  const lease=this.manager.leases.get(view.root+'\0'+group.originalSourceId);
  if(lease&&lease!==view.id)throw new SafetyError('原作正在其他窗口编辑，未覆盖',423);
  const operation={action:'variant-adopt',id:operationId,groupId,variantId:sourceId,variantRevision:candidate.revision,baseRevision:current.revision,projectRevision:state.revision};
  const key=this.manager.leaseKey(view,group.originalSourceId),claim='variant:'+operationId;
  if(this.manager.claims.has(key))throw new SafetyError('原作正在其他操作中，未采用',423);
  this.manager.claims.set(key,claim);view.switching=true;
  try{
   const saved=await graph.sources.commitStream(group.originalSourceId,createReadStream(candidate.path),{engine:candidate.meta.engine,title:current.meta.title,baseRevision:current.revision,engineState:candidate.meta.engineState,actor:'manual',operation});
   this.manager.onChange(view.root,{kind:'native-source',id:group.originalSourceId,revision:saved.revision});
   if(relationSignature((await graph.read()).manifest,group.originalSourceId)!==group.baseRelationSignature)throw new SafetyError('方案源已保存，但期间素材或品牌关系发生变化；原作前版仍保留，请先核对，不要重复采用',409);
   return {sourceId:group.originalSourceId,revision:saved.revision,previousRevision:current.revision,variantId:sourceId,variantRevision:candidate.revision};
  }finally{view.switching=false;if(this.manager.claims.get(key)===claim)this.manager.claims.delete(key);}
 }
 async undo(view,{epoch,groupId,operationId}){
  this.manager.fileActionIdle(view,epoch);
  if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId))throw new SafetyError('撤销方案操作身份无效',422);
  const graph=this.manager.graph(view.root),state=await graph.read(),group=state.manifest.workVariants?.[groupId];
  if(!group||!group.branches.some(branch=>branch.sourceId===view.sourceId)||view.navigation?.canReturn||!sameUint64(view.savedEngineRevision,view.document?.revision))throw new SafetyError('请先打开并保存此方案，再撤销其对原作的采用',409);
  const head=await graph.sources.head(group.originalSourceId),adoption=head?.meta.operation;
  if(adoption?.action==='variant-revert'&&adoption.id===operationId&&adoption.groupId===groupId)return {sourceId:group.originalSourceId,revision:head.revision,alreadyUndone:true};
  if(adoption?.action!=='variant-adopt'||adoption.groupId!==groupId)throw new SafetyError('原作在采用后已有其他修改，未撤销并保留当前内容',409);
  if(!adoption.projectRevision||state.revision!==adoption.projectRevision)throw new SafetyError('采用后项目关系已改变，未自动撤销；请保留双方并核对素材关系',409);
  const lease=this.manager.leases.get(view.root+'\0'+group.originalSourceId);
  if(lease&&lease!==view.id)throw new SafetyError('原作正在其他窗口编辑，未撤销',423);
  const before=await graph.sources.source(group.originalSourceId,group.baseRevision);
  const operation={action:'variant-revert',id:operationId,groupId,adoptionRevision:head.revision,restoredRevision:before.revision,baseRevision:head.revision};
  const key=this.manager.leaseKey(view,group.originalSourceId),claim='variant:'+operationId;
  if(this.manager.claims.has(key))throw new SafetyError('原作正在其他操作中，未撤销',423);
  this.manager.claims.set(key,claim);view.switching=true;
  try{
   const saved=await graph.sources.commitStream(group.originalSourceId,createReadStream(before.path),{engine:before.meta.engine,title:head.meta.title,baseRevision:head.revision,engineState:before.meta.engineState,actor:'manual',operation});
   this.manager.onChange(view.root,{kind:'native-source',id:group.originalSourceId,revision:saved.revision});
   return {sourceId:group.originalSourceId,revision:saved.revision,restoredRevision:before.revision};
  }finally{view.switching=false;if(this.manager.claims.get(key)===claim)this.manager.claims.delete(key);}
 }
}

export function registerNativeVariantTool(ctx,manager){
 const service=new NativeVariants(manager);
 ctx.inject(['tools'],scope=>{
  const dispose=scope.tools.register({name:'designcraft_native_variants',description:'Manage real independent native work branches. Read designcraft_editor state first. fork copies the exact saved source, not an AI-created design; edit the returned branch before calling adopt. adopt only succeeds if the original has not changed since the branch baseline; otherwise preserve both works and report the conflict. undo restores the pre-adoption native source only if no later original edit exists. list reads the durable state, including a committed adoption after a lost response.',
   parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['list','fork','adopt','undo']},sourceId:{type:'string'},epoch:{type:'string'},base:{type:'object'},groupId:{type:'string'},label:{type:'string'}}},
   output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},timeoutMs:90000,isConcurrencySafe:args=>args.action==='list',
   async execute(args,exec){try{
    const session=exec.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('当前 DSH 对话没有工作区',422);
    const view=manager.views.get(manager.active.get(session.id));if(!view||view.root!==manager.scope(session.id)||Date.now()-view.lastSeen>=30000)throw new SafetyError('请先打开当前对话的设计工作区',409);
    if(args.action==='list')return {json:JSON.stringify({ok:true,...await service.list(view)})};
    if(args.sourceId!==view.sourceId||args.epoch!==view.epoch||!manager.matchesBase(view,args.base))throw new SafetyError('作品或选区已改变，请先读取工作区状态',409);
    await manager.request(session.id,{action:'save',sourceId:view.sourceId,epoch:view.epoch,base:args.base,operationId:exec.callId?String(exec.callId)+'-save':undefined},exec.signal);
    exec.signal?.throwIfAborted();
    const raw=createHash('sha256').update(String(exec.callId||randomUUID())).digest('hex').slice(0,32),operationId=raw.slice(0,8)+'-'+raw.slice(8,12)+'-'+raw.slice(12,16)+'-'+raw.slice(16,20)+'-'+raw.slice(20);
    const data={epoch:view.epoch,sourceRevision:view.sourceRevision,sourceId:view.sourceId,groupId:args.groupId,label:args.label,operationId};
    const result=args.action==='fork'?await service.fork(view,data):args.action==='adopt'?await service.adopt(view,data):await service.undo(view,data);
    return {json:JSON.stringify({ok:true,...result})};
   }catch(error){return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),readStateBeforeRetry:true})};}}
  });
  scope.effect(()=>()=>dispose?.(),'designcraft: native work variants');
 });
}

export function nativeVariantRoutes(manager,{guard,readJsonBody,sendJson}){
 const service=new NativeVariants(manager),base='/designcraft/api/v2/studio/variants';
 return [{kind:'exact',path:base,handler:guard(async(req,res)=>{
  if(req.method!=='POST')throw new SafetyError('POST required',405);
  const body=await readJsonBody(req,16384),view=manager.getView(req.headers['x-designcraft-view'],req.headers['x-designcraft-capability']);
  if(body.epoch!==view.epoch)throw new SafetyError('工作区已切换',409);
  const result=body.action==='list'?await service.list(view):body.action==='fork'?await service.fork(view,body):body.action==='adopt'?await service.adopt(view,body):body.action==='undo'?await service.undo(view,body):null;
  if(!result)throw new SafetyError('未知作品方案操作',422);sendJson(res,200,{ok:true,...result});
 })}];
}
