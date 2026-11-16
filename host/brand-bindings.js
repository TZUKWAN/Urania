/** Explicit brand-color records. This module does not apply colors to designs. */
import {randomUUID,createHash} from 'node:crypto';
import {SafetyError} from './safety.js';
import {nativeVectorHeader} from './native-vector-header.js';
import {nativeDeckDocument,nativeDeckNodes} from './native-deck-header.js';
import {isUint64} from '../client/native-protocol.js';
import {readZip} from './zip.js';
import {systemFor} from './design-resources.js';

const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value);
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const color=value=>typeof value==='string'&&/^#[0-9A-F]{6}$/.test(value);
const brandId=value=>typeof value==='string'&&/^brand-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const bindingId=value=>typeof value==='string'&&/^brandcolor-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const record=value=>value&&typeof value==='object'&&!Array.isArray(value);

export function validateThemeBrandSource(value){
 if(!record(value)||Object.keys(value).some(key=>!['schema','kind','bundleId','fileId','file','gitSha1','sha256','selectedHex'].includes(key))||value.schema!==1||value.kind!=='external-theme'||!/^externalbundle-[a-f0-9]{64}$/.test(value.bundleId||'')||!/^externalfile-[a-f0-9]{64}$/.test(value.fileId||'')||!/^skills\/theme-factory\/themes\/[a-z0-9][a-z0-9-]{0,79}\.md$/.test(value.file||'')||!/^[a-f0-9]{40}$/.test(value.gitSha1||'')||!revision(value.sha256)||!color(value.selectedHex))throw new SafetyError('品牌主题来源记录无效',422);
 return true;
}

export function validateBrandState(state){
 if(state===undefined)return;
 if(!record(state)||state.schema!==1||!record(state.brands)||!record(state.bindings)||Object.keys(state.brands).length>100||Object.keys(state.bindings).length>5000)throw new SafetyError('品牌颜色关系结构无效或超过预算',422);
 for(const [id,brand]of Object.entries(state.brands)){
  if(!brandId(id)||!record(brand)||brand.id!==id||typeof brand.name!=='string'||!brand.name.trim()||brand.name.length>120||!color(brand.primary))throw new SafetyError('品牌主色记录无效',422);
  if(brand.themeSource!==undefined){validateThemeBrandSource(brand.themeSource);if(brand.resource)throw new SafetyError('品牌不能同时声明主题来源和设计系统来源',422);}
 }
 const targets=new Set();
 for(const [id,binding]of Object.entries(state.bindings)){
  if(!bindingId(id)||!record(binding)||binding.id!==id||!state.brands[binding.brandId]||!identity(binding.sourceId)||!revision(binding.sourceRevision)||!isUint64(binding.nativeId)||!['vectorcraft','deckcraft'].includes(binding.engine)||binding.property!=='fill'||binding.token!=='primary'||!color(binding.confirmedValue))throw new SafetyError('品牌颜色绑定记录无效',422);
  if(binding.objectToken!==undefined&&!/^[a-f0-9]{32}$/.test(binding.objectToken)||binding.enabled!==undefined&&typeof binding.enabled!=='boolean')throw new SafetyError('品牌对象身份或启用状态无效',422);
  const key=JSON.stringify([binding.sourceId,String(binding.nativeId),binding.property]);
  if(targets.has(key))throw new SafetyError('同一原生属性不能重复绑定品牌',409);targets.add(key);
 }
}

function vectorNodeInDocument(doc,target){
 if(!Array.isArray(doc?.layers))throw new SafetyError('海报源结构不支持品牌颜色绑定',422);
 let found=null,count=0;
 function walk(items,depth=0,blocked=false){
  if(!Array.isArray(items)||depth>64)throw new SafetyError('海报对象层级无效',422);
  for(const node of items){
   if(++count>100000||!isUint64(node.id))throw new SafetyError('海报对象身份无效或超过预算',422);
   const unavailable=blocked||node.hidden||node.locked||node.visible===false;
   if(String(node.id)===String(target)){if(found)throw new SafetyError('海报对象身份重复',422);if(unavailable)throw new SafetyError('品牌绑定对象或其上级隐藏或锁定',409);found=node;}
   if(node.kind?.children)walk(node.kind.children,depth+1,unavailable);
  }
 }
 walk(doc.layers);return found;
}
function vectorNode(bytes,target){return vectorNodeInDocument(nativeVectorHeader(bytes).document,target);}
function deckNode(bytes,target){
 const nodes=nativeDeckNodes(bytes),node=nodes.get(String(target));
 if(!node||node.layoutPage?.kind!=='slide')return null;
 const doc=nativeDeckDocument(bytes),slide=doc.slides.find(item=>item.id===node.layoutPage.id);let blocked=false;
 function walk(items,unavailable=false){
  for(const item of items){
   const next=unavailable||item.hidden||item.locked||item.visible===false;
   if(String(item.id)===String(target)){blocked=!!next;return;}
   if(item.kind?.type==='group')walk(item.kind.children,next);
  }
 }
 walk(slide?.shapes||[]);if(blocked)throw new SafetyError('品牌绑定对象或其上级隐藏或锁定',409);return node;
}
function octet(value){return Number.isInteger(value)&&value>=0&&value<=255;}
function hex(rgb){return '#'+rgb.map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase();}
/** Read only a single, unambiguous solid fill; gradients/effects are refused. */
export function actualSolidFill(bytes,engine,nativeId){
 if(!isUint64(nativeId))throw new SafetyError('品牌绑定需要精确的原生对象 ID',422);
 const node=engine==='vectorcraft'?vectorNode(bytes,nativeId):engine==='deckcraft'?deckNode(bytes,nativeId):null;
 if(!node||node.hidden||node.locked||node.visible===false)throw new SafetyError('品牌绑定对象不存在、隐藏或锁定',409);
 if(engine==='vectorcraft'){
  if(node.kind?.type!=='path')throw new SafetyError('当前仅支持单个海报路径的品牌纯色填充',422);
  const items=node.appearance?.items;
  if(!Array.isArray(items)||items.filter(item=>item.kind==='fill').length!==1)throw new SafetyError('仅支持一个明确的纯色填充',422);
  const fill=items.find(item=>item.kind==='fill'),paint=fill.paint,c=paint?.color;
  if(paint?.type!=='solid'||c?.model!=='rgb'||Object.keys(c).some(key=>!['model','r','g','b'].includes(key))||[c.r,c.g,c.b].some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1))throw new SafetyError('该海报填色不是支持的不透明 RGB 纯色',422);
  return hex([c.r,c.g,c.b].map(v=>Math.round(v*255)));
 }
 const fill=node.fill,c=fill?.color,rgb=c?.base?.rgb;
 if(node.layoutPage?.kind!=='slide'||node.kind?.type!=='shape'||fill?.kind!=='solid'||!c||Object.keys(c).some(key=>key!=='base')||c.base?.kind!=='rgb'||!rgb||!octet(rgb.r)||!octet(rgb.g)||!octet(rgb.b)||rgb.a!==255)throw new SafetyError('该幻灯片对象不是支持的不透明 RGB 纯色填充',422);
 return hex([rgb.r,rgb.g,rgb.b]);
}

const BRAND_TAG='DSH-BRAND-COLOR-V1';
function brandMarker(data){
 if(data!==undefined&&!Array.isArray(data))throw new SafetyError('原生品牌标记容器无效',409);
 const rows=(data||[]).filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&row[0].toUpperCase()===BRAND_TAG);
 if(!rows.length)return null;
 if(rows.length!==1||typeof rows[0][1]!=='string'||rows[0][1].length>1024)throw new SafetyError('原生品牌标记重复或无效',409);
 let marker;try{marker=JSON.parse(rows[0][1]);}catch{throw new SafetyError('原生品牌标记损坏',409);}
 if(!record(marker)||JSON.stringify(Object.keys(marker).sort())!==JSON.stringify(['bindingId','instanceId','projectId','schema'])||marker.schema!==1||!identity(marker.projectId)||!marker.projectId.startsWith('project-')||!bindingId(marker.bindingId)||typeof marker.instanceId!=='string'||!/^[a-f0-9]{32}$/.test(marker.instanceId))throw new SafetyError('原生品牌标记身份无效',409);
 return marker;
}
function deckBrandMarker(node){return brandMarker(node.tags);}
/** Reject ambiguous markers anywhere in the same native presentation. */
export function deckBrandOrigins(bytes){
 const origins=new Map(),tokens=new Set(),bindings=new Set();
 for(const [id,node]of nativeDeckNodes(bytes)){
  const marker=deckBrandMarker(node);if(!marker)continue;
  if(tokens.has(marker.instanceId)||bindings.has(marker.bindingId))throw new SafetyError('原生品牌标记发生重复，不能自动绑定',409);
  tokens.add(marker.instanceId);bindings.add(marker.bindingId);origins.set(id,marker);
 }
 return origins;
}

/** Check an actual native marker assignment without accepting any other edit. */
export function assertDeckBrandAssignmentOnly(beforeBytes,afterBytes,nativeId,expected){
 if(!isUint64(nativeId)||!record(expected)||!identity(expected.projectId)||!bindingId(expected.bindingId)||!/^[a-f0-9]{32}$/.test(expected.instanceId||''))throw new SafetyError('品牌标记核对身份无效',422);
 const oldNodes=nativeDeckNodes(beforeBytes),newNodes=nativeDeckNodes(afterBytes),oldNode=oldNodes.get(String(nativeId)),newNode=newNodes.get(String(nativeId));
 if(!oldNode||!newNode||deckBrandMarker(oldNode)||actualSolidFill(beforeBytes,'deckcraft',nativeId)!==actualSolidFill(afterBytes,'deckcraft',nativeId))throw new SafetyError('品牌目标或原生颜色不一致',409);
 const origins=deckBrandOrigins(afterBytes),marker=origins.get(String(nativeId));
 if(!marker||marker.projectId!==expected.projectId||marker.bindingId!==expected.bindingId||marker.instanceId!==expected.instanceId)throw new SafetyError('原生品牌标记与授权目标不一致',409);
 const options={maxEntries:20000,maxEntryBytes:256*1024*1024,maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024};
 const prior=readZip(beforeBytes,options),saved=readZip(afterBytes,options),json=rows=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rows.find(row=>row.name==='presentation.json').data));
 const before=json(prior),after=json(saved);
 const find=(doc,id)=>{let found=null;const walk=items=>{for(const item of items){if(String(item.id)===String(id))found=item;if(item.kind?.type==='group')walk(item.kind.children);}};for(const slide of doc.presentation.slides)walk(slide.shapes);return found;};
 const previous=find(before,nativeId),current=find(after,nativeId);
 const without=(current.tags||[]).filter(row=>!Array.isArray(row)||typeof row[0]!=='string'||row[0].toUpperCase()!==BRAND_TAG);
 if(JSON.stringify(without)!==JSON.stringify(previous.tags||[]))throw new SafetyError('品牌标记改变了其他原生标签',409);
 if(Object.hasOwn(previous,'tags'))current.tags=previous.tags;else delete current.tags;
 const hashes=rows=>new Map(rows.filter(row=>row.name!=='presentation.json').map(row=>[row.name,createHash('sha256').update(row.data).digest('hex')])),a=hashes(prior),b=hashes(saved);
 if(a.size!==b.size||[...a].some(([name,hash])=>b.get(name)!==hash)||JSON.stringify(before)!==JSON.stringify(after))throw new SafetyError('品牌标记改变了其他演示对象或资源',409);
 return marker;
}

export function vectorBrandOrigins(bytes){
 const doc=nativeVectorHeader(bytes).document,origins=new Map(),tokens=new Set(),bindings=new Set(),ids=new Set();let count=0;
 const walk=(items,depth=0)=>{
  if(!Array.isArray(items)||depth>64)throw new SafetyError('海报对象层级无效',422);
  for(const node of items){
   if(++count>100000||!isUint64(node.id)||ids.has(String(node.id)))throw new SafetyError('海报对象身份无效或重复',422);ids.add(String(node.id));
   const marker=brandMarker(node.attrs?.data);
   if(marker){if(tokens.has(marker.instanceId)||bindings.has(marker.bindingId))throw new SafetyError('原生品牌标记发生重复，不能自动绑定',409);tokens.add(marker.instanceId);bindings.add(marker.bindingId);origins.set(String(node.id),marker);}
   if(node.kind?.children)walk(node.kind.children,depth+1);
  }
 };walk(doc.layers);return origins;
}
export function assertVectorBrandAssignmentOnly(beforeBytes,afterBytes,nativeId,expected){
 if(!isUint64(nativeId)||!record(expected)||!identity(expected.projectId)||!bindingId(expected.bindingId)||!/^[a-f0-9]{32}$/.test(expected.instanceId||''))throw new SafetyError('品牌标记核对身份无效',422);
 const before=nativeVectorHeader(beforeBytes),after=nativeVectorHeader(afterBytes),previous=vectorNodeInDocument(before.document,nativeId),current=vectorNodeInDocument(after.document,nativeId);
 if(!previous||!current||brandMarker(previous.attrs?.data)||actualSolidFill(beforeBytes,'vectorcraft',nativeId)!==actualSolidFill(afterBytes,'vectorcraft',nativeId))throw new SafetyError('品牌目标或原生颜色不一致',409);
 const marker=vectorBrandOrigins(afterBytes).get(String(nativeId));
 if(!marker||marker.projectId!==expected.projectId||marker.bindingId!==expected.bindingId||marker.instanceId!==expected.instanceId)throw new SafetyError('原生品牌标记与授权目标不一致',409);
 const without=(current.attrs?.data||[]).filter(row=>!Array.isArray(row)||typeof row[0]!=='string'||row[0].toUpperCase()!==BRAND_TAG);
 if(JSON.stringify(without)!==JSON.stringify(previous.attrs?.data||[]))throw new SafetyError('品牌标记改变了其他原生标签',409);
 if(previous.attrs&&Object.hasOwn(previous.attrs,'data'))current.attrs.data=previous.attrs.data;else if(current.attrs)delete current.attrs.data;
 if(!previous.attrs&&current.attrs&&Object.keys(current.attrs).length===0)delete current.attrs;
 const magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]),a=beforeBytes.indexOf(magic),b=afterBytes.indexOf(magic);
 if((a<0)!==(b<0)||a>=0&&!beforeBytes.subarray(a).equals(afterBytes.subarray(b))||JSON.stringify(before)!==JSON.stringify(after))throw new SafetyError('品牌标记改变了其他海报对象或资源',409);
 return marker;
}

/** Verify a prepared real native update changes only the selected solid fill. */
export function assertBrandFillOnly(beforeBytes,afterBytes,engine,targets,previous,next){
 if(!color(previous)||!color(next)||previous===next||!Array.isArray(targets)||!targets.length||targets.length>100||targets.some(id=>!isUint64(id))||new Set(targets.map(String)).size!==targets.length)throw new SafetyError('品牌填色核对范围无效',422);
 for(const id of targets)if(actualSolidFill(beforeBytes,engine,id)!==previous||actualSolidFill(afterBytes,engine,id)!==next)throw new SafetyError('品牌填色与授权的新旧颜色不一致',409);
 if(engine==='vectorcraft'){
  const before=nativeVectorHeader(beforeBytes),after=nativeVectorHeader(afterBytes);
  for(const id of targets){
   const old=vectorNodeInDocument(before.document,id),current=vectorNodeInDocument(after.document,id);
   current.appearance.items.find(item=>item.kind==='fill').paint.color=old.appearance.items.find(item=>item.kind==='fill').paint.color;
  }
  const magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]),a=beforeBytes.indexOf(magic),b=afterBytes.indexOf(magic);
  if((a<0)!==(b<0)||a>=0&&!beforeBytes.subarray(a).equals(afterBytes.subarray(b))||JSON.stringify(before)!==JSON.stringify(after))throw new SafetyError('品牌填色改变了其他海报对象或资源',409);
  return;
 }
 if(engine==='deckcraft'){
  const entries=bytes=>readZip(bytes,{maxEntries:20000,maxEntryBytes:256*1024*1024,maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024});
  const priorEntries=entries(beforeBytes),savedEntries=entries(afterBytes);
  const manifest=rows=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rows.find(entry=>entry.name==='presentation.json').data));
  const before=manifest(priorEntries),after=manifest(savedEntries);
  const find=(doc,id)=>{
   let found=null;const walk=items=>{for(const item of items){if(String(item.id)===String(id))found=item;if(item.kind?.type==='group')walk(item.kind.children);}};
   for(const slide of doc.slides)walk(slide.shapes);return found;
  };
  for(const id of targets)find(after.presentation,id).fill.color=find(before.presentation,id).fill.color;
  const hashes=rows=>new Map(rows.filter(entry=>entry.name!=='presentation.json').map(entry=>[entry.name,createHash('sha256').update(entry.data).digest('hex')]));
  const old=hashes(priorEntries),saved=hashes(savedEntries);
  if(old.size!==saved.size||[...old].some(([name,hash])=>saved.get(name)!==hash)||JSON.stringify(before)!==JSON.stringify(after))throw new SafetyError('品牌填色改变了其他演示对象或资源',409);
  return;
 }
 throw new SafetyError('该原生引擎尚未接入品牌填色核对',422);
}

export class BrandBindings{
 constructor(graph){this.graph=graph;this.sources=graph.sources;}
 async inspect(){
  const current=await this.graph.read(),state=current.manifest.brandState||{schema:1,brands:{},bindings:{}},sourceCache=new Map(),markerCache=new Map(),bindings=[],updatingBrands=new Set(Object.values(state.updates||{}).filter(plan=>['prepared','partial'].includes(plan.status)).map(plan=>plan.brandId));
  for(const binding of Object.values(state.bindings)){
   if(binding.enabled===false){bindings.push({...binding,status:'disabled'});continue;}
   if(!sourceCache.has(binding.sourceId))sourceCache.set(binding.sourceId,this.sources.read(binding.sourceId));
   let source;try{source=await sourceCache.get(binding.sourceId);}catch{bindings.push({...binding,status:'source_unavailable'});continue;}
   if(source.meta.engine!==binding.engine){bindings.push({...binding,status:'engine_changed',currentSourceRevision:source.revision});continue;}
   if(binding.objectToken){
    if(!markerCache.has(binding.sourceId)){
     try{markerCache.set(binding.sourceId,source.meta.engine==='deckcraft'?deckBrandOrigins(source.bytes):vectorBrandOrigins(source.bytes));}
     catch{markerCache.set(binding.sourceId,new Map());}
    }
    const marker=markerCache.get(binding.sourceId).get(binding.nativeId);
    if(!marker||marker.projectId!==current.manifest.id||marker.bindingId!==binding.id||marker.instanceId!==binding.objectToken){
     bindings.push({...binding,status:'identity_changed',currentSourceRevision:source.revision});continue;
    }
   }
   let actual;try{actual=actualSolidFill(source.bytes,binding.engine,binding.nativeId);}catch{bindings.push({...binding,status:'object_unavailable',currentSourceRevision:source.revision});continue;}
   const sourceAdvanced=source.revision!==binding.sourceRevision;
   const status=actual!==binding.confirmedValue?'color_changed':sourceAdvanced&&!binding.objectToken?'source_changed':!updatingBrands.has(binding.brandId)&&binding.confirmedValue!==state.brands[binding.brandId].primary?'color_changed':'recorded';
   bindings.push({...binding,status,currentValue:actual,currentSourceRevision:source.revision,sourceAdvanced});
  }
  return {revision:current.revision,brands:Object.values(state.brands),bindings,
   updates:Object.values(state.updates||{}).map(({id,brandId,kind,status,committed,groups})=>({id,brandId,kind,status,done:Object.keys(committed).length,total:Object.keys(groups).length}))};
 }
 /** Read-only preview, not an authorization to change a native source. */
 async prepare({baseRevision,brandId:requested,primary,bindingIds}){
  if(!brandId(requested)||!color(primary)||!Array.isArray(bindingIds)||bindingIds.length>5000||bindingIds.some(id=>!bindingId(id))||new Set(bindingIds).size!==bindingIds.length)throw new SafetyError('品牌更新预览请求无效',422);
  const snapshot=await this.inspect(),brand=snapshot.brands.find(item=>item.id===requested);
  if(snapshot.revision!==baseRevision||!brand)throw new SafetyError('品牌或项目版本已改变，请重新读取',409);
  const selected=snapshot.bindings.filter(item=>item.brandId===requested&&item.enabled!==false),same=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort());
  if(!same(bindingIds,selected.map(item=>item.id)))throw new SafetyError('品牌绑定成员已改变；没有扩大或缩小更新范围',409);
  if(primary===brand.primary)throw new SafetyError('新的品牌主色与当前颜色相同',422);
  if((await this.graph.read()).revision!==snapshot.revision)throw new SafetyError('品牌更新预览期间项目已改变',409);
  const targets=selected.filter(item=>item.status==='recorded'),conflicts=selected.filter(item=>item.status!=='recorded');
  return {brandId:requested,baseRevision,previous:brand.primary,primary,status:conflicts.length?'review_required':'ready_for_revalidation',targets,conflicts,readOnly:true};
 }
 async create({baseRevision,name,primary,resourceId,externalResource,themeSource}){
  if(typeof name!=='string'||!name.trim()||name.length>120||!color(primary))throw new SafetyError('品牌名称或主色无效',422);
  const brand={id:'brand-'+randomUUID(),name:name.trim(),primary};
  if(themeSource!==undefined){validateThemeBrandSource(themeSource);if(resourceId||externalResource||themeSource.selectedHex!==primary)throw new SafetyError('主题来源或所选颜色不一致',422);brand.themeSource={...themeSource};}
  if(externalResource){
   const r=externalResource;
   const tokenFile=r.tokenFile||'design-tokens.json';
   if(!resourceId||r.id!==resourceId||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(r.id)||r.repository!=='nexu-io/open-design'||!/^[a-f0-9]{40}$/.test(r.revision||'')||!['design-tokens.json','tokens.css'].includes(tokenFile)||!/^resource-[a-f0-9]{64}$/.test(r.manifestResourceId||'')||!/^resource-[a-f0-9]{64}$/.test(r.tokenResourceId||'')||r.font!==null&&(typeof r.font!=='string'||!r.font||r.font.length>200))throw new SafetyError('设计系统来源记录无效',422);
   brand.resource={id:r.id,repository:r.repository,revision:r.revision,font:r.font,tokenFile,manifestResourceId:r.manifestResourceId,tokenResourceId:r.tokenResourceId};
  }else if(resourceId){
   const style=systemFor(resourceId);
   if(style.colors.primary?.toUpperCase()!==primary)throw new SafetyError('所选设计系统的初始主色与请求不同',409);
   brand.resource={id:style.upstream.id,revision:style.upstream.revision,font:style.fonts.body};
  }
  const next=await this.graph.change(baseRevision,value=>{value.brandState||={schema:1,brands:{},bindings:{}};value.brandState.brands[brand.id]=brand;});
  return {brand,revision:next.revision};
 }
 async bind({baseRevision,brandId:requested,sourceId,sourceRevision,nativeId}){
  if(!brandId(requested)||!identity(sourceId)||!revision(sourceRevision)||!isUint64(nativeId))throw new SafetyError('品牌绑定请求无效',422);
  const current=await this.graph.read(),brand=current.manifest.brandState?.brands[requested];
  if(current.revision!==baseRevision||!brand)throw new SafetyError('品牌或项目版本已改变，请重新读取',409);
  const source=await this.sources.read(sourceId);
  if(source.revision!==sourceRevision)throw new SafetyError('原生设计版本已改变，请重新选择对象',409);
  const actual=actualSolidFill(source.bytes,source.meta.engine,nativeId);
  if(actual!==brand.primary)throw new SafetyError('对象当前颜色与品牌主色不同；未建立绑定或覆盖人工颜色',409);
  const binding={id:'brandcolor-'+randomUUID(),brandId:requested,sourceId,sourceRevision,nativeId:String(nativeId),engine:source.meta.engine,property:'fill',token:'primary',confirmedValue:actual};
  const next=await this.graph.change(baseRevision,value=>{
   if(value.brandState?.brands[requested]?.primary!==actual)throw new SafetyError('品牌主色已改变，未建立绑定',409);
   value.brandState.bindings[binding.id]=binding;
  });
  return {binding,revision:next.revision};
 }
}
