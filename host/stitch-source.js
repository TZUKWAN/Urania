/** Preserve actual Stitch screen assets without retaining signed URLs. */
import {createHash} from 'node:crypto';
import {readFile,mkdir,stat,lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {HtmlArtifacts} from './html-artifacts.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';

const ASSET=/^stitchasset-[a-f0-9]{64}$/,CANDIDATE=/^stitchcandidate-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/;
const TOOL=new Set(['get_screen','list_screens','get_project','list_projects','create_project','generate_screen_from_text','edit_screens','generate_variants']);
const WRITE=new Set(['create_project','generate_screen_from_text','edit_screens','generate_variants']);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>sha(Buffer.from(JSON.stringify(value)));
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const pathFor=(root,id)=>{if(!ASSET.test(id||''))throw new SafetyError('Stitch 原件身份无效',422);return workspacePath(root,join('design','.designcraft','stitch-assets',id+'.json'));};
const safeSegment=value=>typeof value==='string'&&value.length>0&&value.length<=120&&!/[\x00-\x1f]/.test(value)&&!/(?:https?:\/\/|token|authorization|api[_-]?key)/i.test(value)&&!['__proto__','constructor','prototype'].includes(value)||Number.isSafeInteger(value)&&value>=0;
const sourceId=row=>'stitchasset-'+hash([row.tool,row.requestHash,row.jobId||null,row.sourcePath,row.format,row.sha256]);

/** Only explicit htmlCode/screenshot properties from an actual MCP result. */
export function stitchAssetCandidates(payload){
 const rows=[],stack=[{value:payload,path:[]}];let nodes=0;
 while(stack.length){
  const {value,path}=stack.pop();if(++nodes>50000||path.length>30)throw new SafetyError('Stitch 资源结构超过预算',413);
  if(!value||typeof value!=='object')continue;
  for(const [key,child]of Object.entries(value)){
   const segment=Array.isArray(value)&&/^\d+$/.test(key)?Number(key):key;if(!safeSegment(segment))continue;const next=[...path,segment];
   if((key==='htmlCode'||key==='screenshot')&&child&&typeof child==='object'&&!Array.isArray(child)){
    const kind=key==='htmlCode'?'html':'image',url=typeof child.downloadUrl==='string'?child.downloadUrl:null,inline=kind==='html'&&typeof child.content==='string'?child.content:null;
    if(url||inline!==null){const candidateId='stitchcandidate-'+hash([next,kind]);rows.push({candidateId,kind,path:next,...(inline!==null?{inline}:{url})});if(rows.length>100)throw new SafetyError('Stitch 屏幕资源数量超过预算',413);}
   }
   if(child&&typeof child==='object')stack.push({value:child,path:next});
  }
 }
 return rows;
}
function htmlBytes(bytes){
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('Stitch HTML 不是有效 UTF-8',422);}
 if(!bytes.length||bytes.length>8*1024*1024||!/<(?:!doctype\s+html|html)(?:\s|>)/i.test(text.slice(0,4096))||/<title>\s*(?:sign in|登录)[^<]*(?:google|谷歌)/i.test(text)||/accounts\.google\.com\/(?:ServiceLogin|v3\/signin)/i.test(text))throw new SafetyError('Stitch 返回内容不是可确认的网页原件，可能需要登录',422);
 if(/(?:Bearer\s+[A-Za-z0-9_.:-]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"][^'"]{12,}|\b(?:access_token|token|signature|x-goog-signature|x-amz-signature|key-pair-id)\s*=)/i.test(text))throw new SafetyError('Stitch 网页含疑似凭据或签名资源链接，未保存不安全原件',422);
 return {format:'html',mime:'text/html'};
}
function imageBytes(bytes){
 if(!bytes.length||bytes.length>16*1024*1024)throw new SafetyError('Stitch 图片为空或超过预算',413);
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {format:'png',mime:'image/png'};
 if(bytes[0]===255&&bytes[1]===216)return {format:'jpg',mime:'image/jpeg'};
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return {format:'webp',mime:'image/webp'};
 throw new SafetyError('Stitch 返回内容不是 PNG、JPEG 或 WebP 图片',422);
}
async function download(value,kind,signal){
 let url;try{url=new URL(value);}catch{throw new SafetyError('Stitch 资源地址无效',422);}
 const allowed=['contribution.usercontent.google.com','lh3.googleusercontent.com','storage.googleapis.com'].includes(url.hostname.toLowerCase());
 if(url.protocol!=='https:'||!allowed||url.port||url.username||url.password||url.hash||url.href.length>8192)throw new SafetyError('Stitch 资源来源不在允许的 Google 主机范围',422);
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
 try{
  const response=await fetch(url.href,{signal:controller.signal,redirect:'manual'});if([301,302,303,307,308].includes(response.status))throw new SafetyError('Stitch 原件请求发生跳转，可能需要登录；没有采用跳转页面',422);
  if(!response.ok||!response.body)throw new SafetyError('Stitch 原件请求失败（HTTP '+response.status+'）',502);
  const maximum=kind==='html'?8*1024*1024:16*1024*1024;if(Number(response.headers.get('content-length'))>maximum)throw new SafetyError('Stitch 原件超过预算',413);
  const reader=response.body.getReader(),chunks=[];let total=0;try{while(true){const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>maximum)throw new SafetyError('Stitch 原件超过预算',413);chunks.push(Buffer.from(item.value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks,total);
 }catch(error){if(signal?.aborted)throw new SafetyError('Stitch 原件读取已停止',499);if(controller.signal.aborted)throw new SafetyError('Stitch 原件请求超时',504);if(error instanceof SafetyError)throw error;throw new SafetyError('Stitch 原件请求失败',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export function validateStitchAsset(row){
 assertSafeJson(row);const allowed=['schema','kind','id','tool','requestHash','jobId','sourcePath','format','mime','sha256','bytes','assetName'];
 if(!row||Object.keys(row).some(key=>!allowed.includes(key))||row.schema!==1||row.kind!=='stitch-asset'||!ASSET.test(row.id||'')||!TOOL.has(row.tool)||!HASH.test(row.requestHash||'')||(WRITE.has(row.tool)?!/^stitchjob-[a-f0-9]{64}$/.test(row.jobId||''):row.jobId!==undefined)||!Array.isArray(row.sourcePath)||!row.sourcePath.length||row.sourcePath.length>30||row.sourcePath.some(value=>!safeSegment(value))||!['html','png','jpg','webp'].includes(row.format)||row.sourcePath.at(-1)!==(row.format==='html'?'htmlCode':'screenshot')||row.mime!==({html:'text/html',png:'image/png',jpg:'image/jpeg',webp:'image/webp'})[row.format]||!HASH.test(row.sha256||'')||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>(row.format==='html'?8:16)*1024*1024||typeof row.assetName!=='string'||!/^stitch-source-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:html|png|jpg|webp)$/.test(row.assetName)||!row.assetName.startsWith('stitch-source-'+row.sha256.slice(0,24))||!row.assetName.endsWith('.'+row.format)||row.id!==sourceId(row))throw new SafetyError('Stitch 原件来源回执无效',409);
 return true;
}
export function verifyStitchAsset(row,bytes){validateStitchAsset(row);if(!Buffer.isBuffer(bytes)||bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw new SafetyError('Stitch 原件缺失或摘要不一致',409);const type=row.format==='html'?htmlBytes(bytes):imageBytes(bytes);if(type.format!==row.format)throw new SafetyError('Stitch 原件类型不一致',409);return true;}
export async function loadStitchAsset(root,id){
 root=store.validateRoot(root);const path=pathFor(root,id);let info;try{info=await stat(path);}catch(error){if(error.code==='ENOENT')throw new SafetyError('Stitch 原件记录不存在',404);throw error;}
 if(!info.isFile()||info.size>16384)throw new SafetyError('Stitch 原件记录无效',409);let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('Stitch 原件记录不是有效 JSON',409);}validateStitchAsset(row);if(row.id!==id)throw new SafetyError('Stitch 原件身份不一致',409);
 const bytes=store.readAsset(root,row.assetName);verifyStitchAsset(row,bytes);return {row,bytes};
}
export async function listStitchAssets(root){
 root=store.validateRoot(root);const directory=workspacePath(root,'design/.designcraft/stitch-assets');let names;try{names=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const entries=names.filter(item=>/^stitchasset-[a-f0-9]{64}\.json$/.test(item.name));if(entries.length>2000||entries.some(item=>!item.isFile()))throw new SafetyError('Stitch 原件记录超过预算或无效',413);
 const rows=[];for(const item of entries){const {row}=await loadStitchAsset(root,item.name.slice(0,-5));rows.push(row);}return rows;
}
async function pendingAsset(root,name){
 if(!/^stitchasset-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(name||''))throw new SafetyError('Stitch 原件候选身份无效',422);
 const path=workspacePath(root,join('design','.designcraft','stitch-assets',name),{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('Stitch 原件候选无效',409);
 let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('Stitch 原件候选尚未完整写入',409);}validateStitchAsset(row);if(!name.startsWith(row.id+'.json.tmp-'))throw new SafetyError('Stitch 原件候选身份不一致',409);
 const bytes=store.readAsset(root,row.assetName);verifyStitchAsset(row,bytes);return row;
}
export async function pendingStitchAssets(root){
 root=store.validateRoot(root);const directory=workspacePath(root,'design/.designcraft/stitch-assets');let names;try{names=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const entries=names.filter(item=>/^stitchasset-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(item.name));if(entries.length>128)throw new SafetyError('Stitch 原件候选超过预算',413);
 const result=[];for(const item of entries){try{const row=await pendingAsset(root,item.name);result.push({candidate:item.name,id:row.id,format:row.format,recoverable:true});}catch(error){result.push({candidate:item.name,recoverable:false,error:error instanceof SafetyError?error.message:'Stitch 原件候选无法读取'});}}return result;
}
export async function recoverStitchAsset(root,name,signal,assertCurrent){
 root=store.validateRoot(root);const row=await pendingAsset(root,name);signal?.throwIfAborted();assertCurrent?.();const path=pathFor(root,row.id);
 if(!atomicCreate(path,encode(row))){const previous=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(previous)!==JSON.stringify(row))throw new SafetyError('Stitch 原件来源冲突，未覆盖',409);}
 return {record:row,recovered:true,note:'已核对并恢复本地原件来源；原临时记录保留，未访问远端服务。'};
}
export async function saveStitchAsset(root,snapshot,candidateId,signal,assertCurrent){
 root=store.validateRoot(root);if(!CANDIDATE.test(candidateId||'')||!snapshot||snapshot.root!==root||!TOOL.has(snapshot.tool)||!HASH.test(snapshot.requestHash||''))throw new SafetyError('Stitch 资源选择无效',422);
 const selected=stitchAssetCandidates(snapshot.payload).find(item=>item.candidateId===candidateId);if(!selected||selected.path.some(part=>typeof part==='string'&&(snapshot.secrets||[]).some(secret=>part.includes(secret))))throw new SafetyError('Stitch 资源不在快照中',404);
 const bytes=selected.inline!==undefined?Buffer.from(selected.inline,'utf8'):await download(selected.url,selected.kind,signal),type=selected.kind==='html'?htmlBytes(bytes):imageBytes(bytes);signal?.throwIfAborted();assertCurrent?.();
 const digest=sha(bytes),asset=store.saveAsset(root,'stitch-source-'+digest.slice(0,24)+'.'+type.format,bytes),row={schema:1,kind:'stitch-asset',tool:snapshot.tool,requestHash:snapshot.requestHash,...(snapshot.jobId?{jobId:snapshot.jobId}:{}),sourcePath:selected.path,format:type.format,mime:type.mime,sha256:digest,bytes:bytes.length,assetName:asset.name};row.id=sourceId(row);validateStitchAsset(row);
 try{const path=pathFor(root,row.id);await mkdir(join(path,'..'),{recursive:true});assertCurrent?.();if(!atomicCreate(path,encode(row))){const prior=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(prior)!==JSON.stringify(row))throw new SafetyError('Stitch 原件回执冲突，原文件未覆盖',409);}}
 catch(error){error.retained={asset:{name:asset.name,path:asset.path,bytes:asset.size},record:row,materialized:true,provenanceRecorded:false};throw error;}
 return {record:row,asset:{name:asset.name,path:asset.path,bytes:asset.size},note:'已保存 Stitch 实际原件；来源对应关系依赖当时的服务响应。外部资源与视觉效果尚需核对。'};
}
export async function openStitchHtml(root,id,operationId,title,signal,assertCurrent){
 if(!HASH.test(operationId||''))throw new SafetyError('Stitch 网页导入身份无效',422);const {row,bytes}=await loadStitchAsset(root,id);if(row.format!=='html')throw new SafetyError('请选择已保存的 Stitch HTML',422);
 const raw=hash([row.id,operationId]).slice(0,32),htmlId='html-'+raw.slice(0,8)+'-'+raw.slice(8,12)+'-'+raw.slice(12,16)+'-'+raw.slice(16,20)+'-'+raw.slice(20),html=new HtmlArtifacts(root),provenance={source:'stitch',stitchAssetId:row.id,requestHash:row.requestHash,sha256:row.sha256};
 let lineage=await html.lineage(htmlId);if(lineage.length){const first=lineage[0].value,file=first.files.find(item=>item.path==='index.html');if(first.provenance?.stitchAssetId!==row.id||first.provenance?.sha256!==row.sha256||!file||file.sha256!==row.sha256)throw new SafetyError('已有网页与 Stitch 原件身份冲突，未覆盖',409);signal?.throwIfAborted();assertCurrent?.();return {id:htmlId,revision:lineage.at(-1).revision,reused:true,note:'已找到同一原件导入的网页；后续编辑可能与原始页面不同。'};}
 signal?.throwIfAborted();assertCurrent?.();const result=await html.save({id:htmlId,baseRevision:null,title:typeof title==='string'&&title.trim()?title:'Stitch 网页',entry:'index.html',files:[{path:'index.html',data:bytes.toString('base64')}],provenance});
 try{assertCurrent?.();}catch(error){error.retained={id:result.id,revision:result.revision};throw error;}
 return {id:result.id,revision:result.revision,note:'已创建独立网页源；外部字体、图片、交互和转换效果需要另行核对。'};
}
