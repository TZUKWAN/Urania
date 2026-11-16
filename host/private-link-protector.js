/** Protect a short private result link with Windows current-user DPAPI. */
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {SafetyError} from './safety.js';

const runtime=fileURLToPath(new URL('../runtimes/',import.meta.url));
const lockSha='d0a08d536b4f454b4b30804b785a846827ff17a5b2a187af23b1d8508d95f4b3';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function executable(){
 if(process.platform!=='win32')throw new SafetyError('私有链接保护仅支持 Windows',503);
 let raw,lock;try{raw=readFileSync(join(runtime,'private-link-protector.lock.json'));if(raw.length>8192||sha(raw)!==lockSha)throw new Error();lock=JSON.parse(raw.toString('utf8'));}catch{throw new SafetyError('私有链接保护器锁定信息无效',503);}
 if(lock.schema!==1||lock.file!=='private-link-protector.exe'||lock.scope!=='CurrentUser'||lock.algorithm!=='Windows DPAPI'||!/^[a-f0-9]{64}$/.test(lock.sha256||''))throw new SafetyError('私有链接保护器配置无效',503);
 const path=join(runtime,lock.file);try{const info=statSync(path);if(!info.isFile()||info.size>4*1024*1024||sha(readFileSync(path))!==lock.sha256)throw new Error();}catch{throw new SafetyError('私有链接保护器完整性失败',503);}return path;
}
export function privateLinkProtectorAvailable(){executable();return true;}
export async function privateLinkProtectorPreflight(signal){
 const challenge=randomBytes(32),context=randomBytes(32).toString('hex');let encrypted,plain;
 try{encrypted=await transformPrivateLink('protect',context,challenge,signal);plain=await transformPrivateLink('unprotect',context,encrypted,signal);if(plain.length!==challenge.length||!timingSafeEqual(plain,challenge))throw new SafetyError('当前 Windows 用户无法可靠保护私有链接，未发送视频请求',503);}
 finally{challenge.fill(0);encrypted?.fill(0);plain?.fill(0);}
}
export async function transformPrivateLink(mode,context,bytes,signal){
 if(!['protect','unprotect'].includes(mode)||!/^[a-f0-9]{64}$/.test(context||'')||!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>16384)throw new SafetyError('私有链接保护参数无效',422);
 signal?.throwIfAborted();const child=spawn(executable(),[mode,context],{windowsHide:true,stdio:['pipe','pipe','pipe']}),parts=[];let size=0,problem=null;
 const abort=()=>{problem=new SafetyError('私有链接处理已停止',499);try{child.kill();}catch{}};signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{problem=new SafetyError('私有链接保护超时',504);try{child.kill();}catch{}},10000);
 if(signal?.aborted)abort();
 child.stdout.on('data',chunk=>{size+=chunk.length;if(size>32768){problem=new SafetyError('私有链接保护结果超过预算',413);try{child.kill();}catch{}}else parts.push(Buffer.from(chunk));});
 child.stdout.on('error',()=>{problem=new SafetyError('私有链接保护结果读取失败',503);try{child.kill();}catch{}});child.stderr.on('data',()=>{});child.stderr.on('error',()=>{});child.stdin.on('error',()=>{});child.stdin.end(bytes.toString('base64')+'\n');
 try{
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});if(problem)throw problem;if(code!==0)throw new SafetyError('Windows 无法保护或恢复私有链接，请保留原任务记录',503);
  const text=Buffer.concat(parts).toString('ascii');if(!/^[A-Za-z0-9+/]*={0,2}$/.test(text))throw new SafetyError('私有链接保护结果无效',503);const result=Buffer.from(text,'base64');if(!result.length||result.length>16384||result.toString('base64')!==text)throw new SafetyError('私有链接保护结果无效',503);return result;
 }catch(error){if(problem)throw problem;if(error instanceof SafetyError)throw error;throw new SafetyError('私有链接保护器启动失败',503);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
