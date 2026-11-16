import {spawn} from 'node:child_process';
import {createReadStream,readFileSync,existsSync,mkdirSync,writeFileSync,unlinkSync,lstatSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SafetyError,workspacePath,assertSafeJson} from './safety.js';
import {OpenDesignLibrary} from './open-design-library.js';
import {projectFontSnapshot} from './project-fonts.js';
const PACKAGE=dirname(dirname(fileURLToPath(import.meta.url)));
const LOCK=JSON.parse(readFileSync(join(PACKAGE,'runtime-lock.json'),'utf8'));
const verified=new Map();
const fontLibrary=new OpenDesignLibrary();
const fontFlights=new Map();
function joinFontSnapshot(shared,signal){
 if(signal?.aborted){if(!shared.waiters&&!shared.done){shared.promise.catch(()=>{});shared.controller.abort();}return Promise.reject(new SafetyError('项目字体读取已停止',499));}
 shared.waiters++;
 return new Promise((resolve,reject)=>{
  let settled=false;const finish=()=>{if(settled)return false;settled=true;signal?.removeEventListener('abort',abort);shared.waiters--;if(!shared.waiters&&!shared.done)shared.controller.abort();return true;};
  const abort=()=>{if(finish())reject(new SafetyError('项目字体读取已停止',499));};
  signal?.addEventListener('abort',abort,{once:true});shared.promise.then(value=>{if(finish())resolve(value);},error=>{if(finish())reject(error);});if(signal?.aborted)abort();
 });
}
/** Read committed, verified fonts for one project; concurrent readers share an immutable-by-convention result. */
export function nativeProjectFonts(root,signal){
 if(signal?.aborted)return Promise.reject(new SafetyError('项目字体读取已停止',499));
 const key=resolve(root).toLowerCase(),existing=fontFlights.get(key);
 if(existing&&!existing.controller.signal.aborted)return joinFontSnapshot(existing,signal);
 if(existing)fontFlights.delete(key);if(fontFlights.size>=4)return Promise.reject(new SafetyError('项目字体读取正在排队，请稍后重试',429));
 const shared={controller:new AbortController(),waiters:0,done:false,promise:null};let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;shared.controller.abort();},30000);
 shared.promise=(async()=>{
  try{
   const snapshot=await projectFontSnapshot(fontLibrary,root,shared.controller.signal);
   if(snapshot.skipped.length||snapshot.pending.length)throw new SafetyError('项目字体存在未发布记录或超过预算，未启动本机操作',409);
   const identity=snapshot.items.map(item=>[item.id,item.sha256,item.bytes]).sort((a,b)=>a[0].localeCompare(b[0]));
   return {...snapshot,fingerprint:createHash('sha256').update(JSON.stringify(identity)).digest('hex')};
  }catch(error){if(timedOut)throw new SafetyError('项目字体读取超时，未启动本机操作',504);throw error;}
  finally{clearTimeout(timer);}
 })().finally(()=>{shared.done=true;if(fontFlights.get(key)===shared)fontFlights.delete(key);});
 fontFlights.set(key,shared);return joinFontSnapshot(shared,signal);
}
async function executable(engine) {
  const entry=engine==='runner'?LOCK.runner:LOCK.engines[engine];if(!entry)throw new SafetyError('未知专业引擎: '+engine);
  const file=resolve(PACKAGE,entry.executable);
  if(!file.startsWith(PACKAGE+'\\')&&!file.startsWith(PACKAGE+'/'))throw new SafetyError('运行时路径越界');
  if(!existsSync(file))throw new SafetyError('专业引擎尚未安装: '+engine,503);
  if(!verified.has(file))verified.set(file,new Promise((yes,no)=>{
    const hash=createHash('sha256'),input=createReadStream(file);
    input.on('data',chunk=>hash.update(chunk));input.on('error',no);
    input.on('end',()=>hash.digest('hex')===entry.sha256?yes(file):no(new SafetyError('专业引擎完整性校验失败',503)));
  }));
  return verified.get(file);
}

export class NativeSession {
  constructor(engine,root,{timeoutMs=30000}={}) {
    this.engine=engine;this.root=resolve(root);this.timeoutMs=timeoutMs;this.pending=new Map();this.sequence=0;this.buffer=Buffer.alloc(0);this.closed=false;
    this.fontAbort=new AbortController();this.fontFiles=[];this.projectFontCount=0;
    this.directory=workspacePath(root,join('design','.designcraft','native',engine,randomUUID()));mkdirSync(this.directory,{recursive:true});
  }
  async start(providedFonts) {
    if(process.platform!=='win32')throw new SafetyError('当前捆绑的专业引擎仅支持 Windows',503);
    const [file,runner]=await Promise.all([executable(this.engine),executable('runner')]);
    const fonts=providedFonts||await nativeProjectFonts(this.root,this.fontAbort.signal);this.fontAbort.signal.throwIfAborted();
    if(!Array.isArray(fonts.items)||!/^[a-f0-9]{64}$/.test(fonts.fingerprint||''))throw new SafetyError('项目字体快照无效',409);
    if(this.closed)throw new SafetyError('本机会话已停止，未加载字体',499);
    const fontDirectory=workspacePath(this.root,join(this.directory,'config','local','Microsoft','Windows','Fonts'));
    if(fonts.items.length)mkdirSync(fontDirectory,{recursive:true});
    const seen=new Set();
    for(const item of fonts.items){
      if(seen.has(item.sha256))continue;
      if(typeof item.data!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256||'')||!Number.isSafeInteger(item.bytes)||item.bytes<4||item.bytes>4*1024*1024||!/\.(?:ttf|otf)$/i.test(item.file||''))throw new SafetyError('项目字体快照无效',409);
      const bytes=Buffer.from(item.data,'base64');if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new SafetyError('项目字体快照内容不一致',409);
      const target=workspacePath(this.root,join(fontDirectory,item.sha256+item.file.slice(item.file.lastIndexOf('.')).toLowerCase()));
      writeFileSync(target,bytes,{flag:'wx'});this.fontFiles.push({path:target,sha256:item.sha256,bytes:bytes.length});seen.add(item.sha256);
    }
    this.projectFontCount=seen.size;this.projectFontFingerprint=fonts.fingerprint;
    const args=['mcp',...(this.engine==='vectorcraft'?['--headless']:[]),'--automation-read-root',this.root,'--automation-write-root',this.directory];
    const env={...process.env,APPDATA:join(this.directory,'config','roaming'),LOCALAPPDATA:join(this.directory,'config','local')};
    for(const key of ['PHOTOCRAFT_CONTROL_PORT','PHOTOCRAFT_CONTROL_TOKEN','PHOTOCRAFT_CONTROL_TOKEN_FILE','VECTORCRAFT_CONTROL_PORT','DECKCRAFT_CONTROL_PORT'])delete env[key];
    this.child=spawn(runner,['--memory-mb',String(LOCK.runner.memoryMiB),'--',file,...args],{cwd:this.root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
    this.stopped=new Promise(resolveStopped=>this.child.once('close',resolveStopped));
    this.child.stdout.on('data',chunk=>this.receive(chunk));
    this.child.stdout.on('error',error=>this.fail(error));
    this.child.stdin.on('error',error=>this.fail(error));
    this.child.stderr.on('error',error=>this.fail(error));
    this.child.stderr.on('data',chunk=>{const value=chunk.toString();this.stderr=(this.stderr||'').slice(-2000)+value.slice(-2000);const match=value.match(/\[designcraft-runtime\] pid=(\d+)/);if(match)this.nativePid=Number(match[1]);});
    this.child.on('error',error=>this.fail(error));
    this.child.once('close',()=>this.fail(new SafetyError('专业引擎已停止（可能达到资源预算），作品尚未提交的结果不会自动覆盖；请检查后重试',503)));
    const init=await this.rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'DesignCraft',version:'1.2.0'}});
    this.identity=init.serverInfo;
    this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
    const tools=await this.rpc('tools/list',{});this.tools=tools.tools||[];
    return this;
  }
  receive(chunk) {
    try {
      this.buffer=Buffer.concat([this.buffer,chunk]);
      if(this.buffer.length>16*1024*1024)throw new SafetyError('专业引擎响应超过16MB预算',413);
      let newline;
      while((newline=this.buffer.indexOf(10))>=0) {
        const line=this.buffer.subarray(0,newline);this.buffer=this.buffer.subarray(newline+1);if(!line.length)continue;
        const response=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));
        if(response.id===undefined)continue;
        const request=this.pending.get(response.id);
        if(!request)throw new SafetyError('专业引擎响应ID不匹配，已停止会话',502);
        clearTimeout(request.timer);this.pending.delete(response.id);
        if(response.error)request.reject(new SafetyError(response.error.message||'专业引擎调用失败',422));else request.resolve(response.result);
      }
    }catch(error){this.fail(error);}
  }
  rpc(method,params) {
    if(this.closed||!this.child)return Promise.reject(new SafetyError('专业引擎会话不可用',503));
    assertSafeJson(params);
    const id=++this.sequence,line=JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n';
    if(Buffer.byteLength(line)>12*1024*1024)return Promise.reject(new SafetyError('专业引擎请求过大，请使用项目文件',413));
    return new Promise((resolvePromise,reject)=>{
      const timer=setTimeout(()=>this.fail(new SafetyError('专业引擎操作超时，结果未确认；源文件未被插件覆盖。',504)),this.timeoutMs);
      this.pending.set(id,{resolve:resolvePromise,reject,timer});
      try{this.child.stdin.write(line,error=>{if(error)this.fail(error);});}catch(error){this.fail(error);}
    });
  }
  async call(name,args={}) {
    if(!this.tools?.some(tool=>tool.name===name))throw new SafetyError('专业引擎不提供该工具: '+name,422);
    const fontSensitive=['doc_save','doc_export','save_file','save_presentation','export'].includes(name);
    if(fontSensitive)await this.assertProjectFonts();
    const result=await this.rpc('tools/call',{name,arguments:args});
    if(fontSensitive)await this.assertProjectFonts();
    if(result?.isError)throw new SafetyError((result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n')||'专业引擎操作失败',422);
    const text=(result.content||[]).find(x=>x.type==='text')?.text;
    let data=result.structuredContent;
    if(data===undefined&&text){try{data=JSON.parse(text);}catch{data=text;}}
    const mutating=['command_run','run_command','command_batch','batch','doc_save','doc_export','save_file','save_presentation','export'].includes(name);
    if(mutating){
      const unfinished=value=>value&&typeof value==='object'&&(value.ok===false||value.pending===true||value.cancelled===true||['pending','running','cancelled','failed','error'].includes(value.status));
      const nested=[...(Array.isArray(data?.results)?data.results:[]),...(Array.isArray(data?.steps)?data.steps:[]),...(['batch','command_batch'].includes(name)&&Array.isArray(data)?data:[])];
      if(unfinished(data)||typeof data==='string'&&/^(pending|cancelled)$/i.test(data)||nested.some(unfinished))throw new SafetyError('原生操作尚未确认完成：'+JSON.stringify(data).slice(0,1000),422);
    }
    return {data,content:result.content||[]};
  }
  async assertProjectFonts(){
    const current=await nativeProjectFonts(this.root,this.fontAbort.signal);
    if(current.fingerprint!==this.projectFontFingerprint)throw new SafetyError('本机操作期间项目字体已改变，未提交不一致结果',409);
  }
  fail(error) {
    if(this.closed)return;this.closed=true;
    this.fontAbort.abort();
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(error);}this.pending.clear();
    try{this.child?.kill();}catch{}
  }
  close() {
    this.fail(new SafetyError('专业编辑会话已关闭',499));
    return (this.stopped||Promise.resolve()).finally(()=>{
      for(const file of this.fontFiles){try{const info=lstatSync(file.path);if(info.isFile()&&!info.isSymbolicLink()&&info.size===file.bytes&&createHash('sha256').update(readFileSync(file.path)).digest('hex')===file.sha256)unlinkSync(file.path);}catch{/* Preserve any file whose identity cannot be confirmed. */}}
      this.fontFiles=[];
    });
  }
}

let nativeActive=0;const nativeWaiting=[];const NATIVE_LIMIT=2;
function nativeSlot(signal,onQueue){
 if(signal?.aborted)return Promise.reject(new SafetyError('原生操作已取消',499));
 const release=()=>{let done=false;return()=>{if(done)return;done=true;nativeActive--;while(nativeActive<NATIVE_LIMIT&&nativeWaiting.length){const item=nativeWaiting.shift();item.cleanup();nativeActive++;item.resolve(release());}};};
 if(nativeActive<NATIVE_LIMIT&&!nativeWaiting.length){nativeActive++;return Promise.resolve(release());}
 if(nativeWaiting.length>=32)return Promise.reject(new SafetyError('原生会话队列已满',429));onQueue?.();
 return new Promise((resolve,reject)=>{const item={resolve,cleanup:null},remove=error=>{const at=nativeWaiting.indexOf(item);if(at>=0)nativeWaiting.splice(at,1);item.cleanup();reject(error);},abort=()=>remove(new SafetyError('原生排队操作已取消',499)),timer=setTimeout(()=>remove(new SafetyError('等待原生会话超过60秒',504)),60000);item.cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};signal?.addEventListener('abort',abort,{once:true});nativeWaiting.push(item);});
}
export const nativeSessionPoolStatus=()=>({active:nativeActive,queued:nativeWaiting.length,limit:NATIVE_LIMIT});
export async function openNativeSession(engine,root,options={}){
 const release=await nativeSlot(options.signal,options.onQueue);let session;
 try{
  if(options.signal?.aborted)throw new SafetyError('原生操作已取消',499);session=new NativeSession(engine,root,options);const originalClose=session.close.bind(session),abort=()=>session.close(),timer=setTimeout(()=>{session.fail(new SafetyError('原生会话超过60秒预算',504));session.close();},60000);
  session.close=async()=>{try{return await originalClose();}finally{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);release();}};options.signal?.addEventListener('abort',abort,{once:true});options.onAcquire?.();const started=await session.start(options.projectFonts);session.stopped.then(()=>session.close());return started;
 }catch(error){if(session)await session.close();else release();throw error;}
}
export const nativeRunnerExecutable=()=>executable('runner');
export function nativeRuntimeCatalog() {return Object.entries(LOCK.engines).map(([id,entry])=>({id,version:entry.version,installed:existsSync(resolve(PACKAGE,entry.executable)),source:entry.source}));}
