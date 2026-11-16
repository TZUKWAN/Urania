/** Preserve a finished PixelBin image without storing its temporary URL. */
import {createHash} from 'node:crypto';
import {readFile,mkdir,stat,lstat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {previewImageSize} from './image-header.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';

const ASSET=/^pixelasset-[a-f0-9]{64}$/,OPEN=/^pixelopen-[a-f0-9]{64}$/,LINK=/^pixellink-[a-f0-9]{64}$/,CANDIDATE=/^pixelcandidate-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/,PRED=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>sha(Buffer.from(JSON.stringify(value)));
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const pathFor=(root,id)=>{if(!ASSET.test(id||'')&&!OPEN.test(id||'')&&!LINK.test(id||''))throw new SafetyError('PixelBin 来源身份无效',422);return workspacePath(root,join('design','.designcraft','pixelbin-assets',id+'.json'));};
const safeSegment=value=>typeof value==='string'&&value.length>0&&value.length<=120&&!/[\x00-\x1f]/.test(value)&&!/(?:https?:\/\/|token|authorization|api[_-]?key)/i.test(value)&&!['__proto__','constructor','prototype'].includes(value)||Number.isSafeInteger(value)&&value>=0;
const sourceId=row=>'pixelasset-'+hash([row.predictionId,row.jobId||null,row.sourcePath,row.sha256,row.responseSha256]);
const openId=(assetId,operationId)=>'pixelopen-'+hash([assetId,operationId]);
const linkId=row=>'pixellink-'+hash([row.openId,row.sourceId,row.sourceRevision,row.jobId]);
function imageType(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>64*1024*1024)throw new SafetyError('PixelBin 图片为空或超过预算',413);
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {format:'png',mime:'image/png'};
 if(bytes[0]===255&&bytes[1]===216)return {format:'jpg',mime:'image/jpeg'};
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return {format:'webp',mime:'image/webp'};
 throw new SafetyError('PixelBin 输出不是支持的 PNG、JPEG 或 WebP 图片',422);
}
/** Only URLs under an actual output/result field, never arbitrary text links. */
export function pixelbinCandidates(snapshot){
 if(!snapshot||snapshot.tool!=='get-prediction'||snapshot.remoteStatus!=='SUCCESS'||!PRED.test(snapshot.predictionId||''))throw new SafetyError('请先读取状态为 SUCCESS 的实际 PixelBin 预测',409);
 const rows=[],stack=[{value:snapshot.payload,path:[],inOutput:false}];let nodes=0;
 while(stack.length){
  const {value,path,inOutput}=stack.pop();if(++nodes>50000||path.length>30)throw new SafetyError('PixelBin 输出结构超过预算',413);
  if(typeof value==='string'){
   if(inOutput&&/^https:\/\//i.test(value)){const candidateId='pixelcandidate-'+hash(path);rows.push({candidateId,path,url:value});if(rows.length>50)throw new SafetyError('PixelBin 输出数量超过预算',413);}continue;
  }
  if(!value||typeof value!=='object')continue;
  for(const [key,child]of Object.entries(value)){
   const segment=Array.isArray(value)&&/^\d+$/.test(key)?Number(key):key;if(!safeSegment(segment)||(snapshot.secrets||[]).some(secret=>typeof segment==='string'&&segment.includes(secret)))continue;
   stack.push({value:child,path:[...path,segment],inOutput:inOutput||/^(?:output|outputs|result|results)$/i.test(key)});
  }
 }
 return rows;
}
async function download(value,signal){
 let url;try{url=new URL(value);}catch{throw new SafetyError('PixelBin 输出地址无效',422);}if(url.protocol!=='https:'||!['cdn.pixelbin.io','delivery.pixelbin.io'].includes(url.hostname.toLowerCase())||url.port||url.username||url.password||url.hash||url.href.length>8192)throw new SafetyError('PixelBin 输出来源不在支持的 CDN 范围',422);
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
 try{
  const response=await fetch(url.href,{signal:controller.signal,redirect:'error'});if(!response.ok||!response.body)throw new SafetyError('PixelBin 图片下载失败（HTTP '+response.status+'）',502);if(Number(response.headers.get('content-length'))>64*1024*1024)throw new SafetyError('PixelBin 图片超过预算',413);
  const reader=response.body.getReader(),chunks=[];let total=0;try{while(true){const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>64*1024*1024)throw new SafetyError('PixelBin 图片超过预算',413);chunks.push(Buffer.from(item.value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks,total);
 }catch(error){if(signal?.aborted)throw new SafetyError('PixelBin 图片下载已停止',499);if(controller.signal.aborted)throw new SafetyError('PixelBin 图片下载超时',504);if(error instanceof SafetyError)throw error;throw new SafetyError('PixelBin 图片下载失败或地址已失效',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function validatePixelbinAsset(row){
 assertSafeJson(row);const allowed=['schema','kind','id','predictionId','jobId','sourcePath','sha256','bytes','format','mime','assetName','responseAsset','responseSha256','responseBytes'];
 if(!row||Object.keys(row).some(key=>!allowed.includes(key))||row.schema!==1||row.kind!=='pixelbin-image'||!ASSET.test(row.id||'')||!PRED.test(row.predictionId||'')||row.jobId!==undefined&&!/^pixeljob-[a-f0-9]{64}$/.test(row.jobId)||!Array.isArray(row.sourcePath)||!row.sourcePath.length||row.sourcePath.length>30||row.sourcePath.some(value=>!safeSegment(value))||!HASH.test(row.sha256||'')||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>64*1024*1024||!['png','jpg','webp'].includes(row.format)||row.mime!==({png:'image/png',jpg:'image/jpeg',webp:'image/webp'})[row.format]||typeof row.assetName!=='string'||!/^pixelbin-image-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:png|jpg|webp)$/.test(row.assetName)||!row.assetName.startsWith('pixelbin-image-'+row.sha256.slice(0,24))||!row.assetName.endsWith('.'+row.format)||!HASH.test(row.responseSha256||'')||typeof row.responseAsset!=='string'||!/^pixelbin-result-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.json$/.test(row.responseAsset)||!row.responseAsset.startsWith('pixelbin-result-'+row.responseSha256.slice(0,24))||!Number.isSafeInteger(row.responseBytes)||row.responseBytes<1||row.responseBytes>8*1024*1024||row.id!==sourceId(row))throw new SafetyError('PixelBin 图片来源回执无效',409);
 return true;
}
export function verifyPixelbinAsset(row,bytes,responseBytes){validatePixelbinAsset(row);if(!Buffer.isBuffer(bytes)||bytes.length!==row.bytes||sha(bytes)!==row.sha256||imageType(bytes).format!==row.format||!Buffer.isBuffer(responseBytes)||responseBytes.length!==row.responseBytes||sha(responseBytes)!==row.responseSha256)throw new SafetyError('PixelBin 图片或服务响应缺失或改变',409);return true;}
export function validatePixelbinOpen(row){assertSafeJson(row);if(!row||row.schema!==1||row.kind!=='pixelbin-open'||!OPEN.test(row.id||'')||!ASSET.test(row.assetId||'')||!/^pixelbin-[a-f0-9]{64}$/.test(row.operationId||'')||row.id!==openId(row.assetId,row.operationId)||Object.keys(row).some(key=>!['schema','kind','id','assetId','operationId'].includes(key)))throw new SafetyError('PixelBin 导入预约无效',409);return true;}
export function validatePixelbinLink(row){assertSafeJson(row);if(!row||row.schema!==1||row.kind!=='pixelbin-link'||!LINK.test(row.id||'')||!OPEN.test(row.openId||'')||!ASSET.test(row.assetId||'')||typeof row.sourceId!=='string'||!/^import-[a-f0-9-]{36}$/.test(row.sourceId)||!HASH.test(row.sourceRevision||'')||!/^[a-f0-9-]{36}$/.test(row.jobId||'')||row.sourceId!=='import-'+row.jobId||!HASH.test(row.sha256||'')||row.id!==linkId(row)||Object.keys(row).some(key=>!['schema','kind','id','openId','assetId','sourceId','sourceRevision','jobId','sha256'].includes(key)))throw new SafetyError('PixelBin 原生来源关联无效',409);return true;}
export async function verifyPixelbinJobOrigin(root,row,validateJob){
 if(!row.jobId)return true;if(!/^pixeljob-[a-f0-9]{64}$/.test(row.jobId)||typeof validateJob!=='function')throw new SafetyError('PixelBin 任务来源核对不可用',503);const path=workspacePath(root,join('design','.designcraft','pixelbin-jobs',row.jobId+'.json'),{mustExist:true}),info=await stat(path);if(!info.isFile()||info.size>32768)throw new SafetyError('PixelBin 任务来源无效',409);
 let job;try{job=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('PixelBin 任务来源无法读取',409);}validateJob(job);if(job.id!==row.jobId||job.predictionId!==row.predictionId)throw new SafetyError('PixelBin 图片与预测任务不一致',409);
 const receiptId='pixelaccept-'+hash([job.id,job.inputHash,job.predictionId]),receiptPath=workspacePath(root,join('design','.designcraft','pixelbin-jobs',receiptId+'.json'),{mustExist:true}),receiptInfo=await stat(receiptPath);if(!receiptInfo.isFile()||receiptInfo.size>16384)throw new SafetyError('PixelBin 预测接收回执无效',409);
 let receipt;try{receipt=JSON.parse(await readFile(receiptPath,'utf8'));assertSafeJson(receipt);}catch{throw new SafetyError('PixelBin 预测接收回执无法读取',409);}if(!receipt||receipt.schema!==1||receipt.kind!=='pixelbin-acceptance'||receipt.id!==receiptId||receipt.jobId!==job.id||receipt.plugin!==job.plugin||receipt.operation!==job.operation||receipt.schemaSha256!==job.schemaSha256||receipt.inputHash!==job.inputHash||receipt.estimateHash!==job.estimateHash||receipt.predictionId!==job.predictionId||Object.keys(receipt).some(key=>!['schema','kind','id','jobId','plugin','operation','schemaSha256','inputHash','estimateHash','predictionId'].includes(key)))throw new SafetyError('PixelBin 预测接收回执与任务不一致',409);return true;
}
export async function loadPixelbinAsset(root,id,validateJob){
 root=store.validateRoot(root);const path=pathFor(root,id);let info;try{info=await stat(path);}catch(error){if(error.code==='ENOENT')throw new SafetyError('PixelBin 图片记录不存在',404);throw error;}if(!info.isFile()||info.size>16384)throw new SafetyError('PixelBin 图片记录无效',409);
 let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('PixelBin 图片记录不是有效 JSON',409);}validatePixelbinAsset(row);if(row.id!==id)throw new SafetyError('PixelBin 图片身份不一致',409);await verifyPixelbinJobOrigin(root,row,validateJob);const bytes=store.readAsset(root,row.assetName),responseBytes=store.readAsset(root,row.responseAsset);verifyPixelbinAsset(row,bytes,responseBytes);return {row,bytes,responseBytes};
}
export async function listPixelbinAssets(root,validateJob){
 root=store.validateRoot(root);const directory=workspacePath(root,'design/.designcraft/pixelbin-assets');let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}const names=entries.filter(item=>/^pixelasset-[a-f0-9]{64}\.json$/.test(item.name));if(names.length>2000||names.some(item=>!item.isFile()))throw new SafetyError('PixelBin 图片记录无效或超过预算',413);const out=[];for(const item of names)out.push(await loadPixelbinAsset(root,item.name.slice(0,-5),validateJob));return out;
}
export async function listPixelbinImports(root){
 root=store.validateRoot(root);const directory=workspacePath(root,'design/.designcraft/pixelbin-assets');let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const names=entries.filter(item=>/^(?:pixelopen|pixellink)-[a-f0-9]{64}\.json$/.test(item.name));if(names.length>2000||names.some(item=>!item.isFile()))throw new SafetyError('PixelBin 原生来源记录无效或超过预算',413);const opens=new Map(),links=[];
 for(const item of names){const path=workspacePath(root,join(directory,item.name),{mustExist:true}),info=await stat(path);if(info.size>16384)throw new SafetyError('PixelBin 原生来源记录超过预算',413);let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('PixelBin 原生来源记录损坏',409);}if(item.name.startsWith('pixelopen-')){validatePixelbinOpen(row);if(row.id+'.json'!==item.name)throw new SafetyError('PixelBin 导入预约身份不一致',409);opens.set(row.id,row);}else{validatePixelbinLink(row);if(row.id+'.json'!==item.name)throw new SafetyError('PixelBin 导入关联身份不一致',409);links.push(row);}}
 for(const link of links)if(!opens.has(link.openId)||opens.get(link.openId).assetId!==link.assetId)throw new SafetyError('PixelBin 导入关联缺少对应预约',409);
 return [...opens.values()].map(row=>({openId:row.id,assetId:row.assetId,linkRecorded:links.some(link=>link.openId===row.id&&link.assetId===row.assetId),note:'仅列出记录；核对时重新检查原生源和原件。'}));
}
async function pendingAsset(root,name,validateJob){
 if(!/^pixelasset-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(name||''))throw new SafetyError('PixelBin 图片候选身份无效',422);const path=workspacePath(root,join('design','.designcraft','pixelbin-assets',name),{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('PixelBin 图片候选无效',409);
 let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('PixelBin 图片候选尚未完整写入',409);}validatePixelbinAsset(row);if(!name.startsWith(row.id+'.json.tmp-'))throw new SafetyError('PixelBin 图片候选身份不一致',409);await verifyPixelbinJobOrigin(root,row,validateJob);const bytes=store.readAsset(root,row.assetName),responseBytes=store.readAsset(root,row.responseAsset);verifyPixelbinAsset(row,bytes,responseBytes);return {row,responseBytes};
}
export async function pendingPixelbinAssets(root,validateResponse,validateJob){
 root=store.validateRoot(root);const directory=workspacePath(root,'design/.designcraft/pixelbin-assets');let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}const names=entries.filter(item=>/^pixelasset-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(item.name));if(names.length>128)throw new SafetyError('PixelBin 图片候选超过预算',413);const out=[];for(const item of names){try{const {row,responseBytes}=await pendingAsset(root,item.name,validateJob);validateResponse(row,responseBytes);out.push({candidate:item.name,id:row.id,recoverable:true});}catch(error){out.push({candidate:item.name,recoverable:false,error:error instanceof SafetyError?error.message:'PixelBin 图片候选无法读取'});}}return out;
}
export async function recoverPixelbinAsset(root,name,signal,assertCurrent,validateResponse,validateJob){
 root=store.validateRoot(root);const {row,responseBytes}=await pendingAsset(root,name,validateJob);validateResponse(row,responseBytes);signal?.throwIfAborted();assertCurrent?.();const path=pathFor(root,row.id);if(!atomicCreate(path,encode(row))){const previous=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(previous)!==JSON.stringify(row))throw new SafetyError('PixelBin 图片来源冲突，未覆盖',409);}return {record:row,recovered:true,note:'已恢复本地图片来源，未重新访问 PixelBin。'};
}
export async function savePixelbinAsset(root,snapshot,candidateId,signal,assertCurrent,validateResponse,validateJob){
 root=store.validateRoot(root);if(!CANDIDATE.test(candidateId||'')||!snapshot||snapshot.root!==root)throw new SafetyError('PixelBin 输出选择无效',422);await verifyPixelbinJobOrigin(root,snapshot,validateJob);const selected=pixelbinCandidates(snapshot).find(item=>item.candidateId===candidateId);if(!selected)throw new SafetyError('PixelBin 输出不在当前快照中',404);
 const responseBytes=Buffer.from(snapshot.content,'utf8');validateResponse({...snapshot,sourcePath:selected.path},responseBytes);const bytes=await download(selected.url,signal),type=imageType(bytes);await verifyPixelbinJobOrigin(root,snapshot,validateJob);signal?.throwIfAborted();assertCurrent?.();
 const digest=sha(bytes),responseSha256=sha(responseBytes),asset=store.saveAsset(root,'pixelbin-image-'+digest.slice(0,24)+'.'+type.format,bytes),response=store.saveAsset(root,'pixelbin-result-'+responseSha256.slice(0,24)+'.json',responseBytes),row={schema:1,kind:'pixelbin-image',predictionId:snapshot.predictionId,...(snapshot.jobId?{jobId:snapshot.jobId}:{}),sourcePath:selected.path,sha256:digest,bytes:bytes.length,format:type.format,mime:type.mime,assetName:asset.name,responseAsset:response.name,responseSha256,responseBytes:responseBytes.length};row.id=sourceId(row);validatePixelbinAsset(row);
 try{const path=pathFor(root,row.id);await mkdir(join(path,'..'),{recursive:true});assertCurrent?.();if(!atomicCreate(path,encode(row))){const prior=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(prior)!==JSON.stringify(row))throw new SafetyError('PixelBin 图片来源回执冲突，未覆盖',409);}}
 catch(error){error.retained={asset:{name:asset.name,path:asset.path,bytes:asset.size},record:row,materialized:true,provenanceRecorded:false};throw error;}
 return {record:row,asset:{name:asset.name,path:asset.path,bytes:asset.size},note:'已保存真实图片及脱敏服务响应；远端来源对应关系来自当时的 HTTPS 响应。'};
}
async function immutable(path,value){await mkdir(join(path,'..'),{recursive:true});if(!atomicCreate(path,encode(value))){let prior;try{prior=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('PixelBin 来源记录损坏，未覆盖',409);}if(JSON.stringify(prior)!==JSON.stringify(value))throw new SafetyError('PixelBin 来源记录冲突，未覆盖',409);}}
export async function reconcilePixelbinImage(manager,root,id,signal,assertCurrent,validateResponse,validateJob){
 root=store.validateRoot(root);if(!OPEN.test(id||''))throw new SafetyError('PixelBin 导入身份无效',422);let reservation;try{reservation=JSON.parse(await readFile(pathFor(root,id),'utf8'));}catch{throw new SafetyError('PixelBin 导入预约无法读取',409);}validatePixelbinOpen(reservation);if(reservation.id!==id)throw new SafetyError('PixelBin 导入预约身份不一致',409);
 const {row,responseBytes}=await loadPixelbinAsset(root,reservation.assetId,validateJob);validateResponse(row,responseBytes);const operations=workspacePath(root,'design/.designcraft/v2/operations');let names;try{names=await readdir(operations);}catch(error){if(error.code==='ENOENT')return {status:'unconfirmed',openId:id,note:'没有可核对的原生回执，不自动重复导入。'};throw error;}if(names.length>20000)throw new SafetyError('原生操作记录超过核对预算',413);
 const matches=[];let total=0;for(const name of names){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;signal?.throwIfAborted();const path=workspacePath(root,join(operations,name),{mustExist:true}),info=await stat(path);if(info.size>1024*1024||(total+=info.size)>64*1024*1024)throw new SafetyError('原生操作记录超过读取预算',413);let job;try{job=JSON.parse(await readFile(path,'utf8'));}catch{continue;}if(job.id+'.json'===name&&job.operationId===reservation.operationId&&job.action==='resource_image'&&job.resourceReceiptId===row.id&&job.originalInput?.original?.sha256===row.sha256)matches.push(job);}
 if(matches.length!==1||!matches[0].savedRevision)return {status:'unconfirmed',openId:id,matchingOperations:matches.length,note:'没有唯一已保存的原生回执，不自动重复导入。'};
 const job=matches[0],source=await manager.store(root).source(job.sourceId,job.savedRevision),operation=source.meta.operation;if(source.meta.engine!=='photocraft'||operation?.action!=='resource-import'||operation.id!==job.id||operation.resourceReceiptId!==row.id||operation.inputHash!==row.sha256||operation.kind!=='image'||job.sourceId!=='import-'+job.id)throw new SafetyError('PixelBin 导入结果缺少匹配的原生来源回执',409);
 const original=workspacePath(root,join(manager.store(root).directory('import-'+job.id),'originals',row.sha256+'.'+row.format),{mustExist:true});if(sha(await readFile(original))!==row.sha256)throw new SafetyError('PixelBin 导入原件与操作回执不一致',409);
 const link={schema:1,kind:'pixelbin-link',openId:id,assetId:row.id,sourceId:job.sourceId,sourceRevision:job.savedRevision,jobId:job.id,sha256:row.sha256};link.id=linkId(link);validatePixelbinLink(link);await verifyPixelbinJobOrigin(root,row,validateJob);signal?.throwIfAborted();assertCurrent?.();await immutable(pathFor(root,link.id),link);
 let jobResolved=false;const live=manager.jobs.get(job.id),view=live&&manager.views.get(live.viewId);if(live?.status==='uncertain'&&view&&view.root===root){const result=await manager.confirmResourceImport(view,{jobId:job.id,sourceId:job.sourceId,sourceRevision:job.savedRevision,resourceReceiptId:row.id,inputHash:row.sha256,kind:'image'});jobResolved=!!result.jobResolved;}
 return {status:'confirmed',openId:id,link,jobResolved,note:'已核对保存的原生图片源和 PixelBin 原件；视觉效果仍需验证。'};
}
export async function openPixelbinImage(manager,root,sessionId,assetIdValue,operationKey,signal,validateResponse,validateJob){
 root=store.validateRoot(root);const {row,bytes,responseBytes}=await loadPixelbinAsset(root,assetIdValue,validateJob);validateResponse(row,responseBytes);if(!['png','jpg'].includes(row.format)||row.bytes>16*1024*1024)throw new SafetyError('原图已保存；当前原生导入仅支持不超过 16 MiB 的 PNG/JPEG',422);previewImageSize(bytes);if(typeof operationKey!=='string'||!operationKey||operationKey.length>250)throw new SafetyError('PixelBin 导入需要稳定操作身份',422);
 const view=manager.views.get(manager.active.get(sessionId));if(!view||view.root!==root||view.navigation?.canReturn)throw new SafetyError('请先打开当前设计工作区并返回原设计；原件已保留',409);manager.fileActionIdle(view,view.epoch);const current=()=>{if(manager.scope(sessionId)!==root)throw new SafetyError('对话工作区已切换，PixelBin 原件保留',409);};
 const operationId='pixelbin-'+sha(Buffer.from(sessionId+'\0'+operationKey)),id=openId(assetIdValue,operationId),reservation={schema:1,kind:'pixelbin-open',id,assetId:assetIdValue,operationId},path=pathFor(root,id);validatePixelbinOpen(reservation);await mkdir(join(path,'..'),{recursive:true});current();if(!atomicCreate(path,encode(reservation)))return reconcilePixelbinImage(manager,root,id,signal,current,validateResponse,validateJob);
 try{const result=await manager.request(sessionId,{action:'resource_image',payload:{title:'PixelBin 图片',assetName:row.assetName,sourceHash:row.sha256,resourceReceiptId:row.id},operationId,initiator:'ai'},signal);if(!result.persisted)throw new SafetyError('原生导入尚未确认',409);return await reconcilePixelbinImage(manager,root,id,signal,current,validateResponse,validateJob);}
 catch(error){error.retained={openId:id,assetId:assetIdValue,sourceRecorded:true};throw error;}
}
