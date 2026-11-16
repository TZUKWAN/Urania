/** Verify actual Deck conversion output without changing or extracting files. */
import {createHash} from 'node:crypto';
import {assertSafeJson,SafetyError} from './safety.js';
import {readZip} from './zip.js';
import {nativeDeckDocument,nativeDeckNodes,nativeDeckPicture,nativeDeckSvg} from './native-deck-header.js';

const validId=value=>Number.isSafeInteger(value)&&value>=1&&value<=0xffffffff;
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
export function validateConvertedShapes(originalId,shapes){
 assertSafeJson(shapes);
 if(!validId(originalId)||!Array.isArray(shapes)||!shapes.length||shapes.length>512||Buffer.byteLength(JSON.stringify(shapes))>1024*1024)throw new SafetyError('SVG 转换对象或回执超过预算',422);
 const ids=new Set();
 for(const shape of shapes){
  if(!shape||!validId(shape.id)||shape.id===originalId||ids.has(shape.id)||shape.kind?.type!=='shape'||shape.hidden||shape.locked||shape.ph!=null||shape.effects!=null||shape.click!=null||shape.hover!=null||shape.rawExt!=null||shape.tags?.length)throw new SafetyError('SVG 转换结果包含无效或不安全的对象',409);
  if(shape.textBox){if(!shape.text||shape.geom?.kind!=='preset')throw new SafetyError('转换文字不是实际文本框',409);}
  else if(shape.geom?.kind!=='custom'||!Array.isArray(shape.geom.paths)||!shape.geom.paths.length||shape.text!=null)throw new SafetyError('转换图形不是实际可编辑路径',409);
  ids.add(shape.id);
 }
 return JSON.stringify(canonical(shapes));
}
function packageHashes(bytes){
 let entries;try{entries=readZip(bytes,{maxEntries:20000,maxEntryBytes:256*1024*1024,maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024});}
 catch(error){throw new SafetyError('无法核对原生演示附件：'+String(error.message||error),422);}
 return new Map(entries.filter(item=>item.name!=='presentation.json').map(item=>[item.name,createHash('sha256').update(item.data).digest('hex')]));
}
export function assertDeckSvgConversionOnly(beforeBytes,afterBytes,nativeId,nativeShapes){
 const id=typeof nativeId==='string'&&/^(0|[1-9]\d*)$/.test(nativeId)?Number(nativeId):nativeId;
 const expected=validateConvertedShapes(id,nativeShapes),before=nativeDeckDocument(beforeBytes),after=nativeDeckDocument(afterBytes),oldNodes=nativeDeckNodes(beforeBytes),newNodes=nativeDeckNodes(afterBytes);
 const old=oldNodes.get(String(id)),next=newNodes.get(String(id));
 if(old?.kind?.type!=='picture'||next?.kind?.type!=='picture'||old.hidden||!next.hidden)throw new SafetyError('原 SVG 图片未按要求保留并隐藏',409);
 if(!nativeDeckSvg(beforeBytes,old).equals(nativeDeckSvg(afterBytes,next))||!nativeDeckPicture(beforeBytes,old).equals(nativeDeckPicture(afterBytes,next)))throw new SafetyError('转换改变了原 SVG 或其预览',409);
 const matches=before.slides.map((slide,index)=>({slide,index,pos:slide.shapes.findIndex(shape=>shape.id===id)})).filter(row=>row.pos>=0);
 if(matches.length!==1)throw new SafetyError('SVG 转换仅支持当前幻灯片的顶层图片',409);
 const {index,pos}=matches[0],oldSlide=before.slides[index],newSlide=after.slides[index];
 if(!newSlide||newSlide.id!==oldSlide.id||newSlide.shapes[pos]?.id!==id)throw new SafetyError('SVG 原图片的幻灯片或层次已改变',409);
 const added=newSlide.shapes.slice(pos+1,pos+1+nativeShapes.length);
 if(JSON.stringify(canonical(added))!==expected)throw new SafetyError('已保存的可编辑对象与原生转换回执不一致',409);
 newSlide.shapes.splice(pos+1,nativeShapes.length);newSlide.shapes[pos].hidden=oldSlide.shapes[pos].hidden;
 if(!Number.isSafeInteger(before.nextId)||after.nextId!==before.nextId+nativeShapes.length)throw new SafetyError('转换后的原生对象身份分配异常',409);
 after.nextId=before.nextId;
 if(JSON.stringify(canonical(after))!==JSON.stringify(canonical(before)))throw new SafetyError('SVG 转换改变了其他演示内容',409);
 const left=packageHashes(beforeBytes),right=packageHashes(afterBytes);
 if(left.size!==right.size||[...left].some(([name,digest])=>right.get(name)!==digest))throw new SafetyError('SVG 转换改变了原有媒体或附加数据',409);
 return {originalId:id,ids:nativeShapes.map(shape=>shape.id)};
}
