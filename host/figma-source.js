/** Read-only Figma file/node sources for the owning DSH project. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,stat,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {previewImageSize} from './image-header.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';
import {validateStaticExternalSvg as safeSvg} from './static-external-svg.js';

const FILE=/^[A-Za-z0-9]{22,128}$/,NODE=/^(?:I)?\d+:\d+(?:;\d+:\d+)*$/,VERSION=/^[A-Za-z0-9._-]{1,128}$/;
const EXPORT=/^figmaexport-[a-f0-9]{64}$/,OPEN=/^figmaopen-[a-f0-9]{64}$/,LINK=/^figmalink-[a-f0-9]{64}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const exportId=value=>'figmaexport-'+sha(Buffer.from(JSON.stringify([value.fileKey,value.nodeId,value.version,value.format,value.outlineText,value.sha256])));
const openId=(exportId,operationId)=>'figmaopen-'+sha(Buffer.from(JSON.stringify([exportId,operationId])));
const linkId=value=>'figmalink-'+sha(Buffer.from(JSON.stringify([value.openId,value.sourceId,value.sourceRevision,value.jobId])));
const directory=root=>workspacePath(root,'design/.designcraft/figma-sources');
function pathFor(root,id){if(!EXPORT.test(id||'')&&!OPEN.test(id||'')&&!LINK.test(id||''))throw new SafetyError('Figma 来源身份无效',422);return workspacePath(root,join(directory(root),id+'.json'));}

export function parseFigmaReference(reference,nodeId){
 let fileKey,fromUrl;
 if(typeof reference!=='string'||reference.length>4000)throw new SafetyError('请输入 Figma 文件链接或文件键',422);
 if(FILE.test(reference))fileKey=reference;
 else{
  let url;try{url=new URL(reference);}catch{throw new SafetyError('Figma 链接无效',422);}
  if(url.protocol!=='https:'||!['www.figma.com','figma.com'].includes(url.hostname.toLowerCase())||url.username||url.password||url.port||url.hash)throw new SafetyError('只支持 Figma 官方 HTTPS 文件链接',422);
  const parts=url.pathname.split('/').filter(Boolean);if(parts.length<2||!['design','file','board','slides','deck','proto'].includes(parts[0])||!FILE.test(parts[1]))throw new SafetyError('Figma 文件链接格式无效',422);fileKey=parts[1];fromUrl=url.searchParams.get('node-id')||undefined;
 }
 const actual=nodeId||fromUrl;if(actual!==undefined){if(typeof actual!=='string'||actual.length>200)throw new SafetyError('Figma 节点身份无效',422);const normalized=actual.replace(/(\d)-(\d)/g,'$1:$2');if(!NODE.test(normalized))throw new SafetyError('Figma 节点身份无效',422);return {fileKey,nodeId:normalized};}
 return {fileKey};
}
async function bounded(response,limit){
 if(!response.body||Number(response.headers.get('content-length'))>limit)throw new SafetyError('Figma 响应为空或超过预算',502);const reader=response.body.getReader(),chunks=[];let size=0;
 while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>limit){await reader.cancel();throw new SafetyError('Figma 响应超过预算',413);}chunks.push(Buffer.from(item.value));}return Buffer.concat(chunks,size);
}
async function api(token,path,signal){
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,30000);
 try{
  const response=await fetch('https://api.figma.com/v1'+path,{headers:{'X-Figma-Token':token},signal:controller.signal,redirect:'error'});if(!response.ok){const error=new SafetyError('Figma 请求失败（HTTP '+response.status+'）',response.status===429?429:response.status===403?403:502);const retry=Number(response.headers.get('retry-after'));if(Number.isFinite(retry)&&retry>0)error.retryAfterSeconds=retry;throw error;}
  const raw=await bounded(response,8*1024*1024);let data;try{data=JSON.parse(raw.toString('utf8'));assertSafeJson(data);}catch{throw new SafetyError('Figma 返回的节点数据无效或超过结构预算',502);}if(!data||typeof data!=='object'||Array.isArray(data)||data.err)throw new SafetyError('Figma 未返回有效文件数据',502);return {data,rawHash:sha(raw)};
 }catch(error){if(signal?.aborted)throw new SafetyError('Figma 来源读取已停止',499);if(controller.signal.aborted)throw new SafetyError('Figma 来源请求超时',504);if(error instanceof SafetyError)throw error;throw new SafetyError('Figma 网络请求失败',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function safeSnapshot(value,secrets=[]){
 const hidden=secrets.filter(item=>typeof item==='string'&&item.length>0&&item.length<=8192);let nodes=0,redacted=false;const walk=(item,depth)=>{
  if(++nodes>100000||depth>50)throw new SafetyError('Figma 节点结构超过预算',413);
  if(typeof item==='string'){if(item.length>100000){item=item.slice(0,100000);redacted=true;}let clean=item.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"<>]+/gi,'[链接已隐藏]').replace(/(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|figd_[A-Za-z0-9_-]+/gi,'[已隐藏]');for(const secret of hidden)if(clean.includes(secret))clean=clean.split(secret).join('[已隐藏]');if(clean!==item)redacted=true;return clean;}
  if(item===null||typeof item==='boolean'||typeof item==='number')return item;
  if(Array.isArray(item))return item.map(child=>walk(child,depth+1));
  if(item&&typeof item==='object'){const out={};for(const [key,child]of Object.entries(item)){if(['__proto__','prototype','constructor'].includes(key))throw new SafetyError('Figma 数据包含不安全字段',422);const unsafe=/(?:[a-z][a-z0-9+.-]*:\/\/|^data:|figd_[A-Za-z0-9_-]+)/i.test(key)||hidden.some(secret=>key.includes(secret)),safeKey=unsafe?'[隐藏字段-'+sha(Buffer.from(key)).slice(0,16)+']':key;if(unsafe)redacted=true;if(/^(?:authorization|access_token|api_key|thumbnailUrl)$/i.test(key)){out[safeKey]='[已隐藏]';redacted=true;}else out[safeKey]=walk(child,depth+1);}return out;}
  throw new SafetyError('Figma 数据类型无效',502);
 };return {data:walk(value,0),redacted};
}
async function download(url,format,signal){
 let parsed;try{parsed=new URL(url);}catch{throw new SafetyError('Figma 渲染地址无效',502);}const host=parsed.hostname.toLowerCase(),allowed=host==='figma-alpha-api.s3.us-west-2.amazonaws.com'&&parsed.pathname.startsWith('/images/')||['s3-alpha-sig.figma.com','s3-alpha.figma.com'].includes(host);
 if(parsed.protocol!=='https:'||!allowed||parsed.port||parsed.username||parsed.password||parsed.hash)throw new SafetyError('Figma 返回的渲染来源尚不支持，未下载',422);
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
 try{const response=await fetch(parsed.href,{signal:controller.signal,redirect:'error'});if(!response.ok)throw new SafetyError('Figma 原件下载失败（HTTP '+response.status+'）',502);const bytes=await bounded(response,16*1024*1024);if(!bytes.length)throw new SafetyError('Figma 返回空文件',502);if(format==='svg')safeSvg(bytes);else if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new SafetyError('Figma 返回内容不是 PNG',502);return bytes;}
 catch(error){if(signal?.aborted)throw new SafetyError('Figma 原件下载已停止',499);if(error instanceof SafetyError)throw error;throw new SafetyError('Figma 原件下载失败',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function immutable(path,value){const body=encode(value);await mkdir(join(path,'..'),{recursive:true});if(!atomicCreate(path,body)){const prior=await readFile(path);if(!prior.equals(body))throw new SafetyError('Figma 来源回执冲突，原记录未覆盖',409);}}
export function validateFigmaExport(value){
 assertSafeJson(value);const allowed=['schema','kind','id','fileKey','nodeId','version','format','outlineText','assetName','sha256','bytes'];
 if(!value||Object.keys(value).some(key=>!allowed.includes(key))||value.schema!==1||value.kind!=='figma-export'||!EXPORT.test(value.id||'')||!FILE.test(value.fileKey||'')||!NODE.test(value.nodeId||'')||!VERSION.test(value.version||'')||!['svg','png'].includes(value.format)||typeof value.outlineText!=='boolean'||value.format==='png'&&value.outlineText!==false||typeof value.assetName!=='string'||!/^figma-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:svg|png)$/.test(value.assetName)||!/^[a-f0-9]{64}$/.test(value.sha256||'')||!value.assetName.startsWith('figma-'+value.sha256.slice(0,24))||!value.assetName.endsWith('.'+value.format)||!Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>16*1024*1024||value.id!==exportId(value))throw new SafetyError('Figma 导出来源记录无效',409);return value;
}
export function validateFigmaAsset(receipt,bytes){
 validateFigmaExport(receipt);if(!Buffer.isBuffer(bytes)||bytes.length!==receipt.bytes||sha(bytes)!==receipt.sha256)throw new SafetyError('Figma 原件缺失或改变',409);if(receipt.format==='svg')safeSvg(bytes);else if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new SafetyError('Figma 原件不是 PNG',409);return true;
}
export function validateFigmaOpen(value){
 assertSafeJson(value);if(!value||Object.keys(value).some(key=>!['schema','kind','id','exportId','operationId'].includes(key))||value.schema!==1||value.kind!=='figma-open'||!OPEN.test(value.id||'')||!EXPORT.test(value.exportId||'')||!/^figma-[a-f0-9]{64}$/.test(value.operationId||'')||value.id!==openId(value.exportId,value.operationId))throw new SafetyError('Figma 导入预约无效',409);return value;
}
export function validateFigmaLink(value){
 assertSafeJson(value);const allowed=['schema','kind','id','openId','exportId','sourceId','sourceRevision','jobId','sha256'];if(!value||Object.keys(value).some(key=>!allowed.includes(key))||value.schema!==1||value.kind!=='figma-link'||!LINK.test(value.id||'')||!OPEN.test(value.openId||'')||!EXPORT.test(value.exportId||'')||typeof value.sourceId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value.sourceId)||!/^[a-f0-9]{64}$/.test(value.sourceRevision||'')||!/^[a-f0-9-]{36}$/.test(value.jobId||'')||!/^[a-f0-9]{64}$/.test(value.sha256||'')||value.id!==linkId(value))throw new SafetyError('Figma 导入关联无效',409);return value;
}
export async function readFigmaExport(root,id){
 root=store.validateRoot(root);const path=pathFor(root,id),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('Figma 来源记录无效',409);const receipt=JSON.parse(await readFile(path,'utf8'));validateFigmaExport(receipt);if(receipt.id!==id)throw new SafetyError('Figma 来源身份不一致',409);const bytes=store.readAsset(root,receipt.assetName);validateFigmaAsset(receipt,bytes);return {receipt,bytes};
}
export class FigmaSource{
 constructor(ctx,manager){this.ctx=ctx;this.manager=manager;this.snapshots=new Map();}
 async credential(){for(const ref of ['FIGMA_ACCESS_TOKEN','FIGMA_TOKEN']){try{const value=(await this.ctx.get?.('credentials')?.resolve?.(ref))?.value;if(typeof value==='string'&&value.trim())return value;}catch{/* Try the next configured reference. */}}throw new SafetyError('DSH 未配置可用的 Figma 只读令牌引用',503);}
 async inspect(root,{reference,nodeIds,depth=2},signal){
  root=store.validateRoot(root);const parsed=parseFigmaReference(reference),ids=nodeIds?.length?nodeIds:parsed.nodeId?[parsed.nodeId]:[];
  if(!Array.isArray(ids)||ids.length<1||ids.length>20||!Number.isSafeInteger(depth)||depth<1||depth>5)throw new SafetyError('请选择 1 至 20 个 Figma 节点和有效读取深度',422);
  const selected=ids.map(id=>parseFigmaReference(parsed.fileKey,id).nodeId);if(new Set(selected).size!==selected.length)throw new SafetyError('Figma 节点重复',422);
  const query=new URLSearchParams({ids:selected.join(','),depth:String(depth),geometry:'paths'}),token=await this.credential(),result=await api(token,'/files/'+parsed.fileKey+'/nodes?'+query,signal),data=result.data;
  if(!data.nodes||typeof data.nodes!=='object'||Array.isArray(data.nodes))throw new SafetyError('Figma 未返回节点映射',502);
  const safe=safeSnapshot(data,[token]),content=JSON.stringify(safe.data,null,2);if(Buffer.byteLength(content)>8*1024*1024)throw new SafetyError('Figma 节点内容超过预算',413);
  const id='figmasnapshot-'+sha(Buffer.from(JSON.stringify([parsed.fileKey,selected,depth,result.rawHash]))),version=typeof data.version==='string'&&VERSION.test(data.version)?data.version:null;
  this.snapshots.set(id,{root,fileKey:parsed.fileKey,version,content,depth,requested:selected,at:Date.now()});while(this.snapshots.size>5)this.snapshots.delete(this.snapshots.keys().next().value);
  return {snapshotId:id,fileKey:parsed.fileKey,version,requested:selected,nodes:selected.map(nodeId=>({nodeId,found:!!data.nodes[nodeId]?.document,name:typeof safe.data.nodes[nodeId]?.document?.name==='string'?safe.data.nodes[nodeId].document.name.slice(0,200):null,type:typeof safe.data.nodes[nodeId]?.document?.type==='string'?safe.data.nodes[nodeId].document.type.slice(0,100):null})),sourceSha256:result.rawHash,redacted:safe.redacted,totalCharacters:content.length,note:'内容是当前会话中读取的 Figma 节点参考数据；隐藏了链接和疑似凭据，未执行设计修改。'};
 }
 readSnapshot(root,id,{offset=0,limit=12000}={}){root=store.validateRoot(root);const item=this.snapshots.get(id);if(!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Figma 节点快照已过期，请重新读取',404);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('Figma 节点分页无效',422);return {snapshotId:id,fileKey:item.fileKey,version:item.version,content:item.content.slice(offset,offset+limit),offset,totalCharacters:item.content.length,nextOffset:offset+limit<item.content.length?offset+limit:null};}
 brandCandidates(root,id){
  root=store.validateRoot(root);const snapshot=this.snapshots.get(id);if(!snapshot||snapshot.root!==root||Date.now()-snapshot.at>5*60*1000)throw new SafetyError('Figma 节点快照已过期，请重新读取',404);
  const data=JSON.parse(snapshot.content),colors=new Map(),fonts=new Map(),seen=new Set(),stack=Object.values(data.nodes||{}).map(item=>item?.document).filter(Boolean);let visited=0,unsupportedPaints=0,textOverrides=0,hiddenNodes=0,unidentifiedNodes=0,redactedFonts=0;
  const channel=value=>Number.isFinite(value)&&value>=0&&value<=1?Math.round(value*255).toString(16).padStart(2,'0'):null;
  while(stack.length){
   const node=stack.pop();if(!node||typeof node!=='object'||Array.isArray(node))continue;if(++visited>50000)throw new SafetyError('Figma 品牌候选节点超过预算',413);
   const nodeId=typeof node.id==='string'&&NODE.test(node.id)?node.id:null;if(nodeId&&seen.has(nodeId))continue;if(nodeId)seen.add(nodeId);if(node.visible===false){hiddenNodes++;continue;}if(!nodeId){unidentifiedNodes++;if(Array.isArray(node.children))for(const child of node.children)stack.push(child);continue;}
   for(const property of ['fills','strokes'])for(const paint of Array.isArray(node[property])?node[property]:[]){
    if(!paint||paint.visible===false)continue;if(paint.type!=='SOLID'){unsupportedPaints++;continue;}
    const color=paint.color||{},red=channel(color.r),green=channel(color.g),blue=channel(color.b),colorAlpha=Number.isFinite(color.a)&&color.a>=0&&color.a<=1?color.a:null,opacity=paint.opacity===undefined?1:paint.opacity;
    if(!red||!green||!blue||!Number.isFinite(opacity)||opacity<0||opacity>1){unsupportedPaints++;continue;}
    const hex='#'+red+green+blue,alpha=colorAlpha===null?null:Math.round(colorAlpha*opacity*1000)/1000,key=hex+'|'+String(alpha),row=colors.get(key)||{hex,alpha,occurrences:0,examples:[]};row.occurrences++;if(nodeId&&row.examples.length<4)row.examples.push({nodeId,property});colors.set(key,row);
   }
   if(node.type==='TEXT'){
    if(Array.isArray(node.characterStyleOverrides)&&node.characterStyleOverrides.some(value=>value!==0))textOverrides++;
    const style=node.style||{},family=typeof style.fontFamily==='string'?style.fontFamily.trim():'';
    if(family.includes('[链接已隐藏]')||family.includes('[已隐藏]'))redactedFonts++;else if(family&&family.length<=200){const row=fonts.get(family)||{family,weights:[],occurrences:0,examples:[]};row.occurrences++;if(Number.isFinite(style.fontWeight)&&!row.weights.includes(style.fontWeight))row.weights.push(style.fontWeight);if(row.examples.length<4)row.examples.push({nodeId});fonts.set(family,row);}
   }
   if(Array.isArray(node.children))for(const child of node.children)stack.push(child);
  }
  const colorRows=[...colors.values()].sort((a,b)=>b.occurrences-a.occurrences||a.hex.localeCompare(b.hex)),fontRows=[...fonts.values()].sort((a,b)=>b.occurrences-a.occurrences||a.family.localeCompare(b.family));
  return {snapshotId:id,fileKey:snapshot.fileKey,version:snapshot.version,requested:snapshot.requested,depth:snapshot.depth,visitedNodes:visited,colors:colorRows.slice(0,50),fonts:fontRows.slice(0,40),totalColors:colorRows.length,totalFonts:fontRows.length,unsupportedPaints,textNodesWithOverrides:textOverrides,hiddenNodes,unidentifiedNodes,redactedFonts,
   note:'仅统计所读取深度内 visible 未设为 false 的节点纯色填充/描边和文字默认字体；次数不是面积或品牌语义。渐变、图片、混合、节点及祖先透明度和文字局部样式未解析；颜色 alpha 为颜色与画笔透明度相乘，缺失颜色 alpha 时为 null。'};
 }
 async export(root,{reference,nodeId,version,format='svg',outlineText=false},signal,assertCurrent){
  root=store.validateRoot(root);const parsed=parseFigmaReference(reference,nodeId);if(!parsed.nodeId||!VERSION.test(version||'')||!['svg','png'].includes(format)||typeof outlineText!=='boolean'||format==='png'&&outlineText)throw new SafetyError('请选择明确节点、固定版本和 SVG/PNG 格式',422);
  const q=new URLSearchParams({ids:parsed.nodeId,version,format});if(format==='svg'){q.set('svg_outline_text',String(outlineText));q.set('svg_include_node_id','true');}
  const response=await api(await this.credential(),'/images/'+parsed.fileKey+'?'+q,signal),url=response.data.images?.[parsed.nodeId];if(typeof url!=='string'||!url)throw new SafetyError('Figma 未能渲染该节点，原设计未改动',422);
  const bytes=await download(url,format,signal);signal?.throwIfAborted();assertCurrent?.();const digest=sha(bytes),asset=store.saveAsset(root,'figma-'+digest.slice(0,24)+'.'+format,bytes),receipt={schema:1,kind:'figma-export',fileKey:parsed.fileKey,nodeId:parsed.nodeId,version,format,outlineText,assetName:asset.name,sha256:digest,bytes:bytes.length};receipt.id=exportId(receipt);
  try{validateFigmaExport(receipt);await immutable(pathFor(root,receipt.id),receipt);}catch(error){error.retained={asset:{name:asset.name,path:asset.path,bytes:asset.size},sha256:digest,sourceRecorded:false};throw error;}
  return {export:receipt,asset:{name:asset.name,path:asset.path,bytes:asset.size},note:'这是 Figma 固定版本的实际导出文件；文本、字体、效果和可编辑性须在目标编辑器中另行确认。'};
 }
 async get(root,id){
  return readFigmaExport(root,id);
 }
 async list(root,{offset=0,limit=30}={}){root=store.validateRoot(root);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new SafetyError('Figma 来源分页无效',422);let names;try{names=await readdir(directory(root));}catch(error){if(error.code==='ENOENT')return {items:[],total:0,nextOffset:null};throw error;}const entries=names.filter(name=>/^figmaexport-[a-f0-9]{64}\.json$/.test(name)).sort();if(entries.length>1000)throw new SafetyError('Figma 来源记录超过预算',413);const items=[];for(const name of entries.slice(offset,offset+limit)){try{const {receipt}=await this.get(root,name.slice(0,-5));items.push(receipt);}catch(error){items.push({id:name.slice(0,-5),error:String(error.message||error)});}}return {items,total:entries.length,nextOffset:offset+limit<entries.length?offset+limit:null};}
 async read(root,id,{offset=0,limit=12000}={}){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('Figma 原件分页无效',422);const {receipt,bytes}=await this.get(root,id);if(receipt.format!=='svg')return {export:receipt,binary:true};const text=safeSvg(bytes);return {export:receipt,content:text.slice(offset,offset+limit),offset,totalCharacters:text.length,nextOffset:offset+limit<text.length?offset+limit:null};}
 async reconcile(root,id,signal,assertCurrent){
  root=store.validateRoot(root);if(!OPEN.test(id||''))throw new SafetyError('Figma 导入身份无效',422);const reservation=JSON.parse(await readFile(pathFor(root,id),'utf8'));validateFigmaOpen(reservation);if(reservation.id!==id)throw new SafetyError('Figma 导入预约无效',409);
  const {receipt}=await this.get(root,reservation.exportId),kind=receipt.format==='png'?'image':'svg',action=kind==='image'?'resource_image':'create_svg',engine=kind==='image'?'photocraft':'vectorcraft',operations=workspacePath(root,'design/.designcraft/v2/operations');let names;try{names=await readdir(operations);}catch(error){if(error.code==='ENOENT')return {status:'unconfirmed',openId:id,note:'尚未找到可核对的原生回执，不自动重复导入。'};throw error;}if(names.length>20000)throw new SafetyError('原生操作记录超过核对预算',413);
  const matches=[];let scanned=0;for(const name of names){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;signal?.throwIfAborted();const path=workspacePath(root,join(operations,name),{mustExist:true}),info=await stat(path);if(info.size>1024*1024||(scanned+=info.size)>64*1024*1024)throw new SafetyError('原生操作记录超过读取预算',413);let job;try{job=JSON.parse(await readFile(path,'utf8'));}catch{continue;}if(job.id+'.json'===name&&job.operationId===reservation.operationId&&job.action===action&&job.resourceReceiptId===receipt.id&&job.originalInput?.original?.sha256===receipt.sha256)matches.push(job);}
  if(matches.length!==1||!matches[0].savedRevision)return {status:'unconfirmed',openId:id,matchingOperations:matches.length,note:'没有唯一已保存的原生回执，不自动重复导入。'};
  const job=matches[0],source=await this.manager.store(root).source(job.sourceId,job.savedRevision),operation=source.meta.operation;if(source.meta.engine!==engine||operation?.action!=='resource-import'||operation.id!==job.id||operation.resourceReceiptId!==receipt.id||operation.inputHash!==receipt.sha256||operation.kind!==kind||kind==='image'&&job.sourceId!=='import-'+job.id)throw new SafetyError('Figma 导入结果缺少匹配的原生来源回执',409);
  const original=workspacePath(root,join(this.manager.store(root).directory((kind==='image'?'import-':'generated-')+job.id),'originals',receipt.sha256+'.'+receipt.format),{mustExist:true});if(sha(await readFile(original))!==receipt.sha256)throw new SafetyError('Figma 导入原件与操作回执不一致',409);
  const link={schema:1,kind:'figma-link',openId:id,exportId:reservation.exportId,sourceId:job.sourceId,sourceRevision:job.savedRevision,jobId:job.id,sha256:receipt.sha256};link.id=linkId(link);validateFigmaLink(link);signal?.throwIfAborted();assertCurrent?.();await immutable(pathFor(root,link.id),link);
  let jobResolved=false;const live=this.manager.jobs.get(job.id),view=live&&this.manager.views.get(live.viewId);if(live?.status==='uncertain'&&view&&view.root===root){const result=await this.manager.confirmResourceImport(view,{jobId:job.id,sourceId:job.sourceId,sourceRevision:job.savedRevision,resourceReceiptId:receipt.id,inputHash:receipt.sha256,kind});jobResolved=!!result.jobResolved;}
  return {status:'confirmed',openId:id,link,operationStatus:job.status,jobResolved,note:'已核对保存的原生源和 Figma 原件；编辑效果仍需验证。'};
 }
 async openImage(root,sessionId,exportIdValue,operationKey,signal){
  root=store.validateRoot(root);const {receipt,bytes}=await this.get(root,exportIdValue);if(receipt.format!=='png')throw new SafetyError('只有已保存的 PNG 可打开为图片源',422);previewImageSize(bytes);if(typeof operationKey!=='string'||!operationKey||operationKey.length>250)throw new SafetyError('Figma 导入需要稳定操作身份',422);
  const view=this.manager.views.get(this.manager.active.get(sessionId));if(!view||view.root!==root||view.navigation?.canReturn)throw new SafetyError('请先打开当前设计工作区并返回原设计；Figma 原件已保留',409);this.manager.fileActionIdle(view,view.epoch);const current=()=>{if(this.manager.scope(sessionId)!==root)throw new SafetyError('对话工作区已切换，Figma 原件保留',409);};
  const operationId='figma-'+sha(Buffer.from(sessionId+'\0'+operationKey)),id=openId(exportIdValue,operationId),path=pathFor(root,id),reservation={schema:1,kind:'figma-open',id,exportId:exportIdValue,operationId};validateFigmaOpen(reservation);await mkdir(directory(root),{recursive:true});current();if(!atomicCreate(path,encode(reservation)))return this.reconcile(root,id,signal,current);
  try{const result=await this.manager.request(sessionId,{action:'resource_image',payload:{title:'Figma · '+receipt.nodeId,assetName:receipt.assetName,sourceHash:receipt.sha256,resourceReceiptId:receipt.id},operationId,initiator:'ai'},signal);if(!result.persisted)throw new SafetyError('原生导入尚未确认',409);return await this.reconcile(root,id,signal,current);}
  catch(error){error.retained={openId:id,exportId:exportIdValue,sourceRecorded:true};throw error;}
 }
 async openSvg(root,sessionId,exportIdValue,operationKey,signal){
  root=store.validateRoot(root);const {receipt,bytes}=await this.get(root,exportIdValue);if(receipt.format!=='svg')throw new SafetyError('只有 SVG 可打开为矢量源',422);if(typeof operationKey!=='string'||!operationKey||operationKey.length>250)throw new SafetyError('Figma 导入需要稳定操作身份',422);
  const view=this.manager.views.get(this.manager.active.get(sessionId));if(!view||view.root!==root||view.navigation?.canReturn)throw new SafetyError('请先打开当前设计工作区并返回原设计；Figma 原件已保留',409);this.manager.fileActionIdle(view,view.epoch);const svg=safeSvg(bytes),assertCurrent=()=>{if(this.manager.scope(sessionId)!==root)throw new SafetyError('对话工作区已切换，Figma 原件保留',409);};
  const operationId='figma-'+sha(Buffer.from(sessionId+'\0'+operationKey)),id=openId(exportIdValue,operationId),path=pathFor(root,id),reservation={schema:1,kind:'figma-open',id,exportId:exportIdValue,operationId};await mkdir(directory(root),{recursive:true});assertCurrent();if(!atomicCreate(path,encode(reservation)))return this.reconcile(root,id,signal,assertCurrent);
  try{const result=await this.manager.request(sessionId,{action:'create_svg',payload:{title:'Figma · '+receipt.nodeId,svg,resourceReceiptId:receipt.id},operationId,initiator:'ai'},signal);if(!result.persisted)throw new SafetyError('原生导入尚未确认',409);return await this.reconcile(root,id,signal,assertCurrent);}
  catch(error){error.retained={openId:id,exportId:exportIdValue,sourceRecorded:true};throw error;}
 }
}
export {safeSvg as validateStaticExternalSvg};
