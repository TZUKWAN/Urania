/** Native text identities are distinct from font values and authorization. */
import {createHash} from 'node:crypto';
import {nativeVectorHeader} from './native-vector-header.js';
import {nativeDeckNodes} from './native-deck-header.js';
import {readZip} from './zip.js';
import {isUint64} from '../client/native-protocol.js';
import {SafetyError} from './safety.js';

const TAG='DSH-BRAND-FONT-V1',token=/^[a-f0-9]{32}$/,binding=/^brandfont-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const project=value=>typeof value==='string'&&/^project-[A-Za-z0-9_-]{1,73}$/.test(value);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function marker(data){
 if(data!==undefined&&!Array.isArray(data))throw new SafetyError('文字身份标记容器无效',409);
 const rows=(data||[]).filter(row=>Array.isArray(row)&&typeof row[0]==='string'&&row[0].toUpperCase()===TAG);
 if(!rows.length)return null;
 if(rows.length!==1||typeof rows[0][1]!=='string'||rows[0][1].length>1024)throw new SafetyError('文字身份标记重复或无效',409);
 let value;try{value=JSON.parse(rows[0][1]);}catch{throw new SafetyError('文字身份标记损坏',409);}
 if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(Object.keys(value).sort())!==JSON.stringify(['bindingId','instanceId','projectId','schema'])||value.schema!==1||!project(value.projectId)||!binding.test(value.bindingId||'')||!token.test(value.instanceId||''))throw new SafetyError('文字身份标记不完整',409);
 return value;
}
function vectorNodes(doc){
 const nodes=new Map();let count=0;
 const walk=(items,depth=0)=>{if(!Array.isArray(items)||depth>64)throw new SafetyError('海报文字层级无效',422);for(const node of items){
  if(++count>100000||!isUint64(node.id)||nodes.has(String(node.id)))throw new SafetyError('海报对象身份无效或重复',422);
  nodes.set(String(node.id),node);if(node.kind?.children)walk(node.kind.children,depth+1);
 }};walk(doc.layers);return nodes;
}
export function fontOrigins(bytes,engine){
 const nodes=engine==='vectorcraft'?vectorNodes(nativeVectorHeader(bytes).document):engine==='deckcraft'?nativeDeckNodes(bytes):null;
 if(!nodes)throw new SafetyError('该引擎尚未接入字体身份',422);
 const origins=new Map(),tokens=new Set(),bindings=new Set();
 for(const [id,node] of nodes){
  const value=marker(engine==='vectorcraft'?node.attrs?.data:node.tags);if(!value)continue;
  if(tokens.has(value.instanceId)||bindings.has(value.bindingId))throw new SafetyError('字体身份发生重复，不能自动更新',409);
  tokens.add(value.instanceId);bindings.add(value.bindingId);origins.set(id,value);
 }
 return origins;
}
const zip=bytes=>readZip(bytes,{maxEntries:20000,maxEntryBytes:256*1024*1024,maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024});
function deckNode(doc,id){
 let found=null;const walk=nodes=>{for(const node of nodes||[]){if(String(node.id)===String(id)){if(found)throw new SafetyError('文字对象身份重复',409);found=node;}if(node.kind?.type==='group')walk(node.kind.children);}};
 for(const slide of doc.presentation.slides)walk(slide.shapes);return found;
}
/** Only the explicit identity may differ; every other saved field stays exact. */
export function assertFontAssignmentOnly(beforeBytes,afterBytes,engine,nativeId,expected){
 if(!isUint64(nativeId)||!project(expected?.projectId)||!binding.test(expected?.bindingId||'')||!token.test(expected?.instanceId||''))throw new SafetyError('字体身份核对参数无效',422);
 const old=fontOrigins(beforeBytes,engine),next=fontOrigins(afterBytes,engine),actual=next.get(String(nativeId));
 if(old.has(String(nativeId))||!actual||actual.projectId!==expected.projectId||actual.bindingId!==expected.bindingId||actual.instanceId!==expected.instanceId)throw new SafetyError('字体身份与绑定请求不一致',409);
 let before,after,priorEntries,nextEntries,previous,current;
 if(engine==='vectorcraft'){
  before=nativeVectorHeader(beforeBytes);after=nativeVectorHeader(afterBytes);
  previous=vectorNodes(before.document).get(String(nativeId));current=vectorNodes(after.document).get(String(nativeId));
 }else{
  priorEntries=zip(beforeBytes);nextEntries=zip(afterBytes);
  before=JSON.parse(priorEntries.find(item=>item.name==='presentation.json').data);after=JSON.parse(nextEntries.find(item=>item.name==='presentation.json').data);
  previous=deckNode(before,nativeId);current=deckNode(after,nativeId);
 }
 if(!previous||!current)throw new SafetyError('待绑定文字已不存在',409);
 const oldData=engine==='vectorcraft'?previous.attrs?.data:previous.tags,newData=engine==='vectorcraft'?current.attrs?.data:current.tags;
 const without=(newData||[]).filter(row=>!Array.isArray(row)||typeof row[0]!=='string'||row[0].toUpperCase()!==TAG);
 if(JSON.stringify(without)!==JSON.stringify(oldData||[]))throw new SafetyError('字体身份改变了其他原生标记',409);
 if(engine==='vectorcraft'){
  if(previous.attrs&&Object.hasOwn(previous.attrs,'data'))current.attrs.data=previous.attrs.data;else if(current.attrs)delete current.attrs.data;
  if(!previous.attrs&&current.attrs&&Object.keys(current.attrs).length===0)delete current.attrs;
  const magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]),a=beforeBytes.indexOf(magic),b=afterBytes.indexOf(magic);
  if((a<0)!==(b<0)||a>=0&&!beforeBytes.subarray(a).equals(afterBytes.subarray(b))||JSON.stringify(before)!==JSON.stringify(after))throw new SafetyError('字体身份改变了其他海报内容',409);
 }else{
  if(Object.hasOwn(previous,'tags'))current.tags=previous.tags;else delete current.tags;
  const hashes=entries=>new Map(entries.filter(item=>item.name!=='presentation.json').map(item=>[item.name,digest(item.data)])),a=hashes(priorEntries),b=hashes(nextEntries);
  if(a.size!==b.size||[...a].some(([name,value])=>b.get(name)!==value)||JSON.stringify(before)!==JSON.stringify(after))throw new SafetyError('字体身份改变了其他演示内容',409);
 }
 return actual;
}
