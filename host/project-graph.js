/** Explicit provenance over immutable native versions. NativeSourceStore alone owns source heads. */
import * as fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {NativeSourceStore} from './native-source-store.js';
import {assertSafeJson,SafetyError,workspacePath} from './safety.js';
import {isUint64,sameUint64} from '../client/native-protocol.js';
import {nativeVectorHeader,nativeVectorImage,nativeVectorEmbedded,assertVectorImageContentOnly,assertVectorEmbeddedContentOnly,assertVectorLegacyContentOnly} from './native-vector-header.js';
import {canonicalLegacyKind,verifyLegacyVectorBinding} from './native-vector-legacy.js';
import {assertDeckSvgConversionOnly,validateConvertedShapes} from './native-deck-conversion.js';
import {nativeDeckNodes,nativeDeckPicture,nativeDeckSvg,assertDeckContentOnly} from './native-deck-header.js';
import {previewImageSize} from './image-header.js';
import {materialOrigin,originInstanceId} from './material-origin.js';
import {validateBrandState} from './brand-bindings.js';
import {validateBrandUpdates} from './brand-updates.js';
import {validateFontState} from './brand-font-updates.js';
import {linkedFrame,validLayoutPolicy} from './material-layout.js';

const MAX_MANIFEST=4*1024*1024,MAX_DERIVATIVE=4*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value);
const idOf=value=>{if(!isUint64(value))throw new SafetyError('素材实例需要精确的原生对象 ID',422);return String(value);};

async function boundedRead(file,max){
 if((await fs.stat(file)).size>max)throw new SafetyError('项目关系或素材超过预算',413);
 return fs.readFile(file);
}
async function publish(file,bytes,{claim=false}={}){
 const temporary=file+'.tmp-'+randomUUID();let handle;
 try{
  handle=await fs.open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await fs.link(temporary,file);return true;}catch(error){
   if(error.code!=='EEXIST')throw error;if(claim)return false;
   const actual=await boundedRead(file,Math.max(bytes.length,1024));
   if(digest(actual)!==digest(bytes))throw new SafetyError('不可变项目文件已损坏，未覆盖',409);
   return false;
  }
 }finally{await handle?.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function manifest(bytes){
 let value;try{value=JSON.parse(bytes);}catch{throw new SafetyError('项目关系记录损坏，历史已保留',422);}
 assertSafeJson(value);
 validateBrandState(value.brandState);
 validateBrandUpdates(value.brandState);
 validateFontState(value.fontState,value.brandState?.brands);
 if(value.schema!==1||!identity(value.id)||!value.assets||typeof value.assets!=='object'||Array.isArray(value.assets)||!value.instances||typeof value.instances!=='object'||Array.isArray(value.instances))throw new SafetyError('项目关系结构无效',422);
 if(Object.keys(value.assets).length>1000||Object.keys(value.instances).length>5000)throw new SafetyError('项目素材或使用处超过预算',413);
 for(const [id,asset] of Object.entries(value.assets)){
  if(!identity(id)||asset.id!==id||!identity(asset.sourceId)||!hash(asset.sourceRevision)||!hash(asset.sourceHash)||!hash(asset.sha256)||!['svg','png'].includes(asset.format)||!Number.isSafeInteger(asset.bytes)||asset.bytes<1||asset.bytes>MAX_DERIVATIVE)throw new SafetyError('素材版本关系无效',422);
  if(asset.preview!==undefined&&(asset.format!=='svg'||asset.preview?.format!=='png'||!hash(asset.preview.sha256)||!Number.isSafeInteger(asset.preview.bytes)||asset.preview.bytes<1||asset.preview.bytes>MAX_DERIVATIVE||!Number.isSafeInteger(asset.preview.width)||!Number.isSafeInteger(asset.preview.height)||asset.preview.width<1||asset.preview.height<1||asset.preview.width*asset.preview.height>24_000_000))throw new SafetyError('SVG 原文与兼容预览关系无效',422);
 }
 for(const [id,instance] of Object.entries(value.instances)){
  if(!identity(id)||instance.id!==id||!value.assets[instance.assetId]||!identity(instance.sourceId)||!hash(instance.boundAtRevision)||!isUint64(instance.nativeId)||!hash(instance.nativeNodeHash))throw new SafetyError('素材使用关系无效',422);
  if(instance.originToken!==undefined&&!/^[a-f0-9]{32}$/.test(instance.originToken))throw new SafetyError('素材原生身份无效',422);
  if(instance.legacyPlacementRevision!==undefined&&!hash(instance.legacyPlacementRevision))throw new SafetyError('旧 SVG 原始放置版本无效',422);
  if(instance.bindingHistory!==undefined&&(!Array.isArray(instance.bindingHistory)||instance.bindingHistory.length>32||instance.bindingHistory.some(item=>!value.assets[item.assetId]||!hash(item.sourceRevision)||!hash(item.nativeNodeHash)||item.originToken!==undefined&&!/^[a-f0-9]{32}$/.test(item.originToken))))throw new SafetyError('素材绑定历史无效',422);
 }
 if(value.edits!==undefined){
  if(!value.edits||typeof value.edits!=='object'||Array.isArray(value.edits)||Object.keys(value.edits).length>5000)throw new SafetyError('实例编辑记录超过预算或无效',422);
  for(const [id,edit]of Object.entries(value.edits)){
   if(!identity(id)||edit.id!==id||!value.instances[edit.instanceId]||!value.assets[edit.assetId]||!identity(edit.sourceId)||!identity(edit.fromSourceId)||!hash(edit.fromRevision)||!hash(edit.fromHash)||!['editing','applied'].includes(edit.phase)||edit.mode!=='independent'||!/^edit-[a-f0-9-]{36}$/.test(id)||edit.sourceId!=='fork-'+id.slice(5))throw new SafetyError('实例编辑来源无效',422);
  }
 }
 if(value.links!==undefined){
  if(!value.links||typeof value.links!=='object'||Array.isArray(value.links)||Object.keys(value.links).length>1000)throw new SafetyError('关联组记录无效或超过预算',422);
  for(const [id,link]of Object.entries(value.links)){
   if(!/^link-[a-f0-9-]{36}$/.test(id)||link.id!==id||!value.assets[link.assetId]||!Array.isArray(link.instanceIds)||link.instanceIds.length>100||new Set(link.instanceIds).size!==link.instanceIds.length||link.instanceIds.some(key=>!value.instances[key]||value.instances[key].linkId!==id))throw new SafetyError('关联成员记录不一致',422);
  }
 }
 for(const instance of Object.values(value.instances))if(instance.linkId&&!value.links?.[instance.linkId]?.instanceIds.includes(instance.id))throw new SafetyError('实例的关联组不存在',422);
 if(value.workVariants!==undefined){
  if(!value.workVariants||typeof value.workVariants!=='object'||Array.isArray(value.workVariants)||Object.keys(value.workVariants).length>1000)throw new SafetyError('作品方案记录无效或超过预算',422);
  for(const [id,group] of Object.entries(value.workVariants)){
   if(!/^variants-[a-f0-9-]{36}$/.test(id)||group.id!==id||!identity(group.originalSourceId)||!hash(group.baseRevision)||group.baseRelationSignature!==undefined&&!hash(group.baseRelationSignature)||!Array.isArray(group.branches)||group.branches.length>20||group.branches.some(branch=>!/^variant-[a-f0-9-]{36}$/.test(branch.sourceId||'')||!hash(branch.forkRevision)||typeof branch.label!=='string'))throw new SafetyError('作品方案来源无效',422);
  }
 }
 if(value.updates!==undefined){
  if(!value.updates||typeof value.updates!=='object'||Array.isArray(value.updates)||Object.keys(value.updates).length>1000)throw new SafetyError('关联更新记录超过预算或无效',422);
  for(const [id,update]of Object.entries(value.updates)){
   if(update.layoutPolicy!==undefined&&!validLayoutPolicy(update.layoutPolicy))throw new SafetyError('关联更新锚点无效',422);
   if(!/^update-[a-f0-9-]{36}$/.test(id)||update.id!==id||!value.links?.[update.linkId]||!value.edits?.[update.editId]||!value.assets[update.assetId]||!['prepared','partial','succeeded'].includes(update.status)||!update.sources||typeof update.sources!=='object'||Array.isArray(update.sources)||Object.keys(update.sources).length>100||!update.committed||typeof update.committed!=='object'||Array.isArray(update.committed))throw new SafetyError('关联更新归属无效',422);
   for(const [sourceId,target]of Object.entries(update.sources))if(!identity(sourceId)||!hash(target.baseRevision)||!Array.isArray(target.instanceIds)||!target.instanceIds.length||target.instanceIds.length>100||target.instanceIds.some(key=>value.instances[key]?.sourceId!==sourceId)||update.committed[sourceId]&&!hash(update.committed[sourceId]))throw new SafetyError('关联更新目标无效',422);
  }
 }
 return value;
}
function nativeNodes(bytes,engine){
 if(engine==='deckcraft')return nativeDeckNodes(bytes);
 const file=nativeVectorHeader(bytes);
 if(file.format!=='vectorcraft'||!Array.isArray(file.document?.layers))throw new SafetyError('该布局引擎的实例核对尚未接入',422);
 const found=new Map();let count=0;
 const walk=(nodes,depth=0)=>{
  if(depth>64||!Array.isArray(nodes))throw new SafetyError('原生布局结构无效或过深',413);
  for(const node of nodes){if(++count>100000)throw new SafetyError('原生布局对象超过预算',413);
   const id=idOf(node.id);if(found.has(id))throw new SafetyError('原生布局含重复身份',422);found.set(id,node);
   if(node.kind?.children)walk(node.kind.children,depth+1);
  }
 };walk(file.document.layers);return found;
}
function derivativeAdmission(format,bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_DERIVATIVE)throw new SafetyError('素材派生物为空或超过4MiB预算',413);
 if(format==='png'){
  if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new SafetyError('素材不是 PNG',422);
  previewImageSize(bytes);
 }else if(format==='svg'){
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('SVG 编码无效',422);}
  if(!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)||/<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed)\b|\son[a-z]+\s*=/i.test(text))throw new SafetyError('素材不是受支持的静态 SVG',422);
 }else throw new SafetyError('当前仅支持 SVG/PNG 素材派生物',422);
}
function nativePicture(bytes,node,engine){
 if(engine==='deckcraft')return nativeDeckPicture(bytes,node);
 if(engine==='vectorcraft')return nativeVectorImage(bytes,node);
 throw new SafetyError('该原生图片引擎尚未接入回写核对',422);
}
function verifyNativeMaterial(bytes,node,engine,asset){
 if(asset.format==='svg'&&engine==='vectorcraft'){
  if(digest(nativeVectorEmbedded(bytes,node))!==asset.sourceHash)throw new SafetyError('海报中的矢量源与素材版本不一致',409);
  return;
 }
 if(asset.format==='svg'&&engine==='deckcraft'){
  if(!asset.preview||digest(nativeDeckSvg(bytes,node))!==asset.sha256||digest(nativeDeckPicture(bytes,node))!==asset.preview.sha256)throw new SafetyError('原生 SVG 原文或兼容预览与素材版本不一致',409);
  return;
 }
 if(asset.format!=='png'||digest(nativePicture(bytes,node,engine))!==asset.sha256)throw new SafetyError('原生图片与实际素材字节不一致',409);
}
const supportsNativeOrigin=(asset,engine)=>asset?.format==='png'||asset?.format==='svg'&&['vectorcraft','deckcraft'].includes(engine)&&!!asset.preview;
function assertContentOnly(before,after,ids,engine,expectedOrigin,format='png',frames={}){
 if(engine==='deckcraft')return assertDeckContentOnly(before,after,ids,expectedOrigin,frames);
 if(engine==='vectorcraft'&&format==='svg')return assertVectorEmbeddedContentOnly(before,after,ids,expectedOrigin,frames);
 if(engine==='vectorcraft')return assertVectorImageContentOnly(before,after,ids,expectedOrigin,frames);
 throw new SafetyError('该原生图片引擎尚未接入原位属性核对',422);
}
function vectorPixelSize(node,bytes){
 const size=previewImageSize(bytes);
 if(node.kind?.type!=='image'||node.kind.width!==size.width||node.kind.height!==size.height)throw new SafetyError('海报原生图片的像素尺寸与实际 PNG 不一致',409);
}
function bindingState(instance,node,revision){
 return {assetId:instance.assetId,sourceRevision:revision||instance.boundAtRevision,nativeNodeHash:node?digest(Buffer.from(JSON.stringify(node))):instance.nativeNodeHash,...(instance.originToken?{originToken:instance.originToken}:{}),...(instance.linkId?{linkId:instance.linkId}:{}),...(instance.linkEpoch?{linkEpoch:instance.linkEpoch}:{})};
}
function rememberBinding(instance,state){
 const history=[...(instance.bindingHistory||[])];
 if(!history.some(item=>JSON.stringify(item)===JSON.stringify(state)))history.push(state);
 return history.slice(-32);
}

export class ProjectGraph {
 constructor(root,sources=new NativeSourceStore(root)){this.root=root;this.sources=sources;}
 path(...parts){return workspacePath(this.root,join('design','.designcraft','v2','project',...parts));}
 async pointer(file){
  let bytes;try{bytes=await boundedRead(file,1024);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  let value;try{value=JSON.parse(bytes);}catch{throw new SafetyError('项目提交指针损坏',422);}
  if(!hash(value.revision))throw new SafetyError('项目提交身份无效',422);return value.revision;
 }
 async read(){
  let revision=await this.pointer(this.path('root.json')),previous=null,result=null;const seen=new Set();
  while(revision){
   if(seen.has(revision)||seen.size>=10000)throw new SafetyError('项目提交链损坏或超过预算',422);seen.add(revision);
   const bytes=await boundedRead(this.path('history',revision+'.json'),MAX_MANIFEST);
   if(digest(bytes)!==revision)throw new SafetyError('项目关系完整性失败',422);
   const value=manifest(bytes);
   if(value.parentRevision!==previous||result&&value.id!==result.manifest.id)throw new SafetyError('项目提交归属不一致',422);
   result={revision,manifest:value};previous=revision;revision=await this.pointer(this.path('next',revision+'.json'));
  }
  return result||{revision:null,manifest:{schema:1,id:null,assets:{},instances:{}}};
 }
 async readAt(target){
  if(!hash(target))throw new SafetyError('项目关系历史版本无效',422);let revision=await this.pointer(this.path('root.json')),previous=null,projectId=null;const seen=new Set();
  while(revision){if(seen.has(revision)||seen.size>=10000)throw new SafetyError('项目提交链损坏或超过预算',422);seen.add(revision);const bytes=await boundedRead(this.path('history',revision+'.json'),MAX_MANIFEST);if(digest(bytes)!==revision)throw new SafetyError('项目关系完整性失败',422);const value=manifest(bytes);if(value.parentRevision!==previous||projectId&&value.id!==projectId)throw new SafetyError('项目提交归属不一致',422);projectId=value.id;if(revision===target)return {revision,manifest:value};previous=revision;revision=await this.pointer(this.path('next',revision+'.json'));}
  throw new SafetyError('指定项目关系版本不存在或未发布',404);
 }
 async change(baseRevision,update){
  const current=await this.read();if(current.revision!==baseRevision)throw new SafetyError('项目关系已有新版本，请刷新；未覆盖任何记录',409);
  const value=structuredClone(current.manifest);value.id||='project-'+randomUUID();
  value.parentRevision=current.revision;value.at=new Date().toISOString();update(value);
  const bytes=Buffer.from(JSON.stringify(value,null,2));if(bytes.length>MAX_MANIFEST)throw new SafetyError('项目关系超过4MiB预算',413);manifest(bytes);
  for(const part of ['history','next','derivatives'])await fs.mkdir(this.path(part),{recursive:true});
  const revision=digest(bytes);await publish(this.path('history',revision+'.json'),bytes);
  const pointer=current.revision?this.path('next',current.revision+'.json'):this.path('root.json');
  if(!await publish(pointer,Buffer.from(JSON.stringify({revision})),{claim:true}))throw new SafetyError('另一窗口已提交项目关系，本次未覆盖',409);
  return {revision,manifest:value};
 }
 async addDerivative({operationId,baseRevision,sourceId,sourceRevision,sourceHash,engineState,format,bytes,preview,title}){
  if(!identity(operationId))throw new SafetyError('素材操作身份无效',422);
  if(!hash(sourceRevision)||!hash(sourceHash))throw new SafetyError('素材必须对应明确的已提交源版本',422);
  if(typeof title!=='string'||!title.trim()||title.length>200)throw new SafetyError('素材名称无效',422);
  derivativeAdmission(format,bytes);
  let previewMeta;
  if(preview!==undefined){
   if(format!=='svg')throw new SafetyError('只有 SVG 素材可以附带独立的兼容预览',422);
   derivativeAdmission('png',preview);const size=previewImageSize(preview);
   previewMeta={format:'png',sha256:digest(preview),bytes:preview.length,width:size.width,height:size.height};
  }
  const source=await this.sources.source(sourceId,sourceRevision);
  if(previewMeta&&source.meta.engine!=='vectorcraft')throw new SafetyError('SVG 兼容预览必须来自对应矢量源',422);
  if(source.meta.sourceHash!==sourceHash||!sameUint64(engineState?.uid,source.meta.engineState.uid)||!sameUint64(engineState?.revision,source.meta.engineState.revision)||source.meta.engine==='photocraft'&&!sameUint64(engineState?.nativeDocumentId,source.meta.engineState.nativeDocumentId))throw new SafetyError('素材派生物与已保存源版本不一致，未登记',409);
  const id='asset-'+operationId;if(!identity(id))throw new SafetyError('素材操作身份过长',422);
  const current=await this.read(),sha256=digest(bytes),existing=current.manifest.assets[id];
  if(existing){
   if(existing.sourceId!==sourceId||existing.sourceRevision!==sourceRevision||existing.sha256!==sha256||existing.format!==format||JSON.stringify(existing.preview)!==JSON.stringify(previewMeta))throw new SafetyError('素材操作身份不能用于另一结果',409);
   return {asset:existing,revision:current.revision,reused:true};
  }
  const asset={id,title:title.trim(),sourceId,sourceRevision,sourceHash,engine:source.meta.engine,format,sha256,bytes:bytes.length,...(previewMeta?{preview:previewMeta}:{}),at:new Date().toISOString()};
  await fs.mkdir(this.path('derivatives'),{recursive:true});await publish(this.path('derivatives',sha256+'.'+format),bytes);
  if(previewMeta)await publish(this.path('derivatives',previewMeta.sha256+'.png'),preview);
  const next=await this.change(baseRevision,value=>{value.assets[id]=asset;});return {asset,revision:next.revision};
 }
 async asset(id,{withSource=false}={}){
  if(!identity(id))throw new SafetyError('素材身份无效',422);
  const current=await this.read(),asset=current.manifest.assets[id];if(!asset)throw new SafetyError('素材不存在',404);
  const source=await this.sources.source(asset.sourceId,asset.sourceRevision);
  if(source.meta.sourceHash!==asset.sourceHash)throw new SafetyError('素材原生源版本不一致',422);
  const path=this.path('derivatives',asset.sha256+'.'+asset.format),bytes=await boundedRead(path,MAX_DERIVATIVE);
  if(bytes.length!==asset.bytes||digest(bytes)!==asset.sha256)throw new SafetyError('素材字节完整性失败',422);
  return {asset,path,bytes,revision:current.revision,...(withSource?{source}:{})};
 }
 async preview(id){
  const {asset,revision}=await this.asset(id),preview=asset.preview;if(!preview)throw new SafetyError('此 SVG 素材尚无已核对的兼容预览，请从矢量源重新派生',409);
  const path=this.path('derivatives',preview.sha256+'.png'),bytes=await boundedRead(path,MAX_DERIVATIVE);derivativeAdmission('png',bytes);const size=previewImageSize(bytes);
  if(bytes.length!==preview.bytes||digest(bytes)!==preview.sha256||size.width!==preview.width||size.height!==preview.height)throw new SafetyError('SVG 兼容预览字节完整性失败',422);
  return {asset,path,bytes,format:'png',sha256:preview.sha256,revision};
 }
 async assetSource(id){
  const {asset,revision,source}=await this.asset(id,{withSource:true});
  if(asset.format!=='svg'||asset.engine!=='vectorcraft')throw new SafetyError('只有矢量 SVG 素材具有可嵌入的矢量源',422);
  if(source.meta.bytes>MAX_DERIVATIVE)throw new SafetyError('矢量源超过 4 MiB 嵌入预算，原素材已保留',413);
  const bytes=await boundedRead(source.path,MAX_DERIVATIVE);
  if(bytes.length!==source.meta.bytes||digest(bytes)!==asset.sourceHash)throw new SafetyError('矢量源完整性检查失败',422);
  return {asset,bytes,format:'source',sha256:asset.sourceHash,revision};
 }
 async bind({operationId,assetId,sourceId,sourceRevision,nativeId}){
  if(!identity(operationId))throw new SafetyError('素材使用操作身份无效',422);
  if(!hash(sourceRevision))throw new SafetyError('素材使用处必须对应已提交布局版本',422);
  const {asset}=await this.asset(assetId),source=await this.sources.read(sourceId,sourceRevision),id='use-'+operationId;
  if(!identity(id))throw new SafetyError('素材使用操作身份过长',422);
  const nodeId=idOf(nativeId),node=nativeNodes(source.bytes,source.meta.engine).get(nodeId);
  if(!node||node.kind?.type==='layer')throw new SafetyError('已保存布局中没有对应的实际原生对象，未登记使用处',409);
  if(source.meta.engine==='deckcraft'||asset.format==='png'||node.kind?.type==='placeddocument')verifyNativeMaterial(source.bytes,node,source.meta.engine,asset);
  const current=await this.read(),existing=current.manifest.instances[id];
  if(existing){
   if(existing.assetId!==asset.id||existing.sourceId!==sourceId||existing.nativeId!==nodeId||existing.boundAtRevision!==sourceRevision)throw new SafetyError('素材使用操作身份不能重复绑定其他对象',409);
   return {instance:existing,revision:current.revision,reused:true};
  }
  const origin=materialOrigin(node,source.meta.engine);
  if(origin&&(origin.projectId!==current.manifest.id||origin.assetId!==asset.id))throw new SafetyError('原生来源声明不属于此素材和项目',409);
  const instance={id,assetId:asset.id,sourceId,nativeId:nodeId,boundAtRevision:sourceRevision,nativeNodeHash:digest(Buffer.from(JSON.stringify(node))),...(origin?{originToken:origin.instanceId}:{}),...(node.layoutPage?{nativePage:node.layoutPage}:{}),at:new Date().toISOString()};
  const next=await this.change(current.revision,value=>{value.instances[id]=instance;});return {instance,revision:next.revision};
 }
 async instance(id,{sourceId}={}){
  if(!identity(id))throw new SafetyError('素材使用处身份无效',422);
  const current=await this.read(),instance=current.manifest.instances[id];
  if(!instance)throw new SafetyError('素材使用处不存在',404);
  if(sourceId!==undefined&&sourceId!==instance.sourceId)throw new SafetyError('素材使用处不属于当前设计',409);
  const material=await this.asset(instance.assetId),source=await this.sources.read(instance.sourceId);
  const node=nativeNodes(source.bytes,source.meta.engine).get(instance.nativeId);
  if(!node)throw new SafetyError('原图片已被删除，未改变设计',409);
  const origin=materialOrigin(node,source.meta.engine);
  if(origin&&(origin.projectId!==current.manifest.id||origin.assetId!==instance.assetId||instance.originToken&&origin.instanceId!==instance.originToken)||!origin&&instance.originToken)throw new SafetyError('此原生对象的来源关系已改变，请先核对保存结果',409);
  if(source.meta.engine==='deckcraft'||material.asset.format==='png'||node.kind?.type==='placeddocument')verifyNativeMaterial(source.bytes,node,source.meta.engine,material.asset);
  return {instance,...material,source,node};
 }
 /** Read-only preflight for a historical SVG group; does not enable apply. */
 async legacyVectorPreflight(id,{sourceId,atRevision}={}){
  const project=await this.read(),instance=project.manifest.instances[id];
  if(!instance||sourceId!==undefined&&instance.sourceId!==sourceId)throw new SafetyError('旧 SVG 使用处不存在或不属于当前设计',409);
  const source=await this.sources.read(instance.sourceId,atRevision),{asset}=await this.asset(instance.assetId);
  if(source.meta.engine!=='vectorcraft'||asset.format!=='svg'||asset.engine!=='vectorcraft')throw new SafetyError('该使用处不是旧版矢量 SVG 组',422);
  const boundRevision=instance.legacyPlacementRevision||instance.boundAtRevision,bound=await this.sources.read(instance.sourceId,boundRevision);
  if(bound.meta.engine!=='vectorcraft')throw new SafetyError('旧 SVG 原始设计类型不一致',409);
  const boundNode=nativeNodes(bound.bytes,'vectorcraft').get(instance.nativeId),currentNode=nativeNodes(source.bytes,'vectorcraft').get(instance.nativeId);
  return verifyLegacyVectorBinding({binding:{...instance,boundAtRevision:boundRevision},receipt:bound.meta.operation,boundRevision:bound.revision,boundNode,currentNode,asset,instances:project.manifest.instances});
 }
 async prepareSvgConversion({instanceId,sourceId}){
  const target=await this.instance(instanceId,{sourceId});
  if(target.source.meta.engine!=='deckcraft'||target.asset.format!=='svg'||!target.asset.preview||target.node.kind?.type!=='picture'||target.node.hidden||target.node.layoutPage?.kind!=='slide')throw new SafetyError('请选择当前幻灯片中可见且带原文和预览的 SVG 图片',422);
  if(target.instance.linkId)throw new SafetyError('请先解除此使用处的关联，再转换为可编辑形状；原 SVG 会保留',409);
  return {instance:target.instance,asset:target.asset,sourceId:target.instance.sourceId,baseRevision:target.source.revision,nativePage:target.node.layoutPage};
 }
 async verifySvgConversionSource(plan,bytes){
  const before=await this.sources.read(plan.sourceId,plan.baseRevision),old=nativeNodes(before.bytes,'deckcraft').get(plan.instance.nativeId),next=nativeNodes(bytes,'deckcraft').get(plan.instance.nativeId),asset=await this.asset(plan.instance.assetId);
  if(before.meta.engine!=='deckcraft'||!old||!next||asset.asset.id!==plan.asset.id)throw new SafetyError('SVG 转换的原图片或素材已改变',409);
  verifyNativeMaterial(before.bytes,old,'deckcraft',asset.asset);verifyNativeMaterial(bytes,next,'deckcraft',asset.asset);
  return assertDeckSvgConversionOnly(before.bytes,bytes,plan.instance.nativeId,plan.nativeShapes);
 }
 async verifySavedSvgConversion({sourceId,sourceRevision,operationId}){
  const source=await this.sources.read(sourceId,sourceRevision),receipt=source.meta.operation;
  if(source.meta.engine!=='deckcraft'||receipt?.action!=='convert-svg'||receipt.id!==operationId||receipt.baseRevision!==source.meta.parentRevision)throw new SafetyError('没有匹配的已保存 SVG 转换回执',409);
  const current=await this.read(),instance=current.manifest.instances[receipt.instanceId],asset=(await this.asset(receipt.assetId)).asset;
  if(!instance||instance.sourceId!==sourceId||!sameUint64(instance.nativeId,receipt.nativeId)||asset.format!=='svg')throw new SafetyError('转换回执与项目原始使用处不一致',409);
  const nodes=nativeNodes(source.bytes,'deckcraft'),nativeShapes=receipt.shapeIds.map(id=>{const node=nodes.get(String(id));if(!node)throw new SafetyError('已保存转换缺少原生对象',409);const {layoutPage,...shape}=node;return shape;});
  if(digest(Buffer.from(validateConvertedShapes(receipt.nativeId,nativeShapes)))!==receipt.shapesHash)throw new SafetyError('已保存转换对象与回执哈希不一致',409);
  const plan={sourceId,baseRevision:receipt.baseRevision,instance:{...instance,assetId:receipt.assetId},asset,nativeShapes};
  const verified=await this.verifySvgConversionSource(plan,source.bytes);
  return {sourceId,sourceRevision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,operationId,instanceId:receipt.instanceId,assetId:receipt.assetId,originalId:verified.originalId,shapeIds:verified.ids,shapesHash:receipt.shapesHash};
 }
 async startInstanceEdit({operationId,instanceId,sourceId}){
  if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId))throw new SafetyError('实例编辑身份无效',422);
  const id='edit-'+operationId;
  let current=await this.read(),edit=current.manifest.edits?.[id];
  if(edit&&(edit.instanceId!==instanceId||sourceId!==undefined&&current.manifest.instances[instanceId]?.sourceId!==sourceId))throw new SafetyError('实例编辑身份不能用于其他使用处',409);
  if(edit?.phase==='applied')throw new SafetyError('此编辑已回写，请开始新的实例编辑',409);
  if(!edit){
   const target=await this.instance(instanceId,{sourceId}),asset=target.asset;
   edit={id,instanceId,assetId:asset.id,sourceId:'fork-'+operationId,fromSourceId:asset.sourceId,fromRevision:asset.sourceRevision,fromHash:asset.sourceHash,mode:'independent',phase:'editing',at:new Date().toISOString()};
   const next=await this.change(current.revision,value=>{(value.edits||={})[id]=edit;});current=next;
  }
  const fork=await this.sources.forkVersion(edit.fromSourceId,edit.fromRevision,{operationId,title:(current.manifest.assets[edit.assetId].title+' · 独立编辑').slice(0,200)});
  return {edit,fork,revision:current.revision};
 }
 async prepareInstanceApply({editId,assetId,sourceId}){
  const current=await this.read(),edit=current.manifest.edits?.[editId];
  if(!edit||edit.phase!=='editing')throw new SafetyError('实例编辑不存在或已完成',409);
  const target=await this.instance(edit.instanceId,{sourceId}),replacement=await this.asset(assetId);
  if(target.instance.linkId&&current.manifest.links?.[target.instance.linkId]?.pendingUpdate)throw new SafetyError('关联组正在更新，请先恢复或等待该更新',409);
  if(target.instance.assetId!==edit.assetId)throw new SafetyError('实例的素材版本已改变，未覆盖',409);
  const engine=target.source.meta.engine,format=target.asset.format,legacyGroup=format==='svg'&&engine==='vectorcraft'&&target.node.kind?.type==='group';
  const supported=format==='png'&&['deckcraft','vectorcraft'].includes(engine)||format==='svg'&&['deckcraft','vectorcraft'].includes(engine)&&replacement.asset.preview&&(legacyGroup||target.asset.preview&&(engine!=='vectorcraft'||target.node.kind?.type==='placeddocument'));
  if(replacement.asset.sourceId!==edit.sourceId||replacement.asset.format!==format||!supported)throw new SafetyError('该素材的原位回写尚未接入，未将其他类型静默转为图片',422);
  if(format==='svg'&&target.node.kind?.fill?.artistic)throw new SafetyError('此 SVG 的艺术效果尚未接入保真回写，原文与当前设计均已保留',422);
  if(legacyGroup)await this.legacyVectorPreflight(target.instance.id,{sourceId:target.instance.sourceId,atRevision:target.source.revision});
  else verifyNativeMaterial(target.source.bytes,target.node,engine,target.asset);
  return {edit,asset:replacement.asset,instance:target.instance,baseRevision:target.source.revision,nativePage:target.node.layoutPage,...(legacyGroup?{legacyGroup:true}: {})};
 }
 async verifyInstanceApplySource(plan,bytes){
  const before=await this.sources.read(plan.sourceId,plan.baseRevision),old=nativeNodes(before.bytes,before.meta.engine).get(plan.instance.nativeId),node=nativeNodes(bytes,before.meta.engine).get(plan.instance.nativeId),previous=await this.asset(plan.instance.assetId),replacement=await this.asset(plan.asset.id);
  if(!old||!node)throw new SafetyError('原位内容核对目标不存在，未发布源版本',409);
  if(plan.legacyGroup)await this.legacyVectorPreflight(plan.instance.id,{sourceId:plan.sourceId,atRevision:plan.baseRevision});
  else verifyNativeMaterial(before.bytes,old,before.meta.engine,previous.asset);
  verifyNativeMaterial(bytes,node,before.meta.engine,replacement.asset);
  if(before.meta.engine==='vectorcraft'&&replacement.asset.format==='png')vectorPixelSize(node,replacement.bytes);
  const origin={projectId:(await this.read()).manifest.id,previousAssetId:plan.instance.assetId,assetId:plan.asset.id};
  if(plan.legacyGroup)assertVectorLegacyContentOnly(before.bytes,bytes,plan.instance.nativeId,origin,plan.nativeKind);
  else assertContentOnly(before.bytes,bytes,[plan.instance.nativeId],before.meta.engine,origin,replacement.asset.format);
 }
 async completeInstanceApply({sourceId,sourceRevision,operationId}){
  const source=await this.sources.read(sourceId,sourceRevision),receipt=source.meta.operation;
  if(receipt?.action!=='apply-instance'||receipt.id!==operationId||receipt.baseRevision!==source.meta.parentRevision)throw new SafetyError('没有对应的已提交原位回写回执；不会重复执行',409);
  const current=await this.read(),edit=current.manifest.edits?.[receipt.editId],instance=current.manifest.instances[receipt.instanceId];
  if(!edit||edit.instanceId!==receipt.instanceId||!instance||instance.sourceId!==sourceId||instance.nativeId!==String(receipt.nativeId))throw new SafetyError('原位回写回执归属不一致',409);
  if(edit.phase==='applied'){
   if(edit.applyOperationId!==operationId||edit.appliedAssetId!==receipt.assetId||edit.appliedRevision!==sourceRevision)throw new SafetyError('实例编辑已由另一回执完成',409);
   return {edit,instance,revision:current.revision,reused:true};
  }
  if(instance.assetId!==receipt.previousAssetId||edit.assetId!==receipt.previousAssetId)throw new SafetyError('原位回写前的素材关系已改变，未覆盖关系',409);
  const replacement=await this.asset(receipt.assetId);
  const format=replacement.asset.format,supported=format==='png'&&['deckcraft','vectorcraft'].includes(source.meta.engine)||format==='svg'&&['deckcraft','vectorcraft'].includes(source.meta.engine)&&replacement.asset.preview;
  if(replacement.asset.sourceId!==edit.sourceId||!supported||current.manifest.assets[receipt.previousAssetId]?.format!==format)throw new SafetyError('原位回写来源无效',409);
  const before=await this.sources.read(sourceId,receipt.baseRevision),oldNode=nativeNodes(before.bytes,before.meta.engine).get(instance.nativeId),node=nativeNodes(source.bytes,source.meta.engine).get(instance.nativeId);
  const previous=await this.asset(receipt.previousAssetId);
  if(!oldNode||!node)throw new SafetyError('已保存结果中没有原位对象，源已保留但不标记完成',409);
  const legacyGroup=source.meta.engine==='vectorcraft'&&format==='svg'&&oldNode.kind?.type==='group';
  if(legacyGroup){
   await this.legacyVectorPreflight(instance.id,{sourceId,atRevision:receipt.baseRevision});
   if(!receipt.legacyKindHash||digest(Buffer.from(canonicalLegacyKind(node.kind,replacement.asset.sourceHash)))!==receipt.legacyKindHash)throw new SafetyError('旧 SVG 保存结果与已记录的原生边框不一致',409);
  }else{
   if(receipt.legacyKindHash)throw new SafetyError('旧 SVG 回执与原生对象类型不一致',409);
   verifyNativeMaterial(before.bytes,oldNode,source.meta.engine,previous.asset);
  }
  verifyNativeMaterial(source.bytes,node,source.meta.engine,replacement.asset);
  if(source.meta.engine==='vectorcraft'&&format==='png')vectorPixelSize(node,replacement.bytes);
  const origin={projectId:current.manifest.id,previousAssetId:receipt.previousAssetId,assetId:receipt.assetId};
  if(legacyGroup)assertVectorLegacyContentOnly(before.bytes,source.bytes,instance.nativeId,origin,node.kind);
  else assertContentOnly(before.bytes,source.bytes,[instance.nativeId],source.meta.engine,origin,format);
  let result;
  const next=await this.change(current.revision,value=>{
   const origin=materialOrigin(node,source.meta.engine);
   const updated={...instance,assetId:receipt.assetId,boundAtRevision:sourceRevision,nativeNodeHash:digest(Buffer.from(JSON.stringify(node))),nativePage:node.layoutPage,lastApplyOperationId:operationId,bindingHistory:rememberBinding(instance,bindingState(instance,oldNode,receipt.baseRevision)),...(origin?{originToken:origin.instanceId}:{}),...(legacyGroup?{legacyPlacementRevision:instance.legacyPlacementRevision||instance.boundAtRevision}:{})};
   if(updated.linkId){const link=value.links[updated.linkId];if(link.pendingUpdate)throw new SafetyError('关联更新尚未结束，未更改关系',409);link.instanceIds=link.instanceIds.filter(id=>id!==instance.id);delete updated.linkId;}
   const done={...edit,phase:'applied',applyOperationId:operationId,appliedAssetId:receipt.assetId,appliedRevision:sourceRevision};
   value.instances[instance.id]=updated;value.edits[edit.id]=done;result={edit:done,instance:updated};
  });return {...result,revision:next.revision};
 }
 async linkInstances({operationId,instanceIds}){
  if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId)||!Array.isArray(instanceIds)||instanceIds.length<2||instanceIds.length>100||new Set(instanceIds).size!==instanceIds.length)throw new SafetyError('请明确选择2至100个素材使用处',422);
  const current=await this.read(),id='link-'+operationId,existing=current.manifest.links?.[id];
  if(existing){if(JSON.stringify(existing.instanceIds)!==JSON.stringify(instanceIds))throw new SafetyError('关联操作身份已用于其他成员',409);return {link:existing,revision:current.revision,reused:true};}
  const targets=[];
  for(const instanceId of instanceIds){const target=await this.instance(instanceId);if(target.instance.linkId)throw new SafetyError('使用处已属于关联组，请先解除原关联',409);targets.push(target);}
  const assetId=targets[0].asset.id;
  if(targets.some(item=>item.asset.id!==assetId))throw new SafetyError('关联需从同一明确素材版本开始，文件名或相同像素不会自动建立关联',409);
  const link={id,assetId,instanceIds:[...instanceIds],at:new Date().toISOString()};
  const next=await this.change(current.revision,value=>{(value.links||={})[id]=link;for(const instanceId of instanceIds){value.instances[instanceId].linkId=id;value.instances[instanceId].linkEpoch=operationId;}});return {link,revision:next.revision};
 }
 async unlinkInstance(instanceId){
  const current=await this.read(),instance=current.manifest.instances[instanceId];
  if(!instance)throw new SafetyError('使用处不存在',404);
  if(!instance.linkId)return {instance,revision:current.revision,reused:true};
  const link=current.manifest.links?.[instance.linkId];if(link?.pendingUpdate)throw new SafetyError('关联更新尚未结束，暂不能更改成员',409);
  const next=await this.change(current.revision,value=>{value.links[instance.linkId].instanceIds=value.links[instance.linkId].instanceIds.filter(id=>id!==instanceId);delete value.instances[instanceId].linkId;value.instances[instanceId].linkEpoch=randomUUID();});
  return {instance:next.manifest.instances[instanceId],revision:next.revision};
 }
 async prepareLinkedUpdate({operationId,editId,assetId,linkId,instanceIds,layoutPolicy='fixed'}){
  if(!validLayoutPolicy(layoutPolicy))throw new SafetyError('关联更新比例处理方式无效',422);
  if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId))throw new SafetyError('关联更新身份无效',422);
  if(typeof linkId!=='string'||!/^link-[a-f0-9-]{36}$/.test(linkId)||!Array.isArray(instanceIds)||instanceIds.length<2||instanceIds.length>100||instanceIds.some(id=>!identity(id))||new Set(instanceIds).size!==instanceIds.length)throw new SafetyError('关联更新需要明确的关联组和全部使用处清单',422);
  const sameMembers=members=>JSON.stringify([...members].sort())===JSON.stringify([...instanceIds].sort());
  const current=await this.read(),id='update-'+operationId,existing=current.manifest.updates?.[id];
  if(existing){if(existing.editId!==editId||existing.assetId!==assetId||existing.linkId!==linkId||(existing.layoutPolicy||'fixed')!==layoutPolicy||!sameMembers(Object.values(existing.sources).flatMap(source=>source.instanceIds)))throw new SafetyError('关联更新身份已用于其他结果或范围',409);return {update:existing,revision:current.revision,reused:true};}
  const edit=current.manifest.edits?.[editId],instance=current.manifest.instances[edit?.instanceId],link=current.manifest.links?.[instance?.linkId],replacement=await this.asset(assetId);
  if(!edit||edit.phase!=='editing'||!link||link.instanceIds.length<2||link.pendingUpdate||replacement.asset.sourceId!==edit.sourceId||!['png','svg'].includes(replacement.asset.format)||replacement.asset.format==='svg'&&!replacement.asset.preview||current.manifest.assets[link.assetId]?.format!==replacement.asset.format)throw new SafetyError('当前实例没有可更新的关联组、素材类型不匹配或该组已有待恢复更新',409);
  if(link.id!==linkId||!sameMembers(link.instanceIds))throw new SafetyError('关联成员已改变，未扩大或缩小本次更新范围；请返回原设计核对关联',409);
  const sources={};
  for(const instanceId of link.instanceIds){
   const target=await this.instance(instanceId);
   const engine=target.source.meta.engine,format=target.asset.format;
   if(target.asset.id!==link.assetId||format!==replacement.asset.format||!['deckcraft','vectorcraft'].includes(engine)||engine==='deckcraft'&&target.node.layoutPage?.kind!=='slide'||target.node.hidden||target.node.locked||target.node.visible===false||format==='svg'&&(engine==='vectorcraft'&&target.node.kind?.type!=='placeddocument'||engine==='deckcraft'&&!target.asset.preview))throw new SafetyError('关联更新需要可编辑的实际 PNG 或受支持 SVG 海报/幻灯片使用处；旧组或隐藏对象未修改',422);
   const sourceId=target.instance.sourceId;
   if(sources[sourceId]&&sources[sourceId].baseRevision!==target.source.revision)throw new SafetyError('准备过程中原设计已改变，请刷新后重试',409);
   (sources[sourceId]||={engine:target.source.meta.engine,baseRevision:target.source.revision,instanceIds:[],...(target.source.meta.engine==='deckcraft'?{pages:{}}:{})}).instanceIds.push(instanceId);
   if(target.source.meta.engine==='deckcraft')sources[sourceId].pages[instanceId]=target.node.layoutPage;
  }
  const update={id,editId,linkId:link.id,assetId,previousAssetId:link.assetId,layoutPolicy,sources,committed:{},status:'prepared',at:new Date().toISOString()};
  const next=await this.change(current.revision,value=>{(value.updates||={})[id]=update;value.links[link.id].pendingUpdate=id;});return {update,revision:next.revision};
 }
 async verifyLinkedSource(updateId,sourceId,bytes){
  const current=await this.read(),update=current.manifest.updates?.[updateId],target=update?.sources[sourceId];
  if(!target)throw new SafetyError('设计不属于此关联更新',409);
  const source=await this.sources.read(sourceId,target.baseRevision),old=nativeNodes(source.bytes,source.meta.engine),nodes=nativeNodes(bytes,source.meta.engine),replacement=await this.asset(update.assetId),previous=await this.asset(update.previousAssetId),instances=[];
  for(const id of target.instanceIds){
   const instance=current.manifest.instances[id],before=old.get(instance.nativeId),node=nodes.get(instance.nativeId);
   if(!before||!node||previous.asset.format!==replacement.asset.format)throw new SafetyError('关联更新的实际素材或对象类型不一致',409);
   verifyNativeMaterial(source.bytes,before,source.meta.engine,previous.asset);verifyNativeMaterial(bytes,node,source.meta.engine,replacement.asset);
   if(source.meta.engine==='vectorcraft'&&replacement.asset.format==='png')vectorPixelSize(node,replacement.bytes);
   const origin=materialOrigin(node,source.meta.engine);
   instances.push({...instance,assetId:update.assetId,nativeNodeHash:digest(Buffer.from(JSON.stringify(node))),nativePage:node.layoutPage,bindingHistory:rememberBinding(instance,bindingState(instance,before,target.baseRevision)),...(origin?{originToken:origin.instanceId}:{})});
  }
  const frames=await this.linkedFrames(update,sourceId,{source,old,previous,replacement,manifest:current.manifest});
  assertContentOnly(source.bytes,bytes,instances.map(instance=>instance.nativeId),source.meta.engine,{projectId:current.manifest.id,previousAssetId:update.previousAssetId,assetId:update.assetId},replacement.asset.format,frames);return {update,target,instances};
 }
 async linkedFrames(update,sourceId,cached){
  if(!update.layoutPolicy||update.layoutPolicy==='fixed')return {};
  const group=update.sources[sourceId],source=cached?.source||await this.sources.read(sourceId,group.baseRevision);
  const old=cached?.old||nativeNodes(source.bytes,source.meta.engine),previous=cached?.previous||await this.asset(update.previousAssetId),replacement=cached?.replacement||await this.asset(update.assetId);
  const manifest=cached?.manifest||(await this.read()).manifest;
  const size=material=>material.asset.format==='svg'?material.asset.preview:previewImageSize(material.bytes);
  const from=size(previous),to=size(replacement),frames={};
  for(const id of group.instanceIds){
   const nativeId=manifest.instances[id].nativeId,frame=linkedFrame(old.get(nativeId),source.meta.engine,replacement.asset.format,from,to,update.layoutPolicy);
   if(frame)frames[nativeId]=frame;
  }
  return frames;
 }
 async refreshLinkedUpdate(updateId){
  const current=await this.read(),update=current.manifest.updates?.[updateId];if(!update)throw new SafetyError('关联更新不存在',404);
  if(update.status==='succeeded')return update;
  const sources=structuredClone(update.sources);let changed=false;
  for(const [sourceId,target]of Object.entries(sources)){
   if(update.committed[sourceId])continue;
   for(const instanceId of target.instanceIds){
    const actual=await this.instance(instanceId,{sourceId});
    if(actual.asset.id!==update.previousAssetId||actual.instance.linkId!==update.linkId||actual.source.meta.engine==='deckcraft'&&actual.node.layoutPage?.kind!=='slide')throw new SafetyError('未完成的关联图片内容或成员已改变，请先核对；不会覆盖新图片',409);
    if(target.baseRevision!==actual.source.revision){target.baseRevision=actual.source.revision;changed=true;}
    if(actual.source.meta.engine==='deckcraft'&&JSON.stringify(target.pages[instanceId])!==JSON.stringify(actual.node.layoutPage)){target.pages[instanceId]=actual.node.layoutPage;changed=true;}
   }
   const head=await this.sources.head(sourceId);if(head.revision!==target.baseRevision)throw new SafetyError('恢复准备期间设计又有修改，请等待保存结束',409);
  }
  if(!changed)return update;
  const next=await this.change(current.revision,value=>{value.updates[updateId].sources=sources;});return next.manifest.updates[updateId];
 }
 async completeLinkedSource({updateId,sourceId,sourceRevision}){
  const current=await this.read(),update=current.manifest.updates?.[updateId],target=update?.sources[sourceId];
  if(!target)throw new SafetyError('关联更新目标不存在',404);
  if(update.committed[sourceId]){
   if(update.committed[sourceId]!==sourceRevision)throw new SafetyError('关联源已由另一回执完成',409);
   return {update,revision:current.revision,reused:true};
  }
  const source=await this.sources.read(sourceId,sourceRevision),receipt=source.meta.operation;
  if(receipt?.action!=='linked-update'||receipt.id!==updateId.slice(7)||receipt.updateId!==updateId||receipt.assetId!==update.assetId||receipt.linkId!==update.linkId||receipt.baseRevision!==target.baseRevision||source.meta.parentRevision!==target.baseRevision||JSON.stringify(receipt.instanceIds)!==JSON.stringify(target.instanceIds))throw new SafetyError('没有匹配的已提交关联更新回执；不会重复执行',409);
  const verified=await this.verifyLinkedSource(updateId,sourceId,source.bytes),fresh=await this.read();
  const next=await this.change(fresh.revision,value=>{
   const pending=value.updates[updateId],link=value.links[pending.linkId];
   if(pending.committed[sourceId]||link.pendingUpdate!==updateId)throw new SafetyError('关联更新进度已改变，请刷新',409);
   for(const instance of verified.instances){if(value.instances[instance.id].assetId!==update.previousAssetId||value.instances[instance.id].linkId!==update.linkId)throw new SafetyError('关联成员已有其他修改',409);value.instances[instance.id]={...instance,boundAtRevision:sourceRevision,lastLinkedUpdateId:updateId};}
   pending.committed[sourceId]=sourceRevision;pending.status='partial';
   if(Object.keys(pending.sources).every(id=>pending.committed[id])){
    pending.status='succeeded';link.assetId=pending.assetId;delete link.pendingUpdate;
    Object.assign(value.edits[pending.editId],{phase:'applied',applyOperationId:updateId.slice(7),appliedAssetId:pending.assetId,appliedLinkedUpdateId:updateId});
   }
  });return {update:next.manifest.updates[updateId],revision:next.revision};
 }
 async checkLinkedCompletion(updateId,{historical=false}={}){
  const current=await this.read(),update=current.manifest.updates?.[updateId];
  if(update?.status!=='succeeded')throw new SafetyError('关联更新尚未全部保存',409);
  const replacement=await this.asset(update.assetId),newerSources=[];let checked=0;
  for(const [sourceId,group] of Object.entries(update.sources)){
   const revision=update.committed[sourceId],saved=await this.sources.read(sourceId,revision),op=saved.meta.operation;
   if(op?.action!=='linked-update'||op.updateId!==updateId||op.assetId!==update.assetId||op.linkId!==update.linkId||op.baseRevision!==group.baseRevision||JSON.stringify(op.instanceIds)!==JSON.stringify(group.instanceIds))throw new SafetyError('关联源缺少匹配的保存回执',409);
   const head=await this.sources.head(sourceId);
   if(head.revision!==revision)newerSources.push(sourceId);
   const source=historical||head.revision===revision?saved:await this.sources.read(sourceId,head.revision),nodes=nativeNodes(source.bytes,source.meta.engine);
   for(const id of group.instanceIds){
    const instance=current.manifest.instances[id],node=nodes.get(instance.nativeId);
    if(!node||!historical&&instance.assetId!==update.assetId)throw new SafetyError('该关联对象已有新内容，请核对当前作品',409);
    const origin=materialOrigin(node,source.meta.engine);
    if(origin&&(origin.projectId!==current.manifest.id||origin.assetId!==update.assetId)||!historical&&instance.originToken&&origin?.instanceId!==instance.originToken)throw new SafetyError('关联对象的来源身份不一致',409);
    verifyNativeMaterial(source.bytes,node,source.meta.engine,replacement.asset);checked++;
   }
  }
  return {updateId,checked,newerSources,committed:update.committed,status:update.status};
 }
 async originAssignments(sourceId,sourceRevision){
  const current=await this.read(),source=await this.sources.read(sourceId,sourceRevision);
  if(!current.manifest.id||!['vectorcraft','deckcraft'].includes(source.meta.engine))return {projectId:current.manifest.id,sourceId,sourceRevision,origins:[]};
  const nodes=nativeNodes(source.bytes,source.meta.engine),origins=[];
  for(const instance of Object.values(current.manifest.instances)){
   if(instance.sourceId!==sourceId||instance.originToken||!supportsNativeOrigin(current.manifest.assets[instance.assetId],source.meta.engine)||source.meta.engine==='vectorcraft'&&current.manifest.assets[instance.assetId]?.format==='svg')continue;
   const node=nodes.get(instance.nativeId);if(!node)continue;
   let origin;try{origin=materialOrigin(node,source.meta.engine);}catch{continue;}if(origin)continue;
   const asset=await this.asset(instance.assetId);try{verifyNativeMaterial(source.bytes,node,source.meta.engine,asset.asset);}catch{continue;}
   origins.push({instanceId:instance.id,id:instance.nativeId,hostMaterial:{schema:1,projectId:current.manifest.id,assetId:instance.assetId},nativeNodeHash:digest(Buffer.from(JSON.stringify(node))),...(node.layoutPage?{nativePage:node.layoutPage}:{})});
  }
  if(origins.length>100)throw new SafetyError('一次补入的原生来源超过100处，请拆分设计',413);
  return {projectId:current.manifest.id,sourceId,sourceRevision,engine:source.meta.engine,origins};
 }
 async verifyOriginAssignments(plan,bytes){
  const current=await this.read(),before=await this.sources.read(plan.sourceId,plan.sourceRevision),nodes=nativeNodes(bytes,before.meta.engine),expected={byNativeId:{}};
  if(current.manifest.id!==plan.projectId)throw new SafetyError('来源补入项目已改变',409);
  for(const row of plan.origins){
   const instance=current.manifest.instances[row.instanceId],node=nodes.get(row.id);
   if(!instance||instance.sourceId!==plan.sourceId||instance.nativeId!==row.id||instance.assetId!==row.hostMaterial.assetId||!node)throw new SafetyError('来源补入对象已有变化',409);
   const asset=await this.asset(instance.assetId),origin=materialOrigin(node,before.meta.engine);
   if(!origin||origin.projectId!==plan.projectId||origin.assetId!==instance.assetId)throw new SafetyError('来源补入与实际图片不一致',409);
   verifyNativeMaterial(bytes,node,before.meta.engine,asset.asset);
   expected.byNativeId[row.id]={projectId:plan.projectId,previousAssetId:instance.assetId,assetId:instance.assetId};
  }
  assertContentOnly(before.bytes,bytes,plan.origins.map(row=>row.id),before.meta.engine,expected);
 }
 /** Reconcile only explicit native source declarations and this same instance's
  * previously committed receipts. Never match unrelated objects by image hash. */
 async synchronizeSource({sourceId,sourceRevision,annotations,ignoreOperation=false}){
  const source=await this.sources.read(sourceId,sourceRevision);
  if(!['vectorcraft','deckcraft'].includes(source.meta.engine))return {changed:0};
  if((await this.sources.head(sourceId))?.revision!==sourceRevision)throw new SafetyError('原生来源核对期间设计又有保存，请重读最新版本',409);
  const current=await this.read();if(!current.manifest.id)return {changed:0};
  const value=structuredClone(current.manifest),nodes=nativeNodes(source.bytes,source.meta.engine),skip=new Set(),operation=source.meta.operation;
  if(!ignoreOperation&&operation?.action==='place')skip.add(String(operation.nativeId));
  if(!ignoreOperation&&operation?.action==='apply-instance')skip.add(String(operation.nativeId));
  if(!ignoreOperation&&operation?.action==='linked-update')for(const id of operation.instanceIds)if(value.instances[id])skip.add(value.instances[id].nativeId);
  const trusted=new Map((annotations?.origins||(operation?.action==='attach-origins'?operation.origins:[])||[]).map(row=>[row.id,row.instanceId])),origins=new Map(),tokens=new Map(),issues=[];
  for(const [id,node]of nodes){
   if(skip.has(id))continue;
   try{const ref=materialOrigin(node,source.meta.engine);if(!ref)continue;origins.set(id,ref);const ids=tokens.get(ref.instanceId)||[];ids.push(id);tokens.set(ref.instanceId,ids);}
   catch(error){issues.push({nativeId:id,error:error.message});}
  }
  const materials=new Map();
  const getAsset=async id=>{if(!materials.has(id))materials.set(id,await this.asset(id));return materials.get(id);};
  const historical=new Map();let versionReceipts;
  const versions=async()=>versionReceipts||=(await this.sources.versions(sourceId)).slice(0,20000);
  const receiptHistory=async instance=>{
   if(historical.has(instance.id))return historical.get(instance.id);
   const states=[...(instance.bindingHistory||[])];
   for(const version of await versions()){
    const op=version.operation;
    if(op?.action!=='apply-instance'||op.instanceId!==instance.id||String(op.nativeId)!==instance.nativeId)continue;
    const old=await this.sources.read(sourceId,op.baseRevision),node=nativeNodes(old.bytes,old.meta.engine).get(instance.nativeId);if(!node)continue;
    let ref;try{ref=materialOrigin(node,old.meta.engine);}catch{continue;}
    const state={assetId:op.previousAssetId,sourceRevision:op.baseRevision,nativeNodeHash:digest(Buffer.from(JSON.stringify(node))),...(ref?{originToken:ref.instanceId}:{})};
    if(!states.some(old=>old.assetId===state.assetId&&old.originToken===state.originToken&&old.nativeNodeHash===state.nativeNodeHash))states.push(state);
   }
   historical.set(instance.id,states.slice(-32));return historical.get(instance.id);
  };
  let changed=0;
  const moveBinding=(instance,assetId,originToken,node,historyState)=>{
   const previous=bindingState(instance,null,instance.boundAtRevision),next={...instance,assetId,boundAtRevision:sourceRevision,nativeNodeHash:digest(Buffer.from(JSON.stringify(node))),bindingHistory:rememberBinding(instance,previous)};
   if(originToken)next.originToken=originToken;else delete next.originToken;
   const desired=historyState&&historyState.linkEpoch===instance.linkEpoch?historyState.linkId:instance.linkId;
   if(instance.linkId){const link=value.links[instance.linkId];if(link.pendingUpdate)throw new SafetyError('关联组正在更新，来源历史尚不能改写',409);link.instanceIds=link.instanceIds.filter(id=>id!==instance.id);}
   delete next.linkId;
   const link=desired&&value.links?.[desired];
   if(link&&!link.pendingUpdate&&link.assetId===assetId&&link.instanceIds.length<100){next.linkId=desired;if(!link.instanceIds.includes(instance.id))link.instanceIds.push(instance.id);}
   value.instances[instance.id]=next;changed++;
  };
  for(const [id,ref]of origins){
   if(ref.projectId!==value.id||tokens.get(ref.instanceId).length!==1||!supportsNativeOrigin(value.assets[ref.assetId],source.meta.engine)){issues.push({nativeId:id,error:'来源不属于本项目或原生身份重复'});continue;}
   const node=nodes.get(id),asset=await getAsset(ref.assetId);
   try{verifyNativeMaterial(source.bytes,node,source.meta.engine,asset.asset);}catch{issues.push({nativeId:id,error:'来源声明与实际原文或图片不符'});continue;}
   const known=Object.values(value.instances).filter(i=>i.sourceId===sourceId&&i.nativeId===id&&(i.originToken===ref.instanceId||trusted.get(id)===i.id));
   if(!known.length){
    const candidates=Object.values(value.instances).filter(i=>i.sourceId===sourceId&&i.nativeId===id);
    for(const instance of candidates)if((await receiptHistory(instance)).some(state=>state.originToken===ref.instanceId))known.push(instance);
    if(!known.length&&candidates.length){
     for(const version of await versions()){
      if(version.operation?.action!=='attach-origins')continue;
      const row=version.operation.origins.find(row=>String(row.id)===id&&candidates.some(i=>i.id===row.instanceId));if(!row)continue;
      const actual=await this.sources.read(sourceId,version.revision),oldNode=nativeNodes(actual.bytes,actual.meta.engine).get(id);
      if(oldNode&&materialOrigin(oldNode,actual.meta.engine)?.instanceId===ref.instanceId){known.push(value.instances[row.instanceId]);break;}
     }
    }
   }
   if(known.length===1){const instance=known[0];if(instance.assetId!==ref.assetId||instance.originToken!==ref.instanceId){const state=(await receiptHistory(instance)).findLast(s=>s.assetId===ref.assetId&&s.originToken===ref.instanceId);moveBinding(instance,ref.assetId,ref.instanceId,node,state);}continue;}
   if(known.length>1){issues.push({nativeId:id,error:'多个关系记录声称同一原生身份'});continue;}
   const useId=originInstanceId(value.id,sourceId,ref.instanceId,digest),existing=value.instances[useId];
   if(existing){issues.push({nativeId:id,error:'原生来源身份冲突，未覆盖已有记录'});continue;}
   value.instances[useId]={id:useId,assetId:ref.assetId,sourceId,nativeId:id,originToken:ref.instanceId,boundAtRevision:sourceRevision,nativeNodeHash:digest(Buffer.from(JSON.stringify(node))),origin:'native-copy',...(node.layoutPage?{nativePage:node.layoutPage}:{}),at:new Date().toISOString()};changed++;
  }
  // A first upgraded native edit can undo to its marker-free legacy snapshot.
  // Only an exact known node from that same use's committed history qualifies.
  for(const instance of Object.values(value.instances)){
   if(instance.sourceId!==sourceId||skip.has(instance.nativeId)||origins.has(instance.nativeId))continue;
   const node=nodes.get(instance.nativeId);if(!node)continue;
   const nodeHash=digest(Buffer.from(JSON.stringify(node))),history=await receiptHistory(instance),matches=[];
   for(const state of history)if(!state.originToken&&state.nativeNodeHash===nodeHash){
    const asset=await getAsset(state.assetId);
    try{
     if(source.meta.engine==='vectorcraft'&&asset.asset.format==='svg'&&node.kind?.type==='group'&&instance.legacyPlacementRevision){
      const bound=await this.sources.read(sourceId,instance.legacyPlacementRevision),boundNode=nativeNodes(bound.bytes,'vectorcraft').get(instance.nativeId);
      const binding={...instance,assetId:state.assetId,boundAtRevision:instance.legacyPlacementRevision,nativeNodeHash:state.nativeNodeHash};delete binding.originToken;
      verifyLegacyVectorBinding({binding,receipt:bound.meta.operation,boundRevision:bound.revision,boundNode,currentNode:node,asset:asset.asset,instances:value.instances});
     }else verifyNativeMaterial(source.bytes,node,source.meta.engine,asset.asset);
     matches.push(state);
    }catch{}
   }
   const unique=new Set(matches.map(state=>state.assetId));
   if(unique.size===1){const state=matches.at(-1);if(instance.assetId!==state.assetId||instance.originToken)moveBinding(instance,state.assetId,undefined,node,state);}
  }
  if(!changed)return {changed:0,issues,revision:current.revision};
  const next=await this.change(current.revision,target=>{target.instances=value.instances;target.links=value.links;});return {changed,issues,revision:next.revision};
 }
 async inspect(){
  const current=await this.read(),sources=await this.sources.list(),heads=new Map(sources.filter(source=>!source.error).map(source=>[source.id,source])),nodes=new Map(),instances=[];
  for(const instance of Object.values(current.manifest.instances)){
   try{
    if(!nodes.has(instance.sourceId)){const source=await this.sources.read(instance.sourceId);nodes.set(instance.sourceId,nativeNodes(source.bytes,source.meta.engine));}
    const node=nodes.get(instance.sourceId).get(instance.nativeId);let replaced=false;
    if(node&&instance.originToken){const ref=materialOrigin(node,heads.get(instance.sourceId)?.engine);replaced=!ref||ref.instanceId!==instance.originToken;}
    instances.push({...instance,status:node?(replaced?'replaced':'present'):'missing',currentSourceRevision:heads.get(instance.sourceId)?.revision||null,nativeObject:node&&!replaced?{id:node.id,name:node.name||null,kind:node.kind?.type,...(node.hidden?{hidden:true}:{}),...(node.layoutPage?{page:node.layoutPage}:{})}:null,changedSincePlacement:node?digest(Buffer.from(JSON.stringify(node)))!==instance.nativeNodeHash:null});
   }catch(error){instances.push({...instance,status:'unavailable',error:String(error.message||error)});}
  }
  return {id:current.manifest.id,revision:current.revision,sources,assets:Object.values(current.manifest.assets),instances,edits:Object.values(current.manifest.edits||{}),links:Object.values(current.manifest.links||{}),updates:Object.values(current.manifest.updates||{})};
 }
}
