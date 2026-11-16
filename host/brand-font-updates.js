import {createHash,randomBytes} from 'node:crypto';
import {readZip} from './zip.js';
import {SafetyError} from './safety.js';
import {nativeVectorHeader} from './native-vector-header.js';
import {nativeDeckDocument} from './native-deck-header.js';
import {isUint64,sameUint64} from '../client/native-protocol.js';
import {selectedObjectIds,validateNativeIdentity} from '../client/native-contract.js';
import {fontOrigins,assertFontAssignmentOnly} from './brand-font-identity.js';

const uuid=/^[a-f0-9-]{36}$/,sha=/^[a-f0-9]{64}$/,brand=/^brand-[a-f0-9-]{36}$/,binding=/^brandfont-[a-f0-9-]{36}$/;
const EAST_ASIAN=/[\u1100-\u11ff\u2e80-\u30ff\u3130-\u318f\u31f0-\u31ff\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff\ufe30-\ufe4f\uff00-\uffef]|[\u{20000}-\u{3134f}]/u;
const validFont=value=>typeof value==='string'&&!!value.trim()&&value.length<=200&&!/[\x00-\x1f]/.test(value);
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&b.every(value=>a.includes(value));
const requireValue=(yes,message,status=409)=>{if(!yes)throw new SafetyError(message,status);};
const empty=()=>({schema:1,tokens:{},bindings:{},updates:{}});

export function validateFontState(value,brands){
 if(value===undefined)return;
 requireValue(value&&value.schema===1&&value.tokens&&value.bindings&&value.updates&&typeof value.tokens==='object'&&typeof value.bindings==='object'&&typeof value.updates==='object'&&!Array.isArray(value.tokens)&&!Array.isArray(value.bindings)&&!Array.isArray(value.updates),'品牌字体关系无效',422);
 requireValue(Object.keys(value.tokens).length<=100&&Object.keys(value.bindings).length<=5000&&Object.keys(value.updates).length<=1000,'品牌字体关系超过预算',413);
 for(const [id,font] of Object.entries(value.tokens))requireValue(brand.test(id)&&brands?.[id]&&validFont(font),'品牌字体令牌无效',422);
 const targets=new Set();
 for(const [id,row] of Object.entries(value.bindings)){
  requireValue(binding.test(id)&&row.id===id&&brand.test(row.brandId)&&value.tokens[row.brandId]&&typeof row.sourceId==='string'&&sha.test(row.sourceRevision)&&isUint64(row.nativeId)&&['vectorcraft','deckcraft'].includes(row.engine)&&validFont(row.confirmedFont)&&typeof row.enabled==='boolean'&&(row.objectToken===undefined||/^[a-f0-9]{32}$/.test(row.objectToken)),'品牌字体绑定无效',422);
  const key=JSON.stringify([row.sourceId,String(row.nativeId)]);requireValue(!targets.has(key),'同一文字不能重复绑定品牌字体',409);targets.add(key);
 }
 const openBrands=new Set();for(const [id,plan] of Object.entries(value.updates)){
  requireValue(uuid.test(id)&&plan.id===id&&brand.test(plan.brandId)&&value.tokens[plan.brandId]&&validFont(plan.previous)&&validFont(plan.next)&&(plan.kind===undefined||['font-attach','font-change'].includes(plan.kind))&&['prepared','partial','succeeded','cancelled'].includes(plan.status)&&plan.groups&&plan.committed&&Array.isArray(plan.overrides),'品牌字体更新无效',422);
  let count=0;const seen=new Set();
  for(const [source,group] of Object.entries(plan.groups)){
   requireValue(typeof source==='string'&&sha.test(group.baseRevision)&&['vectorcraft','deckcraft'].includes(group.engine)&&Array.isArray(group.rows)&&group.rows.length>0&&group.rows.length<=100,'品牌字体更新目标无效',422);
   for(const row of group.rows){const bound=value.bindings[row.bindingId],attach=plan.kind==='font-attach';requireValue(binding.test(row.bindingId)&&!seen.has(row.bindingId)&&isUint64(row.nativeId)&&validFont(row.previous)&&(row.token===undefined||row.token===null||/^[a-f0-9]{32}$/.test(row.token))&&(attach?!bound||bound.sourceId===source&&bound.brandId===plan.brandId&&bound.engine===group.engine&&sameUint64(bound.nativeId,row.nativeId):bound?.sourceId===source&&bound.brandId===plan.brandId&&bound.engine===group.engine&&sameUint64(bound.nativeId,row.nativeId)),'品牌字体更新成员无效',422);if(!attach&&row.token&&['prepared','partial'].includes(plan.status))requireValue(bound.objectToken===row.token,'待处理的字体身份已改变',409);seen.add(row.bindingId);count++;}
  }
  requireValue(count<=100&&plan.overrides.length<=100&&plan.overrides.every(id=>binding.test(id)&&value.bindings[id]?.brandId===plan.brandId)&&Object.entries(plan.committed).every(([id,revision])=>Object.hasOwn(plan.groups,id)&&sha.test(revision)),'品牌字体更新进度无效',422);
  if(plan.kind==='font-attach'){
   requireValue(count===1&&Object.keys(plan.groups).length===1&&plan.overrides.length===0&&plan.previous===plan.next,'字体绑定事务无效',422);
   const [source,group]=Object.entries(plan.groups)[0],row=group.rows[0],bound=value.bindings[row.bindingId];
   if(plan.committed[source]||plan.status==='succeeded')requireValue(plan.committed[source]&&/^[a-f0-9]{32}$/.test(bound?.objectToken||''),'已完成的字体绑定缺少对象身份或回执',422);
  }
  if(['prepared','partial'].includes(plan.status)){requireValue(!openBrands.has(plan.brandId),'同一品牌有多项未结束的字体更新',409);openBrands.add(plan.brandId);}
 }
}
export function fontReceipt(op,baseRevision){
 requireValue(op?.action==='brand-font'&&uuid.test(op.id||'')&&brand.test(op.brandId||'')&&(op.kind===undefined||['font-attach','font-change'].includes(op.kind))&&op.baseRevision===baseRevision&&sha.test(baseRevision||'')&&Array.isArray(op.bindingIds)&&op.bindingIds.length>0&&op.bindingIds.length<=100&&op.bindingIds.every(id=>binding.test(id))&&new Set(op.bindingIds).size===op.bindingIds.length,'品牌字体保存回执无效',422);
 return {action:'brand-font',id:op.id,brandId:op.brandId,...(op.kind?{kind:op.kind}:{}),baseRevision,bindingIds:[...op.bindingIds]};
}
function vectorNode(doc,id){
 let found,count=0;const walk=(nodes,blocked=false,depth=0)=>{if(depth>64||!Array.isArray(nodes))throw new SafetyError('文字源层级无效',422);for(const node of nodes){if(++count>100000)throw new SafetyError('文字源对象超过预算',413);const unavailable=blocked||node.hidden||node.locked||node.visible===false;if(String(node.id)===String(id)){if(found||unavailable)throw new SafetyError('文字对象隐藏、锁定或身份重复',409);found=node;}if(node.kind?.children)walk(node.kind.children,unavailable,depth+1);}};
 walk(doc.layers);return found;
}
function deckNode(doc,id){
 let found,pageId,count=0;const walk=(nodes,slide,blocked=false,depth=0)=>{if(depth>64||!Array.isArray(nodes))throw new SafetyError('演示文字层级无效',422);for(const node of nodes){if(++count>20000)throw new SafetyError('演示文字对象超过预算',413);const unavailable=blocked||node.hidden||node.locked;if(String(node.id)===String(id)){if(found||unavailable)throw new SafetyError('文字对象隐藏、锁定或身份重复',409);found=node;pageId=slide;}if(node.kind?.type==='group')walk(node.kind.children,slide,unavailable,depth+1);}};
 for(const slide of doc.slides)walk(slide.shapes,slide.id);return {node:found,pageId};
}
function runs(node,engine){
 if(engine==='vectorcraft'){
  if(node?.kind?.type!=='text'||!Array.isArray(node.kind.runs)||!node.kind.runs.length)throw new SafetyError('请选择具有明确字体的海报文字',422);
  return node.kind.runs;
 }
 const paragraphs=node?.text?.paragraphs;if(!Array.isArray(paragraphs))throw new SafetyError('请选择具有明确字体的演示文字',422);
 const result=paragraphs.flatMap(para=>para.runs||[]).filter(run=>typeof run.text==='string'&&run.text.length);
 if(!result.length)throw new SafetyError('空文字不能绑定字体',422);return result;
}
function target(bytes,engine,id){
 const doc=engine==='vectorcraft'?nativeVectorHeader(bytes).document:nativeDeckDocument(bytes),found=engine==='vectorcraft'?{node:vectorNode(doc,id)}:deckNode(doc,id),items=runs(found.node,engine);
 const fonts=items.map(run=>engine==='vectorcraft'?run.style?.font_family:run.props?.font);
 if(fonts.some(value=>!validFont(value)||value.startsWith('+'))||new Set(fonts).size!==1)throw new SafetyError('文字使用多种或继承的字体，请先在原生编辑器中明确字体',422);
 const eastAsian=engine==='deckcraft'&&items.some(run=>EAST_ASIAN.test(run.text));
 if(eastAsian&&items.some(run=>run.props?.fontEa&&run.props.fontEa!==fonts[0]||EAST_ASIAN.test(run.text)&&run.props?.fontEa!==fonts[0]))throw new SafetyError('中西文字体不同或东亚文字体沿用主题，请先用工具栏统一中西文字体再绑定',422);
 return {nativeId:String(id),font:fonts[0],eastAsian,...(found.pageId!==undefined?{pageId:found.pageId}:{})};
}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function replaceField(next,old,key){if(Object.hasOwn(old,key))next[key]=old[key];else delete next[key];}
function assertFontOnly(beforeBytes,afterBytes,engine,rows,expected){
 let before,after,priorEntries,nextEntries;
 if(engine==='vectorcraft'){before=nativeVectorHeader(beforeBytes);after=nativeVectorHeader(afterBytes);}
 else{
  const options={maxEntries:20000,maxEntryBytes:256*1024*1024,maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024};
  priorEntries=readZip(beforeBytes,options);nextEntries=readZip(afterBytes,options);
  before=JSON.parse(priorEntries.find(entry=>entry.name==='presentation.json').data);after=JSON.parse(nextEntries.find(entry=>entry.name==='presentation.json').data);
 }
 for(const row of rows){
  const beforeTarget=target(beforeBytes,engine,row.nativeId),afterTarget=target(afterBytes,engine,row.nativeId);
  requireValue(beforeTarget.font===row.previous&&afterTarget.font===expected&&beforeTarget.eastAsian===afterTarget.eastAsian,'文字字体与更新前后值不一致');
  const oldNode=engine==='vectorcraft'?vectorNode(before.document,row.nativeId):deckNode(before.presentation,row.nativeId).node;
  const newNode=engine==='vectorcraft'?vectorNode(after.document,row.nativeId):deckNode(after.presentation,row.nativeId).node;
  if(engine==='vectorcraft'){
   const oldRuns=runs(oldNode,engine),newRuns=runs(newNode,engine);requireValue(oldRuns.length===newRuns.length,'文字分段发生变化，未提交字体更新');
   for(let i=0;i<oldRuns.length;i++){
    requireValue(oldRuns[i].text===newRuns[i].text,'文字内容发生变化，未提交字体更新');
    for(const field of ['font_family','font_style','font_version','fontAxes'])replaceField(newRuns[i].style,oldRuns[i].style,field);
   }
  }else{
   // Deck's real format.font also updates each paragraph end mark, including
   // empty paragraphs. Prove those changes separately before normalizing them.
   const oldParas=oldNode.text.paragraphs,newParas=newNode.text.paragraphs;
   requireValue(oldParas.length===newParas.length,'文字段落发生变化，未提交字体更新');
   const restoreFont=(oldOwner,newOwner,key)=>{
    const old=oldOwner[key],next=newOwner[key];
    const fields=beforeTarget.eastAsian?['font','fontEa']:['font'];
    requireValue(next&&typeof next==='object'&&fields.every(field=>next[field]===expected),'演示文字或段末字体与目标不一致');
    if(old&&typeof old==='object')for(const field of fields)replaceField(next,old,field);
    else{for(const field of fields)delete next[field];if(!Object.keys(next).length)delete newOwner[key];}
   };
   for(let i=0;i<oldParas.length;i++){
    const oldPara=oldParas[i],newPara=newParas[i],oldRuns=oldPara.runs||[],newRuns=newPara.runs||[];
    requireValue(oldRuns.length===newRuns.length,'文字分段发生变化，未提交字体更新');
    for(let j=0;j<oldRuns.length;j++){
     requireValue(oldRuns[j].text===newRuns[j].text,'文字内容发生变化，未提交字体更新');
     restoreFont(oldRuns[j],newRuns[j],'props');
    }
    restoreFont(oldPara,newPara,'endProps');
   }
  }
 }
 if(engine==='vectorcraft'){
  const magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]),a=beforeBytes.indexOf(magic),b=afterBytes.indexOf(magic);
  requireValue((a<0)===(b<0)&&(a<0||beforeBytes.subarray(a).equals(afterBytes.subarray(b)))&&JSON.stringify(before)===JSON.stringify(after),'字体更新改变了其他海报内容');
 }else{
  const hashes=entries=>new Map(entries.filter(item=>item.name!=='presentation.json').map(item=>[item.name,digest(item.data)])),a=hashes(priorEntries),b=hashes(nextEntries);
  requireValue(a.size===b.size&&[...a].every(([name,value])=>b.get(name)===value)&&JSON.stringify(before)===JSON.stringify(after),'字体更新改变了其他演示内容');
 }
}
function finish(state,plan){
 const complete=Object.keys(plan.groups).every(id=>plan.committed[id]);
 plan.status=complete?'succeeded':Object.keys(plan.committed).length?'partial':'prepared';
 if(complete&&plan.kind!=='font-attach')state.tokens[plan.brandId]=plan.next;
}

export class BrandFontUpdates{
 constructor(manager){this.manager=manager;}
 job(view,body){const job=this.manager.linked.job(view,body,['brand']);requireValue(!job.cancelRequested,'字体操作已停止',499);return job;}
 async inspect(view){
  const graph=this.manager.graph(view.root),snapshot=await graph.read(),state=snapshot.manifest.fontState||empty(),bindings=[],sources=new Map(),baselines=new Map(),markers=new Map();
  const sourceFor=id=>{if(!sources.has(id))sources.set(id,graph.sources.read(id));return sources.get(id);};
  const baselineFor=(id,revision)=>{const key=id+'\0'+revision;if(!baselines.has(key))baselines.set(key,graph.sources.source(id,revision));return baselines.get(key);};
  for(const row of Object.values(state.bindings)){
   if(!row.enabled){bindings.push({...row,status:'disabled'});continue;}
   try{const source=await sourceFor(row.sourceId),actual=target(source.bytes,row.engine,row.nativeId);
    let status;
    if(row.objectToken){
     const key=row.engine+'\0'+row.sourceId;if(!markers.has(key))markers.set(key,fontOrigins(source.bytes,row.engine));
     const marker=markers.get(key).get(String(row.nativeId));
     status=marker?.instanceId!==row.objectToken||marker?.bindingId!==row.id||marker?.projectId!==snapshot.manifest.id?'identity_changed':actual.font!==row.confirmedFont||actual.font!==state.tokens[row.brandId]?'font_changed':'recorded';
    }else{
     // Older bindings lack a native identity: only byte-identical source is safe.
     const baseline=source.revision===row.sourceRevision?source:await baselineFor(row.sourceId,row.sourceRevision);
     status=source.meta.sourceHash!==baseline.meta.sourceHash?'source_changed':actual.font!==row.confirmedFont||actual.font!==state.tokens[row.brandId]?'font_changed':'recorded';
    }
    bindings.push({...row,status,currentFont:actual.font,currentSourceRevision:source.revision});
   }catch{bindings.push({...row,status:'unavailable'});}
  }
  let selection=null,selectionError=null;const ids=view.document?selectedObjectIds(view.document):[];
  if(ids.length===1&&view.sourceRevision&&['vectorcraft','deckcraft'].includes(view.engine))try{
   const source=await sourceFor(view.sourceId),value=target(source.bytes,view.engine,ids[0]);
   if(source.revision===view.sourceRevision&&(value.pageId===undefined||value.pageId===view.document.page?.nativePage?.id))selection={...value,sourceId:view.sourceId,sourceRevision:source.revision};
  }catch(error){selectionError=String(error.message||error).slice(0,400);}
  return {tokens:state.tokens,bindings,selection,selectionError,updates:Object.values(state.updates).map(plan=>({id:plan.id,brandId:plan.brandId,status:plan.status,done:Object.keys(plan.committed).length,total:Object.keys(plan.groups).length}))};
 }
 async start(view,body){
  const job=this.job(view,body),graph=this.manager.graph(view.root),payload=job.payload,current=await graph.read(),state=current.manifest.fontState||empty();
  requireValue(payload.command==='font-resume'||payload.revision===current.revision,'项目已改变，请重新查看品牌字体');
  if(payload.command==='font-resume'){
   const plan=state.updates[payload.updateId];requireValue(plan,'字体更新记录不存在',404);return this.schedule(view,job,plan);
  }
  const brandId=payload.brandId;requireValue(brand.test(brandId||'')&&current.manifest.brandState?.brands?.[brandId],'品牌不存在',404);
  requireValue(payload.command==='font-cancel'||!Object.values(state.updates).some(plan=>plan.brandId===brandId&&['prepared','partial'].includes(plan.status)),'此品牌还有未完成的字体更新');
  if(payload.command==='font-create'){
   requireValue(!state.tokens[brandId]&&validFont(payload.font),'字体名称无效或品牌已有字体令牌',422);
   const saved=await graph.change(current.revision,value=>{(value.fontState||=empty()).tokens[brandId]=payload.font.trim();});
   job.projectMutation={revision:saved.revision,brandId,font:payload.font.trim()};return {result:job.projectMutation};
  }
  requireValue(validFont(state.tokens[brandId]),'请先设置品牌字体');
  if(payload.command==='font-attach'){
   requireValue(['vectorcraft','deckcraft'].includes(view.engine),'当前编辑器不支持品牌文字身份',422);
   const ids=selectedObjectIds(view.document);requireValue(ids.length===1&&sameUint64(ids[0],payload.nativeId)&&view.sourceRevision===payload.sourceRevision,'文字选区或版本已改变');
   const source=await graph.sources.read(view.sourceId),actual=target(source.bytes,view.engine,ids[0]);
   requireValue(source.revision===view.sourceRevision&&actual.font===state.tokens[brandId]&&(actual.pageId===undefined||actual.pageId===view.document.page?.nativePage?.id),'所选文字的字体或页面不一致');
   const existing=Object.values(state.bindings).find(row=>row.sourceId===view.sourceId&&row.nativeId===String(ids[0]));
   requireValue(!existing||existing.brandId===brandId,'该文字已绑定其他品牌');const id=existing?.id||'brandfont-'+job.id,origins=fontOrigins(source.bytes,view.engine),marker=origins.get(String(ids[0]));
   if(existing?.objectToken&&marker?.instanceId===existing.objectToken&&marker?.bindingId===id&&marker?.projectId===current.manifest.id){
    const saved=await graph.change(current.revision,value=>{Object.assign(value.fontState.bindings[id],{sourceRevision:source.revision,confirmedFont:actual.font,enabled:true});});
    job.projectMutation={revision:saved.revision,bindingId:id};return {result:job.projectMutation};
   }
   requireValue(!marker,'文字已有字体身份，请核对原绑定');
   requireValue(![...origins.values()].some(value=>value.bindingId===id),'该字体身份仍附着在其他文字，请先核对来源');
   const plan={id:job.id,kind:'font-attach',brandId,previous:actual.font,next:actual.font,groups:{[view.sourceId]:{engine:view.engine,baseRevision:source.revision,rows:[{bindingId:id,nativeId:String(ids[0]),previous:actual.font,token:view.engine==='vectorcraft'?randomBytes(16).toString('hex'):null}]}},committed:{},overrides:[],status:'prepared',at:new Date().toISOString()};
   const saved=await graph.change(current.revision,value=>{(value.fontState||=empty()).updates[plan.id]=plan;});
   return this.schedule(view,job,saved.manifest.fontState.updates[plan.id]);
  }
  if(payload.command==='font-disable'){
   requireValue(state.bindings[payload.bindingId]?.brandId===brandId,'字体绑定不存在',404);
   const saved=await graph.change(current.revision,value=>{value.fontState.bindings[payload.bindingId].enabled=false;});job.projectMutation={revision:saved.revision,bindingId:payload.bindingId};return {result:job.projectMutation};
  }
  if(payload.command==='font-cancel'){
   let plan=state.updates[payload.updateId];requireValue(plan?.brandId===brandId&&['prepared','partial'].includes(plan.status),'没有可取消的字体更新');
   const keys=Object.keys(plan.groups).filter(id=>!plan.committed[id]).map(id=>this.manager.leaseKey(view,id));
   requireValue(keys.every(key=>!this.manager.claims.has(key)),'字体更新仍在执行，请先停止并等待当前动作结束',423);
   for(const key of keys){this.manager.claims.set(key,'linked:'+job.id);(job.linkedClaimKeys||=[]).push(key);}
   try{
    for(const sourceId of Object.keys(plan.groups)){
     if(plan.committed[sourceId])continue;
     this.job(view,body);
     const receipts=(await graph.sources.versions(sourceId)).filter(item=>item.operation?.action==='brand-font'&&item.operation.id===plan.id);
     requireValue(receipts.length<=1,'同一字体动作出现多个源回执');if(receipts.length)plan=await this.complete(graph,plan,sourceId,receipts[0].revision);
    }
    if(plan.status==='succeeded'){job.projectMutation={status:'succeeded',kind:plan.kind||'font-change',committed:plan.committed,overrides:plan.overrides,font:plan.next};return {result:job.projectMutation};}
    this.job(view,body);const fresh=await graph.read();this.job(view,body);
    const saved=await graph.change(fresh.revision,value=>{value.fontState.updates[plan.id].status='cancelled';});
    job.projectMutation={revision:saved.revision,status:'cancelled',committed:plan.committed,note:'已保存的部分保留，未处理的作品没有继续更新。'};return {result:job.projectMutation};
   }finally{this.manager.linked.release(job);}
  }
  requireValue(payload.command==='font-change'&&validFont(payload.font)&&payload.font.trim()!==state.tokens[brandId],'请输入不同的品牌字体',422);
  const inspected=await this.inspect(view),active=inspected.bindings.filter(row=>row.brandId===brandId&&row.enabled),conflicts=active.filter(row=>row.status!=='recorded');
  requireValue(active.length<=100&&same(payload.bindingIds,active.map(row=>row.id))&&same(payload.overrideIds,conflicts.map(row=>row.id)),'字体绑定或需保留的人工修改已变化，请重新查看');
  const plan={id:job.id,kind:'font-change',brandId,previous:state.tokens[brandId],next:payload.font.trim(),groups:{},committed:{},overrides:conflicts.map(row=>row.id),status:'prepared',at:new Date().toISOString()};
  for(const row of active.filter(row=>row.status==='recorded')){const group=plan.groups[row.sourceId]||={engine:row.engine,baseRevision:row.currentSourceRevision,rows:[]};requireValue(group.baseRevision===row.currentSourceRevision,'同一作品字体基线不一致');group.rows.push({bindingId:row.id,nativeId:row.nativeId,previous:row.confirmedFont,token:row.objectToken||null});}
  const saved=await graph.change(current.revision,value=>{const state=value.fontState||=empty();state.updates[plan.id]=plan;finish(state,plan);});
  return this.schedule(view,job,saved.manifest.fontState.updates[plan.id]);
 }
 async complete(graph,plan,sourceId,revision){
  const current=await graph.read(),live=current.manifest.fontState.updates[plan.id],group=live.groups[sourceId];
  if(live.committed[sourceId]){requireValue(live.committed[sourceId]===revision,'字体更新回执存在冲突');return live;}
  requireValue(['prepared','partial'].includes(live.status),'字体更新已结束，未继续登记回执');
  const saved=await graph.sources.read(sourceId,revision),op=saved.meta.operation,before=await graph.sources.read(sourceId,group.baseRevision);
  requireValue(op?.action==='brand-font'&&op.id===plan.id&&op.brandId===plan.brandId&&(op.kind||'font-change')===(live.kind||'font-change')&&saved.meta.parentRevision===group.baseRevision&&op.baseRevision===group.baseRevision&&same(op.bindingIds,group.rows.map(row=>row.bindingId)),'字体源缺少匹配的保存回执');
  const markers=this.verify(current.manifest.id,live,group,before.bytes,saved.bytes);
  const next=await graph.change(current.revision,value=>{const state=value.fontState,update=state.updates[plan.id];for(const row of group.rows){
   if(update.kind==='font-attach')state.bindings[row.bindingId]={id:row.bindingId,brandId:update.brandId,sourceId,nativeId:row.nativeId,engine:group.engine,objectToken:markers.get(String(row.nativeId)).instanceId,enabled:true};
   Object.assign(state.bindings[row.bindingId],{sourceRevision:revision,confirmedFont:update.next});
  }update.committed[sourceId]=revision;finish(state,update);});
  return next.manifest.fontState.updates[plan.id];
 }
 verify(projectId,plan,group,before,after){
  const markers=fontOrigins(after,group.engine),previous=fontOrigins(before,group.engine);
  if(plan.kind==='font-attach'){
   const row=group.rows[0],marker=markers.get(String(row.nativeId));
   requireValue(group.rows.length===1&&marker&&(!row.token||marker.instanceId===row.token)&&target(before,group.engine,row.nativeId).font===row.previous&&target(after,group.engine,row.nativeId).font===row.previous,'文字身份或字体已改变，未提交绑定');
   assertFontAssignmentOnly(before,after,group.engine,row.nativeId,{projectId,bindingId:row.bindingId,instanceId:marker.instanceId});
  }else{
   for(const row of group.rows)if(row.token){
    const old=previous.get(String(row.nativeId)),next=markers.get(String(row.nativeId));
    requireValue(old?.instanceId===row.token&&old?.bindingId===row.bindingId&&old?.projectId===projectId&&next?.instanceId===row.token&&next?.bindingId===row.bindingId&&next?.projectId===projectId,'文字身份已改变，未覆盖');
   }
   assertFontOnly(before,after,group.engine,group.rows,plan.next);
  }
  return markers;
 }
 async schedule(view,job,plan){
  const m=this.manager,graph=m.graph(view.root);job.fontTransactionId=plan.id;
  requireValue(['prepared','partial','succeeded'].includes(plan.status),'字体更新已取消');
  for(const id of Object.keys(plan.groups)){if(plan.committed[id])continue;const receipts=(await graph.sources.versions(id)).filter(item=>item.operation?.action==='brand-font'&&item.operation.id===plan.id);requireValue(receipts.length<=1,'同一字体动作出现多个源回执');if(receipts.length)plan=await this.complete(graph,plan,id,receipts[0].revision);}
  if(plan.status==='succeeded'){job.projectMutation={kind:plan.kind||'font-change',status:plan.status,committed:plan.committed,overrides:plan.overrides,font:plan.next};return {result:job.projectMutation};}
  requireValue(['prepared','partial'].includes(plan.status),'字体更新已取消');const targets=[];let state=await graph.read();
  for(const id of Object.keys(plan.groups).filter(id=>!plan.committed[id]).sort((a,b)=>Number(a===view.sourceId)-Number(b===view.sourceId))){
   this.job(view,{epoch:view.epoch,jobId:job.id});const group=plan.groups[id],actual=await graph.sources.read(id),key=m.leaseKey(view,id);
   requireValue(actual.meta.engine===group.engine,'字体源类型已改变');
   const markers=fontOrigins(actual.bytes,group.engine);
   if(plan.kind==='font-attach')requireValue(actual.revision===group.baseRevision,'绑定前设计已改变，请重新选择文字');
   else if(actual.revision!==group.baseRevision&&group.rows.some(row=>!row.token)){
    const baseline=await graph.sources.source(id,group.baseRevision);requireValue(actual.meta.sourceHash===baseline.meta.sourceHash,'旧字体绑定缺少原生身份，请重新绑定后继续');
   }
   const owner=m.views.get(m.leases.get(key));requireValue(!m.claims.has(key)&&(!owner||owner.id===view.id||!owner.saving&&!owner.switching&&Date.now()-owner.lastSeen>=30000),'设计正在另一操作中',423);
   if(owner?.id===view.id)requireValue(view.sourceRevision===actual.revision&&sameUint64(view.savedEngineRevision,view.document?.revision),'请先保存当前设计');
   const rows=group.rows.map(row=>({...row,...target(actual.bytes,group.engine,row.nativeId)}));
   for(const row of rows){
    requireValue(row.font===row.previous,'文字字体已改变，未覆盖');const marker=markers.get(String(row.nativeId));
    if(plan.kind==='font-attach')requireValue(!marker,'文字已有字体身份，请核对原绑定');
    else if(row.token)requireValue(marker?.instanceId===row.token&&marker?.bindingId===row.bindingId&&marker?.projectId===state.manifest.id,'文字身份已改变，未覆盖');
   }
   m.claims.set(key,'linked:'+job.id);(job.linkedClaimKeys||=[]).push(key);
   if(actual.revision!==group.baseRevision){state=await graph.change(state.revision,value=>{value.fontState.updates[plan.id].groups[id].baseRevision=actual.revision;});plan=state.manifest.fontState.updates[plan.id];}
   targets.push({sourceId:id,engine:group.engine,title:actual.meta.title,sourceHash:actual.meta.sourceHash,baseRevision:actual.revision,rows});
  }
  return {transactionId:plan.id,kind:plan.kind||'font-change',projectId:state.manifest.id,font:plan.next,targets};
 }
 async source(view,body){
  const job=this.job(view,body),graph=this.manager.graph(view.root),snapshot=await graph.read(),state=snapshot.manifest.fontState,plan=state?.updates[job.fontTransactionId],group=plan?.groups[body.sourceId];
  requireValue(group&&['prepared','partial'].includes(plan.status)&&!plan.committed[body.sourceId]&&this.manager.claims.get(this.manager.leaseKey(view,body.sourceId))==='linked:'+job.id,'该字体源尚未获得许可或更新已结束');
  const source=await graph.sources.source(body.sourceId);requireValue(source.revision===group.baseRevision,'字体源已改变，未覆盖');return {job,graph,source,group,plan,projectId:snapshot.manifest.id};
 }
 async commit(view,body,input){
  const job=this.job(view,body);requireValue(!job.linkedSaving,'字体源正在保存',423);job.linkedSaving=true;
  try{
   validateNativeIdentity(body.engineState);const chunks=[];let size=0;for await(const chunk of input){size+=chunk.length;requireValue(size<=256*1024*1024,'字体源超过预算',413);chunks.push(chunk);}
   const {graph,source,group,plan,projectId}=await this.source(view,body),bytes=Buffer.concat(chunks),before=await graph.sources.read(body.sourceId,source.revision);
   this.verify(projectId,plan,group,before.bytes,bytes);this.job(view,body);
   const saved=await graph.sources.commit(body.sourceId,{engine:group.engine,title:source.meta.title,bytes,baseRevision:source.revision,engineState:body.engineState,actor:job.initiator,operation:{action:'brand-font',kind:plan.kind||'font-change',id:plan.id,brandId:plan.brandId,baseRevision:source.revision,bindingIds:group.rows.map(row=>row.bindingId)}});
   const done=await this.complete(graph,plan,body.sourceId,saved.revision),result={kind:done.kind||'font-change',status:done.status,committed:done.committed,overrides:done.overrides,font:done.next};
   if(done.status==='succeeded')job.projectMutation=result;this.manager.onChange(view.root,{kind:'native-source',id:body.sourceId,revision:saved.revision});return {revision:saved.revision,result};
  }finally{job.linkedSaving=false;if(job.status!=='running')this.manager.linked.release(job);}
 }
}
