/** User-initiated PixelBin device authorization; tokens never enter a project. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,statSync,lstatSync,unlinkSync,realpathSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {atomicCreate,atomicWrite} from './persistence.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';
import {privateLinkProtectorPreflight,transformPrivateLink} from './private-link-protector.js';

const ORIGIN='https://mcp.pixelbin.io',RESOURCE=ORIGIN+'/mcp',DEVICE_GRANT='urn:ietf:params:oauth:grant-type:device_code';
const CONTEXT=createHash('sha256').update('DesignCraft/PixelBin/OAuth/v1').digest('hex');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tokenText=value=>typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\x00-\x20\x7f]/.test(value);
function endpoint(value){
 let url;try{url=new URL(value);}catch{throw new SafetyError('PixelBin OAuth 元数据地址无效',502);}
 if(url.origin!==ORIGIN||url.username||url.password||url.hash||url.search||url.href.length>2048)throw new SafetyError('PixelBin OAuth 端点不在受限官方来源',422);return url.href;
}
function directory(){
 const local=process.env.LOCALAPPDATA;if(process.platform!=='win32'||typeof local!=='string'||!isAbsolute(local))throw new SafetyError('PixelBin 设备授权需要 Windows 用户配置目录',503);
 let base;try{base=realpathSync(local);}catch{throw new SafetyError('Windows 用户配置目录不可用',503);}const intended=join(base,'DesignCraft','PixelBin','oauth'),resolved=workspacePath(base,intended);
 if(resolved.toLowerCase()!==intended.toLowerCase())throw new SafetyError('PixelBin 授权目录包含链接，未读写其他位置',409);return intended;
}
function file(name){
 if(typeof name!=='string'||!name||/[\\/:*?"<>|\x00-\x1f]/.test(name)||name==='.'||name==='..')throw new SafetyError('PixelBin 授权文件名无效',422);
 const base=directory(),intended=join(base,name),resolved=workspacePath(base,intended);if(resolved.toLowerCase()!==intended.toLowerCase())throw new SafetyError('PixelBin 授权文件包含链接，未读写其他位置',409);return intended;
}
function alive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
function authLock(){
 const base=directory();mkdirSync(base,{recursive:true});const token=randomUUID(),name='auth-lock-'+token+'.json',path=file(name),body=JSON.stringify({pid:process.pid,token});
 if(!atomicCreate(path,body))throw new SafetyError('PixelBin 授权锁冲突',409);
 const release=()=>{try{const info=lstatSync(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<4096&&readFileSync(path,'utf8')===body)unlinkSync(path);}catch{}};
 try{const peers=readdirSync(base).filter(value=>/^auth-lock-[a-f0-9-]{36}\.json$/.test(value));if(peers.length>128)throw new SafetyError('PixelBin 授权锁超过预算',413);for(const peer of peers){if(peer===name)continue;const other=file(peer),info=lstatSync(other);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('PixelBin 授权锁无效',409);let value;try{value=JSON.parse(readFileSync(other,'utf8'));}catch{throw new SafetyError('PixelBin 授权锁无法读取',409);}if(!Number.isSafeInteger(value.pid)||typeof value.token!=='string')throw new SafetyError('PixelBin 授权锁无效',409);if(alive(value.pid))throw new SafetyError('PixelBin 授权正在另一进程更新',423);}return release;}catch(error){release();throw error;}
}
function refreshState(name){if(!/^credential-[a-f0-9]{64}\.bin$/.test(name||''))throw new SafetyError('PixelBin 凭据身份无效',409);return file('refresh-state-'+name.slice('credential-'.length,-'.bin'.length)+'.json');}
function preference(){
 if(process.platform!=='win32'||typeof process.env.LOCALAPPDATA!=='string'||!isAbsolute(process.env.LOCALAPPDATA))return null;
 const path=file('source.json');if(!existsSync(path))return null;let value;try{if(statSync(path).size>4096)throw new Error();value=JSON.parse(readFileSync(path,'utf8'));}catch{throw new SafetyError('PixelBin 授权来源设置无效',409);}
 if(!value||value.schema!==1||!['dsh','local'].includes(value.source)||Object.keys(value).some(key=>!['schema','source'].includes(key)))throw new SafetyError('PixelBin 授权来源设置无效',409);return value.source;
}
async function request(url,{method='GET',body,headers={},signal}={}){
 const target=endpoint(url),controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,30000);
 try{
  const response=await fetch(target,{method,headers:{accept:'application/json',...(body?{'content-type':body instanceof URLSearchParams?'application/x-www-form-urlencoded':'application/json'}:{}),...headers},...(body?{body:body instanceof URLSearchParams?body.toString():JSON.stringify(body)}:{}),signal:controller.signal,redirect:'error'});
  if(!response.body||Number(response.headers.get('content-length'))>256*1024)throw new SafetyError('PixelBin OAuth 响应为空或超过预算',502);
  const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>256*1024)throw new SafetyError('PixelBin OAuth 响应超过预算',413);chunks.push(Buffer.from(item.value));}}finally{await reader.cancel().catch(()=>{});}
  let data;try{data=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));assertSafeJson(data);}catch{throw new SafetyError('PixelBin OAuth 返回无效数据',502);}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new SafetyError('PixelBin OAuth 返回无效数据',502);
  return {ok:response.ok,status:response.status,data};
 }catch(error){if(signal?.aborted)throw new SafetyError('PixelBin 授权已停止',499);if(controller.signal.aborted)throw new SafetyError('PixelBin 授权请求超时',504);if(error instanceof SafetyError)throw error;throw new SafetyError('PixelBin 授权网络请求失败',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
function metadata(value){
 if(!value||endpoint(value.issuer)!==ORIGIN+'/'||typeof value.device_authorization_endpoint!=='string'||typeof value.token_endpoint!=='string'||typeof value.registration_endpoint!=='string')throw new SafetyError('PixelBin OAuth 元数据缺少受支持端点',422);
 if(Array.isArray(value.grant_types_supported)&&!value.grant_types_supported.includes(DEVICE_GRANT))throw new SafetyError('PixelBin 未声明设备授权方式',422);
 return {issuer:ORIGIN,deviceEndpoint:endpoint(value.device_authorization_endpoint),tokenEndpoint:endpoint(value.token_endpoint),registrationEndpoint:endpoint(value.registration_endpoint)};
}
function tokenRecord(value){
 assertSafeJson(value);const allowed=['schema','issuer','clientId','clientSecret','authMethod','tokenEndpoint','accessToken','refreshToken','expiresAt'];
 if(!value||Object.keys(value).some(key=>!allowed.includes(key))||value.schema!==1||value.issuer!==ORIGIN||!tokenText(value.clientId)||value.clientSecret!==undefined&&!tokenText(value.clientSecret)||!['none','client_secret_post','client_secret_basic'].includes(value.authMethod)||value.authMethod!=='none'&&!value.clientSecret||endpoint(value.tokenEndpoint)!==value.tokenEndpoint||!tokenText(value.accessToken)||value.refreshToken!==undefined&&!tokenText(value.refreshToken)||value.expiresAt!==null&&(!Number.isSafeInteger(value.expiresAt)||value.expiresAt<1))throw new SafetyError('PixelBin 授权记录无效',409);
 return true;
}
function tokenForm(record,grant,extra){
 const body=new URLSearchParams({grant_type:grant,client_id:record.clientId,...extra});const headers={};
 if(record.authMethod==='client_secret_post')body.set('client_secret',record.clientSecret);
 else if(record.authMethod==='client_secret_basic')headers.authorization='Basic '+Buffer.from(encodeURIComponent(record.clientId)+':'+encodeURIComponent(record.clientSecret)).toString('base64');
 return {body,headers};
}
async function tokenRequest(record,grant,extra,signal){
 const {body,headers}=tokenForm(record,grant,extra),target=endpoint(record.tokenEndpoint),controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,30000);
 try{
  const response=await fetch(target,{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded',...headers},body:body.toString(),signal:controller.signal,redirect:'error'});
  if(!response.body||Number(response.headers.get('content-length'))>256*1024)throw new SafetyError('PixelBin 令牌响应无效',502);
  const reader=response.body.getReader(),chunks=[];let size=0;try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>256*1024)throw new SafetyError('PixelBin 令牌响应超过预算',413);chunks.push(Buffer.from(item.value));}}finally{await reader.cancel().catch(()=>{});}
  let data;try{data=JSON.parse(Buffer.concat(chunks,size).toString('utf8'));assertSafeJson(data);}catch{throw new SafetyError('PixelBin 令牌响应无效',502);}
  if(!response.ok)return {ok:false,error:typeof data?.error==='string'?data.error:'oauth_error'};
  if(!tokenText(data?.access_token)||String(data.token_type||'').toLowerCase()!=='bearer'||data.refresh_token!==undefined&&!tokenText(data.refresh_token)||data.expires_in!==undefined&&(!Number.isSafeInteger(data.expires_in)||data.expires_in<1||data.expires_in>31536000))throw new SafetyError('PixelBin 返回的令牌格式不受支持',502);
  return {ok:true,accessToken:data.access_token,...(data.refresh_token?{refreshToken:data.refresh_token}:{}),expiresAt:data.expires_in===undefined?null:Date.now()+data.expires_in*1000};
 }catch(error){if(signal?.aborted)throw new SafetyError('PixelBin 授权已停止',499);if(controller.signal.aborted)throw new SafetyError('PixelBin 令牌请求超时',504);if(error instanceof SafetyError)throw error;throw new SafetyError('PixelBin 令牌请求失败',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}

export class PixelbinOAuth{
 constructor(ctx){this.ctx=ctx;this.pending=new Map();this.refreshing=null;this.closed=false;}
 async reference(){try{const value=(await this.ctx.get?.('credentials')?.resolve?.('PIXELBIN_ACCESS_TOKEN'))?.value;return tokenText(value)?value:null;}catch{return null;}}
 async readEncrypted(name,signal){
  if(!/^credential-[a-f0-9]{64}\.bin$/.test(name||''))throw new SafetyError('PixelBin 加密凭据身份无效',422);const path=file(name),info=statSync(path);if(!info.isFile()||info.size<1||info.size>16384)throw new SafetyError('PixelBin 加密凭据无效',409);
  const encrypted=readFileSync(path);if(name!=='credential-'+sha(encrypted)+'.bin')throw new SafetyError('PixelBin 加密凭据摘要不一致',409);let plain;
  try{plain=await transformPrivateLink('unprotect',CONTEXT,encrypted,signal);let data;try{data=JSON.parse(plain.toString('utf8'));}catch{throw new SafetyError('PixelBin 授权记录无法读取',409);}tokenRecord(data);return data;}
  finally{plain?.fill(0);encrypted.fill(0);}
 }
 async saved(signal){
  let pointer;try{const path=file('current.json');if(!existsSync(path))return null;if(statSync(path).size>4096)throw new SafetyError('PixelBin 授权指针无效',409);pointer=JSON.parse(readFileSync(path,'utf8'));}catch(error){if(error instanceof SafetyError)throw error;throw new SafetyError('PixelBin 授权指针无法读取',409);}
  if(!pointer||pointer.schema!==1||typeof pointer.file!=='string'||!/^credential-[a-f0-9]{64}\.bin$/.test(pointer.file)||Object.keys(pointer).some(key=>!['schema','file'].includes(key)))throw new SafetyError('PixelBin 授权指针无效',409);
  return {file:pointer.file,record:await this.readEncrypted(pointer.file,signal)};
 }
 async persist(record,signal,{lockHeld=false,preferLocal=false}={}){
  tokenRecord(record);const release=lockHeld?null:authLock(),plain=Buffer.from(JSON.stringify(record));let encrypted;
  try{
   encrypted=await transformPrivateLink('protect',CONTEXT,plain,signal);const name='credential-'+sha(encrypted)+'.bin',base=directory();mkdirSync(base,{recursive:true});const target=file(name);
   if(!atomicCreate(target,encrypted)&&!readFileSync(target).equals(encrypted))throw new SafetyError('PixelBin 加密凭据冲突，原文件未覆盖',409);
   try{atomicWrite(file('current.json'),JSON.stringify({schema:1,file:name}));if(preferLocal)atomicWrite(file('source.json'),JSON.stringify({schema:1,source:'local'}));}catch(error){error.retained={candidate:name};throw error;}
   return name;
  }finally{plain.fill(0);encrypted?.fill(0);release?.();}
 }
 async status(signal){
  const selected=preference(),direct=await this.reference();let saved,localError;try{saved=await this.saved(signal);}catch(error){if(signal?.aborted)throw error;localError=error;}
  if(selected==='dsh'||!selected&&direct)return direct?{configured:true,source:'DSH 引用',selected:'dsh',expiresAt:null,localAvailable:!!saved}:{configured:false,selected:'dsh',localAvailable:!!saved};
  if(localError)throw localError;if(!saved)return {configured:false,selected:selected||null,dshAvailable:!!direct};
  return {configured:true,source:'当前 Windows 用户加密存储',selected:'local',dshAvailable:!!direct,expiresAt:saved.record.expiresAt,expired:saved.record.expiresAt!==null&&saved.record.expiresAt<=Date.now(),refreshAvailable:!!saved.record.refreshToken,refreshUncertain:existsSync(refreshState(saved.file))};
 }
 async begin(owner,signal){
  if(this.closed||typeof owner!=='string'||!owner)throw new SafetyError('PixelBin 授权上下文无效',422);try{await privateLinkProtectorPreflight(signal);}catch(error){if(signal?.aborted)throw new SafetyError('PixelBin 授权已停止',499);throw new SafetyError('当前 Windows 用户无法安全保存 PixelBin 授权，未开始认证',error.status||503);}
  const discovery=await request(ORIGIN+'/.well-known/oauth-authorization-server',{signal});if(!discovery.ok)throw new SafetyError('PixelBin OAuth 元数据不可用（HTTP '+discovery.status+'）',502);const server=metadata(discovery.data);
  const registration=await request(server.registrationEndpoint,{method:'POST',body:{client_name:'DesignCraft for DSH',token_endpoint_auth_method:'none',grant_types:[DEVICE_GRANT,'refresh_token'],response_types:[]},signal});
  if(!registration.ok||!tokenText(registration.data.client_id))throw new SafetyError('PixelBin OAuth 客户端注册失败',502);
  const authMethod=registration.data.token_endpoint_auth_method||(registration.data.client_secret?'client_secret_basic':'none'),clientSecret=registration.data.client_secret;
  if(!['none','client_secret_post','client_secret_basic'].includes(authMethod)||authMethod!=='none'&&!tokenText(clientSecret))throw new SafetyError('PixelBin OAuth 客户端认证方式不受支持',422);
  const client={clientId:registration.data.client_id,clientSecret,authMethod},deviceBody=new URLSearchParams({client_id:client.clientId,resource:RESOURCE}),deviceHeaders={};
  if(authMethod==='client_secret_post')deviceBody.set('client_secret',clientSecret);else if(authMethod==='client_secret_basic')deviceHeaders.authorization='Basic '+Buffer.from(encodeURIComponent(client.clientId)+':'+encodeURIComponent(clientSecret)).toString('base64');
  const device=await request(server.deviceEndpoint,{method:'POST',body:deviceBody,headers:deviceHeaders,signal});
  if(!device.ok||!tokenText(device.data.device_code)||typeof device.data.user_code!=='string'||!/^[A-Za-z0-9-]{4,32}$/.test(device.data.user_code)||!Number.isSafeInteger(device.data.expires_in)||device.data.expires_in<1||device.data.expires_in>3600)throw new SafetyError('PixelBin 设备授权响应无效',502);
  let verification;try{verification=new URL(device.data.verification_uri);}catch{throw new SafetyError('PixelBin 设备授权地址无效',502);}
  if(verification.origin!=='https://console.pixelbin.io'||!['/device','/device/'].includes(verification.pathname)||verification.username||verification.password||verification.hash||verification.search)throw new SafetyError('PixelBin 设备授权地址不在官方范围',422);
  const interval=Number.isSafeInteger(device.data.interval)&&device.data.interval>0&&device.data.interval<=60?device.data.interval:5,id='pixelauth-'+randomUUID(),expiresAt=Date.now()+device.data.expires_in*1000;
  this.pending.set(id,{owner,deviceCode:device.data.device_code,clientId:registration.data.client_id,...(clientSecret?{clientSecret}:{}),authMethod,tokenEndpoint:server.tokenEndpoint,interval,nextPoll:Date.now()+interval*1000,expiresAt});
  while(this.pending.size>4)this.pending.delete(this.pending.keys().next().value);const timer=setTimeout(()=>{const item=this.pending.get(id);if(item?.tokenRecord){const finalTimer=setTimeout(()=>this.pending.delete(id),5*60*1000);finalTimer.unref?.();}else this.pending.delete(id);},device.data.expires_in*1000);timer.unref?.();
  verification.searchParams.set('user_code',device.data.user_code);return {id,userCode:device.data.user_code,verificationUrl:verification.href,expiresAt,interval,note:'请自行在官方页面完成授权；不会自动打开或操作您的浏览器。'};
 }
 async check(owner,id,signal){
  const pending=this.pending.get(id);if(!pending||pending.owner!==owner||!pending.tokenRecord&&Date.now()>=pending.expiresAt)throw new SafetyError('PixelBin 设备授权已过期，请重新发起',404);
  if(pending.inFlight)throw new SafetyError('PixelBin 设备授权正在核对',423);pending.inFlight=true;
  try{
  if(pending.tokenRecord){const candidate=await this.persist(pending.tokenRecord,signal,{preferLocal:true});this.pending.delete(id);return {authorized:true,stored:true,candidate,note:'授权已保存到当前 Windows 用户的加密存储并选用。'};}
  if(Date.now()<pending.nextPoll)return {authorized:false,status:'pending',retryAfterSeconds:Math.ceil((pending.nextPoll-Date.now())/1000)};
  pending.nextPoll=Date.now()+pending.interval*1000;let response;
  try{response=await tokenRequest(pending,DEVICE_GRANT,{device_code:pending.deviceCode,resource:RESOURCE},signal);}catch(error){pending.interval=Math.min(pending.interval*2,120);pending.nextPoll=Date.now()+pending.interval*1000;throw error;}
  if(!response.ok){
   if(response.error==='slow_down'){pending.interval=Math.min(pending.interval+5,120);pending.nextPoll=Date.now()+pending.interval*1000;return {authorized:false,status:'pending',retryAfterSeconds:pending.interval};}
   if(response.error==='authorization_pending')return {authorized:false,status:'pending',retryAfterSeconds:pending.interval};
   this.pending.delete(id);throw new SafetyError(response.error==='access_denied'?'PixelBin 授权被拒绝':response.error==='expired_token'?'PixelBin 设备授权已过期':'PixelBin 授权未成功',403);
  }
  const record={schema:1,issuer:ORIGIN,clientId:pending.clientId,...(pending.clientSecret?{clientSecret:pending.clientSecret}:{}),authMethod:pending.authMethod,tokenEndpoint:pending.tokenEndpoint,accessToken:response.accessToken,...(response.refreshToken?{refreshToken:response.refreshToken}:{}),expiresAt:response.expiresAt};tokenRecord(record);pending.tokenRecord=record;
  const candidate=await this.persist(record,signal,{preferLocal:true});this.pending.delete(id);return {authorized:true,stored:true,candidate,note:'授权已保存到当前 Windows 用户的加密存储并选用。'};
  }finally{pending.inFlight=false;}
 }
 async accessToken(signal){
  const selected=preference(),direct=await this.reference();if(selected==='dsh'||!selected&&direct){if(!direct)throw new SafetyError('DSH 的 PixelBin 凭据引用不可用，请切换授权来源',503);return direct;}const saved=await this.saved(signal);if(!saved)throw new SafetyError('PixelBin 尚未授权，请先在当前会话发起设备授权',503);
  if(saved.record.expiresAt===null||saved.record.expiresAt>Date.now()+30000)return saved.record.accessToken;
  if(!saved.record.refreshToken)throw new SafetyError('PixelBin 授权已过期，请重新授权',403);
  if(this.refreshing)return this.refreshing;this.refreshing=(async()=>{
   const release=authLock();try{
    const latest=await this.saved(signal);if(!latest)throw new SafetyError('PixelBin 授权不存在，请重新授权',403);
    if(latest.record.expiresAt===null||latest.record.expiresAt>Date.now()+30000)return latest.record.accessToken;
    if(!latest.record.refreshToken)throw new SafetyError('PixelBin 授权已过期，请重新授权',403);
    const statePath=refreshState(latest.file),state={schema:1,credentialFile:latest.file,state:'sent_or_uncertain'};
    if(!atomicCreate(statePath,JSON.stringify(state)))throw new SafetyError('PixelBin 上次授权刷新结果未确认；请恢复加密候选或重新授权，不自动重发',409);
    const response=await tokenRequest(latest.record,'refresh_token',{refresh_token:latest.record.refreshToken,resource:RESOURCE},signal);
    if(!response.ok)throw new SafetyError('PixelBin 授权刷新失败，请重新授权',403);
    const record={...latest.record,accessToken:response.accessToken,refreshToken:response.refreshToken||latest.record.refreshToken,expiresAt:response.expiresAt};await this.persist(record,signal,{lockHeld:true});return record.accessToken;
   }finally{release();}
  })();try{return await this.refreshing;}finally{this.refreshing=null;}
 }
 async pendingCredentials(signal){
  let names;try{names=readdirSync(directory()).filter(name=>/^credential-[a-f0-9]{64}\.bin$/.test(name));}catch(error){if(error.code==='ENOENT')return [];throw error;}if(names.length>128)throw new SafetyError('PixelBin 加密凭据候选超过预算',413);
  let current;try{current=await this.saved(signal);}catch(error){if(signal?.aborted)throw error;}
  return names.filter(name=>name!==current?.file).map(candidate=>({candidate,note:'加密候选尚未核对，不代表授权有效。'}));
 }
 async recover(name,signal){const release=authLock();try{const record=await this.readEncrypted(name,signal);if(record.expiresAt!==null&&record.expiresAt<=Date.now()&&(!record.refreshToken||existsSync(refreshState(name))))throw new SafetyError('该加密授权已过期或刷新状态不明',409);atomicWrite(file('current.json'),JSON.stringify({schema:1,file:name}));atomicWrite(file('source.json'),JSON.stringify({schema:1,source:'local'}));return {recovered:true,note:'已恢复并选用本机加密授权，尚未验证远端权限。'};}finally{release();}}
 async select(source,signal){
  if(!['dsh','local'].includes(source))throw new SafetyError('PixelBin 授权来源无效',422);const release=authLock();try{if(source==='dsh'&&!await this.reference()||source==='local'&&!await this.saved(signal))throw new SafetyError('所选 PixelBin 授权来源不可用',404);signal?.throwIfAborted();atomicWrite(file('source.json'),JSON.stringify({schema:1,source}));return {selected:source,note:'已切换本机使用的授权来源；尚未验证远端权限。'};}finally{release();}
 }
 async disconnect(){
  const direct=await this.reference(),release=authLock();try{const path=file('current.json');if(!existsSync(path))return {disconnected:!direct,note:direct?'当前没有本机授权指针；DSH 凭据引用仍可用，本操作未更改它。':'当前没有本机授权指针。'};
   const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('PixelBin 授权指针无效，未更改',409);const raw=readFileSync(path),archive=file('disabled-'+randomUUID()+'.json');
   if(!atomicCreate(archive,raw))throw new SafetyError('PixelBin 停用记录冲突，未更改授权',409);const after=lstatSync(path);if(after.isSymbolicLink()||!after.isFile()||after.dev!==info.dev||after.ino!==info.ino||!readFileSync(path).equals(raw))throw new SafetyError('PixelBin 授权已改变，未停用',409);unlinkSync(path);
   if(direct)atomicWrite(file('source.json'),JSON.stringify({schema:1,source:'dsh'}));return {disconnected:true,note:'已停用本机授权指针并保留加密文件；未撤销 PixelBin 账户上的授权。'+(direct?' DSH 凭据引用仍可用并已选中。':'')};
  }finally{release();}
 }
 dispose(){this.closed=true;this.pending.clear();}
}
