/** Read only real native Deck metadata/selected media; never decode unrelated picture payloads. */
import {readZip} from './zip.js';
import {assertSafeJson,SafetyError} from './safety.js';
import {normalizeMaterialOrigin} from './material-origin.js';
import {createHash} from 'node:crypto';
import {sameCoordinate} from './material-layout.js';
const options={maxEntries:20000,maxEntryBytes:64*1024*1024,maxTotalBytes:256*1024*1024};
const id=value=>Number.isSafeInteger(value)&&value>=0&&value<=0xffffffff;
function selected(bytes,name,maximum){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>256*1024*1024)throw new SafetyError('原生演示源为空或超过预算',413);
 try{const found=readZip(bytes,{...options,includeNames:[name],maxSelectedBytes:maximum}).find(entry=>entry.name===name);if(!found)throw new Error('missing native member');return found.data;}
 catch(error){throw new SafetyError('无法读取受限原生演示成员：'+String(error.message||error),422);}
}
export function nativeDeckDocument(bytes){
 let manifest;try{manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(selected(bytes,'presentation.json',8*1024*1024)));}catch(error){if(error instanceof SafetyError)throw error;throw new SafetyError('原生演示 JSON 无效',422);}
 assertSafeJson(manifest);const doc=manifest.presentation;
 if(manifest.format!=='deckcraft'||manifest.version!==1||!Array.isArray(doc?.slides)||doc.slides.length>100||!Array.isArray(doc.masters))throw new SafetyError('该演示源结构尚未支持',422);
 return doc;
}
export function nativeDeckNodes(bytes){return deckNodes(nativeDeckDocument(bytes));}
function deckNodes(doc,includePage=true){
 const nodes=new Map();let count=0;
 const walk=(items,page,depth=0)=>{
  if(!Array.isArray(items)||depth>64)throw new SafetyError('原生演示层级无效或过深',413);
  for(const item of items){if(++count>20000||!id(item.id)||nodes.has(String(item.id)))throw new SafetyError('原生演示对象过多或身份重复/无效',422);
   nodes.set(String(item.id),includePage?{...item,layoutPage:page}:item);if(item.kind?.type==='group')walk(item.kind.children,page,depth+1);
  }
 };
 for(const [index,slide]of doc.slides.entries()){if(!id(slide.id))throw new SafetyError('原生幻灯片身份无效',422);walk(slide.shapes,{kind:'slide',id:slide.id,index});}
 for(const [index,master]of doc.masters.entries()){
  walk(master.shapes,{kind:'master',id:master.id,index});
  for(const [layoutIndex,layout]of (master.layouts||[]).entries())walk(layout.shapes,{kind:'layout',id:layout.id,masterId:master.id,index:layoutIndex});
 }
 for(const [name,master]of [['notesMaster',doc.notesMaster],['handoutMaster',doc.handoutMaster]])if(master)walk(master.shapes,{kind:name,id:master.id});
 return nodes;
}
export function assertDeckContentOnly(beforeBytes,afterBytes,nativeIds,expectedOrigin,frames={}){
 if(!Array.isArray(nativeIds)||!nativeIds.length||nativeIds.length>100)throw new SafetyError('图片内容核对目标无效',422);
 const before=nativeDeckDocument(beforeBytes),after=nativeDeckDocument(afterBytes),old=deckNodes(before,false),nodes=deckNodes(after,false),allowedNewMedia=new Set();
 for(const nativeId of nativeIds){
  const previous=old.get(String(nativeId)),next=nodes.get(String(nativeId));
  if(previous?.kind?.type!=='picture'||next?.kind?.type!=='picture')throw new SafetyError('图片原位身份不存在',409);
  const chosen=frames[String(nativeId)]?.bounds;
  if(chosen){
   for(const field of ['x','y','w','h']){
    if(!sameCoordinate(next.xfrm?.[field],chosen[field]))throw new SafetyError('演示图片回写没有保留指定锚点',409);
    next.xfrm[field]=previous.xfrm[field];
   }
  }
  if(!id(next.kind.fill.media))throw new SafetyError('回写预览媒体身份无效',409);allowedNewMedia.add('media/'+next.kind.fill.media);
  if(next.kind.fill.svgSource!=null){if(!id(next.kind.fill.svgSource))throw new SafetyError('回写 SVG 媒体身份无效',409);allowedNewMedia.add('media/'+next.kind.fill.svgSource);}
  if(next.kind.fill.artistic?.original!=null){if(!id(next.kind.fill.artistic.original))throw new SafetyError('回写艺术效果媒体身份无效',409);allowedNewMedia.add('media/'+next.kind.fill.artistic.original);}
  normalizeMaterialOrigin(previous,next,'deckcraft',expectedOrigin?.byNativeId?.[String(nativeId)]||expectedOrigin);
  if(previous.kind.fill.svgSource!=null||next.kind.fill.svgSource!=null){
   // An SVG update keeps both original SVG and raster preview. A PNG update
   // cannot quietly add/remove this source reference.
   nativeDeckSvg(beforeBytes,previous);nativeDeckSvg(afterBytes,next);
   next.kind.fill.svgSource=previous.kind.fill.svgSource;
  }
  next.kind.fill.media=previous.kind.fill.media;
  if(previous.kind.fill.artistic&&next.kind.fill.artistic)next.kind.fill.artistic.original=previous.kind.fill.artistic.original;
 }
 if(!Number.isSafeInteger(after.nextId)||after.nextId<before.nextId)throw new SafetyError('原位更新的原生身份分配异常',409);
 for(const [id,media]of Object.entries(before.media))if(JSON.stringify(after.media[id])!==JSON.stringify(media))throw new SafetyError('原位更新改变了已有媒体记录',409);
 const entries=bytes=>{try{return readZip(bytes,{maxEntries:20000,maxEntryBytes:256*1024*1024,maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024});}catch(error){throw new SafetyError('无法核对原生演示附件：'+String(error.message||error),422);}};
 const hashes=bytes=>new Map(entries(bytes).filter(entry=>entry.name!=='presentation.json').map(entry=>[entry.name,createHash('sha256').update(entry.data).digest('hex')]));
 const prior=hashes(beforeBytes),saved=hashes(afterBytes);
 for(const [name,digest]of prior)if(saved.get(name)!==digest)throw new SafetyError('原位更新改变了其他媒体或附加数据',409);
 for(const name of saved.keys())if(!prior.has(name)&&!allowedNewMedia.has(name))throw new SafetyError('原位更新增加了无关媒体或附加数据',409);
 after.media=before.media;after.nextId=before.nextId;
 if(JSON.stringify(after)!==JSON.stringify(before))throw new SafetyError('原位更新改变了图片内容之外的演示属性',409);
}
export function nativeDeckPicture(bytes,node){
 const fill=node.kind?.type==='picture'&&node.kind.fill;
 const media=fill?.artistic?.original??fill?.media;
 if(!id(media))throw new SafetyError('已保存对象不是可核对的实际原生图片',409);
 return selected(bytes,'media/'+media,4*1024*1024);
}
export function nativeDeckSvg(bytes,node){
 const fill=node.kind?.type==='picture'&&node.kind.fill,source=fill?.svgSource;if(!id(source))throw new SafetyError('已保存对象没有实际 SVG 原文',409);
 const doc=nativeDeckDocument(bytes),media=Array.isArray(doc.media)?doc.media.find(m=>m.id===source):Object.values(doc.media||{}).find(m=>m.id===source);
 if(!media||media.contentType!=='image/svg+xml'||media.link!=null)throw new SafetyError('SVG 原文不是已嵌入的 SVG 媒体',409);
 const bytesSvg=selected(bytes,'media/'+source,4*1024*1024);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytesSvg);}catch{throw new SafetyError('SVG 原文编码无效',422);}
 if(!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text))throw new SafetyError('媒体原文不是 SVG',422);
 return bytesSvg;
}
