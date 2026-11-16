/** Bounded transport for explicitly admitted Stitch, PixelBin and Figma MCP endpoints. */
import {SafetyError,assertSafeJson} from './safety.js';

const ENDPOINT='https://stitch.googleapis.com/mcp';
const PIXELBIN_ENDPOINT='https://mcp.pixelbin.io/mcp';
const FIGMA_ENDPOINT='https://mcp.figma.com/mcp';
const FIGMA_DESKTOP_ENDPOINT='http://127.0.0.1:3845/mcp';
const LEGACY=new Set(['2025-11-25','2025-06-18','2025-03-26']);
const MAX_RESPONSE=8*1024*1024;

async function credential(ctx,reference){
 try{const item=await ctx.get?.('credentials')?.resolve?.(reference);return typeof item?.value==='string'&&item.value.trim()?item.value:null;}catch{return null;}
}
async function auth(ctx){
 const key=await credential(ctx,'STITCH_API_KEY');if(key)return {'x-goog-api-key':key};
 const token=await credential(ctx,'STITCH_ACCESS_TOKEN');if(!token)throw new SafetyError('DSH 未配置 Stitch API 密钥或访问令牌引用',503);
 const project=await credential(ctx,'STITCH_PROJECT_ID')||await credential(ctx,'GOOGLE_CLOUD_PROJECT');
 if(project&&!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project))throw new SafetyError('Stitch 配额项目引用无效',422);
 return {authorization:'Bearer '+token,...(project?{'x-goog-user-project':project}:{})};
}
async function responseBytes(response,maximum=MAX_RESPONSE){
 if(!response.body||Number(response.headers.get('content-length'))>maximum)throw new SafetyError('MCP 服务响应为空或超过预算',502);
 const reader=response.body.getReader(),chunks=[];let total=0;
 try{while(true){const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>maximum)throw new SafetyError('MCP 服务响应超过预算',413);chunks.push(Buffer.from(item.value));}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks,total);
}
function message(value,id){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.jsonrpc!=='2.0')throw new SafetyError('MCP 服务响应无效',502);
 if(value.id!==id){if(value.method&&value.id!==undefined)throw new SafetyError('MCP 服务请求了当前不支持的交互',422);return null;}
 if(value.error){const error=new SafetyError('MCP 服务返回错误（代码 '+String(value.error.code).slice(0,30)+'）',502);error.rpcCode=value.error.code;throw error;}
 if(!Object.hasOwn(value,'result'))throw new SafetyError('MCP 服务响应缺少结果',502);assertSafeJson(value.result);return value.result;
}
async function eventResponse(response,id){
 if(!response.body)throw new SafetyError('MCP 事件流为空',502);
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',total=0,events=0;
 try{
  while(true){
   const item=await reader.read();if(item.done)break;total+=item.value.length;if(total>MAX_RESPONSE)throw new SafetyError('MCP 事件流超过预算',413);
   text+=decoder.decode(item.value,{stream:true});text=text.replace(/\r\n/g,'\n');let end;
   while((end=text.indexOf('\n\n'))>=0){
    const event=text.slice(0,end);text=text.slice(end+2);if(++events>1000)throw new SafetyError('MCP 事件数量超过预算',413);
    const data=event.split('\n').filter(line=>line==='data'||line.startsWith('data:')).map(line=>line==='data'?'':line.slice(5).replace(/^ /,'')).join('\n');
    if(!data)continue;let parsed;try{parsed=JSON.parse(data);}catch{throw new SafetyError('MCP 事件不是有效 JSON',502);}
    const result=message(parsed,id);if(result!==null)return result;
   }
  }
  throw new SafetyError('MCP 事件流中断，结果未确认；不要自动重发',502);
 }finally{await reader.cancel().catch(()=>{});}
}

export class StitchMcp{
 constructor(headers,signal,endpoint=ENDPOINT){if(![ENDPOINT,PIXELBIN_ENDPOINT,FIGMA_ENDPOINT,FIGMA_DESKTOP_ENDPOINT].includes(endpoint))throw new SafetyError('MCP 服务地址不受支持',422);this.headers=headers;this.signal=signal;this.endpoint=endpoint;this.session=null;this.protocol=null;this.capabilities=null;this.stateless=false;this.nextId=0;}
 static async connect(ctx,signal){const client=new StitchMcp(await auth(ctx),signal);await client.initialize();return client;}
 static async connectFigma(ctx,signal){const token=await credential(ctx,'FIGMA_MCP_ACCESS_TOKEN');if(typeof token!=='string'||!token||token.length>8192||/[\x00-\x20\x7f]/.test(token))throw new SafetyError('DSH 未配置 Figma MCP OAuth 访问令牌引用',503);const region=await credential(ctx,'FIGMA_MCP_REGION');if(region&&!/^[a-z]{2}(?:-gov)?-[a-z]+-[0-9]{1,2}$/.test(region))throw new SafetyError('Figma MCP 区域引用无效',422);const client=new StitchMcp({authorization:'Bearer '+token,...(region?{'x-figma-region':region}:{})},signal,FIGMA_ENDPOINT);await client.initialize();return client;}
 static async connectFigmaDesktop(signal){const client=new StitchMcp({},signal,FIGMA_DESKTOP_ENDPOINT);await client.initialize();return client;}
 static async connectPixelbin(token,signal){if(typeof token!=='string'||!token||token.length>8192||/[\x00-\x20\x7f]/.test(token))throw new SafetyError('PixelBin OAuth 令牌不可用',503);const client=new StitchMcp({authorization:'Bearer '+token},signal,PIXELBIN_ENDPOINT);await client.initialize();return client;}
 credentialValues(){return Object.entries(this.headers).filter(([key])=>/^(?:authorization|x-goog-api-key)$/i.test(key)).map(([,value])=>String(value).replace(/^Bearer\s+/i,'')).filter(Boolean);}
 sensitiveValues(){return [...this.credentialValues(),...(this.session?[this.session]:[])];}
 async request(method,params,{notify=false,onDispatch}={}){
  this.signal?.throwIfAborted();const id=notify?undefined:++this.nextId,body={jsonrpc:'2.0',...(notify?{}:{id}),method,...(params===undefined?{}:{params})};
  if(this.stateless){body.params ||= {};body.params._meta={...(body.params._meta||{}),'io.modelcontextprotocol/protocolVersion':this.protocol,'io.modelcontextprotocol/clientInfo':{name:'designcraft',version:'1.0'},'io.modelcontextprotocol/clientCapabilities':{}};}
  const headers={...this.headers,accept:'application/json, text/event-stream','content-type':'application/json',...(this.session?{'mcp-session-id':this.session}:{}),...(this.protocol?{'mcp-protocol-version':this.protocol}:{}),...(this.stateless?{'mcp-method':method,...(method==='tools/call'&&params?.name?{'mcp-name':params.name}:{})}:{})};
  const controller=new AbortController(),abort=()=>controller.abort();if(this.signal?.aborted)abort();this.signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,180000);
  try{
   if(onDispatch){this.signal?.throwIfAborted();await onDispatch();this.signal?.throwIfAborted();}
   const response=await fetch(this.endpoint,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,redirect:'error'});
   const session=response.headers.get('mcp-session-id');if(session){if(session.length>256||!/^[\x21-\x7e]+$/.test(session)||this.session&&this.session!==session)throw new SafetyError('MCP 会话身份无效',502);this.session=session;}
   if(!response.ok){
    let code;try{const raw=await responseBytes(response,65536),parsed=JSON.parse(raw.toString('utf8'));code=parsed?.error?.code;}catch{}
    const error=new SafetyError('MCP 服务请求失败（HTTP '+response.status+'）',response.status===429?429:response.status===401||response.status===403?403:502);error.rpcCode=code;throw error;
   }
   if(notify){if(response.body)await response.body.cancel().catch(()=>{});return null;}
   const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   if(type==='text/event-stream')return await eventResponse(response,id);
   if(type!=='application/json')throw new SafetyError('MCP 服务返回了不支持的响应格式',502);
   let parsed;try{parsed=JSON.parse((await responseBytes(response)).toString('utf8'));}catch(error){if(error instanceof SafetyError)throw error;throw new SafetyError('MCP 响应不是有效 JSON',502);}
   const result=message(parsed,id);if(result===null)throw new SafetyError('MCP 响应身份不一致',502);return result;
  }catch(error){if(this.signal?.aborted)throw new SafetyError('本地已停止等待；远端操作可能仍在进行',499);if(controller.signal.aborted)throw new SafetyError('MCP 请求超时，远端结果未确认；不要自动重发',504);if(error instanceof SafetyError)throw error;throw new SafetyError('MCP 网络请求失败，远端结果可能未确认',502);}
  finally{clearTimeout(timer);this.signal?.removeEventListener('abort',abort);}
 }
 async initialize(){
  let result;try{result=await this.request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'designcraft',version:'1.0'}});}
  catch(error){if(error.rpcCode!==-32022)throw error;this.stateless=true;this.protocol='2026-07-28';this.session=null;return;}
  if(!LEGACY.has(result?.protocolVersion))throw new SafetyError('服务返回不受支持的 MCP 协议版本',422);this.protocol=result.protocolVersion;this.capabilities=result.capabilities||{};
  await this.request('notifications/initialized',undefined,{notify:true});
 }
 async tools(){
  const tools=[],seen=new Set();let cursor;
  for(let page=0;page<10;page++){
   const result=await this.request('tools/list',cursor?{cursor}:{});if(!Array.isArray(result?.tools)||result.tools.length>1000)throw new SafetyError('MCP 工具目录无效或超过预算',502);
   for(const item of result.tools){if(!item||typeof item.name!=='string'||!/^[-A-Za-z0-9_]{1,120}$/.test(item.name)||seen.has(item.name)||!item.inputSchema||typeof item.inputSchema!=='object'||Array.isArray(item.inputSchema))throw new SafetyError('MCP 工具目录身份无效',502);seen.add(item.name);tools.push(item);}
   cursor=result.nextCursor;if(!cursor)return tools;if(typeof cursor!=='string'||cursor.length>2000)throw new SafetyError('MCP 工具目录分页无效',502);
  }
  throw new SafetyError('MCP 工具目录页数超过预算',413);
 }
 async prompts(){
  if(this.capabilities&&!Object.hasOwn(this.capabilities,'prompts'))throw new SafetyError('MCP 服务未声明提示能力',422);
  const prompts=[],seen=new Set();let cursor;
  for(let page=0;page<10;page++){
   const result=await this.request('prompts/list',cursor?{cursor}:{});if(!Array.isArray(result?.prompts)||result.prompts.length>1000)throw new SafetyError('MCP 提示目录无效或超过预算',502);
   for(const item of result.prompts){if(!item||typeof item.name!=='string'||!/^[-A-Za-z0-9_]{1,120}$/.test(item.name)||seen.has(item.name)||item.arguments!==undefined&&(!Array.isArray(item.arguments)||item.arguments.length>100))throw new SafetyError('MCP 提示目录身份无效',502);seen.add(item.name);prompts.push(item);}
   cursor=result.nextCursor;if(!cursor)return prompts;if(typeof cursor!=='string'||cursor.length>2000)throw new SafetyError('MCP 提示目录分页无效',502);
  }
  throw new SafetyError('MCP 提示目录页数超过预算',413);
 }
 async prompt(name,args){return this.request('prompts/get',{name,arguments:args});}
 async call(name,args,onDispatch){return this.request('tools/call',{name,arguments:args},{onDispatch});}
}
