/** Explicit Stitch design operations in the owning DSH project. */
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';
import {canonicalModelData,inspectModelInput} from './fal-workflow-service.js';
import {StitchMcp} from './stitch-mcp.js';
import {stitchAssetCandidates,saveStitchAsset,openStitchHtml,listStitchAssets,pendingStitchAssets,recoverStitchAsset} from './stitch-source.js';

const READ=new Set(['list_projects','get_project','list_screens','get_screen']);
const WRITE=new Set(['create_project','generate_screen_from_text','edit_screens','generate_variants']);
const JOB=/^stitchjob-[a-f0-9]{64}$/,RESULT=/^stitchresult-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/,SNAP=/^stitchsnapshot-[a-f0-9-]{36}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=value=>sha(Buffer.from(canonicalModelData(value)));
const dir=root=>workspacePath(root,'design/.designcraft/stitch-jobs');
const pathFor=(root,id)=>{if(!JOB.test(id||''))throw new SafetyError('Stitch 任务身份无效',422);return workspacePath(root,join(dir(root),id+'.json'));};
const resultDir=root=>workspacePath(root,'design/.designcraft/stitch-results');
const resultPath=(root,id)=>{if(!RESULT.test(id||''))throw new SafetyError('Stitch 结果回执身份无效',422);return workspacePath(root,join(resultDir(root),id+'.json'));};
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};

function safeOutput(value,secrets=[]){
 const hidden=secrets.filter(item=>typeof item==='string'&&item.length>0&&item.length<=8192);
 let nodes=0,redacted=false;const walk=(item,depth)=>{
  if(++nodes>100000||depth>48)throw new SafetyError('Stitch 数据结构超过预算',413);
  if(typeof item==='string'){
   if(/^data:/i.test(item)){redacted=true;return '[内嵌数据已隐藏]';}
   let text=item;if(text.length>100000){text=text.slice(0,100000);redacted=true;}
   let clean=text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"<>]+/gi,'[链接已隐藏]').replace(/(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b['"]?\s*[:=]\s*['"]?[^\s'",}]{12,}/gi,'[已隐藏]');for(const secret of hidden)if(clean.includes(secret))clean=clean.split(secret).join('[已隐藏]');if(clean!==text)redacted=true;return clean;
  }
  if(item===null||typeof item==='number'||typeof item==='boolean')return item;
  if(Array.isArray(item))return item.map(child=>walk(child,depth+1));
  if(item&&typeof item==='object'){
   const out=Object.create(null);for(const [key,child]of Object.entries(item)){
    if(['__proto__','constructor','prototype'].includes(key))throw new SafetyError('Stitch 返回不安全字段',422);
    const privateKey=/^(?:authorization|x-goog-api-key|api[_-]?key|access[_-]?token|session[_-]?id|downloadUrl)$/i.test(key),unsafeKey=/(?:https?:\/\/|^data:|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(key)||hidden.some(secret=>key.includes(secret)),safeKey=unsafeKey?'[隐藏字段-'+sha(Buffer.from(key)).slice(0,16)+']':key;
    const inlineBinary=key==='data'&&typeof child==='string'&&(item.type==='image'||item.type==='audio'||child.length>1024&&/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(child));
    if(unsafeKey)redacted=true;if(privateKey){out[safeKey]='[已隐藏]';redacted=true;}else if(inlineBinary){out[safeKey]='[内嵌数据已隐藏]';redacted=true;}else out[safeKey]=walk(child,depth+1);
   }return out;
  }
  throw new SafetyError('Stitch 返回不支持的数据',502);
 };const data=walk(value,0);assertSafeJson(data);return {data,redacted};
}
export function validateStitchResultBytes(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>8*1024*1024)throw new SafetyError('Stitch 结果大小无效',409);
 let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SafetyError('Stitch 结果不是有效 JSON',409);}
 const safe=safeOutput(value);if(JSON.stringify(safe.data)!==JSON.stringify(value))throw new SafetyError('Stitch 结果含未处理的链接或敏感数据',409);return true;
}
export function validateStitchResultReceipt(row){
 assertSafeJson(row);const allowed=['schema','kind','id','jobId','tool','requestHash','inputHash','schemaSha256','resultAsset','resultSha256','resultBytes'];
 if(!row||Object.keys(row).some(key=>!allowed.includes(key))||row.schema!==1||row.kind!=='stitch-result-receipt'||!RESULT.test(row.id||'')||!JOB.test(row.jobId||'')||!WRITE.has(row.tool)||!HASH.test(row.requestHash||'')||!HASH.test(row.inputHash||'')||!HASH.test(row.schemaSha256||'')||!HASH.test(row.resultSha256||'')||typeof row.resultAsset!=='string'||!/^stitch-result-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.json$/.test(row.resultAsset)||!row.resultAsset.startsWith('stitch-result-'+row.resultSha256.slice(0,24))||!Number.isSafeInteger(row.resultBytes)||row.resultBytes<1||row.resultBytes>8*1024*1024||row.id!=='stitchresult-'+identity([row.jobId,row.requestHash,row.inputHash,row.resultSha256]))throw new SafetyError('Stitch 结果回执无效',409);
 return true;
}
function acquireRecovery(root,id){
 const directory=dir(root);mkdirSync(directory,{recursive:true});const token=randomUUID(),prefix='stitchrecover-'+id+'-',path=workspacePath(root,join(directory,prefix+token+'.json')),body=JSON.stringify({pid:process.pid,token,id});
 if(!atomicCreate(path,body))throw new SafetyError('Stitch 恢复记录冲突',409);
 const release=()=>{try{const info=lstatSync(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<=4096&&readFileSync(path,'utf8')===body)unlinkSync(path);}catch{}};
 try{const peers=readdirSync(directory).filter(name=>name.startsWith(prefix)&&name.endsWith('.json'));if(peers.length>200)throw new SafetyError('Stitch 恢复记录超过预算',413);for(const peer of peers){if(peer===prefix+token+'.json')continue;const file=workspacePath(root,join(directory,peer)),info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('Stitch 恢复记录需要核对',409);const other=JSON.parse(readFileSync(file,'utf8'));if(other.id!==id||!Number.isSafeInteger(other.pid)||typeof other.token!=='string')throw new SafetyError('Stitch 恢复记录无效',409);if(alive(other.pid))throw new SafetyError('Stitch 任务正在另一恢复流程中',423);}return release;}catch(error){release();throw error;}
}
function unwrap(result){
 if(!result||typeof result!=='object'||Array.isArray(result))throw new SafetyError('Stitch 工具结果无效',502);
 if(result.resultType==='input_required'){const error=new SafetyError('Stitch 需要额外交互；当前不会自动确认或重发',409);error.needsInput=true;throw error;}
 if(result.isError)throw new SafetyError('Stitch 工具报告失败；远端可能已发生部分变化，请先核对',502);
 if(result.structuredContent!==undefined)return result.structuredContent;
 const text=Array.isArray(result.content)?result.content.find(item=>item?.type==='text'&&typeof item.text==='string')?.text:undefined;
 if(text!==undefined){try{return JSON.parse(text);}catch{return text;}}
 return result;
}
function argsFor(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw new SafetyError('Stitch 工具参数必须是对象',422);
 assertSafeJson(value);const serialized=JSON.stringify(value);if(Buffer.byteLength(serialized)>256*1024)throw new SafetyError('Stitch 参数超过预算',413);
 if(/(?:Bearer\s+[A-Za-z0-9_.:-]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(serialized))throw new SafetyError('Stitch 参数包含疑似凭据，请通过 DSH 凭据引用配置',422);
 inspectModelInput(value);return value;
}
function schemaFor(tools,name,expected){
 const found=tools.find(item=>item.name===name);if(!found)throw new SafetyError('当前 Stitch 目录未提供该工具',422);
 const actual=identity(found.inputSchema);if(expected&&actual!==expected)throw new SafetyError('Stitch 工具 schema 已改变，请重新查看',409);return {found,hash:actual};
}
export function validateStitchJob(job){
 assertSafeJson(job);const allowed=['schema','kind','id','ownerPid','tool','schemaSha256','requestHash','inputHash','status','remoteState','createdAt','finishedAt','resultAsset','resultSha256','resultBytes','snapshotId','recoveredFromReceipt','error'];
 if(!job||Object.keys(job).some(key=>!allowed.includes(key))||job.schema!==1||job.kind!=='stitch-job'||!JOB.test(job.id||'')||!WRITE.has(job.tool)||!HASH.test(job.schemaSha256||'')||!HASH.test(job.requestHash||'')||!HASH.test(job.inputHash||'')||!['queued','running','responded','failed','cancelled','interrupted','unknown','needs_input'].includes(job.status)||!['not_dispatched','sent_or_uncertain','responded'].includes(job.remoteState)||typeof job.createdAt!=='string'||!/^[0-9T:.Z-]{24}$/.test(job.createdAt))throw new SafetyError('Stitch 任务记录无效',409);
 if(job.ownerPid!==undefined&&(!Number.isSafeInteger(job.ownerPid)||job.ownerPid<1)||job.status==='queued'&&job.remoteState!=='not_dispatched'||job.status==='running'&&job.remoteState!=='sent_or_uncertain'||job.status==='responded'&&(!job.resultAsset||job.remoteState!=='responded'))throw new SafetyError('Stitch 任务状态不一致',409);
 if(job.resultAsset!==undefined&&(typeof job.resultAsset!=='string'||!/^stitch-result-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.json$/.test(job.resultAsset)||!HASH.test(job.resultSha256||'')||!Number.isSafeInteger(job.resultBytes)||job.resultBytes<1||job.resultBytes>8*1024*1024))throw new SafetyError('Stitch 结果记录无效',409);
 if(job.resultAsset===undefined&&(job.resultSha256!==undefined||job.resultBytes!==undefined))throw new SafetyError('Stitch 结果记录不完整',409);
 if(job.snapshotId!==undefined&&!SNAP.test(job.snapshotId))throw new SafetyError('Stitch 快照身份无效',409);
 if(job.recoveredFromReceipt!==undefined&&!RESULT.test(job.recoveredFromReceipt))throw new SafetyError('Stitch 恢复回执身份无效',409);
 if(job.error!==undefined&&(typeof job.error!=='string'||job.error.length>500||/(?:https?:\/\/|Bearer\s+[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(job.error)))throw new SafetyError('Stitch 任务错误记录无效',409);
 return true;
}

export class StitchService{
 constructor(ctx,onChange=()=>{}){this.ctx=ctx;this.onChange=onChange;this.snapshots=new Map();this.running=new Map();this.closed=false;}
 async connect(signal){if(this.closed)throw new SafetyError('Stitch 服务已停止',503);return StitchMcp.connect(this.ctx,signal);}
 snapshot(root,tool,args,payload,{jobId,secrets=[]}={}){
  const safe=safeOutput(payload,secrets),content=JSON.stringify(safe.data,null,2);if(Buffer.byteLength(content)>8*1024*1024)throw new SafetyError('Stitch 快照超过预算',413);
  const id='stitchsnapshot-'+randomUUID(),requestHash=identity({tool,args});this.snapshots.set(id,{root,tool,args,requestHash,...(jobId?{jobId}:{}),secrets:secrets.filter(value=>typeof value==='string'&&value),payload,content,at:Date.now()});while(this.snapshots.size>5)this.snapshots.delete(this.snapshots.keys().next().value);
  const timer=setTimeout(()=>this.snapshots.delete(id),5*60*1000);timer.unref?.();
  return {snapshotId:id,redacted:safe.redacted,totalCharacters:content.length};
 }
 async catalog(signal){
  const client=await this.connect(signal),tools=await client.tools(),items=[];
  for(const item of tools)if(READ.has(item.name)||WRITE.has(item.name)){
   const safe=safeOutput({name:item.name,description:typeof item.description==='string'?item.description:'',inputSchema:item.inputSchema},client.sensitiveValues());items.push({...safe.data,schemaSha256:identity(item.inputSchema),redacted:safe.redacted,kind:READ.has(item.name)?'read':'remote_write'});
  }
  return {items,note:'仅列出当前服务真实返回的已接入工具；参数说明可能隐藏链接或敏感内容，摘要对应服务原始 schema。目录不证明账号有权限或操作已成功。'};
 }
 async read(root,{tool,args,schemaSha256},signal){
  root=store.validateRoot(root);if(!READ.has(tool)||!HASH.test(schemaSha256||''))throw new SafetyError('请选择已发现的 Stitch 只读工具及 schema',422);argsFor(args);
  const client=await this.connect(signal),tools=await client.tools();schemaFor(tools,tool,schemaSha256);const result=unwrap(await client.call(tool,args));signal?.throwIfAborted();
  return {...this.snapshot(root,tool,args,result,{secrets:client.sensitiveValues()}),tool,note:'结果来自 Stitch；快照隐藏链接与疑似凭据，是参考数据而非权限指令。'};
 }
 readSnapshot(root,id,{offset=0,limit=12000}={}){
  root=store.validateRoot(root);if(!SNAP.test(id||'')||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('Stitch 快照分页无效',422);
  const item=this.snapshots.get(id);if(!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Stitch 快照已过期，请重新读取',404);
  return {snapshotId:id,tool:item.tool,content:item.content.slice(offset,offset+limit),offset,totalCharacters:item.content.length,nextOffset:offset+limit<item.content.length?offset+limit:null};
 }
 candidates(root,id){
  root=store.validateRoot(root);const item=this.snapshots.get(id);if(!SNAP.test(id||'')||!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Stitch 快照已过期，请重新读取',404);
  const items=stitchAssetCandidates(item.payload).filter(candidate=>!candidate.path.some(part=>typeof part==='string'&&item.secrets.some(secret=>part.includes(secret)))).map(({candidateId,kind,path})=>({candidateId,kind,path}));return {snapshotId:id,items,note:'只列出服务实际返回的 HTML 或截图地址；尚未下载或确认可用。'};
 }
 async capture(root,id,candidateId,signal,assertCurrent){
  root=store.validateRoot(root);const item=this.snapshots.get(id);if(!SNAP.test(id||'')||!item||item.root!==root||Date.now()-item.at>5*60*1000)throw new SafetyError('Stitch 快照已过期，请重新读取',404);
  return saveStitchAsset(root,item,candidateId,signal,assertCurrent);
 }
 async assets(root){return {items:await listStitchAssets(root),pending:await pendingStitchAssets(root)};}
 async recoverAsset(root,candidate,signal,assertCurrent){return recoverStitchAsset(root,candidate,signal,assertCurrent);}
 async openHtml(root,id,operationId,title,signal,assertCurrent){const result=await openStitchHtml(root,id,operationId,title,signal,assertCurrent);try{this.onChange(root,{kind:'html-source',id:result.id,revision:result.revision});}catch{}return result;}
 save(record){
  const {root,...value}=record;validateStitchJob(value);mkdirSync(dir(root),{recursive:true});const path=pathFor(root,record.id),temp=path+'.tmp-'+randomUUID();
  try{writeFileSync(temp,encode(value),{flag:'wx'});renameSync(temp,path);}finally{try{if(existsSync(temp))unlinkSync(temp);}catch{}}
  try{this.onChange(root,{kind:'stitch-job',id:record.id,status:record.status});}catch{}
 }
 load(root,id){
  root=store.validateRoot(root);const path=pathFor(root,id);if(!existsSync(path))throw new SafetyError('Stitch 任务不存在',404);if(statSync(path).size>32768)throw new SafetyError('Stitch 任务记录超过预算',413);
  let value;try{value=JSON.parse(readFileSync(path,'utf8'));}catch{throw new SafetyError('Stitch 任务记录不是有效 JSON',409);}validateStitchJob(value);if(value.id!==id)throw new SafetyError('Stitch 任务身份不一致',409);
  const record={...value,root};if(['queued','running'].includes(record.status)&&!alive(record.ownerPid)){record.status='interrupted';record.error=record.remoteState==='not_dispatched'?'上次任务中断，未确认是否已发送。':'上次任务中断，远端状态未确认；不要自动重发。';this.save(record);}return record;
 }
 list(root){
  root=store.validateRoot(root);mkdirSync(dir(root),{recursive:true});const names=readdirSync(dir(root)).filter(name=>/^stitchjob-[a-f0-9]{64}\.json$/.test(name));if(names.length>2000)throw new SafetyError('Stitch 任务数量超过预算',413);
  return names.map(name=>{const {root:ignored,...job}=this.load(root,name.slice(0,-5));return job;}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
 }
 get(root,id){const {root:ignored,...job}=this.load(root,id);return job;}
 readResult(root,id,{offset=0,limit=12000}={}){
  root=store.validateRoot(root);if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('Stitch 结果分页无效',422);
  const job=this.load(root,id);if(!job.resultAsset)throw new SafetyError('Stitch 任务没有已保存的结果',404);const bytes=store.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)throw new SafetyError('Stitch 结果缺失或摘要不一致',409);validateStitchResultBytes(bytes);
  const content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);return {id,content:content.slice(offset,offset+limit),offset,totalCharacters:content.length,nextOffset:offset+limit<content.length?offset+limit:null,note:'这是已保存的脱敏结果；下载链接只在短期内存快照中存在。'};
 }
 async start(root,{tool,args,schemaSha256,operationId},signal,assertCurrent){
  root=store.validateRoot(root);if(!WRITE.has(tool)||!HASH.test(schemaSha256||'')||!HASH.test(operationId||''))throw new SafetyError('Stitch 操作或身份无效',422);argsFor(args);
  const inputHash=identity({tool,args,schemaSha256}),id='stitchjob-'+operationId,path=pathFor(root,id);mkdirSync(dir(root),{recursive:true});
  if(existsSync(path)){const prior=this.get(root,id);if(prior.inputHash!==inputHash||prior.tool!==tool)throw new SafetyError('Stitch 操作身份冲突，未重复发送',409);return {accepted:true,reused:true,job:prior};}
  if(this.running.has(id)||this.running.size>=4)throw new SafetyError('已有 Stitch 任务运行中，请稍后重试',429);
  const controller=new AbortController(),abort=()=>controller.abort();if(signal?.aborted)abort();signal?.addEventListener('abort',abort,{once:true});let client;
  try{client=await this.connect(controller.signal);schemaFor(await client.tools(),tool,schemaSha256);signal?.throwIfAborted();assertCurrent?.();}
  catch(error){signal?.removeEventListener('abort',abort);throw error;}
  const record={root,schema:1,kind:'stitch-job',id,ownerPid:process.pid,tool,schemaSha256,requestHash:identity({tool,args}),inputHash,status:'queued',remoteState:'not_dispatched',createdAt:new Date().toISOString()};const {root:ignored,...persisted}=record;validateStitchJob(persisted);
  if(!atomicCreate(path,encode(persisted))){signal?.removeEventListener('abort',abort);const prior=this.get(root,id);if(prior.inputHash!==inputHash||prior.tool!==tool)throw new SafetyError('Stitch 操作身份冲突，未重复发送',409);return {accepted:true,reused:true,job:prior};}
  signal?.removeEventListener('abort',abort);this.running.set(id,controller);queueMicrotask(()=>this.execute(record,args,client,controller,assertCurrent).catch(()=>{}));return {accepted:true,job:persisted,note:'已保存本地任务，尚不能表示远端已经完成。'};
 }
 async execute(record,args,client,controller,assertCurrent){
  try{
   const result=unwrap(await client.call(record.tool,args,()=>{assertCurrent?.();record.status='running';record.remoteState='sent_or_uncertain';this.save(record);}));
   record.remoteState='responded';const snapshot=this.snapshot(record.root,record.tool,args,result,{jobId:record.id,secrets:client.sensitiveValues()}),safe=this.snapshots.get(snapshot.snapshotId).content,bytes=Buffer.from(safe,'utf8'),digest=sha(bytes),asset=store.saveAsset(record.root,'stitch-result-'+digest.slice(0,24)+'.json',bytes);
   const receipt={schema:1,kind:'stitch-result-receipt',jobId:record.id,tool:record.tool,requestHash:record.requestHash,inputHash:record.inputHash,schemaSha256:record.schemaSha256,resultAsset:asset.name,resultSha256:digest,resultBytes:bytes.length};receipt.id='stitchresult-'+identity([receipt.jobId,receipt.requestHash,receipt.inputHash,receipt.resultSha256]);validateStitchResultReceipt(receipt);mkdirSync(resultDir(record.root),{recursive:true});const receiptPath=resultPath(record.root,receipt.id);
   if(!atomicCreate(receiptPath,encode(receipt))){const previous=JSON.parse(readFileSync(receiptPath,'utf8'));if(JSON.stringify(previous)!==JSON.stringify(receipt))throw new SafetyError('Stitch 结果回执冲突，原结果未覆盖',409);}
   record.resultAsset=asset.name;record.resultSha256=digest;record.resultBytes=bytes.length;record.snapshotId=snapshot.snapshotId;record.status='responded';record.finishedAt=new Date().toISOString();this.save(record);
  }catch(error){record.status=error.needsInput?'needs_input':record.remoteState!=='not_dispatched'?'unknown':controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted&&record.remoteState!=='not_dispatched'?'已停止本地等待；远端可能仍在处理，请先核对。':String(error.message||error).slice(0,500);record.finishedAt=new Date().toISOString();this.save(record);}
  finally{this.running.delete(record.id);}
 }
 recoverSaved(root,id,assertCurrent){
  root=store.validateRoot(root);if(!JOB.test(id||''))throw new SafetyError('Stitch 任务身份无效',422);if(this.running.has(id))throw new SafetyError('Stitch 任务仍在运行',423);const release=acquireRecovery(root,id);
  try{
   const job=this.load(root,id);if(['queued','running'].includes(job.status)&&alive(job.ownerPid))throw new SafetyError('Stitch 任务仍在其他进程运行',423);
   let names;try{names=readdirSync(resultDir(root));}catch(error){if(error.code==='ENOENT')names=[];else throw error;}if(names.length>3000)throw new SafetyError('Stitch 结果回执超过预算',413);
   const receipts=new Map();for(const name of names.filter(name=>/^stitchresult-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/.test(name))){
    const path=workspacePath(root,join(resultDir(root),name)),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('Stitch 结果回执无效',409);
    let row;try{row=JSON.parse(readFileSync(path,'utf8'));}catch{if(name.includes('.tmp-'))continue;throw new SafetyError('Stitch 结果回执损坏',409);}validateStitchResultReceipt(row);if(!name.startsWith(row.id+'.json'))throw new SafetyError('Stitch 结果回执身份不一致',409);if(row.jobId!==id)continue;
    if(row.tool!==job.tool||row.requestHash!==job.requestHash||row.inputHash!==job.inputHash||row.schemaSha256!==job.schemaSha256)throw new SafetyError('Stitch 结果回执与任务不一致',409);
    const bytes=store.readAsset(root,row.resultAsset);if(!bytes||bytes.length!==row.resultBytes||sha(bytes)!==row.resultSha256)throw new SafetyError('Stitch 已保存结果缺失或改变',409);validateStitchResultBytes(bytes);const prior=receipts.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw new SafetyError('Stitch 结果回执冲突',409);receipts.set(row.id,row);
   }
   if(receipts.size!==1)throw new SafetyError(receipts.size?'Stitch 任务存在多个不同结果，请核对后处理':'没有可恢复的已保存 Stitch 结果；不会重新提交远端操作',409);
   const receipt=[...receipts.values()][0];assertCurrent?.();if(!atomicCreate(resultPath(root,receipt.id),encode(receipt))){const prior=JSON.parse(readFileSync(resultPath(root,receipt.id),'utf8'));if(JSON.stringify(prior)!==JSON.stringify(receipt))throw new SafetyError('Stitch 结果回执冲突，未覆盖',409);}
   if(job.status==='responded'&&job.resultSha256===receipt.resultSha256&&job.resultAsset===receipt.resultAsset&&job.resultBytes===receipt.resultBytes){this.readResult(root,id);return {job:this.get(root,id),alreadySaved:true};}
   assertCurrent?.();job.resultAsset=receipt.resultAsset;job.resultSha256=receipt.resultSha256;job.resultBytes=receipt.resultBytes;job.remoteState='responded';job.status='responded';job.recoveredFromReceipt=receipt.id;job.finishedAt=new Date().toISOString();delete job.error;delete job.snapshotId;this.save(job);
   return {job:this.get(root,id),recovered:true,note:'仅恢复已保存的脱敏结果，没有重发远端操作；短期下载链接需重新读取屏幕。'};
  }finally{release();}
 }
 stop(root,id){const record=this.load(root,id),controller=this.running.get(record.id);if(!controller||!['queued','running'].includes(record.status))return false;controller.abort();return true;}
 dispose(){this.closed=true;for(const controller of this.running.values())controller.abort();this.snapshots.clear();}
}
