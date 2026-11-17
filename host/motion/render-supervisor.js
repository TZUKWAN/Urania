/** One owned render at a time. Release only after process close, verification and cleanup. */
import {spawn,execFile} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import os from 'node:os';
import {checkMotionRuntime,resolveMotionPaths,motionWorkerEnvironment} from './runtime-env.js';
import {verifyArtifact} from './artifact-verifier.js';
export {verifyArtifact} from './artifact-verifier.js';
const activeJobs=new Map(),finishedJobs=new Map(),FINISHED_LIMIT=10;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export const getActiveRenderCount=()=>activeJobs.size;
export const resolveFfmpegDir=()=>path.dirname(resolveMotionPaths({components:['ffmpeg']}).ffmpegPath);
export const getRenderStatus=jobId=>activeJobs.get(jobId)||finishedJobs.get(jobId)||null;
function terminateTree(record){
 if(!record.process.pid||record.closed)return Promise.resolve();
 if(process.platform==='win32')return new Promise(resolve=>{
  const tool=path.join(process.env.SYSTEMROOT||'C:/Windows','System32/taskkill.exe');
  execFile(tool,['/pid',String(record.process.pid),'/T','/F'],{windowsHide:true,timeout:15000,maxBuffer:64*1024},(error)=>{if(error&&!record.closed)record.terminationError=error.message;resolve();});
 });
 try{process.kill(-record.process.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')record.terminationError=error.message;}
 return Promise.resolve();
}
async function cleanup(record){
 const parent=record.tempParent,relative=path.relative(parent,record.tempDir);
 if(relative!=='urania-motion-'+record.jobId||fs.existsSync(record.tempDir)&&fs.lstatSync(record.tempDir).isSymbolicLink())throw new Error('临时目录身份不一致，拒绝清理');
 let last;for(let n=0;n<6;n++){try{await fs.promises.rm(record.tempDir,{recursive:true,force:true});return;}catch(error){last=error;await sleep(100*(n+1));}}throw last;
}
async function finish(record,status){
 record.status='cleaning';
 try{await cleanup(record);}catch(error){record.cleanupError=error.message;status='failed';record.error='任务进程已退出，但临时资源清理失败：'+error.message;}
 record.status=status;record.finished=true;record.finishedAt=Date.now();activeJobs.delete(record.jobId);
 finishedJobs.set(record.jobId,{...record,process:undefined,timeout:undefined,killTimer:undefined,termination:undefined});
 while(finishedJobs.size>FINISHED_LIMIT)finishedJobs.delete(finishedJobs.keys().next().value);
}
export function startRender(workerEntry,projectDir,outputPath,opts={}){
 if(activeJobs.size)throw Object.assign(new Error('同一实例同时只允许一个渲染任务；请等待上一任务退出和清理'),{code:'E_CONCURRENT',status:409});
 if(!fs.existsSync(workerEntry))throw Object.assign(new Error('渲染 worker 入口不存在: '+workerEntry),{code:'E_WORKER_MISSING',status:500});
 const runtime=opts.verify?checkMotionRuntime():{paths:resolveMotionPaths({components:['node']})};
 // Windows CreateProcess still rejects a long working directory even when
 // fs can read it. Deep workspace/revision paths must never become child cwd
 // or Chromium profile paths (confirmed ENOENT with an existing 390-char cwd).
 const jobId=crypto.randomUUID(),tempParent=fs.realpathSync(os.tmpdir()),tempDir=path.join(tempParent,'urania-motion-'+jobId);fs.mkdirSync(tempDir,{recursive:false});
 // All writes stay private until this particular output is validated. A failed
 // or cancelled re-render can never truncate an earlier successful artifact.
 const pendingOutput=path.join(tempDir,'pending.mp4'),logPath=path.join(tempDir,'render.log');
 const requestFile=path.join(tempDir,'request.json'),stdoutFile=path.join(tempDir,'stdout.jsonl'),stderrFile=path.join(tempDir,'stderr.log');
 fs.writeFileSync(requestFile,JSON.stringify({command:'render',projectDir,outputPath:pendingOutput,cancelFile:path.join(tempDir,'cancel'),fps:opts.fps||{num:30,den:1},quality:opts.quality||'draft',width:opts.width||1280,height:opts.height||720,entryFile:opts.entryFile||'index.html'}));
 // File handles avoid Node/Windows anonymous-pipe ENOTCONN observed inside
 // the actual DSH host. Each job owns its bounded request and JSONL logs.
 const outFd=fs.openSync(stdoutFile,'wx'),errFd=fs.openSync(stderrFile,'wx');let child;
 try{child=spawn(runtime.paths.nodePath,[workerEntry,requestFile],{cwd:tempDir,env:motionWorkerEnvironment(runtime.paths),stdio:['ignore',outFd,errFd],windowsHide:true,shell:false,detached:process.platform!=='win32'});}finally{fs.closeSync(outFd);fs.closeSync(errFd);}
 const record={jobId,process:child,tempDir,tempParent,logPath,pendingOutput,startedAt:Date.now(),status:'running',progress:0,outputPath,logTail:'',closed:false};activeJobs.set(jobId,record);
 let logBytes=0,stdout='';
 const append=chunk=>{const text=String(chunk);record.logTail=(record.logTail+text).slice(-8000);if(logBytes<1024*1024)try{const limited=Buffer.from(text).subarray(0,1024*1024-logBytes);fs.appendFileSync(logPath,limited);logBytes+=limited.length;}catch{}};
 const offsets=new Map();
 const consume=()=>{for(const [file,isStdout]of [[stdoutFile,true],[stderrFile,false]]){
  let fd;try{const size=fs.statSync(file).size,offset=offsets.get(file)||0;if(size>2*1024*1024){record.workerError='worker 日志超过预算';cancelRender(jobId,'log-budget');continue;}if(size<=offset)continue;
   fd=fs.openSync(file,'r');const data=Buffer.alloc(size-offset);fs.readSync(fd,data,0,data.length,offset);offsets.set(file,size);const text=data.toString('utf8');append(text);
   if(isStdout){stdout+=text;if(stdout.length>128*1024){record.workerError='worker 协议行超过预算';cancelRender(jobId,'protocol');stdout='';continue;}let index;while((index=stdout.indexOf('\n'))>=0){const line=stdout.slice(0,index).trim();stdout=stdout.slice(index+1);try{const msg=JSON.parse(line);if(msg.type==='progress'&&Number.isFinite(msg.frame)&&Number.isFinite(msg.totalFrames)&&msg.totalFrames>0)record.progress=Math.max(0,Math.min(100,Math.round(100*msg.frame/msg.totalFrames)));else if(msg.type==='error')record.workerError=String(msg.message).slice(0,4000);}catch{}}}
  }catch(error){record.logReadError=error.message;}finally{if(fd!==undefined)fs.closeSync(fd);}
 }};
 const reader=setInterval(consume,150);child.on('error',error=>{record.workerError='worker 启动失败: '+error.message;});
 record.timeout=setTimeout(()=>cancelRender(jobId,'timeout'),opts.timeoutMs||20*60*1000);
 child.once('close',async(code,signal)=>{
  clearInterval(reader);consume();record.closed=true;record.closedAt=Date.now();record.exitCode=code;record.signal=signal;clearTimeout(record.timeout);clearTimeout(record.killTimer);
  if(record.termination)await record.termination;
  let status=record.cancelReason?'cancelled':code===0?'completed':'failed';
  if(status==='cancelled')record.error='已取消 ('+record.cancelReason+')';
  if(status==='failed')record.error=record.workerError||record.logTail.match(/Error:[^\n]*/)?.[0]||'worker 退出码 '+code;
  if(status==='completed'){
   record.status='verifying';
   try{
    if(!fs.existsSync(pendingOutput))throw new Error('worker 报告完成但产物不存在');
    if(opts.verify){record.verifyAbort=new AbortController();record.receipt=await verifyArtifact(runtime.paths.ffprobePath,pendingOutput,opts.verify.durationFrames,opts.verify.width,opts.verify.height,opts.verify.fps,{signal:record.verifyAbort.signal});}
    if(record.cancelReason){status='cancelled';record.error='已取消 ('+record.cancelReason+')';}
    else {
     const staged=path.join(path.dirname(outputPath),'.video-'+jobId+'.pending');
     try{await fs.promises.copyFile(pendingOutput,staged,fs.constants.COPYFILE_EXCL);if(record.cancelReason){status='cancelled';record.error='已取消 ('+record.cancelReason+')';}else {fs.renameSync(staged,outputPath);record.published=true;}}
     finally{if(fs.existsSync(staged))fs.unlinkSync(staged);}
    }
   }catch(error){status=record.cancelReason?'cancelled':'failed';record.error=record.cancelReason?'已取消 ('+record.cancelReason+')':'产物验证或保存失败: '+error.message;}
  }
  await finish(record,status);
 });
 return {jobId,record,child};
}
export function cancelRender(jobId,reason='user-cancel'){
 const record=activeJobs.get(jobId);if(!record||record.published)return false;if(record.cancelReason)return true;
 record.cancelReason=reason;record.status='cancelling';record.verifyAbort?.abort(new Error('校验已取消'));
 if(record.closed)return true; // asynchronous verification still holds the slot
 try{fs.writeFileSync(path.join(record.tempDir,'cancel'),'cancel',{flag:'wx'});}catch{}
 // Give the real worker time to close its dedicated browser via CDP. The
 // fallback affects only this owned child tree, and never releases early.
 record.killTimer=setTimeout(()=>{record.termination=terminateTree(record);},2500);
 return true;
}

