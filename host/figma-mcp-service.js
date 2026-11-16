/** Explicit Figma MCP design operations in the owning DSH project. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';
import {canonicalModelData,inspectModelInput} from './fal-workflow-service.js';
import {StitchMcp} from './stitch-mcp.js';
import {figmaMcpImageCandidates,captureFigmaMcpImage,listFigmaMcpImages,recoverFigmaMcpImage,openFigmaMcpImage,reconcileFigmaMcpImage} from './figma-mcp-image.js';
import {figmaMcpFileCandidates,captureFigmaMcpFile,listFigmaMcpFiles,recoverFigmaMcpFile} from './figma-mcp-download.js';
import {figmaPromptMessages,captureFigmaPrompt,listFigmaPrompts,readFigmaPrompt,recoverFigmaPrompt} from './figma-mcp-prompt.js';
import {FIGMA_HTML_MAX_REQUEST} from './figma-html-inline.js';

const READ=new Set(['download_assets','get_code_connect_map','get_code_connect_suggestions','get_context_for_code_connect','get_design_context','get_figjam','get_libraries','get_metadata','get_screenshot','get_variable_defs','search_design_system','whoami']);
const DESKTOP_READ=new Set(['get_code_connect_map','get_code_connect_suggestions','get_context_for_code_connect','get_design_context','get_figjam','get_metadata','get_screenshot','get_variable_defs']);
const WRITE=new Set(['add_code_connect_map','create_new_file','generate_diagram','generate_figma_design','generate_image','html_to_figma','send_code_connect_mappings','use_figma']);
const UPLOAD=new Set(['upload_assets']);
const JOB=/^figmamcpjob-[a-f0-9]{64}$/,RESULT=/^figmamcpresult-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/,SNAP=/^figmamcpsnapshot-[a-f0-9-]{36}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=value=>sha(Buffer.from(canonicalModelData(value)));
const dir=root=>workspacePath(root,'design/.designcraft/figmamcp-jobs');
const pathFor=(root,id)=>{if(!JOB.test(id||''))throw new SafetyError('Figma MCP 任务身份无效',422);return workspacePath(root,join(dir(root),id+'.json'));};
const resultDir=root=>workspacePath(root,'design/.designcraft/figmamcp-results');
const resultPath=(root,id)=>{if(!RESULT.test(id||''))throw new SafetyError('Figma MCP 结果回执身份无效',422);return workspacePath(root,join(resultDir(root),id+'.json'));};
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};

function safeOutput(value,secrets=[]){
 const hidden=secrets.filter(item=>typeof item==='string'&&item.length>0&&item.length<=8192);
 let nodes=0,redacted=false;const walk=(item,depth)=>{
  if(++nodes>100000||depth>48)throw new SafetyError('Figma MCP 数据结构超过预算',413);
  if(typeof item==='string'){
   if(/^data:/i.test(item)){redacted=true;return '[内嵌数据已隐藏]';}
   let text=item;if(text.length>100000){text=text.slice(0,100000);redacted=true;}
   let clean=text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"<>]+/gi,'[链接已隐藏]').replace(/(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b['"]?\s*[:=]\s*['"]?[^\s'",}]{12,}/gi,'[已隐藏]');for(const secret of hidden)if(clean.includes(secret))clean=clean.split(secret).join('[已隐藏]');if(clean!==text)redacted=true;return clean;
  }
  if(item===null||typeof item==='number'||typeof item==='boolean')return item;
  if(Array.isArray(item))return item.map(child=>walk(child,depth+1));
  if(item&&typeof item==='object'){
   const out=Object.create(null);for(const [key,child]of Object.entries(item)){
    if(['__proto__','constructor','prototype'].includes(key))throw new SafetyError('Figma MCP 返回不安全字段',422);
    const privateKey=/^(?:authorization|x-goog-api-key|api[_-]?key|access[_-]?token|session[_-]?id|downloadUrl)$/i.test(key),unsafeKey=/(?:https?:\/\/|^data:|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(key)||hidden.some(secret=>key.includes(secret)),safeKey=unsafeKey?'[隐藏字段-'+sha(Buffer.from(key)).slice(0,16)+']':key;
    const inlineBinary=key==='data'&&typeof child==='string'&&(item.type==='image'||item.type==='audio'||child.length>1024&&/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(child));
    if(unsafeKey)redacted=true;if(privateKey){out[safeKey]='[已隐藏]';redacted=true;}else if(inlineBinary){out[safeKey]='[内嵌数据已隐藏]';redacted=true;}else out[safeKey]=walk(child,depth+1);
   }return out;
  }
  throw new SafetyError('Figma MCP 返回不支持的数据',502);
 };const data=walk(value,0);assertSafeJson(data);return {data,redacted};
}
export function validateFigmaMcpResultBytes(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)throw new SafetyError('Figma MCP 结果大小无效',409);
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SafetyError('Figma MCP 结果不是有效 JSON',409);}
 const safe=safeOutput(value);if(JSON.stringify(safe.data)!==JSON.stringify(value))throw new SafetyError('Figma MCP 结果含未处理的链接或敏感数据',409);return true;
}
export function validateFigmaMcpResultReceipt(row){
 assertSafeJson(row);const allowed=['schema','kind','id','jobId','tool','requestHash','inputHash','schemaSha256','resultAsset','resultSha256','resultBytes'];
 if(!row||Object.keys(row).some(key=>!allowed.includes(key))||row.schema!==1||row.kind!=='figmamcp-result-receipt'||!RESULT.test(row.id||'')||!JOB.test(row.jobId||'')||!WRITE.has(row.tool)||!HASH.test(row.requestHash||'')||!HASH.test(row.inputHash||'')||!HASH.test(row.schemaSha256||'')||!HASH.test(row.resultSha256||'')||typeof row.resultAsset!=='string'||!/^figmamcp-result-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.json$/.test(row.resultAsset)||!row.resultAsset.startsWith('figmamcp-result-'+row.resultSha256.slice(0,24))||!Number.isSafeInteger(row.resultBytes)||row.resultBytes<1||row.resultBytes>8*1024*1024||row.id!=='figmamcpresult-'+identity([row.jobId,row.requestHash,row.inputHash,row.resultSha256]))throw new SafetyError('Figma MCP 结果回执无效',409);
 return true;
}
function acquireRecovery(root,id){
 const directory=dir(root);mkdirSync(directory,{recursive:true});const token=randomUUID(),prefix='figmamcprecover-'+id+'-',path=workspacePath(root,join(directory,prefix+token+'.json')),body=JSON.stringify({pid:process.pid,token,id});
 if(!atomicCreate(path,body))throw new SafetyError('Figma MCP 恢复记录冲突',409);
 const release=()=>{try{const info=lstatSync(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<=4096&&readFileSync(path,'utf8')===body)unlinkSync(path);}catch{}};
 try{const peers=readdirSync(directory).filter(name=>name.startsWith(prefix)&&name.endsWith('.json'));if(peers.length>200)throw new SafetyError('Figma MCP 恢复记录超过预算',413);for(const peer of peers){if(peer===prefix+token+'.json')continue;const file=workspacePath(root,join(directory,peer)),info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('Figma MCP 恢复记录需要核对',409);const other=JSON.parse(readFileSync(file,'utf8'));if(other.id!==id||!Number.isSafeInteger(other.pid)||typeof other.token!=='string')throw new SafetyError('Figma MCP 恢复记录无效',409);if(alive(other.pid))throw new SafetyError('Figma MCP 任务正在另一恢复流程中',423);}return release;}catch(error){release();throw error;}
}
function figmaLinks(value,secrets=[]){
 const links=new Set(),stack=[{value,depth:0}];let count=0;while(stack.length){const item=stack.pop();if(++count>100000||item.depth>48)throw new SafetyError('Figma MCP 返回结构超过预算',413);if(typeof item.value==='string'){
  for(const match of item.value.matchAll(/https:\/\/(?:www\.)?figma\.com\/(?:design|file|board|slides|deck|proto)\/[A-Za-z0-9]{22,128}(?:\/[^\s?#\"'<>]*)?(?:\?[^\s#\"'<>]*)?/gi)){
   const text=match[0].replace(/[),.;]+$/,'');if(secrets.some(secret=>secret&&text.includes(secret))||text.length>2000)continue;let url;try{url=new URL(text);}catch{continue;}if(url.protocol!=='https:'||!['figma.com','www.figma.com'].includes(url.hostname.toLowerCase())||url.username||url.password||url.port||url.hash)continue;
   let valid=true;for(const [key,val]of url.searchParams){if(key==='node-id'&&!/^(?:I)?\d+[:-]\d+(?:;\d+[:-]\d+)*$/.test(val)||key==='m'&&!['dev','design'].includes(val)||!['node-id','m'].includes(key))valid=false;}if(valid){links.add(text);if(links.size>=20)return [...links];}
  }
 }else if(item.value&&typeof item.value==='object')for(const child of Object.values(item.value))stack.push({value:child,depth:item.depth+1});}return [...links];
}
function unwrap(result){
 if(!result||typeof result!=='object'||Array.isArray(result))throw new SafetyError('Figma MCP 工具结果无效',502);
 if(result.resultType==='input_required'){const error=new SafetyError('Figma MCP 需要额外交互；当前不会自动确认或重发',409);error.needsInput=true;throw error;}
 if(result.isError)throw new SafetyError('Figma MCP 工具报告失败；远端可能已发生部分变化，请先核对',502);
 return result;
}
function argsFor(value,{maxBytes=256*1024}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new SafetyError('Figma MCP 工具参数必须是对象',422);
 assertSafeJson(value);const serialized=JSON.stringify(value);if(Buffer.byteLength(serialized)>maxBytes)throw new SafetyError('Figma MCP 参数超过预算',413);
 if(/(?:Bearer\s+[A-Za-z0-9_.:-]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|fig[dou]_[A-Za-z0-9_-]{20,})/i.test(serialized))throw new SafetyError('Figma MCP 参数包含疑似凭据，请通过 DSH 凭据引用配置',422);
 inspectModelInput(value);return value;
}
function schemaFor(tools,name,expected){
 const found=tools.find(item=>item.name===name);if(!found)throw new SafetyError('当前 Figma MCP 目录未提供该工具',422);
 const actual=identity(found.inputSchema);if(expected&&actual!==expected)throw new SafetyError('Figma MCP 工具 schema 已改变，请重新查看',409);return {found,hash:actual};
}
export function validateFigmaMcpJob(job){
 assertSafeJson(job);const allowed=['schema','kind','id','ownerPid','tool','schemaSha256','requestHash','inputHash','status','remoteState','createdAt','finishedAt','resultAsset','resultSha256','resultBytes','snapshotId','recoveredFromReceipt','error'];
 if(!job||Object.keys(job).some(key=>!allowed.includes(key))||job.schema!==1||job.kind!=='figmamcp-job'||!JOB.test(job.id||'')||!WRITE.has(job.tool)||!HASH.test(job.schemaSha256||'')||!HASH.test(job.requestHash||'')||!HASH.test(job.inputHash||'')||!['queued','running','responded','failed','cancelled','interrupted','unknown','needs_input'].includes(job.status)||!['not_dispatched','sent_or_uncertain','responded'].includes(job.remoteState)||typeof job.createdAt!=='string'||!/^[0-9T:.Z-]{24}$/.test(job.createdAt))throw new SafetyError('Figma MCP 任务记录无效',409);
 if(job.ownerPid!==undefined&&(!Number.isSafeInteger(job.ownerPid)||job.ownerPid<1)||job.status==='queued'&&job.remoteState!=='not_dispatched'||job.status==='running'&&job.remoteState!=='sent_or_uncertain'||job.status==='responded'&&(!job.resultAsset||job.remoteState!=='responded'))throw new SafetyError('Figma MCP 任务状态不一致',409);
 if(job.resultAsset!==undefined&&(typeof job.resultAsset!=='string'||!/^figmamcp-result-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.json$/.test(job.resultAsset)||!HASH.test(job.resultSha256||'')||!Number.isSafeInteger(job.resultBytes)||job.resultBytes<1||job.resultBytes>8*1024*1024))throw new SafetyError('Figma MCP 结果记录无效',409);
 if(job.resultAsset===undefined&&(job.resultSha256!==undefined||job.resultBytes!==undefined))throw new SafetyError('Figma MCP 结果记录不完整',409);
 if(job.snapshotId!==undefined&&!SNAP.test(job.snapshotId))throw new SafetyError('Figma MCP 快照身份无效',409);
 if(job.recoveredFromReceipt!==undefined&&!RESULT.test(job.recoveredFromReceipt))throw new SafetyError('Figma MCP 恢复回执身份无效',409);
 if(job.error!==undefined&&(typeof job.error!=='string'||job.error.length>500||/(?:https?:\/\/|Bearer\s+[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(job.error)))throw new SafetyError('Figma MCP 任务错误记录无效',409);
 return true;
}

export class FigmaMcpService{
 constructor(ctx,manager,onChange=()=>{}){this.ctx=ctx;this.manager=manager;this.onChange=onChange;this.snapshots=new Map();this.running=new Map();this.closed=false;}
 async connect(signal,source='remote'){if(this.closed)throw new SafetyError('Figma MCP 服务已停止',503);if(source==='desktop')return StitchMcp.connectFigmaDesktop(signal);if(source!=='remote')throw new SafetyError('Figma MCP 来源无效',422);return StitchMcp.connectFigma(this.ctx,signal);}
 snapshot(root,tool,args,payload,{jobId,secrets=[],omitArgs=false,source='remote'}={}){
  const safe=safeOutput(payload,secrets),content=JSON.stringify(safe.data,null,2);if(Buffer.byteLength(content)>8*1024*1024)throw new SafetyError('Figma MCP 快照超过预算',413);
  const id='figmamcpsnapshot-'+randomUUID(),requestHash=identity(source==='desktop'?{source,tool,args}:{tool,args});this.snapshots.set(id,{id,root,tool,source,...(omitArgs?{}:{args}),requestHash,...(jobId?{jobId}:{}),redacted:safe.redacted,secrets:secrets.filter(value=>typeof value==='string'&&value),payload,content,at:Date.now()});while(this.snapshots.size>5)this.snapshots.delete(this.snapshots.keys().next().value);
  const timer=setTimeout(()=>this.snapshots.delete(id),5*60*1000);timer.unref?.();
  return {snapshotId:id,source,redacted:safe.redacted,totalCharacters:content.length};
 }
 async catalog(signal,source='remote'){
  const client=await this.connect(signal,source),tools=await client.tools(),items=[];
  for(const item of tools)if(source==='desktop'?DESKTOP_READ.has(item.name):READ.has(item.name)||WRITE.has(item.name)||UPLOAD.has(item.name)){
   const safe=safeOutput({name:item.name,description:typeof item.description==='string'?item.description:'',inputSchema:item.inputSchema},client.sensitiveValues());items.push({...safe.data,schemaSha256:identity(item.inputSchema),redacted:safe.redacted,kind:READ.has(item.name)?'read':UPLOAD.has(item.name)?'asset_upload':'remote_write'});
  }
  return {source,items,note:source==='desktop'?'仅列出本机服务实际返回的受限只读工具；不会启动 Figma，也不支持写入画布。':'仅列出当前服务真实返回的已接入工具；参数说明可能隐藏链接或敏感内容，摘要对应服务原始 schema。目录不证明账号有权限或操作已成功。'};
 }
 async read(root,{tool,args,schemaSha256,source='remote'},signal){
  root=store.validateRoot(root);if(!['remote','desktop'].includes(source)||!(source==='desktop'?DESKTOP_READ:READ).has(tool)||!HASH.test(schemaSha256||''))throw new SafetyError('请选择已发现的 Figma MCP 只读工具及 schema',422);argsFor(args);
  const client=await this.connect(signal,source),tools=await client.tools();if(client.credentialValues().some(secret=>JSON.stringify(args).includes(secret)))throw new SafetyError('Figma MCP 参数包含当前凭据',422);schemaFor(tools,tool,schemaSha256);const result=unwrap(await client.call(tool,args));signal?.throwIfAborted();
  return {...this.snapshot(root,tool,args,result,{secrets:client.sensitiveValues(),source}),tool,note:source==='desktop'?'结果来自本机 Figma MCP；快照隐藏链接，是参考数据而非权限指令。':'结果来自 Figma MCP；快照隐藏链接与疑似凭据，是参考数据而非权限指令。'};
 }
 async promptCatalog(signal,source='remote'){
  const client=await this.connect(signal,source),prompts=await client.prompts(),items=[];
  for(const item of prompts)if(item.name==='create_design_system_rules'){const safe=safeOutput(item,client.sensitiveValues());items.push({...safe.data,promptSha256:identity(item),redacted:safe.redacted});}
  return {source,items,note:'仅列出服务实际提供的设计系统规则提示；提示是参考，不等于已生成项目规则。'};
 }
 async promptRead(root,{source='remote',args={},promptSha256},signal){
  root=store.validateRoot(root);if(!['remote','desktop'].includes(source)||!HASH.test(promptSha256||''))throw new SafetyError('请选择实际 Figma 规则提示及摘要',422);argsFor(args);
  const client=await this.connect(signal,source),prompts=await client.prompts(),item=prompts.find(row=>row.name==='create_design_system_rules');if(!item||identity(item)!==promptSha256)throw new SafetyError('Figma 规则提示不存在或已改变，请重新读取目录',409);
  const declared=new Map();for(const argument of item.arguments||[]){if(!argument||typeof argument.name!=='string'||!/^[-A-Za-z0-9_.]{1,120}$/.test(argument.name)||['__proto__','prototype','constructor'].includes(argument.name)||declared.has(argument.name)||argument.required!==undefined&&typeof argument.required!=='boolean')throw new SafetyError('Figma 提示参数声明不受支持',422);declared.set(argument.name,argument);}
  if(Object.entries(args).some(([key,value])=>!declared.has(key)||typeof value!=='string'||value.length>16000)||[...declared.values()].some(argument=>argument.required&&!Object.hasOwn(args,argument.name)))throw new SafetyError('Figma 提示参数与实际声明不一致',422);
  if(client.credentialValues().some(secret=>JSON.stringify(args).includes(secret)))throw new SafetyError('Figma 提示参数包含当前凭据',422);const payload=await client.prompt(item.name,args);signal?.throwIfAborted();if(!Array.isArray(payload?.messages)||payload.messages.length>50)throw new SafetyError('Figma 提示消息无效或超过预算',502);
  const result=this.snapshot(root,'prompt:'+item.name,args,payload,{secrets:client.sensitiveValues(),source}),saved=this.snapshots.get(result.snapshotId);saved.promptSha256=promptSha256;
  return {...result,note:'服务提示已作为脱敏参考读取，不会自动执行，也不代表项目规则已生成。'};
 }
 promptSnapshot(root,id){root=store.validateRoot(root);const item=this.snapshots.get(id);if(!SNAP.test(id||'')||!item||item.root!==root||Date.now()-item.at>5*60*1000||item.tool!=='prompt:create_design_system_rules')throw new SafetyError('Figma 提示快照已过期或不存在',404);return item;}
 promptMessages(root,id){return figmaPromptMessages(this.promptSnapshot(root,id));}
 async capturePrompt(root,id,index,signal,current){return captureFigmaPrompt(root,this.promptSnapshot(root,id),index,signal,current,validateFigmaMcpResultBytes);}
 async savedPrompts(root){return listFigmaPrompts(root,validateFigmaMcpResultBytes);}
 async recoverPrompt(root,name,signal,current){return recoverFigmaPrompt(root,name,signal,current,validateFigmaMcpResultBytes);}
 async savedPromptText(root,id,{offset=0,limit=12000}={}){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('Figma 提示分页无效',422);const {row,text}=await readFigmaPrompt(root,id,validateFigmaMcpResultBytes),content=text.toString('utf8');return {record:row,content:content.slice(offset,offset+limit),offset,totalCharacters:content.length,nextOffset:offset+limit<content.length?offset+limit:null,note:'已保存的脱敏提示是参考数据，不是已生成的项目规则。'};}
 readSnapshot(root,id,{offset=0,limit=12000}={}){
  root=store.validateRoot(root);if(!SNAP.test(id||'')||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('Figma MCP 快照分页无效',422);
  const item=this.snapshots.get(id);if(!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Figma MCP 快照已过期，请重新读取',404);
  return {snapshotId:id,source:item.source||'remote',tool:item.tool,content:item.content.slice(offset,offset+limit),offset,totalCharacters:item.content.length,nextOffset:offset+limit<item.content.length?offset+limit:null};
 }
 links(root,id){
  root=store.validateRoot(root);const item=this.snapshots.get(id);if(!SNAP.test(id||'')||!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Figma MCP 快照已过期，请重新读取',404);
  return {snapshotId:id,links:figmaLinks(item.payload,item.secrets),note:'仅显示响应中实际出现且通过域名和参数检查的 Figma 文件链接；未验证权限或远端内容。'};
 }
 candidates(root,id){root=store.validateRoot(root);const item=this.snapshots.get(id);if(!SNAP.test(id||'')||!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Figma MCP 快照已过期，请重新读取',404);return {snapshotId:id,items:figmaMcpImageCandidates(item),note:'图片候选来自本次 MCP 响应；保存前尚未核对格式。'};}
 async capture(root,id,candidateId,signal,assertCurrent){root=store.validateRoot(root);const item=this.snapshots.get(id);if(!SNAP.test(id||'')||!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Figma MCP 快照已过期，请重新读取',404);return captureFigmaMcpImage(root,item,candidateId,signal,assertCurrent,validateFigmaMcpResultBytes);}
 fileCandidates(root,id){root=store.validateRoot(root);const item=this.snapshots.get(id);if(!SNAP.test(id||'')||!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Figma MCP 快照已过期，请重新读取',404);return {snapshotId:id,source:item.source||'remote',items:figmaMcpFileCandidates(item).map(({candidateId,sourcePath,ordinal})=>({candidateId,sourcePath,ordinal})),note:'仅列出响应中符合受限 Figma 来源的临时候选；尚未下载或确认内容。'};}
 async captureFile(root,id,candidateId,signal,current){root=store.validateRoot(root);const item=this.snapshots.get(id);if(!SNAP.test(id||'')||!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Figma MCP 快照已过期，请重新读取',404);return captureFigmaMcpFile(root,item,candidateId,signal,current,validateFigmaMcpResultBytes);}
 async files(root){return listFigmaMcpFiles(root,validateFigmaMcpResultBytes);}
 async recoverFile(root,name,signal,current){return recoverFigmaMcpFile(root,name,signal,current,validateFigmaMcpResultBytes);}
 async assets(root){return listFigmaMcpImages(root,validateFigmaMcpResultBytes);}
 async recoverAsset(root,name,signal,current){return recoverFigmaMcpImage(root,name,signal,current,validateFigmaMcpResultBytes);}
 async openImage(root,sessionId,assetId,key,signal){return openFigmaMcpImage(this.manager,root,sessionId,assetId,key,signal,validateFigmaMcpResultBytes);}
 async reconcile(root,id,signal,current){return reconcileFigmaMcpImage(this.manager,root,id,signal,current,validateFigmaMcpResultBytes);}
 save(record){
  const {root,...value}=record;validateFigmaMcpJob(value);mkdirSync(dir(root),{recursive:true});const path=pathFor(root,record.id),temp=path+'.tmp-'+randomUUID();
  try{writeFileSync(temp,encode(value),{flag:'wx'});renameSync(temp,path);}finally{try{if(existsSync(temp))unlinkSync(temp);}catch{}}
  try{this.onChange(root,{kind:'figmamcp-job',id:record.id,status:record.status});}catch{}
 }
 load(root,id){
  root=store.validateRoot(root);const path=pathFor(root,id);if(!existsSync(path))throw new SafetyError('Figma MCP 任务不存在',404);if(statSync(path).size>32768)throw new SafetyError('Figma MCP 任务记录超过预算',413);
  let value;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{throw new SafetyError('Figma MCP 任务记录不是有效 JSON',409);}validateFigmaMcpJob(value);if(value.id!==id)throw new SafetyError('Figma MCP 任务身份不一致',409);
  const record={...value,root};if(['queued','running'].includes(record.status)&&!alive(record.ownerPid)){record.status='interrupted';record.error=record.remoteState==='not_dispatched'?'上次任务中断，未确认是否已发送。':'上次任务中断，远端状态未确认；不要自动重发。';this.save(record);}return record;
 }
 list(root){
  root=store.validateRoot(root);mkdirSync(dir(root),{recursive:true});const names=readdirSync(dir(root)).filter(name=>/^figmamcpjob-[a-f0-9]{64}\.json$/.test(name));if(names.length>2000)throw new SafetyError('Figma MCP 任务数量超过预算',413);
  return names.map(name=>{const {root:ignored,...job}=this.load(root,name.slice(0,-5));return job;}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 get(root,id){const {root:ignored,...job}=this.load(root,id);return job;}
 readResult(root,id,{offset=0,limit=12000}={}){
  root=store.validateRoot(root);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('Figma MCP 结果分页无效',422);
  const job=this.load(root,id);if(!job.resultAsset)throw new SafetyError('Figma MCP 任务没有已保存的结果',404);const bytes=store.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)throw new SafetyError('Figma MCP 结果缺失或摘要不一致',409);validateFigmaMcpResultBytes(bytes);
  const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {id,content:content.slice(offset,offset+limit),offset,totalCharacters:content.length,nextOffset:offset+limit<content.length?offset+limit:null,note:'这是已保存的脱敏结果；下载链接只在短期内存快照中存在。'};
 }
 async start(root,{tool,args,schemaSha256,operationId,savedHtmlTransfer=false},signal,assertCurrent){
  root=store.validateRoot(root);if(!WRITE.has(tool)||!HASH.test(schemaSha256||'')||!HASH.test(operationId||'')||typeof savedHtmlTransfer!=='boolean'||savedHtmlTransfer&&tool!=='html_to_figma')throw new SafetyError('Figma MCP 操作或身份无效',422);argsFor(args,{maxBytes:savedHtmlTransfer?FIGMA_HTML_MAX_REQUEST:256*1024});if(tool==='use_figma'&&(typeof args.skillNames!=='string'||!args.skillNames.split(',').map(item=>item.trim()).includes('figma-use')))throw new SafetyError('use_figma 需要读取官方 figma-use 指引并在 skillNames 中声明',422);
  const inputHash=identity({tool,args,schemaSha256}),id='figmamcpjob-'+operationId,path=pathFor(root,id);mkdirSync(dir(root),{recursive:true});
  if(existsSync(path)){const prior=this.get(root,id);if(prior.inputHash!==inputHash||prior.tool!==tool)throw new SafetyError('Figma MCP 操作身份冲突，未重复发送',409);return {accepted:true,reused:true,job:prior};}
  if(this.running.has(id)||this.running.size>=4)throw new SafetyError('已有 Figma MCP 任务运行中，请稍后重试',429);
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});let client;
  try{client=await this.connect(controller.signal);if(client.credentialValues().some(secret=>JSON.stringify(args).includes(secret)))throw new SafetyError('Figma MCP 参数包含当前凭据',422);schemaFor(await client.tools(),tool,schemaSha256);signal?.throwIfAborted();assertCurrent?.();}
  catch(error){signal?.removeEventListener('abort',abort);throw error;}
  const record={root,schema:1,kind:'figmamcp-job',id,ownerPid:process.pid,tool,schemaSha256,requestHash:identity({tool,args}),inputHash,status:'queued',remoteState:'not_dispatched',createdAt:new Date().toISOString()};const {root:ignored,...persisted}=record;validateFigmaMcpJob(persisted);
  if(!atomicCreate(path,encode(persisted))){signal?.removeEventListener('abort',abort);const prior=this.get(root,id);if(prior.inputHash!==inputHash||prior.tool!==tool)throw new SafetyError('Figma MCP 操作身份冲突，未重复发送',409);return {accepted:true,reused:true,job:prior};}
  signal?.removeEventListener('abort',abort);this.running.set(id,controller);queueMicrotask(()=>this.execute(record,args,client,controller,assertCurrent,savedHtmlTransfer).catch(()=>{}));return {accepted:true,job:persisted,note:'已保存本地任务，尚不能表示远端已经完成。'};
 }
 async execute(record,args,client,controller,assertCurrent,savedHtmlTransfer=false){
  try{
   const result=unwrap(await client.call(record.tool,args,()=>{assertCurrent?.();record.status='running';record.remoteState='sent_or_uncertain';this.save(record);}));
   record.remoteState='responded';const snapshot=this.snapshot(record.root,record.tool,args,result,{jobId:record.id,secrets:client.sensitiveValues(),omitArgs:savedHtmlTransfer}),safe=this.snapshots.get(snapshot.snapshotId).content,bytes=Buffer.from(safe,'utf8'),digest=sha(bytes),asset=store.saveAsset(record.root,'figmamcp-result-'+digest.slice(0,24)+'.json',bytes);
   const receipt={schema:1,kind:'figmamcp-result-receipt',jobId:record.id,tool:record.tool,requestHash:record.requestHash,inputHash:record.inputHash,schemaSha256:record.schemaSha256,resultAsset:asset.name,resultSha256:digest,resultBytes:bytes.length};receipt.id='figmamcpresult-'+identity([receipt.jobId,receipt.requestHash,receipt.inputHash,receipt.resultSha256]);validateFigmaMcpResultReceipt(receipt);mkdirSync(resultDir(record.root),{recursive:true});const receiptPath=resultPath(record.root,receipt.id);
   if(!atomicCreate(receiptPath,encode(receipt))){const previous=JSON.parse(readFileSync(receiptPath,'utf8'));if(JSON.stringify(previous)!==JSON.stringify(receipt))throw new SafetyError('Figma MCP 结果回执冲突，原结果未覆盖',409);}
   record.resultAsset=asset.name;record.resultSha256=digest;record.resultBytes=bytes.length;record.snapshotId=snapshot.snapshotId;record.status='responded';record.finishedAt=new Date().toISOString();this.save(record);
  }catch(error){record.status=error.needsInput?'needs_input':record.remoteState!=='not_dispatched'?'unknown':controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted&&record.remoteState!=='not_dispatched'?'已停止本地等待；远端可能仍在处理，请先核对。':String(error.message||error).slice(0,500);record.finishedAt=new Date().toISOString();this.save(record);}
  finally{this.running.delete(record.id);}
 }
 recoverSaved(root,id,assertCurrent){
  root=store.validateRoot(root);if(!JOB.test(id||''))throw new SafetyError('Figma MCP 任务身份无效',422);if(this.running.has(id))throw new SafetyError('Figma MCP 任务仍在运行',423);const release=acquireRecovery(root,id);
  try{
   const job=this.load(root,id);if(['queued','running'].includes(job.status)&&alive(job.ownerPid))throw new SafetyError('Figma MCP 任务仍在其他进程运行',423);
   let names;try{names=readdirSync(resultDir(root));}catch(error){if(error.code==='ENOENT')names=[];else throw error;}if(names.length>3000)throw new SafetyError('Figma MCP 结果回执超过预算',413);
   const receipts=new Map();for(const name of names.filter(name=>/^figmamcpresult-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/.test(name))){
    const path=workspacePath(root,join(resultDir(root),name)),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('Figma MCP 结果回执无效',409);
    let row;try{row=JSON.parse(readFileSync(path,'utf8'));}catch{if(name.includes('.tmp-'))continue;throw new SafetyError('Figma MCP 结果回执损坏',409);}validateFigmaMcpResultReceipt(row);if(!name.startsWith(row.id+'.json'))throw new SafetyError('Figma MCP 结果回执身份不一致',409);if(row.jobId!==id)continue;
    if(row.tool!==job.tool||row.requestHash!==job.requestHash||row.inputHash!==job.inputHash||row.schemaSha256!==job.schemaSha256)throw new SafetyError('Figma MCP 结果回执与任务不一致',409);
    const bytes=store.readAsset(root,row.resultAsset);if(!bytes||bytes.length!==row.resultBytes||sha(bytes)!==row.resultSha256)throw new SafetyError('Figma MCP 已保存结果缺失或改变',409);validateFigmaMcpResultBytes(bytes);const prior=receipts.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw new SafetyError('Figma MCP 结果回执冲突',409);receipts.set(row.id,row);
   }
   if(receipts.size!==1)throw new SafetyError(receipts.size?'Figma MCP 任务存在多个不同结果，请核对后处理':'没有可恢复的已保存 Figma MCP 结果；不会重新提交远端操作',409);
   const receipt=[...receipts.values()][0];assertCurrent?.();if(!atomicCreate(resultPath(root,receipt.id),encode(receipt))){const prior=JSON.parse(readFileSync(resultPath(root,receipt.id),'utf8'));if(JSON.stringify(prior)!==JSON.stringify(receipt))throw new SafetyError('Figma MCP 结果回执冲突，未覆盖',409);}
   if(job.status==='responded'&&job.resultSha256===receipt.resultSha256&&job.resultAsset===receipt.resultAsset&&job.resultBytes===receipt.resultBytes){this.readResult(root,id);return {job:this.get(root,id),alreadySaved:true};}
   assertCurrent?.();job.resultAsset=receipt.resultAsset;job.resultSha256=receipt.resultSha256;job.resultBytes=receipt.resultBytes;job.remoteState='responded';job.status='responded';job.recoveredFromReceipt=receipt.id;job.finishedAt=new Date().toISOString();delete job.error;delete job.snapshotId;this.save(job);
   return {job:this.get(root,id),recovered:true,note:'仅恢复已保存的脱敏结果，没有重发远端操作；短期内容需重新读取。'};
  }finally{release();}
 }
 stop(root,id){const record=this.load(root,id),controller=this.running.get(record.id);if(!controller||!['queued','running'].includes(record.status))return false;controller.abort();return true;}
 dispose(){this.closed=true;for(const controller of this.running.values())controller.abort();this.snapshots.clear();}
}
