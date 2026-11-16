/** VectorCraft v1-v4 native inspection. V4 keeps large opaque images after the JSON header. */
import {decodeNativeJson,isUint64} from '../client/native-protocol.js';
import {createHash} from 'node:crypto';
import {SafetyError} from './safety.js';
import {materialOrigin,normalizeMaterialOrigin} from './material-origin.js';
import {canonicalLegacyKind} from './native-vector-legacy.js';
import {sameCoordinate} from './material-layout.js';
const BLOB_MAGIC=Buffer.from([10,0,86,67,66,76,79,66,83,0]);
export function nativeVectorHeader(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>256*1024*1024)throw new SafetyError('原生矢量源为空或超过预算',413);
 const at=bytes.indexOf(BLOB_MAGIC),header=at<0?bytes:bytes.subarray(0,at),blobs=at<0?Buffer.alloc(0):bytes.subarray(at+BLOB_MAGIC.length);
 let value;try{value=decodeNativeJson(new TextDecoder('utf-8',{fatal:true}).decode(header));}catch{throw new SafetyError('原生矢量 JSON 头无效',422);}
 if(value.format!=='vectorcraft'||!Array.isArray(value.document?.layers)||at>=0&&value.version!==4)throw new SafetyError('原生矢量格式或附加区版本不支持',422);
 for(const image of Object.values(value.images||{})){
  if(image.blob!==undefined){const range=image.blob;
   if(at<0||!Array.isArray(range)||range.length!==2||!range.every(Number.isSafeInteger)||range[0]<0||range[1]<0||range[0]>blobs.length||range[1]>blobs.length-range[0])throw new SafetyError('原生图片附加区范围无效',422);
  }
 }
 // No image payload is decoded, projected, reserialized or discarded here.
 return value;
}
/** Only actual embedded bytes, never an external-link preview or inferred asset. */
export function nativeVectorImage(bytes,node){
 const file=nativeVectorHeader(bytes),kind=node?.kind,image=kind?.type==='image'&&typeof kind.key==='string'&&file.images?.[kind.key];
 if(!image||kind.link||image.proxy)throw new SafetyError('已保存对象不是可核对的实际嵌入图片',409);
 return imageBytes(bytes,image,4*1024*1024);
}
/** Read the actual self-contained native vector source, not a preview. */
export function nativeVectorEmbedded(bytes,node){
 const file=nativeVectorHeader(bytes),kind=node?.kind;
 if(kind?.type!=='placeddocument'||kind.embedded!==true||kind.link?.path!==''||Object.keys(kind.link||{}).some(k=>k!=='path')||typeof kind.key!=='string')throw new SafetyError('该海报对象不是自包含矢量源',409);
 if(!Number.isFinite(kind.width)||kind.width<=0||!Number.isFinite(kind.height)||kind.height<=0||!Array.isArray(kind.xf)||kind.xf.length!==6||kind.xf.some(v=>!Number.isFinite(v))||Math.abs(kind.xf[0]*kind.xf[3]-kind.xf[1]*kind.xf[2])<=1e-12)throw new SafetyError('海报矢量实例的物理边框无效',409);
 const entry=file.images?.[kind.key];if(!entry||entry.mime!=='application/json'||entry.proxy)throw new SafetyError('海报矢量源缺失或仅有预览',409);
 const source=imageBytes(bytes,entry,4*1024*1024),expected='dsh-native-'+createHash('sha256').update(source).digest('hex');
 if(source[0]===0x1f&&source[1]===0x8b)throw new SafetyError('不支持直接嵌入压缩矢量源',422);
 if(kind.key!==expected)throw new SafetyError('海报矢量源身份与实际内容不一致',409);
 return source;
}
function imageBytes(bytes,image,maximum){
 let result;
 if(image.blob!==undefined){
  const [offset,length]=image.blob;if(!length||length>maximum)throw new SafetyError('选定原生图片为空或超过4MiB预算',413);
  const start=bytes.indexOf(BLOB_MAGIC)+BLOB_MAGIC.length;result=bytes.subarray(start+offset,start+offset+length);
 }else{
  if(typeof image.data!=='string'||image.data.length>Math.ceil(maximum/3)*4)throw new SafetyError('原生内嵌图片编码无效或超过预算',413);
  result=Buffer.from(image.data,'base64');if(result.toString('base64')!==image.data)throw new SafetyError('原生内嵌图片不是规范 Base64',422);
 }
 if(!result.length||result.length>maximum)throw new SafetyError('原生图片为空或超过4MiB预算',413);
 return result;
}
function vectorNodes(file){
 const nodes=new Map();let count=0;
 const walk=(items,depth=0)=>{
  if(!Array.isArray(items)||depth>64)throw new SafetyError('原生矢量层级无效或过深',413);
  for(const node of items){
   if(++count>100000||!isUint64(node.id)||nodes.has(String(node.id)))throw new SafetyError('原生矢量对象身份无效或重复',422);
   nodes.set(String(node.id),node);if(node.kind?.children)walk(node.kind.children,depth+1);
  }
 };walk(file.document.layers);return nodes;
}
/** A content-only native replacement may change pixel coordinates, never its
 * document-space frame. The saved serializer may discard now-unused blobs. */
export function assertVectorImageContentOnly(beforeBytes,afterBytes,nativeIds,expectedOrigin,frames={}){
 if(!Array.isArray(nativeIds)||!nativeIds.length||nativeIds.length>100||nativeIds.some(id=>!isUint64(id))||new Set(nativeIds.map(String)).size!==nativeIds.length)throw new SafetyError('海报图片核对目标无效',422);
 const before=nativeVectorHeader(beforeBytes),after=nativeVectorHeader(afterBytes),old=vectorNodes(before),nodes=vectorNodes(after),replacedKeys=new Set();
 const targets=new Set(nativeIds.map(String)),referencedOutsideTargets=new Set();let referenceCount=0;
 const references=(value,depth=0)=>{
  if(++referenceCount>2000000||depth>64)throw new SafetyError('海报原生引用核对超过预算',413);
  if(typeof value==='string'){referencedOutsideTargets.add(value);return;}
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const item of value)references(item,depth+1);return;}
  const target=(typeof value.id==='string'||typeof value.id==='number')&&targets.has(String(value.id))&&value.kind?.type==='image';
  for(const [key,item]of Object.entries(value)){
   if(target&&key==='kind'){for(const [field,entry]of Object.entries(item))if(field!=='key')references(entry,depth+1);}
   else references(item,depth+1);
  }
 };references(after.document);
 for(const id of nativeIds){
  const previous=old.get(String(id)),next=nodes.get(String(id));nativeVectorImage(beforeBytes,previous);nativeVectorImage(afterBytes,next);
  normalizeMaterialOrigin(previous,next,'vectorcraft',expectedOrigin?.byNativeId?.[String(id)]||expectedOrigin);
  const a=previous.kind,b=next.kind;
  for(const kind of [a,b])if(!Number.isSafeInteger(kind.width)||!Number.isSafeInteger(kind.height)||kind.width<1||kind.height<1||!Array.isArray(kind.xf)||kind.xf.length!==6||kind.xf.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw new SafetyError('海报原生图片像素坐标无效',409);
  const rx=a.width/b.width,ry=a.height/b.height,expected=[a.xf[0]*rx,a.xf[1]*rx,a.xf[2]*ry,a.xf[3]*ry,a.xf[4],a.xf[5]];
  const chosen=frames[String(id)]?.xf;
  if(b.xf.some((value,index)=>chosen?!sameCoordinate(value,chosen[index]):Math.abs(value-expected[index])>1e-12*Math.max(1,Math.abs(expected[index]))))throw new SafetyError('海报回写改变了图片的物理边框',409);
  replacedKeys.add(a.key);Object.assign(b,{key:a.key,width:a.width,height:a.height,xf:a.xf});
 }
 // Check old blobs by bytes; v4 offsets legitimately move when a blob is added.
 // References were captured before normalization, excluding only target keys.
 for(const [key,image]of Object.entries(before.images||{})){
  const next=after.images?.[key];
  if(!next){if(replacedKeys.has(key)&&!referencedOutsideTargets.has(key))continue;throw new SafetyError('海报回写丢失了其他图片数据',409);}
  if(image.mime!==next.mime||!!image.proxy!==!!next.proxy||!imageBytes(beforeBytes,image,256*1024*1024).equals(imageBytes(afterBytes,next,256*1024*1024)))throw new SafetyError('海报回写改变了已有图片数据',409);
 }
 after.images=before.images;
 if(JSON.stringify(after)!==JSON.stringify(before))throw new SafetyError('海报回写改变了图片内容之外的原生属性',409);
}

/** Only the embedded source key and authorized material identity may change. */
export function assertVectorEmbeddedContentOnly(beforeBytes,afterBytes,nativeIds,expectedOrigin,frames={}){
 if(!Array.isArray(nativeIds)||!nativeIds.length||nativeIds.length>100||nativeIds.some(id=>!isUint64(id))||new Set(nativeIds.map(String)).size!==nativeIds.length)throw new SafetyError('海报矢量实例核对目标无效',422);
 const before=nativeVectorHeader(beforeBytes),after=nativeVectorHeader(afterBytes),old=vectorNodes(before),nodes=vectorNodes(after),targets=new Set(nativeIds.map(String)),replacedKeys=new Set(),newKeys=new Set(),referenced=new Set();let count=0;
 const collect=(value,depth=0)=>{
  if(++count>2000000||depth>64)throw new SafetyError('海报原生引用核对超过预算',413);
  if(typeof value==='string'){referenced.add(value);return;}
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value)){for(const item of value)collect(item,depth+1);return;}
  const target=(typeof value.id==='string'||typeof value.id==='number')&&targets.has(String(value.id))&&value.kind?.type==='placeddocument';
  for(const [key,item]of Object.entries(value)){
   if(target&&key==='kind'){for(const [field,entry]of Object.entries(item))if(field!=='key')collect(entry,depth+1);}
   else collect(item,depth+1);
  }
 };collect(after.document);
 for(const id of nativeIds){
  const previous=old.get(String(id)),next=nodes.get(String(id));nativeVectorEmbedded(beforeBytes,previous);nativeVectorEmbedded(afterBytes,next);
  const chosen=frames[String(id)]?.xf;
  if(chosen){
   if(next.kind.xf.some((value,i)=>!sameCoordinate(value,chosen[i])))throw new SafetyError('矢量源回写没有保留指定锚点',409);
   next.kind.xf=previous.kind.xf;
  }
  normalizeMaterialOrigin(previous,next,'vectorcraft',expectedOrigin?.byNativeId?.[String(id)]||expectedOrigin);
  replacedKeys.add(previous.kind.key);newKeys.add(next.kind.key);next.kind.key=previous.kind.key;
 }
 for(const key of Object.keys(after.images||{}))if(!Object.hasOwn(before.images||{},key)&&!newKeys.has(key))throw new SafetyError('海报回写增加了无关源或图片数据',409);
 for(const [key,image]of Object.entries(before.images||{})){
  const next=after.images?.[key];
  if(!next){if(replacedKeys.has(key)&&!referenced.has(key))continue;throw new SafetyError('海报回写丢失了其他源或图片数据',409);}
  if(image.mime!==next.mime||!!image.proxy!==!!next.proxy||!imageBytes(beforeBytes,image,256*1024*1024).equals(imageBytes(afterBytes,next,256*1024*1024)))throw new SafetyError('海报回写改变了已有源或图片数据',409);
 }
 after.images=before.images;
 if(JSON.stringify(after)!==JSON.stringify(before))throw new SafetyError('海报回写改变了内容之外的布局或对象属性',409);
}

/** For a separately authenticated legacy group, allow only its kind to become
 * an embedded source and its authorized origin to be added. */
export function assertVectorLegacyContentOnly(beforeBytes,afterBytes,nativeId,expectedOrigin,expectedKind){
 if(!isUint64(nativeId)||!expectedOrigin||!expectedKind||typeof expectedKind!=='object'||Array.isArray(expectedKind))throw new SafetyError('旧 SVG 回写目标或原生边框凭据无效',422);
 const before=nativeVectorHeader(beforeBytes),after=nativeVectorHeader(afterBytes);
 const previous=vectorNodes(before).get(String(nativeId)),next=vectorNodes(after).get(String(nativeId));
 if(previous?.kind?.type!=='group'||!next)throw new SafetyError('旧 SVG 原始组或回写对象不存在',409);
 nativeVectorEmbedded(afterBytes,next);
 if(canonicalLegacyKind(next.kind)!==canonicalLegacyKind(expectedKind))throw new SafetyError('旧 SVG 回写的原生内容边框与验证结果不一致',409);
 for(const key of Object.keys(after.images||{}))if(!Object.hasOwn(before.images||{},key)&&key!==next.kind.key)throw new SafetyError('旧 SVG 回写增加了无关图片或源数据',409);
 const origin=materialOrigin(next,'vectorcraft');
 if(!origin||origin.projectId!==expectedOrigin.projectId||origin.assetId!==expectedOrigin.assetId)throw new SafetyError('旧 SVG 回写缺少本次素材来源',409);
 normalizeMaterialOrigin(previous,next,'vectorcraft',expectedOrigin);
 next.kind=previous.kind;
 for(const [key,image]of Object.entries(before.images||{})){
  const saved=after.images?.[key];
  if(!saved||image.mime!==saved.mime||!!image.proxy!==!!saved.proxy||!imageBytes(beforeBytes,image,256*1024*1024).equals(imageBytes(afterBytes,saved,256*1024*1024)))throw new SafetyError('旧 SVG 回写改变了其他源或图片数据',409);
 }
 after.images=before.images;
 if(JSON.stringify(after)!==JSON.stringify(before))throw new SafetyError('旧 SVG 回写改变了其他布局或对象属性',409);
}
