/** PixelBin image predictions with explicit cost estimate and durable identity. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';
import {canonicalModelData,inspectModelInput} from './fal-workflow-service.js';
import {StitchMcp} from './stitch-mcp.js';
import {PixelbinOAuth} from './pixelbin-oauth.js';
import {pixelbinCandidates,savePixelbinAsset,listPixelbinAssets,listPixelbinImports,pendingPixelbinAssets,recoverPixelbinAsset,openPixelbinImage,reconcilePixelbinImage} from './pixelbin-source.js';

const READ=new Set(['list-predictions','get-prediction']);
const TOOLS=new Set([...READ,'estimate-prediction-cost','create-prediction','request-upload-url','save-prediction-to-storage']);
const JOB=/^pixeljob-[a-f0-9]{64}$/,ACCEPT=/^pixelaccept-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/,SNAP=/^pixelsnapshot-[a-f0-9-]{36}$/,ESTIMATE=/^pixelestimate-[a-f0-9-]{36}$/,PRED=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>sha(Buffer.from(canonicalModelData(value)));
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const folder=root=>workspacePath(root,'design/.designcraft/pixelbin-jobs');
const file=(root,id)=>{if(!JOB.test(id||''))throw new SafetyError('PixelBin 任务身份无效',422);return workspacePath(root,join(folder(root),id+'.json'));};
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
function safeOutput(value,secrets=[]){
 const hidden=secrets.filter(item=>typeof item==='string'&&item.length>0&&item.length<=8192);
 let nodes=0,redacted=false;const walk=(item,depth)=>{
  if(++nodes>100000||depth>48)throw new SafetyError('PixelBin 结果结构超过预算',413);
  if(typeof item==='string'){
   if(/^data:/i.test(item)){redacted=true;return '[内嵌数据已隐藏]';}let text=item;if(text.length>100000){text=text.slice(0,100000);redacted=true;}
   let clean=text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"<>]+/gi,'[链接已隐藏]').replace(/(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|\b(?:api[_-]?key|access[_-]?token|confirmation[_-]?token|client[_-]?secret)\b['"]?\s*[:=]\s*['"]?[^\s'",}]{8,}|sk-[A-Za-z0-9_-]{20,}/gi,'[已隐藏]');for(const secret of hidden)if(clean.includes(secret))clean=clean.split(secret).join('[已隐藏]');if(clean!==text)redacted=true;return clean;
  }
  if(item===null||typeof item==='boolean'||typeof item==='number')return item;if(Array.isArray(item))return item.map(child=>walk(child,depth+1));
  if(item&&typeof item==='object'){
   const out=Object.create(null);for(const [key,child]of Object.entries(item)){
    if(['__proto__','constructor','prototype'].includes(key))throw new SafetyError('PixelBin 返回不安全字段',422);
    const privateKey=/^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|confirmation[_-]?token|client[_-]?secret|device[_-]?code|uploadUrl|downloadUrl|signedUrl|headers)$/i.test(key),unsafeKey=/(?:https?:\/\/|^data:|sk-[A-Za-z0-9_-]{20,})/i.test(key)||hidden.some(secret=>key.includes(secret)),safeKey=unsafeKey?'[隐藏字段-'+sha(Buffer.from(key)).slice(0,16)+']':key;
    const inlineBinary=key==='data'&&typeof child==='string'&&(item.type==='image'||child.length>1024&&/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(child));
    if(unsafeKey)redacted=true;if(privateKey){out[safeKey]='[已隐藏]';redacted=true;}else if(inlineBinary){out[safeKey]='[内嵌数据已隐藏]';redacted=true;}else out[safeKey]=walk(child,depth+1);
   }return out;
  }
  throw new SafetyError('PixelBin 返回不支持的数据',502);
 };const data=walk(value,0);assertSafeJson(data);return {data,redacted};
}
export function validatePixelbinResultBytes(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)throw new SafetyError('PixelBin 结果大小无效',409);
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SafetyError('PixelBin 结果不是有效 JSON',409);}const safe=safeOutput(value);if(JSON.stringify(safe.data)!==JSON.stringify(value))throw new SafetyError('PixelBin 结果含未处理的链接或敏感数据',409);return true;
}
function unwrap(result){
 if(!result||typeof result!=='object'||Array.isArray(result))throw new SafetyError('PixelBin MCP 结果无效',502);
 if(result.resultType==='input_required')throw new SafetyError('PixelBin 要求额外交互，当前不会自动确认或重发',409);
 if(result.isError)throw new SafetyError('PixelBin 工具报告失败；远端状态可能需要核对',502);
 if(result.structuredContent!==undefined)return result.structuredContent;
 const text=Array.isArray(result.content)?result.content.find(item=>item?.type==='text'&&typeof item.text==='string')?.text:undefined;if(text!==undefined){try{return JSON.parse(text);}catch{return text;}}return result;
}
function argsFor(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new SafetyError('PixelBin 参数必须是对象',422);assertSafeJson(value);const raw=JSON.stringify(value);if(Buffer.byteLength(raw)>256*1024)throw new SafetyError('PixelBin 参数超过预算',413);
 if(/(?:Bearer\s+[A-Za-z0-9_.:-]{20,}|sk-[A-Za-z0-9_-]{20,}|\bconfirmation[_-]?token\b)/i.test(raw))throw new SafetyError('请勿在 PixelBin 参数中填写令牌',422);
 try{inspectModelInput(value);}catch(error){throw new SafetyError(String(error.message||error).replace(/fal/gi,'PixelBin'),error.status||422);}return value;
}
function schemaFor(tools,name,expected){const item=tools.find(tool=>tool.name===name);if(!item)throw new SafetyError('当前 PixelBin 目录未提供该工具',422);const hash=identity(item.inputSchema);if(expected&&hash!==expected)throw new SafetyError('PixelBin 工具 schema 已改变，请重新查看',409);return {item,hash};}
function exactKey(value,names){
 const found=[];let nodes=0;const stack=[{value,depth:0}];while(stack.length){const item=stack.pop();if(++nodes>100000||item.depth>48)throw new SafetyError('PixelBin 结果结构超过预算',413);if(!item.value||typeof item.value!=='object')continue;
  for(const [key,child]of Object.entries(item.value)){if(names.includes(key)&&typeof child==='string'&&child)found.push(child);else if(child&&typeof child==='object')stack.push({value:child,depth:item.depth+1});}}
 return [...new Set(found)];
}
function predictionId(payload){const ids=[...new Set([...exactKey(payload,['prediction_id','predictionId']),...[payload?._id,payload?.prediction?._id].filter(id=>typeof id==='string'&&id)])];if(ids.length>1||ids.some(id=>!PRED.test(id)))throw new SafetyError('PixelBin 返回多个或无效的预测身份',502);return ids[0]||null;}
function remoteStatus(payload){const values=[payload?.status,payload?.prediction?.status].filter(value=>typeof value==='string').map(value=>value.toUpperCase()),unique=[...new Set(values)];return unique.length===1&&['ACCEPTED','RUNNING','SUCCESS','FAILURE'].includes(unique[0])?unique[0]:null;}
export function validatePixelbinAssetResponse(row,bytes){
 validatePixelbinResultBytes(bytes);let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SafetyError('PixelBin 图片响应不是有效 JSON',409);}const id=predictionId(payload);if(!PRED.test(row?.predictionId||'')||id&&id!==row.predictionId||remoteStatus(payload)!=='SUCCESS')throw new SafetyError('PixelBin 图片来源响应没有匹配的成功状态',409);
 if(!Array.isArray(row.sourcePath)||!row.sourcePath.some(part=>typeof part==='string'&&/^(?:output|outputs|result|results)$/i.test(part)))throw new SafetyError('PixelBin 图片响应缺少输出路径',409);let candidate=payload;for(const part of row.sourcePath){if(!candidate||typeof candidate!=='object'||!Object.hasOwn(candidate,part))throw new SafetyError('PixelBin 图片输出路径与响应不一致',409);candidate=candidate[part];}if(!['[链接已隐藏]','[已隐藏]'].includes(candidate))throw new SafetyError('PixelBin 图片输出路径不是已隐藏的服务地址',409);return true;
}
function acquire(root,id){
 if(!JOB.test(id||''))throw new SafetyError('PixelBin 任务身份无效',422);mkdirSync(folder(root),{recursive:true});const token=randomUUID(),prefix='pixelrecover-'+id+'-',name=prefix+token+'.json',path=workspacePath(root,join(folder(root),name)),body=JSON.stringify({pid:process.pid,id,token});
 if(!atomicCreate(path,body))throw new SafetyError('PixelBin 恢复记录冲突',409);const release=()=>{try{const info=lstatSync(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<4096&&readFileSync(path,'utf8')===body)unlinkSync(path);}catch{}};
 try{const peers=readdirSync(folder(root)).filter(item=>item.startsWith(prefix)&&item.endsWith('.json'));if(peers.length>200)throw new SafetyError('PixelBin 恢复记录超过预算',413);for(const peer of peers){if(peer===name)continue;const target=workspacePath(root,join(folder(root),peer)),info=lstatSync(target);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('PixelBin 恢复记录无效',409);let other;try{other=JSON.parse(readFileSync(target,'utf8'));}catch{throw new SafetyError('PixelBin 恢复记录无法读取',409);}if(other.id!==id||!Number.isSafeInteger(other.pid)||typeof other.token!=='string')throw new SafetyError('PixelBin 恢复记录无效',409);if(alive(other.pid))throw new SafetyError('PixelBin 任务正在另一流程中',423);}return release;}catch(error){release();throw error;}
}
export function validatePixelbinJob(job){
 assertSafeJson(job);const allowed=['schema','kind','id','ownerPid','plugin','operation','schemaSha256','inputHash','estimateHash','status','remoteState','predictionId','remoteStatus','createdAt','finishedAt','resultAsset','resultSha256','resultBytes','snapshotId','error'];
 if(!job||Object.keys(job).some(key=>!allowed.includes(key))||job.schema!==1||job.kind!=='pixelbin-job'||!JOB.test(job.id||'')||typeof job.plugin!=='string'||!/^[A-Za-z0-9._-]{1,150}$/.test(job.plugin)||typeof job.operation!=='string'||!/^[A-Za-z0-9._-]{1,150}$/.test(job.operation)||!HASH.test(job.schemaSha256||'')||!HASH.test(job.inputHash||'')||!HASH.test(job.estimateHash||'')||!['queued','running','accepted','responded_no_id','ready','failed','cancelled','interrupted','unknown'].includes(job.status)||!['not_dispatched','sent_or_uncertain','accepted','responded'].includes(job.remoteState)||typeof job.createdAt!=='string'||!/^[0-9T:.Z-]{24}$/.test(job.createdAt))throw new SafetyError('PixelBin 任务记录无效',409);
 if(job.ownerPid!==undefined&&(!Number.isSafeInteger(job.ownerPid)||job.ownerPid<1)||job.predictionId!==undefined&&!PRED.test(job.predictionId)||job.remoteStatus!==undefined&&!['ACCEPTED','RUNNING','SUCCESS','FAILURE'].includes(job.remoteStatus)||['accepted','ready'].includes(job.status)&&!PRED.test(job.predictionId||'')||job.status==='ready'&&job.remoteStatus!=='SUCCESS')throw new SafetyError('PixelBin 远端状态记录无效',409);
 if(job.resultAsset!==undefined&&(typeof job.resultAsset!=='string'||!/^pixelbin-result-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.json$/.test(job.resultAsset)||!HASH.test(job.resultSha256||'')||!Number.isSafeInteger(job.resultBytes)||job.resultBytes<1||job.resultBytes>8*1024*1024)||job.resultAsset===undefined&&(job.resultSha256!==undefined||job.resultBytes!==undefined))throw new SafetyError('PixelBin 结果记录无效',409);
 if(job.snapshotId!==undefined&&!SNAP.test(job.snapshotId)||job.error!==undefined&&(typeof job.error!=='string'||job.error.length>500||/(?:https?:\/\/|Bearer\s+[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(job.error)))throw new SafetyError('PixelBin 任务记录含无效内容',409);return true;
}
export function validatePixelbinAcceptance(row){
 assertSafeJson(row);const allowed=['schema','kind','id','jobId','plugin','operation','schemaSha256','inputHash','estimateHash','predictionId'];
 if(!row||Object.keys(row).some(key=>!allowed.includes(key))||row.schema!==1||row.kind!=='pixelbin-acceptance'||!ACCEPT.test(row.id||'')||!JOB.test(row.jobId||'')||!/^[A-Za-z0-9._-]{1,150}$/.test(row.plugin||'')||!/^[A-Za-z0-9._-]{1,150}$/.test(row.operation||'')||!HASH.test(row.schemaSha256||'')||!HASH.test(row.inputHash||'')||!HASH.test(row.estimateHash||'')||!PRED.test(row.predictionId||'')||row.id!=='pixelaccept-'+identity([row.jobId,row.inputHash,row.predictionId]))throw new SafetyError('PixelBin 接收回执无效',409);return true;
}

export class PixelbinService{
 constructor(ctx,manager,onChange=()=>{}){this.ctx=ctx;this.manager=manager;this.oauth=new PixelbinOAuth(ctx);this.onChange=onChange;this.snapshots=new Map();this.estimates=new Map();this.running=new Map();this.closed=false;}
 async connect(signal){if(this.closed)throw new SafetyError('PixelBin 服务已停止',503);const token=await this.oauth.accessToken(signal);return {client:await StitchMcp.connectPixelbin(token,signal),credentialHash:sha(Buffer.from(token))};}
 snapshot(root,tool,args,payload,{jobId,predictionId,secrets=[]}={}){
  const safe=safeOutput(payload,secrets),content=JSON.stringify(safe.data,null,2);if(Buffer.byteLength(content)>8*1024*1024)throw new SafetyError('PixelBin 快照超过预算',413);const id='pixelsnapshot-'+randomUUID();
  this.snapshots.set(id,{root,tool,args,payload,content,secrets:secrets.filter(value=>typeof value==='string'&&value),...(jobId?{jobId}:{}),...(predictionId?{predictionId}:{}),...(tool==='get-prediction'?{remoteStatus:remoteStatus(payload)}:{}),at:Date.now()});while(this.snapshots.size>5)this.snapshots.delete(this.snapshots.keys().next().value);const timer=setTimeout(()=>this.snapshots.delete(id),5*60*1000);timer.unref?.();return {snapshotId:id,redacted:safe.redacted,totalCharacters:content.length};
 }
 async catalog(signal){
  const {client}=await this.connect(signal),items=[];for(const tool of await client.tools())if(TOOLS.has(tool.name)){const safe=safeOutput({name:tool.name,description:typeof tool.description==='string'?tool.description:'',inputSchema:tool.inputSchema},client.sensitiveValues());items.push({...safe.data,schemaSha256:identity(tool.inputSchema),redacted:safe.redacted});}
  return {items,note:'仅显示当前 PixelBin 服务实际返回的已接入工具；描述和参数可能脱敏，目录不代表账号权限或任务成功。'};
 }
 async read(root,{tool,args,schemaSha256},signal){
  root=store.validateRoot(root);if(!READ.has(tool)||!HASH.test(schemaSha256||''))throw new SafetyError('请选择 PixelBin 只读工具和实际 schema',422);argsFor(args);
  if(tool==='get-prediction'&&Object.hasOwn(args,'prediction_id')&&Object.hasOwn(args,'predictionId'))throw new SafetyError('PixelBin 预测 ID 参数不能重复',422);const requested=tool==='get-prediction'?(args.prediction_id??args.predictionId):null;if(tool==='get-prediction'&&!PRED.test(requested||''))throw new SafetyError('请输入实际 PixelBin 预测 ID',422);
  const {client}=await this.connect(signal),tools=await client.tools();if(client.credentialValues().some(secret=>JSON.stringify(args).includes(secret)))throw new SafetyError('PixelBin 参数包含当前凭据',422);schemaFor(tools,tool,schemaSha256);const payload=unwrap(await client.call(tool,args));signal?.throwIfAborted();if(requested){const returned=predictionId(payload);if(returned&&returned!==requested)throw new SafetyError('PixelBin 返回的预测身份不一致',409);}return {...this.snapshot(root,tool,args,payload,{secrets:client.sensitiveValues(),...(requested?{predictionId:requested}:{})}),tool,note:'结果来自 PixelBin，链接和凭据已隐藏；没有生成或修改素材。'};
 }
 readSnapshot(root,id,{offset=0,limit=12000}={}){
  root=store.validateRoot(root);if(!SNAP.test(id||'')||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('PixelBin 快照分页无效',422);const snapshot=this.snapshots.get(id);if(!snapshot||snapshot.root!==root||Date.now()-snapshot.at>5*60*1000)throw new SafetyError('PixelBin 快照已过期，请重新读取',404);
  return {snapshotId:id,tool:snapshot.tool,content:snapshot.content.slice(offset,offset+limit),offset,totalCharacters:snapshot.content.length,nextOffset:offset+limit<snapshot.content.length?offset+limit:null};
 }
 candidates(root,id){root=store.validateRoot(root);const snapshot=this.snapshots.get(id);if(!SNAP.test(id||'')||!snapshot||snapshot.root!==root||Date.now()-snapshot.at>5*60*1000)throw new SafetyError('PixelBin 快照已过期，请重新查询',404);return {snapshotId:id,items:pixelbinCandidates(snapshot).map(({candidateId,path})=>({candidateId,path})),note:'仅列出成功响应中的实际输出地址；尚未下载或确认图片格式。'};}
 async capture(root,id,candidateId,signal,assertCurrent){root=store.validateRoot(root);const snapshot=this.snapshots.get(id);if(!SNAP.test(id||'')||!snapshot||snapshot.root!==root||Date.now()-snapshot.at>5*60*1000)throw new SafetyError('PixelBin 快照已过期，请重新查询',404);return savePixelbinAsset(root,snapshot,candidateId,signal,assertCurrent,validatePixelbinAssetResponse,validatePixelbinJob);}
 async assets(root){const items=await listPixelbinAssets(root,validatePixelbinJob);for(const item of items)validatePixelbinAssetResponse(item.row,item.responseBytes);return {items:items.map(item=>item.row),pending:await pendingPixelbinAssets(root,validatePixelbinAssetResponse,validatePixelbinJob),imports:await listPixelbinImports(root)};}
 async recoverAsset(root,name,signal,assertCurrent){return recoverPixelbinAsset(root,name,signal,assertCurrent,validatePixelbinAssetResponse,validatePixelbinJob);}
 async open(root,sessionId,assetId,operationKey,signal){return openPixelbinImage(this.manager,root,sessionId,assetId,operationKey,signal,validatePixelbinAssetResponse,validatePixelbinJob);}
 async reconcile(root,id,signal,assertCurrent){return reconcilePixelbinImage(this.manager,root,id,signal,assertCurrent,validatePixelbinAssetResponse,validatePixelbinJob);}
 async estimate(root,{args,schemaSha256},signal){
  root=store.validateRoot(root);if(!HASH.test(schemaSha256||''))throw new SafetyError('请先读取 PixelBin 费用工具 schema',422);argsFor(args);
  if(!/^[A-Za-z0-9._-]{1,150}$/.test(args.plugin||'')||!/^[A-Za-z0-9._-]{1,150}$/.test(args.operation||'')||args.count!==undefined&&args.count!==1||args.inputs!==undefined&&(!args.inputs||typeof args.inputs!=='object'||Array.isArray(args.inputs)))throw new SafetyError('费用估算需要一个实际插件、操作及对应输入',422);
  const {client,credentialHash}=await this.connect(signal);if(client.credentialValues().some(secret=>JSON.stringify(args).includes(secret)))throw new SafetyError('PixelBin 参数包含当前凭据',422);schemaFor(await client.tools(),'estimate-prediction-cost',schemaSha256);const payload=unwrap(await client.call('estimate-prediction-cost',args));signal?.throwIfAborted();
  const tokens=exactKey(payload,['confirmation_token','confirmationToken']);if(tokens.length!==1||tokens[0].length<8||tokens[0].length>8192||/[\x00-\x20\x7f]/.test(tokens[0]))throw new SafetyError('PixelBin 没有返回唯一可用的费用确认令牌，未提交任务',422);
  const safe=safeOutput(payload,[...client.sensitiveValues(),tokens[0]]),summary=JSON.stringify(safe.data,null,2);if(Buffer.byteLength(summary)>256*1024)throw new SafetyError('PixelBin 费用结果超过预算',413);
  const id='pixelestimate-'+randomUUID(),fingerprint=identity({plugin:args.plugin,operation:args.operation,input:args.inputs||{}}),estimateHash=identity({fingerprint,summary:safe.data,schemaSha256});this.estimates.set(id,{root,credentialHash,fingerprint,estimateHash,token:tokens[0],at:Date.now(),consumed:false});while(this.estimates.size>20)this.estimates.delete(this.estimates.keys().next().value);const timer=setTimeout(()=>this.estimates.delete(id),5*60*1000);timer.unref?.();
  return {estimateId:id,estimateHash,summary:safe.data,expiresInMs:5*60*1000,note:'请根据实际费用决定是否提交；确认令牌仅在短期服务端内存，不进入项目。'};
 }
 save(record){const {root,...value}=record;validatePixelbinJob(value);mkdirSync(folder(root),{recursive:true});const path=file(root,record.id),temp=path+'.tmp-'+randomUUID();try{writeFileSync(temp,encode(value),{flag:'wx'});renameSync(temp,path);}finally{try{if(existsSync(temp))unlinkSync(temp);}catch{}}try{this.onChange(root,{kind:'pixelbin-job',id:record.id,status:record.status});}catch{}}
 load(root,id){
  root=store.validateRoot(root);const path=file(root,id);if(!existsSync(path))throw new SafetyError('PixelBin 任务不存在',404);if(statSync(path).size>32768)throw new SafetyError('PixelBin 任务记录超过预算',413);let value;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{throw new SafetyError('PixelBin 任务记录无效',409);}validatePixelbinJob(value);if(value.id!==id)throw new SafetyError('PixelBin 任务身份不一致',409);const record={...value,root};if(['queued','running'].includes(record.status)&&!alive(record.ownerPid)){record.status='interrupted';record.error='上次运行中断，远端状态未确认；不要自动重发。';this.save(record);}return record;
 }
 list(root){root=store.validateRoot(root);mkdirSync(folder(root),{recursive:true});const names=readdirSync(folder(root)).filter(name=>/^pixeljob-[a-f0-9]{64}\.json$/.test(name));if(names.length>2000)throw new SafetyError('PixelBin 任务数量超过预算',413);return names.map(name=>{const {root:ignored,...job}=this.load(root,name.slice(0,-5));return job;}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 get(root,id){const {root:ignored,...job}=this.load(root,id);return job;}
 readResult(root,id,{offset=0,limit=12000}={}){root=store.validateRoot(root);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('PixelBin 结果分页无效',422);const job=this.load(root,id);if(!job.resultAsset)throw new SafetyError('PixelBin 任务没有已保存的结果',404);const bytes=store.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)throw new SafetyError('PixelBin 结果缺失或改变',409);validatePixelbinResultBytes(bytes);const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {id,content:content.slice(offset,offset+limit),offset,totalCharacters:content.length,nextOffset:offset+limit<content.length?offset+limit:null};}
 async start(root,{args,schemaSha256,estimateId,operationId},signal,assertCurrent){
  root=store.validateRoot(root);if(!HASH.test(schemaSha256||'')||!HASH.test(operationId||''))throw new SafetyError('PixelBin 请求身份无效',422);argsFor(args);
  if(!/^[A-Za-z0-9._-]{1,150}$/.test(args.plugin||'')||!/^[A-Za-z0-9._-]{1,150}$/.test(args.operation||'')||!args.input||typeof args.input!=='object'||Array.isArray(args.input))throw new SafetyError('PixelBin 预测参数无效',422);
  const id='pixeljob-'+operationId,path=file(root,id);mkdirSync(folder(root),{recursive:true});
  if(existsSync(path)){const prior=this.get(root,id),expected=identity({args,schemaSha256,estimateHash:prior.estimateHash});if(prior.inputHash!==expected)throw new SafetyError('PixelBin 操作身份冲突，未重复发送',409);return {accepted:true,reused:true,job:prior};}
  if(!ESTIMATE.test(estimateId||''))throw new SafetyError('请先取得 PixelBin 费用估算',422);
  const estimate=this.estimates.get(estimateId),fingerprint=identity({plugin:args.plugin,operation:args.operation,input:args.input});if(!estimate||estimate.root!==root||estimate.consumed||Date.now()-estimate.at>5*60*1000||estimate.fingerprint!==fingerprint)throw new SafetyError('费用估算已过期、已使用或与本次输入不一致，请重新估算',409);
  const inputHash=identity({args,schemaSha256,estimateHash:estimate.estimateHash});
  if(this.running.has(root+'|'+id)||this.running.size>=4)throw new SafetyError('已有 PixelBin 任务运行中',429);
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});let connection;
  try{connection=await this.connect(controller.signal);if(connection.credentialHash!==estimate.credentialHash)throw new SafetyError('PixelBin 授权已改变，请重新估算',409);if(connection.client.credentialValues().some(secret=>JSON.stringify(args).includes(secret)))throw new SafetyError('PixelBin 参数包含当前凭据',422);schemaFor(await connection.client.tools(),'create-prediction',schemaSha256);signal?.throwIfAborted();assertCurrent?.();}catch(error){signal?.removeEventListener('abort',abort);throw error;}
  const record={root,schema:1,kind:'pixelbin-job',id,ownerPid:process.pid,plugin:args.plugin,operation:args.operation,schemaSha256,inputHash,estimateHash:estimate.estimateHash,status:'queued',remoteState:'not_dispatched',createdAt:new Date().toISOString()},{root:ignored,...persisted}=record;validatePixelbinJob(persisted);
  if(!atomicCreate(path,encode(persisted))){signal?.removeEventListener('abort',abort);const prior=this.get(root,id);if(prior.inputHash!==inputHash)throw new SafetyError('PixelBin 操作身份冲突，未重复发送',409);return {accepted:true,reused:true,job:prior};}
  signal?.removeEventListener('abort',abort);this.running.set(root+'|'+id,controller);queueMicrotask(()=>this.submit(record,args,estimate,connection.client,controller,assertCurrent).catch(()=>{}));return {accepted:true,job:persisted,note:'本地请求已记录；尚不能表示 PixelBin 已接受或完成。'};
 }
 async submit(record,args,estimate,client,controller,assertCurrent){
  try{
   const payload=unwrap(await client.call('create-prediction',{...args,confirmation_token:estimate.token},()=>{assertCurrent?.();if(estimate.consumed)throw new SafetyError('费用确认已使用',409);estimate.consumed=true;record.status='running';record.remoteState='sent_or_uncertain';this.save(record);}));
   const id=predictionId(payload),secrets=[...client.sensitiveValues(),estimate.token];if(id&&secrets.some(secret=>id.includes(secret)))throw new SafetyError('PixelBin 返回的预测身份无效',502);
   if(id){const receipt={schema:1,kind:'pixelbin-acceptance',jobId:record.id,plugin:record.plugin,operation:record.operation,schemaSha256:record.schemaSha256,inputHash:record.inputHash,estimateHash:record.estimateHash,predictionId:id};receipt.id='pixelaccept-'+identity([receipt.jobId,receipt.inputHash,receipt.predictionId]);validatePixelbinAcceptance(receipt);const path=workspacePath(record.root,join(folder(record.root),receipt.id+'.json'));if(!atomicCreate(path,encode(receipt))){let prior;try{prior=JSON.parse(readFileSync(path,'utf8'));}catch{throw new SafetyError('PixelBin 接收回执损坏，未覆盖',409);}if(JSON.stringify(prior)!==JSON.stringify(receipt))throw new SafetyError('PixelBin 接收回执冲突，未覆盖',409);}record.predictionId=id;record.remoteState='accepted';record.status='accepted';this.save(record);}
   const snap=this.snapshot(record.root,'create-prediction',args,payload,{jobId:record.id,secrets,...(id?{predictionId:id}:{})}),bytes=Buffer.from(this.snapshots.get(snap.snapshotId).content),digest=sha(bytes),asset=store.saveAsset(record.root,'pixelbin-result-'+digest.slice(0,24)+'.json',bytes);
   if(!id){record.remoteState='responded';record.status='responded_no_id';record.error='服务已响应但未识别到唯一预测 ID，请核对远端；不会自动重发。';}
   record.resultAsset=asset.name;record.resultSha256=digest;record.resultBytes=bytes.length;record.snapshotId=snap.snapshotId;record.finishedAt=new Date().toISOString();this.save(record);
  }catch(error){record.status=record.remoteState==='accepted'?'accepted':record.remoteState==='sent_or_uncertain'?'unknown':controller.signal.aborted?'cancelled':'failed';record.error=record.remoteState==='accepted'?'已保留预测 ID；后续结果处理未完成，请查询该预测。':controller.signal.aborted&&record.remoteState==='sent_or_uncertain'?'本地已停止等待；远端可能仍在处理或计费。':String(error.message||error).slice(0,500);record.finishedAt=new Date().toISOString();this.save(record);}
  finally{this.running.delete(record.root+'|'+record.id);}
 }
 async refresh(root,id,schemaSha256,signal,assertCurrent){
  root=store.validateRoot(root);if(!JOB.test(id||'')||!HASH.test(schemaSha256||'')||this.running.has(root+'|'+id))throw new SafetyError('PixelBin 任务身份无效或仍在运行',409);const release=acquire(root,id);
  try{
   const job=this.load(root,id);if(['queued','running'].includes(job.status)&&alive(job.ownerPid))throw new SafetyError('PixelBin 任务仍在其他进程运行',423);
   const names=readdirSync(folder(root)).filter(name=>/^pixelaccept-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/.test(name));if(names.length>3000)throw new SafetyError('PixelBin 接收回执超过预算',413);const ids=new Set(),receipts=new Map();
   for(const name of names){const path=workspacePath(root,join(folder(root),name)),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('PixelBin 接收回执无效',409);let row;try{row=JSON.parse(readFileSync(path,'utf8'));}catch{if(name.includes('.tmp-'))continue;throw new SafetyError('PixelBin 接收回执损坏',409);}validatePixelbinAcceptance(row);if(!name.startsWith(row.id+'.json'))throw new SafetyError('PixelBin 接收回执身份不一致',409);if(row.jobId!==id)continue;if(row.plugin!==job.plugin||row.operation!==job.operation||row.inputHash!==job.inputHash||row.schemaSha256!==job.schemaSha256||row.estimateHash!==job.estimateHash||job.predictionId&&job.predictionId!==row.predictionId)throw new SafetyError('PixelBin 接收回执与任务不一致',409);ids.add(row.predictionId);const prior=receipts.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw new SafetyError('PixelBin 接收回执冲突',409);receipts.set(row.id,row);}
   if(ids.size!==1)throw new SafetyError(ids.size?'PixelBin 任务存在多个预测 ID，请先核对':'没有可核对的预测 ID；不会重新提交',409);const prediction=[...ids][0],receipt=[...receipts.values()][0];assertCurrent?.();const receiptPath=workspacePath(root,join(folder(root),receipt.id+'.json'));if(!atomicCreate(receiptPath,encode(receipt))){let previous;try{previous=JSON.parse(readFileSync(receiptPath,'utf8'));}catch{throw new SafetyError('PixelBin 接收回执损坏，未覆盖',409);}if(JSON.stringify(previous)!==JSON.stringify(receipt))throw new SafetyError('PixelBin 接收回执冲突，未覆盖',409);}
   const {client}=await this.connect(signal),spec=schemaFor(await client.tools(),'get-prediction',schemaSha256).item.inputSchema,properties=spec.properties&&typeof spec.properties==='object'?spec.properties:{},fields=['prediction_id','predictionId'].filter(name=>Object.hasOwn(properties,name));
   if(fields.length!==1)throw new SafetyError('PixelBin 查询 schema 的预测 ID 字段不受支持',422);const args={[fields[0]]:prediction},payload=unwrap(await client.call('get-prediction',args));signal?.throwIfAborted();assertCurrent?.();const returnedId=predictionId(payload);if(returnedId&&returnedId!==prediction)throw new SafetyError('PixelBin 返回的预测身份不一致',409);
   const status=remoteStatus(payload),snap=this.snapshot(root,'get-prediction',args,payload,{jobId:id,predictionId:prediction,secrets:client.sensitiveValues()}),bytes=Buffer.from(this.snapshots.get(snap.snapshotId).content),digest=sha(bytes),asset=store.saveAsset(root,'pixelbin-result-'+digest.slice(0,24)+'.json',bytes);
   job.predictionId=prediction;job.remoteState='accepted';job.status='accepted';if(status)job.remoteStatus=status;else delete job.remoteStatus;job.resultAsset=asset.name;job.resultSha256=digest;job.resultBytes=bytes.length;job.snapshotId=snap.snapshotId;job.finishedAt=new Date().toISOString();delete job.error;this.save(job);
   return {job:this.get(root,id),snapshotId:snap.snapshotId,note:(returnedId?'服务返回的预测身份已对照。':'结果来自指定预测请求，响应未明确包含可核对的预测 ID。')+(status?'服务状态为 '+status+'。':'服务状态未识别，未推断完成。')};
  }finally{release();}
 }
 stop(root,id){root=store.validateRoot(root);const controller=this.running.get(root+'|'+id);if(!controller)return false;controller.abort();return true;}
 dispose(){this.closed=true;for(const controller of this.running.values())controller.abort();this.oauth.dispose();this.snapshots.clear();this.estimates.clear();}
}
export {safeOutput as sanitizePixelbinOutput,unwrap as unwrapPixelbinMcp,schemaFor as findPixelbinSchema,argsFor as validatePixelbinArgs};
