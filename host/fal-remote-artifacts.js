/** Capture real fal result links without disclosing them or claiming file download. */
import {createHash} from 'node:crypto';
import * as store from './docstore.js';
import {SafetyError,assertPortableName} from './safety.js';
import {transformPrivateLink} from './private-link-protector.js';
import {falCredentialFingerprint} from './fal-storage-upload.js';

const HASH=/^[a-f0-9]{64}$/,ID=/^faljob-[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const context=(id,pointer)=>sha(Buffer.from('DesignCraft/fal/output-link/v1\0'+id+'\0'+pointer));
function validPointer(pointer){return typeof pointer==='string'&&pointer.length<=1000&&(pointer===''||pointer.startsWith('/'))&&!/~(?![01])/.test(pointer)&&!/(?:https?:\/\/|data:|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(pointer);}
function outputAt(value,pointer){
 if(!pointer)return value;let current=value;for(const raw of pointer.slice(1).split('/')){const part=raw.replace(/~1/g,'/').replace(/~0/g,'~');if(!current||typeof current!=='object'||!Object.hasOwn(current,part))return undefined;current=current[part];}return current;
}
function safeUrl(value){
 if(typeof value!=='string'||value.length>12000)throw new SafetyError('fal 输出引用无效',502);let url;try{url=new URL(value);}catch{throw new SafetyError('fal 输出引用无效',502);}
 const host=url.hostname.toLowerCase(),safe=host==='fal.media'||host.endsWith('.fal.media')||host==='storage.googleapis.com'&&url.pathname.startsWith('/falserverless/');
 if(url.protocol!=='https:'||!safe||url.port||url.username||url.password||url.hash||!url.pathname||url.pathname==='/')throw new SafetyError('fal 输出引用不在允许范围',422);return url.href;
}
function targetAt(input,pointer){
 if(!validPointer(pointer)||!pointer||pointer.length>500)throw new SafetyError('fal 输出绑定目标指针无效',422);
 const parts=pointer.slice(1).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'));
 if(parts.length>20||parts.some(part=>!part||['__proto__','prototype','constructor'].includes(part)))throw new SafetyError('fal 输出绑定目标指针不安全',422);
 let target=input;for(const part of parts.slice(0,-1)){if(!target||typeof target!=='object'||!Object.hasOwn(target,part))throw new SafetyError('fal 输出绑定父对象不存在',422);target=target[part];}
 const key=parts.at(-1);if(!target||typeof target!=='object'||Array.isArray(target)&&(!/^\d+$/.test(key)||String(Number(key))!==key||Number(key)>=target.length)||Object.hasOwn(target,key)&&target[key]!==null&&target[key]!=='@asset')throw new SafetyError('fal 输出绑定目标必须为空或 @asset',422);return {target,key};
}
export function falRemoteSecretAsset(root,row){
 const bytes=store.readAsset(root,row.secretAsset);if(!bytes||bytes.length!==row.secretBytes||sha(bytes)!==row.secretSha256)throw new SafetyError('fal 输出加密引用缺失或改变',409);return bytes;
}
async function restore(root,id,row,signal){
 const encrypted=falRemoteSecretAsset(root,row);let plain;try{plain=await transformPrivateLink('unprotect',context(id,row.pointer),encrypted,signal);return safeUrl(plain.toString('utf8'));}finally{plain?.fill(0);encrypted.fill(0);}
}
export function validateFalRemoteArtifacts(value){
 if(value.captureRemoteOutputs!==undefined&&value.captureRemoteOutputs!==true)throw new SafetyError('fal 远端输出捕获设置无效',409);
 if(value.captureRemoteOutputs===true){
  if(!HASH.test(value.credentialFingerprint||'')||!Array.isArray(value.remoteLinks)||value.remoteLinks.length>8)throw new SafetyError('fal 远端输出记录无效',409);
  const seen=new Set();for(const row of value.remoteLinks){if(!row||Object.keys(row).some(key=>!['pointer','secretAsset','secretSha256','secretBytes'].includes(key))||!validPointer(row.pointer)||seen.has(row.pointer)||typeof row.secretAsset!=='string'||!/^falremote-secret-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.bin$/.test(row.secretAsset)||!HASH.test(row.secretSha256||'')||!row.secretAsset.startsWith('falremote-secret-'+row.secretSha256.slice(0,24))||!Number.isSafeInteger(row.secretBytes)||row.secretBytes<1||row.secretBytes>16384)throw new SafetyError('fal 远端输出引用记录无效',409);assertPortableName(row.secretAsset);seen.add(row.pointer);if(value.status==='ready'){const node=outputAt(value.result,row.pointer),media=value.outputs.find(item=>item.pointer===row.pointer);if(!(node&&node.remoteOutputPointer===row.pointer&&node.state==='remote-reference-only')&&!(node&&media&&node.projectAsset===media.asset&&node.sha256===media.sha256&&node.bytes===media.bytes))throw new SafetyError('fal 已完成输出缺少匹配的结果指针',409);}}
 }else if(value.remoteLinks!==undefined)throw new SafetyError('fal 远端输出引用缺少捕获许可',409);
 if(value.remoteInputRefs!==undefined){
  if(!Array.isArray(value.remoteInputRefs)||!value.remoteInputRefs.length||value.remoteInputRefs.length+(value.inputAssets||[]).length>8)throw new SafetyError('fal 远端输入引用无效',409);
  const used=new Set((value.inputAssets||[]).map(row=>row.pointer));for(const row of value.remoteInputRefs){if(!row||Object.keys(row).some(key=>!['pointer','jobId','outputPointer','secretSha256','resultSha256'].includes(key))||!validPointer(row.pointer)||!row.pointer||row.pointer.length>500||used.has(row.pointer)||!ID.test(row.jobId||'')||row.jobId===value.id||!validPointer(row.outputPointer)||!HASH.test(row.secretSha256||'')||!HASH.test(row.resultSha256||''))throw new SafetyError('fal 远端输入来源记录无效',409);used.add(row.pointer);}
 }
}
export async function captureFalRemoteOutput(root,record,pointer,value,signal,save,key){
 if(!record.captureRemoteOutputs||!validPointer(pointer)||record.credentialFingerprint!==falCredentialFingerprint(record.id,key))throw new SafetyError('fal 输出捕获身份不一致',409);
 const url=safeUrl(value);if(url.includes(key))throw new SafetyError('fal 输出地址包含凭据，未保存',502);const old=record.remoteLinks.find(item=>item.pointer===pointer);
 if(old){if(await restore(root,record.id,old,signal)!==url)throw new SafetyError('fal 同一输出指针的地址已改变，未覆盖原记录',409);return old;}
 if(record.remoteLinks.length>=8)throw new SafetyError('fal 远端输出引用超过预算',413);
 const plain=Buffer.from(url,'utf8');let encrypted;try{encrypted=await transformPrivateLink('protect',context(record.id,pointer),plain,signal);const digest=sha(encrypted),saved=store.saveAsset(root,'falremote-secret-'+digest.slice(0,24)+'.bin',encrypted),row={pointer,secretAsset:saved.name,secretSha256:digest,secretBytes:encrypted.length};record.remoteLinks.push(row);save(record);return row;}finally{plain.fill(0);encrypted?.fill(0);}
}
/** Bind only actual encrypted results from a completed, same-credential fal task. */
export async function bindFalRemoteOutputs(root,input,refs,used,targetId,connection,key,load,signal){
 if(!Array.isArray(refs)||refs.length>8||refs.length+used.size>8)throw new SafetyError('fal 远端引用超过预算',413);const result=[];
 for(const ref of refs){
  signal?.throwIfAborted();if(!ref||Object.keys(ref).some(name=>!['pointer','jobId','outputPointer'].includes(name))||used.has(ref.pointer)||!ID.test(ref.jobId||'')||ref.jobId===targetId||!validPointer(ref.outputPointer))throw new SafetyError('fal 远端输出绑定引用无效',422);
  const slot=targetAt(input,ref.pointer),source=load(root,ref.jobId),link=source.remoteLinks?.find(item=>item.pointer===ref.outputPointer);
  if(source.status!=='ready'||source.remote?.state!=='response_received'||source.provider!==connection.provider||source.connection!==connection.connection||!HASH.test(source.resultSha256||'')||!link||source.credentialFingerprint!==falCredentialFingerprint(source.id,key))throw new SafetyError('fal 远端输出来源尚未确认、凭据不一致或缺失',409);
  slot.target[slot.key]=await restore(root,source.id,link,signal);used.add(ref.pointer);result.push({pointer:ref.pointer,jobId:source.id,outputPointer:ref.outputPointer,secretSha256:link.secretSha256,resultSha256:source.resultSha256});
 }
 return result;
}
