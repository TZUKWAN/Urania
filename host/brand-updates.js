// Source bytes remain authoritative. Project history stores the exact approved
// members and per-file receipts so a lost response never replays a saved edit.
import {randomBytes} from 'node:crypto';
import {BrandBindings,actualSolidFill,assertBrandFillOnly,assertVectorBrandAssignmentOnly,assertDeckBrandAssignmentOnly,vectorBrandOrigins,deckBrandOrigins} from './brand-bindings.js';
import {nativeDeckNodes} from './native-deck-header.js';
import {nativeVectorHeader} from './native-vector-header.js';
import {isUint64,sameUint64} from '../client/native-protocol.js';
import {selectedObjectIds,validateNativeIdentity} from '../client/native-contract.js';
import {SafetyError} from './safety.js';
import {designResourceCatalog} from './design-resources.js';
import {readOpenDesignStyle} from './open-design-style.js';
import {loadSavedOpenDesignPackage} from './open-design-package.js';
import {materialize} from './open-design-tools.js';
import {readExternalTheme} from './external-theme.js';
import {materializeExternalSkillFile} from './external-skill-bundles.js';

const MAX_TARGETS=100;
const MAX_BYTES=256*1024*1024;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const color=/^#[0-9A-F]{6}$/;
const token=/^[a-f0-9]{32}$/;
const sourceId=/^[a-zA-Z0-9][\w-]{0,80}$/;
const brand=id=>typeof id==='string'&&id.startsWith('brand-')&&uuid.test(id.slice(6));
const binding=id=>typeof id==='string'&&id.startsWith('brandcolor-')&&uuid.test(id.slice(11));
const sameIds=(a,b)=>Array.isArray(a)&&a.length===b.length&&new Set(a).size===a.length&&b.every(id=>a.includes(id));
function requireValue(condition,message,status=409){if(!condition)throw new SafetyError(message,status);}
function origins(engine,bytes){return engine==='vectorcraft'?vectorBrandOrigins(bytes):deckBrandOrigins(bytes);}
function stateFor(manifest){return manifest.brandState||{schema:1,brands:{},bindings:{}};}
function changeResult(state,plan){return {id:plan.id,kind:plan.kind,status:plan.status,committed:plan.committed,overrides:plan.overrides,primary:state.brands[plan.brandId].primary};}
function finishIfReady(state,plan){
 const complete=Object.keys(plan.groups).every(id=>plan.committed[id]);
 plan.status=complete?'succeeded':Object.keys(plan.committed).length?'partial':'prepared';
 if(complete&&plan.kind==='recolor')state.brands[plan.brandId].primary=plan.next;
}

export function brandReceipt(operation,baseRevision){
 requireValue(operation&&operation.action==='brand-edit'&&uuid.test(operation.id)&&brand(operation.brandId)&&['attach','recolor'].includes(operation.kind)&&digest.test(baseRevision)&&operation.baseRevision===baseRevision,'品牌源回执身份无效',422);
 requireValue(Array.isArray(operation.bindingIds)&&operation.bindingIds.length>0&&operation.bindingIds.length<=MAX_TARGETS&&operation.bindingIds.every(binding)&&new Set(operation.bindingIds).size===operation.bindingIds.length,'品牌源回执成员无效',422);
 return {action:'brand-edit',id:operation.id,kind:operation.kind,brandId:operation.brandId,baseRevision,bindingIds:[...operation.bindingIds]};
}
export function validateBrandUpdates(state){
 if(state?.updates===undefined)return;
 requireValue(state.updates&&typeof state.updates==='object'&&!Array.isArray(state.updates)&&Object.keys(state.updates).length<=1000,'品牌更新记录无效或超过预算',422);
 const openBrands=new Set();
 for(const [key,plan] of Object.entries(state.updates)){
  requireValue(plan&&key===plan.id&&uuid.test(key)&&state.brands[plan.brandId]&&['attach','recolor'].includes(plan.kind)&&['prepared','partial','succeeded','cancelled'].includes(plan.status)&&color.test(plan.previous)&&color.test(plan.next),'品牌更新归属无效',422);
  requireValue(plan.groups&&typeof plan.groups==='object'&&!Array.isArray(plan.groups)&&plan.committed&&typeof plan.committed==='object'&&!Array.isArray(plan.committed)&&Array.isArray(plan.overrides)&&plan.overrides.every(binding),'品牌更新源清单无效',422);
  const seen=new Set();
  for(const [id,group] of Object.entries(plan.groups)){
   requireValue(sourceId.test(id)&&group&&digest.test(group.baseRevision)&&['deckcraft','vectorcraft'].includes(group.engine)&&Array.isArray(group.rows)&&group.rows.length>0,'品牌更新源版本无效',422);
   for(const row of group.rows){
    requireValue(row&&binding(row.bindingId)&&!seen.has(row.bindingId)&&isUint64(row.nativeId)&&color.test(row.previous)&&(row.token===null||token.test(row.token)),'品牌更新对象无效',422);
    seen.add(row.bindingId);
   }
  }
  requireValue(seen.size<=MAX_TARGETS&&plan.overrides.length<=MAX_TARGETS&&Object.entries(plan.committed).every(([id,rev])=>Object.hasOwn(plan.groups,id)&&digest.test(rev)),'品牌更新进度无效',422);
  if(['prepared','partial'].includes(plan.status)){
   requireValue(!openBrands.has(plan.brandId),'品牌已有另一项待恢复更新',409);openBrands.add(plan.brandId);
  }
 }
}

function commandTarget(source,rawId){
 const id=String(rawId);
 const fill=actualSolidFill(source.bytes,source.meta.engine,id);
 if(source.meta.engine==='deckcraft')return {nativeId:id,fill,pageId:nativeDeckNodes(source.bytes).get(id).layoutPage.id};
 const header=nativeVectorHeader(source.bytes);
 const queue=[...header.document.layers];
 while(queue.length){
  const node=queue.pop();
  if(String(node.id)===id)return {nativeId:id,fill,fillIndex:node.appearance.items.findIndex(item=>item.kind==='fill')};
  if(node.kind?.children)for(const child of node.kind.children)queue.push(child);
 }
 throw new SafetyError('找不到所选路径',409);
}

export class BrandUpdates{
 constructor(manager){this.manager=manager;}
 graph(view){return this.manager.graph(view.root);}
 job(view,body){
  const job=this.manager.linked.job(view,body,['brand']);
  requireValue(!job.cancelRequested,'品牌操作已停止',499);
  return job;
 }
 async inspect(view){
  const graph=this.graph(view),registry=new BrandBindings(graph);
  const snapshot=await registry.inspect();
  const ids=view.document?selectedObjectIds(view.document):[];
  let selection=null;
  if(ids.length===1&&['vectorcraft','deckcraft'].includes(view.engine)&&view.sourceRevision){
   try{
    const actual=await graph.sources.read(view.sourceId);
    if(actual.revision===view.sourceRevision){
     const target=commandTarget(actual,ids[0]);
     if(view.engine==='vectorcraft'||view.document.page?.nativePage?.id===target.pageId)selection={...target,sourceId:view.sourceId,sourceRevision:actual.revision};
    }
   }catch(error){if(!(error instanceof SafetyError))throw error;}
  }
  const styles=designResourceCatalog().map(s=>({id:s.id,name:s.name,primary:s.colors.primary?.toUpperCase()})).filter(s=>color.test(s.primary));
  return {...snapshot,selection,styles};
 }
 async start(view,body){
  const job=this.job(view,body),graph=this.graph(view),registry=new BrandBindings(graph),payload=job.payload;
  const {manifest,revision}=await graph.read(),state=stateFor(manifest);
  requireValue(payload.command==='resume'||payload.revision===revision,'项目关系已有修改，请重新查看品牌色');
  if(payload.command==='create'){
   let externalResource,themeSource;
   if(payload.themeSource!==undefined){
    const input=payload.themeSource;
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['bundleId','file','gitSha1','sha256'].includes(key))||payload.resourceId||!/^externalbundle-[a-f0-9]{64}$/.test(input.bundleId||'')||!/^skills\/theme-factory\/themes\/[a-z0-9][a-z0-9-]{0,79}\.md$/.test(input.file||'')||!/^[a-f0-9]{40}$/.test(input.gitSha1||'')||!digest.test(input.sha256||'')||!color.test(payload.primary||''))throw new SafetyError('主题选择或来源身份无效',422);
    const library=this.manager.openDesignLibrary;if(!library)throw new SafetyError('外部主题资源库不可用',503);
    const current=()=>{if(job.cancelRequested||job.status!=='running'||this.manager.active.get(view.sessionId)!==view.id||view.epoch!==job.epoch||this.manager.scope(view.sessionId)!==view.root)throw new SafetyError('品牌创建已停止或工作区已改变；主题原件可能已保留',409);};
    current();const theme=await readExternalTheme(library,view.root,input.bundleId,input.file);current();
    requireValue(theme.gitSha1===input.gitSha1&&theme.sha256===input.sha256&&theme.colors.some(item=>item.hex===payload.primary),'主题文件或所选颜色已改变，请重新选择');
    const saved=await materializeExternalSkillFile(library,view.root,input.bundleId,input.file,undefined,current);current();
    requireValue(saved.file.bundleId===input.bundleId&&saved.file.file===input.file&&saved.file.gitSha1===input.gitSha1&&saved.file.sha256===input.sha256,'主题原件来源不一致');
    themeSource={schema:1,kind:'external-theme',bundleId:input.bundleId,fileId:saved.file.id,file:input.file,gitSha1:input.gitSha1,sha256:input.sha256,selectedHex:payload.primary};
   }
   if(payload.resourceId&&!designResourceCatalog().some(style=>style.id===payload.resourceId)){
    const library=this.manager.openDesignLibrary;if(!library)throw new SafetyError('按需设计系统资源库不可用',503);
    const packageId='design-systems/'+payload.resourceId,savedPackage=await loadSavedOpenDesignPackage(library,view.root,packageId);
    const style=await readOpenDesignStyle(library,payload.resourceId,undefined,{sourceFiles:savedPackage?.files});
    requireValue(style.primary===payload.primary,'设计系统的实际主色已改变，请重新选择');
    const [manifest,tokens]=await Promise.all(['manifest.json',style.tokenFile].map(file=>materialize(library,view.root,packageId,file,undefined,savedPackage)));
    requireValue(manifest.receipt.sha256===style.files.find(f=>f.file==='manifest.json').sha256&&tokens.receipt.sha256===style.files.find(f=>f.file===style.tokenFile).sha256,'设计系统原件与令牌核对不一致');
    requireValue(!job.cancelRequested,'品牌创建已停止；已读取的资源原件仍保留',499);
    externalResource={id:style.id,repository:style.repository,revision:style.revision,font:style.font,tokenFile:style.tokenFile,manifestResourceId:manifest.receipt.id,tokenResourceId:tokens.receipt.id};
   }
   job.projectMutation=await registry.create({baseRevision:revision,name:payload.name,primary:payload.primary,resourceId:payload.resourceId,externalResource,themeSource});
   return {result:job.projectMutation};
  }
  const currentPlan=Object.values(state.updates||{}).find(plan=>['prepared','partial'].includes(plan.status)&&plan.brandId===payload.brandId);
  if(payload.command==='resume'){
   requireValue(uuid.test(payload.updateId)&&state.updates?.[payload.updateId],'待恢复的品牌更新不存在',404);
   return this.schedule(view,job,state.updates[payload.updateId]);
  }
  const currentBrand=state.brands[payload.brandId];
  requireValue(brand(payload.brandId)&&currentBrand,'项目品牌不存在',404);
  requireValue(!currentPlan,'此品牌还有待处理的更新，请先继续');
  if(payload.command==='disable'||payload.command==='enable'){
   const entry=state.bindings[payload.bindingId];
   requireValue(entry?.brandId===currentBrand.id,'该对象不属于此品牌');
   if(payload.command==='enable'){
    const saved=await graph.sources.read(entry.sourceId),marker=origins(entry.engine,saved.bytes).get(entry.nativeId);
    requireValue(entry.objectToken&&marker?.instanceId===entry.objectToken&&marker?.bindingId===entry.id&&marker?.projectId===manifest.id&&actualSolidFill(saved.bytes,entry.engine,entry.nativeId)===currentBrand.primary,'请先将该对象恢复为品牌主色，再重新绑定');
   }
   const next=await graph.change(revision,value=>{
    const row=value.brandState.bindings[entry.id];row.enabled=payload.command==='enable';
    if(row.enabled)row.confirmedValue=currentBrand.primary;
   });
   job.projectMutation={revision:next.revision,bindingId:entry.id,enabled:payload.command==='enable'};
   return {result:job.projectMutation};
  }
  const plan={id:job.id,kind:payload.command==='attach'?'attach':'recolor',brandId:currentBrand.id,previous:currentBrand.primary,next:currentBrand.primary,groups:{},committed:{},overrides:[],status:'prepared',at:new Date().toISOString()};
  if(payload.command==='attach'){
   const selected=selectedObjectIds(view.document);
   requireValue(selected.length===1&&sameUint64(selected[0],payload.nativeId)&&payload.sourceRevision===view.sourceRevision,'所选对象或源版本已改变');
   const actual=await graph.sources.read(view.sourceId),target=commandTarget(actual,payload.nativeId);
   requireValue(actual.revision===payload.sourceRevision&&target.fill===currentBrand.primary,'所选对象的已保存填色与品牌主色不同');
   requireValue(target.pageId===undefined||target.pageId===view.document.page?.nativePage?.id,'所选对象不在当前幻灯片');
   requireValue(!Object.values(state.bindings).some(row=>row.sourceId===view.sourceId&&row.nativeId===target.nativeId),'该对象已登记品牌，请使用已有绑定');
   requireValue(!origins(actual.meta.engine,actual.bytes).has(target.nativeId),'对象已有品牌身份，请核对原绑定');
   plan.groups[view.sourceId]={engine:actual.meta.engine,baseRevision:actual.revision,rows:[{bindingId:'brandcolor-'+job.id,nativeId:target.nativeId,previous:target.fill,token:actual.meta.engine==='vectorcraft'?randomBytes(16).toString('hex'):null}]};
  }else if(payload.command==='recolor'){
   const preview=await registry.prepare({baseRevision:revision,brandId:currentBrand.id,primary:payload.primary,bindingIds:payload.bindingIds});
   requireValue(preview.targets.length+preview.conflicts.length<=MAX_TARGETS,'一次最多更新 100 个品牌对象',413);
   requireValue(preview.conflicts.every(row=>row.status==='color_changed')&&sameIds(payload.overrideIds,preview.conflicts.map(row=>row.id)),'对象身份、手动改色或成员已有变化，请重新查看');
   plan.next=payload.primary;plan.overrides=preview.conflicts.map(row=>row.id);
   for(const row of preview.targets){
    requireValue(row.objectToken,'旧绑定缺少原生身份，请重新绑定');
    const group=plan.groups[row.sourceId]||={engine:row.engine,baseRevision:row.currentSourceRevision,rows:[]};
    group.rows.push({bindingId:row.id,nativeId:row.nativeId,token:row.objectToken,previous:row.confirmedValue});
   }
  }else throw new SafetyError('未知的品牌动作',422);
  const saved=await graph.change(revision,value=>{
   const state=value.brandState;(state.updates||={})[plan.id]=plan;finishIfReady(state,plan);
  });
  return this.schedule(view,job,saved.manifest.brandState.updates[plan.id]);
 }
 async complete(graph,plan,id,savedRevision){
  const {manifest,revision}=await graph.read(),state=stateFor(manifest),live=state.updates[plan.id];
  if(live.committed[id]){requireValue(live.committed[id]===savedRevision,'品牌文件版本存在冲突');return live;}
  const group=live.groups[id],saved=await graph.sources.read(id,savedRevision),op=saved.meta.operation;
  requireValue(op?.action==='brand-edit'&&op.id===live.id&&op.brandId===live.brandId&&op.kind===live.kind&&sameIds(op.bindingIds,group.rows.map(row=>row.bindingId))&&saved.meta.parentRevision===op.baseRevision&&op.baseRevision===group.baseRevision,'已保存版本缺少本次品牌更新回执');
  const before=await graph.sources.read(id,group.baseRevision);
  const markers=this.verify(manifest.id,live,group,before.bytes,saved.bytes);
  const next=await graph.change(revision,value=>{
   const state=value.brandState,plan=state.updates[live.id];
   for(const row of group.rows){
    if(plan.kind==='attach')state.bindings[row.bindingId]={id:row.bindingId,brandId:plan.brandId,sourceId:id,nativeId:row.nativeId,engine:group.engine,property:'fill',token:'primary',enabled:true,objectToken:markers.get(row.nativeId).instanceId};
    Object.assign(state.bindings[row.bindingId],{sourceRevision:savedRevision,confirmedValue:plan.next});
   }
   plan.committed[id]=savedRevision;finishIfReady(state,plan);
  });
  return next.manifest.brandState.updates[live.id];
 }
 verify(projectId,plan,group,before,after){
  const markers=origins(group.engine,after);
  if(plan.kind==='attach'){
   const row=group.rows[0],marker=markers.get(row.nativeId);
   requireValue(group.rows.length===1&&marker&&(!row.token||row.token===marker.instanceId),'原生编辑器没有保存指定的对象标记');
   const check=group.engine==='deckcraft'?assertDeckBrandAssignmentOnly:assertVectorBrandAssignmentOnly;
   check(before,after,row.nativeId,{projectId,bindingId:row.bindingId,instanceId:marker.instanceId});
   requireValue(actualSolidFill(before,group.engine,row.nativeId)===plan.previous,'绑定颜色已改变');
  }else{
   const previousMarkers=origins(group.engine,before);
   for(const row of group.rows){
    const old=previousMarkers.get(row.nativeId),current=markers.get(row.nativeId);
    requireValue(old?.instanceId===row.token&&old?.projectId===projectId&&old?.bindingId===row.bindingId&&current?.instanceId===row.token,'品牌对象身份已改变');
   }
   assertBrandFillOnly(before,after,group.engine,group.rows.map(row=>row.nativeId),plan.previous,plan.next);
  }
  return markers;
 }
 async schedule(view,job,plan){
  const graph=this.graph(view),m=this.manager,targets=[];
  job.brandTransactionId=plan.id;
  for(const id of Object.keys(plan.groups)){
   if(plan.committed[id])continue;
   const receipts=(await graph.sources.versions(id)).filter(v=>v.operation?.action==='brand-edit'&&v.operation.id===plan.id);
   requireValue(receipts.length<=1,'同一品牌动作出现多个源回执');
   if(receipts.length)plan=await this.complete(graph,plan,id,receipts[0].revision);
  }
  let state=await graph.read();
  if(plan.status==='succeeded'){
   job.projectMutation=changeResult(state.manifest.brandState,plan);
   return {result:job.projectMutation};
  }
  // Update the original canvas last; partial work before then cannot stale it.
  const ids=Object.keys(plan.groups).filter(id=>!plan.committed[id]).sort((a,b)=>Number(a===view.sourceId)-Number(b===view.sourceId));
  for(const id of ids){
   this.job(view,{epoch:view.epoch,jobId:job.id});
   const group=plan.groups[id],actual=await graph.sources.read(id),key=m.leaseKey(view,id);
   const markerMap=origins(group.engine,actual.bytes);
   const rows=group.rows.map(row=>{
    const target=commandTarget(actual,row.nativeId);
    requireValue(target.fill===row.previous,'待更新对象的颜色已由人工修改，请保留新颜色并核对此次更新');
    if(plan.kind==='attach')requireValue(actual.revision===group.baseRevision&&!markerMap.has(row.nativeId),'绑定前设计已改变，请重新选择对象');
    else{
     const marker=markerMap.get(row.nativeId);
     requireValue(marker?.instanceId===row.token&&marker?.bindingId===row.bindingId&&marker?.projectId===state.manifest.id,'待更新对象的身份已改变');
    }
    return {...target,...row};
   });
   const owner=m.views.get(m.leases.get(key)),claim=m.claims.get(key);
   requireValue(!claim||claim==='linked:'+job.id,'设计正在其他操作中',423);
   requireValue(!owner||owner.id===view.id||!owner.saving&&!owner.switching&&Date.now()-owner.lastSeen>=30000,'设计正在另一窗口编辑',423);
   if(owner?.id===view.id)requireValue(!view.saving&&view.sourceRevision===actual.revision&&sameUint64(view.savedEngineRevision,view.document?.revision),'请先保存当前设计并重新查看');
   m.claims.set(key,'linked:'+job.id);(job.linkedClaimKeys||=[]).push(key);
   if(actual.revision!==group.baseRevision){
    state=await graph.change(state.revision,value=>{value.brandState.updates[plan.id].groups[id].baseRevision=actual.revision;});
    plan=state.manifest.brandState.updates[plan.id];
   }
   targets.push({sourceId:id,engine:group.engine,title:actual.meta.title,sourceHash:actual.meta.sourceHash,baseRevision:actual.revision,rows});
  }
  return {transactionId:plan.id,kind:plan.kind,projectId:state.manifest.id,primary:plan.next,targets};
 }
 async source(view,body){
  const job=this.job(view,body),graph=this.graph(view),current=await graph.read(),plan=current.manifest.brandState?.updates?.[job.brandTransactionId],group=plan?.groups[body.sourceId];
  requireValue(group&&!plan.committed[body.sourceId]&&this.manager.claims.get(this.manager.leaseKey(view,body.sourceId))==='linked:'+job.id,'此品牌文件未获得修改许可');
  const source=await graph.sources.source(body.sourceId);
  requireValue(source.revision===group.baseRevision,'文件已有新版本，请恢复后按最新版本继续');
  return {job,graph,source,plan,group,projectId:current.manifest.id};
 }
 async commit(view,body,input){
  const job=this.job(view,body);
  requireValue(!job.linkedSaving,'正在提交一个品牌文件',423);
  job.linkedSaving=true;
  try{
   validateNativeIdentity(body.engineState);
   const chunks=[];let size=0;
   for await(const chunk of input){size+=chunk.length;requireValue(size<=MAX_BYTES,'品牌更新源超过预算',413);chunks.push(chunk);}
   const {graph,source,group,plan,projectId}=await this.source(view,body);
   const bytes=Buffer.concat(chunks),before=await graph.sources.read(body.sourceId,source.revision);
   this.verify(projectId,plan,group,before.bytes,bytes);
   this.job(view,body);
   const result=await graph.sources.commit(body.sourceId,{engine:group.engine,title:source.meta.title,bytes,baseRevision:source.revision,engineState:body.engineState,actor:job.initiator,operation:{action:'brand-edit',id:plan.id,brandId:plan.brandId,kind:plan.kind,baseRevision:source.revision,bindingIds:group.rows.map(row=>row.bindingId)}});
   const done=await this.complete(graph,plan,body.sourceId,result.revision);
   this.manager.onChange(view.root,{kind:'native-source',id:body.sourceId,revision:result.revision});
   const state=(await graph.read()).manifest.brandState,summary=changeResult(state,done);
   if(done.status==='succeeded')job.projectMutation=summary;
   return {revision:result.revision,result:summary};
  }finally{
   job.linkedSaving=false;
   if(job.status!=='running')this.manager.linked.release(job);
  }
 }
}
