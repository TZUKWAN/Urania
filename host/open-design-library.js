/** Pinned OpenDesign source data. This module never executes upstream code. */
import {readFileSync,statSync,lstatSync} from 'node:fs';
import {readFile,lstat,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {SafetyError} from './safety.js';

const DEFAULT_ROOT=fileURLToPath(new URL('../resources/open-design/',import.meta.url));
const MAX_FILE=16*1024*1024,MAX_INDEX=8*1024*1024;
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
const gitHash=bytes=>hash('sha1',Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]));
const safePath=value=>typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!value.includes('\\')&&!value.split('/').some(p=>!p||p==='.'||p==='..')&&!/[\u0000-\u001f]/.test(value);
const textFile=path=>/\.(md|txt|json|jsonc|css|html?|svg|xml|ya?ml|[cm]?js|tsx?|jsx|py|toml|ini|sh|ps1|lock|csv|tsv|scss|less|rs|sql|vue|svelte)$/i.test(path)||/(^|\/)(LICENSE[^/]*|NOTICE[^/]*|COPYING[^/]*|OFL[^/]*|Dockerfile|Makefile)$/i.test(path);
export function verifyOpenDesignBlob(bytes,file){if(!Buffer.isBuffer(bytes)||bytes.length!==file?.bytes||gitHash(bytes)!==file.gitSha1)throw new SafetyError('OpenDesign 源文件校验失败，未使用或执行该内容',503);return bytes;}
export function parseOpenDesignIndex(bytes,lockBytes){
 try{
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_INDEX||!Buffer.isBuffer(lockBytes)||lockBytes.length>8192)throw new Error('资源索引或锁超过预算');const lock=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(lockBytes));
  if(lock.schema!==undefined&&lock.schema!==1||lock.file!=='library-index.json'||lock.repository!=='nexu-io/open-design'||!/^[a-f0-9]{40}$/.test(lock.revision)||!/^[a-f0-9]{64}$/.test(lock.sha256||'')||hash('sha256',bytes)!==lock.sha256)throw new Error('资源索引来源或摘要无效');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(value.repository!==lock.repository||value.revision!==lock.revision||value.treeTruncated!==false||!Array.isArray(value.packages)||value.packages.length>2000)throw new Error('资源索引结构不完整');
  const packages=new Map();for(const pack of value.packages){if(!safePath(pack.id)||packages.has(pack.id)||!Array.isArray(pack.files)||pack.files.length>2000)throw new Error('资源包身份或文件清单无效');const files=new Map();for(const file of pack.files){if(!safePath(file.path)||files.has(file.path)||!/^[a-f0-9]{40}$/.test(file.gitSha1)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>512*1024*1024||!['100644','100755','120000'].includes(file.mode))throw new Error('资源文件身份或预算无效');files.set(file.path,file);}packages.set(pack.id,{...pack,fileMap:files});}
  return {...value,packages};
 }catch(error){if(error instanceof SafetyError)throw error;throw new SafetyError('OpenDesign 索引快照无效：'+error.message,409);}
}
function page(offset=0,limit=20,max=50,maxOffset=10000){
 if(!Number.isSafeInteger(offset)||offset<0||offset>maxOffset||!Number.isSafeInteger(limit)||limit<1||limit>max)throw new SafetyError('资源分页范围无效',422);
 return {offset,limit};
}
function joinFetch(shared,signal){
 if(signal?.aborted){
  if(!shared.waiters&&!shared.done){shared.promise.catch(()=>{});shared.controller.abort();}
  return Promise.reject(new SafetyError('资源读取已停止，未修改设计',499));
 }
 shared.waiters++;
 return new Promise((resolve,reject)=>{
  let settled=false;
  const finish=()=>{
   if(settled)return false;settled=true;signal?.removeEventListener('abort',abort);shared.waiters--;
   if(!shared.waiters&&!shared.done)shared.controller.abort();
   return true;
  };
  const abort=()=>{if(finish())reject(new SafetyError('资源读取已停止，未修改设计',499));};
  signal?.addEventListener('abort',abort,{once:true});
  shared.promise.then(value=>{if(finish())resolve(value);},error=>{if(finish())reject(error);});
  if(signal?.aborted)abort();
 });
}

export class OpenDesignLibrary {
 constructor({root=DEFAULT_ROOT}={}){this.root=root;this.inflight=new Map();}
 index(){
  if(this.loaded)return this.loaded;
  try{
   const lockPath=join(this.root,'library-index.lock.json'),path=join(this.root,'library-index.json');if(statSync(lockPath).size>8192||statSync(path).size>MAX_INDEX)throw new Error('资源索引或锁超过预算');const lockBytes=readFileSync(lockPath),bytes=readFileSync(path);
   this.loaded=parseOpenDesignIndex(bytes,lockBytes);this.loadedIndexSha256=hash('sha256',bytes);this.loadedLockSha256=hash('sha256',lockBytes);return this.loaded;
  }catch(error){throw new SafetyError('OpenDesign 资源不可用，矢量源未改动：'+error.message,503);}
 }
 summary(pack){return {id:pack.id,name:pack.name,kind:pack.kind,category:pack.category,entries:pack.entries,fileCount:pack.fileCount,bytes:pack.bytes,sameEntryContentAs:pack.sameEntryContentAs,dependencyStatus:pack.dependencyStatus,...(pack.fileMap.has('design-tokens.json')?{tokenAuthority:'design-tokens.json; descriptive examples in DESIGN.md may differ; original files are preserved'}:pack.fileMap.has('tokens.css')?{tokenAuthority:'tokens.css default :root; dark and other overrides remain in the original file'}:{}),workflowReady:false,availability:'pinned source data; scripts/services/fonts are not automatically executed or supplied'};}
 search({query='',kind,offset=0,limit=20}={}){
  page(offset,limit,30);if(typeof query!=='string'||query.length>160||kind!=null&&typeof kind!=='string')throw new SafetyError('资源搜索参数无效',422);
  const index=this.index(),term=query.toLowerCase();
  const rows=[...index.packages.values()].filter(p=>(!kind||p.kind===kind)&&(!term||[p.id,p.name,p.kind,p.category].join(' ').toLowerCase().includes(term)));
  return {repository:index.repository,revision:index.revision,scope:index.scope,total:rows.length,items:rows.slice(offset,offset+limit).map(p=>this.summary(p)),nextOffset:offset+limit<rows.length?offset+limit:null};
 }
 package(id,{offset=0,limit=40}={}){
  page(offset,limit);const index=this.index(),pack=index.packages.get(id);if(!pack)throw new SafetyError('资源包未在固定版本索引中',404);
  return {...this.summary(pack),repository:index.repository,revision:index.revision,license:index.license,licenseSource:this.source('LICENSE'),source:'https://github.com/'+index.repository+'/tree/'+index.revision+'/'+pack.id,files:pack.files.slice(offset,offset+limit).map(f=>({...f,readableText:textFile(f.path),fetchable:f.mode!=='120000'&&f.bytes<=MAX_FILE})),nextOffset:offset+limit<pack.files.length?offset+limit:null};
 }
 source(path){const index=this.index();return 'https://raw.githubusercontent.com/'+index.repository+'/'+index.revision+'/'+path.split('/').map(encodeURIComponent).join('/');}
 cachePath(file){return join(this.root,'library-cache',this.index().revision,file.gitSha1+'.blob');}
 verify(bytes,file){return verifyOpenDesignBlob(bytes,file);}
 indexSnapshot(){
  const current=this.index(),paths=['library-index.json','library-index.lock.json','LICENSE'].map(name=>join(this.root,name)),limits=[MAX_INDEX,8192,1024*1024];for(let i=0;i<paths.length;i++){const info=lstatSync(paths[i]);if(!info.isFile()||info.isSymbolicLink()||info.size<1||info.size>limits[i])throw new SafetyError('OpenDesign 快照文件类型或大小无效',409);}
  const [indexBytes,lockBytes,licenseBytes]=paths.map(path=>readFileSync(path)),parsed=parseOpenDesignIndex(indexBytes,lockBytes);if(hash('sha256',indexBytes)!==this.loadedIndexSha256||hash('sha256',lockBytes)!==this.loadedLockSha256||parsed.repository!==current.repository||parsed.revision!==current.revision)throw new SafetyError('OpenDesign 索引在保存期间改变',409);verifyOpenDesignBlob(licenseBytes,parsed.licenseFile);return {indexBytes,lockBytes,licenseBytes};
 }
 async cached(file){
  const path=this.cachePath(file);let stat;
  try{stat=await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.bytes||stat.size>MAX_FILE)throw new SafetyError('OpenDesign 缓存文件异常，未读取外部路径',503);
  return this.verify(await readFile(path),file);
 }
 async fetchFile(upstreamPath,file,signal){
  signal?.throwIfAborted();const cached=await this.cached(file);signal?.throwIfAborted();if(cached)return cached;
  const existing=this.inflight.get(file.gitSha1);
  if(existing&&!existing.controller.signal.aborted)return joinFetch(existing,signal);
  if(existing)this.inflight.delete(file.gitSha1);
  if(this.inflight.size>=4)throw new SafetyError('OpenDesign 正在读取其他资源，请稍后重试',429);
  const shared={controller:new AbortController(),waiters:0,done:false,promise:null};
  shared.promise=(async()=>{
   const controller=shared.controller,timer=setTimeout(()=>controller.abort(),20000);let temporary;
   try{
    const response=await fetch(this.source(upstreamPath),{signal:controller.signal,redirect:'error'});
    if(!response.ok||!response.body)throw new SafetyError('OpenDesign 原始资源请求失败：HTTP '+response.status,502);
    const chunks=[];let total=0;
    for await(const chunk of response.body){total+=chunk.length;if(total>MAX_FILE||total>file.bytes)throw new SafetyError('OpenDesign 文件超过已固定的大小，未采用内容',413);chunks.push(Buffer.from(chunk));}
    const bytes=this.verify(Buffer.concat(chunks),file),destination=this.cachePath(file);
    await mkdir(dirname(destination),{recursive:true});temporary=destination+'.part-'+randomUUID();
    await writeFile(temporary,bytes,{flag:'wx'});await rename(temporary,destination);temporary=null;return bytes;
   }catch(error){
    if(controller.signal.aborted)throw new SafetyError('OpenDesign 资源请求已停止或超时，未采用不完整内容',504);
    throw error;
   }finally{
    clearTimeout(timer);
    if(temporary)await unlink(temporary).catch(()=>{}); // Only this request's own unpublished temporary blob.
   }
  })().finally(()=>{shared.done=true;if(this.inflight.get(file.gitSha1)===shared)this.inflight.delete(file.gitSha1);});
  this.inflight.set(file.gitSha1,shared);return joinFetch(shared,signal);
 }
 async read({id,file,offset=0,limit=20000},signal,{sourceBytes}={}){
  page(offset,limit,40000,MAX_FILE);signal?.throwIfAborted();const index=this.index(),pack=index.packages.get(id),entry=pack?.fileMap.get(file);
  if(!entry)throw new SafetyError('该文件不在固定资源包中',404);
  if(entry.mode==='120000')throw new SafetyError('资源中的符号链接尚未接入，不跟随外部目标',422);
  if(entry.bytes>MAX_FILE)throw new SafetyError('该资源超过16MiB按需读取预算，尚未接入',413);
  const bytes=sourceBytes===undefined?await this.fetchFile(id+'/'+file,entry,signal):this.verify(sourceBytes,entry);signal?.throwIfAborted();
  const result={id,file,repository:index.repository,revision:index.revision,source:this.source(id+'/'+file),bytes:bytes.length,gitSha1:entry.gitSha1,sha256:hash('sha256',bytes),verified:true,executed:false,workflowReady:false,licenseSource:this.source('LICENSE')};
  if(!textFile(file))return {...result,binary:true,note:'Actual verified binary cached; this does not place it in a design or provide its downstream dependency.'};
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('此文件不是有效 UTF-8 文本，未伪造解码内容',422);}
  const catalogueEntryOnly=file==='SKILL.md'&&/This catalogue entry advertises the skill/.test(text),upstream=text.match(/^\s*upstream:\s*["']?(https:\/\/[^\s"']+)/m)?.[1];
  return {...result,binary:false,content:text.slice(offset,offset+limit),totalCharacters:text.length,offset,nextOffset:offset+limit<text.length?offset+limit:null,catalogueEntryOnly,...(catalogueEntryOnly?{requiredExternalBundle:upstream||'See the original entry; its external upstream bundle is not provided'}:{}),note:/\.(py|sh|ps1|[cm]?js|tsx?|rs)$/i.test(file)?'Source code for review only; no execution or dependencies have been provided.':undefined};
 }
 async license(){
  const index=this.index(),file=index.licenseFile,bytes=this.verify(await readFile(join(this.root,'LICENSE')),file);
  return {repository:index.repository,revision:index.revision,source:this.source('LICENSE'),content:bytes.toString('utf8'),sha256:hash('sha256',bytes),executed:false};
 }
}
