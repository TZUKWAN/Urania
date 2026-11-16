/** Bounded, read-only Git source inspection for a verified OD GitHub pointer. */
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {mkdtemp,mkdir,readdir,lstat,realpath,rm} from 'node:fs/promises';
import {join,resolve,dirname,basename,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {SafetyError} from './safety.js';

const ROOT=fileURLToPath(new URL('../runtimes/',import.meta.url));
const LOCK_SHA='71fe9fa170ed092c5cf6baef9e50cf2d3cead06c3f7971c946d1cb3fb81731d6';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const OID=/^[a-f0-9]{40}$/;
const safeRef=value=>typeof value==='string'&&value.length>0&&value.length<=120&&/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)&&!value.includes('..')&&!value.includes('//')&&!value.endsWith('/')&&!value.endsWith('.')&&!value.split('/').some(part=>!part||part.startsWith('.')||part.endsWith('.lock'));

function runner(){
 const raw=readFileSync(join(ROOT,'git-source-runner.lock.json'));
 if(raw.length>8192||sha(raw)!==LOCK_SHA)throw new SafetyError('Git 来源启动器锁定信息无效',503);
 const lock=JSON.parse(raw.toString('utf8'));
 if(lock.schema!==1||lock.file!=='git-source-runner.exe'||lock.processLimit!==8||lock.memoryMiB!==384||!/^[a-f0-9]{64}$/.test(lock.sha256||''))throw new SafetyError('Git 来源启动器配置无效',503);
 const path=join(ROOT,lock.file),info=statSync(path);if(!info.isFile()||info.size>4*1024*1024||sha(readFileSync(path))!==lock.sha256)throw new SafetyError('Git 来源启动器完整性失败',503);return path;
}
function trustedGit(){
 if(process.platform!=='win32')throw new SafetyError('此来源回退仅支持 Windows',503);
 for(const parent of [process.env.ProgramW6432,process.env.ProgramFiles]){
  if(!parent)continue;
  try{
   const base=realpathSync(join(parent,'Git')),path=realpathSync(join(base,'mingw64','bin','git.exe')),rel=relative(base,path);
   if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel)||!statSync(path).isFile())continue;
   return path;
  }catch{/* Try the other trusted install root. */}
 }
 throw new SafetyError('未找到受信任安装位置的 Git，不能使用来源回退',503);
}
function environment(){
 const env={...process.env};for(const key of Object.keys(env))if(/^GIT_/i.test(key)||/^SSH_ASKPASS$/i.test(key))delete env[key];
 Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_LAZY_FETCH:'1',GIT_LFS_SKIP_SMUDGE:'1',GCM_INTERACTIVE:'never'});
 return env;
}
async function directoryBytes(base){
 const queue=[base];let total=0,seen=0;
 while(queue.length){
  const path=queue.pop();let rows;try{rows=await readdir(path,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
  for(const row of rows){
   if(++seen>4000)throw new SafetyError('Git 来源临时目录文件数超过预算',413);
   const file=join(path,row.name);if(row.isSymbolicLink())throw new SafetyError('Git 来源临时目录出现符号链接',409);
   if(row.isDirectory())queue.push(file);else if(row.isFile()){try{total+=(await lstat(file)).size;}catch(error){if(error.code!=='ENOENT')throw error;}if(total>96*1024*1024)throw new SafetyError('Git 来源临时目录超过 96 MiB',413);}
   else throw new SafetyError('Git 来源临时目录包含异常对象',409);
  }
 }
 return total;
}
async function run(runnerPath,git,args,{cwd,signal,timeout=30000,maxOutput=8*1024*1024,watchDir}={}){
 signal?.throwIfAborted();const child=spawn(runnerPath,['--memory-mb','384','--',git,...args],{cwd,env:environment(),windowsHide:true,stdio:['pipe','pipe','pipe']});
 let output=[],length=0,errorText='',problem=null,checking=false,monitorWork=Promise.resolve();
 const fail=error=>{if(!problem)problem=error;try{child.kill();}catch{}};
 const abort=()=>fail(new SafetyError('Git 来源读取已停止',499));signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(()=>fail(new SafetyError('Git 来源读取超时',504)),timeout);
 const monitor=watchDir?setInterval(()=>{if(checking)return;checking=true;monitorWork=directoryBytes(watchDir).catch(fail).finally(()=>{checking=false;});},250):null;
 child.stdout.on('data',chunk=>{length+=chunk.length;if(length>maxOutput)fail(new SafetyError('Git 来源响应超过预算',413));else output.push(Buffer.from(chunk));});
 child.stderr.on('data',chunk=>{errorText=(errorText+chunk.toString('utf8')).slice(-12000);});
 child.stdout.on('error',fail);child.stderr.on('error',fail);child.stdin.on('error',error=>{if(error.code!=='EPIPE')fail(error);});child.stdin.end();
 try{
  const code=await new Promise((resolvePromise,reject)=>{child.once('error',reject);child.once('close',resolvePromise);});
  if(monitor)clearInterval(monitor);await monitorWork;
  if(problem)throw problem;if(code!==0)throw new SafetyError('Git 来源读取失败（退出码 '+String(code)+'）',502);
  if(/filtering not recognized|filter.*not supported/i.test(errorText))throw new SafetyError('上游未支持受限 Git 对象读取',422);
  if(watchDir)await directoryBytes(watchDir);return Buffer.concat(output,length);
 }finally{clearTimeout(timer);if(monitor)clearInterval(monitor);signal?.removeEventListener('abort',abort);}
}
async function cleanupOwned(path,parent){
 const actual=await realpath(path),base=await realpath(parent),rel=relative(base,actual),info=await lstat(path);
 if(info.isSymbolicLink()||!info.isDirectory()||dirname(actual).toLowerCase()!==base.toLowerCase()||rel.includes('..')||isAbsolute(rel)||!basename(actual).startsWith('designcraft-od-git-'))throw new SafetyError('Git 临时目录身份无法确认，已保留',409);
 await rm(actual,{recursive:true,force:false,maxRetries:2,retryDelay:50});
}
function parseTree(buffer){
 const decoder=new TextDecoder('utf-8',{fatal:true}),rows=[];let start=0;
 while(start<buffer.length){
  const end=buffer.indexOf(0,start);if(end<0)throw new SafetyError('Git 文件树输出不完整',502);
  const line=buffer.subarray(start,end),tab=line.indexOf(9);if(tab<0)throw new SafetyError('Git 文件树条目无效',502);
  const header=line.subarray(0,tab).toString('ascii').match(/^([0-7]{6}) (blob|tree|commit) ([a-f0-9]{40})$/);
  if(!header)throw new SafetyError('Git 文件树头部无效',502);
  let path;try{path=decoder.decode(line.subarray(tab+1));}catch{throw new SafetyError('Git 文件树路径不是有效 UTF-8',422);}
  rows.push({path,mode:header[1],type:header[2],sha:header[3],...(header[2]==='blob'?{size:null}:{})});
  if(rows.length>20000)throw new SafetyError('Git 文件树超过预算',413);start=end+1;
 }
 return rows;
}

/** Fetch commit/tree objects only. No checkout, hooks, submodules or blob execution. */
export async function resolveGitSnapshot(pointer,requestedRevision,signal){
 if(!pointer||!/^[A-Za-z0-9_.-]{1,100}$/.test(pointer.owner||'')||!/^[A-Za-z0-9_.-]{1,100}$/.test(pointer.repo||'')||pointer.owner==='.'||pointer.owner==='..'||pointer.repo==='.'||pointer.repo==='..'||requestedRevision!==undefined&&!OID.test(requestedRevision))throw new SafetyError('Git 仓库身份无效',422);
 const runnerPath=runner(),git=trustedGit(),parent=resolve(tmpdir()),dir=await mkdtemp(join(parent,'designcraft-od-git-')),bare=join(dir,'objects.git'),empty=join(dir,'empty-template');
 const url='https://github.com/'+pointer.owner+'/'+pointer.repo+'.git';let result,failure,cleanupError;
 try{
  await mkdir(empty);const flags=['-c','protocol.allow=never','-c','protocol.https.allow=always','-c','protocol.file.allow=never','-c','protocol.ext.allow=never','-c','credential.helper=','-c','core.hooksPath='+empty,'-c','fetch.recurseSubmodules=false','-c','fetch.fsckObjects=true','-c','maintenance.auto=false','-c','gc.auto=0','-c','http.followRedirects=false','-c','http.sslVerify=true'];
  let ref,advertised;
  if(pointer.ref){
   if(!safeRef(pointer.ref))throw new SafetyError('上游引用无效',422);ref=pointer.ref;
   const heads='refs/heads/'+ref,tags='refs/tags/'+ref,text=(await run(runnerPath,git,[...flags,'ls-remote',url,heads,tags,tags+'^{}'],{cwd:dir,signal,timeout:20000,maxOutput:65536,watchDir:dir})).toString('utf8');
   const rows=text.trim().split(/\r?\n/).filter(Boolean).map(line=>line.split('\t'));
   const head=rows.find(row=>row[1]===heads)?.[0],tag=rows.find(row=>row[1]===tags)?.[0],peeled=rows.find(row=>row[1]===tags+'^{}')?.[0];
   if(head&&tag)throw new SafetyError('上游分支与标签同名，不能自动选择',409);advertised=head||peeled||tag;
  }else{
   const text=(await run(runnerPath,git,[...flags,'ls-remote','--symref',url,'HEAD'],{cwd:dir,signal,timeout:20000,maxOutput:65536,watchDir:dir})).toString('utf8');
   const rows=text.trim().split(/\r?\n/),symbol=rows.find(line=>line.startsWith('ref: refs/heads/')&&line.endsWith('\tHEAD'));
   ref=symbol?.slice('ref: refs/heads/'.length,-'\tHEAD'.length);advertised=rows.map(line=>line.split('\t')).find(row=>row[1]==='HEAD'&&OID.test(row[0]||''))?.[0];
   if(!safeRef(ref))throw new SafetyError('Git 默认分支无法安全解析',422);
  }
  if(!OID.test(advertised||''))throw new SafetyError('Git 未返回明确的上游提交',502);
  const revision=requestedRevision||advertised;
  await run(runnerPath,git,[...flags,'init','--bare','--template='+empty,bare],{cwd:dir,signal,timeout:10000,maxOutput:65536,watchDir:dir});
  await run(runnerPath,git,[...flags,'-C',bare,'fetch','--depth=1','--filter=blob:none','--no-tags','--no-recurse-submodules','--no-auto-maintenance','--no-write-commit-graph',url,revision],{cwd:dir,signal,timeout:40000,maxOutput:65536,watchDir:dir});
  const commit=await run(runnerPath,git,[...flags,'-C',bare,'cat-file','commit',revision],{cwd:dir,signal,timeout:10000,maxOutput:65536,watchDir:dir});
  const first=commit.subarray(0,commit.indexOf(10)).toString('ascii'),match=/^tree ([a-f0-9]{40})$/.exec(first);if(!match)throw new SafetyError('Git 提交对象未提供文件树',502);
  const tree=await run(runnerPath,git,[...flags,'-C',bare,'ls-tree','-r','-t','-z','--full-tree',revision],{cwd:dir,signal,timeout:15000,maxOutput:8*1024*1024,watchDir:dir});
  result={repository:pointer.owner+'/'+pointer.repo,ref,revision,treeSha:match[1],commitObjectBase64:commit.toString('base64'),tree:parseTree(tree),commitTreeEvidence:'git-object',treeSizes:'selected-only'};
 }catch(error){failure=error;}
 try{await cleanupOwned(dir,parent);}catch(error){cleanupError=error;}
 if(failure){if(cleanupError)throw new SafetyError(String(failure.message||failure)+'；临时来源目录因安全检查未清理',signal?.aborted?499:failure.status||500);throw failure;}
 if(cleanupError)result.cleanupWarning='临时来源目录未能安全清理，未删除任何其他文件。';return result;
}

export {safeRef};
