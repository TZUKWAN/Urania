/** Explicit, project-scoped fal workflows. Upstream schemas and results are data, never code. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import * as store from './docstore.js';
import {SafetyError,assertSafeJson,assertPortableName,workspacePath} from './safety.js';
import {atomicCreate} from './persistence.js';
import {falSearch,falWorkflowSpec,falSubmitWorkflow,falWorkflowStatus,falWorkflowResult,falCancel} from './fal-image-provider.js';
import {prepareFalStorageAssets,validateFalStorageUploads,bindFalStorageUploads,falCredentialFingerprint,falStorageSecretAsset} from './fal-storage-upload.js';
import {validateFalRemoteArtifacts,captureFalRemoteOutput,bindFalRemoteOutputs,falRemoteSecretAsset} from './fal-remote-artifacts.js';
import {privateLinkProtectorPreflight} from './private-link-protector.js';

const ID=/^faljob-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const identity=route=>JSON.stringify([route.protocol,route.baseURL,route.ref]);
const unsafeKey=key=>/^(?:api[-_]?key|authorization|access[-_]?token|client[-_]?secret|password|credentials?)$/i.test(key);
function unsupported(message){const error=new SafetyError(message,422);error.schemaUnsupported=true;return error;}
function canonical(value){
 let count=0;const walk=(item,depth)=>{
  if(++count>150000||depth>60)throw new SafetyError('fal 数据结构超过预算',413);
  if(item===null||typeof item==='string'||typeof item==='boolean')return item;
  if(typeof item==='number'&&Number.isFinite(item))return item;
  if(Array.isArray(item))return item.map(value=>walk(value,depth+1));
  if(!item||typeof item!=='object')throw new SafetyError('fal 数据包含无效值',422);
  const output=Object.create(null);for(const key of Object.keys(item).sort())output[key]=walk(item[key],depth+1);return output;
 };return JSON.stringify(walk(value,0));
}
const schemaHash=spec=>sha(Buffer.from(canonical(spec)));
function resolveSchema(spec,value,stack=new Set()){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new SafetyError('fal 模型 schema 格式无效',422);
 if(value.$ref===undefined)return value;
 const match=typeof value.$ref==='string'&&/^#\/components\/schemas\/([A-Za-z0-9_.-]+)$/.exec(value.$ref);
 if(!match||stack.has(match[1])||stack.size>16||!Object.hasOwn(spec.components?.schemas||{},match[1]))throw unsupported('fal 模型 schema 引用不受支持');
 if(Object.keys(value).some(key=>key!=='$ref'&&!['description','title'].includes(key)))throw unsupported('fal 模型 schema 引用约束不受支持');
 const next=new Set(stack);next.add(match[1]);return resolveSchema(spec,spec.components.schemas[match[1]],next);
}
const allowedSchemaKeys=new Set(['type','properties','required','additionalProperties','items','minItems','maxItems','uniqueItems','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','minLength','maxLength','enum','const','anyOf','oneOf','allOf','nullable','format','title','description','default','example','examples','deprecated','readOnly','writeOnly','$schema','$id']);
function validateInput(spec,definition,data){
 let nodes=0;const check=(raw,value,depth)=>{
  if(++nodes>100000||depth>40)throw new SafetyError('fal 输入验证超过预算',413);
  const rule=resolveSchema(spec,raw);for(const key of Object.keys(rule))if(!allowedSchemaKeys.has(key)&&!key.startsWith('x-'))throw unsupported('fal 输入 schema 包含暂不支持的约束：'+key.slice(0,60));
  if(value===null&&rule.nullable===true)return;
  for(const name of ['allOf','anyOf','oneOf'])if(rule[name]!==undefined){
   if(!Array.isArray(rule[name])||rule[name].length>24)throw new SafetyError('fal 输入 schema 分支无效',422);
   let matches=0;for(const branch of rule[name]){try{check(branch,value,depth+1);matches++;}catch(error){if(error.status===413||error.schemaUnsupported)throw error;}}
   if(name==='allOf'&&matches!==rule[name].length||name==='anyOf'&&matches<1||name==='oneOf'&&matches!==1)throw new SafetyError('fal 输入不符合模型 schema 分支',422);
  }
  if(rule.const!==undefined&&canonical(value)!==canonical(rule.const)||Array.isArray(rule.enum)&&!rule.enum.some(item=>canonical(item)===canonical(value)))throw new SafetyError('fal 输入值不在模型允许范围',422);
  const type=value===null?'null':Array.isArray(value)?'array':typeof value==='number'&&Number.isInteger(value)?'integer':typeof value;
  const types=typeof rule.type==='string'?[rule.type]:Array.isArray(rule.type)?rule.type:[];
  if(types.length&&!types.includes(type)&&!(type==='integer'&&types.includes('number')))throw new SafetyError('fal 输入类型与模型 schema 不一致',422);
  if(typeof value==='string'){
   if(Number.isFinite(rule.minLength)||Number.isFinite(rule.maxLength)){const length=value.startsWith('data:')?value.length:[...value].length;if(Number.isFinite(rule.minLength)&&length<rule.minLength||Number.isFinite(rule.maxLength)&&length>rule.maxLength)throw new SafetyError('fal 输入文本长度不符合模型要求',422);}
   if(rule.format!==undefined&&!['uri','url','date-time','binary','byte'].includes(rule.format))throw unsupported('fal 输入格式暂不支持：'+String(rule.format).slice(0,60));
   if(['uri','url'].includes(rule.format)){let url;try{url=new URL(value);}catch{throw new SafetyError('fal 文件或网址输入格式无效',422);}if(!['https:','data:'].includes(url.protocol)||url.username||url.password)throw new SafetyError('fal 文件或网址输入不安全',422);}
   if(rule.format==='date-time'&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value))throw new SafetyError('fal 时间输入格式无效',422);
   if(rule.format==='byte'&&!/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new SafetyError('fal 字节输入格式无效',422);
  }
  if(typeof value==='number'){
   if(Number.isFinite(rule.minimum)&&value<rule.minimum||Number.isFinite(rule.maximum)&&value>rule.maximum||typeof rule.exclusiveMinimum==='number'&&value<=rule.exclusiveMinimum||typeof rule.exclusiveMaximum==='number'&&value>=rule.exclusiveMaximum||rule.exclusiveMinimum===true&&Number.isFinite(rule.minimum)&&value<=rule.minimum||rule.exclusiveMaximum===true&&Number.isFinite(rule.maximum)&&value>=rule.maximum||Number.isFinite(rule.multipleOf)&&Math.abs(value/rule.multipleOf-Math.round(value/rule.multipleOf))>1e-9)throw new SafetyError('fal 输入数值不符合模型要求',422);
  }
  if(Array.isArray(value)){
   if(Number.isFinite(rule.minItems)&&value.length<rule.minItems||Number.isFinite(rule.maxItems)&&value.length>rule.maxItems||rule.uniqueItems===true&&new Set(value.map(canonical)).size!==value.length)throw new SafetyError('fal 输入数组不符合模型要求',422);
   if(rule.items)for(const item of value)check(rule.items,item,depth+1);
  }else if(value&&typeof value==='object'){
   const properties=rule.properties&&typeof rule.properties==='object'?rule.properties:{};
   if(rule.required!==undefined&&(!Array.isArray(rule.required)||rule.required.some(key=>typeof key!=='string'||!Object.hasOwn(value,key))))throw new SafetyError('fal 输入缺少必填字段',422);
   for(const [key,item] of Object.entries(value)){
    if(unsafeKey(key))throw new SafetyError('fal 输入不得包含凭据字段',422);
    if(Object.hasOwn(properties,key))check(properties[key],item,depth+1);
    else if(rule.additionalProperties===false)throw new SafetyError('fal 输入包含模型未声明字段：'+key.slice(0,60),422);
    else if(rule.additionalProperties&&typeof rule.additionalProperties==='object')check(rule.additionalProperties,item,depth+1);
   }
  }
 };
 check(definition,data,0);
}
function inspectInput(value){
 let seen=0;const walk=(item,depth)=>{
  if(++seen>100000||depth>40)throw new SafetyError('fal 输入超过预算',413);
  if(typeof item==='string'){
   if(/^data:/i.test(item))throw new SafetyError('请用项目素材引用提交文件，不能直接提交数据 URI',422);
   if(/^https?:\/\//i.test(item)){let url;try{url=new URL(item);}catch{throw new SafetyError('输入地址无效',422);}if(url.protocol!=='https:'||url.username||url.password)throw new SafetyError('输入地址必须使用不含凭据的 HTTPS',422);}
  }else if(Array.isArray(item))for(const child of item)walk(child,depth+1);
  else if(item&&typeof item==='object')for(const [key,child]of Object.entries(item)){if(unsafeKey(key))throw new SafetyError('fal 输入不得包含凭据字段',422);walk(child,depth+1);}
 };walk(value,0);
}
function mimeOf(bytes){
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return ['image/png','.png'];
 if(bytes[0]===255&&bytes[1]===216)return ['image/jpeg','.jpg'];
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return ['image/webp','.webp'];
 if(bytes.subarray(0,6).toString()==='GIF87a'||bytes.subarray(0,6).toString()==='GIF89a')return ['image/gif','.gif'];
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE')return ['audio/wav','.wav'];
 if(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&0xe0)===0xe0)return ['audio/mpeg','.mp3'];
 if(bytes.subarray(0,4).toString()==='fLaC')return ['audio/flac','.flac'];
 if(bytes.subarray(0,4).toString()==='OggS')return ['audio/ogg','.ogg'];
 if(bytes.subarray(4,8).toString()==='ftyp'){const brand=bytes.subarray(8,12).toString('ascii');if(['avif','avis'].includes(brand))return ['image/avif','.avif'];if(['heic','heix','hevc','mif1','msf1'].includes(brand))return ['image/heif','.heic'];if(['M4A ','M4B '].includes(brand))return ['audio/mp4','.m4a'];return ['application/mp4','.mp4'];}
 if(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&bytes.subarray(0,4096).includes(Buffer.from('webm')))return ['video/webm','.webm'];
 if(bytes.subarray(0,4).toString()==='glTF')return ['model/gltf-binary','.glb'];
 if(bytes.subarray(0,5).toString()==='%PDF-')return ['application/pdf','.pdf'];
 return [null,'.bin'];
}
function bindAssets(root,input,refs){
 if(!Array.isArray(refs)||refs.length>8)throw new SafetyError('fal 项目素材引用超过预算',413);
 const cloned=JSON.parse(JSON.stringify(input)),used=new Set(),assets=[];let total=0;
 for(const ref of refs){
  if(!ref||typeof ref.pointer!=='string'||!ref.pointer.startsWith('/')||ref.pointer.length>500||typeof ref.asset!=='string'||used.has(ref.pointer))throw new SafetyError('fal 素材引用无效或重复',422);
  assertPortableName(ref.asset);const parts=ref.pointer.slice(1).split('/').map(part=>{if(/~(?![01])/.test(part))throw new SafetyError('fal 素材指针无效',422);return part.replace(/~1/g,'/').replace(/~0/g,'~');});
  if(parts.length>20||parts.some(part=>!part||['__proto__','prototype','constructor'].includes(part)))throw new SafetyError('fal 素材指针不安全',422);
  let target=cloned;for(const part of parts.slice(0,-1)){if(!target||typeof target!=='object'||!Object.hasOwn(target,part))throw new SafetyError('fal 素材指针父对象不存在',422);target=target[part];}
  const last=parts.at(-1);if(!target||typeof target!=='object'||Array.isArray(target)&&(!/^\d+$/.test(last)||String(Number(last))!==last||Number(last)>=target.length)||Object.hasOwn(target,last)&&target[last]!==null&&target[last]!=='@asset')throw new SafetyError('fal 素材目标必须为空或 @asset',422);
  const bytes=store.readAsset(root,ref.asset);if(!bytes||!bytes.length)throw new SafetyError('fal 项目素材不存在或为空',404);if((total+=bytes.length)>32*1024*1024)throw new SafetyError('fal 输入素材合计超过 32 MiB',413);
  const [mime]=mimeOf(bytes);if(!mime)throw new SafetyError('fal 输入素材类型无法从文件内容确认',422);
  target[last]='data:'+mime+';base64,'+bytes.toString('base64');used.add(ref.pointer);assets.push({pointer:ref.pointer,asset:ref.asset,bytes:bytes.length,sha256:sha(bytes),mime});
 }
 return {input:cloned,assets};
}
function dir(root){const path=workspacePath(root,'design/.designcraft/fal-workflows');mkdirSync(path,{recursive:true});return path;}
function fileFor(root,id){if(!ID.test(id||''))throw new SafetyError('fal 工作流任务 ID 无效',422);return workspacePath(root,join(dir(root),id+'.json'));}
function save(record){const path=fileFor(record.root,record.id),temp=path+'.tmp-'+randomUUID(),{root,...data}=record;validateFalWorkflowRecord(data);const raw=JSON.stringify(data,null,2);if(Buffer.byteLength(raw)>2*1024*1024)throw new SafetyError('fal 工作流记录超过预算',413);writeFileSync(temp,raw,{flag:'wx'});renameSync(temp,path);}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
function publicRecord(record){const {root,ownerPid,...value}=record;return value;}
export function validateFalWorkflowRecord(value){
 assertSafeJson(value);
 const allowed=new Set(['schema','kind','id','ownerPid','provider','connection','model','schemaSha256','inputHash','inputAssets','outputs','status','remote','createdAt','error','finishedAt','remoteCancel','result','warnings','resultSha256','uploads','credentialFingerprint','captureRemoteOutputs','remoteLinks','remoteInputRefs']);
 if(!value||Object.keys(value).some(key=>!allowed.has(key)))throw new SafetyError('fal 工作流记录包含未知字段',409);
 if(!value||value.schema!==1||value.kind!=='fal-workflow'||!ID.test(value.id||'')||typeof value.provider!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(value.provider)||typeof value.connection!=='string'||value.connection.length>500||typeof value.model!=='string'||value.model.length>250||!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){1,7}$/.test(value.model)||!HASH.test(value.inputHash||'')||!HASH.test(value.schemaSha256||'')||!Array.isArray(value.inputAssets)||value.inputAssets.length>8||!Array.isArray(value.outputs)||value.outputs.length>8||!['queued','running','ready','failed','cancelled','interrupted'].includes(value.status)||value.warnings!==undefined&&!Array.isArray(value.warnings)||typeof value.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)||value.finishedAt!==undefined&&(typeof value.finishedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.finishedAt)))throw new SafetyError('fal 工作流记录身份无效',409);
 let route;try{route=JSON.parse(value.connection);}catch{throw new SafetyError('fal 工作流连接记录无效',409);}
 if(!Array.isArray(route)||route.length!==3||route[0]!=='fal'||route[1]!=='https://api.fal.ai/v1'||typeof route[2]!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(route[2]))throw new SafetyError('fal 工作流连接记录无效',409);
 for(const row of [...value.inputAssets,...value.outputs]){
  if(!row||typeof row.asset!=='string'||!Number.isSafeInteger(row.bytes)||row.bytes<1||row.bytes>64*1024*1024||!HASH.test(row.sha256||'')||typeof row.pointer!=='string'||row.pointer.length>1000)throw new SafetyError('fal 工作流素材记录无效',409);
  if(Object.keys(row).some(key=>!['pointer','asset','bytes','sha256','mime','detectedMime','reportedMime'].includes(key)))throw new SafetyError('fal 工作流素材记录包含未知字段',409);
  for(const key of ['mime','detectedMime','reportedMime'])if(row[key]!=null&&(typeof row[key]!=='string'||!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(row[key])))throw new SafetyError('fal 工作流素材类型无效',409);
  assertPortableName(row.asset);
 }
 if(Object.keys(value.remote||{}).some(key=>!['state','requestId','status','queuePosition'].includes(key))||value.remoteCancel&&Object.keys(value.remoteCancel).some(key=>!['state','detail','at'].includes(key)))throw new SafetyError('fal 远端记录包含未知字段',409);
 if(value.remote?.status!==undefined&&!['IN_QUEUE','IN_PROGRESS','COMPLETED'].includes(value.remote.status)||value.remote?.queuePosition!=null&&(!Number.isSafeInteger(value.remote.queuePosition)||value.remote.queuePosition<0)||value.remoteCancel&&!['removed_from_queue','cancellation_requested','already_completed','not_found'].includes(value.remoteCancel.state))throw new SafetyError('fal 远端状态记录无效',409);
 if(!value.remote||!['not_submitted','submitted_or_uncertain','accepted','response_received'].includes(value.remote.state)||['accepted','response_received'].includes(value.remote.state)&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.remote.requestId||''))throw new SafetyError('fal 远端任务记录无效',409);
 validateFalStorageUploads(value);
 validateFalRemoteArtifacts(value);
 if(value.status==='ready'&&(value.remote.state!=='response_received'||value.result===undefined))throw new SafetyError('fal 完成记录缺少真实结果',409);
 if(value.result!==undefined){
  if(!HASH.test(value.resultSha256||'')||sha(Buffer.from(canonical(value.result)))!==value.resultSha256)throw new SafetyError('fal 结果摘要不一致',409);
  let count=0;const sensitive=/(?:[a-z][a-z0-9+.-]*:\/\/|^data:|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i;const inspect=(item,depth)=>{if(++count>100000||depth>40)throw new SafetyError('fal 结果超过结构预算',413);if(typeof item==='string'){if(sensitive.test(item))throw new SafetyError('fal 结果包含未隐藏的链接或凭据',409);}else if(Array.isArray(item))for(const child of item)inspect(child,depth+1);else if(item&&typeof item==='object')for(const [key,child]of Object.entries(item)){if(sensitive.test(key)||unsafeKey(key)&&child!=='[已隐藏]')throw new SafetyError('fal 结果包含未隐藏的凭据字段',409);inspect(child,depth+1);}};inspect(value.result,0);
 }else if(value.resultSha256!==undefined)throw new SafetyError('fal 结果摘要缺少对应内容',409);
 for(const text of [value.error,value.remoteCancel?.detail,...(Array.isArray(value.warnings)?value.warnings:[])])if(text!==undefined&&(typeof text!=='string'||/(?:[a-z][a-z0-9+.-]*:\/\/|^data:|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(text)))throw new SafetyError('fal 工作流记录包含未隐藏的链接或凭据',409);
 return value;
}
function acquire(root,id){
 if(!ID.test(id||''))throw new SafetyError('fal 工作流任务 ID 无效',422);
 const folder=dir(root),token=randomUUID(),prefix='resume-'+id+'-',name=prefix+token+'.json',path=join(folder,name),body=JSON.stringify({pid:process.pid,token,id});
 if(!atomicCreate(path,body))throw new SafetyError('fal 恢复记录冲突',409);
 const release=()=>{try{const info=lstatSync(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<4096&&readFileSync(path,'utf8')===body)unlinkSync(path);}catch{}};
 try{const names=readdirSync(folder).filter(item=>item.startsWith(prefix)&&item.endsWith('.json'));if(names.length>200)throw new SafetyError('fal 恢复记录超过预算',413);for(const item of names){if(item===name)continue;const peer=join(folder,item),info=lstatSync(peer);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('fal 恢复记录需要核对',409);const value=JSON.parse(readFileSync(peer,'utf8'));if(value.id!==id||!Number.isSafeInteger(value.pid))throw new SafetyError('fal 恢复记录无效',409);if(alive(value.pid))throw new SafetyError('该 fal 任务正在另一恢复流程中',423);}return release;}catch(error){release();throw error;}
}
async function readMedia(url,signal){
 if(typeof url!=='string')throw new SafetyError('fal 媒体地址无效',502);
 if(url.startsWith('data:')){
  const match=/^data:([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);if(!match||match[2].length>90*1024*1024)throw new SafetyError('fal 内嵌媒体格式无效',502);return {bytes:Buffer.from(match[2],'base64'),reportedMime:match[1].toLowerCase()};
 }
 let parsed;try{parsed=new URL(url);}catch{throw new SafetyError('fal 媒体地址无效',502);}
 const host=parsed.hostname.toLowerCase(),safe=host==='fal.media'||host.endsWith('.fal.media')||host==='storage.googleapis.com'&&parsed.pathname.startsWith('/falserverless/');
 if(parsed.protocol!=='https:'||!safe||parsed.port||parsed.username||parsed.password||parsed.hash)throw new SafetyError('fal 输出媒体来源不在允许范围',422);
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
 try{
  const response=await fetch(parsed.href,{signal:controller.signal,redirect:'error'});if(!response.ok||!response.body)throw new SafetyError('fal 输出媒体不可读取',502);if(Number(response.headers.get('content-length'))>64*1024*1024){await response.body.cancel();throw new SafetyError('fal 输出媒体超过预算',413);}
  const reader=response.body.getReader(),chunks=[];let size=0;while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>64*1024*1024){await reader.cancel();throw new SafetyError('fal 输出媒体超过预算',413);}chunks.push(Buffer.from(item.value));}
  const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();return {bytes:Buffer.concat(chunks,size),reportedMime:/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)?mime:null};
 }catch(error){if(signal?.aborted)throw new SafetyError('已停止下载 fal 工作流结果',499);if(error instanceof SafetyError)throw error;throw new SafetyError('fal 媒体下载失败',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export class FalWorkflows{
 constructor(ctx,providers){this.ctx=ctx;this.providers=providers;this.running=new Map();this.closed=false;}
 async connection(provider,expected){
  const route=await this.providers.route(provider||'fal');if(route.protocol!=='fal'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(route.id)||expected&&identity(route)!==expected)throw new SafetyError('fal 连接不存在或已改变',409);
  const key=(await this.ctx.get?.('credentials')?.resolve?.(route.ref))?.value;if(typeof key!=='string'||!key.trim())throw new SafetyError('DSH fal 凭据不可用',503);return {provider:route.id,connection:identity(route),key};
 }
 load(root,id){
  root=store.validateRoot(root);const path=fileFor(root,id),running=this.running.get(root+'|'+id);if(running)return running.record;
  if(!existsSync(path))throw new SafetyError('fal 工作流任务不存在',404);if(statSync(path).size>2*1024*1024)throw new SafetyError('fal 工作流记录超过预算',413);
  const value=JSON.parse(readFileSync(path,'utf8'));validateFalWorkflowRecord(value);if(value.id!==id)throw new SafetyError('fal 工作流记录无效',409);
  const record={...value,root};if(['queued','running'].includes(record.status)&&!alive(record.ownerPid)){record.status='interrupted';record.error='本地进程中断；未自动重复提交。';save(record);}return record;
 }
 list(root){root=store.validateRoot(root);const names=readdirSync(dir(root)).filter(name=>/^faljob-[a-f0-9]{64}\.json$/.test(name));if(names.length>2000)throw new SafetyError('fal 工作流任务超过列表预算',413);return names.map(name=>publicRecord(this.load(root,name.slice(0,-5)))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,200);}
 get(root,id){return publicRecord(this.load(root,id));}
 pending(root,id){
  root=store.validateRoot(root);const base=this.load(root,id),folder=dir(root),pattern=new RegExp('^'+id+'\\.json\\.tmp-[a-f0-9-]{36}$'),names=readdirSync(folder).filter(name=>pattern.test(name));
  if(names.length>128)throw new SafetyError('fal 未发布记录超过预算',413);
  return names.map(name=>{try{
   const path=join(folder,name),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)throw new Error('文件类型或大小无效');
   const bytes=readFileSync(path),item=JSON.parse(bytes.toString('utf8'));validateFalWorkflowRecord(item);
   if(item.schema!==1||item.kind!=='fal-workflow'||item.id!==id||item.inputHash!==base.inputHash||item.provider!==base.provider||item.model!==base.model||item.connection!==base.connection||item.schemaSha256!==base.schemaSha256||canonical(item.inputAssets)!==canonical(base.inputAssets)||item.credentialFingerprint!==base.credentialFingerprint||item.captureRemoteOutputs!==base.captureRemoteOutputs||canonical(item.remoteInputRefs||[])!==canonical(base.remoteInputRefs||[])||canonical((item.uploads||[]).map(({pointer,asset,bytes,sha256,mime})=>({pointer,asset,bytes,sha256,mime})))!==canonical((base.uploads||[]).map(({pointer,asset,bytes,sha256,mime})=>({pointer,asset,bytes,sha256,mime}))))throw new Error('身份不一致');
   return {name,sha256:sha(bytes),bytes:bytes.length,valid:true,status:item.status,remoteState:item.remote?.state||null,requestId:item.remote?.requestId||null,outputs:Array.isArray(item.outputs)?item.outputs.length:0};
  }catch(error){return {name,valid:false,error:String(error.message||error).slice(0,180)};}});
 }
 restorePending(root,id,name,expectedSha){
  root=store.validateRoot(root);if(this.running.has(root+'|'+id))throw new SafetyError('fal 工作流仍在本地运行',409);
  const release=acquire(root,id);try{
   const current=this.load(root,id);if(['running','queued'].includes(current.status)&&alive(current.ownerPid))throw new SafetyError('fal 工作流仍在其他进程运行',423);
   const options=this.pending(root,id),row=options.find(item=>item.name===name&&item.valid&&item.sha256===expectedSha);if(!row)throw new SafetyError('未发布 fal 记录不存在或已经改变',409);
   const ids=new Set(options.filter(item=>item.valid&&item.requestId).map(item=>item.requestId));if(current.remote?.requestId)ids.add(current.remote.requestId);if(ids.size>1)throw new SafetyError('发现多个不同远端任务 ID，保留原记录并先逐项核对',409);
   const path=join(dir(root),name),raw=readFileSync(path);if(sha(raw)!==expectedSha)throw new SafetyError('未发布 fal 记录在核对时改变',409);
   const item=JSON.parse(raw.toString('utf8'));if(!['accepted','response_received'].includes(item.remote?.state)||!item.remote?.requestId||!Array.isArray(item.outputs))throw new SafetyError('未发布 fal 记录没有可恢复的远端任务',409);
   for(const output of item.outputs){const bytes=typeof output.asset==='string'&&store.readAsset(root,output.asset);if(!bytes||bytes.length!==output.bytes||sha(bytes)!==output.sha256)throw new SafetyError('未发布 fal 记录引用的输出素材缺失或改变',409);}
   for(const upload of item.uploads||[]){const bytes=store.readAsset(root,upload.asset);if(!bytes||bytes.length!==upload.bytes||sha(bytes)!==upload.sha256)throw new SafetyError('未发布 fal 记录引用的上传原件缺失或改变',409);if(upload.secretAsset)falStorageSecretAsset(root,upload);}
   for(const link of item.remoteLinks||[])falRemoteSecretAsset(root,link);
   if(current.outputs.some(old=>!item.outputs.some(output=>output.asset===old.asset&&output.sha256===old.sha256))||current.resultSha256&&current.resultSha256!==item.resultSha256)throw new SafetyError('未发布记录不包含当前已保存结果，未覆盖',409);
   if((current.uploads||[]).some(old=>old.state==='accepted'&&!(item.uploads||[]).some(upload=>upload.pointer===old.pointer&&upload.state==='accepted'&&upload.secretSha256===old.secretSha256)))throw new SafetyError('未发布记录缺少已确认的 fal 存储回执，未覆盖',409);
   if((current.remoteLinks||[]).some(old=>!(item.remoteLinks||[]).some(link=>link.pointer===old.pointer&&link.secretSha256===old.secretSha256)))throw new SafetyError('未发布记录缺少已捕获的 fal 输出引用，未覆盖',409);
   if(item.resultSha256&&(!HASH.test(item.resultSha256)||sha(Buffer.from(canonical(item.result)))!==item.resultSha256))throw new SafetyError('未发布 fal 结果摘要不一致',409);
   const originalPath=fileFor(root,id),original=readFileSync(originalPath),backup=join(dir(root),id+'.preserved-'+sha(original)+'.json');
   if(!atomicCreate(backup,original)&&!readFileSync(backup).equals(original))throw new SafetyError('fal 原记录备份冲突，未覆盖',409);
   if(!readFileSync(originalPath).equals(original))throw new SafetyError('fal 原记录在恢复期间改变，未覆盖',409);
   const restored={...item,root,ownerPid:process.pid,status:item.status==='ready'&&item.resultSha256?'ready':'interrupted'};if(restored.status==='interrupted')restored.error='已恢复未发布的远端任务记录；请取回同一个任务。';save(restored);
   return {job:publicRecord(restored),preservedOriginal:backup.slice(root.length).replace(/^[\\/]/,''),retainedCandidate:name};
  }finally{release();}
 }
 async search(provider,options,signal){const connection=await this.connection(provider);return falSearch(connection.key,options,signal);}
 async inspect(provider,model,signal){
  const connection=await this.connection(provider),found=await falWorkflowSpec(connection.key,model,signal),spec=found.spec,schemas=spec.components?.schemas||{},inputSchema=spec.paths['/'+model].post.requestBody.content['application/json'].schema,outputSchema=spec.paths?.['/'+model+'/requests/{request_id}']?.get?.responses?.['200']?.content?.['application/json']?.schema||null;
  const result={provider:connection.provider,model,name:found.name,category:found.category,schemaSha256:schemaHash(spec),inputSchema,outputSchema,schemas};if(Buffer.byteLength(JSON.stringify(result))>2*1024*1024)throw new SafetyError('fal 模型接口描述超过读取预算',413);return result;
 }
 async start(root,{provider,model,schemaSha256,input,assetRefs=[],storageAssetRefs=[],remoteOutputRefs=[],captureRemoteOutputs=false,allowPublicUpload=false,operationId},signal,assertCurrent){
  root=store.validateRoot(root);if(this.closed)throw new SafetyError('fal 工作流服务已停止',503);if(typeof operationId!=='string'||!HASH.test(operationId)||!HASH.test(schemaSha256||'')||!input||typeof input!=='object'||Array.isArray(input))throw new SafetyError('fal 工作流参数无效',422);
  assertSafeJson(input);assertSafeJson(assetRefs);assertSafeJson(storageAssetRefs);assertSafeJson(remoteOutputRefs);if(!Array.isArray(storageAssetRefs)||storageAssetRefs.length&&allowPublicUpload!==true)throw new SafetyError('向 fal 存储上传素材需要明确同意远端文件可能被持有链接者访问',422);if(!Array.isArray(remoteOutputRefs)||typeof captureRemoteOutputs!=='boolean')throw new SafetyError('fal 远端引用参数无效',422);if(Buffer.byteLength(JSON.stringify(input))>256*1024)throw new SafetyError('fal 工作流输入超过预算',413);inspectInput(input);
  const connection=await this.connection(provider),found=await falWorkflowSpec(connection.key,model,signal),actual=schemaHash(found.spec);if(actual!==schemaSha256)throw new SafetyError('fal 模型接口已改变，请重新检查后再提交',409);
  const id='faljob-'+operationId,path=fileFor(root,id),bound=bindAssets(root,input,assetRefs),used=new Set(bound.assets.map(row=>row.pointer)),storage=prepareFalStorageAssets(root,bound.input,storageAssetRefs,used,mimeOf),assets=[...bound.assets,...storage.assets],remoteInputs=await bindFalRemoteOutputs(root,bound.input,remoteOutputRefs,used,id,connection,connection.key,(base,jobId)=>this.load(base,jobId),signal),definition=found.spec.paths['/'+model].post.requestBody.content['application/json'].schema;validateInput(found.spec,definition,bound.input);
  const inputHash=sha(Buffer.from(canonical({model,schemaSha256,input,assets,...(storage.uploads.length?{storagePointers:storage.uploads.map(row=>row.pointer)}:{}),...(remoteInputs.length?{remoteInputRefs:remoteInputs}:{}),...(captureRemoteOutputs?{captureRemoteOutputs:true}:{})})));
  if(existsSync(path)){const prior=this.load(root,id);if(prior.inputHash!==inputHash||prior.provider!==connection.provider||prior.connection!==connection.connection||prior.model!==model)throw new SafetyError('fal 操作身份已用于其他请求，未重复提交',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  if(captureRemoteOutputs){try{await privateLinkProtectorPreflight(signal);}catch(error){if(signal?.aborted)throw error;throw new SafetyError('当前用户无法安全保护 fal 输出引用，未提交模型任务',503);}}
  const record={schema:1,kind:'fal-workflow',id,root,ownerPid:process.pid,provider:connection.provider,connection:connection.connection,model,schemaSha256,inputHash,inputAssets:assets,...(storage.uploads.length?{uploads:storage.uploads}:{}),...(storage.uploads.length||captureRemoteOutputs?{credentialFingerprint:falCredentialFingerprint(id,connection.key)}:{}),...(captureRemoteOutputs?{captureRemoteOutputs:true,remoteLinks:[]}:{}),...(remoteInputs.length?{remoteInputRefs:remoteInputs}:{}),outputs:[],status:'queued',remote:{state:'not_submitted'},createdAt:new Date().toISOString()};
  signal?.throwIfAborted();assertCurrent?.();const {root:unused,...persisted}=record;validateFalWorkflowRecord(persisted);if(!atomicCreate(path,JSON.stringify(persisted,null,2))){const prior=this.load(root,id);if(prior.inputHash!==inputHash||prior.provider!==record.provider||prior.connection!==record.connection||prior.model!==model)throw new SafetyError('fal 操作身份冲突，未重复提交',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  const controller=new AbortController(),key=root+'|'+id;this.running.set(key,{record,controller});
  queueMicrotask(()=>this.submit(record,bound.input,connection.key,controller,undefined,assertCurrent).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async resumeStorage(root,{id,input,assetRefs=[],storageAssetRefs=[],remoteOutputRefs=[],allowPublicUpload=false},signal,assertCurrent){
  root=store.validateRoot(root);if(this.closed)throw new SafetyError('fal 工作流服务已停止',503);if(this.running.has(root+'|'+id))throw new SafetyError('fal 工作流仍在本地运行',409);
  if(!input||typeof input!=='object'||Array.isArray(input)||!Array.isArray(storageAssetRefs)||!storageAssetRefs.length||allowPublicUpload!==true)throw new SafetyError('继续上传需要原输入、素材引用和明确的远端存储同意',422);
  assertSafeJson(input);assertSafeJson(assetRefs);assertSafeJson(storageAssetRefs);assertSafeJson(remoteOutputRefs);if(!Array.isArray(remoteOutputRefs))throw new SafetyError('fal 远端引用参数无效',422);if(Buffer.byteLength(JSON.stringify(input))>256*1024)throw new SafetyError('fal 工作流输入超过预算',413);inspectInput(input);
  const release=acquire(root,id);let controller;
  try{
   const record=this.load(root,id);if(['queued','running'].includes(record.status)&&alive(record.ownerPid))throw new SafetyError('fal 工作流仍在其他进程运行',423);
   if(record.remote.state!=='not_submitted'||!record.uploads?.length||record.uploads.some(row=>!['not_sent','accepted'].includes(row.state)))throw new SafetyError('该任务的上传或模型提交状态未确认，不能自动续接',409);
   const connection=await this.connection(record.provider,record.connection);if(record.credentialFingerprint!==falCredentialFingerprint(id,connection.key))throw new SafetyError('fal 凭据已改变，未继续任务',409);
   const found=await falWorkflowSpec(connection.key,record.model,signal);if(schemaHash(found.spec)!==record.schemaSha256)throw new SafetyError('fal 模型 schema 已改变，未继续任务',409);
   const bound=bindAssets(root,input,assetRefs),used=new Set(bound.assets.map(row=>row.pointer)),storage=prepareFalStorageAssets(root,bound.input,storageAssetRefs,used,mimeOf),assets=[...bound.assets,...storage.assets],remoteInputs=await bindFalRemoteOutputs(root,bound.input,remoteOutputRefs,used,id,connection,connection.key,(base,jobId)=>this.load(base,jobId),signal),inputHash=sha(Buffer.from(canonical({model:record.model,schemaSha256:record.schemaSha256,input,assets,storagePointers:storage.uploads.map(row=>row.pointer),...(remoteInputs.length?{remoteInputRefs:remoteInputs}:{}),...(record.captureRemoteOutputs?{captureRemoteOutputs:true}:{})})));
   if(inputHash!==record.inputHash||canonical(assets)!==canonical(record.inputAssets)||canonical(storage.uploads.map(({pointer,asset,bytes,sha256,mime})=>({pointer,asset,bytes,sha256,mime})))!==canonical(record.uploads.map(({pointer,asset,bytes,sha256,mime})=>({pointer,asset,bytes,sha256,mime}))))throw new SafetyError('续接输入或素材与原任务不一致，未发送',409);
   validateInput(found.spec,found.spec.paths['/'+record.model].post.requestBody.content['application/json'].schema,bound.input);signal?.throwIfAborted();assertCurrent?.();record.ownerPid=process.pid;record.status='running';delete record.error;delete record.finishedAt;save(record);
   controller=new AbortController();this.running.set(root+'|'+id,{record,controller});queueMicrotask(()=>this.submit(record,bound.input,connection.key,controller,release,assertCurrent).catch(()=>{}));return {accepted:true,job:publicRecord(record),note:'仅续接已确认或尚未发送的素材；未确认上传不会自动重发。'};
  }catch(error){release();throw error;}
 }
 async submit(record,input,key,controller,release,assertCurrent){
  try{
   record.status='running';save(record);
   if(record.uploads?.length){await bindFalStorageUploads(record,key,input,controller.signal,save,assertCurrent);const found=await falWorkflowSpec(key,record.model,controller.signal);if(schemaHash(found.spec)!==record.schemaSha256)throw new SafetyError('fal 模型 schema 已改变，未发送模型任务；已上传素材保留',409);validateInput(found.spec,found.spec.paths['/'+record.model].post.requestBody.content['application/json'].schema,input);controller.signal.throwIfAborted();}
   const onDispatch=()=>{assertCurrent?.();record.remote={state:'submitted_or_uncertain'};save(record);},onAccepted=details=>{record.remote={state:'accepted',requestId:details.requestId};save(record);};
   await falSubmitWorkflow(key,{model:record.model,input,onDispatch,onAccepted},controller.signal);await this.collect(record,key,controller.signal);
  }catch(error){record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted?'本地已停止等待；远端任务可能仍在处理或计费。':String(error.message||error).slice(0,800);record.finishedAt=new Date().toISOString();save(record);}
  finally{this.running.delete(record.root+'|'+record.id);release?.();}
 }
 async collect(record,key,signal){
  const deadline=Date.now()+15*60*1000;let previous='';
  while(Date.now()<deadline){
   signal?.throwIfAborted();const state=await falWorkflowStatus(key,{model:record.model,requestId:record.remote.requestId},signal);
   const observed=state.status+'|'+String(state.queuePosition);if(observed!==previous){record.remote={...record.remote,status:state.status,queuePosition:state.queuePosition};save(record);previous=observed;}
   if(state.status==='COMPLETED'){
    if(state.failed)throw new SafetyError('fal 报告此工作流失败，请核对服务端任务记录',502);
    const output=await falWorkflowResult(key,{model:record.model,requestId:record.remote.requestId},signal);await this.materialize(record,output,signal,key);
    record.status='ready';record.remote={...record.remote,state:'response_received'};record.finishedAt=new Date().toISOString();delete record.error;save(record);return;
   }
   try{await delay(2500,undefined,{signal});}catch{throw new SafetyError('已停止本地等待；fal 工作流可能仍在运行',499);}
  }
  throw new SafetyError('fal 工作流等待超时，可使用已有任务 ID 取回',504);
 }
 async materialize(record,result,signal,key){
  let count=0,total=0,nodes=0;const previous=record.outputs.slice(),outputs=[],warnings=[];if(new Set(previous.map(item=>item.pointer)).size!==previous.length)throw new SafetyError('fal 已保存输出指针不唯一，未覆盖',409);
  const keep=entry=>{if(outputs.some(item=>item.pointer===entry.pointer))throw new SafetyError('fal 输出指针重复，未覆盖',409);const next=[...outputs,entry],merged=[...next,...previous.filter(old=>!next.some(item=>item.pointer===old.pointer))];if(merged.length>8)throw new SafetyError('fal 保留输出超过预算，未覆盖',413);outputs.push(entry);record.outputs=merged;save(record);return {projectAsset:entry.asset,sha256:entry.sha256,bytes:entry.bytes,detectedMime:entry.detectedMime,reportedMime:entry.reportedMime};};
  const retained=path=>{const old=previous.find(item=>item.pointer===path);if(!old)return null;const bytes=store.readAsset(record.root,old.asset);if(!bytes||bytes.length!==old.bytes||sha(bytes)!==old.sha256)throw new SafetyError('fal 已保存输出缺失或改变，未覆盖原记录',409);return keep(old);};
  const walk=async(value,path,depth)=>{
   if(++nodes>100000||depth>40)throw new SafetyError('fal 结果结构超过预算',413);
   if(typeof value==='string'){
    if(value.startsWith('data:')||/^https:\/\//i.test(value)){
     let isMedia=value.startsWith('data:');if(!isMedia){try{const url=new URL(value),host=url.hostname.toLowerCase();isMedia=url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&(host==='fal.media'||host.endsWith('.fal.media')||host==='storage.googleapis.com'&&url.pathname.startsWith('/falserverless/'));}catch{}}
     if(!isMedia){warnings.push('结果包含未自动访问的外部链接，地址未写入项目。');return {externalUrl:'未保存'};}
     if(++count>8)throw new SafetyError('fal 输出媒体数量超过预算，已保存的素材保留',413);
     const link=record.captureRemoteOutputs&&!value.startsWith('data:')?await captureFalRemoteOutput(record.root,record,path,value,signal,save,key):null;let media;
     try{media=await readMedia(value,signal);}catch(error){if(signal?.aborted||!link)throw error;const old=retained(path);if(old)return old;warnings.push('部分服务输出仅保留加密远端引用，文件未下载或未核对。');return {remoteOutputPointer:path,state:'remote-reference-only'};}
     if(!media.bytes.length||total+media.bytes.length>128*1024*1024){if(link){const old=retained(path);if(old)return old;warnings.push('部分服务输出仅保留加密远端引用，文件未下载或未核对。');return {remoteOutputPointer:path,state:'remote-reference-only'};}throw new SafetyError('fal 输出媒体为空或超过总预算',413);}total+=media.bytes.length;
     const [detected,ext]=mimeOf(media.bytes),digest=sha(media.bytes),old=previous.find(item=>item.pointer===path);if(old&&(old.sha256!==digest||old.bytes!==media.bytes.length))throw new SafetyError('fal 相同输出指针的文件已改变，未覆盖原记录',409);
     const asset=store.saveAsset(record.root,old?old.asset:'fal-'+record.id.slice(7,19)+'-'+count+'-'+digest.slice(0,12)+ext,media.bytes);if(old&&asset.name!==old.asset)throw new SafetyError('fal 原输出路径发生冲突，未覆盖',409);const entry=old||{pointer:path,asset:asset.name,bytes:media.bytes.length,sha256:digest,detectedMime:detected,reportedMime:media.reportedMime};return keep(entry);
    }
    let text=value;if(text.length>50000){text=text.slice(0,50000);warnings.push('部分结果文本超过预算，已截断。');}
    const sanitized=text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"<>]+/gi,'[链接已隐藏]').replace(/(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,}/gi,'[已隐藏]');if(sanitized!==text)warnings.push('结果文本中的链接或疑似凭据已隐藏。');return sanitized;
   }
   if(value===null||typeof value==='boolean'||typeof value==='number')return value;
   if(Array.isArray(value)){const array=[];for(let i=0;i<value.length;i++)array.push(await walk(value[i],path+'/'+i,depth+1));return array;}
   if(value&&typeof value==='object'){const object={};for(const [key,child]of Object.entries(value)){if(['__proto__','prototype','constructor'].includes(key)||/(?:[a-z][a-z0-9+.-]*:\/\/|^data:|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(key))throw new SafetyError('fal 结果包含不安全字段',422);if(unsafeKey(key)){object[key]='[已隐藏]';warnings.push('结果中的疑似凭据字段已隐藏。');}else object[key]=await walk(child,path+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),depth+1);}return object;}
   throw new SafetyError('fal 结果包含不支持的数据',422);
  };
  const sanitized=await walk(result,'',0);if(Buffer.byteLength(JSON.stringify(sanitized))>1024*1024)throw new SafetyError('fal 结果文本超过预算，已保存的媒体保留',413);if(previous.some(old=>!outputs.some(item=>item.pointer===old.pointer)))throw new SafetyError('fal 返回结果缺少已有输出，未覆盖原记录',409);const resultSha256=sha(Buffer.from(canonical(sanitized)));if(record.resultSha256&&record.resultSha256!==resultSha256)throw new SafetyError('fal 结果与已保存摘要不一致，未覆盖原记录',409);
  record.outputs=outputs;record.result=sanitized;record.warnings=[...new Set(warnings)];record.resultSha256=resultSha256;save(record);
 }
 recover(root,id){
  root=store.validateRoot(root);if(this.closed)throw new SafetyError('fal 工作流服务已停止',503);if(this.running.has(root+'|'+id))throw new SafetyError('fal 工作流仍在本地运行',409);
  const release=acquire(root,id);let record,controller;
  try{record=this.load(root,id);if(record.status==='ready')for(const link of record.remoteLinks||[])falRemoteSecretAsset(root,link);if(record.status==='ready'&&record.outputs.every(item=>{try{const bytes=store.readAsset(root,item.asset);return bytes&&bytes.length===item.bytes&&sha(bytes)===item.sha256;}catch{return false;}})){release();return {accepted:true,reused:true,job:publicRecord(record)};}if(['running','queued'].includes(record.status)&&alive(record.ownerPid))throw new SafetyError('fal 工作流仍在其他进程运行',423);if(!['accepted','response_received'].includes(record.remote?.state)||!record.remote.requestId||record.remoteCancel?.state==='removed_from_queue')throw new SafetyError('没有可取回的 fal 任务 ID',409);record.ownerPid=process.pid;record.status='running';delete record.error;save(record);controller=new AbortController();this.running.set(root+'|'+id,{record,controller});}
  catch(error){release();throw error;}
  queueMicrotask(()=>this.resume(record,controller,release).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async resume(record,controller,release){
  try{const connection=await this.connection(record.provider,record.connection);if(record.credentialFingerprint&&record.credentialFingerprint!==falCredentialFingerprint(record.id,connection.key))throw new SafetyError('fal 凭据已改变，未取回任务',409);if(record.captureRemoteOutputs)await privateLinkProtectorPreflight(controller.signal);await this.collect(record,connection.key,controller.signal);}
  catch(error){record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted?'本地已停止等待；fal 工作流可能仍在处理或计费。':String(error.message||error).slice(0,800);record.finishedAt=new Date().toISOString();save(record);}
  finally{this.running.delete(record.root+'|'+record.id);release();}
 }
 stop(root,id){root=store.validateRoot(root);const running=this.running.get(root+'|'+id);if(!running)return false;running.controller.abort();return true;}
 async cancelRemote(root,id,signal){
  root=store.validateRoot(root);if(this.running.has(root+'|'+id))throw new SafetyError('请先停止本地等待，再请求远端取消',409);
  const release=acquire(root,id);try{const record=this.load(root,id);if(['running','queued'].includes(record.status)&&alive(record.ownerPid))throw new SafetyError('fal 工作流仍在其他进程运行',423);if(record.remote?.state!=='accepted'||!record.remote.requestId)throw new SafetyError('没有可取消的 fal 任务 ID',409);const connection=await this.connection(record.provider,record.connection),result=await falCancel(connection.key,{model:record.model,requestId:record.remote.requestId},signal);record.remoteCancel={...result,at:new Date().toISOString()};save(record);return {remoteCancel:record.remoteCancel,job:publicRecord(record)};}finally{release();}
 }
 dispose(){this.closed=true;for(const item of this.running.values())item.controller.abort();}
}
export {canonical as canonicalModelData,validateInput as validateModelInput,inspectInput as inspectModelInput,bindAssets as bindModelAssets,mimeOf as detectModelMedia};
