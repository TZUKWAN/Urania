/** Explicit, bounded fetch of the official v3 Play CDN for an isolated preview. */
import {createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {SafetyError} from './safety.js';

export const TAILWIND_PREVIEW_SHA256='176e894661aa9cdc9a5cba6c720044cbbf7b8bd80d1c9a142a7c24b1b6c50d15';
export const TAILWIND_LICENSE_SHA256='60e0b68c0f35c078eef3a5d29419d0b03ff84ec1df9c3f9d6e39a519a5ae7985';
const SOURCE='https://cdn.tailwindcss.com/3.4.17',EXPECTED_BYTES=407279,MAX_BYTES=512*1024;
const LICENSE=new URL('../resources/vendor/tailwind-3.4.17/LICENSE.txt',import.meta.url);
let cached;

export async function tailwindLicenseBytes(){
 const info=await lstat(LICENSE);if(!info.isFile()||info.isSymbolicLink()||info.size!==1071)throw new SafetyError('Tailwind 许可原件不可用',409);
 const bytes=await readFile(LICENSE);if(createHash('sha256').update(bytes).digest('hex')!==TAILWIND_LICENSE_SHA256)throw new SafetyError('Tailwind 许可原件摘要不一致',409);return bytes;
}

export function tailwindPreviewEvidence(){
 return {kind:'tailwind-play-cdn',version:'3.4.17',sha256:TAILWIND_PREVIEW_SHA256,evidence:'script-requested-matching-saved-files',styleMarker:'client-reported'};
}
export function validateTailwindPreviewEvidence(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='evidence,kind,sha256,styleMarker,version'||value.kind!=='tailwind-play-cdn'||value.version!=='3.4.17'||value.sha256!==TAILWIND_PREVIEW_SHA256||value.evidence!=='script-requested-matching-saved-files'||value.styleMarker!=='client-reported')throw new SafetyError('Tailwind 转换来源声明无效',409);
 return true;
}

export async function tailwindPreviewBytes(signal){
 signal?.throwIfAborted();if(cached)return Buffer.from(cached);
 const controller=new AbortController(),abort=()=>controller.abort();
 if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});
 const timer=setTimeout(abort,20000);timer.unref?.();
 try{
  const response=await fetch(SOURCE,{signal:controller.signal,redirect:'error'});
  if(!response.ok||!response.body||Number(response.headers.get('content-length'))>MAX_BYTES)throw new SafetyError('Tailwind 官方预览脚本不可用或超过预算',503);
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>MAX_BYTES)throw new SafetyError('Tailwind 官方预览脚本超过预算',413);chunks.push(Buffer.from(item.value));}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks,size);
  if(size!==EXPECTED_BYTES||createHash('sha256').update(bytes).digest('hex')!==TAILWIND_PREVIEW_SHA256)throw new SafetyError('Tailwind 官方脚本与固定摘要不一致，未启用兼容预览',409);
  try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('Tailwind 官方脚本编码无效',409);}
  signal?.throwIfAborted();cached=bytes;return Buffer.from(bytes);
 }catch(error){
  if(signal?.aborted)throw new SafetyError('Tailwind 兼容预览已停止',499);
  if(controller.signal.aborted)throw new SafetyError('Tailwind 官方脚本读取超时',504);
  if(error instanceof SafetyError)throw error;
  throw new SafetyError('Tailwind 官方脚本读取失败，网页未修改',503);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
