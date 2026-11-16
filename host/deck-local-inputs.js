/** Local user-triggered handwriting recognition. No provider keys, network, or cloud OCR. */
import {spawn} from 'node:child_process';
import {readFileSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {matchesNativeBase} from '../client/native-contract.js';
import {SafetyError,assertSafeJson} from './safety.js';
const RUNTIME=fileURLToPath(new URL('../runtimes/',import.meta.url));
const EXE_SHA='7596e605ebf2b8b5908836d2af67d937ee153c79f86304a50f013e61cec11047';
const SOURCE_SHA='4bca2c34e203529e63f5ca852ef462dffe306033207e1af28d73655d217cd5d6';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function executable(){
 if(process.platform!=='win32'||process.arch!=='x64')throw new SafetyError('本地墨迹识别需要 Windows x64',503);
 const file=join(RUNTIME,'ink-recognizer.exe'),source=join(RUNTIME,'ink-recognizer.cs');
 try{for(const [path,expected,max]of [[file,EXE_SHA,1024*1024],[source,SOURCE_SHA,256*1024]]){const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>max||sha(readFileSync(path))!==expected)throw new Error();}}catch{throw new SafetyError('本地墨迹识别器缺失或完整性不一致，未执行',503);}return file;
}
export async function recognizeLocalInk(mode,strokes,signal){
 if(mode!=='text')throw new SafetyError('仅支持笔迹文字识别；公式识别和屏幕采集已移除',422);
 if(!Array.isArray(strokes)||!strokes.length||strokes.length>256)throw new SafetyError('请选择实际笔迹',422);
 let count=0;for(const stroke of strokes){if(!Array.isArray(stroke)||stroke.length<2||(count+=stroke.length)>20000||stroke.some(point=>!Array.isArray(point)||point.length<2||point.length>3||point.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1000000)))throw new SafetyError('笔迹坐标或数量超过识别范围',422);}
 const payload=JSON.stringify({mode,strokes});if(Buffer.byteLength(payload)>1024*1024)throw new SafetyError('笔迹数据超过本地识别预算',413);signal?.throwIfAborted();
 const child=spawn(executable(),[],{windowsHide:true,stdio:['pipe','pipe','pipe']}),parts=[];let bytes=0,problem=null;
 const stop=(message,status)=>{problem=new SafetyError(message,status);try{child.kill();}catch{}};
 const abort=()=>stop('本地识别已取消，原笔迹保留',499);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(()=>stop('本地文字识别已超时，文档保留',504),120000);
 child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>256*1024)stop('本地返回内容超过预算',413);else parts.push(Buffer.from(chunk));});child.stdout.on('error',()=>stop('本地结果读取失败',503));child.stderr.on('data',()=>{});child.stderr.on('error',()=>stop('本地通道中断',503));child.stdin.on('error',()=>{});child.stdin.end(payload);
 try{
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});if(problem)throw problem;
  let result;try{result=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new SafetyError('Windows 本地识别器没有返回有效结果',502);}
  if(code!==0||result.ok!==true)throw new SafetyError(result.cancelled?'已取消文字识别，文档保留':'Windows 文字识别失败；请确认系统手写识别组件可用，原笔迹保留',result.cancelled?499:503);
  assertSafeJson(result);if(result.mode!=='text'||typeof result.text!=='string'||!result.text.trim()||result.text.length>40000)throw new SafetyError('本地文字识别结果格式无效，原笔迹保留',502);
  return {mode:'text',engine:result.engine,strokes:result.strokes,text:result.text,alternatives:result.alternatives,recognized:true,applied:false};
 }catch(error){if(error instanceof SafetyError)throw error;throw new SafetyError('本地识别器无法启动，未改变文档',503);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function deckLocalInputRoutes(manager,{guard,readJsonBody,sendJson}){
 return [{kind:'exact',path:'/designcraft/api/v2/studio/deck-local',handler:guard(async(req,res)=>{
  if(req.method!=='POST')throw new SafetyError('POST required',405);const body=await readJsonBody(req,2*1024*1024),view=manager.getView(req.headers['x-designcraft-view'],req.headers['x-designcraft-capability']);
  const current=()=>{const live=manager.getView(req.headers['x-designcraft-view'],req.headers['x-designcraft-capability']);if(live!==view||view.engine!=='deckcraft'||body.epoch!==view.epoch||!matchesNativeBase(view.document,body.base,'deckcraft'))throw new SafetyError('幻灯片或笔迹选区已改变，请重新识别',409);};current();
  if(body.action!=='recognize'||body.mode!=='text')throw new SafetyError('该本地操作已移除，仅保留笔迹文字识别',422);
  const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);if(res.destroyed)controller.abort();
  try{const result=await recognizeLocalInk('text',body.strokes,controller.signal);current();sendJson(res,200,{ok:true,...result});}finally{res.off('close',abort);}
 })}];
}
