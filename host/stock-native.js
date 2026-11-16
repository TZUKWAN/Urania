/** Native Photo imports are reserved once and recovered from actual saved source receipts. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';
import {atomicCreate} from './persistence.js';
import {readStockImage} from './stock-images.js';

const OPEN=/^stockopen-[a-f0-9]{64}$/,LINK=/^stocklink-[a-f0-9]{64}$/,IMAGE=/^stockimage-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hash=value=>sha(Buffer.from(JSON.stringify(value)));
const directory=root=>workspacePath(root,'design/.designcraft/stock-images');
const openId=(imageId,operationId)=>'stockopen-'+hash([imageId,operationId]);
const linkId=row=>'stocklink-'+hash([row.openId,row.sourceId,row.sourceRevision,row.jobId]);
function pathFor(root,id){if(!OPEN.test(id||'')&&!LINK.test(id||''))throw new SafetyError('图库原生导入身份无效',422);return workspacePath(root,join(directory(root),id+'.json'));}
export function validateStockOpen(row){assertSafeJson(row);if(!row||row.schema!==1||row.kind!=='stock-native-open'||!OPEN.test(row.id||'')||!IMAGE.test(row.imageId||'')||!/^stockphoto-native-[a-f0-9]{64}$/.test(row.operationId||'')||row.id!==openId(row.imageId,row.operationId)||Object.keys(row).some(key=>!['schema','kind','id','imageId','operationId'].includes(key)))throw new SafetyError('图库导入预约无效',409);return true;}
export function validateStockLink(row){assertSafeJson(row);if(!row||row.schema!==1||row.kind!=='stock-native-link'||!LINK.test(row.id||'')||!OPEN.test(row.openId||'')||!IMAGE.test(row.imageId||'')||!/^import-[a-f0-9-]{36}$/.test(row.sourceId||'')||!HASH.test(row.sourceRevision||'')||!/^[a-f0-9-]{36}$/.test(row.jobId||'')||row.sourceId!=='import-'+row.jobId||!HASH.test(row.sha256||'')||row.id!==linkId(row)||Object.keys(row).some(key=>!['schema','kind','id','openId','imageId','sourceId','sourceRevision','jobId','sha256'].includes(key)))throw new SafetyError('图库原生来源关联无效',409);return true;}
async function readRow(root,id){const path=pathFor(root,id),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('图库原生记录无效',409);let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('图库原生记录损坏',409);}if(OPEN.test(id))validateStockOpen(row);else validateStockLink(row);if(row.id!==id)throw new SafetyError('图库原生记录身份不一致',409);return row;}
async function immutable(root,row){await mkdir(directory(root),{recursive:true});if(!atomicCreate(pathFor(root,row.id),Buffer.from(JSON.stringify(row,null,2)+'\n'))){const prior=await readRow(root,row.id);if(JSON.stringify(prior)!==JSON.stringify(row))throw new SafetyError('图库导入记录冲突，原内容保留',409);}}
export async function listStockImports(root){
 let entries;try{entries=await readdir(directory(root),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return {items:[],errors:[]};throw error;}if(entries.length>2500)throw new SafetyError('图库记录超过预算',413);
 const opens=[],links=[],errors=[];for(const item of entries){if(!/^(?:stockopen|stocklink)-[a-f0-9]{64}\.json$/.test(item.name))continue;try{const row=await readRow(root,item.name.slice(0,-5));if(row.kind==='stock-native-open')opens.push(row);else links.push(row);}catch(error){errors.push({id:item.name.slice(0,-5),error:error instanceof SafetyError?error.message:'图库导入记录无法读取'});}}
 for(const row of links)if(!opens.some(open=>open.id===row.openId&&open.imageId===row.imageId))errors.push({id:row.id,error:'图库原生关联缺少匹配预约'});
 return {items:opens.map(row=>({...row,links:links.filter(link=>link.openId===row.id)})),errors,note:'列表记录不证明源字节；核对时会读取实际图片和保存源。'};
}
export async function verifyStockNative(manager,root,reservation,link){
 validateStockOpen(reservation);validateStockLink(link);const {row}=await readStockImage(root,reservation.imageId);
 if(link.openId!==reservation.id||link.imageId!==row.id||link.sha256!==row.sha256)throw new SafetyError('图库原生关联与预约不一致',409);
 const source=await manager.store(root).source(link.sourceId,link.sourceRevision),op=source.meta.operation;
 if(source.meta.engine!=='photocraft'||op?.action!=='resource-import'||op.id!==link.jobId||op.originOperationId!==reservation.operationId||op.resourceReceiptId!==row.id||op.inputHash!==row.sha256||op.kind!=='image')throw new SafetyError('图库原生源缺少匹配的真实保存回执',409);
 const path=workspacePath(root,join(manager.store(root).directory(link.sourceId),'originals',row.sha256+'.'+row.format),{mustExist:true}),info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.size!==row.bytes||sha(await readFile(path))!==row.sha256)throw new SafetyError('图库原生源的导入原件不一致',409);return true;
}
export async function reconcileStockNative(manager,root,sessionId,id,signal,current){
 const reservation=await readRow(root,id);validateStockOpen(reservation);const {row}=await readStockImage(root,reservation.imageId),listing=await listStockImports(root),entry=listing.items.find(item=>item.id===id);if(listing.errors.length)throw new SafetyError('存在损坏的图库导入记录，请先核对',409);if(entry?.links.length>1)throw new SafetyError('图库预约对应多个保存结果，请先核对',409);
 if(entry?.links.length===1){await verifyStockNative(manager,root,reservation,entry.links[0]);signal?.throwIfAborted();current?.();return {status:'confirmed',openId:id,link:entry.links[0],note:'已核对保存的图库图片和原生源，未重复导入。'};}
 const matches=[],store=manager.store(root),deadline=Date.now()+20000;let count=0;
 for(const source of await store.list()){if(source.error)continue;for(const version of await store.versions(source.id)){signal?.throwIfAborted();if(Date.now()>deadline||++count>20000)throw new SafetyError('图库保存源核对超过预算',413);const op=version.operation;if(op?.action==='resource-import'&&op.originOperationId===reservation.operationId&&op.resourceReceiptId===row.id&&op.inputHash===row.sha256&&op.kind==='image')matches.push({sourceId:source.id,sourceRevision:version.revision,jobId:op.id});if(matches.length>1)throw new SafetyError('图库预约对应多个保存源，请先核对',409);}}
 if(matches.length!==1)return {status:'unconfirmed',openId:id,matchingSources:matches.length,note:'尚无唯一匹配的保存源；保留图片和预约，不自动重复导入。'};
 const link={schema:1,kind:'stock-native-link',openId:id,imageId:row.id,...matches[0],sha256:row.sha256};link.id=linkId(link);await verifyStockNative(manager,root,reservation,link);signal?.throwIfAborted();current?.();await immutable(root,link);
 const job=manager.jobs.get(link.jobId),view=job&&manager.views.get(job.viewId);let jobResolved=false,warning=false;
 if(job?.status==='uncertain'&&view?.root===root&&view.sessionId===sessionId)try{const confirmation=await manager.confirmResourceImport(view,{jobId:link.jobId,sourceId:link.sourceId,sourceRevision:link.sourceRevision,resourceReceiptId:row.id,inputHash:row.sha256,kind:'image'});jobResolved=!!confirmation.jobResolved;warning=!jobResolved;}catch{warning=true;}
 return {status:'confirmed',openId:id,link,jobResolved,note:'已核对保存源并登记图库来源；视觉效果尚待验证。'+(warning?' 动作状态仍需核对。':'')};
}
export async function openStockNative(manager,root,sessionId,imageId,operationKey,signal,{initiator='ai',current}={}){
 const {row,candidate}=await readStockImage(root,imageId);if(typeof operationKey!=='string'||!operationKey||operationKey.length>250)throw new SafetyError('图库图片导入需要稳定操作身份',422);
 const view=manager.views.get(manager.active.get(sessionId));if(!view||view.root!==root||view.navigation?.canReturn)throw new SafetyError('请先返回当前设计工作区，图库原件已保留',409);manager.fileActionIdle(view,view.epoch);const operationId='stockphoto-native-'+hash([sessionId,operationKey,imageId]),id=openId(imageId,operationId),reservation={schema:1,kind:'stock-native-open',id,imageId,operationId};validateStockOpen(reservation);signal?.throwIfAborted();current?.();await mkdir(directory(root),{recursive:true});
 if(!atomicCreate(pathFor(root,id),Buffer.from(JSON.stringify(reservation,null,2)+'\n'))){
  const saved=await reconcileStockNative(manager,root,sessionId,id,signal,current);if(saved.status!=='confirmed')return saved;signal?.throwIfAborted();current?.();const active=manager.views.get(manager.active.get(sessionId));if(!active||active.root!==root||active.navigation?.canReturn)throw new SafetyError('请先返回原项目，图库图片源仍保留',409);
  if(active.sourceId===saved.link.sourceId)return {...saved,note:'已核对当前打开的图库图片源和原始来源。'};
  manager.fileActionIdle(active,active.epoch);try{const result=await manager.request(sessionId,{action:'open',sourceId:saved.link.sourceId,operationId:'stockphoto-reopen-'+hash([id,active.id,active.epoch]),initiator},signal);if(manager.scope(sessionId)!==root||result.sourceId!==saved.link.sourceId)throw new SafetyError('图库保存源打开结果尚未确认',409);return {...saved,reopened:true,note:'已打开原有图片源的当前保存版本，并核对最初图库来源；未重复导入。'};}catch(error){error.retained={openId:id,imageId,sourceId:saved.link.sourceId,sourceRecorded:true};throw error;}
 }

 try{const result=await manager.request(sessionId,{action:'resource_image',payload:{title:candidate.title.slice(5,205)||'图库图片',assetName:row.assetName,sourceHash:row.sha256,resourceReceiptId:row.id},operationId,initiator},signal);if(!result.persisted)throw new SafetyError('图库原生导入尚未确认',409);
  const scope=()=>{if(manager.scope(sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对图库导入',409);};scope();return await reconcileStockNative(manager,root,sessionId,id,undefined,scope);
 }catch(error){error.retained={openId:id,imageId,sourceRecorded:true};throw error;}
}
