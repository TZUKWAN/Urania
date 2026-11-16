/** Plugin-owned image configuration. Secret values belong only to DSH credentials. */
import {mkdirSync,lstatSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SafetyError} from './safety.js';

const MODES=new Set(['dsh','dedicated']);
const PROTOCOLS=new Set(['gemini','openai','openrouter','venice']);
const REV=/^(?:none|[a-f0-9-]{36})$/;
const REF=/^DESIGNCRAFT_IMAGE_API_[A-F0-9]{32}$/;
const empty=()=>({schema:1,revision:'none',mode:'dsh',protocol:'gemini',baseURL:'https://generativelanguage.googleapis.com/v1beta',model:'',credentialRef:null});
function address(value,protocol){
 if(typeof value!=='string'||value.length>2048)throw new SafetyError('请填写有效的生图 API 基础地址',422);
 let url;try{url=new URL(value.trim());}catch{throw new SafetyError('生图 API 基础地址无效',422);}
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new SafetyError('API 地址需要 HTTPS 或本机 HTTP，且不能包含密钥、查询参数或片段',422);
 if(protocol==='openrouter'&&(url.origin!=='https://openrouter.ai'||!['/api/v1','/api/v1/'].includes(url.pathname)))throw new SafetyError('OpenRouter 地址应为 https://openrouter.ai/api/v1',422);
 if(protocol==='venice'&&(url.origin!=='https://api.venice.ai'||!['/api/v1','/api/v1/'].includes(url.pathname)))throw new SafetyError('Venice 地址应为 https://api.venice.ai/api/v1',422);
 if(/\/(?:images\/(?:generations|edits)|chat\/completions|models(?:\/.*)?)\/?$/i.test(url.pathname))throw new SafetyError('请填写 API 基础地址，不要填写模型或生成接口的完整路径',422);
 return url.href.replace(/\/$/,'');
}
function fields(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!MODES.has(value.mode)||!PROTOCOLS.has(value.protocol))throw new SafetyError('生图 API 配置模式或协议无效',422);
 if(value.model!==undefined&&typeof value.model!=='string')throw new SafetyError('模型 ID 格式无效',422);
 const model=typeof value.model==='string'?value.model.trim():'';
 if(model.length>200||model&&!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model))throw new SafetyError('模型 ID 只能包含字母、数字、点、下划线、冒号、短横线及斜线',422);
 if(protocolNeedsCatalogue(value.protocol)&&model)throw new SafetyError('该协议需要从服务目录选择模型，请留空模型 ID',422);
 return {mode:value.mode,protocol:value.protocol,baseURL:address(value.baseURL,value.protocol),model};
}
const protocolNeedsCatalogue=protocol=>!['openai','gemini'].includes(protocol);
const remove=path=>{try{unlinkSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}};
function alive(pid){if(!Number.isSafeInteger(pid)||pid<1)return true;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}

export class ImageApiSettings{
 constructor(ctx){this.ctx=ctx;}
 location(){const file=this.ctx.get?.('settings')?.documentPath;if(typeof file!=='string'||!isAbsolute(file))throw new SafetyError('DSH 用户配置存储尚未就绪，无法保存独立生图 API',503);return join(dirname(file),'designcraft','image-api.json');}
 read(){
  const file=this.location();let raw;
  try{const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new Error();raw=readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return empty();throw new SafetyError('独立生图 API 配置文件无法安全读取，原配置保留',503);}
  try{const value=JSON.parse(raw);if(Object.keys(value).some(key=>!['schema','revision','mode','protocol','baseURL','model','credentialRef'].includes(key))||value.schema!==1||!REV.test(value.revision)||value.revision==='none'||value.credentialRef!==null&&!REF.test(value.credentialRef))throw new Error();return {schema:1,revision:value.revision,...fields(value),credentialRef:value.credentialRef};}catch{throw new SafetyError('独立生图 API 配置内容无效，未回退或覆盖',503);}
 }
 async describe(){
  let value;try{value=this.read();}catch(error){return {available:false,error:error.message};}
  const credentials=this.ctx.get?.('credentials');let info={configured:false,writable:false};
  try{info=await credentials?.describe?.(value.credentialRef||'DESIGNCRAFT_IMAGE_API')||info;}catch{/* No secret or arbitrary provider error crosses this surface. */}
  const {credentialRef,...config}=value;
  return {available:true,config,credential:{configured:value.credentialRef!==null&&info.configured===true,writable:info.writable===true&&typeof credentials?.set==='function',source:['env','file','project-env','user-env'].includes(info.source)?info.source:null}};
 }
 route(){if(!this.ctx.get?.('settings')?.documentPath)return null;const value=this.read();return value.mode==='dedicated'?{id:'designcraft-image-api',name:'独立生图 API',baseURL:value.baseURL,protocol:value.protocol,ref:value.credentialRef,configuredModel:value.model,configurationRevision:value.revision}:null;}
 acquire(file){
  const dir=dirname(file);mkdirSync(dir,{recursive:true});const info=lstatSync(dir);if(!info.isDirectory()||info.isSymbolicLink())throw new SafetyError('生图 API 配置目录不安全',503);
  const lock=file+'.lock',token=JSON.stringify({pid:process.pid,token:randomUUID()});
  for(let attempt=0;attempt<2;attempt++){
   try{writeFileSync(lock,token,{flag:'wx',mode:0o600});return()=>{try{if(readFileSync(lock,'utf8')!==token)return false;remove(lock);return true;}catch(error){return error.code==='ENOENT';}};}catch(error){if(error.code!=='EEXIST')throw new SafetyError('生图 API 配置无法锁定保存',503);}
   try{const info=lstatSync(lock);if(!info.isFile()||info.isSymbolicLink()||info.size>512)throw new Error();const raw=readFileSync(lock,'utf8'),prior=JSON.parse(raw);if(alive(prior.pid)||readFileSync(lock,'utf8')!==raw)throw new Error();remove(lock);}catch{throw new SafetyError('另一处正在保存生图 API 配置，请稍后重新读取',409);}
  }
  throw new SafetyError('生图 API 配置写入冲突，请重新读取',409);
 }
 async save(input,{clear=false,assertCurrent=()=>{}}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||!REV.test(input.revision||''))throw new SafetyError('请先读取当前生图 API 配置',422);
  if(Object.keys(input).some(key=>!['revision','mode','protocol','baseURL','model','apiKey'].includes(key)))throw new SafetyError('生图 API 配置包含未知字段',422);
  if(input.apiKey!==undefined&&(typeof input.apiKey!=='string'||input.apiKey.length>8192||/[\s\x00-\x1f\x7f]/.test(input.apiKey)))throw new SafetyError('API 密钥格式无效，请填写原始密钥',422);
  const next=clear?empty():fields(input),credentials=this.ctx.get?.('credentials'),file=this.location(),release=this.acquire(file);let added=null,committed=false;
  try{
   assertCurrent();const prior=this.read();if(prior.revision!==input.revision)throw new SafetyError('生图 API 配置已在别处修改，请重新读取后保存',409);
   next.credentialRef=clear?null:prior.credentialRef;
   if(!clear&&prior.credentialRef&&!input.apiKey&&(next.baseURL!==prior.baseURL||next.protocol!==prior.protocol))throw new SafetyError('服务地址或协议已改变，请重新填写密钥，避免将旧密钥发送到另一服务',422);
   if(!clear&&input.apiKey){
    if(typeof credentials?.set!=='function')throw new SafetyError('DSH 凭据服务不支持保存密钥',503);
    added='DESIGNCRAFT_IMAGE_API_'+randomUUID().replaceAll('-','').toUpperCase();
    try{await credentials.set(added,input.apiKey);}catch{throw new SafetyError('DSH 凭据服务拒绝保存密钥，原生图配置保留',503);}
    next.credentialRef=added;
   }
   if(next.mode==='dedicated'){
    let info;try{info=next.credentialRef&&await credentials?.describe?.(next.credentialRef);}catch{}
    if(info?.configured!==true)throw new SafetyError('请填写并保存独立生图 API 的密钥',422);
   }
   assertCurrent();const saved={schema:1,...next,revision:randomUUID()},temp=file+'.'+randomUUID()+'.tmp';
   try{writeFileSync(temp,JSON.stringify(saved,null,2)+'\n',{flag:'wx',mode:0o600});assertCurrent();renameSync(temp,file);committed=true;}catch(error){try{remove(temp);}catch{}if(error instanceof SafetyError)throw error;throw new SafetyError('生图 API 配置未能提交，原配置保留',503);}
   const warnings=[];
   if(prior.credentialRef&&prior.credentialRef!==saved.credentialRef){try{if(typeof credentials?.unset!=='function')throw new Error();await credentials.unset(prior.credentialRef);}catch{warnings.push('新配置已保存，旧密钥引用未能清理；可在 DSH 凭据管理中清理 DesignCraft 旧引用。');}}
   return {...await this.describe(),saved:true,warnings};
  }finally{
   let cleanupFailed=false;
   if(added&&!committed){try{await credentials.unset(added);}catch{cleanupFailed=true;}}
   const unlocked=release();
   if(!unlocked)throw new SafetyError((committed?'配置已保存，请重新读取核对；':'配置未提交；')+'写入锁未能清理，未自动重试',503);
   if(cleanupFailed)throw new SafetyError('配置未提交，临时密钥引用未能清理；请在 DSH 凭据管理中清理未使用的 DesignCraft 引用',503);
  }
 }
}
