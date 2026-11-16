/** Explicit fal storage uploads for immutable, project-scoped workflow inputs. */
import {createHash} from 'node:crypto';
import * as store from './docstore.js';
import {SafetyError,assertPortableName} from './safety.js';
import {readZip} from './zip.js';
import {privateLinkProtectorPreflight,transformPrivateLink} from './private-link-protector.js';

const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const context=(jobId,pointer)=>sha(Buffer.from('DesignCraft/fal/storage/v1\0'+jobId+'\0'+pointer));
export const falCredentialFingerprint=(jobId,key)=>sha(Buffer.from('DesignCraft/fal/credential/v1\0'+jobId+'\0'+key));

function targetAt(input,pointer,allowPrepared=false){
 if(typeof pointer!=='string'||!pointer.startsWith('/')||pointer.length>500)throw new SafetyError('fal 存储素材指针无效',422);
 const parts=pointer.slice(1).split('/').map(part=>{if(/~(?![01])/.test(part))throw new SafetyError('fal 存储素材指针编码无效',422);return part.replace(/~1/g,'/').replace(/~0/g,'~');});
 if(parts.length>20||parts.some(part=>!part||['__proto__','prototype','constructor'].includes(part)))throw new SafetyError('fal 存储素材指针不安全',422);
 let target=input;for(const part of parts.slice(0,-1)){if(!target||typeof target!=='object'||!Object.hasOwn(target,part))throw new SafetyError('fal 存储素材指针父对象不存在',422);target=target[part];}
 const key=parts.at(-1);if(!target||typeof target!=='object'||Array.isArray(target)&&(!/^\d+$/.test(key)||String(Number(key))!==key||Number(key)>=target.length)||Object.hasOwn(target,key)&&target[key]!==null&&target[key]!=='@asset'&&!(allowPrepared&&target[key]==='https://fal.media/'))throw new SafetyError('fal 存储素材目标必须为空或 @asset',422);
 return {target,key};
}
export function detectFalStorageMedia(bytes,detectMedia){
 if(bytes.length>=4&&bytes.readUInt32LE(0)===0x04034b50){
  try{readZip(bytes,{maxEntries:8192,maxEntryBytes:256*1024*1024,maxTotalBytes:512*1024*1024,includeNames:[]});}catch{throw new SafetyError('ZIP 目录无效、加密或超出支持的格式与预算',422);}
  return ['application/zip','.zip'];
 }
 const [mime,ext]=detectMedia(bytes);if(!mime||!/^\.[a-z0-9]{1,8}$/.test(ext))throw new SafetyError('fal 存储素材类型无法从真实文件内容确认',422);return [mime,ext];
}
/** Modifies only an in-memory clone. The temporary value is never sent or saved. */
export function prepareFalStorageAssets(root,input,refs,usedPointers,detectMedia){
 if(!Array.isArray(refs)||refs.length>8||refs.length+usedPointers.size>8)throw new SafetyError('fal 项目素材引用超过预算',413);
 const assets=[],uploads=[];let total=0;
 for(const ref of refs){
  if(!ref||Object.keys(ref).some(key=>!['pointer','asset'].includes(key))||typeof ref.asset!=='string'||usedPointers.has(ref.pointer))throw new SafetyError('fal 存储素材引用无效或重复',422);
  assertPortableName(ref.asset);const slot=targetAt(input,ref.pointer),bytes=store.readAsset(root,ref.asset);
  if(!bytes||!bytes.length)throw new SafetyError('fal 存储项目素材不存在或为空',404);if((total+=bytes.length)>128*1024*1024)throw new SafetyError('fal 存储素材合计超过 128 MiB',413);
  const [mime,ext]=detectFalStorageMedia(bytes,detectMedia),digest=sha(bytes),saved=store.saveAsset(root,'falstore-input-'+digest.slice(0,24)+ext,bytes);
  const asset={pointer:ref.pointer,asset:saved.name,bytes:bytes.length,sha256:digest,mime};assets.push(asset);uploads.push({...asset,state:'not_sent'});slot.target[slot.key]='https://fal.media/';usedPointers.add(ref.pointer);
 }
 return {assets,uploads};
}
export function validateFalStorageUploads(value){
 if(value.uploads===undefined){if(value.credentialFingerprint!==undefined&&value.captureRemoteOutputs!==true)throw new SafetyError('fal 凭据摘要缺少对应操作',409);return;}
 if(!Array.isArray(value.uploads)||!value.uploads.length||value.uploads.length>8||!HASH.test(value.credentialFingerprint||''))throw new SafetyError('fal 存储上传记录无效',409);
 const seen=new Set();let total=0;
 for(const row of value.uploads){
  const hasSecret=row&&row.secretAsset!==undefined,allowed=['pointer','asset','bytes','sha256','mime','state','secretAsset','secretSha256','secretBytes'];
  if(!row||Object.keys(row).some(key=>!allowed.includes(key))||typeof row.pointer!=='string'||seen.has(row.pointer)||typeof row.asset!=='string'||!/^falstore-input-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.[a-z0-9]{1,8}$/.test(row.asset)||!HASH.test(row.sha256||'')||!row.asset.startsWith('falstore-input-'+row.sha256.slice(0,24))||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>64*1024*1024||(total+=row.bytes)>128*1024*1024||typeof row.mime!=='string'||!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(row.mime)||!['not_sent','initiating','prepared','uploading','accepted'].includes(row.state)||['prepared','uploading','accepted'].includes(row.state)!==hasSecret||hasSecret&&(typeof row.secretAsset!=='string'||!/^falstore-secret-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.bin$/.test(row.secretAsset)||!HASH.test(row.secretSha256||'')||!row.secretAsset.startsWith('falstore-secret-'+row.secretSha256.slice(0,24))||!Number.isSafeInteger(row.secretBytes)||row.secretBytes<1||row.secretBytes>16384)||!hasSecret&&(row.secretSha256!==undefined||row.secretBytes!==undefined)||!value.inputAssets.some(item=>item.pointer===row.pointer&&item.asset===row.asset&&item.sha256===row.sha256&&item.bytes===row.bytes&&item.mime===row.mime))throw new SafetyError('fal 存储上传状态或来源无效',409);
  seen.add(row.pointer);assertPortableName(row.asset);if(hasSecret)assertPortableName(row.secretAsset);
 }
 if(value.remote?.state!=='not_submitted'&&value.uploads.some(row=>row.state!=='accepted'))throw new SafetyError('fal 队列状态与素材上传回执不一致',409);
}
export function falStorageSecretAsset(root,row){
 if(!row.secretAsset)return null;const bytes=store.readAsset(root,row.secretAsset);if(!bytes||bytes.length!==row.secretBytes||sha(bytes)!==row.secretSha256)throw new SafetyError('fal 存储加密链接缺失或改变',409);return bytes;
}
function safeUrl(value,key){
 if(typeof value!=='string'||value.length>12000||typeof key!=='string'||key.trim().length<8||value.includes(key))throw new SafetyError('fal 返回的存储地址无效',502);let url;try{url=new URL(value);}catch{throw new SafetyError('fal 返回的存储地址无效',502);}
 const host=url.hostname.toLowerCase();if(url.protocol!=='https:'||!(host==='fal.media'||host.endsWith('.fal.media'))||url.port||url.username||url.password||url.hash||!url.pathname||url.pathname==='/')throw new SafetyError('fal 返回的存储地址不在允许范围',502);return url.href;
}
async function limited(response,limit){
 if(Number(response.headers.get('content-length'))>limit||!response.body)throw new SafetyError('fal 存储返回内容为空或超过预算',502);
 const reader=response.body.getReader(),chunks=[];let size=0;while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>limit){await reader.cancel();throw new SafetyError('fal 存储返回内容超过预算',413);}chunks.push(Buffer.from(item.value));}return Buffer.concat(chunks,size);
}
async function request(url,options,signal,onDispatch,consume){
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,120000);
 try{signal?.throwIfAborted();onDispatch();signal?.throwIfAborted();const response=await fetch(url,{...options,signal:controller.signal,redirect:'error'});return await consume(response);}catch(error){if(signal?.aborted)throw new SafetyError('已停止本地等待；fal 存储状态可能未确认，不会自动重发',499);if(controller.signal.aborted)throw new SafetyError('fal 存储请求超时，状态未确认，不会自动重发',504);if(error instanceof SafetyError)throw error;throw new SafetyError('fal 存储请求失败，状态可能未确认，不会自动重发',502);}finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function protectUrl(root,jobId,pointer,url,signal){
 const plain=Buffer.from(url,'utf8');let encrypted;try{encrypted=await transformPrivateLink('protect',context(jobId,pointer),plain,signal);const digest=sha(encrypted),saved=store.saveAsset(root,'falstore-secret-'+digest.slice(0,24)+'.bin',encrypted);return {secretAsset:saved.name,secretSha256:digest,secretBytes:encrypted.length};}finally{plain.fill(0);encrypted?.fill(0);}
}
async function restoreUrl(root,jobId,row,key,signal){
 const encrypted=falStorageSecretAsset(root,row);let plain;try{plain=await transformPrivateLink('unprotect',context(jobId,row.pointer),encrypted,signal);return safeUrl(plain.toString('utf8'),key);}finally{plain?.fill(0);encrypted.fill(0);}
}
/** Upload only when explicitly selected by the caller; no automatic retry on uncertainty. */
export async function bindFalStorageUploads(record,key,input,signal,save,assertCurrent){
 if(!record.uploads?.length)return;
 if(typeof key!=='string'||key.trim().length<8||record.credentialFingerprint!==falCredentialFingerprint(record.id,key)||/[\r\n]/.test(key))throw new SafetyError('fal 凭据已改变或无效，未上传素材',409);
 try{await privateLinkProtectorPreflight(signal);}catch(error){if(signal?.aborted)throw error;throw new SafetyError('当前用户无法安全保护 fal 存储链接，未开始上传',503);}
 for(const row of record.uploads){
  signal?.throwIfAborted();assertCurrent?.();const bytes=store.readAsset(record.root,row.asset);if(!bytes||bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw new SafetyError('fal 存储原件缺失或改变',409);
  let url;if(row.state==='accepted')url=await restoreUrl(record.root,record.id,row,key,signal);
  else{
   if(row.state!=='not_sent')throw new SafetyError('此前 fal 存储请求状态未确认，不会自动重发',409);
   const data=await request('https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',{method:'POST',headers:{Authorization:'Key '+key,'Content-Type':'application/json','X-Fal-No-Retry':'1'},body:JSON.stringify({file_name:row.asset,content_type:row.mime})},signal,()=>{assertCurrent?.();row.state='initiating';save(record);},async response=>{const raw=await limited(response,64*1024);if(!response.ok)throw new SafetyError('fal 存储初始化失败（HTTP '+response.status+'），状态未确认',502);try{return JSON.parse(raw.toString('utf8'));}catch{throw new SafetyError('fal 存储初始化响应无效，状态未确认',502);}});
   const uploadUrl=safeUrl(data?.upload_url,key);url=safeUrl(data?.file_url,key);Object.assign(row,await protectUrl(record.root,record.id,row.pointer,url,signal));row.state='prepared';save(record);
   await request(uploadUrl,{method:'PUT',headers:{'Content-Type':row.mime},body:bytes},signal,()=>{assertCurrent?.();row.state='uploading';save(record);},async response=>{if(!response.ok)throw new SafetyError('fal 存储上传失败（HTTP '+response.status+'），状态未确认',502);await response.body?.cancel();});row.state='accepted';save(record);
  }
  const slot=targetAt(input,row.pointer,true);slot.target[slot.key]=url;
 }
}
