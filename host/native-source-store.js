/** Immutable professional sources + atomic revision pointers. No dcDoc projection owns this content. */
import * as fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import {join} from 'node:path';
import {workspacePath, assertPortableName, assertSafeJson, SafetyError} from './safety.js';
import {isUint64} from '../client/native-protocol.js';
import {SOURCE_FORMATS} from '../client/native-contract.js';
import {brandReceipt} from './brand-updates.js';
import {fontReceipt} from './brand-font-updates.js';

const EXTENSIONS=SOURCE_FORMATS;
const MAX_SOURCE=256*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sameHash=(actual,expected)=>sha(actual)===expected;

async function immutable(file,bytes,{claim=false}={}){
 const temp=file+'.tmp-'+randomUUID();
 let handle;
 try{
  handle=await fs.open(temp,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await fs.link(temp,file);return true;}catch(error){
   if(error.code!=='EEXIST')throw error;
   if(claim)return false;
   if(!sameHash(await fs.readFile(file),sha(bytes)))throw new SafetyError('不可变源文件已损坏，未覆盖',409);
   return false;
  }
 }finally{await handle?.close();await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export class NativeSourceStore {
 constructor(root){this.root=root;}
 directory(id){
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(String(id||'')))throw new SafetyError('非法专业源 ID');
  assertPortableName(id);
  return workspacePath(this.root,join('design','.designcraft','v2','sources',id));
 }
 async pointer(file){
  let bytes;try{const path=workspacePath(this.root,file);
   if((await fs.stat(path)).size>1024)throw new SafetyError('专业源版本指针超过预算',413);
   bytes=await fs.readFile(path);
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
  let pointer;try{pointer=JSON.parse(bytes);}catch{throw new SafetyError('专业源版本指针损坏，历史版本已保留',422);}
  if(!/^[a-f0-9]{64}$/.test(pointer.revision||''))throw new SafetyError('专业源版本指针无效',422);
  return pointer.revision;
 }
 async lineage(id){
  const dir=this.directory(id),records=[],seen=new Set();
  let revision=await this.pointer(join(dir,'root.json')),parentRevision=null;
  while(revision){
   if(seen.has(revision)||records.length>=100000)throw new SafetyError('专业源版本链损坏或超过预算',422);
   seen.add(revision);
   const file=workspacePath(this.root,join(dir,'history',revision+'.json'),{mustExist:true});
   if((await fs.stat(file)).size>1024*1024)throw new SafetyError('专业源版本记录超过预算',413);
   const bytes=await fs.readFile(file);
   if(!sameHash(bytes,revision))throw new SafetyError('专业源历史记录完整性失败',422);
   let meta;try{meta=JSON.parse(bytes);}catch{throw new SafetyError('专业源历史记录损坏',422);}
   assertSafeJson(meta);
   if(meta.schema!==1||meta.id!==id||meta.parentRevision!==parentRevision||!Object.hasOwn(EXTENSIONS,meta.engine)||!/^[a-f0-9]{64}$/.test(meta.sourceHash||''))throw new SafetyError('专业源历史身份无效',422);
   records.push({meta,revision});parentRevision=revision;
   revision=await this.pointer(join(dir,'next',revision+'.json'));
  }
  return records;
 }
 async head(id){
  return (await this.lineage(id)).at(-1)||null;
 }
 async read(id,revision=null){
  const source=await this.source(id,revision);
  return {meta:source.meta,revision:source.revision,bytes:await fs.readFile(source.path)};
 }
 async source(id,revision=null){
  if(revision!==null&&!/^[a-f0-9]{64}$/.test(revision))throw new SafetyError('专业源修订无效',422);
  const lineage=await this.lineage(id),head=revision===null?lineage.at(-1):lineage.find(record=>record.revision===revision);
  if(!head)throw new SafetyError(revision?'指定专业源修订不存在或未提交':'专业源不存在',404);
  const file=workspacePath(this.root,join(this.directory(id),'versions',head.meta.sourceHash+'.'+EXTENSIONS[head.meta.engine]),{mustExist:true});
  const stat=await fs.stat(file);if(stat.size>MAX_SOURCE)throw new SafetyError('专业源超过256MiB预算',413);
  const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);
  if(stat.size!==head.meta.bytes||hash.digest('hex')!==head.meta.sourceHash)throw new SafetyError('专业源完整性检查失败；历史版本已保留',422);
  return {...head,path:file};
 }
 async list(){
  const dir=workspacePath(this.root,join('design','.designcraft','v2','sources'));
  let names;try{names=await fs.readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
  if(names.length>5000)throw new SafetyError('专业源列表超过5000项预算，请拆分项目',413);
  const results=[];
  for(const entry of names){
   if(!entry.isDirectory())continue;
   try{const head=await this.head(entry.name);if(head)results.push({...head.meta,revision:head.revision});}
   catch(error){results.push({id:entry.name,error:String(error.message||error)});}
  }
  return results.sort((a,b)=>(b.at||'').localeCompare(a.at||''));
 }
 async versions(id){
  return (await this.lineage(id)).reverse().map(({revision,meta})=>({revision,...meta}));
 }
 async forkVersion(sourceId,revision,{operationId,title}){
  if(typeof operationId!=='string'||!/^[a-f0-9-]{36}$/.test(operationId))throw new SafetyError('实例分叉身份无效',422);
  const source=await this.source(sourceId,revision),id='fork-'+operationId;
  const origin={action:'instance-edit',operationId,sourceId,revision,sourceHash:source.meta.sourceHash};
  const lineage=await this.lineage(id);
  if(lineage.length){
   const first=lineage[0];
   if(JSON.stringify(first.meta.origin)!==JSON.stringify(origin)||first.meta.sourceHash!==source.meta.sourceHash)throw new SafetyError('实例分叉身份已用于另一份源，未覆盖',409);
   return {sourceId:id,rootRevision:first.revision,...lineage.at(-1),reused:true};
  }
  try{
   const result=await this.commitStream(id,createReadStream(source.path),{engine:source.meta.engine,title:title||source.meta.title,engineState:source.meta.engineState,actor:'manual',origin});
   return {sourceId:id,rootRevision:result.revision,...result};
  }catch(error){
   if(error.status!==409&&error.status!==428)throw error;
   const published=await this.lineage(id);
   if(!published.length)throw error;
   if(JSON.stringify(published[0].meta.origin)!==JSON.stringify(origin)||published[0].meta.sourceHash!==source.meta.sourceHash)throw error;
   return {sourceId:id,rootRevision:published[0].revision,...published.at(-1),reused:true};
  }
 }
 async preserveInput(id,input,{name}){
  if(typeof name!=='string'||name.length>240||!name||/[\\/\0]/.test(name))throw new SafetyError('导入文件名无效',422);
  const extension=name.split('.').at(-1).toLowerCase();
  if(!['svg','vectorcraft','drawcraft','vctemplate','pcraft','png','jpg','jpeg','psd','psb','webp','tif','tiff','deckcraft','slidecraft','pptx','potx','ppsx'].includes(extension))throw new SafetyError('当前导入格式尚未接入专业源保存',422);
  const dir=workspacePath(this.root,join(this.directory(id),'originals'));await fs.mkdir(dir,{recursive:true});
  const temporary=workspacePath(this.root,join(dir,'incoming-'+randomUUID()));let handle,count=0;const hash=createHash('sha256');
  try{
   handle=await fs.open(temporary,'wx');
   for await(const chunk of input){count+=chunk.byteLength;if(count>MAX_SOURCE)throw new SafetyError('导入源超过256MiB预算',413);hash.update(chunk);await handle.writeFile(chunk);}
   if(!count)throw new SafetyError('导入文件为空',422);
   await handle.sync();await handle.close();handle=null;
   const digest=hash.digest('hex'),file=workspacePath(this.root,join(dir,digest+'.'+extension));
   try{await fs.link(temporary,file);}catch(error){
    if(error.code!=='EEXIST')throw error;
    const existing=createHash('sha256');for await(const chunk of createReadStream(file))existing.update(chunk);
    if(existing.digest('hex')!==digest)throw new SafetyError('原始导入文件完整性失败，未覆盖',409);
   }
   const original={name,sha256:digest,bytes:count,file:digest+'.'+extension};
   await immutable(workspacePath(this.root,join(dir,digest+'.json')),Buffer.from(JSON.stringify(original)));
   return {sourceId:id,original};
  }finally{await handle?.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 async commit(id,{engine,title,bytes,baseRevision=null,engineState,actor='manual',operation}){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_SOURCE)throw new SafetyError('专业源为空或超过256MiB预算',413);
  return this.commitStream(id,(async function*(){yield bytes;})(),{engine,title,baseRevision,engineState,actor,operation});
 }
 async commitStream(id,input,{engine,title,baseRevision=null,engineState,actor='manual',operation,origin}){
  if(!Object.hasOwn(EXTENSIONS,engine))throw new SafetyError('未支持的专业源类型');
  if(!['manual','ai','import','recovery'].includes(actor))throw new SafetyError('无效编辑来源');
  if(title!=null&&(typeof title!=='string'||title.length>200))throw new SafetyError('专业源名称无效');
  assertSafeJson(engineState);
  if(!engineState||!isUint64(engineState.uid)||!isUint64(engineState.revision))throw new SafetyError('保存缺少精确的原生引擎身份或修订',422);
  if(engineState.nativeDocumentId!==undefined&&!isUint64(engineState.nativeDocumentId)||engine==='photocraft'&&!isUint64(engineState.nativeDocumentId))throw new SafetyError('保存缺少精确的原生图像文档 ID',422);
  if(operation!==undefined){
   assertSafeJson(operation);
   if(operation?.action==='brand-edit'){
    operation=brandReceipt(operation,baseRevision);
   }else if(operation?.action==='brand-font'){
    operation=fontReceipt(operation,baseRevision);
   }else if(operation?.action==='resource-import'){
    if(baseRevision!==null||typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||!(operation.kind!=='deck'&&/^resource-[a-f0-9]{64}$/.test(operation.resourceReceiptId||'')||operation.kind==='svg'&&/^(?:figmaexport|figmamcpfile|openaisvgjob|externalfile|externallfs)-[a-f0-9]{64}$/.test(operation.resourceReceiptId||'')||operation.kind==='image'&&/^(?:pixelasset|figmaexport|figmamcpasset|figmamcpfile|workflowimage|stitchasset|falrtimage|externalfile|externallfs|stockimage)-[a-f0-9]{64}$/.test(operation.resourceReceiptId||'')||operation.kind==='deck'&&/^(?:externalfile|externallfs)-[a-f0-9]{64}$/.test(operation.resourceReceiptId||''))||!/^[a-f0-9]{64}$/.test(operation.inputHash||'')||!['svg','image','deck'].includes(operation.kind)||operation.kind==='svg'&&engine!=='vectorcraft'||operation.kind==='image'&&(engine!=='photocraft'||id!=='import-'+operation.id)||operation.kind==='deck'&&(engine!=='deckcraft'||id!=='import-'+operation.id))throw new SafetyError('资源导入保存回执无效',422);
    if(operation.resourceReceiptId.startsWith('stitchasset-')&&!/^stitchimage-[a-f0-9]{64}$/.test(operation.originOperationId||''))throw new SafetyError('Stitch 截图导入缺少稳定预约身份',422);
    if(operation.resourceReceiptId.startsWith('figmamcpfile-')&&!/^figmamcpnative-[a-f0-9]{64}$/.test(operation.originOperationId||''))throw new SafetyError('Figma 素材导入缺少稳定预约身份',422);
    if(operation.resourceReceiptId.startsWith('falrtimage-')&&!/^falrtnative-[a-f0-9]{64}$/.test(operation.originOperationId||''))throw new SafetyError('fal 实时图片导入缺少稳定预约身份',422);
    if(operation.resourceReceiptId.startsWith('stockimage-')&&!/^stockphoto-native-[a-f0-9]{64}$/.test(operation.originOperationId||''))throw new SafetyError('图库图片导入缺少稳定预约身份',422);
    const external=/^(?:externalfile|externallfs)-/.test(operation.resourceReceiptId);
    if(external&&(operation.kind==='deck'||operation.originOperationId!==undefined)&&!/^external-native-[a-f0-9]{64}$/.test(operation.originOperationId||''))throw new SafetyError('外部原生导入预约身份无效',422);
    operation={action:'resource-import',id:operation.id,resourceReceiptId:operation.resourceReceiptId,inputHash:operation.inputHash,kind:operation.kind,...(external&&operation.originOperationId!==undefined||/^(?:stitchasset|figmamcpfile|falrtimage|stockimage)-/.test(operation.resourceReceiptId)?{originOperationId:operation.originOperationId}:{})};
   }else if(operation?.action==='convert-svg'){
    if(typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||!/^use-[a-f0-9-]{36}$/.test(operation.instanceId||'')||!/^asset-[a-f0-9-]{36}$/.test(operation.assetId||'')||!Number.isSafeInteger(operation.nativeId)||operation.nativeId<1||operation.nativeId>0xffffffff||!/^[a-f0-9]{64}$/.test(operation.baseRevision||'')||operation.baseRevision!==baseRevision||!/^[a-f0-9]{64}$/.test(operation.shapesHash||'')||!Array.isArray(operation.shapeIds)||operation.shapeIds.length<1||operation.shapeIds.length>512||operation.shapeIds.some(id=>!Number.isSafeInteger(id)||id<1||id>0xffffffff||id===operation.nativeId)||new Set(operation.shapeIds).size!==operation.shapeIds.length)throw new SafetyError('SVG 原生对象转换回执无效',422);
    operation={action:'convert-svg',id:operation.id,instanceId:operation.instanceId,assetId:operation.assetId,nativeId:operation.nativeId,baseRevision,shapeIds:[...operation.shapeIds],shapesHash:operation.shapesHash};
   }else if(operation?.action==='attach-origins'){
    if(typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||operation.baseRevision!==baseRevision||!Array.isArray(operation.origins)||!operation.origins.length||operation.origins.length>100)throw new SafetyError('原生来源补入回执无效',422);
    const origins=operation.origins.map(row=>{
     if(!/^use-[a-f0-9-]{36}$/.test(row.instanceId||'')||!isUint64(row.id)||row.hostMaterial?.schema!==1||!/^project-[a-f0-9-]{36}$/.test(row.hostMaterial.projectId||'')||!/^asset-[a-f0-9-]{36}$/.test(row.hostMaterial.assetId||''))throw new SafetyError('原生来源补入对象无效',422);
     return {instanceId:row.instanceId,id:String(row.id),hostMaterial:{schema:1,projectId:row.hostMaterial.projectId,assetId:row.hostMaterial.assetId}};
    });
    operation={action:'attach-origins',id:operation.id,baseRevision,origins};
   }else if(operation?.action==='linked-update'){
    if(typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||operation.updateId!=='update-'+operation.id||!/^link-[a-f0-9-]{36}$/.test(operation.linkId||'')||!/^asset-[a-f0-9-]{36}$/.test(operation.assetId||'')||!/^[a-f0-9]{64}$/.test(operation.baseRevision||'')||operation.baseRevision!==baseRevision||!Array.isArray(operation.instanceIds)||!operation.instanceIds.length||operation.instanceIds.length>100||new Set(operation.instanceIds).size!==operation.instanceIds.length||operation.instanceIds.some(id=>!/^use-[a-f0-9-]{36}$/.test(id)))throw new SafetyError('关联更新回执无效',422);
    operation={action:'linked-update',id:operation.id,updateId:operation.updateId,linkId:operation.linkId,assetId:operation.assetId,baseRevision:operation.baseRevision,instanceIds:[...operation.instanceIds]};
   }else if(operation?.action==='variant-adopt'){
    if(typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||!/^variants-[a-f0-9-]{36}$/.test(operation.groupId||'')||!/^variant-[a-f0-9-]{36}$/.test(operation.variantId||'')||!/^[a-f0-9]{64}$/.test(operation.variantRevision||'')||operation.baseRevision!==baseRevision||operation.projectRevision!==undefined&&!/^[a-f0-9]{64}$/.test(operation.projectRevision))throw new SafetyError('方案采用回执无效',422);
    operation={action:'variant-adopt',id:operation.id,groupId:operation.groupId,variantId:operation.variantId,variantRevision:operation.variantRevision,baseRevision,...(operation.projectRevision?{projectRevision:operation.projectRevision}:{})};
   }else if(operation?.action==='variant-revert'){
    if(typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||!/^variants-[a-f0-9-]{36}$/.test(operation.groupId||'')||!/^[a-f0-9]{64}$/.test(operation.adoptionRevision||'')||!/^[a-f0-9]{64}$/.test(operation.restoredRevision||'')||operation.baseRevision!==baseRevision)throw new SafetyError('方案撤销回执无效',422);
    operation={action:'variant-revert',id:operation.id,groupId:operation.groupId,adoptionRevision:operation.adoptionRevision,restoredRevision:operation.restoredRevision,baseRevision};
   }else if(operation?.action==='image-adopt'){
    if(typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||!/^image-[a-f0-9-]{36}$/.test(operation.imageJobId||'')||!/^candidate-[a-f0-9-]{36}$/.test(operation.candidateId||'')||!/^[a-f0-9]{64}$/.test(operation.sourceHash||'')||operation.baseRevision!==baseRevision||operation.originalRevision!==undefined&&!/^[a-f0-9]{64}$/.test(operation.originalRevision))throw new SafetyError('图片候选采用回执无效',422);
    operation={action:'image-adopt',id:operation.id,imageJobId:operation.imageJobId,candidateId:operation.candidateId,sourceHash:operation.sourceHash,baseRevision,...(operation.originalRevision?{originalRevision:operation.originalRevision}:{})};
   }else if(operation?.action==='image-revert'){
    if(typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||!/^image-[a-f0-9-]{36}$/.test(operation.imageJobId||'')||!/^candidate-[a-f0-9-]{36}$/.test(operation.candidateId||'')||!/^[a-f0-9]{64}$/.test(operation.sourceHash||'')||!/^[a-f0-9]{64}$/.test(operation.restoreRevision||'')||operation.baseRevision!==baseRevision)throw new SafetyError('图片候选撤销回执无效',422);
    operation={action:'image-revert',id:operation.id,imageJobId:operation.imageJobId,candidateId:operation.candidateId,sourceHash:operation.sourceHash,restoreRevision:operation.restoreRevision,baseRevision};
   }else{
   if(!['place','apply-instance'].includes(operation?.action)||typeof operation.id!=='string'||!/^[a-f0-9-]{36}$/.test(operation.id)||typeof operation.assetId!=='string'||!/^asset-[a-f0-9-]{36}$/.test(operation.assetId)||!isUint64(operation.nativeId))throw new SafetyError('素材动作回执无效',422);
   if(operation.action==='place')operation={action:'place',id:operation.id,assetId:operation.assetId,nativeId:operation.nativeId};
   else{
    if(!/^edit-[a-f0-9-]{36}$/.test(operation.editId||'')||!/^use-[a-f0-9-]{36}$/.test(operation.instanceId||'')||!/^asset-[a-f0-9-]{36}$/.test(operation.previousAssetId||'')||!/^[a-f0-9]{64}$/.test(operation.baseRevision||'')||operation.baseRevision!==baseRevision)throw new SafetyError('原位回写回执无效',422);
    if(operation.legacyKindHash!==undefined&&!/^[a-f0-9]{64}$/.test(operation.legacyKindHash))throw new SafetyError('旧 SVG 原生边框回执无效',422);
    operation={action:'apply-instance',id:operation.id,editId:operation.editId,instanceId:operation.instanceId,assetId:operation.assetId,previousAssetId:operation.previousAssetId,nativeId:operation.nativeId,baseRevision:operation.baseRevision,...(operation.legacyKindHash?{legacyKindHash:operation.legacyKindHash}:{})};
   }
   }
  }
  const dir=this.directory(id);await fs.mkdir(dir,{recursive:true});
   const current=await this.head(id);
   if(origin!==undefined){
    assertSafeJson(origin);
    if(current||!['instance-edit','variant-fork'].includes(origin?.action)||typeof origin.operationId!=='string'||!/^[a-f0-9-]{36}$/.test(origin.operationId)||id!==(origin.action==='instance-edit'?'fork-':'variant-')+origin.operationId)throw new SafetyError('分叉来源无效',422);
    const original=await this.source(origin.sourceId,origin.revision);
    if(original.meta.sourceHash!==origin.sourceHash||original.meta.engine!==engine)throw new SafetyError('实例分叉来源版本不一致',409);
    origin={action:origin.action,operationId:origin.operationId,sourceId:origin.sourceId,revision:origin.revision,sourceHash:origin.sourceHash};
   }
   if(current&&baseRevision==null)throw new SafetyError('保存需要当前专业源版本',428);
   if((current?.revision||null)!==baseRevision)throw new SafetyError('专业源已被更新，旧结果未覆盖任何修改',409);
   if(current&&current.meta.engine!==engine)throw new SafetyError('专业源引擎不能在保存时改变',409);
   await fs.mkdir(workspacePath(this.root,join(dir,'versions')),{recursive:true});
   await fs.mkdir(workspacePath(this.root,join(dir,'history')),{recursive:true});
   await fs.mkdir(workspacePath(this.root,join(dir,'next')),{recursive:true});
   const temp=workspacePath(this.root,join(dir,'versions','incoming-'+randomUUID()));
   let handle,count=0;const hash=createHash('sha256');
   let sourceHash;
   try{
    handle=await fs.open(temp,'wx');
    for await(const chunk of input){
     if(!Buffer.isBuffer(chunk)&&!(chunk instanceof Uint8Array))throw new SafetyError('专业源必须为二进制数据');
     count+=chunk.byteLength;if(count>MAX_SOURCE)throw new SafetyError('专业源超过256MiB预算',413);
     hash.update(chunk);await handle.writeFile(chunk);
    }
    if(!count)throw new SafetyError('专业源为空',422);
    await handle.sync();await handle.close();handle=null;sourceHash=hash.digest('hex');
    const source=workspacePath(this.root,join(dir,'versions',sourceHash+'.'+EXTENSIONS[engine]));
    try{await fs.link(temp,source);}catch(error){
     if(error.code!=='EEXIST')throw error;
     const existing=createHash('sha256');for await(const chunk of createReadStream(source))existing.update(chunk);
     if(existing.digest('hex')!==sourceHash)throw new SafetyError('不可变专业源已损坏，未覆盖',409);
    }
   }finally{await handle?.close();await fs.unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
   if(origin&&sourceHash!==origin.sourceHash)throw new SafetyError('分叉字节与来源版本不一致，未发布',409);
   const meta={schema:1,id,engine,title:title??current?.meta.title??'未命名设计',sourceHash,bytes:count,
    parentRevision:current?.revision||null,engineState:{uid:engineState.uid,revision:engineState.revision,...(engineState.nativeDocumentId!==undefined?{nativeDocumentId:engineState.nativeDocumentId}:{})},actor,at:new Date().toISOString(),...(operation?{operation}:{}),...(origin?{origin}:{})};
   const body=Buffer.from(JSON.stringify(meta,null,2)),revision=sha(body);
   await immutable(workspacePath(this.root,join(dir,'history',revision+'.json')),body);
   // Atomic no-replace publication is a filesystem CAS on this exact parent revision.
   // A crash before it leaves only unreferenced immutable bytes; after it the commit is complete.
   // There is no stale lock to strand a document after a process dies.
   const pointer=workspacePath(this.root,current?join(dir,'next',current.revision+'.json'):join(dir,'root.json'));
   const published=await immutable(pointer,Buffer.from(JSON.stringify({revision})),{claim:true});
   if(!published)throw new SafetyError('专业源已被另一编辑提交，未覆盖任何修改',409);
   return {meta,revision};
 }
}
