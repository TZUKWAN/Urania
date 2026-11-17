/** Bounded asynchronous ffprobe and streaming SHA256; no whole-MP4 buffer. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {spawn} from 'node:child_process';
import {motionWorkerEnvironment} from './runtime-env.js';
export async function hashArtifact(file,{signal}={}){
 const before=await fs.promises.stat(file),hash=crypto.createHash('sha256');let bytes=0;
 if(!before.isFile())throw new Error('视频产物不是文件');
 for await(const chunk of fs.createReadStream(file,{highWaterMark:1024*1024,signal})){hash.update(chunk);bytes+=chunk.length;}
 const after=await fs.promises.stat(file);if(bytes!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ino!==before.ino)throw new Error('校验期间视频产物发生变化');
 return {sha256:hash.digest('hex'),bytes};
}
async function probe(executable,args,{timeoutMs=120000,signal}={}){
 signal?.throwIfAborted();const directory=await fs.promises.mkdtemp(path.join(os.tmpdir(),'urania-probe-')),stdout=path.join(directory,'stdout'),stderr=path.join(directory,'stderr');
 let outFd,errFd;
 try{
  outFd=fs.openSync(stdout,'wx');errFd=fs.openSync(stderr,'wx');let child;
  try{child=spawn(executable,args,{cwd:directory,env:motionWorkerEnvironment({}),stdio:['ignore',outFd,errFd],windowsHide:true,shell:false});}finally{fs.closeSync(outFd);outFd=undefined;fs.closeSync(errFd);errFd=undefined;}
  await new Promise((resolve,reject)=>{
   let failure;const abort=()=>{failure=signal?.reason||new Error('FFprobe 已取消');try{child.kill('SIGKILL');}catch{}};
   const timer=setTimeout(()=>{failure=new Error('FFprobe 校验超时');try{child.kill('SIGKILL');}catch{}},timeoutMs);
   child.once('error',error=>{failure=error;});child.once('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure)reject(failure);else if(code!==0)reject(new Error('FFprobe 退出码 '+code));else resolve();});
   signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
  if(fs.statSync(stdout).size>2*1024*1024||fs.statSync(stderr).size>2*1024*1024)throw new Error('FFprobe 输出超过预算');
  return fs.readFileSync(stdout,'utf8');
 }finally{
  if(outFd!==undefined)fs.closeSync(outFd);if(errFd!==undefined)fs.closeSync(errFd);
  await fs.promises.rm(directory,{recursive:true,force:true,maxRetries:4,retryDelay:100});
 }
}
export async function verifyArtifact(ffprobePath,mp4Path,expectedFrames,expectedWidth,expectedHeight,expectedFps,{signal}={}){
 if(![expectedFrames,expectedWidth,expectedHeight].every(n=>Number.isSafeInteger(n)&&n>0)||!Number.isSafeInteger(expectedFps?.num)||!Number.isSafeInteger(expectedFps?.den)||expectedFps.num<=0||expectedFps.den<=0)throw new Error('产物校验的帧数、尺寸或帧率无效');
 const metadata=JSON.parse(await probe(ffprobePath,['-v','error','-print_format','json','-show_streams','-show_format',mp4Path],{signal})),video=metadata.streams?.find(s=>s.codec_type==='video');
 if(!video)throw new Error('无视频流');if(video.codec_name!=='h264')throw new Error('编码 '+video.codec_name+' ≠ h264');
 if(video.width!==expectedWidth||video.height!==expectedHeight)throw new Error('尺寸 '+video.width+'x'+video.height+' ≠ '+expectedWidth+'x'+expectedHeight);
 if(video.pix_fmt!=='yuv420p')throw new Error('像素格式 '+video.pix_fmt+' ≠ yuv420p');
 const [num,den]=String(video.avg_frame_rate).split('/').map(Number);if(!Number.isFinite(num)||!Number.isFinite(den)||den<=0||Math.abs(num/den-expectedFps.num/expectedFps.den)>1e-8)throw new Error('帧率 '+video.avg_frame_rate+' 与工程不一致');
 const frames=(await probe(ffprobePath,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0',mp4Path],{signal})).trim();
 if(Number(frames)!==expectedFrames)throw new Error('解码帧数 '+frames+' ≠ '+expectedFrames);
 const digest=await hashArtifact(mp4Path,{signal});return {verified:true,frames:Number(frames),width:video.width,height:video.height,codec:video.codec_name,pixFmt:video.pix_fmt,fps:video.avg_frame_rate,...digest};
}
