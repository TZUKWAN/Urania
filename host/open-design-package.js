/** Preserve a pinned OpenDesign package as data; upstream code is never run. */
import {createHash} from 'node:crypto';
import {readFile, mkdir, lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicCreate} from './persistence.js';
import {saveAsset,readAsset} from './docstore.js';
import {createZip,readZip} from './zip.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';

const maxFiles=512, maxBytes=48*1024*1024, maxFile=16*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const packageId=(revision,id)=>'package-'+sha(Buffer.from(JSON.stringify([revision,id])));
const LICENSE_ROOT=fileURLToPath(new URL('../licenses/opendesign-styles/',import.meta.url));
const LICENSE_LOCK='0930a02f085de66bf0209b6fd1bb374611a2abcc0e3343340596d046c0b08d55';
const EXTRA_LICENSES={'design-systems/cloudflare-kumo':{file:'cloudflare-kumo-LICENSE.txt',sha256:'df3e141c129d1804bea95fe087b157b156241b3bb1a4664808630aa85f2cd8fc'},'design-systems/tom-modern':{file:'tom-modern-LICENSE.txt',sha256:'603513fe37c4744395a6d06886d5cf4b7bbe46dc12952d2c423c9c38b0b7fdd5'}};
const portable=path=>typeof path==='string'&&path.length>0&&path.length<=1000&&path.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[\\:*?"<>|\x00-\x1f]/.test(part)&&!/[. ]$/.test(part)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));

function definition(library,id){
 const index=library.index(),pack=index.packages.get(id);
 if(!pack)throw new SafetyError('资源包不在固定版本清单中',404);
 const names=new Set();let total=0;
 if(pack.files.length>maxFiles)throw new SafetyError('资源包超过 512 个文件的保存预算',413);
 for(const file of pack.files){
  const key=file.path.toLowerCase();
  if(!portable(file.path)||names.has(key)||file.mode==='120000')throw new SafetyError('资源包含不安全、重复或符号链接路径，未保存',422);
  names.add(key);
  if(file.bytes>maxFile||(total+=file.bytes)>maxBytes)throw new SafetyError('资源包超过单文件 16 MiB 或总量 48 MiB 的保存预算',413);
 }
 return {index,pack};
}

function manifest(library,index,pack,files,license){
 return {schema:1,repository:index.repository,revision:index.revision,packageId:pack.id,source:'https://github.com/'+index.repository+'/tree/'+index.revision+'/'+pack.id.split('/').map(encodeURIComponent).join('/'),
  licenseSource:library.source('LICENSE'),licenseGitSha1:index.licenseFile.gitSha1,licenseSha256:sha(license),
  files:pack.files.map((file,i)=>({path:file.path,mode:file.mode,bytes:file.bytes,gitSha1:file.gitSha1,sha256:sha(files[i])})),
  note:'Original files are retained as inert data. External dependencies, fonts and services are not automatically installed or executed.'};
}

/** Recheck the saved archive against the currently locked upstream manifest. */
export function verifyOpenDesignPackage(library,bytes,receipt){
 assertSafeJson(receipt);
 if(!receipt||receipt.schema!==1||receipt.kind!=='package'||receipt.repository!=='nexu-io/open-design'||
  receipt.id!==packageId(receipt.revision,receipt.packageId)||!/^od-pack-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.zip$/.test(receipt.assetName||'')||
  !/^[a-f0-9]{64}$/.test(receipt.sha256||'')||!Buffer.isBuffer(bytes)||receipt.bytes!==bytes.length||sha(bytes)!==receipt.sha256)throw new SafetyError('资源包回执或文件摘要无效',409);
 const {index,pack}=definition(library,receipt.packageId);
 if(index.revision!==receipt.revision)throw new SafetyError('资源包版本与固定索引不一致',409);
 let rows;try{rows=readZip(bytes,{maxEntries:maxFiles+4,maxEntryBytes:maxFile,maxTotalBytes:maxBytes+1024*1024,maxSelectedBytes:maxFile});}
 catch{throw new SafetyError('资源包结构损坏或超过预算',409);}
 const entries=new Map(rows.map(row=>[row.name,row.data]));
 const extra=Object.hasOwn(EXTRA_LICENSES,pack.id)?EXTRA_LICENSES[pack.id]:null,extraFiles=extra?[["_designcraft/upstream-licenses/source-lock.json",LICENSE_LOCK],["_designcraft/upstream-licenses/"+extra.file,extra.sha256]]:[];
 const included=extraFiles.some(([name])=>entries.has(name));
 if(included&&extraFiles.some(([name,digest])=>!entries.has(name)||sha(entries.get(name))!==digest))throw new SafetyError('资源包的上游许可文件不一致',409);
 if(entries.size!==pack.files.length+2+(included?extraFiles.length:0))throw new SafetyError('资源包文件数量与固定清单不一致',409);
 const license=entries.get('_designcraft/LICENSE-open-design'),raw=entries.get('_designcraft/provenance.json');
 if(!license||!raw)throw new SafetyError('资源包缺少上游许可或来源记录',409);
 library.verify(license,index.licenseFile);
 const files=pack.files.map(file=>{
  const content=entries.get('package/'+file.path);
  if(!content)throw new SafetyError('资源包缺少原始文件：'+file.path,409);
  return library.verify(content,file);
 });
 let actual;try{actual=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));assertSafeJson(actual);}catch{throw new SafetyError('资源包来源记录无效',409);}
 const expected=manifest(library,index,pack,files,license);
 // Early development archives used the raw repository directory URL. Accept
 // that exact older provenance as well; every file still must match its Git ID.
 if(actual?.source===library.source(pack.id))expected.source=actual.source;
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw new SafetyError('资源包来源记录与原件不一致',409);
 return {fileCount:files.length,unpackedBytes:pack.files.reduce((sum,file)=>sum+file.bytes,0),...(extra?{upstreamLicenseIncluded:included}:{}),fileContents:new Map(pack.files.map((file,i)=>[file.path,files[i]]))};
}

async function storedPackage(library,root,id){
 const {index,pack}=definition(library,id),idHash=packageId(index.revision,pack.id);
 const path=workspacePath(root,join('design','.designcraft','v2','resource-imports',idHash+'.json'));
 let info;try{info=await lstat(path);}catch(error){if(error.code==='ENOENT')return {found:false,packageId:pack.id};throw error;}
 if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('已有资源包回执异常，未覆盖',409);
 let receipt;try{receipt=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('已有资源包回执损坏，未覆盖',409);}
 const bytes=readAsset(root,receipt.assetName);
 if(!bytes)throw new SafetyError('已有资源包回执的原文件缺失，未重新导入',409);
 const checked=verifyOpenDesignPackage(library,bytes,receipt);
 if(receipt.id!==idHash||receipt.packageId!==pack.id)throw new SafetyError('已有资源包回执身份不一致',409);
 return {found:true,package:receipt,asset:{name:receipt.assetName,path:'design/assets/'+receipt.assetName,bytes:bytes.length},...checked,
  materialized:true,alreadySaved:true,warning:(checked.upstreamLicenseIncluded===false?'旧原包未携带独立上游许可；完整项目包会附带，请勿单独分发此旧包。':'')+'已保存 OpenDesign 固定提交内的文件及根许可；其他依赖许可需单独核对。若条目指向外部仓库，该外部原包不包含在内。脚本、字体和服务不会自动执行或安装。'};
}

/** Inspect a previously committed archive without downloading it again. */
export async function inspectOpenDesignPackage(library,root,id){
 const {fileContents,...result}=await storedPackage(library,root,id);return result;
}

/** Return only independently revalidated original bytes for an owned project. */
export async function loadSavedOpenDesignPackage(library,root,id){
 const saved=await storedPackage(library,root,id);
 return saved.found?{receipt:saved.package,files:saved.fileContents}:null;
}

export async function materializeOpenDesignPackage(library,root,id,signal,assertCurrent){
 signal?.throwIfAborted();assertCurrent?.();
 const {index,pack}=definition(library,id),existing=await inspectOpenDesignPackage(library,root,id);
 signal?.throwIfAborted();assertCurrent?.();if(existing.found)return existing;
 const files=[];
 // Four concurrent reads respect the library's own inflight limit.
 for(let start=0;start<pack.files.length;start+=4){
  signal?.throwIfAborted();
  files.push(...await Promise.all(pack.files.slice(start,start+4).map(file=>library.fetchFile(pack.id+'/'+file.path,file,signal))));
 }
 signal?.throwIfAborted();
 const license=library.verify(await readFile(join(library.root,'LICENSE')),index.licenseFile);
 const provenance=manifest(library,index,pack,files,license);
 const extra=Object.hasOwn(EXTRA_LICENSES,pack.id)?EXTRA_LICENSES[pack.id]:null,extraEntries=[];
 if(extra){
  for(const [name,digest] of [['source-lock.json',LICENSE_LOCK],[extra.file,extra.sha256]]){
   const bytes=await readFile(join(LICENSE_ROOT,name));if(sha(bytes)!==digest)throw new SafetyError('设计系统上游许可文件不一致，未保存资源包',503);
   extraEntries.push({name:'_designcraft/upstream-licenses/'+name,data:bytes,store:true});
  }
 }
 const archive=createZip([...pack.files.map((file,i)=>({name:'package/'+file.path,data:files[i],store:true})),
  {name:'_designcraft/LICENSE-open-design',data:license,store:true},{name:'_designcraft/provenance.json',data:json(provenance),store:true},...extraEntries]);
 signal?.throwIfAborted();assertCurrent?.();
 const idHash=packageId(index.revision,pack.id),asset=saveAsset(root,'od-pack-'+idHash.slice(8,32)+'.zip',archive);
 const receipt={schema:1,kind:'package',id:idHash,repository:index.repository,revision:index.revision,packageId:pack.id,
  assetName:asset.name,bytes:archive.length,sha256:sha(archive)};
 try{
  const directory=workspacePath(root,join('design','.designcraft','v2','resource-imports'));await mkdir(directory,{recursive:true});
  assertCurrent?.();
  const path=workspacePath(root,join(directory,idHash+'.json')),body=json(receipt);
  if(!atomicCreate(path,body)){
   const previous=JSON.parse(await readFile(path,'utf8'));
   if(JSON.stringify(previous)!==JSON.stringify(receipt))throw new SafetyError('资源包来源记录冲突，原内容未覆盖',409);
  }
 }catch(error){error.retained={package:receipt,asset:{name:asset.name,path:asset.path,bytes:asset.size},materialized:true,provenanceRecorded:false};throw error;}
 return {package:receipt,asset:{name:asset.name,path:asset.path,bytes:asset.size},fileCount:files.length,...(extra?{upstreamLicenseIncluded:true}:{}),
  unpackedBytes:pack.files.reduce((sum,file)=>sum+file.bytes,0),materialized:true,completedAfterCancel:!!signal?.aborted,
  warning:'已保存 OpenDesign 固定提交内的文件及根许可；其他依赖许可需单独核对。若条目指向外部仓库，该外部原包不包含在内。脚本、字体和服务不会自动执行或安装。'};
}
