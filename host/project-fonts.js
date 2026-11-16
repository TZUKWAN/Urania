/** Project-scoped font registrations backed by verified external-file receipts. */
import {createHash,randomUUID} from 'node:crypto';
import {readFile,readdir,mkdir,stat,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {atomicCreate} from './persistence.js';
import {saveAsset} from './docstore.js';
import {SafetyError,assertSafeJson,assertPortableName,workspacePath} from './safety.js';
import {readExternalSkillFiles,validateExternalLfsFile} from './external-skill-bundles.js';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=bytes=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
const FILE_ID=/^externalfile-[a-f0-9]{64}$/,LFS_ID=/^externallfs-[a-f0-9]{64}$/,USER_ID=/^userfont-[a-f0-9]{64}$/,BUNDLE_ID=/^externalbundle-[a-f0-9]{64}$/,FONT_ID=/^projectfont-[a-f0-9]{64}$/;
const TEMP=/^projectfont-[a-f0-9]{64}\.json\.tmp-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const USER_TEMP=/^userfont-[a-f0-9]{64}\.json\.tmp-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HISTORY=/^projectfont-[a-f0-9]{64}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/;
const directory=root=>workspacePath(root,join('design','.designcraft','v2','resource-imports'));
const identity=fileId=>'projectfont-'+sha(Buffer.from(JSON.stringify([fileId])));
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sfnt=bytes=>bytes.length>=4&&(bytes.subarray(0,4).equals(Buffer.from([0,1,0,0]))||['OTTO','true'].includes(bytes.subarray(0,4).toString('ascii')));

export function validateUserFontFile(file){
 assertSafeJson(file);
 if(!file||file.schema!==1||file.kind!=='user-font-file'||!USER_ID.test(file.id||'')||typeof file.file!=='string'||file.file.length>120||!/\.(?:ttf|otf)$/i.test(file.file)||!/^[a-f0-9]{64}$/.test(file.sha256||'')||!Number.isSafeInteger(file.bytes)||file.bytes<4||file.bytes>4*1024*1024||typeof file.assetName!=='string'||!/^userfont-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:ttf|otf)$/i.test(file.assetName)||!file.assetName.startsWith('userfont-'+file.sha256.slice(0,24))||file.id!=='userfont-'+sha(Buffer.from(JSON.stringify([file.file,file.sha256]))))throw new SafetyError('用户字体来源记录无效',409);
 assertPortableName(file.file);return true;
}
export function validateUserFontBytes(file,bytes){
 validateUserFontFile(file);
 if(!Buffer.isBuffer(bytes)||bytes.length!==file.bytes||sha(bytes)!==file.sha256||!sfnt(bytes))throw new SafetyError('用户字体原件不一致或格式不受支持',409);
 return true;
}
function assertFile(file){
 if(file?.kind==='user-font-file')return validateUserFontFile(file);
 if(file?.kind==='external-lfs-file'){validateExternalLfsFile(file);if(!/\.(?:ttf|otf)$/i.test(file.file)||file.bytes<4||file.bytes>4*1024*1024)throw new SafetyError('LFS 项目字体格式或大小无效',409);return;}
 if(!file||file.schema!==1||file.kind!=='external-file'||!FILE_ID.test(file.id||'')||!BUNDLE_ID.test(file.bundleId||'')||typeof file.file!=='string'||!/\.(?:ttf|otf)$/i.test(file.file)||!/^[a-f0-9]{40}$/.test(file.gitSha1||'')||!/^[a-f0-9]{64}$/.test(file.sha256||'')||!Number.isSafeInteger(file.bytes)||file.bytes<4||file.bytes>4*1024*1024||typeof file.assetName!=='string'||!/^extfile-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:ttf|otf)$/i.test(file.assetName)||!file.assetName.startsWith('extfile-'+file.sha256.slice(0,24))||file.id!=='externalfile-'+sha(Buffer.from(JSON.stringify([file.bundleId,file.file,file.gitSha1]))))throw new SafetyError('项目字体的外部文件来源无效',409);
}
function sameSource(a,b){
 assertFile(a);assertFile(b);const fields=['schema','kind','id','file','sha256','bytes','assetName'];
 if(a.kind==='external-file'||a.kind==='external-lfs-file')fields.push('bundleId','gitSha1');
 return fields.every(key=>a[key]===b[key]);
}
export function validateProjectFontRecord(record,file){
 assertSafeJson(record);assertFile(file);
 if(!record||record.schema!==1||record.kind!=='project-font'||!FONT_ID.test(record.id||'')||record.id!==identity(file.id)||record.fileId!==file.id||record.bundleId!==(file.bundleId||null)||record.file!==file.file||record.sha256!==file.sha256||record.bytes!==file.bytes)throw new SafetyError('项目字体登记与来源文件不一致',409);
 return true;
}
async function jsonFile(root,name){
 const path=workspacePath(root,join(directory(root),name),{mustExist:true}),info=await stat(path);
 if(!info.isFile()||info.size>16384)throw new SafetyError('项目字体记录无效或过大',409);
 const value=JSON.parse(await readFile(path,'utf8'));assertSafeJson(value);return value;
}
async function sourceFile(root,id){if(!FILE_ID.test(id||'')&&!LFS_ID.test(id||'')&&!USER_ID.test(id||''))throw new SafetyError('字体来源身份无效',422);const file=await jsonFile(root,id+'.json');assertFile(file);if(file.id!==id)throw new SafetyError('字体来源身份不一致',409);return file;}
async function storedBytes(root,file){
 const path=workspacePath(root,join('design','assets',file.assetName),{mustExist:true}),info=await stat(path);
 if(!info.isFile()||info.size!==file.bytes)throw new SafetyError('项目字体原文件缺失或大小改变',409);
 const bytes=await readFile(path);if(sha(bytes)!==file.sha256||file.kind==='external-file'&&git(bytes)!==file.gitSha1||!sfnt(bytes))throw new SafetyError('项目字体原文件内容不一致或格式不受支持',409);
 return bytes;
}
async function verifyFontOrigin(library,root,file,signal){
 const stored=await storedBytes(root,file);signal?.throwIfAborted();
 if(file.kind==='external-file'||file.kind==='external-lfs-file'){
  const verified=await readExternalSkillFiles(library,root,file.bundleId,[file.file],signal),original=verified.files[0];
  verifyFontMatch(file,original,stored);
 }
 return stored;
}

/** Read one active project font without fetching or substituting another font. */
export async function projectFontForHtml(library,root,id,signal){
 if(!FONT_ID.test(id||''))throw new SafetyError('项目字体身份无效',422);
 const first=(await listProjectFonts(root)).find(item=>item.record.id===id);if(!first)throw new SafetyError('项目字体不存在或已停用',404);
 const bytes=await verifyFontOrigin(library,root,first.file,signal);signal?.throwIfAborted();
 const latest=(await listProjectFonts(root)).find(item=>item.record.id===id);
 if(!latest||JSON.stringify(latest.record)!==JSON.stringify(first.record)||!sameSource(latest.file,first.file))throw new SafetyError('读取期间项目字体登记已改变，请重新选择',409);
 return {record:first.record,file:first.file,bytes};
}
function verifyFontMatch(file,source,stored){
 if(!source)throw new SafetyError('项目字体在外部原包中缺失',409);
 if(file.kind==='external-lfs-file'){validateExternalLfsFile(file,source.metadata);return;}
 if(!source.bytes.equals(stored)||source.metadata.sha256!==file.sha256||source.metadata.gitSha1!==file.gitSha1||source.metadata.lfs)throw new SafetyError('项目字体与外部原包不一致',409);
}

/** Save the actual bytes the user supplied; this does not assert a license. */
export async function saveUserFont(root,name,bytes,assertCurrent,signal){
 signal?.throwIfAborted();if(typeof name!=='string'||name.length>120||!/\.(?:ttf|otf)$/i.test(name))throw new SafetyError('请选择 TTF 或 OTF 字体文件',422);
 assertPortableName(name);if(!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>4*1024*1024||!sfnt(bytes))throw new SafetyError('字体文件为空、格式不受支持或超过 4 MiB',422);
 const digest=sha(bytes),id='userfont-'+sha(Buffer.from(JSON.stringify([name,digest]))),suffix=name.slice(name.lastIndexOf('.')).toLowerCase();
 signal?.throwIfAborted();assertCurrent?.();const asset=saveAsset(root,'userfont-'+digest.slice(0,24)+suffix,bytes);
 const file={schema:1,kind:'user-font-file',id,file:name,sha256:digest,bytes:bytes.length,assetName:asset.name};
 try{
  await mkdir(directory(root),{recursive:true});signal?.throwIfAborted();assertCurrent?.();
  const path=workspacePath(root,join(directory(root),id+'.json'));
  if(!atomicCreate(path,encode(file))){const previous=await jsonFile(root,id+'.json');if(!sameSource(previous,file))throw new SafetyError('用户字体来源记录冲突，原文件未覆盖',409);}
 }catch(error){error.retained={file,asset:{name:asset.name,path:asset.path,bytes:asset.size},materialized:true,provenanceRecorded:false};throw error;}
 return {file,asset:{name:asset.name,path:asset.path,bytes:asset.size},materialized:true,provenanceRecorded:true,...(signal?.aborted?{completedAfterCancel:true}:{}),note:'原字体按用户提供的字节保存；使用和分发许可需依据该字体的实际条款确认。'};
}

export async function listProjectFonts(root){
 let items;try{items=await readdir(directory(root),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const candidates=items.filter(item=>item.name.startsWith('projectfont-'));
 if(candidates.some(item=>!/^projectfont-[a-f0-9]{64}\.json$/.test(item.name)&&!TEMP.test(item.name)))throw new SafetyError('项目字体目录包含无法识别的记录，原文件已保留',409);
 const names=candidates.filter(item=>/^projectfont-[a-f0-9]{64}\.json$/.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name));
 if(names.length>64||names.some(item=>!item.isFile()))throw new SafetyError('项目字体登记无效或超过预算',413);
 const result=[];for(const item of names){const record=await jsonFile(root,item.name),file=await sourceFile(root,record.fileId);validateProjectFontRecord(record,file);if(record.id+'.json'!==item.name)throw new SafetyError('项目字体文件名不一致',409);result.push({record,file});}
 return result;
}

/** Interrupted atomic writes remain visible and are never treated as committed. */
export async function pendingProjectFonts(root){
 let entries;try{entries=await readdir(directory(root),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const pending=entries.filter(item=>TEMP.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name));
 if(pending.length>128||pending.some(item=>!item.isFile()))throw new SafetyError('未发布字体记录无效或超过预算',413);
 const result=[];
 for(const item of pending){
  try{
   const record=await jsonFile(root,item.name),file=await sourceFile(root,record.fileId);validateProjectFontRecord(record,file);
   if(!item.name.startsWith(record.id+'.json.tmp-'))throw new Error('临时文件身份不一致');
   await storedBytes(root,file);
   let redundant=false;try{const current=await jsonFile(root,record.id+'.json');redundant=JSON.stringify(current)===JSON.stringify(record);}catch(error){if(error.status!==404&&error.code!=='ENOENT')throw error;}
   result.push({name:item.name,fontId:record.id,file:record.file,recoverable:true,redundant});
  }catch(error){result.push({name:item.name,recoverable:false,error:String(error.message||error)});}
 }
 return result;
}

export async function pendingUserFonts(root){
 let entries;try{entries=await readdir(directory(root),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const pending=entries.filter(item=>USER_TEMP.test(item.name)).sort((a,b)=>a.name.localeCompare(b.name));
 if(pending.length>128||pending.some(item=>!item.isFile()))throw new SafetyError('未发布用户字体记录无效或超过预算',413);
 const result=[];
 for(const item of pending){
  try{
   const file=await jsonFile(root,item.name);validateUserFontFile(file);if(!item.name.startsWith(file.id+'.json.tmp-'))throw new Error('临时文件身份不一致');
   await storedBytes(root,file);const fontId=identity(file.id);let redundant=false;
   try{const saved=await sourceFile(root,file.id),active=await jsonFile(root,fontId+'.json');validateProjectFontRecord(active,saved);redundant=sameSource(saved,file);}
   catch(error){if(error.status!==404&&error.code!=='ENOENT')throw error;}
   result.push({name:item.name,fontId,file:file.file,recoverable:true,redundant,kind:'user-source'});
  }catch(error){result.push({name:item.name,recoverable:false,error:String(error.message||error),kind:'user-source'});}
 }
 const saved=entries.filter(item=>/^userfont-[a-f0-9]{64}\.json$/.test(item.name));
 if(saved.length>512||saved.some(item=>!item.isFile()))throw new SafetyError('用户字体来源记录无效或超过预算',413);
 const active=new Set((await listProjectFonts(root)).map(item=>item.record.id)),disabled=new Set((await disabledProjectFonts(root)).map(item=>item.fontId)),listed=new Set([...result,...await pendingProjectFonts(root)].map(item=>item.fontId).filter(Boolean));
 for(const item of saved){
  try{
   const file=await sourceFile(root,item.name.slice(0,-5)),fontId=identity(file.id);if(active.has(fontId)||disabled.has(fontId)||listed.has(fontId))continue;
   await storedBytes(root,file);result.push({name:item.name,fontId,file:file.file,recoverable:true,redundant:false,kind:'user-saved'});
  }catch(error){result.push({name:item.name,recoverable:false,error:String(error.message||error),kind:'user-saved'});}
 }
 return result;
}

export async function recoverUserFont(root,name,signal,assertCurrent){
 signal?.throwIfAborted();if(typeof name!=='string'||!USER_TEMP.test(name))throw new SafetyError('用户字体候选身份无效',422);
 const candidate=(await pendingUserFonts(root)).find(item=>item.name===name);if(!candidate?.recoverable)throw new SafetyError('用户字体候选不完整，原文件已保留',409);
 const source=workspacePath(root,join(directory(root),name),{mustExist:true});if((await stat(source)).size>16384)throw new SafetyError('用户字体临时记录超过预算',413);
 const raw=await readFile(source);let file;try{file=JSON.parse(raw.toString('utf8'));}catch{throw new SafetyError('用户字体临时记录已损坏，原文件已保留',409);}
 validateUserFontFile(file);if(!name.startsWith(file.id+'.json.tmp-'))throw new SafetyError('用户字体临时记录身份不一致',409);
 const bytes=await storedBytes(root,file);signal?.throwIfAborted();assertCurrent?.();const saved=await saveUserFont(root,file.file,bytes,assertCurrent,signal);
 let result;try{result=await registerProjectFont(root,saved.file,assertCurrent,signal);}catch(error){error.retained={...saved,provenanceRecorded:true,fontRegistered:false};throw error;}
 try{
  signal?.throwIfAborted();const history=workspacePath(root,join('design','.designcraft','v2','userfont-recovered'));await mkdir(history,{recursive:true});
  if((await readdir(history)).length>=256)throw new SafetyError('用户字体恢复历史已达到预算',413);
  if(!(await readFile(source)).equals(raw))throw new SafetyError('用户字体临时记录已改变',409);
  signal?.throwIfAborted();assertCurrent?.();await rename(source,workspacePath(root,join(history,file.id+'-'+randomUUID()+'.json')));
  return {...result,recovered:true,historySaved:true,note:'已恢复用户字体登记并保留原临时记录；字体许可需按实际条款确认。'};
 }catch(error){return {...result,recovered:true,historySaved:false,...(signal?.aborted?{completedAfterCancel:true}:{}),note:'用户字体已登记；临时记录尚未归档，原文件保留，请在项目字体列表重新核对。原因：'+String(error.message||error).slice(0,200)};}
}

export async function recoverAnyProjectFont(library,root,name,signal,assertCurrent){
 if(typeof name==='string'&&/^userfont-[a-f0-9]{64}\.json$/.test(name)){
  signal?.throwIfAborted();const file=await sourceFile(root,name.slice(0,-5));if(file.kind!=='user-font-file')throw new SafetyError('用户字体来源无效',409);
  await storedBytes(root,file);signal?.throwIfAborted();assertCurrent?.();const result=await registerProjectFont(root,file,assertCurrent,signal);
  return {...result,recovered:true,note:'已恢复用户字体登记；来源文件保留，字体许可需按实际条款确认。'};
 }
 return USER_TEMP.test(name||'')?recoverUserFont(root,name,signal,assertCurrent):recoverProjectFont(library,root,name,signal,assertCurrent);
}

/** Explicitly move an unreadable candidate aside without deleting its bytes. */
export async function quarantineProjectFont(root,name,signal,assertCurrent){
 signal?.throwIfAborted();if(typeof name!=='string'||!TEMP.test(name)&&!USER_TEMP.test(name))throw new SafetyError('字体临时候选身份无效',422);
 const entries=await readdir(directory(root),{withFileTypes:true}),entry=entries.find(item=>item.name===name);
 if(!entry?.isFile())throw new SafetyError('字体临时候选不存在或不是普通文件',404);
 const source=workspacePath(root,join(directory(root),name),{mustExist:true}),info=await stat(source);
 if(!info.isFile()||info.size>1024*1024)throw new SafetyError('字体临时候选超过归档预算，原文件保留',413);
 const history=workspacePath(root,join('design','.designcraft','v2','font-quarantine'));await mkdir(history,{recursive:true});
 if((await readdir(history)).length>=256)throw new SafetyError('字体候选保留区已达到预算',413);
 signal?.throwIfAborted();assertCurrent?.();const archived=name+'.saved-'+randomUUID();
 await rename(source,workspacePath(root,join(history,archived)));
 return {quarantined:true,archived,...(signal?.aborted?{completedAfterCancel:true}:{}),note:'未完成记录已移出待恢复列表并原样保留；字体原件未删除。'};
}

export async function recoverProjectFont(library,root,name,signal,assertCurrent){
 signal?.throwIfAborted();if(typeof name!=='string'||!TEMP.test(name))throw new SafetyError('字体候选身份无效',422);
 const candidate=(await pendingProjectFonts(root)).find(item=>item.name===name);
 if(!candidate?.recoverable)throw new SafetyError('字体候选不完整或来源缺失，原文件已保留',409);
 const temporary=workspacePath(root,join(directory(root),name),{mustExist:true});if((await stat(temporary)).size>16384)throw new SafetyError('字体临时记录超过预算，原文件已保留',413);
 const originalRecord=await readFile(temporary);
 if(originalRecord.length>16384)throw new SafetyError('字体临时记录超过预算，原文件已保留',413);
 let record;try{record=JSON.parse(originalRecord.toString('utf8'));}catch{throw new SafetyError('字体临时记录已损坏，原文件已保留',409);}
 assertSafeJson(record);const file=await sourceFile(root,record.fileId);validateProjectFontRecord(record,file);
 if(!name.startsWith(record.id+'.json.tmp-'))throw new SafetyError('字体临时记录身份不一致',409);
 await verifyFontOrigin(library,root,file,signal);
 signal?.throwIfAborted();assertCurrent?.();
 const result=await registerProjectFont(root,file,assertCurrent,signal);
 try{
  signal?.throwIfAborted();const history=workspacePath(root,join('design','.designcraft','v2','font-recovered'));await mkdir(history,{recursive:true});
  if((await readdir(history)).length>=256)throw new SafetyError('字体恢复历史已达到预算',413);
  const source=workspacePath(root,join(directory(root),name),{mustExist:true});
  if(!(await readFile(source)).equals(originalRecord))throw new SafetyError('字体临时记录已改变',409);
  signal?.throwIfAborted();assertCurrent?.();
  await rename(source,workspacePath(root,join(history,record.id+'-'+randomUUID()+'.json')));
  return {...result,recovered:true,historySaved:true,note:'已恢复完整字体登记，原临时记录已保留在恢复历史中。'};
 }catch(error){return {...result,recovered:true,historySaved:false,...(signal?.aborted?{completedAfterCancel:true}:{}),note:'字体登记已恢复；临时记录尚未归档，已保留原文件，请在项目字体列表中重新核对。原因：'+String(error.message||error).slice(0,200)};}
}

/** Registration is explicit; it never installs fonts into the operating system. */
export async function registerProjectFont(root,expected,assertCurrent,signal){
 signal?.throwIfAborted();assertFile(expected);const file=await sourceFile(root,expected.id);
 if(!sameSource(file,expected))throw new SafetyError('字体来源已改变，请重新选择',409);
 await storedBytes(root,file);signal?.throwIfAborted();assertCurrent?.();
 const record={schema:1,kind:'project-font',id:identity(file.id),fileId:file.id,bundleId:file.bundleId||null,file:file.file,sha256:file.sha256,bytes:file.bytes};
 const existing=await listProjectFonts(root);
 if(!existing.some(item=>item.record.id===record.id)&&(existing.length>=16||existing.reduce((sum,item)=>sum+item.record.bytes,0)+record.bytes>16*1024*1024))throw new SafetyError('项目字体已达到数量或大小预算',413);
 await mkdir(directory(root),{recursive:true});signal?.throwIfAborted();assertCurrent?.();
 const path=workspacePath(root,join(directory(root),record.id+'.json'));
 if(!atomicCreate(path,encode(record))){const previous=await jsonFile(root,record.id+'.json');if(JSON.stringify(previous)!==JSON.stringify(record))throw new SafetyError('项目字体登记冲突，未覆盖原记录',409);}
 const note=file.kind==='user-font-file'?'字体仅注册到本项目；该文件由用户提供，其使用和分发许可需按实际条款确认。':'字体仅注册到本项目；原包附带的许可已保留，具体字体的适用许可仍需核对。';
 return {font:record,registered:true,...(signal?.aborted?{completedAfterCancel:true}:{}),note};
}

/** Stop loading one registration on future opens, preserving the record and source. */
export async function disableProjectFont(root,id,assertCurrent,signal){
 signal?.throwIfAborted();if(!FONT_ID.test(id||''))throw new SafetyError('项目字体身份无效',422);
 const entries=await listProjectFonts(root),item=entries.find(value=>value.record.id===id);
 if(!item)throw new SafetyError('项目字体登记不存在或已停用',404);
 if([...(await pendingProjectFonts(root)),...(await pendingUserFonts(root))].some(candidate=>candidate.fontId===id&&candidate.redundant))throw new SafetyError('该字体还有未归档的临时记录，请先在项目字体列表归档',409);
 const history=workspacePath(root,join('design','.designcraft','v2','font-disabled'));await mkdir(history,{recursive:true});
 if((await readdir(history)).length>=256)throw new SafetyError('字体停用历史已达到预算',413);
 const source=workspacePath(root,join(directory(root),id+'.json'),{mustExist:true});
 if((await stat(source)).size>16384)throw new SafetyError('项目字体登记超过预算，未停用',413);
 const prior=await readFile(source);let decoded;try{decoded=JSON.parse(prior.toString('utf8'));}catch{throw new SafetyError('项目字体登记已损坏，未停用',409);}
 assertSafeJson(decoded);validateProjectFontRecord(decoded,item.file);
 if(JSON.stringify(decoded)!==JSON.stringify(item.record))throw new SafetyError('项目字体登记已改变，未停用',409);
 if(!(await readFile(source)).equals(prior))throw new SafetyError('项目字体登记已改变，未停用',409);
 signal?.throwIfAborted();assertCurrent?.();
 const target=workspacePath(root,join(history,id+'-'+randomUUID()+'.json'));await rename(source,target);
 return {font:item.record,disabled:true,...(signal?.aborted?{completedAfterCancel:true}:{}),note:'来源文件和停用前记录已保留；已打开的编辑器需重新打开后才会停止使用该字体。'};
}

async function disabledRecord(root,name){
 if(typeof name!=='string'||!HISTORY.test(name))throw new SafetyError('停用字体历史身份无效',422);
 const path=workspacePath(root,join('design','.designcraft','v2','font-disabled',name),{mustExist:true}),info=await stat(path);
 if(!info.isFile()||info.size>16384)throw new SafetyError('停用字体历史无效或过大',409);
 const record=JSON.parse(await readFile(path,'utf8'));assertSafeJson(record);const file=await sourceFile(root,record.fileId);
 validateProjectFontRecord(record,file);if(!name.startsWith(record.id+'-'))throw new SafetyError('停用字体历史身份不一致',409);
 return {record,file};
}
export async function disabledProjectFonts(root){
 const path=workspacePath(root,join('design','.designcraft','v2','font-disabled'));let entries;
 try{entries=await readdir(path,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 if(entries.length>256||entries.some(item=>!item.isFile()||!HISTORY.test(item.name)))throw new SafetyError('停用字体历史无效或超过预算',413);
 const active=new Set((await listProjectFonts(root)).map(item=>item.record.id)),seen=new Set(),result=[];
 for(const item of entries.sort((a,b)=>a.name.localeCompare(b.name))){
  const value=await disabledRecord(root,item.name);if(active.has(value.record.id)||seen.has(value.record.id))continue;
  seen.add(value.record.id);result.push({name:item.name,fontId:value.record.id,file:value.record.file});
 }
 return result;
}
export async function enableProjectFont(library,root,name,signal,assertCurrent){
 signal?.throwIfAborted();const {file}=await disabledRecord(root,name);await verifyFontOrigin(library,root,file,signal);
 signal?.throwIfAborted();assertCurrent?.();const result=await registerProjectFont(root,file,assertCurrent,signal);
 return {...result,enabled:true,note:'项目字体已重新启用，原停用记录保留；已打开的编辑器需重新打开后加载。'};
}

/** Snapshot bounded actual bytes after rechecking each containing original bundle. */
export async function projectFontSnapshot(library,root,signal){
 const records=await listProjectFonts(root),pending=[...(await pendingProjectFonts(root)),...(await pendingUserFonts(root))].filter(item=>!item.redundant),chosen=[],skipped=[];let total=0;
 for(const item of records){if(chosen.length>=16||total+item.record.bytes>16*1024*1024){skipped.push(item.record.id);continue;}chosen.push(item);total+=item.record.bytes;}
 const groups=new Map();for(const item of chosen){const group=groups.get(item.file.bundleId||null)||[];group.push(item);groups.set(item.file.bundleId||null,group);}
 const output=[];
 for(const [bundleId,group] of groups){
  signal?.throwIfAborted();const unique=[...new Set(group.map(item=>item.file.file))],verified=bundleId?await readExternalSkillFiles(library,root,bundleId,unique,signal):null;
  for(const item of group){
   const source=verified?.files.find(row=>row.path===item.file.file),stored=await storedBytes(root,item.file);
   if(bundleId)verifyFontMatch(item.file,source,stored);
   output.push({id:item.record.id,file:item.file.file,sha256:item.file.sha256,bytes:stored.length,data:stored.toString('base64')});
  }
 }
 signal?.throwIfAborted();
 const after=await listProjectFonts(root),pendingAfter=[...(await pendingProjectFonts(root)),...(await pendingUserFonts(root))].filter(item=>!item.redundant),heads=rows=>JSON.stringify(rows.map(item=>item.record));
 if(heads(after)!==heads(records)||JSON.stringify(pendingAfter)!==JSON.stringify(pending))throw new SafetyError('读取期间项目字体登记已改变，请重新加载',409);
 return {items:output,skipped,pending,note:'仅供当前项目编辑会话；字体许可及其他环境的显示需分别确认。'};
}
