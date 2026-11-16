/** Persist and inspect external skill source as bounded, inert project data. */
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {readFile,readdir,mkdir,stat,lstat} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {saveAsset,readAsset} from './docstore.js';
import {atomicCreate} from './persistence.js';
import {readZip} from './zip.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';
import {githubPointer,validateGithubResolution,verifyGithubTree,verifyGitCommitTree,selectGithubSkillFiles,discoverGithubSkills,readGithubSkillCandidate,inspectGithubSkill,fetchGithubBlob,fetchGithubLfs,recognizedLicense,gitBlob,parseLfsPointer,sha256} from './external-github-source.js';
import {loadSavedOpenDesignPackage} from './open-design-package.js';
import {canvasDesignSeed} from './external-skill-seed.js';
import {safeRef} from './external-git-tree.js';

const MAX_ARCHIVE=64*1024*1024,MAX_TREE=8*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const idFor=(odId,repository,revision,subdir)=>'externalbundle-'+hash(Buffer.from(JSON.stringify([odId,repository.toLowerCase(),revision,subdir])));
const ID=/^externalbundle-[a-f0-9]{64}$/;
const pathFor=(root,id)=>{if(!ID.test(id||''))throw new SafetyError('外部资源包身份无效',422);return workspacePath(root,join('design','.designcraft','v2','resource-imports',id+'.json'));};

async function workerCall(script,workerData,signal,label){
 signal?.throwIfAborted();let worker,timer,abort;
 try{
  worker=new Worker(new URL(script,import.meta.url),{workerData,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}});
  return await new Promise((resolve,reject)=>{
   let settled=false;const done=(fn,value)=>{if(settled)return;settled=true;fn(value);};
   abort=()=>done(reject,new SafetyError('外部资源'+label+'已停止，已保存内容保留',499));
   signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>done(reject,new SafetyError('外部资源'+label+'超时，已保存内容保留',504)),45000);
   worker.once('message',result=>result?.ok?done(resolve,result):done(reject,new SafetyError(result?.error||'外部资源'+label+'失败',result?.status||500)));
   worker.once('error',error=>done(reject,new SafetyError('外部资源'+label+'线程失败：'+String(error.message||error),503)));
   worker.once('exit',()=>done(reject,new SafetyError('外部资源'+label+'线程未返回结果',503)));
   if(signal?.aborted)abort();
  });
 }finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);if(worker)await worker.terminate().catch(()=>{});}
}
const verifyOffThread=(library,archive,receipt,stub,{file,files,signal}={})=>workerCall('./external-skill-verify-worker.js',{archive,receipt,stub,file,files,libraryRoot:library.root},signal,'核对');
async function buildOffThread(files,metadata,signal){
 const result=await workerCall('./external-skill-build-worker.js',{files:files.map(({row,bytes})=>({path:row.path,bytes})),metadata},signal,'打包');
 return Buffer.from(result.archive);
}

async function odStub(library,root,odId,receiptId,signal){
 const index=library.index(),pack=index.packages.get(odId),entry=pack?.fileMap.get('SKILL.md');
 if(!pack||pack.kind!=='skill'||!entry||entry.mode==='120000'||entry.bytes>1024*1024)throw new SafetyError('OpenDesign 目录项不可读取',422);
 if(receiptId){
  const expected='resource-'+hash(Buffer.from(JSON.stringify([index.revision,odId,'SKILL.md',entry.gitSha1])));
  if(receiptId!==expected)throw new SafetyError('外部资源目录项回执不一致',409);
  const path=workspacePath(root,join('design','.designcraft','v2','resource-imports',receiptId+'.json'),{mustExist:true});
  if((await stat(path)).size>16384)throw new SafetyError('目录项来源记录超过预算',413);
  const receipt=JSON.parse(await readFile(path,'utf8'));assertSafeJson(receipt);
  if(receipt.id!==receiptId||receipt.kind!=='resource'||receipt.repository!==index.repository||receipt.revision!==index.revision||receipt.packageId!==odId||receipt.file!=='SKILL.md'||receipt.gitSha1!==entry.gitSha1||typeof receipt.assetName!=='string'||!/^[a-f0-9]{64}$/.test(receipt.sha256||''))throw new SafetyError('目录项来源记录无效',409);
  const bytes=readAsset(root,receipt.assetName);if(!bytes||sha256(bytes)!==receipt.sha256)throw new SafetyError('目录项原件缺失或改变',409);
  return library.verify(bytes,entry);
 }
 const saved=await loadSavedOpenDesignPackage(library,root,odId);signal?.throwIfAborted();
 return saved?library.verify(saved.files.get('SKILL.md'),entry):library.fetchFile(odId+'/SKILL.md',entry,signal);
}

/** Validate the archive and its source tree before showing or exporting it. */
export function verifyExternalSkillBundle(library,archive,receipt,stubBytes){
 assertSafeJson(receipt);
 if(!receipt||receipt.schema!==1||receipt.kind!=='external-bundle'||!ID.test(receipt.id||'')||typeof receipt.odId!=='string'||typeof receipt.repository!=='string'||!/^[a-f0-9]{40}$/.test(receipt.revision||'')||!/^[a-f0-9]{40}$/.test(receipt.treeSha||'')||typeof receipt.subdir!=='string'||!/^resource-[a-f0-9]{64}$/.test(receipt.odReceiptId||'')||!/^[a-f0-9]{64}$/.test(receipt.sha256||'')||typeof receipt.assetName!=='string'||!/^ext-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.zip$/.test(receipt.assetName)||!Buffer.isBuffer(archive)||archive.length!==receipt.bytes||archive.length>MAX_ARCHIVE||sha256(archive)!==receipt.sha256||receipt.id!==idFor(receipt.odId,receipt.repository,receipt.revision,receipt.subdir))throw new SafetyError('外部资源包回执或摘要无效',409);
 const index=library.index(),entry=index.packages.get(receipt.odId)?.fileMap.get('SKILL.md');
 if(!entry)throw new SafetyError('固定 OpenDesign 目录项不存在',409);
 if(receipt.odReceiptId!=='resource-'+hash(Buffer.from(JSON.stringify([index.revision,receipt.odId,'SKILL.md',entry.gitSha1]))))throw new SafetyError('外部资源目录项身份不一致',409);
 library.verify(stubBytes,entry);
 let stub;try{stub=new TextDecoder('utf-8',{fatal:true}).decode(stubBytes);}catch{throw new SafetyError('目录项编码无效',409);}
 const pointer=githubPointer(stub);
 if((pointer.owner+'/'+pointer.repo).toLowerCase()!==receipt.repository.toLowerCase()||pointer.subdir!==null&&pointer.subdir!==receipt.subdir)throw new SafetyError('外部资源包与目录项指向不一致',409);
 validateGithubResolution(receipt.sourceResolution,receipt.repository,receipt.resolvedRepository||receipt.repository);
 let rows;try{rows=readZip(archive,{maxEntries:518,maxEntryBytes:16*1024*1024,maxTotalBytes:56*1024*1024,maxSelectedBytes:16*1024*1024});}catch{throw new SafetyError('外部资源包结构损坏或超过预算',409);}
 const entries=new Map(rows.map(row=>[row.name,row.data])),raw=entries.get('_designcraft/source.json');if(!raw||raw.length>MAX_TREE)throw new SafetyError('外部资源包缺少来源清单',409);
 let meta;try{meta=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{throw new SafetyError('外部来源清单无效',409);}
 if(!meta||meta.schema!==1||meta.odId!==receipt.odId||meta.odReceiptId!==receipt.odReceiptId||meta.repository!==receipt.repository||meta.revision!==receipt.revision||meta.treeSha!==receipt.treeSha||meta.subdir!==receipt.subdir||meta.license!==receipt.license||!['github-https-response','git-object'].includes(meta.commitTreeEvidence)||!safeRef(meta.ref)||pointer.ref!==null&&pointer.ref!==meta.ref||!Array.isArray(meta.files)||!Array.isArray(meta.tree))throw new SafetyError('外部来源清单与回执不一致',409);
 if(meta.resolvedRepository!==receipt.resolvedRepository||JSON.stringify(meta.sourceResolution)!==JSON.stringify(receipt.sourceResolution))throw new SafetyError('外部来源仓库跳转记录不一致',409);
 if(meta.commitTreeEvidence==='git-object'){
  if(meta.treeSizes!=='selected-only')throw new SafetyError('离线文件树的大小范围无效',409);
  verifyGitCommitTree(meta.revision,meta.treeSha,meta.commitObjectBase64);
 }else if(meta.treeSizes!==undefined||meta.commitObjectBase64!==undefined)throw new SafetyError('在线文件树的来源声明无效',409);
 if(meta.sourceSelection!==undefined&&!['catalogue-declared','automatic-directory','explicit-directory'].includes(meta.sourceSelection)||receipt.selection!==undefined&&receipt.selection!==meta.sourceSelection)throw new SafetyError('外部技能目录选择记录无效',409);
 const tree=verifyGithubTree(meta.treeSha,meta.tree,{allowUnknownSizes:meta.commitTreeEvidence==='git-object'}),selection=selectGithubSkillFiles(tree,pointer,receipt.odId,{subdir:receipt.subdir});
 if(meta.sourceSelection==='catalogue-declared'&&pointer.subdir===null||pointer.subdir!==null&&meta.sourceSelection!==undefined&&meta.sourceSelection!=='catalogue-declared')throw new SafetyError('外部技能选择方式与目录项不一致',409);
 if(meta.sourceSelection==='automatic-directory'&&selectGithubSkillFiles(tree,pointer,receipt.odId).subdir!==receipt.subdir)throw new SafetyError('自动选择的技能目录不一致',409);
 if(selection.subdir!==receipt.subdir||selection.files.length!==meta.files.length||entries.size!==meta.files.length+1)throw new SafetyError('外部资源包与固定文件树不一致',409);
 const byPath=new Map();
 for(const row of meta.files){
  if(!row||typeof row.path!=='string'||byPath.has(row.path)||!/^files\//.test(row.archivePath||'')||row.archivePath!=='files/'+row.path||!/^[a-f0-9]{64}$/.test(row.sha256||''))throw new SafetyError('外部资源文件清单无效',409);
  byPath.set(row.path,row);
 }
 for(const source of selection.files){
  const row=byPath.get(source.path),bytes=row&&entries.get(row.archivePath);
  if(!row||!bytes||row.gitSha1!==source.sha||row.bytes!==source.size||row.mode!==source.mode||bytes.length!==source.size||gitBlob(bytes)!==source.sha||sha256(bytes)!==row.sha256)throw new SafetyError('外部资源文件与 Git 对象不一致',409);
  const pointer=parseLfsPointer(bytes);
  if(pointer?(!row.lfs||Object.keys(row.lfs).sort().join(',')!=='oid,size'||row.lfs.oid!==pointer.oid||row.lfs.size!==pointer.size):row.lfs!==undefined)throw new SafetyError('外部原包的 LFS 指针声明不一致',409);
 }
 const license=byPath.get(meta.licensePath),licenseBytes=license&&entries.get(license.archivePath);
 if(!selection.licenseCandidates.some(row=>row.path===meta.licensePath)||!licenseBytes||recognizedLicense(licenseBytes)!==receipt.license)throw new SafetyError('外部资源许可与原文件不一致',409);
 return {fileCount:selection.files.length,license:receipt.license,metadata:meta,entries};
}

export async function discoverExternalSkills(library,root,odId,signal,{revision,offset=0,limit=50}={}){
 const stub=await odStub(library,root,odId,undefined,signal),seed=canvasDesignSeed(odId,revision);
 if(seed){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new SafetyError('外部技能目录分页无效',422);
  const checked=await verifyOffThread(library,seed.archive,seed.receipt,stub,{signal}),meta=checked.metadata,path=meta.subdir+'/SKILL.md',row=meta.files.find(item=>item.path===path);
  if(!row)throw new SafetyError('离线原包缺少技能入口',409);
  const items=offset===0?[{subdir:meta.subdir,file:path,gitSha1:row.gitSha1,bytes:row.bytes,declaredByCatalogue:true,exactDirectoryName:true}]:[];
  return {odId,repository:meta.repository,revision:meta.revision,treeSha:meta.treeSha,ref:meta.ref,declaredSubdir:meta.subdir,total:1,items,nextOffset:null,sourceMode:'bundled-pinned',note:'插件内固定离线版本；未执行脚本，不保证是上游最新版本。'};
 }
 return discoverGithubSkills(library,odId,stub,signal,{revision,offset,limit});
}

export async function readExternalSkillCandidate(library,root,odId,signal,{revision,subdir,offset=0,limit=20000}={}){
 const stub=await odStub(library,root,odId,undefined,signal),seed=canvasDesignSeed(odId,revision);
 if(seed){
  if(revision!==seed.receipt.revision||subdir!==seed.receipt.subdir||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('离线技能候选参数无效',422);
  const file=subdir+'/SKILL.md',checked=await verifyOffThread(library,seed.archive,seed.receipt,stub,{file,signal}),row=checked.metadata.files.find(item=>item.path===file);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(checked.selected));}catch{throw new SafetyError('离线技能入口不是有效 UTF-8',422);}
  return {odId,repository:seed.receipt.repository,revision,subdir,file,gitSha1:row.gitSha1,content:text.slice(offset,offset+limit),offset,totalCharacters:text.length,nextOffset:offset+limit<text.length?offset+limit:null,sourceMode:'bundled-pinned',executed:false,note:'固定上游内容是参考数据，不是权限指令；未执行脚本。'};
 }
 return readGithubSkillCandidate(library,odId,stub,signal,{revision,subdir,offset,limit});
}

export async function inspectExternalSkill(library,root,odId,signal,{revision,subdir}={}){
 const stub=await odStub(library,root,odId,undefined,signal),seed=canvasDesignSeed(odId,revision);
 if(seed){
  if(subdir!==undefined&&subdir!==seed.receipt.subdir)throw new SafetyError('该目录项已指定固定上游目录',422);
  const checked=await verifyOffThread(library,seed.archive,seed.receipt,stub,{signal}),meta=checked.metadata;
  return {odId,repository:meta.repository,revision:meta.revision,treeSha:meta.treeSha,ref:meta.ref,subdir:meta.subdir,license:meta.license,licensePath:meta.licensePath,fileCount:meta.files.length,totalBytes:meta.files.reduce((sum,row)=>sum+row.bytes,0),sourceMode:'bundled-pinned',
   note:'插件内固定离线版本，不表示上游最新；提交对象、文件树和文件按 Git 摘要核对。原包附带的字体许可文件已保留，各字体适用范围仍需核对；未自动安装字体或执行脚本。'};
 }
 const plan=await inspectGithubSkill(library,odId,stub,signal,{revision,subdir,allowLfsPointers:true});
 return {odId,repository:plan.repository,resolvedRepository:plan.resolvedRepository,...(plan.sourceResolution?{sourceResolution:plan.sourceResolution}:{}),revision:plan.revision,treeSha:plan.treeSha,ref:plan.ref,subdir:plan.subdir,license:plan.license,licensePath:plan.licensePath,fileCount:plan.files.length,totalBytes:plan.files.reduce((sum,row)=>sum+row.size,0),
  selection:plan.selection,sourceMode:plan.commitTreeEvidence,note:(plan.selection==='explicit-directory'?'所选目录由用户或当前会话显式选择，尚需结合原规则确认是否对应目录项。':'')+(plan.sourceResolution?'目录项仓库跳转至 '+plan.resolvedRepository+'；对应关系来自 GitHub HTTPS 响应，无法离线独立证明。':'')+'识别结果仅针对所列许可文件，不证明它覆盖全部文件；'+(plan.commitTreeEvidence==='git-object'?'提交和文件树按 Git 对象摘要核对。':'提交与文件树的对应关系来自 GitHub HTTPS 响应，文件和树对象按 Git 摘要核对。')+'检查阶段未必读取全部文件，LFS 大文件须单独获取；脚本不自动执行，外部服务及文件级许可需另行确认。'+(plan.cleanupWarning||'')};
}

async function persistExternalBundle(library,root,stub,identity,archive,signal,assertCurrent,sourceMode){
 if(archive.length>MAX_ARCHIVE)throw new SafetyError('外部资源包超过预算',413);
 if(identity.odReceiptId!==stub.receipt.id)throw new SafetyError('外部原包与目录项来源不一致',409);
 signal?.throwIfAborted();assertCurrent?.();
 const asset=saveAsset(root,'ext-'+identity.id.slice('externalbundle-'.length,'externalbundle-'.length+24)+'.zip',archive);
 const receipt={schema:1,kind:'external-bundle',id:identity.id,odId:identity.odId,odReceiptId:stub.receipt.id,repository:identity.repository,...(identity.sourceResolution?{resolvedRepository:identity.resolvedRepository,sourceResolution:identity.sourceResolution}:{}),revision:identity.revision,treeSha:identity.treeSha,subdir:identity.subdir,license:identity.license,...(identity.selection?{selection:identity.selection}:{}),assetName:asset.name,bytes:archive.length,sha256:sha256(archive)};
 let checked;
 try{
  checked=await verifyOffThread(library,archive,receipt,stub.bytes,{signal});
  const directory=workspacePath(root,join('design','.designcraft','v2','resource-imports'));await mkdir(directory,{recursive:true});
  assertCurrent?.();
  const path=pathFor(root,identity.id),body=encode(receipt);
  if(!atomicCreate(path,body)){const previous=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(previous)!==JSON.stringify(receipt))throw new SafetyError('已有外部资源回执不同，未覆盖',409);}
 }catch(error){error.retained={bundle:receipt,asset:{name:asset.name,path:asset.path,bytes:asset.size},materialized:true,provenanceRecorded:false};throw error;}
 const warning=sourceMode==='bundled-pinned'?'已保存插件内固定版本，不表示上游最新；原包附带的字体许可已保留，各字体适用范围仍需核对；未自动安装字体或执行脚本。':'已保存固定版本原文件与识别到的许可文件，该许可未必覆盖所有内容；'+(sourceMode==='git-object'?'提交、文件树及文件按 Git 对象摘要核对。':'提交与文件树的对应关系来自 GitHub HTTPS。')+'未自动执行脚本，其他文件级许可和外部服务仍需核对。';
 const lfsPointerCount=checked.metadata.files.filter(row=>row.lfs).length;
 return {bundle:receipt,asset:{name:asset.name,path:asset.path,bytes:asset.size},fileCount:checked.metadata.files.length,lfsPointerCount,materialized:true,sourceMode,...(signal?.aborted?{completedAfterCancel:true}:{}),warning:warning+(receipt.sourceResolution?' 声明仓库跳转至 '+receipt.resolvedRepository+'，跳转关系来自 GitHub HTTPS 响应，无法离线独立证明。':'')+(lfsPointerCount?' 含 '+lfsPointerCount+' 个 LFS 指针，其实际大文件尚未包含在原包中。':'')};
}

export async function saveExternalSkill(library,root,odId,expectedRevision,materialize,signal,assertCurrent,{subdir}={}){
 if(expectedRevision&&!/^[a-f0-9]{40}$/.test(expectedRevision))throw new SafetyError('外部资源提交身份无效',422);
 if(expectedRevision){
  const matches=(await listExternalSkills(root)).filter(row=>!row.error&&row.odId===odId&&row.revision===expectedRevision&&(subdir===undefined||row.subdir===subdir));
  if(matches.length>1)throw new SafetyError('相同外部版本存在多个来源回执，请先核对',409);
  if(matches.length){const prior=await readExternalSkill(library,root,matches[0].id,{limit:1,signal});signal?.throwIfAborted();assertCurrent?.();return {bundle:prior.bundle,fileCount:prior.total,lfsPointerCount:prior.lfsPointerCount,materialized:true,alreadySaved:true,warning:'已核对项目中保存的原包；识别到的许可文件不保证覆盖所有内容，脚本未自动执行，外部服务和文件级许可仍需确认。'+(prior.lfsPointerCount?' 原包含 '+prior.lfsPointerCount+' 个 LFS 指针，实际文件须单独获取。':'')};}
 }
 assertCurrent?.();const stub=await materialize(library,root,odId,'SKILL.md',signal);signal?.throwIfAborted();
 const seed=canvasDesignSeed(odId,expectedRevision);
 if(seed){
  if(subdir!==undefined&&subdir!==seed.receipt.subdir)throw new SafetyError('该目录项已指定固定上游目录',422);
  const existing=(await listExternalSkills(root)).find(row=>!row.error&&row.id===seed.receipt.id);
  if(existing){const prior=await readExternalSkill(library,root,existing.id,{limit:1,signal});signal?.throwIfAborted();assertCurrent?.();return {bundle:prior.bundle,fileCount:prior.total,lfsPointerCount:prior.lfsPointerCount,materialized:true,alreadySaved:true,warning:'已核对项目中保存的原包；原包中的字体及文件各自许可仍需保留，未自动执行脚本。'+(prior.lfsPointerCount?' 原包含 '+prior.lfsPointerCount+' 个 LFS 指针，实际文件须单独获取。':'')};}
  return persistExternalBundle(library,root,stub,seed.receipt,seed.archive,signal,assertCurrent,'bundled-pinned');
 }
 const plan=await inspectGithubSkill(library,odId,stub.bytes,signal,{revision:expectedRevision||undefined,subdir,allowLfsPointers:true});
 if(expectedRevision&&expectedRevision!==plan.revision)throw new SafetyError('外部仓库版本已改变，请重新查看后获取',409);
 const id=idFor(odId,plan.repository,plan.revision,plan.subdir),files=[];
 const existing=(await listExternalSkills(root)).find(row=>!row.error&&row.id===id);
 if(existing){const prior=await readExternalSkill(library,root,id,{limit:1,signal});signal?.throwIfAborted();assertCurrent?.();return {bundle:prior.bundle,fileCount:prior.total,lfsPointerCount:prior.lfsPointerCount,materialized:true,alreadySaved:true,warning:'已核对项目中保存的原包；识别到的许可文件不保证覆盖所有内容，脚本未自动执行，外部服务和文件级许可仍需确认。'+(prior.lfsPointerCount?' 原包含 '+prior.lfsPointerCount+' 个 LFS 指针，实际文件须单独获取。':'')};}
 for(let start=0;start<plan.files.length;start+=4){
  signal?.throwIfAborted();const batch=await Promise.all(plan.files.slice(start,start+4).map(async row=>({row,bytes:row.path===plan.licensePath?plan.licenseBytes:await fetchGithubBlob(plan,row,signal,{allowLfs:true})})));files.push(...batch);
 }
 signal?.throwIfAborted();
 const metadata={schema:1,odId,odReceiptId:stub.receipt.id,repository:plan.repository,...(plan.sourceResolution?{resolvedRepository:plan.resolvedRepository,sourceResolution:plan.sourceResolution}:{}),revision:plan.revision,treeSha:plan.treeSha,ref:plan.ref,subdir:plan.subdir,license:plan.license,licensePath:plan.licensePath,
  commitTreeEvidence:plan.commitTreeEvidence,...(plan.commitTreeEvidence==='git-object'?{commitObjectBase64:plan.commitObjectBase64,treeSizes:'selected-only'}:{}),sourceSelection:plan.selection,tree:plan.tree,files:files.map(({row,bytes})=>({path:row.path,archivePath:'files/'+row.path,mode:row.mode,gitSha1:row.sha,bytes:row.size,sha256:sha256(bytes),...(parseLfsPointer(bytes)?{lfs:parseLfsPointer(bytes)}:{})}))};
 const metadataBytes=encode(metadata);if(metadataBytes.length>MAX_TREE)throw new SafetyError('外部资源来源清单超过预算',413);
 const archive=await buildOffThread(files,metadataBytes,signal);
 const identity={id,odId,odReceiptId:stub.receipt.id,repository:plan.repository,...(plan.sourceResolution?{resolvedRepository:plan.resolvedRepository,sourceResolution:plan.sourceResolution}:{}),revision:plan.revision,treeSha:plan.treeSha,subdir:plan.subdir,license:plan.license,selection:plan.selection};
 return persistExternalBundle(library,root,stub,identity,archive,signal,assertCurrent,plan.commitTreeEvidence);
}

export async function listExternalSkills(root){
 const dir=workspacePath(root,join('design','.designcraft','v2','resource-imports'));let items;
 try{items=await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const names=items.filter(item=>item.isFile()&&/^externalbundle-[a-f0-9]{64}\.json$/.test(item.name));if(names.length>1000)throw new SafetyError('外部资源记录超过预算',413);
 const out=[];for(const item of names){
  try{const path=workspacePath(root,join(dir,item.name),{mustExist:true});if((await stat(path)).size>16384)throw new Error('记录过大');const value=JSON.parse(await readFile(path,'utf8'));assertSafeJson(value);if(value.id+'.json'!==item.name||value.kind!=='external-bundle'||typeof value.odId!=='string'||typeof value.repository!=='string'||value.repository.length>201||!/^[a-f0-9]{40}$/.test(value.revision||''))throw new Error('身份不一致');out.push({...value,verification:'not_checked'});}
  catch(error){out.push({id:item.name.slice(0,-5),error:String(error.message||error)});}
 }
 return out;
}

async function loadExternalSkill(library,root,id,{file,files,signal}={}){
 const path=pathFor(root,id);let info;try{info=await stat(path);}catch(error){if(error.code==='ENOENT')throw new SafetyError('外部资源包不存在',404);throw error;}
 if(info.size>16384)throw new SafetyError('外部资源回执超过预算',413);
 const receipt=JSON.parse(await readFile(path,'utf8'));if(receipt.id!==id)throw new SafetyError('外部资源回执身份不一致',409);
 const stub=await odStub(library,root,receipt.odId,receipt.odReceiptId),archive=readAsset(root,receipt.assetName);if(!archive)throw new SafetyError('外部资源原包缺失',404);
 const verified=await verifyOffThread(library,archive,receipt,stub,{file,files,signal});return {receipt,verified};
}

/** Read the bounded verified manifest of one saved bundle without fetching remote files. */
export async function readExternalSkillManifest(library,root,id,signal){const {receipt,verified}=await loadExternalSkill(library,root,id,{signal});if(!Array.isArray(verified.metadata.files)||verified.metadata.files.length>10000)throw new SafetyError('外部原包文件清单超过预算',413);return {bundle:receipt,items:verified.metadata.files};}

/** Read selected original bytes after verifying one saved bundle and its fixed OD stub. */
export async function readExternalSkillFiles(library,root,id,files,signal){
 if(!Array.isArray(files)||!files.length||files.length>16||files.some(file=>typeof file!=='string')||new Set(files).size!==files.length)throw new SafetyError('外部文件列表无效或超过预算',422);
 const {receipt,verified}=await loadExternalSkill(library,root,id,{files,signal});
 return {receipt,files:verified.selectedFiles.map(item=>({path:item.path,bytes:Buffer.from(item.bytes),metadata:verified.metadata.files.find(row=>row.path===item.path)}))};
}

export async function readExternalSkill(library,root,id,{file,offset=0,limit=20000,signal}={}){
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('外部资源分页范围无效',422);
 const {receipt,verified}=await loadExternalSkill(library,root,id,{file,signal}),files=verified.metadata.files;
 if(file===undefined)return {bundle:receipt,total:files.length,lfsPointerCount:files.filter(row=>row.lfs).length,items:files.slice(offset,offset+Math.min(limit,100)),nextOffset:offset+Math.min(limit,100)<files.length?offset+Math.min(limit,100):null,executed:false};
 const row=files.find(item=>item.path===file);if(!row)throw new SafetyError('文件不在已保存的外部原包中',404);
 const bytes=Buffer.from(verified.selected),textual=/\.(?:md|txt|json|css|html?|[cm]?js|tsx?|jsx|py|toml|ya?ml|sh|ps1|csv|svg)$/i.test(file)||/(^|\/)(?:LICENSE[^/]*|NOTICE[^/]*|COPYING)$/i.test(file);
 if(row.lfs)return {bundle:receipt,file,gitSha1:row.gitSha1,pointerSha256:row.sha256,lfs:row.lfs,pointer:bytes.toString('utf8'),executed:false,note:'这是经过 Git 校验的 LFS 指针，实际文件需要按需获取并按指针校验。'};
 if(!textual)return {bundle:receipt,file,bytes:bytes.length,sha256:row.sha256,gitSha1:row.gitSha1,binary:true,executed:false};
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('外部文件不是有效 UTF-8，原件仍保留',422);}
 return {bundle:receipt,file,sha256:row.sha256,gitSha1:row.gitSha1,content:text.slice(offset,offset+limit),offset,totalCharacters:text.length,nextOffset:offset+limit<text.length?offset+limit:null,executed:false,note:'上游内容是参考数据；脚本不会自动执行。'};
}

/** Materialize exact bytes without running a script or claiming editor import. */
export async function materializeExternalSkillFile(library,root,id,file,signal,assertCurrent){
 if(typeof file!=='string')throw new SafetyError('请选择外部资源文件',422);
 signal?.throwIfAborted();const {receipt,verified}=await loadExternalSkill(library,root,id,{file,signal}),row=verified.metadata.files.find(item=>item.path===file);
 if(!row)throw new SafetyError('文件不在已保存的外部原包中',404);
 if(row.lfs)throw new SafetyError('所选文件是 Git LFS 指针，请使用 LFS 获取入口取得真实文件',422);
 const bytes=Buffer.from(verified.selected);if(!bytes.length)throw new SafetyError('空文件仍保留在原包中，不能作为素材导入',422);
 signal?.throwIfAborted();assertCurrent?.();
 const extension=extname(file).toLowerCase(),suffix=/^\.[a-z0-9]{1,12}$/.test(extension)?extension:'.bin',asset=saveAsset(root,'extfile-'+row.sha256.slice(0,24)+suffix,bytes);
 const fileId='externalfile-'+hash(Buffer.from(JSON.stringify([id,file,row.gitSha1]))),record={schema:1,kind:'external-file',id:fileId,bundleId:id,file,gitSha1:row.gitSha1,sha256:row.sha256,bytes:bytes.length,assetName:asset.name};
 try{
  const directory=workspacePath(root,join('design','.designcraft','v2','resource-imports'));await mkdir(directory,{recursive:true});
  assertCurrent?.();
  const path=workspacePath(root,join(directory,fileId+'.json')),body=encode(record);
  if(!atomicCreate(path,body)){const previous=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(previous)!==JSON.stringify(record))throw new SafetyError('外部文件来源回执冲突，原件未覆盖',409);}
 }catch(error){error.retained={file:record,asset:{name:asset.name,path:asset.path,bytes:asset.size},materialized:true,provenanceRecorded:false};throw error;}
 return {file:record,asset:{name:asset.name,path:asset.path,bytes:asset.size},bundle:receipt,materialized:true,...(signal?.aborted?{completedAfterCancel:true}:{}),note:'文件按原字节保存；未运行脚本，未自动导入专业编辑器。单独分享此文件时请同时保留适用的原包许可和署名；单文件本身不自动附带许可。'};
}

/** LFS receipt refers to the Git pointer blob and the separate actual content hash. */
export function validateExternalLfsFile(record,row){
 assertSafeJson(record);
 const extension=typeof record?.file==='string'?extname(record.file).toLowerCase():'',suffix=/^\.[a-z0-9]{1,12}$/.test(extension)?extension:'.bin';
 if(!record||record.schema!==1||record.kind!=='external-lfs-file'||!/^externallfs-[a-f0-9]{64}$/.test(record.id||'')||!ID.test(record.bundleId||'')||typeof record.file!=='string'||record.file.length>1000||!/^[a-f0-9]{40}$/.test(record.gitSha1||'')||!/^[a-f0-9]{64}$/.test(record.sha256||'')||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>16*1024*1024||typeof record.assetName!=='string'||!/^extlfs-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.[a-z0-9]{1,12}$/.test(record.assetName)||!record.assetName.startsWith('extlfs-'+record.sha256.slice(0,24))||!record.assetName.endsWith(suffix)||record.id!=='externallfs-'+hash(Buffer.from(JSON.stringify([record.bundleId,record.file,record.gitSha1,record.sha256]))))throw new SafetyError('LFS 文件来源回执无效',409);
 if(row&&(!row.lfs||row.path!==record.file||row.gitSha1!==record.gitSha1||row.lfs.oid!==record.sha256||row.lfs.size!==record.bytes))throw new SafetyError('LFS 文件与原包指针不一致',409);
 return true;
}

/** Resolve a saved Git pointer at its exact commit, never execute the result. */
export async function materializeExternalLfsFile(library,root,id,file,signal,assertCurrent){
 if(typeof file!=='string')throw new SafetyError('请选择外部 LFS 文件',422);
 signal?.throwIfAborted();const {receipt,verified}=await loadExternalSkill(library,root,id,{file,signal}),row=verified.metadata.files.find(item=>item.path===file);
 if(!row?.lfs)throw new SafetyError('所选文件不是已保存原包中的 LFS 指针',422);
 const pointer=parseLfsPointer(Buffer.from(verified.selected));if(!pointer||pointer.oid!==row.lfs.oid||pointer.size!==row.lfs.size)throw new SafetyError('LFS 指针与来源不一致',409);
 if(pointer.size<1||pointer.size>16*1024*1024)throw new SafetyError('LFS 文件为空或超过 16 MiB 预算',413);
 const fileId='externallfs-'+hash(Buffer.from(JSON.stringify([id,file,row.gitSha1,pointer.oid]))),directory=workspacePath(root,join('design','.designcraft','v2','resource-imports')),path=workspacePath(root,join(directory,fileId+'.json'));
 let info;try{info=await stat(path);}catch(error){if(error.code!=='ENOENT')throw error;}
 if(info){
  if(!info.isFile()||info.size>16384)throw new SafetyError('已保存的 LFS 来源记录无效',409);
  const previous=JSON.parse(await readFile(path,'utf8'));validateExternalLfsFile(previous,row);if(previous.id!==fileId||previous.bundleId!==id)throw new SafetyError('已保存的 LFS 文件来源身份不一致',409);
  const bytes=readAsset(root,previous.assetName);if(!bytes||bytes.length!==pointer.size||sha256(bytes)!==pointer.oid)throw new SafetyError('已保存的 LFS 文件缺失或发生变化',409);
  signal?.throwIfAborted();assertCurrent?.();return {file:previous,asset:{name:previous.assetName,path:'design/assets/'+previous.assetName,bytes:bytes.length},bundle:receipt,materialized:true,alreadySaved:true,note:'已核对本地实际文件与原包 LFS 指针；未运行外部脚本。'};
 }
 const bytes=await fetchGithubLfs(receipt.resolvedRepository||receipt.repository,receipt.revision,file,pointer,signal);signal?.throwIfAborted();assertCurrent?.();
 const extension=extname(file).toLowerCase(),suffix=/^\.[a-z0-9]{1,12}$/.test(extension)?extension:'.bin',asset=saveAsset(root,'extlfs-'+pointer.oid.slice(0,24)+suffix,bytes);
 const record={schema:1,kind:'external-lfs-file',id:fileId,bundleId:id,file,gitSha1:row.gitSha1,sha256:pointer.oid,bytes:bytes.length,assetName:asset.name};validateExternalLfsFile(record,row);
 try{
  await mkdir(directory,{recursive:true});assertCurrent?.();
  if(!atomicCreate(path,encode(record))){const previous=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(previous)!==JSON.stringify(record))throw new SafetyError('LFS 文件来源回执冲突，原件未覆盖',409);}
 }catch(error){error.retained={file:record,asset:{name:asset.name,path:asset.path,bytes:asset.size},materialized:true,provenanceRecorded:false};throw error;}
 return {file:record,asset:{name:asset.name,path:asset.path,bytes:asset.size},bundle:receipt,materialized:true,...(signal?.aborted?{completedAfterCancel:true}:{}),note:'实际文件已按原始 LFS 指针的 SHA-256 和大小核对并保存；未运行脚本。分享时请保留适用许可与署名。'};
}

/** Read an already materialized file and verify its saved bundle without network access. */
export async function readMaterializedExternalFile(library,root,id,signal){
 const lfs=/^externallfs-[a-f0-9]{64}$/.test(id||''),plain=/^externalfile-[a-f0-9]{64}$/.test(id||'');if(!lfs&&!plain)throw new SafetyError('外部文件来源身份无效',422);const path=workspacePath(root,join('design','.designcraft','v2','resource-imports',id+'.json'),{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('外部文件来源记录无效',409);let record;try{record=JSON.parse(await readFile(path,'utf8'));assertSafeJson(record);}catch{throw new SafetyError('外部文件来源记录损坏',409);}const allowed=['schema','kind','id','bundleId','file','gitSha1','sha256','bytes','assetName'];if(!record||Object.keys(record).some(key=>!allowed.includes(key))||record.id!==id||record.schema!==1||!ID.test(record.bundleId||'')||typeof record.file!=='string'||record.file.length>1000||!/^[a-f0-9]{40}$/.test(record.gitSha1||'')||!/^[a-f0-9]{64}$/.test(record.sha256||'')||!Number.isSafeInteger(record.bytes)||record.bytes<1||record.bytes>16*1024*1024||typeof record.assetName!=='string')throw new SafetyError('外部文件来源记录无效',409);
 const extension=extname(record.file).toLowerCase(),suffix=/^\.[a-z0-9]{1,12}$/.test(extension)?extension:'.bin',prefix=lfs?'extlfs-':'extfile-';if(!new RegExp('^'+prefix+'[a-f0-9]{24}(?:-[a-f0-9]{24})?\\.[a-z0-9]{1,12}$').test(record.assetName)||!record.assetName.startsWith(prefix+record.sha256.slice(0,24))||!record.assetName.endsWith(suffix))throw new SafetyError('外部文件素材身份无效',409);
 if(lfs){validateExternalLfsFile(record);}else if(record.kind!=='external-file'||record.id!=='externalfile-'+hash(Buffer.from(JSON.stringify([record.bundleId,record.file,record.gitSha1]))))throw new SafetyError('外部文件身份不一致',409);
 const bytes=readAsset(root,record.assetName);if(!bytes||bytes.length!==record.bytes||sha256(bytes)!==record.sha256||plain&&gitBlob(bytes)!==record.gitSha1)throw new SafetyError('外部文件原件缺失或发生改变',409);signal?.throwIfAborted();const verified=await readExternalSkillFiles(library,root,record.bundleId,[record.file],signal),entry=verified.files[0];if(!entry||!entry.metadata||entry.path!==record.file)throw new SafetyError('外部原包中缺少文件或来源信息',409);
 if(lfs)validateExternalLfsFile(record,entry.metadata);else if(entry.metadata.lfs||entry.metadata.gitSha1!==record.gitSha1||entry.metadata.sha256!==record.sha256||!entry.bytes.equals(bytes))throw new SafetyError('外部文件与已保存原包不一致',409);signal?.throwIfAborted();return {file:record,bytes,bundle:verified.receipt,asset:{name:record.assetName,path:'design/assets/'+record.assetName,size:record.bytes}};
}

/** An explicit font request may fetch its LFS content; registration checks it separately. */
export async function materializeExternalFontFile(library,root,id,file,signal,assertCurrent){
 if(typeof file!=='string'||!/\.(?:ttf|otf)$/i.test(file))throw new SafetyError('请选择原包中的 TTF 或 OTF 字体',422);
 const selected=await readExternalSkill(library,root,id,{file,signal});
 if(selected.lfs&&selected.lfs.size>4*1024*1024)throw new SafetyError('项目字体超过 4 MiB 预算',413);
 return selected.lfs?materializeExternalLfsFile(library,root,id,file,signal,assertCurrent):materializeExternalSkillFile(library,root,id,file,signal,assertCurrent);
}
