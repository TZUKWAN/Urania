/** Exact plan revisions attached to actual image jobs and their saved candidates. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,readFileSync,lstatSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {DesignPlans} from './design-plans.js';
import {readAsset} from './docstore.js';
import {SafetyError,workspacePath,assertPortableName,assertSafeJson} from './safety.js';
const HASH=/^[a-f0-9]{64}$/,PLAN=/^plan-[a-f0-9]{32}$/,JOB=/^image-[a-f0-9-]{36}$/;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const directory=root=>workspacePath(root,'design/.designcraft/image-plan-links');
export function pinImagePlan(root,planId,planRevision){
 if(planId==null&&planRevision==null)return null;
 if(!PLAN.test(planId||'')||!HASH.test(planRevision||''))throw new SafetyError('请选择已保存的设计计划及精确修订',422);
 const row=new DesignPlans(root).read(planId,planRevision);
 return {schema:1,planId,planRevision,planSha256:sha(Buffer.from(JSON.stringify(row.plan))),title:row.plan.title};
}
export function verifyImagePlan(root,value){
 assertSafeJson(value);
 if(!value||Object.keys(value).some(key=>!['schema','planId','planRevision','planSha256','title'].includes(key))||value.schema!==1||!HASH.test(value.planSha256||'')||typeof value.title!=='string'||value.title.length>200)throw new SafetyError('图片任务的设计计划身份无效',409);
 const actual=pinImagePlan(root,value.planId,value.planRevision);
 if(!actual||actual.planSha256!==value.planSha256||actual.title!==value.title)throw new SafetyError('图片任务的计划修订或内容已改变，未发送请求',409);
 return actual;
}
export function saveImagePlanTrace(record){
 if(!record.designPlan)return;
 const binding=verifyImagePlan(record.root,record.designPlan);if(!JOB.test(record.id||''))throw new SafetyError('图片任务追溯身份无效',409);
 const candidates=(record.candidates||[]).map(item=>{
  const asset=item.asset||item.native?.renderedAsset,source=item.native?.source;
  if(typeof item.id!=='string'||!asset||!source)throw new SafetyError('图片候选缺少实际预览或原生源，未写入计划追溯',409);
  assertPortableName(asset);assertPortableName(source);const preview=readAsset(record.root,asset),native=readAsset(record.root,source);if(!preview||!native)throw new SafetyError('图片候选原件缺失，未写入计划追溯',409);
  const sourceHash=sha(native);if(item.sourceHash&&sourceHash!==item.sourceHash)throw new SafetyError('图片候选源摘要与计划追溯不一致',409);
  return {candidateId:item.id,index:item.index,asset,previewSha256:sha(preview),source,sourceSha256:sourceHash};
 });
 const row={schema:1,kind:'image-plan-trace',jobId:record.id,designPlan:binding,requestSignature:record.requestSignature||sha(Buffer.from(JSON.stringify([record.id,record.provider,record.model,record.mode,binding]))),status:record.status,candidates};
 const dir=directory(record.root);mkdirSync(dir,{recursive:true});const path=join(dir,record.id+'.json'),temp=path+'.'+randomUUID()+'.tmp';
 try{const prior=JSON.parse(readFileSync(path,'utf8'));if(prior.jobId!==row.jobId||JSON.stringify(prior.designPlan)!==JSON.stringify(binding)||prior.requestSignature!==row.requestSignature)throw new SafetyError('图片任务计划绑定已存在且不同，未覆盖',409);}catch(error){if(error.code!=='ENOENT')throw error;}
 try{writeFileSync(temp,JSON.stringify(row,null,2)+'\n',{flag:'wx'});renameSync(temp,path);}catch(error){try{unlinkSync(temp);}catch{}throw error;}
}
export function imagePlanTraces(root){
 const dir=directory(root);let files;try{files=readdirSync(dir);}catch(error){if(error.code==='ENOENT')return [];throw error;}
 if(files.length>2100||files.some(name=>!/^image-[a-f0-9-]{36}\.json$/.test(name)))throw new SafetyError('图片计划追溯目录包含未完成记录或超过预算，请先核对',409);
 return files.sort().map(name=>{
  const path=join(dir,name),info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>262144)throw new SafetyError('图片计划追溯文件无效',409);
  const bytes=readFileSync(path);let row;try{row=JSON.parse(bytes);}catch{throw new SafetyError('图片计划追溯文件损坏',409);}assertSafeJson(row);
  if(Object.keys(row).some(key=>!['schema','kind','jobId','designPlan','requestSignature','status','candidates'].includes(key))||row.schema!==1||row.kind!=='image-plan-trace'||row.jobId+'.json'!==name||!JOB.test(row.jobId)||!HASH.test(row.requestSignature||'')||typeof row.status!=='string'||!Array.isArray(row.candidates)||row.candidates.length>100)throw new SafetyError('图片计划追溯结构无效',409);
  verifyImagePlan(root,row.designPlan);const assets=[];
  for(const item of row.candidates){for(const [key,hashKey]of [['asset','previewSha256'],['source','sourceSha256']]){assertPortableName(item[key]);if(!HASH.test(item[hashKey]||''))throw new SafetyError('图片计划候选摘要无效',409);const raw=readAsset(root,item[key]);if(!raw||sha(raw)!==item[hashKey])throw new SafetyError('图片计划候选原件与摘要不一致',409);assets.push({name:item[key],bytes:raw,sha256:item[hashKey]});}}
  return {name,bytes,row,assets};
 });
}
