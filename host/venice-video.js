/** Venice video jobs; private one-time links are protected with current-user DPAPI. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {SafetyError,assertSafeJson,assertPortableName,workspacePath} from './safety.js';
import {veniceMediaRequest,stableVeniceData} from './venice-audio.js';
import {privateLinkProtectorAvailable,privateLinkProtectorPreflight,transformPrivateLink} from './private-link-protector.js';

const ID=/^venicevideo-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
function folder(root){const path=workspacePath(root,'design/.designcraft/venice-video');mkdirSync(path,{recursive:true});return path;}
function privateFolder(root){const path=workspacePath(root,'design/.designcraft/venice-video-private');mkdirSync(path,{recursive:true});return path;}
function file(root,id){if(!ID.test(id||''))throw new SafetyError('Venice 视频任务身份无效',422);return workspacePath(root,join(folder(root),id+'.json'));}
function privateFile(root,id,queueId){if(!ID.test(id||'')||!UUID.test(queueId||''))throw new SafetyError('Venice 私有链接身份无效',422);return workspacePath(root,join(privateFolder(root),id+'-'+queueId+'.dpapi'));}
function save(record){const path=file(record.root,record.id),temp=path+'.tmp-'+randomUUID(),{root,...data}=record;validateVeniceVideoRecord(data);const raw=JSON.stringify(data,null,2);if(Buffer.byteLength(raw)>256*1024)throw new SafetyError('Venice 视频任务记录超过预算',413);writeFileSync(temp,raw,{flag:'wx'});renameSync(temp,path);}
function publicRecord(record){const {root,ownerPid,...result}=record;return result;}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
function acquire(root,id){
 if(!ID.test(id||''))throw new SafetyError('Venice 视频任务身份无效',422);const dir=folder(root),token=randomUUID(),prefix='resume-'+id+'-',name=prefix+token+'.json',path=join(dir,name),body=JSON.stringify({pid:process.pid,id,token});
 if(!atomicCreate(path,body))throw new SafetyError('Venice 视频恢复记录冲突',409);
 const release=()=>{try{const info=lstatSync(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<4096&&readFileSync(path,'utf8')===body)unlinkSync(path);}catch{}};
 try{const peers=readdirSync(dir).filter(item=>item.startsWith(prefix)&&item.endsWith('.json'));if(peers.length>200)throw new SafetyError('Venice 视频恢复记录超过预算',413);for(const peer of peers){if(peer===name)continue;const target=join(dir,peer),info=lstatSync(target);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('Venice 视频恢复记录需要核对',409);const value=JSON.parse(readFileSync(target,'utf8'));if(value.id!==id||!Number.isSafeInteger(value.pid))throw new SafetyError('Venice 视频恢复记录无效',409);if(alive(value.pid))throw new SafetyError('该 Venice 视频任务正在另一流程中',423);}return release;}catch(error){release();throw error;}
}
function checkedPrivateUrl(value){
 if(typeof value!=='string'||value.length>12000)throw new SafetyError('Venice 私有下载链接无效',502);let url;try{url=new URL(value);}catch{throw new SafetyError('Venice 私有下载链接无效',502);}
 if(url.protocol!=='https:'||url.hostname!=='private-share.venice.ai'||url.port||url.username||url.password||url.hash||!url.pathname.startsWith('/v1/share/read/'))throw new SafetyError('Venice 私有下载链接来源不受支持',502);return url.href;
}
const context=(id,queueId)=>sha(Buffer.from(id+'\0'+queueId));
async function protectLink(root,id,queueId,url){
 const path=privateFile(root,id,queueId),bytes=Buffer.from(checkedPrivateUrl(url),'utf8');let encrypted;try{encrypted=await transformPrivateLink('protect',context(id,queueId),bytes);}finally{bytes.fill(0);}
 if(!atomicCreate(path,encrypted)){
  const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('Venice 私有链接记录异常，未覆盖',409);
  const prior=readFileSync(path),plain=await transformPrivateLink('unprotect',context(id,queueId),prior);const same=plain.toString('utf8')===url;plain.fill(0);if(!same)throw new SafetyError('Venice 私有链接记录冲突，未覆盖',409);return sha(prior);
 }
 return sha(encrypted);
}
async function readLink(root,id,queueId,expected,signal){
 const path=privateFile(root,id,queueId);let info;try{info=lstatSync(path);}catch{throw new SafetyError('Venice 一次性私有链接未能保存，无法自动取回',409);}
 if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('Venice 私有链接密文无效',409);const bytes=readFileSync(path);if(expected&&sha(bytes)!==expected)throw new SafetyError('Venice 私有链接密文已改变',409);
 const plain=await transformPrivateLink('unprotect',context(id,queueId),bytes,signal);let url;try{url=checkedPrivateUrl(new TextDecoder('utf-8',{fatal:true}).decode(plain));}finally{plain.fill(0);}return {url,sha256:sha(bytes)};
}
async function downloadPrivate(url,signal){
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
 try{const response=await fetch(checkedPrivateUrl(url),{signal:controller.signal,redirect:'error'});if(!response.ok||!response.body||Number(response.headers.get('content-length'))>64*1024*1024)throw new SafetyError('Venice 私有视频不可读取或超过预算',502);const reader=response.body.getReader(),chunks=[];let size=0;while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>64*1024*1024){await reader.cancel();throw new SafetyError('Venice 视频超过 64 MiB 预算',413);}chunks.push(Buffer.from(item.value));}return {bytes:Buffer.concat(chunks,size),mime:(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()};}
 catch(error){if(signal?.aborted)throw new SafetyError('已停止下载 Venice 视频，远端结果可能仍存在',499);if(error instanceof SafetyError)throw error;throw new SafetyError('Venice 私有视频下载失败或链接已过期',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export function validateVeniceVideoRecord(value){
 assertSafeJson(value);const allowed=new Set(['schema','kind','id','ownerPid','provider','connection','model','specHash','inputHash','inputAsset','status','remote','createdAt','finishedAt','error','video','cleanup','revocation']);
 if(!value||Object.keys(value).some(key=>!allowed.has(key))||value.schema!==1||value.kind!=='venice-video'||!ID.test(value.id||'')||typeof value.provider!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(value.provider)||typeof value.model!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(value.model)||!HASH.test(value.specHash||'')||!HASH.test(value.inputHash||'')||!['queued','running','ready','failed','cancelled','interrupted'].includes(value.status)||typeof value.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)||value.finishedAt!==undefined&&(typeof value.finishedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.finishedAt)))throw new SafetyError('Venice 视频记录无效',409);
 let route;try{route=JSON.parse(value.connection);}catch{throw new SafetyError('Venice 视频连接记录无效',409);}if(!Array.isArray(route)||route.length!==3||route[0]!=='venice'||route[1]!=='https://api.venice.ai/api/v1'||typeof route[2]!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(route[2]))throw new SafetyError('Venice 视频连接记录无效',409);
 const remote=value.remote;if(!remote||!['not_submitted','submitted_or_uncertain','accepted','response_received'].includes(remote.state)||Object.keys(remote).some(key=>!['state','queueId','status','privateLink','privateLinkSaved','privateLinkSha256','modelMismatch'].includes(key))||remote.modelMismatch!==undefined&&typeof remote.modelMismatch!=='boolean'||['accepted','response_received'].includes(remote.state)&&(!UUID.test(remote.queueId||'')||typeof remote.privateLink!=='boolean')||remote.privateLinkSaved!==undefined&&typeof remote.privateLinkSaved!=='boolean'||(remote.privateLinkSaved===true||remote.privateLinkSha256!==undefined)&&remote.privateLink!==true||remote.privateLinkSha256!==undefined&&!HASH.test(remote.privateLinkSha256)||remote.status!==undefined&&!['PROCESSING','COMPLETED'].includes(remote.status))throw new SafetyError('Venice 视频远端记录无效',409);
 for(const item of [value.inputAsset,value.video].filter(Boolean)){if(typeof item.asset!=='string'||!HASH.test(item.sha256||'')||!Number.isSafeInteger(item.bytes)||item.bytes<1||item.bytes>64*1024*1024||typeof item.mime!=='string'||Object.keys(item).some(key=>!['asset','sha256','bytes','mime'].includes(key)))throw new SafetyError('Venice 视频素材记录无效',409);assertPortableName(item.asset);}
 if(value.inputAsset&&!['image/png','image/jpeg'].includes(value.inputAsset.mime)||value.video&&value.video.mime!=='video/mp4'||value.status==='ready'&&(!value.video||remote.state!=='response_received'))throw new SafetyError('Venice 视频类型或结果记录无效',409);
 for(const action of [value.cleanup,value.revocation].filter(Boolean))if(!['requested_or_uncertain','confirmed'].includes(action.state)||Object.keys(action).some(key=>!['state','at'].includes(key))||typeof action.at!=='string'||!/^\d{4}-\d\d-\d\dT/.test(action.at))throw new SafetyError('Venice 视频清理记录无效',409);
 if(value.error!==undefined&&(typeof value.error!=='string'||/(?:[a-z][a-z0-9+.-]*:\/\/|Bearer\s+\S+|sk-[A-Za-z0-9_-]{20,})/i.test(value.error)))throw new SafetyError('Venice 视频记录包含未隐藏的链接或凭据',409);return value;
}
function metadata(spec,key){for(const object of [spec,spec?.constraints,spec?.capabilities])if(object&&Object.hasOwn(object,key))return object[key];return undefined;}
function validateInput(spec,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>32000||typeof input.duration!=='string')throw new SafetyError('请输入视频提示词和时长',422);
 if(Object.keys(input).some(key=>!['prompt','duration','resolution','aspect_ratio','imageAsset'].includes(key)))throw new SafetyError('视频参数包含未接入字段',422);
 const max=metadata(spec,'prompt_character_limit')??metadata(spec,'promptCharacterLimit')??2500;if(Number.isFinite(max)&&input.prompt.length>max)throw new SafetyError('视频提示词超过模型上限',422);
 const durations=metadata(spec,'durations');if(!Array.isArray(durations)||!durations.includes(input.duration))throw new SafetyError('模型未声明所选视频时长',422);
 if(input.resolution!==undefined){const options=metadata(spec,'resolutions');if(typeof input.resolution!=='string'||!Array.isArray(options)||!options.includes(input.resolution))throw new SafetyError('模型未声明所选分辨率',422);}
 if(input.aspect_ratio!==undefined){const options=metadata(spec,'aspect_ratios')??metadata(spec,'aspectRatios');if(typeof input.aspect_ratio!=='string'||!Array.isArray(options)||!options.includes(input.aspect_ratio))throw new SafetyError('模型未声明所选画幅比例',422);}
 if(input.imageAsset!==undefined){const supported=metadata(spec,'supportsImageInput')===true||metadata(spec,'supports_image_input')===true||metadata(spec,'supportsImageToVideo')===true||metadata(spec,'requiresImageInput')===true;if(!supported||typeof input.imageAsset!=='string')throw new SafetyError('模型未明确声明支持图片输入',422);assertPortableName(input.imageAsset);}
 return Object.fromEntries(['prompt','duration','resolution','aspect_ratio','imageAsset'].filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
}
function imageInput(root,name){
 if(name===undefined)return null;const bytes=store.readAsset(root,name);if(!bytes||!bytes.length||bytes.length>16*1024*1024)throw new SafetyError('视频参考图片不存在或超过预算',422);
 const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':null;if(!mime)throw new SafetyError('视频参考图片必须是 PNG 或 JPEG',422);return {asset:name,sha256:sha(bytes),bytes:bytes.length,mime,data:'data:'+mime+';base64,'+bytes.toString('base64')};
}
export class VeniceVideo{
 constructor(audio){this.audio=audio;this.running=new Map();this.closed=false;}
 async models(provider,signal){const connection=await this.audio.connection(provider),response=await veniceMediaRequest(connection.key,'/models?type=video',{signal});if(!Array.isArray(response.data?.data)||response.data.data.length>5000)throw new SafetyError('Venice 视频模型目录无效',502);return {provider:connection.provider,models:response.data.data.filter(item=>item?.type==='video'&&typeof item.id==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(item.id)&&item.model_spec?.offline!==true).map(item=>({id:item.id,spec:item.model_spec||{},specHash:sha(Buffer.from(stableVeniceData(item.model_spec||{})))}))};}
 async prepare(provider,model,specHash,input,signal){const catalogue=await this.models(provider,signal),row=catalogue.models.find(item=>item.id===model);if(!row||row.specHash!==specHash)throw new SafetyError('Venice 视频模型或能力已改变，请重新读取目录',409);return {provider:catalogue.provider,input:validateInput(row.spec,input)};}
 async quote(provider,model,specHash,input,signal){const prepared=await this.prepare(provider,model,specHash,input,signal),connection=await this.audio.connection(prepared.provider),payload={model,duration:prepared.input.duration};for(const key of ['resolution','aspect_ratio'])if(prepared.input[key]!==undefined)payload[key]=prepared.input[key];const response=await veniceMediaRequest(connection.key,'/video/quote',{body:payload,signal});if(!Number.isFinite(response.data?.quote)||response.data.quote<0)throw new SafetyError('Venice 未返回有效视频报价',502);return {model,quoteUsd:response.data.quote,note:'报价由 Venice 返回；实际计费与模型约束以服务为准。'};}
 load(root,id){root=store.validateRoot(root);const running=this.running.get(root+'|'+id);if(running)return running.record;const path=file(root,id);if(!existsSync(path))throw new SafetyError('Venice 视频任务不存在',404);if(statSync(path).size>256*1024)throw new SafetyError('Venice 视频记录超过预算',413);const data=JSON.parse(readFileSync(path,'utf8'));validateVeniceVideoRecord(data);if(data.id!==id)throw new SafetyError('Venice 视频身份不一致',409);const record={...data,root};if(['queued','running'].includes(record.status)&&!alive(record.ownerPid)){record.status='interrupted';record.error='本地进程中断；未自动重复提交。';save(record);}return record;}
 list(root){root=store.validateRoot(root);const names=readdirSync(folder(root)).filter(name=>/^venicevideo-[a-f0-9]{64}\.json$/.test(name));if(names.length>2000)throw new SafetyError('Venice 视频任务超过预算',413);return names.map(name=>publicRecord(this.load(root,name.slice(0,-5)))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200);}
 get(root,id){return publicRecord(this.load(root,id));}
 async start(root,{provider,model,specHash,input,operationId},signal){
  root=store.validateRoot(root);if(this.closed)throw new SafetyError('Venice 视频服务已停止',503);if(!HASH.test(operationId||'')||!HASH.test(specHash||''))throw new SafetyError('Venice 视频操作身份无效',422);assertSafeJson(input);privateLinkProtectorAvailable();await privateLinkProtectorPreflight(signal);
  const prepared=await this.prepare(provider,model,specHash,input,signal),connection=await this.audio.connection(prepared.provider),image=imageInput(root,prepared.input.imageAsset),inputHash=sha(Buffer.from(stableVeniceData({model,specHash,input:prepared.input,image:image?{asset:image.asset,sha256:image.sha256}:null}))),id='venicevideo-'+operationId,path=file(root,id);
  if(existsSync(path)){const prior=this.load(root,id);if(prior.inputHash!==inputHash||prior.connection!==connection.connection)throw new SafetyError('Venice 操作身份已用于其他请求',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  const inputAsset=image?{asset:image.asset,sha256:image.sha256,bytes:image.bytes,mime:image.mime}:undefined,record={schema:1,kind:'venice-video',id,root,ownerPid:process.pid,provider:connection.provider,connection:connection.connection,model,specHash,inputHash,...(inputAsset?{inputAsset}:{}),status:'queued',remote:{state:'not_submitted'},createdAt:new Date().toISOString()};
  const {root:ignored,...persisted}=record;validateVeniceVideoRecord(persisted);if(!atomicCreate(path,JSON.stringify(persisted,null,2))){const prior=this.load(root,id);if(prior.inputHash!==inputHash||prior.connection!==connection.connection)throw new SafetyError('Venice 操作身份冲突',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  const payload={model,prompt:prepared.input.prompt,duration:prepared.input.duration};for(const key of ['resolution','aspect_ratio'])if(prepared.input[key]!==undefined)payload[key]=prepared.input[key];if(image)payload.image_url=image.data;
  const controller=new AbortController();this.running.set(root+'|'+id,{record,controller});queueMicrotask(()=>this.submit(record,connection.key,payload,controller).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async submit(record,key,payload,controller){
  try{
   record.status='running';save(record);const onDispatch=()=>{record.remote={state:'submitted_or_uncertain'};save(record);};
   const response=await veniceMediaRequest(key,'/video/queue',{body:payload,signal:controller.signal,limit:1024*1024,onDispatch}),data=response.data;if(!data||!UUID.test(String(data.queue_id||'').toLowerCase()))throw new SafetyError('Venice 已响应但没有有效视频任务 ID，请核对远端记录',502);
   const queueId=data.queue_id.toLowerCase(),privateLink=data.download_url!==undefined,modelMismatch=data.model!==record.model;record.remote={state:'accepted',queueId,privateLink,...(modelMismatch?{modelMismatch:true}:{}),...(privateLink?{privateLinkSaved:false}:{})};
   const journal={schema:1,id:record.id,model:record.model,inputHash:record.inputHash,connection:record.connection,queueId,privateLink,...(modelMismatch?{modelMismatch:true}:{})},path=workspacePath(record.root,join(folder(record.root),record.id+'.accepted-'+queueId+'.json')),body=JSON.stringify(journal,null,2);
   if(!atomicCreate(path,body)&&readFileSync(path,'utf8')!==body)throw new SafetyError('Venice 视频接收回执冲突，请核对原记录',409);save(record);
   if(privateLink){const digest=await protectLink(record.root,record.id,queueId,data.download_url);record.remote={...record.remote,privateLinkSaved:true,privateLinkSha256:digest};save(record);}
   if(modelMismatch)throw new SafetyError('Venice 返回的模型与请求不一致，已保留任务 ID，请核对服务端',409);
   await this.collect(record,key,controller.signal);
  }catch(error){record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted?'本地已停止等待；Venice 视频可能仍在处理或计费。':String(error.message||error).replace(/(?:[a-z][a-z0-9+.-]*:\/\/\S+|Bearer\s+\S+)/gi,'[已隐藏]').slice(0,800);record.finishedAt=new Date().toISOString();save(record);}
  finally{this.running.delete(record.root+'|'+record.id);}
 }
 async collect(record,key,signal){
  const deadline=Date.now()+20*60*1000;while(Date.now()<deadline){
   signal?.throwIfAborted();const response=await veniceMediaRequest(key,'/video/retrieve',{body:{model:record.model,queue_id:record.remote.queueId,delete_media_on_completion:false},signal,limit:64*1024*1024});let media=response;
   if(response.data){
    if(response.data.status==='PROCESSING'){if(record.remote.status!=='PROCESSING'){record.remote={...record.remote,status:'PROCESSING'};save(record);}try{await delay(5000,undefined,{signal});}catch{throw new SafetyError('已停止本地等待',499);}continue;}
    if(response.data.status!=='COMPLETED'||!record.remote.privateLink)throw new SafetyError('Venice 返回未知视频状态或缺少私有链接',502);
    const link=await readLink(record.root,record.id,record.remote.queueId,record.remote.privateLinkSha256,signal);record.remote={...record.remote,status:'COMPLETED',privateLinkSaved:true,privateLinkSha256:link.sha256};save(record);media=await downloadPrivate(link.url,signal);
   }
   if(media.mime!=='video/mp4'||!media.bytes?.length||media.bytes.subarray(4,8).toString()!=='ftyp')throw new SafetyError('Venice 未返回可识别的 MP4 视频',502);
   const digest=sha(media.bytes),asset=store.saveAsset(record.root,'venice-video-'+record.id.slice(12,24)+'-'+digest.slice(0,12)+'.mp4',media.bytes);record.video={asset:asset.name,sha256:digest,bytes:media.bytes.length,mime:'video/mp4'};record.remote={...record.remote,state:'response_received'};record.status='ready';record.finishedAt=new Date().toISOString();delete record.error;save(record);return;
  }throw new SafetyError('等待 Venice 视频超时；可用已有任务 ID 取回',504);
 }
 stop(root,id){root=store.validateRoot(root);const active=this.running.get(root+'|'+id);if(!active)return false;active.controller.abort();return true;}
 recover(root,id){
  root=store.validateRoot(root);if(this.closed||this.running.has(root+'|'+id))throw new SafetyError('Venice 视频任务仍在本地运行或服务已停止',409);const release=acquire(root,id);let record,controller;
  try{
   record=this.load(root,id);if(record.status==='ready'){let bytes;try{bytes=store.readAsset(root,record.video.asset);}catch{}if(bytes&&bytes.length===record.video.bytes&&sha(bytes)===record.video.sha256){release();return {accepted:true,reused:true,job:publicRecord(record)};}}if(['queued','running'].includes(record.status)&&alive(record.ownerPid))throw new SafetyError('Venice 视频任务仍在其他进程运行',423);
   const prefix=id+'.accepted-',names=readdirSync(folder(root)).filter(name=>name.startsWith(prefix)&&/\.json(?:\.tmp-[a-f0-9-]{36})?$/.test(name));if(names.length>8)throw new SafetyError('Venice 视频接收回执过多，请先核对',409);const candidates=new Map();
   if(record.remote.modelMismatch)throw new SafetyError('Venice 返回的模型与请求不一致，请按已保存任务 ID 核对服务端',409);if(record.remote.queueId)candidates.set(record.remote.queueId,record.remote.privateLink);
   for(const name of names){const path=join(folder(root),name),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>8192)throw new SafetyError('Venice 视频回执无效',409);let journal;try{journal=JSON.parse(readFileSync(path,'utf8'));assertSafeJson(journal);}catch{throw new SafetyError('Venice 视频临时回执不完整，已保留',409);}if(journal.schema!==1||Object.keys(journal).some(key=>!['schema','id','model','inputHash','connection','queueId','privateLink','modelMismatch'].includes(key))||journal.modelMismatch!==undefined&&typeof journal.modelMismatch!=='boolean'||journal.id!==id||journal.model!==record.model||journal.inputHash!==record.inputHash||journal.connection!==record.connection||!UUID.test(journal.queueId||'')||typeof journal.privateLink!=='boolean'||!name.startsWith(prefix+journal.queueId+'.json')||candidates.has(journal.queueId)&&candidates.get(journal.queueId)!==journal.privateLink)throw new SafetyError('Venice 视频接收回执无效',409);if(journal.modelMismatch)throw new SafetyError('Venice 返回的模型与请求不一致，请按已保存任务 ID 核对服务端',409);candidates.set(journal.queueId,journal.privateLink);}
   if(candidates.size!==1||record.cleanup?.state==='confirmed'||record.revocation?.state==='confirmed')throw new SafetyError('没有唯一可取回的 Venice 视频任务，或远端结果已清理',409);
   const [queueId,privateLink]=[...candidates][0];if(privateLink&&!existsSync(privateFile(root,id,queueId)))throw new SafetyError('Venice 一次性私有链接未能保存，无法自动取回',409);record.remote={state:'accepted',queueId,privateLink,...(privateLink?{privateLinkSaved:true,...(record.remote.privateLinkSha256?{privateLinkSha256:record.remote.privateLinkSha256}:{})}:{})};record.status='running';record.ownerPid=process.pid;delete record.error;save(record);controller=new AbortController();this.running.set(root+'|'+id,{record,controller});
  }catch(error){release();throw error;}queueMicrotask(()=>this.resume(record,controller,release).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async resume(record,controller,release){try{const connection=await this.audio.connection(record.provider,record.connection);await this.collect(record,connection.key,controller.signal);}catch(error){record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted?'本地已停止等待；Venice 视频可能仍在处理或计费。':String(error.message||error).replace(/(?:[a-z][a-z0-9+.-]*:\/\/\S+|Bearer\s+\S+)/gi,'[已隐藏]').slice(0,800);record.finishedAt=new Date().toISOString();save(record);}finally{this.running.delete(record.root+'|'+record.id);release();}}
 async cleanup(root,id,signal){
  root=store.validateRoot(root);if(this.running.has(root+'|'+id))throw new SafetyError('视频任务仍在本地运行',409);const release=acquire(root,id);
  try{const record=this.load(root,id);if(record.status!=='ready'||!record.video)throw new SafetyError('请先保存并核对视频，再清理远端文件',409);if(record.cleanup?.state==='confirmed')return {alreadyCompleted:true,job:publicRecord(record)};if(record.cleanup?.state==='requested_or_uncertain')throw new SafetyError('上次远端清理状态未知，未自动重复',409);const bytes=store.readAsset(root,record.video.asset);if(!bytes||bytes.length!==record.video.bytes||sha(bytes)!==record.video.sha256)throw new SafetyError('本地视频缺失或改变，未清理远端文件',409);const connection=await this.audio.connection(record.provider,record.connection);record.cleanup={state:'requested_or_uncertain',at:new Date().toISOString()};save(record);const response=await veniceMediaRequest(connection.key,'/video/complete',{body:{model:record.model,queue_id:record.remote.queueId},signal,limit:1024*1024});if(response.data?.success!==true)throw new SafetyError('Venice 未确认远端清理；请核对服务端状态',502);record.cleanup={state:'confirmed',at:new Date().toISOString()};save(record);return {job:publicRecord(record)};}finally{release();}
 }
 async revokeLink(root,id,signal){
  root=store.validateRoot(root);if(this.running.has(root+'|'+id))throw new SafetyError('视频任务仍在本地运行',409);const release=acquire(root,id);
  try{
   const record=this.load(root,id);if(record.status!=='ready'||!record.video||record.remote.privateLink!==true)throw new SafetyError('请先保存并核对含私有链接的视频',409);
   if(record.revocation?.state==='confirmed')return {alreadyCompleted:true,job:publicRecord(record)};if(record.revocation?.state==='requested_or_uncertain')throw new SafetyError('上次链接撤销状态未知，未自动重复',409);
   const bytes=store.readAsset(root,record.video.asset);if(!bytes||bytes.length!==record.video.bytes||sha(bytes)!==record.video.sha256)throw new SafetyError('本地视频缺失或改变，未撤销链接',409);
   const link=await readLink(root,id,record.remote.queueId,record.remote.privateLinkSha256,signal);record.revocation={state:'requested_or_uncertain',at:new Date().toISOString()};save(record);
   const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,30000);
   try{const response=await fetch(checkedPrivateUrl(link.url),{method:'DELETE',signal:controller.signal,redirect:'error'});if(!response.ok)throw new SafetyError('Venice 未确认私有链接撤销（HTTP '+response.status+'）',502);}
   catch(error){if(signal?.aborted)throw new SafetyError('私有链接撤销状态未知，未自动重复',499);if(error instanceof SafetyError)throw error;throw new SafetyError('私有链接撤销状态未知，未自动重复',502);}
   finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
   record.revocation={state:'confirmed',at:new Date().toISOString()};save(record);return {job:publicRecord(record)};
  }finally{release();}
 }
 dispose(){this.closed=true;for(const active of this.running.values())active.controller.abort();}
}
