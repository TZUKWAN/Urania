/** Current DSH session -> one persistent professional App. Completion requires a durable checkpoint. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {realpathSync,createReadStream} from 'node:fs';
import {NativeSourceStore} from './native-source-store.js';
import {ProjectGraph} from './project-graph.js';
import {canonicalLegacyKind} from './native-vector-legacy.js';
import {validateConvertedShapes} from './native-deck-conversion.js';
import {LinkedUpdates} from './linked-updates.js';
import {BrandUpdates} from './brand-updates.js';
import {BrandFontUpdates} from './brand-font-updates.js';
import {assertSafeJson,SafetyError,workspacePath} from './safety.js';
import {validateRoot,readAsset} from './docstore.js';
import {previewImageSize} from './image-header.js';
import {assertPhotoCandidateOnly} from './photo-candidate-proof.js';
import {validateFigmaExport,validateFigmaAsset} from './figma-source.js';
import {validateStaticExternalSvg} from './static-external-svg.js';
import {readMaterializedExternalFile} from './external-skill-bundles.js';
import {validatePresentationInput} from './presentation-admission.js';
import {readOpenAiSvg} from './openai-svg.js';
import {loadPixelbinAsset} from './pixelbin-source.js';
import {loadFigmaMcpImage} from './figma-mcp-image.js';
import {readWorkflowImage} from './workflow-image-import.js';
import {readStitchImage} from './stitch-image-import.js';
import {loadFigmaMcpFile} from './figma-mcp-download.js';
import {readFalRtImage} from './fal-realtime-native.js';
import {readStockImage} from './stock-images.js';
import {validateFigmaMcpResultBytes} from './figma-mcp-service.js';
import {validatePixelbinAssetResponse,validatePixelbinJob} from './pixelbin-service.js';
import {imageBaselineMatches} from '../client/image-adoption.js';
import {atomicWrite} from './persistence.js';
import {checkHostedCommand,singleUndoProof} from './editor-policy.js';
import {sameUint64,compareUint64,uint64Parameter} from '../client/native-protocol.js';
import {EDITOR_CONTEXT_PROTOCOL,VECTOR_CONTRACT,PHOTO_CONTRACT,DECK_CONTRACT,validateNativeIdentity,validateNativeContext,nativeBase,matchesNativeBase,selectedObjectIds,canvasMaterialTarget,sameNativeDocument} from '../client/native-contract.js';

const LIVE_MS=30000;
const serializable=value=>JSON.parse(JSON.stringify(value));
const engineOf={vectorcraft:VECTOR_CONTRACT,photocraft:PHOTO_CONTRACT,deckcraft:DECK_CONTRACT};

export class EditorSessions {
 constructor({resolveScope,onChange=()=>{},operationTimeoutMs=80000}){
  if(!Number.isSafeInteger(operationTimeoutMs)||operationTimeoutMs<1||operationTimeoutMs>80000)throw new TypeError('Invalid editor operation deadline');
  this.resolveScope=resolveScope;this.onChange=onChange;this.operationTimeoutMs=operationTimeoutMs;this.views=new Map();this.active=new Map();this.leases=new Map();this.claims=new Map();this.operationClaims=new Set();this.jobs=new Map();this.stores=new Map();this.disposed=false;
  this.supportsNativeLiveness=true;this.linked=new LinkedUpdates(this);this.brands=new BrandUpdates(this);this.fonts=new BrandFontUpdates(this);
 }
 scope(sessionId,root){
  if(typeof sessionId!=='string'||!sessionId)throw new SafetyError('缺少当前 DSH 对话',422);
  const cwd=this.resolveScope(sessionId);if(!cwd)throw new SafetyError('DSH 对话尚未加载或已关闭',409);
  return realpathSync(validateRoot(root?workspacePath(cwd,root,{mustExist:true}):cwd));
 }
 async resourceReceipt(root,id,expectedHash,assetName,kind){
  if(kind==='deck'&&!/^(?:externalfile|externallfs)-[a-f0-9]{64}$/.test(id||''))throw new SafetyError('外部演示需要已保存的外部原包来源',422);
  if(/^stockimage-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||kind!=='image')throw new SafetyError('图库图片来源身份无效',422);const {row}=await readStockImage(root,id);if(row.sha256!==expectedHash||assetName!==undefined&&row.assetName!==assetName)throw new SafetyError('图库图片原件来源不一致',409);return id;
  }
  if(/^falrtimage-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||kind!=='image')throw new SafetyError('fal 实时图片来源身份无效',422);const {row}=await readFalRtImage(root,id);if(row.sha256!==expectedHash||assetName!==undefined&&row.assetName!==assetName)throw new SafetyError('fal 实时图片原件来源不一致',409);return id;
  }
  if(/^figmamcpfile-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new SafetyError('Figma 素材来源身份无效',422);const {row}=await loadFigmaMcpFile(root,id,validateFigmaMcpResultBytes);if(row.sha256!==expectedHash||assetName!==undefined&&row.assetName!==assetName||kind==='image'&&!['png','jpg'].includes(row.format)||kind==='svg'&&row.format!=='svg'||!['image','svg'].includes(kind))throw new SafetyError('Figma 素材原件来源不一致',409);return id;
  }
  if(/^stitchasset-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new SafetyError('Stitch 图片来源身份无效',422);const {row}=await readStitchImage(root,id);if(row.sha256!==expectedHash||assetName!==undefined&&row.assetName!==assetName)throw new SafetyError('Stitch 图片来源记录不一致',409);return id;
  }
  if(/^(?:externalfile|externallfs)-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||'')||!this.openDesignLibrary)throw new SafetyError('外部文件来源身份无效',422);const saved=await readMaterializedExternalFile(this.openDesignLibrary,root,id);
   if(saved.file.sha256!==expectedHash||assetName!==undefined&&saved.file.assetName!==assetName||kind==='deck'&&!/\.(?:pptx|potx|ppsx)$/i.test(saved.file.file)||kind!=='deck'&&!/\.(?:svg|png|jpe?g)$/i.test(saved.file.file))throw new SafetyError('外部文件原件来源不一致',409);
   if(kind==='deck')validatePresentationInput(saved.bytes,saved.file.file);else if(/\.svg$/i.test(saved.file.file))validateStaticExternalSvg(saved.bytes);return id;
  }
  if(/^workflowimage-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new SafetyError('工作流图片来源身份无效',422);const {row}=await readWorkflowImage(root,id);if(row.sha256!==expectedHash||assetName!==undefined&&row.assetName!==assetName)throw new SafetyError('工作流图片来源记录不一致',409);return id;
  }
  if(/^figmamcpasset-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new SafetyError('Figma MCP 图片来源身份无效',422);const {row}=await loadFigmaMcpImage(root,id,validateFigmaMcpResultBytes);if(row.sha256!==expectedHash||assetName!==undefined&&row.assetName!==assetName)throw new SafetyError('Figma MCP 图片来源记录不一致',409);return id;
  }
  if(/^pixelasset-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new SafetyError('PixelBin 图片来源身份无效',422);const {row,responseBytes}=await loadPixelbinAsset(root,id,validatePixelbinJob);validatePixelbinAssetResponse(row,responseBytes);if(!['png','jpg'].includes(row.format)||row.sha256!==expectedHash||assetName!==undefined&&row.assetName!==assetName)throw new SafetyError('PixelBin 图片来源记录不一致',409);return id;
  }
  if(/^openaisvgjob-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new SafetyError('OpenAI SVG 导入来源身份无效',422);const {job}=await readOpenAiSvg(root,id);if(job.asset.sha256!==expectedHash||assetName!==undefined&&job.asset.name!==assetName)throw new SafetyError('OpenAI SVG 原件来源记录不一致',409);return id;
  }
  if(/^figmaexport-[a-f0-9]{64}$/.test(id||'')){
   if(!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new SafetyError('Figma 导入来源身份无效',422);
   const path=workspacePath(root,join('design','.designcraft','figma-sources',id+'.json'),{mustExist:true});if((await stat(path)).size>16384)throw new SafetyError('Figma 来源记录超过预算',413);
   const receipt=JSON.parse(await readFile(path,'utf8'));validateFigmaExport(receipt);if(receipt.id!==id||receipt.sha256!==expectedHash||assetName!==undefined&&receipt.assetName!==assetName)throw new SafetyError('Figma 原件来源记录不一致',409);
   validateFigmaAsset(receipt,readAsset(root,receipt.assetName));return id;
  }
  if(!/^resource-[a-f0-9]{64}$/.test(id||'')||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw new SafetyError('资源导入来源身份无效',422);
  const path=workspacePath(root,join('design','.designcraft','v2','resource-imports',id+'.json'),{mustExist:true});
  if((await stat(path)).size>16384)throw new SafetyError('资源来源记录超过预算',413);
  const receipt=JSON.parse(await readFile(path,'utf8'));assertSafeJson(receipt);
  const library=this.openDesignLibrary,index=library?.index(),pack=index?.packages.get(receipt.packageId),entry=pack?.fileMap.get(receipt.file);
  const expectedId=entry&&'resource-'+createHash('sha256').update(Buffer.from(JSON.stringify([index.revision,pack.id,entry.path,entry.gitSha1]))).digest('hex');
  const prefix=entry&&'od-'+entry.gitSha1.slice(0,20),name=receipt.assetName;
  if(!entry||entry.mode==='120000'||receipt.schema!==1||receipt.kind!=='resource'||receipt.id!==id||id!==expectedId||receipt.repository!==index.repository||receipt.revision!==index.revision||receipt.gitSha1!==entry.gitSha1||receipt.bytes!==entry.bytes||receipt.sha256!==expectedHash||typeof name!=='string'||!name.startsWith(prefix)||!/^[a-zA-Z0-9][\w.-]{0,119}$/.test(name)||assetName!==undefined&&name!==assetName||receipt.source!==library.source(pack.id+'/'+entry.path)||receipt.licenseSource!==library.source('LICENSE'))throw new SafetyError('资源来源记录与固定文件不一致',409);
  const bytes=readAsset(root,name);if(!bytes||bytes.length!==entry.bytes||createHash('sha256').update(bytes).digest('hex')!==expectedHash)throw new SafetyError('资源原件缺失或摘要不一致',409);
  library.verify(bytes,entry);return id;
 }
 async confirmResourceImport(view,{jobId,sourceId,sourceRevision,resourceReceiptId,inputHash,kind}){
  if(!view||this.active.get(view.sessionId)!==view.id||this.scope(view.sessionId)!==view.root||!['svg','image','deck'].includes(kind)||!/^[a-f0-9-]{36}$/.test(jobId||'')||!/^[a-f0-9]{64}$/.test(sourceRevision||''))throw new SafetyError('资源核对上下文无效',409);
  await this.resourceReceipt(view.root,resourceReceiptId,inputHash,undefined,kind);
  const store=this.store(view.root),source=await store.source(sourceId,sourceRevision),op=source.meta.operation;
  if(op?.action!=='resource-import'||op.id!==jobId||op.resourceReceiptId!==resourceReceiptId||op.inputHash!==inputHash||op.kind!==kind||source.meta.engine!==(kind==='svg'?'vectorcraft':kind==='deck'?'deckcraft':'photocraft')||kind!=='svg'&&sourceId!=='import-'+jobId)throw new SafetyError('保存源没有匹配的资源导入回执',409);
  const external=/^(?:externalfile|externallfs)-/.test(resourceReceiptId);
  if(resourceReceiptId.startsWith('stockimage-')&&!/^stockphoto-native-[a-f0-9]{64}$/.test(op.originOperationId||''))throw new SafetyError('图库原生源缺少稳定预约身份',409);
  if(external&&(kind==='deck'||op.originOperationId!==undefined)&&!/^external-native-[a-f0-9]{64}$/.test(op.originOperationId||''))throw new SafetyError('外部原生源预约身份无效',409);
  const receiptPath=resourceReceiptId.startsWith('stockimage-')?join('design','.designcraft','stock-images',resourceReceiptId+'.json'):resourceReceiptId.startsWith('figmaexport-')?join('design','.designcraft','figma-sources',resourceReceiptId+'.json'):resourceReceiptId.startsWith('openaisvgjob-')?join('design','.designcraft','openai-svg',resourceReceiptId+'.json'):resourceReceiptId.startsWith('workflowimage-')?join('design','.designcraft','workflow-images',resourceReceiptId+'.json'):resourceReceiptId.startsWith('falrtimage-')?join('design','.designcraft','fal-realtime-native',resourceReceiptId+'.json'):resourceReceiptId.startsWith('stitchasset-')?join('design','.designcraft','stitch-assets',resourceReceiptId+'.json'):resourceReceiptId.startsWith('figmamcpfile-')?join('design','.designcraft','figmamcp-files',resourceReceiptId+'.json'):resourceReceiptId.startsWith('figmamcpasset-')?join('design','.designcraft','figmamcp-assets',resourceReceiptId+'.json'):resourceReceiptId.startsWith('pixelasset-')?join('design','.designcraft','pixelbin-assets',resourceReceiptId+'.json'):join('design','.designcraft','v2','resource-imports',resourceReceiptId+'.json');
  const receipt=JSON.parse(await readFile(workspacePath(view.root,receiptPath,{mustExist:true}),'utf8'));
  const deckFormat=kind==='deck'?/\.(pptx|potx|ppsx)$/i.exec(receipt.file||''):null;if(kind==='deck'&&!deckFormat)throw new SafetyError('外部演示原件格式不一致',409);
  const extension=kind==='svg'?'svg':kind==='deck'?deckFormat[1].toLowerCase():receipt.format==='png'||/\.png$/i.test(receipt.file||'')?'png':'jpg',original=workspacePath(view.root,join(store.directory((kind==='svg'?'generated-':'import-')+jobId),'originals',inputHash+'.'+extension),{mustExist:true});
  if((await stat(original)).size>16*1024*1024||createHash('sha256').update(await readFile(original)).digest('hex')!==inputHash)throw new SafetyError('资源原件与保存回执不一致',409);
  const head=await store.head(sourceId);if(!head)throw new SafetyError('资源原生源不存在',404);
  if(this.active.get(view.sessionId)!==view.id||this.scope(view.sessionId)!==view.root)throw new SafetyError('工作区已切换，停止核对',409);
  await this.graph(view.root).synchronizeSource({sourceId,sourceRevision:head.revision});
  const job=this.jobs.get(jobId);let jobResolved=false;
  if(this.active.get(view.sessionId)===view.id&&job&&job.viewId===view.id&&job.epoch===view.epoch&&job.status==='uncertain'&&job.executionStartedAt&&job.resourceReceiptId===resourceReceiptId&&job.sourceId===sourceId&&job.saved===sourceRevision&&(!external||op.originOperationId===undefined||op.originOperationId===job.operationId)&&(!resourceReceiptId.startsWith('stockimage-')||op.originOperationId===job.operationId)){
   clearTimeout(job.timer);job.status='succeeded';job.error=null;
   job.result={ok:true,jobId,sourceId,sourceRevision,persisted:true,reconciled:true,historical:head.revision!==sourceRevision,scope:'saved-native-source',appliedAfterCancel:!!job.cancelRequested,note:'已核对原件、原生保存源和来源；视觉效果仍需单独验证。'};
   if(await this.record(job))jobResolved=true;else{job.status='uncertain';job.result=null;job.error='源已保存，但核对记录尚未写入';}
  }
  return {sourceId,sourceRevision,historical:head.revision!==sourceRevision,jobResolved,scope:'saved-native-source'};
 }
 store(root){let store=this.stores.get(root);if(!store){store=new NativeSourceStore(root);this.stores.set(root,store);}return store;}
 graph(root){return new ProjectGraph(root,this.store(root));}
 async placementReceipts(root,sources){
  const receipts=new Map();let count=0;
  for(const source of sources||await this.store(root).list()){
   if(source.error)continue;
   for(const version of (await this.store(root).versions(source.id)).reverse()){
    if(++count>20000)throw new SafetyError('素材恢复历史超过预算，请拆分项目',413);
    const operation=version.operation;
    if(operation?.action==='place'&&!receipts.has(operation.id))receipts.set(operation.id,{assetId:operation.assetId,sourceId:source.id,sourceRevision:version.revision,nativeId:operation.nativeId});
   }
  }
  return receipts;
 }
 async projectState(sessionId,directory){
  const root=this.scope(sessionId,directory),recoverablePlacements=[],recoverableInstanceUpdates=[],recoverableConversions=[],recoveryErrors=[],conversionStatuses=new Map();
  // Rebuild source relations from actual committed native declarations after a
  // lost post-save graph acknowledgement. No native operation is replayed.
  for(const source of await this.store(root).list()){
   if(source.error||!['vectorcraft','deckcraft'].includes(source.engine))continue;
   try{await this.graph(root).synchronizeSource({sourceId:source.id,sourceRevision:source.revision});}
   catch(error){recoveryErrors.push({sourceId:source.id,error:error.message});}
  }
  const project=await this.graph(root).inspect();
  const dir=workspacePath(root,join('design','.designcraft','v2','operations'));
  let names;try{names=await readdir(dir);}catch(error){if(error.code!=='ENOENT')throw error;names=[];}
  if(names.length>10000)throw new SafetyError('项目操作记录超过预算',413);
  for(const name of names){
   if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
   const path=workspacePath(root,join(dir,name)),size=(await stat(path)).size;if(size>2*1024*1024)throw new SafetyError('素材操作记录超过预算',413);
   let record;try{record=JSON.parse(await readFile(path,'utf8'));}catch{recoveryErrors.push({file:name,error:'操作记录无法读取，请保留当前源再核对素材使用处'});continue;}
   if(size>1024*1024&&record.action!=='convert_svg')throw new SafetyError('素材操作记录超过预算',413);
   if(record.action==='place'&&record.placementReceipt&&record.status!=='succeeded')recoverablePlacements.push({jobId:record.id,sourceId:record.placementReceipt.sourceId,assetId:record.placementReceipt.assetId});
   if(record.action==='convert_svg')conversionStatuses.set(record.id,record.status);
  }
  for(const [jobId,receipt] of await this.placementReceipts(root,project.sources)){
   if(!project.instances.some(instance=>instance.id==='use-'+jobId)&&!recoverablePlacements.some(pending=>pending.jobId===jobId))recoverablePlacements.push({jobId,sourceId:receipt.sourceId,assetId:receipt.assetId});
  }
  for(const receipt of await this.instanceUpdateReceipts(root,project.sources)){
   const edit=project.edits.find(item=>item.id===receipt.editId);
   if(edit?.applyOperationId!==receipt.operationId)recoverableInstanceUpdates.push(receipt);
  }
  for(const receipt of await this.svgConversionReceipts(root,project.sources))if(conversionStatuses.get(receipt.operationId)!=='succeeded')recoverableConversions.push(receipt);
  return {...project,recoverablePlacements,recoverableInstanceUpdates,recoverableConversions,recoveryErrors};
 }
 async brandState(sessionId){
  const root=this.scope(sessionId),view=this.views.get(this.active.get(sessionId));
  if(!view||view.root!==root)throw new SafetyError('请先打开该对话的设计工作区',409);
  return {...await this.brands.inspect(view),fontState:await this.fonts.inspect(view)};
 }
 async confirmLinked(view,{epoch,updateId}){
  if(view.epoch!==epoch)throw new SafetyError('设计已切换，请重新核对',409);
  const confirmed=await this.graph(view.root).checkLinkedCompletion(updateId,{historical:true});
  for(const job of this.jobs.values()){
   if(job.root!==view.root||job.status!=='uncertain'||job.linkedUpdateId!==updateId)continue;
   clearTimeout(job.timer);job.status='succeeded';job.error=null;
   job.result={ok:true,persisted:true,reconciled:true,jobId:job.id,linkedUpdateId:updateId,confirmed};
   if(!await this.record(job))throw new SafetyError('源文件回执已核对，操作记录尚未写入',503);
  }
  return confirmed;
 }
 async sourceOrigins(view,{epoch,sourceRevision}){
  if(epoch!==view.epoch||!view.sourceId||sourceRevision!==view.sourceRevision||view.saving||view.switching)throw new SafetyError('原生来源补入上下文已改变',409);
  const plan=await this.graph(view.root).originAssignments(view.sourceId,sourceRevision);
  if(!plan.origins.length)return plan;
  view.originPlan={...plan,id:randomUUID(),epoch};return {...plan,planId:view.originPlan.id};
 }
 async instanceUpdateReceipts(root,sources){
  const found=[];let count=0;
  for(const source of sources||await this.store(root).list()){
   if(source.error)continue;
   for(const version of await this.store(root).versions(source.id)){
    if(++count>20000)throw new SafetyError('原位回写恢复历史超过预算',413);
    if(version.operation?.action==='apply-instance')found.push({operationId:version.operation.id,editId:version.operation.editId,sourceId:source.id,sourceRevision:version.revision});
   }
  }return found;
 }
 async svgConversionReceipts(root,sources){
  const found=[];let count=0;
  for(const source of sources||await this.store(root).list()){
   if(source.error)continue;
   for(const version of await this.store(root).versions(source.id)){
    if(++count>20000)throw new SafetyError('SVG 转换恢复历史超过预算',413);
    if(version.operation?.action==='convert-svg')found.push({operationId:version.operation.id,sourceId:source.id,sourceRevision:version.revision});
   }
  }return found;
 }
 async reconcileSvgConversion(view,{jobId,epoch}){
  if(epoch!==undefined&&epoch!==view.epoch||typeof jobId!=='string'||!/^[a-f0-9-]{36}$/.test(jobId))throw new SafetyError('SVG 转换恢复身份无效',409);
  const candidates=(await this.svgConversionReceipts(view.root)).filter(item=>item.operationId===jobId);
  if(candidates.length!==1)throw new SafetyError('没有唯一的已保存 SVG 转换回执；不会重复执行',409);
  const receipt=await this.graph(view.root).verifySavedSvgConversion(candidates[0]),head=await this.store(view.root).head(receipt.sourceId),historical=head?.revision!==receipt.sourceRevision,job=this.jobs.get(jobId);
  if(job&&job.viewId===view.id){
   clearTimeout(job.timer);job.conversionReceipt=receipt;job.status='succeeded';job.error=null;job.result={ok:true,jobId,persisted:true,reconciled:true,historical,conversionReceipt:receipt};
   if(!await this.record(job))throw new SafetyError('已核对转换源，但操作确认尚未落盘',503);job.resolve?.(job.result);
  }else{
   const file=workspacePath(view.root,join('design','.designcraft','v2','operations',jobId+'.json'));let saved={};
   try{if((await stat(file)).size>2*1024*1024)throw new SafetyError('转换操作记录超过预算',413);saved=JSON.parse(await readFile(file,'utf8'));assertSafeJson(saved);if(saved.id!==jobId||saved.action!=='convert_svg')throw new SafetyError('转换操作记录身份不一致',409);}
   catch(error){if(error.code!=='ENOENT')throw error;saved={id:jobId,action:'convert_svg',sourceId:receipt.sourceId,at:new Date().toISOString()};}
   await mkdir(workspacePath(view.root,join('design','.designcraft','v2','operations')),{recursive:true});
   atomicWrite(file,JSON.stringify({...saved,status:'succeeded',error:null,conversionReceipt:receipt,reconciledAt:new Date().toISOString()},null,2));
  }
  return {ok:true,reconciled:true,historical,conversionReceipt:receipt};
 }
 async reconcileInstanceUpdate(view,{jobId}){
  const receipt=(await this.instanceUpdateReceipts(view.root)).find(item=>item.operationId===jobId);
  if(!receipt)throw new SafetyError('原生源中没有此原位回写的已提交回执；不会重复执行',409);
  const update=await this.graph(view.root).completeInstanceApply(receipt),job=this.jobs.get(jobId);
  if(job&&job.viewId===view.id){
   clearTimeout(job.timer);job.instanceUpdate=update;job.status='succeeded';job.error=null;
   job.result={ok:true,jobId,persisted:true,reconciled:true,instanceUpdate:update,...receipt};
   if(!await this.record(job))throw new SafetyError('素材关系已恢复，操作确认尚未落盘',503);
   job.resolve?.(job.result);
  }
  return {ok:true,reconciled:true,instanceUpdate:update};
 }
 async addMaterial(view,{epoch,jobId,sourceRevision,sourceHash,engineState,format,title,graphRevision,derivativeBytes,preview},input){
  const job=this.jobs.get(jobId);
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||!['derive','apply_instance','apply_linked'].includes(job.action)||!job.executionStartedAt||job.status!=='running')throw new SafetyError('素材动作未获许可或已过期',409);
  if(sourceRevision!==view.sourceRevision||sourceRevision!==job.saved)throw new SafetyError('素材源检查点已改变，未登记错配版本',409);
  const hasPreview=preview!==undefined,limit=4*1024*1024;
  if(hasPreview&&(format!=='svg'||!Number.isSafeInteger(derivativeBytes)||derivativeBytes<1||derivativeBytes>limit||!Number.isSafeInteger(preview?.bytes)||preview.bytes<1||preview.bytes>limit||typeof preview.sha256!=='string'||!/^[a-f0-9]{64}$/.test(preview.sha256))||!hasPreview&&derivativeBytes!==undefined)throw new SafetyError('SVG 与兼容预览的封包标识无效',422);
  const chunks=[];let size=0;for await(const chunk of input){size+=chunk.byteLength;if(size>limit*(hasPreview?2:1))throw new SafetyError('素材封包超过派生物预算',413);chunks.push(chunk);view.lastSeen=Date.now();}
  const body=Buffer.concat(chunks);let bytes=body,png;
  if(hasPreview){
   if(size!==derivativeBytes+preview.bytes)throw new SafetyError('SVG 与兼容预览的封包长度不符',422);
   bytes=body.subarray(0,derivativeBytes);png=body.subarray(derivativeBytes);
   if(createHash('sha256').update(png).digest('hex')!==preview.sha256)throw new SafetyError('SVG 兼容预览完整性校验失败，未登记素材',422);
  }
  const result=await this.graph(view.root).addDerivative({operationId:job.id,baseRevision:graphRevision,sourceId:view.sourceId,sourceRevision,sourceHash,engineState,format,bytes,preview:png,title});
  job.material=result;await this.record(job);return result;
 }
 async startInstanceEdit(view,{epoch,jobId}){
  const job=this.jobs.get(jobId);
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||job.action!=='edit_instance'||!job.executionStartedAt||job.status!=='running')throw new SafetyError('实例编辑动作已过期或未获许可',409);
  if(view.sourceId!==job.sourceId||!sameUint64(view.savedEngineRevision,view.document?.revision))throw new SafetyError('请先保存当前原设计',409);
  const graph=this.graph(view.root),input={instanceId:job.payload.instanceId,sourceId:view.sourceId};
  let operationId=job.id;
  if(job.payload.editId){
   const edit=(await graph.read()).manifest.edits?.[job.payload.editId];
   if(!edit||edit.instanceId!==input.instanceId||edit.phase!=='editing')throw new SafetyError('待恢复的实例编辑不存在或已完成',409);
   operationId=edit.id.slice(5);
  }
  const result=await graph.startInstanceEdit({operationId,...input});
  job.instanceEdit=result.edit;if(!await this.record(job))throw new SafetyError('分叉已保留，操作记录尚未落盘，请从待编辑实例恢复',503);
  return result;
 }
 async prepareInstanceApply(view,{epoch,jobId}){
  const job=this.jobs.get(jobId);
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||job.action!=='apply_instance'||!job.executionStartedAt||job.status!=='running'||!job.material||view.sourceId!==job.returnTarget?.sourceId)throw new SafetyError('原位回写动作未获许可或上下文已改变',409);
  const plan=await this.graph(view.root).prepareInstanceApply({editId:job.instanceEdit.id,assetId:job.material.asset.id,sourceId:view.sourceId});
  if(plan.baseRevision!==view.sourceRevision||!sameUint64(view.savedEngineRevision,view.document?.revision))throw new SafetyError('原设计已有未保存或外部修改，请先保存并刷新',409);
  job.applyPlan={...plan,sourceId:view.sourceId};
  if(!await this.record(job))throw new SafetyError('回写准备记录尚未落盘，没有开始替换图片',503);
  return plan;
 }
 async recordLegacyNativeKind(view,{epoch,jobId,nativeKind}){
  const job=this.jobs.get(jobId),plan=job?.applyPlan;
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||job.action!=='apply_instance'||!job.executionStartedAt||job.status!=='running'||!plan?.legacyGroup||plan.sourceId!==view.sourceId||plan.baseRevision!==view.sourceRevision)throw new SafetyError('旧 SVG 原生回执不属于当前回写动作',409);
  assertSafeJson(nativeKind);
  const serialized=JSON.stringify(nativeKind);if(typeof serialized!=='string'||serialized.length>4096)throw new SafetyError('旧 SVG 原生边框回执缺失或超过预算',413);
  const expected=canonicalLegacyKind(nativeKind,plan.asset.sourceHash);
  if(plan.nativeKind&&canonicalLegacyKind(plan.nativeKind,plan.asset.sourceHash)!==expected)throw new SafetyError('旧 SVG 原生边框回执已改变，未保存',409);
  plan.nativeKind=serializable(nativeKind);
  if(!await this.record(job))throw new SafetyError('旧 SVG 边框回执未能持久保存，原设计尚未提交',503);
  return {recorded:true};
 }
 async prepareSvgConversion(view,{epoch,jobId}){
  const job=this.jobs.get(jobId);
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||job.action!=='convert_svg'||!job.executionStartedAt||job.status!=='running'||view.engine!=='deckcraft'||job.sourceId!==view.sourceId)throw new SafetyError('SVG 转换动作未获许可或上下文已改变',409);
  const plan=await this.graph(view.root).prepareSvgConversion({instanceId:job.payload.instanceId,sourceId:view.sourceId});
  if(plan.baseRevision!==view.sourceRevision||!sameUint64(view.savedEngineRevision,view.document?.revision)||view.document?.page?.nativePage?.kind!=='slide'||!sameUint64(view.document.page.nativePage.id,plan.nativePage.id))throw new SafetyError('请先保存并切换到该 SVG 所在幻灯片',409);
  job.conversionPlan=plan;if(!await this.record(job))throw new SafetyError('SVG 转换准备记录未能保存，没有执行转换',503);
  return plan;
 }
 async recordSvgConversion(view,{epoch,jobId,result}){
  const job=this.jobs.get(jobId),plan=job?.conversionPlan;
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||job.action!=='convert_svg'||!job.executionStartedAt||job.status!=='running'||!plan||plan.sourceId!==view.sourceId||plan.baseRevision!==view.sourceRevision)throw new SafetyError('SVG 转换回执不属于当前动作',409);
  assertSafeJson(result);
  const originalId=Number(plan.instance.nativeId);
  if(!result||result.originalId!==originalId||result.originalRetained!==true||result.originalHidden!==true||!Array.isArray(result.ids)||!Array.isArray(result.warnings)||result.warnings.length>32||result.warnings.some(w=>typeof w!=='string'||w.length>500))throw new SafetyError('SVG 转换缺少完整的原生结果',409);
  const canonical=validateConvertedShapes(originalId,result.nativeShapes),ids=result.nativeShapes.map(shape=>shape.id),textCount=result.nativeShapes.filter(shape=>shape.textBox===true).length;
  if(JSON.stringify(ids)!==JSON.stringify(result.ids)||result.textCount!==textCount||textCount>0&&!result.warnings.length)throw new SafetyError('SVG 转换对象或文字提示与原生结果不一致',409);
  const shapesHash=createHash('sha256').update(canonical).digest('hex');
  if(plan.shapesHash&&plan.shapesHash!==shapesHash)throw new SafetyError('SVG 转换回执已改变，没有保存',409);
  plan.nativeShapes=serializable(result.nativeShapes);plan.shapeIds=ids;plan.shapesHash=shapesHash;plan.textCount=textCount;plan.warnings=[...result.warnings];
  if(!await this.record(job))throw new SafetyError('SVG 转换回执未能持久保存，原设计尚未提交',503);
  return {recorded:true,shapeCount:ids.length,textCount,warnings:plan.warnings};
 }
 async reconcilePlacement(view,{jobId}){
  if(typeof jobId!=='string'||!/^[a-f0-9-]{36}$/.test(jobId))throw new SafetyError('素材恢复身份无效',422);
  const file=workspacePath(view.root,join('design','.designcraft','v2','operations',jobId+'.json'));
  let saved={id:jobId,action:'place'};
  try{if((await stat(file)).size>1024*1024)throw new SafetyError('素材操作记录超过预算',413);saved=JSON.parse(await readFile(file,'utf8'));assertSafeJson(saved);}catch(error){if(error.status||error.code&&error.code!=='ENOENT')throw error;}
  const receipt=(await this.placementReceipts(view.root)).get(jobId);
  if(!receipt)throw new SafetyError('原生源中没有已提交的素材回执；不会重复放入',409);
  const placement=await this.graph(view.root).bind({operationId:jobId,...receipt});saved.placementReceipt=receipt;
  const job=this.jobs.get(jobId);
  if(job&&job.root===view.root){
   clearTimeout(job.timer);job.placement=placement;job.status='succeeded';job.error=null;
   job.result={ok:true,jobId,sourceId:saved.placementReceipt.sourceId,sourceRevision:saved.placementReceipt.sourceRevision,persisted:true,reconciled:true,placement};
   if(!await this.record(job))throw new SafetyError('素材关系已写入，操作确认仍未落盘，请再次核对',503);
   job.resolve?.(job.result);
  }else atomicWrite(file,JSON.stringify({...saved,status:'succeeded',error:null,placement,reconciledAt:new Date().toISOString()},null,2));
  return {ok:true,placement,reconciled:true};
 }
 async reconcileForSession(sessionId,payload){
  const view=this.views.get(this.active.get(sessionId));if(!view||view.root!==this.scope(sessionId))throw new SafetyError('当前对话的设计工作区未连接',409);
  return this.reconcilePlacement(this.getView(view.id,view.token),payload);
 }
 async reconcileUpdateForSession(sessionId,payload){
  const view=this.views.get(this.active.get(sessionId));if(!view||view.root!==this.scope(sessionId))throw new SafetyError('当前对话的设计工作区未连接',409);
  return this.reconcileInstanceUpdate(this.getView(view.id,view.token),payload);
 }
 async reconcileConversionForSession(sessionId,payload){
  const view=this.views.get(this.active.get(sessionId));if(!view||view.root!==this.scope(sessionId))throw new SafetyError('当前对话的设计工作区未连接',409);
  return this.reconcileSvgConversion(this.getView(view.id,view.token),{...payload,epoch:view.epoch});
 }
 leaseKey(view,id=view.sourceId){return view.root+'\0'+id;}
 getView(id,token){
  if(this.disposed)throw new SafetyError('设计运行时已停止',503);
  const view=this.views.get(id);
  if(!view||view.token!==token||this.active.get(view.sessionId)!==id)throw new SafetyError('编辑会话已失效；未覆盖设计',409);
  const liveRoot=this.resolveScope(view.sessionId);
  if(liveRoot&&this.scope(view.sessionId,view.root)!==view.root)throw new SafetyError('DSH 工作目录已改变',409);
  view.lastSeen=Date.now();return view;
 }
 visible(view){return {id:view.id,token:view.token,sessionId:view.sessionId,root:view.root,sourceId:view.sourceId,epoch:view.epoch,sourceRevision:view.sourceRevision,document:view.document,ready:view.ready,editorProtocol:view.editorProtocol,engine:view.engine,engineContract:engineOf[view.engine]};}
 register({sessionId,root,clientId,editorProtocol=1}){
  if(![1,EDITOR_CONTEXT_PROTOCOL].includes(editorProtocol))throw new SafetyError('未支持的编辑上下文协议',422);
  const directory=this.scope(sessionId,root);let old=this.views.get(this.active.get(sessionId));
  for(const candidate of this.views.values())if(candidate!==old&&!candidate.saving&&!candidate.switching&&Date.now()-candidate.lastSeen>LIVE_MS)this.fence(candidate,'闲置编辑窗口已断开');
  if(this.views.size>=16&&!old)throw new SafetyError('同时打开的设计窗口超过16个',429);
  if(typeof clientId!=='string'||clientId.length>100)throw new SafetyError('缺少编辑窗口标识',422);
  if(old&&old.clientId===clientId&&old.root===directory){
   if(old.editorProtocol===editorProtocol){old.lastSeen=Date.now();return this.visible(old);}
   if(old.saving||old.switching||[...this.jobs.values()].some(job=>job.viewId===old.id&&['queued','running','uncertain'].includes(job.status)))throw new SafetyError('旧表面仍有动作未确认，请先结束后再升级协议',423);
   if(old.document&&!sameUint64(old.savedEngineRevision,old.document.revision))throw new SafetyError('旧表面仍有未保存内容，未升级或覆盖原作品',409);
   this.fence(old,'编辑上下文协议已升级');old=null;
  }
  if(old&&(old.saving||old.switching||Date.now()-old.lastSeen<LIVE_MS))throw new SafetyError('此对话正在另一个设计窗口中编辑，请先保存并关闭该窗口',423);
  if(old)this.fence(old,'原编辑窗口已失去连接');
  const view={id:randomUUID(),token:randomUUID(),clientId,sessionId,root:directory,sourceId:null,epoch:randomUUID(),sourceRevision:null,document:null,ready:false,lastSeen:Date.now(),catalog:[],editorProtocol};
  this.views.set(view.id,view);this.active.set(sessionId,view.id);return this.visible(view);
 }
 fence(view,reason){
  if(view.sourceId&&this.leases.get(this.leaseKey(view))===view.id)this.leases.delete(this.leaseKey(view));
  this.active.delete(view.sessionId);this.views.delete(view.id);
  for(const job of this.jobs.values())if(job.viewId===view.id&&!['succeeded','failed','cancelled'].includes(job.status)){
   job.status=job.executionStartedAt?'uncertain':'cancelled';job.error=reason;clearTimeout(job.timer);job.reject?.(new SafetyError(reason,409));this.record(job);
  }
 }
 async select(view,{sourceId,title,jobId,engine,preserveNavigation=false,imagePlanId}){
  if(view.saving||view.switching)throw new SafetyError('当前专业源正在保存或切换',423);
  if(typeof sourceId!=='string')throw new SafetyError('缺少专业源标识',422);
  const imagePlan=imagePlanId?view.imagePlan:null;
  if(imagePlanId&&(!imagePlan||imagePlan.id!==imagePlanId||imagePlan.epoch!==view.epoch||imagePlan.sourceId!==view.sourceId||imagePlan.sourceId!==sourceId||imagePlan.baseRevision!==view.sourceRevision))throw new SafetyError('图片候选采用许可已过期，原图片未覆盖',409);
  this.store(view.root).directory(sourceId);
  const key=this.leaseKey(view,sourceId);let owner=this.views.get(this.leases.get(key));
  if(this.claims.has(key)&&this.claims.get(key)!=='linked:'+jobId)throw new SafetyError('此专业源正在被另一个窗口打开',423);
  if(owner&&owner.id!==view.id&&(owner.saving||owner.switching||Date.now()-owner.lastSeen<LIVE_MS))throw new SafetyError('此专业源正在另一个窗口编辑',423);
  const job=jobId?this.jobs.get(jobId):null;
  if(jobId&&(!job||job.viewId!==view.id||job.status!=='running'||!job.executionStartedAt||!['new','create_svg','open','open_asset','return_to_design','edit_instance','apply_instance','apply_linked','resume_linked', 'brand','html_convert','image_adopt','image_undo','resource_image','resource_deck'].includes(job.action)))throw new SafetyError('动作未获执行许可或已停止，不能切换当前专业源',409);
  if(job?.cancelRequested&&['html_convert','image_adopt','image_undo','resource_image','resource_deck'].includes(job.action))throw new SafetyError('动作已请求停止，未开始切换作品',499);
  const running=[...this.jobs.values()].find(job=>job.viewId===view.id&&job.status==='running');
  if(running&&running.id!==jobId)throw new SafetyError('当前设计动作尚未结束，请先停止或等待',423);
  if(title!=null&&(typeof title!=='string'||title.length>200))throw new SafetyError('作品名称无效',422);
  view.switching=true;this.claims.set(key,view.id);
  try{
  const head=await this.store(view.root).head(sourceId);
  const selectedEngine=head?.meta.engine||engine||'vectorcraft';
  if(!Object.hasOwn(engineOf,selectedEngine))throw new SafetyError('此专业源的持续编辑桥尚未接入，当前作品未改变',409);
  if(engine&&engine!==selectedEngine)throw new SafetyError('请求引擎与原生源类型不一致，未打开或覆盖',409);
  if(preserveNavigation&&!view.navigation?.canReturn)throw new SafetyError('来源返回上下文已改变，未延续旧导航',409);
  const previousNavigation=view.navigation;
  if(['return_to_design','apply_instance','apply_linked'].includes(job?.action)&&sourceId!==job.returnTarget?.sourceId)throw new SafetyError('返回目标与原设计不一致，未切换',409);
  if(job?.action==='brand'&&sourceId!==job.sourceId)throw new SafetyError('品牌更新只能重新打开原设计',409);
  if(job?.action==='html_convert'&&sourceId!=='import-'+job.id)throw new SafetyError('网页转换只能打开本次转换的新演示源',409);
  if(job?.action==='resource_image'&&(sourceId!=='import-'+job.id||engine!=='photocraft'))throw new SafetyError('资源图片只能打开本次导入的新图片源',409);
  if(job?.action==='resource_deck'&&(sourceId!=='import-'+job.id||engine!=='deckcraft'||head))throw new SafetyError('外部演示只能打开本次导入的新演示源',409);
  if(['image_adopt','image_undo'].includes(job?.action)&&sourceId!==job.sourceId)throw new SafetyError('图片候选只能在指定原图片中采用或撤销',409);
  if(job?.action==='edit_instance'&&sourceId!==job.instanceEdit?.sourceId&&sourceId!==job.returnTarget?.sourceId)throw new SafetyError('实例编辑只能打开已核对的独立分叉',409);
  if(this.disposed||this.active.get(view.sessionId)!==view.id)throw new SafetyError('编辑窗口在打开期间已关闭',409);
  owner=this.views.get(this.leases.get(key));
  if(owner&&owner.id!==view.id&&(owner.saving||owner.switching||Date.now()-owner.lastSeen<LIVE_MS))throw new SafetyError('此专业源正在另一个窗口编辑',423);
  if(owner&&owner.id!==view.id)this.fence(owner,'专业源编辑窗口已断开');
  if(view.sourceId&&this.leases.get(this.leaseKey(view))===view.id)this.leases.delete(this.leaseKey(view));
  if(['open_asset','edit_instance'].includes(job?.action)&&job.returnTarget===undefined)job.returnTarget=view.document&&view.sourceId?{sourceId:view.sourceId,title:view.title,sourceRevision:view.sourceRevision}:null;
  view.navigation=['open_asset','edit_instance'].includes(job?.action)&&job.returnTarget&&sourceId!==job.returnTarget.sourceId?{canReturn:true,...job.returnTarget,...(job.instanceEdit?{editId:job.instanceEdit.id}:{} )}:preserveNavigation?previousNavigation:null;
  view.sourceId=sourceId;view.title=head?.meta.title||title||'未命名设计';view.engine=selectedEngine;
  view.epoch=randomUUID();view.document=null;view.ready=false;view.sourceRevision=head?.revision||null;view.savedEngineRevision=null;view.pendingOpenRevision=head?.revision||null;view.catalog=[];view.reportSequence=0;
  if(imagePlan){imagePlan.epoch=view.epoch;view.imagePlan=imagePlan;}else view.imagePlan=null;
  this.leases.set(key,view.id);
  if(job){job.epoch=view.epoch;job.sourceId=sourceId;}
  return {...this.visible(view),title:view.title,engine:view.engine,exists:!!head};
  }finally{view.switching=false;if(this.claims.get(key)===view.id)this.claims.delete(key);}
 }
 fileActionIdle(view,epoch){
  if(epoch!==view.epoch)throw new SafetyError('文件操作引用已过期，未改变当前作品',409);
  if(view.saving||view.switching||[...this.jobs.values()].some(job=>job.viewId===view.id&&job.epoch===view.epoch&&['queued','running','uncertain'].includes(job.status)))throw new SafetyError('请先结束当前设计动作或保存',423);
 }
 async preserveInput(view,{epoch,sourceId,name,jobId},input){
  if(jobId){const job=this.jobs.get(jobId);if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||job.action!=='html_convert'||job.status!=='running'||!job.executionStartedAt||job.cancelRequested||sourceId!=='import-'+job.id||view.saving||view.switching)throw new SafetyError('网页转换导入没有有效的当前许可',409);}
  else this.fileActionIdle(view,epoch);
  this.store(view.root).directory(sourceId);
  if(/\.(pcraft|png|jpe?g|psd|psb|webp|tiff?)$/i.test(name||'')&&!engineOf.photocraft)throw new SafetyError('图片持续编辑桥尚未开启，当前设计未改变',409);
  view.switching=true;
  try{
   if(await this.store(view.root).head(sourceId))throw new SafetyError('导入必须使用新的作品身份，未改已有源',409);
   return await this.store(view.root).preserveInput(sourceId,input,{name});
  }
  finally{view.switching=false;}
 }
 async copySource(view,{epoch,sourceRevision,title}){
  this.fileActionIdle(view,epoch);
  if(!view.sourceId||!sourceRevision||view.sourceRevision!==sourceRevision||!sameUint64(view.savedEngineRevision,view.document?.revision))throw new SafetyError('请先将当前版本保存后再另存',409);
  if(typeof title!=='string'||!title.trim()||title.length>200)throw new SafetyError('作品名称无效',422);
  view.switching=true;
  try{
   const source=await this.store(view.root).source(view.sourceId);
   if(source.revision!==sourceRevision)throw new SafetyError('磁盘源已有新版本，未复制过期内容',409);
   const id='work-'+randomUUID();
   const result=await this.store(view.root).commitStream(id,createReadStream(source.path),{engine:source.meta.engine,title:title.trim(),engineState:source.meta.engineState,actor:'manual'});
   this.onChange(view.root,{kind:'native-source',id,revision:result.revision});
   return {sourceId:id,title:result.meta.title,revision:result.revision};
  }finally{view.switching=false;}
 }
 async unselect(view,{epoch}){
  this.fileActionIdle(view,epoch);
  if(view.sourceId&&(!view.sourceRevision||!sameUint64(view.savedEngineRevision,view.document?.revision)))throw new SafetyError('当前修改未确认保存，未关闭作品',409);
  if(view.sourceId&&this.leases.get(this.leaseKey(view))===view.id)this.leases.delete(this.leaseKey(view));
  view.sourceId=null;view.sourceRevision=null;view.document=null;view.ready=false;view.title=null;view.epoch=randomUUID();view.catalog=[];view.reportSequence=0;view.nativeResponsive=true;
  return this.visible(view);
 }
 report(view,{epoch,document,catalog,sequence,responsive=true,loadedSourceRevision}){
  if(epoch!==view.epoch||!view.sourceId)throw new SafetyError('旧编辑表面的回报已拒绝',409);
  this.checkDocument(document,view);
  const previousReport=view.reportSequence||0;
  if(sequence!=null){
   if(!Number.isSafeInteger(sequence)||sequence<1)throw new SafetyError('状态序号无效',422);
   if(view.editorProtocol!==EDITOR_CONTEXT_PROTOCOL&&sequence<=previousReport)return {ready:view.ready,staleIgnored:true,sourceRevision:view.sourceRevision};
   view.reportSequence=Math.max(previousReport,sequence);
  }
  if(view.document&&!sameNativeDocument(view.document,document)){view.ready=false;throw new SafetyError('原生编辑器已打开另一份文档，当前作品不会被覆盖；请使用工作区打开入口',409);}
  if(view.editorProtocol===EDITOR_CONTEXT_PROTOCOL&&view.document&&compareUint64(document.contextSequence,view.document.contextSequence)<0)return {ready:view.ready,staleIgnored:true,sourceRevision:view.sourceRevision};
  if(view.editorProtocol===EDITOR_CONTEXT_PROTOCOL&&view.document&&sameUint64(document.contextSequence,view.document.contextSequence)&&responsive!==false)return {ready:view.ready,staleIgnored:true,sourceRevision:view.sourceRevision};
  if(view.document&&compareUint64(view.document.revision,document.revision)>0)return {ready:view.ready,staleIgnored:true,sourceRevision:view.sourceRevision};
  if(loadedSourceRevision!==undefined){
   if(!loadedSourceRevision||loadedSourceRevision!==view.sourceRevision||loadedSourceRevision!==view.pendingOpenRevision||document.pendingInteraction||view.document&&!sameNativeDocument(view.document,document))throw new SafetyError('已打开源的检查点身份不一致，未确认保存状态',409);
   view.savedEngineRevision=document.revision;view.pendingOpenRevision=null;
  }
  if(responsive===false){
   if(sequence!=null&&sequence<=previousReport)return {ready:view.ready,staleIgnored:true,sourceRevision:view.sourceRevision};
   view.document=serializable(document);view.ready=false;view.nativeResponsive=false;return {ready:false,sourceRevision:view.sourceRevision};
  }
  view.document=serializable(document);view.ready=true;view.nativeResponsive=true;
  if(catalog!=null){if(!Array.isArray(catalog)||catalog.length>3000)throw new SafetyError('命令目录无效',413);view.catalog=serializable(catalog);}
  return {ready:true,sourceRevision:view.sourceRevision};
 }
 checkDocument(doc,view){
  assertSafeJson(doc);
  try{
   validateNativeIdentity(doc);
   if(view?.editorProtocol===EDITOR_CONTEXT_PROTOCOL)validateNativeContext(doc,view.engine);
   else if(!Array.isArray(doc.selection))throw new TypeError('旧版编辑器状态缺少选区');
  }catch(error){throw new SafetyError(error.message,422);}
  if(Buffer.byteLength(JSON.stringify(doc))>1024*1024)throw new SafetyError('对象摘要超过预算',413);
 }
 matchesBase(view,base){return view.editorProtocol===EDITOR_CONTEXT_PROTOCOL&&matchesNativeBase(view.document,base,view.engine);}
 async state(sessionId,root){
  const directory=this.scope(sessionId,root),view=this.views.get(this.active.get(sessionId));
  const live=!!view&&view.root===directory&&Date.now()-view.lastSeen<LIVE_MS;
  return {live,engines:engineOf,contextProtocol:EDITOR_CONTEXT_PROTOCOL,executionAdmission:true,historyPolicy:{action:'undo',target:'payload.jobId from an undoAvailable recentJob',scope:'one proven latest native step in the same live App; no later content edits; older/multi-step/sliced history fails closed'},view:live?{sourceId:view.sourceId,epoch:view.epoch,ready:view.ready,nativeResponsive:view.nativeResponsive,sourceRevision:view.sourceRevision,document:view.document,engine:view.engine,engineContract:engineOf[view.engine],editorProtocol:view.editorProtocol,requiresReload:view.editorProtocol!==EDITOR_CONTEXT_PROTOCOL,navigation:view.navigation||null,base:view.ready&&view.editorProtocol===EDITOR_CONTEXT_PROTOCOL?nativeBase(view.document):null,idArguments:view.ready&&view.editorProtocol===EDITOR_CONTEXT_PROTOCOL?selectedObjectIds(view.document).slice(0,50).map(id=>({id,argument:uint64Parameter(id)})):[]}:null,
   sources:await this.store(directory).list(),recentJobs:[...this.jobs.values()].filter(job=>job.sessionId===sessionId).slice(-8).map(job=>this.jobInfo(job))};
 }
 jobInfo(job){const view=this.views.get(job.viewId);return {id:job.id,action:job.action,command:job.payload?.command,sourceId:job.sourceId,status:job.status,error:job.error,cancelRequested:!!job.cancelRequested,executionStarted:!!job.executionStartedAt,appliedAfterCancel:!!job.cancelRequested&&job.status==='succeeded',undoAvailable:this.canUndo(view,job),undoneBy:job.undoneBy||null,undoOf:job.undoOf||null};}
 canUndo(view,job){return !!view&&job?.action==='execute'&&job.status==='succeeded'&&!!job.undoProof&&!job.undoneBy&&view.ready&&job.viewId===view.id&&job.epoch===view.epoch&&job.sourceId===view.sourceId&&job.saved===view.sourceRevision&&sameUint64(job.undoProof.uid,view.document?.uid)&&sameUint64(job.undoProof.revision,view.document?.revision);}
 requireUndo(view,id){
  const target=this.jobs.get(id);
  if(!target||target.sessionId!==view.sessionId||target.viewId!==view.id||target.sourceId!==view.sourceId||target.epoch!==view.epoch)throw new SafetyError('撤销必须指定当前作品中已完成的 AI 步骤 jobId',409);
  if(!target.undoProof||target.status!=='succeeded'||target.undoneBy)throw new SafetyError('此步骤没有可证明的单步撤销记录，未改动设计；请保留当前版本并明确需要续改的对象',409);
  if(!this.canUndo(view,target))throw new SafetyError('该 AI 步骤之后已有修改或源已变化，未撤销，也不会覆盖后续手改；请读取当前对象后局部续改',409);
  return target;
 }
 poll(view){
  if(view.saving||view.switching||[...this.jobs.values()].some(job=>job.viewId===view.id&&job.epoch===view.epoch&&['running','uncertain'].includes(job.status)))return {job:null};
  const job=[...this.jobs.values()].find(job=>job.viewId===view.id&&job.status==='queued');
  if(!job)return {job:null};
  if(job.epoch!==view.epoch){this.fail(job,'当前作品已切换，未执行旧动作',409);return {job:null};}
  job.status='running';this.record(job);
  return {job:{id:job.id,action:job.action,payload:job.payload,sourceId:job.sourceId,epoch:job.epoch,base:job.base}};
 }
 begin(view,{jobId,epoch}){
  const job=this.jobs.get(jobId);
  if(!job||job.viewId!==view.id||job.epoch!==view.epoch||epoch!==view.epoch)throw new SafetyError('动作或设计表面已切换，未获执行许可',409);
  if(job.cancelRequested||job.status==='cancelled')throw new SafetyError('动作在执行前已停止，没有执行修改',499);
  if(job.status!=='running'||job.executionStartedAt)throw new SafetyError('动作不可重复开始，请先读取当前设计状态',409);
  if((['execute','undo','derive','place','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','brand','image_adopt','image_undo'].includes(job.action)||['open_asset','return_to_design'].includes(job.action)&&job.base)&&(!view.ready||job.sourceId!==view.sourceId||!this.matchesBase(view,job.base))){
   const message='开始执行前设计或选区已改变，请读取最新状态';this.fail(job,message,409);throw new SafetyError(message,409);
  }
  if(job.action==='undo'){try{this.requireUndo(view,job.undoOf);}catch(error){this.fail(job,error.message,error.status||409);throw error;}}
  if(job.action==='edit_instance'&&job.payload.gestureNativeId!==undefined&&canvasMaterialTarget(view.document)!==String(job.payload.gestureNativeId)){
   this.fail(job,'素材已经离开选区或隔离编辑，请重新双击',409);throw new SafetyError('双击目标已改变',409);
  }
  if(['execute','convert_svg'].includes(job.action))job.beforeDocument=serializable(view.document);
  job.executionStartedAt=new Date().toISOString();this.record(job);
  return {started:true,jobId:job.id,epoch:view.epoch};
 }
 async request(sessionId,args,signal){
  const guarded=['create_svg','resource_image','resource_deck'].includes(args?.action)&&args?.payload?.resourceReceiptId&&args?.operationId;
  if(!guarded)return this.requestInner(sessionId,args,signal);
  const key=String(sessionId)+'\0'+String(args.operationId);
  if(this.operationClaims.has(key))throw new SafetyError('该资源导入正在准备或执行，请先核对状态',423);
  this.operationClaims.add(key);
  try{return await this.requestInner(sessionId,args,signal);}finally{this.operationClaims.delete(key);}
 }
 async requestInner(sessionId,{action,sourceId,epoch,base,payload={},operationId,initiator='ai'},signal){
  if(signal?.aborted)throw new SafetyError('动作在执行前已停止',499);
  const root=this.scope(sessionId);let view=this.views.get(this.active.get(sessionId));
  if(!view&&['new','create_svg'].includes(action)){
   const until=Date.now()+5000;while(!view&&Date.now()<until&&!signal?.aborted){await new Promise(resolve=>setTimeout(resolve,100));view=this.views.get(this.active.get(sessionId));}
  }
  if(signal?.aborted)throw new SafetyError('动作在执行前已停止',499);
  if(!view||Date.now()-view.lastSeen>=LIVE_MS)throw new SafetyError('当前对话的设计工作区未连接，请打开设计面板',409);
  if(view.editorProtocol!==EDITOR_CONTEXT_PROTOCOL&&action!=='commands')throw new SafetyError('编辑表面仍为旧协议，请先保存并重新载入设计插件；未执行新的 AI 动作',409);
  if(view.root!==root)throw new SafetyError('设计工作区与当前 DSH 对话目录不同',409);
  if(view.nativeResponsive===false)throw new SafetyError('原生编辑器暂未响应，请先在工作区等待或恢复最近已保存版本',409);
  if(view.document?.pendingInteraction&&action!=='commands')throw new SafetyError('原生编辑器仍有未结束的人工交互，请完成后再读取和修改',409);
  if(!['new','create_svg','open','execute','undo','inspect_node','save','commands','derive','place','open_asset','return_to_design','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg', 'brand','html_convert','html_freeze_tailwind','image_adopt','image_undo','resource_image','resource_deck'].includes(action))throw new SafetyError('未支持的编辑器动作',422);
  assertSafeJson(payload);if(Buffer.byteLength(JSON.stringify(payload))>8*1024*1024)throw new SafetyError('设计指令超过8MiB预算',413);
  if(base!==undefined){assertSafeJson(base);if(Buffer.byteLength(JSON.stringify(base))>1024*1024)throw new SafetyError('原生执行基线超过预算',413);}
  if(['execute','undo','inspect_node','save','derive','place','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','brand','image_adopt','image_undo'].includes(action)||['open_asset','return_to_design'].includes(action)&&view.document){
   if(!view.ready||!view.document||sourceId!==view.sourceId||epoch!==view.epoch)throw new SafetyError('专业源引用已过期，请先读取当前状态',409);
   if(['execute','undo','derive','place','open_asset','return_to_design','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','brand','image_adopt','image_undo'].includes(action)&&!this.matchesBase(view,base))throw new SafetyError('设计版本、引擎或完整选区已改变，请先读取当前状态',409);
  }
  if(action==='brand'&&(view.navigation?.canReturn||!['create','attach','enable','disable','recolor','resume','font-create','font-attach','font-disable','font-change','font-resume','font-cancel'].includes(payload.command)))throw new SafetyError('请返回项目作品并选择有效的品牌操作',422);
  if(action==='open_asset'){if(view.navigation?.canReturn)throw new SafetyError('请先返回原设计，再打开另一份来源',409);await this.graph(root).asset(payload.assetId);}
  if(action==='edit_instance'){
   if(view.navigation?.canReturn)throw new SafetyError('请先返回原设计，再编辑另一个实例',409);
   const target=await this.graph(root).instance(payload.instanceId,{sourceId:view.sourceId});
   if(payload.gestureNativeId!==undefined){
    if(canvasMaterialTarget(view.document)!==String(payload.gestureNativeId)||!sameUint64(target.instance.nativeId,payload.gestureNativeId))throw new SafetyError('双击后选区已改变，请重新选择素材',409);
   }
  }
  if(action==='convert_svg'){
   if(view.engine!=='deckcraft'||view.navigation?.canReturn)throw new SafetyError('请先回到演示文稿，再转换当前幻灯片的 SVG',409);
   const target=await this.graph(root).prepareSvgConversion({instanceId:payload.instanceId,sourceId:view.sourceId});
   if(target.baseRevision!==view.sourceRevision||view.document?.page?.nativePage?.kind!=='slide'||!sameUint64(view.document.page.nativePage.id,target.nativePage.id))throw new SafetyError('请先保存并切换到该 SVG 所在幻灯片',409);
  }
  let instanceEdit;
  if(['apply_instance','apply_linked'].includes(action)){
   const editId=view.navigation?.editId;
   instanceEdit=(await this.graph(root).read()).manifest.edits?.[editId];
   if(!instanceEdit||instanceEdit.phase!=='editing'||instanceEdit.sourceId!==view.sourceId||payload.editId&&payload.editId!==editId)throw new SafetyError('当前不是可回写的实例编辑，请从原设计的使用处进入',409);
   payload={...payload,editId};
  }
  if(action==='return_to_design'&&(!view.navigation?.canReturn||epoch!==view.epoch))throw new SafetyError('当前没有可返回的原设计，未切换作品',409);
  if(action==='derive'){
   const format=payload.format||(view.engine==='photocraft'?'png':'svg');
   if(!['svg','png'].includes(format)||!engineOf[view.engine]?.exportFormats.includes(format))throw new SafetyError('当前编辑器没有接入此素材派生格式',422);
  }
  if(action==='place'){
   if(!['vectorcraft','deckcraft'].includes(view.engine))throw new SafetyError('该引擎的素材放入尚未接通',422);
   const material=await this.graph(root).asset(payload.assetId);
   if(view.engine==='deckcraft'&&material.asset.format!=='png'&&!(material.asset.format==='svg'&&material.asset.preview))throw new SafetyError('演示 SVG 放入需要保留原文和已核对的 PNG 兼容预览；拆为原生形状另行处理',422);
   if(payload.at!==undefined&&(!Array.isArray(payload.at)||payload.at.length!==2||payload.at.some(value=>typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1000000)))throw new SafetyError('素材放入坐标无效',422);
  }
  if(action==='create_svg'&&(typeof payload.svg!=='string'||!payload.svg.trim()))throw new SafetyError('缺少实际 SVG 源码',422);
  if(action==='html_convert'&&(!/^html-[a-f0-9-]{36}$/.test(payload.id||'')||!/^[a-f0-9]{64}$/.test(payload.revision||'')||payload.tailwindCompat!==undefined&&typeof payload.tailwindCompat!=='boolean'))throw new SafetyError('网页转换需要真实网页 ID、保存版本和有效的兼容选项',422);
  if(action==='html_freeze_tailwind'&&(!/^html-[a-f0-9-]{36}$/.test(payload.id||'')||!/^[a-f0-9]{64}$/.test(payload.revision||'')||typeof payload.operationKey!=='string'||!payload.operationKey||payload.operationKey.length>250||/[\x00-\x1f]/.test(payload.operationKey)))throw new SafetyError('静态样式保存需要真实网页 ID、保存版本和稳定操作身份',422);
  if(action==='image_adopt'&&(!/^image-[a-f0-9-]{36}$/.test(payload.id||'')||!/^candidate-[a-f0-9-]{36}$/.test(payload.candidateId||'')))throw new SafetyError('图片采用需要真实任务和候选 ID',422);
  if(action==='resource_image'&&view.navigation?.canReturn)throw new SafetyError('请先返回原设计，再打开独立资源图片；原件已保留',409);
  if(action==='resource_image'&&(!/^[a-zA-Z0-9][\w.-]{0,119}$/.test(payload.assetName||'')||!/^[a-f0-9]{64}$/.test(payload.sourceHash||'')||typeof payload.title!=='string'||!payload.title.trim()||payload.title.length>200))throw new SafetyError('资源图片导入身份无效',422);
  if(action==='resource_deck'&&(view.navigation?.canReturn||!/^[a-zA-Z0-9][\w.-]{0,119}\.(?:pptx|potx|ppsx)$/i.test(payload.assetName||'')||!/^[a-f0-9]{64}$/.test(payload.sourceHash||'')||!/^(?:externalfile|externallfs)-[a-f0-9]{64}$/.test(payload.resourceReceiptId||'')||!/^external-native-[a-f0-9]{64}$/.test(operationId||'')||typeof payload.title!=='string'||!payload.title.trim()||payload.title.length>200))throw new SafetyError('外部演示导入身份无效，或需先返回原设计',422);
  if(payload.resourceReceiptId!==undefined&&!['resource_image','resource_deck','create_svg'].includes(action))throw new SafetyError('此动作不能声明资源导入来源',422);
  let resourceReceiptId;
  if(payload.resourceReceiptId!==undefined){
   const admittedEpoch=view.epoch;
   const expected=['resource_image','resource_deck'].includes(action)?payload.sourceHash:createHash('sha256').update(Buffer.from(payload.svg,'utf8')).digest('hex');
   resourceReceiptId=await this.resourceReceipt(root,payload.resourceReceiptId,expected,['resource_image','resource_deck'].includes(action)?payload.assetName:undefined,action==='resource_image'?'image':action==='resource_deck'?'deck':'svg');
   if(/^(?:externalfile|externallfs)-/.test(resourceReceiptId)&&!/^external-native-[a-f0-9]{64}$/.test(operationId||''))throw new SafetyError('外部原生导入需要稳定预约身份',422);
   if(resourceReceiptId.startsWith('stitchasset-')&&(action!=='resource_image'||!/^stitchimage-[a-f0-9]{64}$/.test(operationId||'')))throw new SafetyError('Stitch 截图导入需要稳定预约身份',422);
   if(resourceReceiptId.startsWith('figmamcpfile-')&&!/^figmamcpnative-[a-f0-9]{64}$/.test(operationId||''))throw new SafetyError('Figma 素材导入需要稳定预约身份',422);
   if(resourceReceiptId.startsWith('falrtimage-')&&(action!=='resource_image'||!/^falrtnative-[a-f0-9]{64}$/.test(operationId||'')))throw new SafetyError('fal 实时图片导入需要稳定预约身份',422);
   if(resourceReceiptId.startsWith('stockimage-')&&(action!=='resource_image'||!/^stockphoto-native-[a-f0-9]{64}$/.test(operationId||'')))throw new SafetyError('图库图片导入需要稳定预约身份',422);
   if(signal?.aborted||this.disposed||this.active.get(sessionId)!==view.id||view.epoch!==admittedEpoch||this.scope(sessionId)!==root)throw new SafetyError('资源核对期间会话已切换，未开始导入',409);
  }
  if(action==='execute')checkHostedCommand(payload.command,payload.params||{});
  const undoOf=action==='undo'?this.requireUndo(view,payload.jobId).id:null;
  if(undoOf)payload={jobId:undoOf,command:'edit.undo',params:{}};
  const key=operationId||randomUUID(),existing=[...this.jobs.values()].find(job=>job.sessionId===sessionId&&job.operationId===key);
  if(existing&&resourceReceiptId&&(existing.resourceReceiptId!==resourceReceiptId||existing.action!==action))throw new SafetyError('该导入身份已用于其他资源，未重复执行',409);
  if(existing)return existing.status==='succeeded'?Promise.resolve(existing.result):existing.promise;
  if([...this.jobs.values()].filter(job=>job.viewId===view.id&&['queued','running','uncertain'].includes(job.status)).length>=16)throw new SafetyError('设计动作队列已满',429);
  if(this.jobs.size>=64)for(const [id,old]of this.jobs){if(['succeeded','failed','cancelled'].includes(old.status)){this.jobs.delete(id);if(this.jobs.size<64)break;}}
  if(this.jobs.size>=64)throw new SafetyError('尚未确认的设计动作过多，请先恢复或处理它们',429);
  const job={id:randomUUID(),operationId:key,sessionId,viewId:view.id,root:view.root,sourceId:sourceId||view.sourceId,epoch:view.epoch,base:base===undefined?undefined:serializable(base),payload:serializable(payload),action,undoOf,initiator:initiator==='manual'?'manual':'ai',...(resourceReceiptId?{resourceReceiptId}:{}),...(['return_to_design','apply_instance','apply_linked'].includes(action)?{returnTarget:{...view.navigation}}:{}),...(instanceEdit?{instanceEdit}:{}),status:'queued',at:new Date().toISOString()};
  if(action==='resource_image'){
   const bytes=readAsset(root,payload.assetName),png=bytes?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes?.[0]===255&&bytes?.[1]===216;
   if(!bytes||bytes.length>16*1024*1024||!png&&!jpg||createHash('sha256').update(bytes).digest('hex')!==payload.sourceHash)throw new SafetyError('资源图片原件不存在、格式无效或已改变',409);
   previewImageSize(bytes);
   const name='resource.'+(png?'png':'jpg');
   job.originalInput=await this.store(root).preserveInput('import-'+job.id,(async function*(){yield bytes;})(),{name});
   if(signal?.aborted)throw new SafetyError('动作在执行前已停止，原始图片已保留',499);
   if(this.disposed||this.active.get(sessionId)!==view.id||view.epoch!==job.epoch)throw new SafetyError('资源读取期间设计已切换，原始图片已保留但未导入',409);
  }
  if(action==='resource_deck'){
   const bytes=readAsset(root,payload.assetName);if(!bytes||createHash('sha256').update(bytes).digest('hex')!==payload.sourceHash)throw new SafetyError('外部演示原件不存在或已改变',409);
   const {extension}=validatePresentationInput(bytes,payload.assetName);
   if(await this.store(root).head('import-'+job.id))throw new SafetyError('导入作品身份已存在，未覆盖',409);
   job.originalInput=await this.store(root).preserveInput('import-'+job.id,(async function*(){yield bytes;})(),{name:'resource.'+extension});
   if(job.originalInput.original.sha256!==payload.sourceHash)throw new SafetyError('演示原件保存摘要不一致，未开始导入',409);
   if(signal?.aborted||this.disposed||this.active.get(sessionId)!==view.id||view.epoch!==job.epoch||this.scope(sessionId)!==root)throw new SafetyError('会话已改变，演示原件已保留但未导入',409);
  }
  if(action==='create_svg'){
   // Keep the exact generated input before validation/import can fail or be stopped.
   job.originalInput=await this.store(root).preserveInput('generated-'+job.id,(async function*(){yield Buffer.from(payload.svg,'utf8');})(),{name:'generated.svg'});
   if(signal?.aborted)throw new SafetyError('动作在执行前已停止，原始生成文件已保留',499);
   if(this.disposed||this.active.get(sessionId)!==view.id||view.epoch!==job.epoch)throw new SafetyError('生成期间设计已切换，原始输入已保留但未执行旧动作',409);
  }
  job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});
  const deadline=['html_convert','html_freeze_tailwind'].includes(action)?240000:this.operationTimeoutMs;
  job.timer=setTimeout(()=>{if(['queued','running'].includes(job.status)){job.status=job.executionStartedAt?'uncertain':'cancelled';job.error=job.executionStartedAt?'动作结果尚未确认，禁止直接重试；先读取当前设计':'动作等待超时，未获执行许可，没有执行修改';job.reject(new SafetyError(job.error,504));this.record(job);}},deadline);
  job.timer.unref?.();
  const abort=()=>{
   if(!['queued','running'].includes(job.status))return;
   job.cancelRequested=true;
   if(!job.executionStartedAt){job.status='cancelled';job.error='动作在执行前取消';clearTimeout(job.timer);}
   else job.error='已请求停止；当前原生动作可能仍在完成，请读取状态';
   job.reject(new SafetyError(job.error,499));this.record(job);
  };
  signal?.addEventListener('abort',abort,{once:true});
  // A cancelled tool await is not proof that the native operation ended. Its watchdog
  // remains live until finish/fail/fence, so a lost completion cannot lock this view forever.
  job.promise=job.promise.finally(()=>{signal?.removeEventListener('abort',abort);});
  this.jobs.set(job.id,job);this.record(job);if(signal?.aborted)abort();
  return job.promise;
 }
 async save(view,{epoch,baseRevision,engineState,jobId,placement,instanceUpdate,originAssignment,imageAdoption},input){
  if(view.saving||view.switching)throw new SafetyError('当前专业源已有保存或切换动作',423);
  if(epoch!==view.epoch||!view.sourceId||this.leases.get(this.leaseKey(view))!==view.id)throw new SafetyError('旧表面的保存已拒绝',409);
  if(baseRevision!==view.sourceRevision)throw new SafetyError('保存基线已改变，保留当前草稿',409);
  try{assertSafeJson(engineState);validateNativeIdentity(engineState);}catch(error){throw new SafetyError(error.message,422);}
  if(!view.document||!sameUint64(view.document.uid,engineState.uid)||view.engine==='photocraft'&&!sameUint64(view.document.nativeDocumentId,engineState.nativeDocumentId)||compareUint64(view.document.revision,engineState.revision)<0)throw new SafetyError('请先回报与保存相符的真实引擎状态',409);
  let job=jobId?this.jobs.get(jobId):null,operation;
  if(['resource_image','resource_deck'].includes(job?.action)&&(job.cancelRequested||job.status!=='running'))throw new SafetyError('资源导入已停止，原件已保留，未提交新源',499);
  if(['resource_image','resource_deck'].includes(job?.action)&&(view.sourceId!=='import-'+job.id||view.engine!==(job.action==='resource_deck'?'deckcraft':'photocraft')))throw new SafetyError('资源导入的源身份已改变，原件已保留，未提交新源',409);
  const claim=this.claims.get(this.leaseKey(view));if(claim&&claim!=='linked:'+jobId)throw new SafetyError('该设计正在关联更新，未写入竞争版本',423);
  if(jobId&&(!job||job.viewId!==view.id||job.epoch!==view.epoch||!job.executionStartedAt||!['running','uncertain'].includes(job.status)))throw new SafetyError('设计动作未获执行许可或保存身份无效',409);
  if(job?.resourceReceiptId&&['create_svg','resource_image','resource_deck'].includes(job.action)&&baseRevision===null){
   if(job.action==='create_svg'&&view.engine!=='vectorcraft'||!job.originalInput?.original?.sha256)throw new SafetyError('资源导入的原生引擎或原件身份无效',409);
   operation={action:'resource-import',id:job.id,resourceReceiptId:job.resourceReceiptId,inputHash:job.originalInput.original.sha256,kind:job.action==='create_svg'?'svg':job.action==='resource_deck'?'deck':'image',...(/^(?:externalfile|externallfs|stitchasset|figmamcpfile|falrtimage|stockimage)-/.test(job.resourceReceiptId)?{originOperationId:job.operationId}:{})};
  }
  if(placement){
   const owner=this.jobs.get(placement.jobId);
   if(!owner||owner.viewId!==view.id||owner.epoch!==epoch||owner.sourceId!==view.sourceId||owner.action!=='place'||!owner.executionStartedAt||!['running','uncertain'].includes(owner.status)||owner.payload.assetId!==placement.assetId||job&&job!==owner)throw new SafetyError('素材源回执不属于当前已执行动作',409);
   job=owner;operation={action:'place',id:owner.id,assetId:placement.assetId,nativeId:placement.nativeId};
  }
  if(instanceUpdate){
   const owner=this.jobs.get(instanceUpdate.jobId),plan=owner?.action==='convert_svg'?owner.conversionPlan:owner?.applyPlan;
   if(placement||!owner||owner.viewId!==view.id||owner.epoch!==epoch||!['apply_instance','convert_svg'].includes(owner.action)||!owner.executionStartedAt||!['running','uncertain'].includes(owner.status)||!plan||plan.sourceId!==view.sourceId||plan.baseRevision!==baseRevision||job&&job!==owner)throw new SafetyError('素材回写或转换回执不属于当前已执行动作',409);
   job=owner;
   if(owner.action==='convert_svg'){
    const canonical=validateConvertedShapes(Number(plan.instance.nativeId),plan.nativeShapes),shapesHash=createHash('sha256').update(canonical).digest('hex');
    if(shapesHash!==plan.shapesHash||JSON.stringify(plan.shapeIds)!==JSON.stringify(plan.nativeShapes.map(shape=>shape.id)))throw new SafetyError('SVG 转换回执与原生对象不一致',409);
    operation={action:'convert-svg',id:owner.id,instanceId:plan.instance.id,assetId:plan.asset.id,nativeId:Number(plan.instance.nativeId),baseRevision,shapeIds:plan.shapeIds,shapesHash};
   }else operation={action:'apply-instance',id:owner.id,editId:plan.edit.id,instanceId:plan.instance.id,assetId:plan.asset.id,previousAssetId:plan.instance.assetId,nativeId:plan.instance.nativeId,baseRevision,...(plan.legacyGroup?{legacyKindHash:createHash('sha256').update(canonicalLegacyKind(plan.nativeKind,plan.asset.sourceHash)).digest('hex')}:{})};
  }
  let imagePlan,imageCandidateBytes;
  if(imageAdoption){
   imagePlan=view.imagePlan;
   if(operation||job&&(!['image_adopt','image_undo'].includes(job.action)||imagePlan?.operationJobId!==job.id||job.action==='image_undo'&&imagePlan.type!=='undo'||job.action==='image_adopt'&&imagePlan.type==='undo')||!imagePlan||imagePlan.id!==imageAdoption.planId||imagePlan.epoch!==epoch||imagePlan.sourceId!==view.sourceId||imagePlan.baseRevision!==baseRevision||view.engine!=='photocraft'||!this.images)throw new SafetyError('图片候选保存没有匹配的原位许可',409);
   if(job?.cancelRequested)throw new SafetyError('图片动作已请求停止，未开始保存',499);
   const imageJob=this.images.get(view.root,imagePlan.imageJobId),candidate=imageJob.candidates.find(item=>item.id===imagePlan.candidateId);
   if(imageJob.mode!=='edit'||imageJob.studio?.source?.sourceId!==view.sourceId||!candidate)throw new SafetyError('图片候选与原生图片基线不一致',409);
   if(imagePlan.type==='undo'){
    const head=await this.store(view.root).head(view.sourceId),adopt=head?.meta.operation;
    if(head?.revision!==baseRevision||adopt?.action!=='image-adopt'||adopt.imageJobId!==imagePlan.imageJobId||adopt.candidateId!==imagePlan.candidateId||adopt.originalRevision&&adopt.originalRevision!==imagePlan.restoreRevision||imageJob.studio.source.sourceRevision!==imagePlan.restoreRevision)throw new SafetyError('图片采用后已有其他修改，未撤销',409);
    if(!adopt.originalRevision&&adopt.baseRevision!==imagePlan.restoreRevision&&(await this.store(view.root).source(view.sourceId,adopt.baseRevision)).meta.sourceHash!==imageJob.studio.source.sourceHash)throw new SafetyError('图片采用基线不一致，未撤销',409);
    const original=await this.store(view.root).read(view.sourceId,imagePlan.restoreRevision);imageCandidateBytes=original.bytes;
    operation={action:'image-revert',id:imagePlan.id,imageJobId:imagePlan.imageJobId,candidateId:imagePlan.candidateId,sourceHash:imagePlan.sourceHash,restoreRevision:imagePlan.restoreRevision,baseRevision};
   }else{
    const head=await this.store(view.root).head(view.sourceId);
    if(head?.revision!==baseRevision||!imageBaselineMatches({...head?.meta,revision:head?.revision},imageJob)||candidate.sourceHash!==imagePlan.sourceHash)throw new SafetyError('图片候选与原生图片基线不一致',409);
    imageCandidateBytes=readAsset(view.root,candidate.native.source);
    operation={action:'image-adopt',id:imagePlan.id,imageJobId:imagePlan.imageJobId,candidateId:imagePlan.candidateId,sourceHash:imagePlan.sourceHash,baseRevision,originalRevision:imageJob.studio.source.sourceRevision};
   }
   if(!imageCandidateBytes||createHash('sha256').update(imageCandidateBytes).digest('hex')!==imagePlan.sourceHash)throw new SafetyError('图片候选或恢复源完整性失败',409);
  }
  let originPlan;
  if(originAssignment){
   originPlan=view.originPlan;
   if(operation||!originPlan||originPlan.id!==originAssignment||originPlan.epoch!==epoch||originPlan.sourceId!==view.sourceId||originPlan.sourceRevision!==baseRevision)throw new SafetyError('来源补入保存没有匹配的核对许可',409);
   operation={action:'attach-origins',id:originPlan.id,baseRevision,origins:originPlan.origins};
  }
  view.saving=true;
  try{
  const stream=(async function*(){for await(const chunk of input){if(['resource_image','resource_deck'].includes(job?.action)&&(job.cancelRequested||job.status!=='running'))throw new SafetyError('资源导入已停止，未提交新源',499);view.lastSeen=Date.now();yield chunk;}})();
  const options={engine:view.engine,title:view.title,baseRevision,engineState,actor:job?.initiator||'manual',operation};let result;
  if(['apply-instance','convert-svg','image-adopt','image-revert'].includes(operation?.action)||originPlan){
   const chunks=[];let count=0;for await(const chunk of stream){count+=chunk.byteLength;if(count>256*1024*1024)throw new SafetyError('原位回写源超过256MiB预算',413);chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);if(originPlan)await this.graph(view.root).verifyOriginAssignments(originPlan,bytes);else if(['image-adopt','image-revert'].includes(operation.action))assertPhotoCandidateOnly(imageCandidateBytes,bytes);else if(operation.action==='convert-svg')await this.graph(view.root).verifySvgConversionSource(job.conversionPlan,bytes);else await this.graph(view.root).verifyInstanceApplySource(job.applyPlan,bytes);
   if(imagePlan?.operationJobId&&(job?.cancelRequested||job?.status!=='running'))throw new SafetyError('图片动作已停止，未提交候选源',499);
   result=await this.store(view.root).commit(view.sourceId,{...options,bytes});
  }else result=await this.store(view.root).commitStream(view.sourceId,stream,options);
  if(epoch!==view.epoch||this.leases.get(this.leaseKey(view))!==view.id)throw new SafetyError('源已保存为历史候选，当前窗口已切换',409);
  view.sourceRevision=result.revision;view.savedEngineRevision=engineState.revision;view.pendingOpenRevision=null;view.ready=true;if(job){job.saved=result.revision;job.savedEngineRevision=engineState.revision;}
  if(operation?.action==='resource-import'&&!await this.record(job))throw new SafetyError('资源原生源已保存，但操作记录尚未确认；请先核对，不要重复导入',503);
  if(operation?.action==='place'){job.placementReceipt={assetId:operation.assetId,sourceId:view.sourceId,sourceRevision:result.revision,nativeId:operation.nativeId};await this.record(job);}
  if(operation?.action==='apply-instance'){job.instanceUpdateReceipt={sourceId:view.sourceId,sourceRevision:result.revision,operationId:operation.id};await this.record(job);}
  if(operation?.action==='convert-svg'){job.conversionReceipt={sourceId:view.sourceId,sourceRevision:result.revision,operationId:operation.id,shapeIds:operation.shapeIds,shapesHash:operation.shapesHash};if(!await this.record(job))throw new SafetyError('转换源已保存，但操作回执未确认；请检查当前设计，勿重复转换',503);}
  let originSync;
  try{originSync=await this.graph(view.root).synchronizeSource({sourceId:view.sourceId,sourceRevision:result.revision,annotations:originPlan});}
  catch(error){originSync={pending:true,error:String(error.message||error)};}
  if(job)job.originSyncPending=!!originSync.pending;
  if(originPlan)view.originPlan=null;
  if(imagePlan)view.imagePlan=null;
  this.onChange(view.root,{kind:'native-source',id:view.sourceId,revision:result.revision});return {...result,originSync};
  }finally{view.saving=false;}
 }
 async finish(view,{jobId,epoch,ok,result,error,uncertain=false}){
  const job=this.jobs.get(jobId);
  if(!job||job.viewId!==view.id||epoch!==view.epoch||job.epoch!==epoch)throw new SafetyError('旧动作回执已拒绝',409);
  if(!['running','uncertain'].includes(job.status))return this.jobInfo(job);
  if(!ok){this.fail(job,error||'专业编辑器没有完成动作',422,uncertain);return this.jobInfo(job);}
  if(!job.executionStartedAt){this.fail(job,'动作未确认开始执行，未标记完成',409);return this.jobInfo(job);}
  if(job.originSyncPending){
   try{await this.graph(view.root).synchronizeSource({sourceId:view.sourceId,sourceRevision:view.sourceRevision});job.originSyncPending=false;}
   catch(error){this.fail(job,'原生文件已保存，来源关系尚未确认；请核对素材而不要重复原生动作：'+error.message,503,true);return this.jobInfo(job);}
  }
  if(!['commands','inspect_node','link_instances','unlink_instance','apply_linked','resume_linked','brand','html_freeze_tailwind'].includes(job.action)&&!job.saved){this.fail(job,'源文件尚未确认保存，未标记完成',409);return this.jobInfo(job);}
  if(['link_instances','unlink_instance','brand'].includes(job.action)&&!job.projectMutation){this.fail(job,'关联关系尚未持久保存',409);return this.jobInfo(job);}
  if(job.action==='html_freeze_tailwind'&&job.projectMutation?.kind!=='tailwind-freeze'){this.fail(job,'静态样式保存回执尚未确认',409,true);return this.jobInfo(job);}
  if(['apply_linked','resume_linked'].includes(job.action)){
   job.linkedUpdate=(await this.graph(view.root).read()).manifest.updates?.[job.linkedUpdateId];
   if(job.linkedUpdate?.status!=='succeeded'){this.fail(job,'关联更新仍有未完成使用处，请从保存进度恢复',409,true);return this.jobInfo(job);}
   try{await this.graph(view.root).checkLinkedCompletion(job.linkedUpdateId);}
   catch(error){this.fail(job,'已提交的关联图片又有外部修改，请保留当前源并核对：'+error.message,409,true);return this.jobInfo(job);}
  }
  if(job.action==='derive'&&!job.material){this.fail(job,'素材派生物尚未登记，未标记完成',409);return this.jobInfo(job);}
  if(job.action==='convert_svg'&&!job.conversionReceipt){this.fail(job,'转换尚未收到已保存源的核对回执，未标记完成',409);return this.jobInfo(job);}
  if(job.action==='apply_instance'){
   try{
    if(!job.instanceUpdateReceipt)throw new SafetyError('尚未收到原设计中已提交的图片回写回执',409);
    job.instanceUpdate=await this.graph(view.root).completeInstanceApply(job.instanceUpdateReceipt);
   }catch(error){this.fail(job,'回写关系尚未确认；保留源并核对回执，不要重复替换：'+error.message,error.status||503,true);return this.jobInfo(job);}
  }
  if(job.action==='place'){
   const ids=result?.value?.ids;
   if(!Array.isArray(ids)||ids.length!==1){this.fail(job,'布局已保存，但缺少实际放入对象回执，请先核对源；不会重复执行',409,true);return this.jobInfo(job);}
   job.placementReceipt={assetId:job.payload.assetId,sourceId:job.sourceId,sourceRevision:job.saved,nativeId:ids[0]};
   if(!await this.record(job)){this.fail(job,'布局已保存，但素材回执未落盘，请先核对源；不会重复执行',503,true);return this.jobInfo(job);}
   try{job.placement=await this.graph(view.root).bind({operationId:job.id,...job.placementReceipt});}
   catch(error){this.fail(job,'布局已保存，素材关系尚未确认；请修复关联而不要重新放入：'+error.message,error.status||503,true);return this.jobInfo(job);}
  }
  if(['execute','convert_svg'].includes(job.action))job.undoProof=singleUndoProof(job.beforeDocument,result?.document,job.savedEngineRevision);
  if(job.action==='undo'){
   const target=this.jobs.get(job.undoOf);
   if(target){target.undoneBy=job.id;await this.record(target);}
  }
  job.status='succeeded';job.error=null;job.result={ok:true,jobId:job.id,sourceId:view.sourceId,epoch:view.epoch,sourceRevision:view.sourceRevision,document:view.document,result,persisted:!!(job.saved||job.projectMutation||job.linkedUpdate?.status==='succeeded'),checkpointEngineRevision:job.savedEngineRevision,currentStateSaved:sameUint64(view.document?.revision,view.savedEngineRevision),appliedAfterCancel:!!job.cancelRequested,...(job.material?{material:job.material}:{}),...(job.placement?{placement:job.placement}:{}),...(job.instanceEdit?{instanceEdit:job.instanceEdit}:{}),...(job.instanceUpdate?{instanceUpdate:job.instanceUpdate}:{}),...(job.applyPlan?{applyPlan:job.applyPlan}:{}),...(job.instanceUpdateReceipt?{instanceUpdateReceipt:job.instanceUpdateReceipt}:{}),...(job.conversionReceipt?{conversionReceipt:job.conversionReceipt}:{}),...(job.projectMutation?{projectMutation:job.projectMutation}:{}),...(job.linkedUpdate?{linkedUpdate:job.linkedUpdate}:{}),...(job.linkedUpdateId?{linkedUpdateId:job.linkedUpdateId}:{})};
  if(job.action==='create_svg'){
   job.payload={originalInput:job.originalInput};
  }
  const recorded=await this.record(job);
  if(!recorded){this.fail(job,'专业源已保存，但操作记录未落盘，请读取当前状态',503,true);return this.jobInfo(job);}
  clearTimeout(job.timer);job.resolve(job.result);return this.jobInfo(job);
 }
 fail(job,message,status=422,uncertain=false){clearTimeout(job.timer);job.status=uncertain?'uncertain':'failed';job.error=message;job.reject(new SafetyError(message,status));this.record(job);}
 record(job){
  if(!['running','queued'].includes(job.status))this.linked.release(job);
  const body={...this.jobInfo(job),operationId:job.operationId,sessionId:job.sessionId,epoch:job.epoch,at:job.at,savedRevision:job.saved||null,savedEngineRevision:job.savedEngineRevision??null,undoProof:job.undoProof||null,command:job.payload?.command||null,...(job.resourceReceiptId?{resourceReceiptId:job.resourceReceiptId}:{}),...(job.originalInput?{originalInput:job.originalInput}:{}),...(job.material?{material:job.material}:{}),...(job.placementReceipt?{placementReceipt:job.placementReceipt}:{}),...(job.placement?{placement:job.placement}:{}),...(job.instanceEdit?{instanceEdit:job.instanceEdit}:{}),...(job.instanceUpdate?{instanceUpdate:job.instanceUpdate}:{}),...(job.applyPlan?{applyPlan:job.applyPlan}:{}),...(job.instanceUpdateReceipt?{instanceUpdateReceipt:job.instanceUpdateReceipt}:{}),...(job.conversionPlan?{conversionPlan:job.conversionPlan}:{}),...(job.conversionReceipt?{conversionReceipt:job.conversionReceipt}:{}),...(job.projectMutation?{projectMutation:job.projectMutation}:{}),...(job.linkedUpdate?{linkedUpdate:job.linkedUpdate}:{}),...(job.linkedUpdateId?{linkedUpdateId:job.linkedUpdateId}:{})};
  job.recordTail=(job.recordTail||Promise.resolve()).then(async()=>{try{
   const dir=workspacePath(job.root,join('design','.designcraft','v2','operations'));await mkdir(dir,{recursive:true});
   atomicWrite(workspacePath(job.root,join(dir,job.id+'.json')),JSON.stringify(body,null,2));return true;
  }catch(error){job.journalError=String(error.message||error);return false;}});
  return job.recordTail;
 }
 close(view){if(view.saving||view.switching)throw new SafetyError('专业源正在提交或切换，请等待结果',423);this.fence(view,'编辑窗口已关闭');return {closed:true};}
 dispose(){this.disposed=true;for(const view of this.views.values())this.fence(view,'设计运行时已停止');}
}

export const editorEngines=engineOf;
