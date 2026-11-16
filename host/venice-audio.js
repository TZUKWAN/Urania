/** Venice music/SFX queue, project-scoped. No automatic remote deletion or repeat submission. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {SafetyError,assertSafeJson,assertPortableName,workspacePath} from './safety.js';

const ID=/^veniceaudio-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha=value=>createHash('sha256').update(value).digest('hex');
const routeIdentity=route=>JSON.stringify([route.protocol,route.baseURL,route.ref]);
function stable(value){
 let nodes=0;const walk=(item,depth)=>{if(++nodes>100000||depth>48)throw new SafetyError('Venice 数据结构超过预算',413);if(item===null||typeof item==='string'||typeof item==='boolean'||typeof item==='number'&&Number.isFinite(item))return item;if(Array.isArray(item))return item.map(child=>walk(child,depth+1));if(!item||typeof item!=='object')throw new SafetyError('Venice 数据格式无效',422);const out=Object.create(null);for(const key of Object.keys(item).sort())out[key]=walk(item[key],depth+1);return out;};return JSON.stringify(walk(value,0));
}
function folder(root){const path=workspacePath(root,'design/.designcraft/venice-audio');mkdirSync(path,{recursive:true});return path;}
function file(root,id){if(!ID.test(id||''))throw new SafetyError('Venice 音频任务身份无效',422);return workspacePath(root,join(folder(root),id+'.json'));}
function save(record){const path=file(record.root,record.id),temp=path+'.tmp-'+randomUUID(),{root,...data}=record;validateVeniceAudioRecord(data);const raw=JSON.stringify(data,null,2);if(Buffer.byteLength(raw)>256*1024)throw new SafetyError('Venice 音频记录超过预算',413);writeFileSync(temp,raw,{flag:'wx'});renameSync(temp,path);}
function publicRecord(record){const {root,ownerPid,...result}=record;return result;}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
function acquire(root,id){
 if(!ID.test(id||''))throw new SafetyError('Venice 音频任务身份无效',422);
 const dir=folder(root),token=randomUUID(),prefix='resume-'+id+'-',name=prefix+token+'.json',path=join(dir,name),body=JSON.stringify({pid:process.pid,id,token});
 if(!atomicCreate(path,body))throw new SafetyError('Venice 音频恢复记录冲突',409);
 const release=()=>{try{const info=lstatSync(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<4096&&readFileSync(path,'utf8')===body)unlinkSync(path);}catch{}};
 try{const peers=readdirSync(dir).filter(item=>item.startsWith(prefix)&&item.endsWith('.json'));if(peers.length>200)throw new SafetyError('Venice 音频恢复记录超过预算',413);for(const peer of peers){if(peer===name)continue;const target=join(dir,peer),info=lstatSync(target);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('Venice 音频恢复记录需要核对',409);const value=JSON.parse(readFileSync(target,'utf8'));if(value.id!==id||!Number.isSafeInteger(value.pid))throw new SafetyError('Venice 音频恢复记录无效',409);if(alive(value.pid))throw new SafetyError('该 Venice 音频任务正在另一流程中',423);}return release;}catch(error){release();throw error;}
}
function audioFormat(mime,bytes){
 const valid=mime==='audio/mpeg'&&(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&0xe0)===0xe0)?'.mp3':mime==='audio/wav'&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE'?'.wav':mime==='audio/flac'&&bytes.subarray(0,4).toString()==='fLaC'?'.flac':mime==='audio/mp4'&&bytes.subarray(4,8).toString()==='ftyp'?'.m4a':null;
 if(!valid)throw new SafetyError('Venice 音频类型与文件内容不一致或尚不支持',502);return valid;
}
export function validateVeniceAudioRecord(value){
 assertSafeJson(value);const allowed=new Set(['schema','kind','id','ownerPid','provider','connection','model','specHash','inputHash','status','remote','createdAt','finishedAt','error','audio','cleanup']);
 if(!value||Object.keys(value).some(key=>!allowed.has(key))||value.schema!==1||value.kind!=='venice-audio'||!ID.test(value.id||'')||typeof value.provider!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(value.provider)||typeof value.model!=='string'||!/^[A-Za-z0-9._:-]{1,200}$/.test(value.model)||!HASH.test(value.specHash||'')||!HASH.test(value.inputHash||'')||!['queued','running','ready','failed','cancelled','interrupted'].includes(value.status)||typeof value.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value.createdAt)||value.finishedAt!==undefined&&(typeof value.finishedAt!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value.finishedAt)))throw new SafetyError('Venice 音频记录无效',409);
 let route;try{route=JSON.parse(value.connection);}catch{throw new SafetyError('Venice 连接记录无效',409);}
 if(!Array.isArray(route)||route.length!==3||route[0]!=='venice'||route[1]!=='https://api.venice.ai/api/v1'||typeof route[2]!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(route[2]))throw new SafetyError('Venice 连接记录无效',409);
 if(!value.remote||!['not_submitted','submitted_or_uncertain','accepted','response_received'].includes(value.remote.state)||Object.keys(value.remote).some(key=>!['state','queueId','status','modelMismatch'].includes(key))||value.remote.modelMismatch!==undefined&&typeof value.remote.modelMismatch!=='boolean'||value.remote.status!==undefined&&!['QUEUED','PROCESSING'].includes(value.remote.status)||['accepted','response_received'].includes(value.remote.state)&&!UUID.test(value.remote.queueId||''))throw new SafetyError('Venice 远端任务记录无效',409);
 if(value.audio){const a=value.audio;if(Object.keys(a).some(key=>!['asset','sha256','bytes','mime'].includes(key))||typeof a.asset!=='string'||!HASH.test(a.sha256||'')||!Number.isSafeInteger(a.bytes)||a.bytes<1||a.bytes>64*1024*1024||!['audio/mpeg','audio/wav','audio/flac','audio/mp4'].includes(a.mime))throw new SafetyError('Venice 音频素材记录无效',409);assertPortableName(a.asset);}
 if(value.status==='ready'&&(!value.audio||value.remote.state!=='response_received'))throw new SafetyError('Venice 完成记录缺少音频',409);
 if(value.cleanup&&(!['requested_or_uncertain','confirmed'].includes(value.cleanup.state)||Object.keys(value.cleanup).some(key=>!['state','at'].includes(key))||typeof value.cleanup.at!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value.cleanup.at)))throw new SafetyError('Venice 远端清理记录无效',409);
 if(value.error!==undefined&&(typeof value.error!=='string'||/(?:[a-z][a-z0-9+.-]*:\/\/|Bearer\s+\S+|sk-[A-Za-z0-9_-]{20,})/i.test(value.error)))throw new SafetyError('Venice 任务记录包含未隐藏的链接或凭据',409);
 return value;
}
async function request(key,path,{body,signal,limit=4*1024*1024,onDispatch}={}){
 const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,60000);
 try{
  signal?.throwIfAborted();const encoded=body===undefined?undefined:JSON.stringify(body);if(onDispatch){await onDispatch();signal?.throwIfAborted();}
  const response=await fetch('https://api.venice.ai/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+key,...(body===undefined?{}:{'Content-Type':'application/json'})},...(encoded?{body:encoded}:{}),signal:controller.signal,redirect:'error'});
  if(!response.body||Number(response.headers.get('content-length'))>limit)throw new SafetyError('Venice 响应为空或超过预算',502);
  const reader=response.body.getReader(),chunks=[];let size=0;while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>limit){await reader.cancel();throw new SafetyError('Venice 响应超过预算',413);}chunks.push(Buffer.from(item.value));}
  if(!response.ok)throw new SafetyError('Venice 请求失败（HTTP '+response.status+'）',response.status===429?429:502);
  const bytes=Buffer.concat(chunks,size),mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
  if(mime==='application/json'){let data;try{data=JSON.parse(bytes.toString('utf8'));}catch{throw new SafetyError('Venice 返回的 JSON 无效',502);}if(!data||typeof data!=='object'||Array.isArray(data))throw new SafetyError('Venice 返回的数据结构无效',502);return {data,mime};}
  return {bytes,mime};
 }catch(error){if(signal?.aborted)throw new SafetyError('本地已停止等待；Venice 任务可能仍在处理或计费',499);if(controller.signal.aborted)throw new SafetyError('Venice 请求超时，远端状态未确认',504);if(error instanceof SafetyError)throw error;throw new SafetyError('Venice 网络请求失败，远端状态可能未确认',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function metadata(model,key){for(const object of [model.model_spec,model.model_spec?.constraints,model.model_spec?.capabilities])if(object&&Object.hasOwn(object,key))return object[key];return undefined;}
function validateParameters(model,input){
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>32000)throw new SafetyError('请输入音频提示词',422);
 const allowed=['prompt','lyrics_prompt','duration_seconds','force_instrumental','lyrics_optimizer','loop','voice','language_code','speed'];if(Object.keys(input).some(key=>!allowed.includes(key)))throw new SafetyError('Venice 音频参数包含不支持的字段',422);
 const minimum=metadata(model,'min_prompt_length'),maximum=metadata(model,'prompt_character_limit');if(Number.isFinite(minimum)&&input.prompt.length<minimum||Number.isFinite(maximum)&&input.prompt.length>maximum)throw new SafetyError('音频提示词不符合模型长度要求',422);
 if(metadata(model,'lyrics_required')===true&&!input.lyrics_prompt)throw new SafetyError('该 Venice 模型要求歌词内容',422);
 if(input.lyrics_prompt!==undefined&&(typeof input.lyrics_prompt!=='string'||input.lyrics_prompt.length>32000||metadata(model,'supports_lyrics')!==true&&metadata(model,'lyrics_required')!==true))throw new SafetyError('该模型未声明支持所给歌词',422);
 for(const [key,cap] of [['force_instrumental','supports_force_instrumental'],['lyrics_optimizer','supports_lyrics_optimizer'],['loop','supports_loop']])if(input[key]!==undefined&&(typeof input[key]!=='boolean'||metadata(model,cap)!==true))throw new SafetyError('该模型未声明支持 '+key,422);
 if(input.lyrics_optimizer&&input.lyrics_prompt)throw new SafetyError('歌词优化与指定歌词不能同时使用',422);
 if(input.duration_seconds!==undefined){const min=metadata(model,'min_duration_seconds'),max=metadata(model,'max_duration_seconds'),values=metadata(model,'durations');if(!Number.isFinite(input.duration_seconds)||input.duration_seconds<=0||!Number.isFinite(min)&&!Number.isFinite(max)&&!Array.isArray(values)||Number.isFinite(min)&&input.duration_seconds<min||Number.isFinite(max)&&input.duration_seconds>max||Array.isArray(values)&&!values.includes(input.duration_seconds))throw new SafetyError('模型未声明该音频时长',422);}
 if(input.voice!==undefined){const voices=metadata(model,'voices');if(typeof input.voice!=='string'||!Array.isArray(voices)||!voices.includes(input.voice))throw new SafetyError('该模型未声明所选声音',422);}
 if(input.language_code!==undefined&&(typeof input.language_code!=='string'||!/^[a-z]{2}$/.test(input.language_code)||metadata(model,'supports_language_code')!==true))throw new SafetyError('该模型未声明支持所选语言',422);
 if(input.speed!==undefined){const min=metadata(model,'min_speed'),max=metadata(model,'max_speed');if(!Number.isFinite(input.speed)||metadata(model,'supports_speed')!==true||!Number.isFinite(min)||!Number.isFinite(max)||input.speed<min||input.speed>max)throw new SafetyError('该模型未声明所选语速',422);}
 return Object.fromEntries(allowed.filter(key=>input[key]!==undefined).map(key=>[key,input[key]]));
}
export class VeniceAudio{
 constructor(ctx,providers){this.ctx=ctx;this.providers=providers;this.running=new Map();this.closed=false;}
 async connection(provider,expected){
  const route=await this.providers.route(provider||'venice');let url;try{url=new URL(route.baseURL);}catch{throw new SafetyError('Venice 连接地址无效',422);}
  if(route.protocol!=='venice'||url.origin!=='https://api.venice.ai'||url.pathname.replace(/\/$/,'')!=='/api/v1'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(route.id))throw new SafetyError('Venice 音频只使用官方 API 连接',422);
  const normalized={...route,baseURL:'https://api.venice.ai/api/v1'};if(expected&&expected!==routeIdentity(normalized))throw new SafetyError('Venice 音频连接已改变',409);
  const key=(await this.ctx.get?.('credentials')?.resolve?.(route.ref))?.value;if(typeof key!=='string'||!key.trim())throw new SafetyError('DSH Venice 凭据不可用',503);return {provider:route.id,connection:routeIdentity(normalized),key};
 }
 async models(provider,signal){
  const connection=await this.connection(provider),response=await request(connection.key,'/models?type=music',{signal});if(!Array.isArray(response.data?.data)||response.data.data.length>5000)throw new SafetyError('Venice 音频模型目录无效',502);
  const models=response.data.data.filter(item=>item?.type==='music'&&typeof item.id==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(item.id)&&item.model_spec?.offline!==true).map(item=>({id:item.id,spec:item.model_spec||{},specHash:sha(Buffer.from(stable(item.model_spec||{})))}));
  return {provider:connection.provider,models};
 }
 async prepare(provider,model,specHash,input,signal){
  const catalogue=await this.models(provider,signal),row=catalogue.models.find(item=>item.id===model);if(!row||row.specHash!==specHash)throw new SafetyError('Venice 音频模型或能力已改变，请重新读取目录',409);
  return {provider:catalogue.provider,spec:row.spec,input:validateParameters({model_spec:row.spec},input)};
 }
 async quote(provider,model,specHash,input,signal){
  const prepared=await this.prepare(provider,model,specHash,input,signal),connection=await this.connection(prepared.provider),payload={model};
  if(prepared.input.duration_seconds!==undefined)payload.duration_seconds=prepared.input.duration_seconds;
  if(prepared.spec?.pricing?.per_thousand_characters)payload.character_count=prepared.input.prompt.length+(prepared.input.lyrics_prompt?.length||0);
  const response=await request(connection.key,'/audio/quote',{body:payload,signal});if(!Number.isFinite(response.data?.quote)||response.data.quote<0)throw new SafetyError('Venice 未返回有效报价',502);return {model,quoteUsd:response.data.quote,note:'报价由 Venice 返回，实际计费以服务为准。'};
 }
 load(root,id){
  root=store.validateRoot(root);const running=this.running.get(root+'|'+id);if(running)return running.record;const path=file(root,id);if(!existsSync(path))throw new SafetyError('Venice 音频任务不存在',404);if(statSync(path).size>256*1024)throw new SafetyError('Venice 音频记录超过预算',413);
  const data=JSON.parse(readFileSync(path,'utf8'));validateVeniceAudioRecord(data);const record={...data,root};if(record.id!==id)throw new SafetyError('Venice 音频任务身份不一致',409);if(['queued','running'].includes(record.status)&&!alive(record.ownerPid)){record.status='interrupted';record.error='本地进程中断；未自动重复提交。';save(record);}return record;
 }
 list(root){root=store.validateRoot(root);const names=readdirSync(folder(root)).filter(name=>/^veniceaudio-[a-f0-9]{64}\.json$/.test(name));if(names.length>2000)throw new SafetyError('Venice 音频任务超过预算',413);return names.map(name=>publicRecord(this.load(root,name.slice(0,-5)))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200);}
 get(root,id){return publicRecord(this.load(root,id));}
 async start(root,{provider,model,specHash,input,operationId},signal){
  root=store.validateRoot(root);if(this.closed)throw new SafetyError('Venice 音频服务已停止',503);if(!HASH.test(operationId||'')||!HASH.test(specHash||''))throw new SafetyError('Venice 音频操作身份无效',422);
  assertSafeJson(input);const prepared=await this.prepare(provider,model,specHash,input,signal),connection=await this.connection(prepared.provider),inputHash=sha(Buffer.from(stable({model,specHash,input:prepared.input}))),id='veniceaudio-'+operationId,path=file(root,id);
  if(existsSync(path)){const prior=this.load(root,id);if(prior.inputHash!==inputHash||prior.connection!==connection.connection)throw new SafetyError('Venice 操作身份已用于其他请求',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  const record={schema:1,kind:'venice-audio',id,root,ownerPid:process.pid,provider:connection.provider,connection:connection.connection,model,specHash,inputHash,status:'queued',remote:{state:'not_submitted'},createdAt:new Date().toISOString()};
  const {root:ignored,...persisted}=record;validateVeniceAudioRecord(persisted);if(!atomicCreate(path,JSON.stringify(persisted,null,2))){const prior=this.load(root,id);if(prior.inputHash!==inputHash||prior.connection!==connection.connection)throw new SafetyError('Venice 操作身份冲突',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  const controller=new AbortController();this.running.set(root+'|'+id,{record,controller});queueMicrotask(()=>this.submit(record,connection.key,prepared.input,controller).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async submit(record,key,input,controller){
  try{
   record.status='running';save(record);const onDispatch=()=>{record.remote={state:'submitted_or_uncertain'};save(record);};
   const response=await request(key,'/audio/queue',{body:{model:record.model,...input},signal:controller.signal,limit:1024*1024,onDispatch}),data=response.data;
   if(!data||!UUID.test(data.queue_id||''))throw new SafetyError('Venice 已响应但没有有效任务 ID，请核对远端记录',502);
   const queueId=data.queue_id.toLowerCase(),modelMismatch=data.model!==record.model;record.remote={state:'accepted',queueId,...(modelMismatch?{modelMismatch:true}:{}),...(data.status==='QUEUED'?{status:data.status}:{})};
   const journal={schema:1,id:record.id,model:record.model,inputHash:record.inputHash,connection:record.connection,queueId,...(modelMismatch?{modelMismatch:true}:{})};
   const journalPath=workspacePath(record.root,join(folder(record.root),record.id+'.accepted-'+queueId+'.json'));
   if(!atomicCreate(journalPath,JSON.stringify(journal,null,2))&&readFileSync(journalPath,'utf8')!==JSON.stringify(journal,null,2))throw new SafetyError('Venice 接收回执冲突，请核对原记录',409);
   save(record);if(modelMismatch)throw new SafetyError('Venice 返回的模型与请求不一致，已保留任务 ID，请核对服务端',409);await this.collect(record,key,controller.signal);
  }catch(error){record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted?'本地已停止等待；Venice 任务可能仍在处理或计费。':String(error.message||error).replace(/(?:[a-z][a-z0-9+.-]*:\/\/\S+|Bearer\s+\S+)/gi,'[已隐藏]').slice(0,800);record.finishedAt=new Date().toISOString();save(record);}
  finally{this.running.delete(record.root+'|'+record.id);}
 }
 async collect(record,key,signal){
  const deadline=Date.now()+15*60*1000;while(Date.now()<deadline){
   signal?.throwIfAborted();const response=await request(key,'/audio/retrieve',{body:{model:record.model,queue_id:record.remote.queueId,delete_media_on_completion:false},signal,limit:64*1024*1024});
   if(response.data){if(response.data.status!=='PROCESSING')throw new SafetyError('Venice 返回未知音频任务状态',502);if(record.remote.status!=='PROCESSING'){record.remote={...record.remote,status:'PROCESSING'};save(record);}try{await delay(5000,undefined,{signal});}catch{throw new SafetyError('已停止本地等待',499);}continue;}
   const extension=audioFormat(response.mime,response.bytes),digest=sha(response.bytes),asset=store.saveAsset(record.root,'venice-audio-'+record.id.slice(12,24)+'-'+digest.slice(0,12)+extension,response.bytes);
   record.audio={asset:asset.name,sha256:digest,bytes:response.bytes.length,mime:response.mime};record.remote={...record.remote,state:'response_received'};record.status='ready';record.finishedAt=new Date().toISOString();delete record.error;save(record);return;
  }throw new SafetyError('等待 Venice 音频超时；可用已有任务 ID 取回',504);
 }
 stop(root,id){root=store.validateRoot(root);const active=this.running.get(root+'|'+id);if(!active)return false;active.controller.abort();return true;}
 recover(root,id){
  root=store.validateRoot(root);if(this.closed||this.running.has(root+'|'+id))throw new SafetyError('Venice 音频任务仍在本地运行或服务已停止',409);const release=acquire(root,id);let record,controller;
  try{
   record=this.load(root,id);if(record.status==='ready'){let bytes;try{bytes=store.readAsset(root,record.audio.asset);}catch{}if(bytes&&bytes.length===record.audio.bytes&&sha(bytes)===record.audio.sha256){release();return {accepted:true,reused:true,job:publicRecord(record)};}}if(['queued','running'].includes(record.status)&&alive(record.ownerPid))throw new SafetyError('Venice 音频任务仍在其他进程运行',423);
   const prefix=id+'.accepted-',names=readdirSync(folder(root)).filter(name=>name.startsWith(prefix)&&/\.json(?:\.tmp-[a-f0-9-]{36})?$/.test(name));if(names.length>8)throw new SafetyError('Venice 音频接收回执过多，请先核对',409);
   const ids=new Set(record.remote.queueId?[record.remote.queueId]:[]);let mismatch=record.remote.modelMismatch===true;for(const name of names){const path=join(folder(root),name),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>8192)throw new SafetyError('Venice 音频回执无效或超过预算',413);let journal;try{journal=JSON.parse(readFileSync(path,'utf8'));assertSafeJson(journal);}catch{throw new SafetyError('Venice 接收临时回执不完整，已保留，请先核对',409);}if(journal.schema!==1||Object.keys(journal).some(key=>!['schema','id','model','inputHash','connection','queueId','modelMismatch'].includes(key))||journal.modelMismatch!==undefined&&typeof journal.modelMismatch!=='boolean'||journal.id!==id||journal.model!==record.model||journal.inputHash!==record.inputHash||journal.connection!==record.connection||!UUID.test(journal.queueId||'')||!name.startsWith(prefix+journal.queueId+'.json'))throw new SafetyError('Venice 音频接收回执无效',409);ids.add(journal.queueId);mismatch ||= journal.modelMismatch===true;}
   if(mismatch)throw new SafetyError('Venice 返回的模型与请求不一致，请按已保存任务 ID 核对服务端',409);
   if(ids.size!==1||record.cleanup?.state==='confirmed')throw new SafetyError('没有唯一可取回的 Venice 任务，或远端文件已清理',409);
   record.remote={state:'accepted',queueId:[...ids][0]};record.status='running';record.ownerPid=process.pid;delete record.error;save(record);controller=new AbortController();this.running.set(root+'|'+id,{record,controller});
  }catch(error){release();throw error;}
  queueMicrotask(()=>this.resume(record,controller,release).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async resume(record,controller,release){try{const connection=await this.connection(record.provider,record.connection);await this.collect(record,connection.key,controller.signal);}catch(error){record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted?'本地已停止等待；Venice 任务可能仍在处理或计费。':String(error.message||error).replace(/(?:[a-z][a-z0-9+.-]*:\/\/\S+|Bearer\s+\S+)/gi,'[已隐藏]').slice(0,800);record.finishedAt=new Date().toISOString();save(record);}finally{this.running.delete(record.root+'|'+record.id);release();}}
 async cleanup(root,id,signal){
  root=store.validateRoot(root);if(this.running.has(root+'|'+id))throw new SafetyError('音频任务仍在本地运行',409);const release=acquire(root,id);
  try{const record=this.load(root,id);if(record.status!=='ready'||record.remote.state!=='response_received'||!record.audio)throw new SafetyError('请先保存并核对音频，再清理远端文件',409);
   if(record.cleanup?.state==='confirmed')return {alreadyCompleted:true,job:publicRecord(record)};if(record.cleanup?.state==='requested_or_uncertain')throw new SafetyError('上次远端清理状态未知，未自动重复',409);
   const bytes=store.readAsset(root,record.audio.asset);if(!bytes||bytes.length!==record.audio.bytes||sha(bytes)!==record.audio.sha256)throw new SafetyError('本地音频缺失或改变，未清理远端文件',409);
   const connection=await this.connection(record.provider,record.connection);record.cleanup={state:'requested_or_uncertain',at:new Date().toISOString()};save(record);
   const response=await request(connection.key,'/audio/complete',{body:{model:record.model,queue_id:record.remote.queueId},signal,limit:1024*1024});if(response.data?.success!==true)throw new SafetyError('Venice 未确认远端清理；请核对服务端状态',502);
   record.cleanup={state:'confirmed',at:new Date().toISOString()};save(record);return {job:publicRecord(record)};
  }finally{release();}
 }
 dispose(){this.closed=true;for(const active of this.running.values())active.controller.abort();}
}
export {request as veniceMediaRequest,stable as stableVeniceData};
