/** Explicit, reversible declarations between saved plans and saved design versions. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {DesignPlans} from './design-plans.js';
import {NativeSourceStore} from './native-source-store.js';
import {HtmlArtifacts} from './html-artifacts.js';
import {atomicCreate} from './persistence.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';

const HASH=/^[a-f0-9]{64}$/,PLAN=/^plan-[a-f0-9]{32}$/,LINK=/^planlink-[a-f0-9]{64}$/,UNLINK=/^planunlink-[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=value=>sha(Buffer.from(JSON.stringify(value)));
const linkId=row=>'planlink-'+row.operationId;
const unlinkId=id=>'planunlink-'+identity([id]);
const directory=root=>workspacePath(root,'design/.designcraft/plan-source-links');
const pathFor=(root,id)=>{if(!LINK.test(id||'')&&!UNLINK.test(id||''))throw new SafetyError('计划关联身份无效',422);return workspacePath(root,join(directory(root),id+'.json'));};
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
export function validatePlanSourceLink(row){
 assertSafeJson(row);const allowed=['schema','kind','id','planId','planRevision','sourceType','sourceId','sourceRevision','sourceHash','engine','actor','operationId'];
 if(!row||Object.keys(row).some(key=>!allowed.includes(key))||row.schema!==1||row.kind!=='plan-source-link'||!LINK.test(row.id||'')||!PLAN.test(row.planId||'')||!HASH.test(row.planRevision||'')||!['native','html'].includes(row.sourceType)||typeof row.sourceId!=='string'||(row.sourceType==='html'?!/^html-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.sourceId):!/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(row.sourceId))||!HASH.test(row.sourceRevision||'')||!HASH.test(row.sourceHash||'')||!['vectorcraft','photocraft','deckcraft','html'].includes(row.engine)||(row.sourceType==='html')!==(row.engine==='html')||row.sourceType==='html'&&row.sourceHash!==row.sourceRevision||!['manual','agent'].includes(row.actor)||!HASH.test(row.operationId||'')||row.id!==linkId(row))throw new SafetyError('计划与作品关联记录无效',409);return true;
}
export function validatePlanSourceUnlink(row){assertSafeJson(row);if(!row||Object.keys(row).some(key=>!['schema','kind','id','linkId'].includes(key))||row.schema!==1||row.kind!=='plan-source-unlink'||!UNLINK.test(row.id||'')||!LINK.test(row.linkId||'')||row.id!==unlinkId(row.linkId))throw new SafetyError('计划关联撤销记录无效',409);return true;}
async function readRow(root,id){const path=pathFor(root,id),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('计划关联记录无效',409);let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('计划关联记录损坏',409);}if(LINK.test(id))validatePlanSourceLink(row);else validatePlanSourceUnlink(row);if(row.id!==id)throw new SafetyError('计划关联身份不一致',409);return row;}
async function immutable(path,row){await mkdir(join(path,'..'),{recursive:true});if(!atomicCreate(path,encode(row))){let prior;try{prior=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('计划关联记录损坏，未覆盖',409);}if(JSON.stringify(prior)!==JSON.stringify(row))throw new SafetyError('计划关联记录冲突，未覆盖',409);return false;}return true;}
async function sourceInfo(root,type,id,revision){
 if(type==='native'){const source=await new NativeSourceStore(root).source(id,revision);return {sourceHash:source.meta.sourceHash,engine:source.meta.engine,bytes:source.meta.bytes};}
 if(type==='html'){const source=await new HtmlArtifacts(root).read(id,revision);if(source.revision!==revision)throw new SafetyError('网页版本不一致',409);return {sourceHash:revision,engine:'html',bytes:source.document.files.reduce((sum,file)=>sum+file.bytes,0)};}
 throw new SafetyError('作品类型无效',422);
}
export async function verifyPlanSourceLink(root,row,{planCache,sourceCache}={}){
 validatePlanSourceLink(row);const pk=row.planId+'|'+row.planRevision,sk=row.sourceType+'|'+row.sourceId+'|'+row.sourceRevision;
 if(!planCache?.has(pk)){new DesignPlans(root).read(row.planId,row.planRevision);planCache?.set(pk,true);}
 let actual=sourceCache?.get(sk);if(!actual){actual=await sourceInfo(root,row.sourceType,row.sourceId,row.sourceRevision);sourceCache?.set(sk,actual);}if(actual.sourceHash!==row.sourceHash||actual.engine!==row.engine)throw new SafetyError('计划关联的实际作品版本或摘要不一致',409);return true;
}
export async function createPlanSourceLink(root,{planId,planRevision,sourceType,sourceId,sourceRevision,actor,operationId},signal,current){
 if(!PLAN.test(planId||'')||!HASH.test(planRevision||'')||!HASH.test(sourceRevision||'')||!HASH.test(operationId||'')||!['native','html'].includes(sourceType)||!['manual','agent'].includes(actor))throw new SafetyError('请选择已保存的精确计划和作品版本',422);
 new DesignPlans(root).read(planId,planRevision);signal?.throwIfAborted();const actual=await sourceInfo(root,sourceType,sourceId,sourceRevision),row={schema:1,kind:'plan-source-link',planId,planRevision,sourceType,sourceId,sourceRevision,sourceHash:actual.sourceHash,engine:actual.engine,actor,operationId};row.id=linkId(row);validatePlanSourceLink(row);signal?.throwIfAborted();current?.();const created=await immutable(pathFor(root,row.id),row);try{current?.();}catch(error){error.retained={linkId:row.id};throw error;}return {link:row,reused:!created,note:'已记录明确的版本关联；它不证明模型遵循计划或作品效果已验证。'};
}
export async function unlinkPlanSource(root,id,signal,current){
 const link=await readRow(root,id);validatePlanSourceLink(link);const row={schema:1,kind:'plan-source-unlink',linkId:id};row.id=unlinkId(id);validatePlanSourceUnlink(row);signal?.throwIfAborted();current?.();const created=await immutable(pathFor(root,row.id),row);try{current?.();}catch(error){error.retained={linkId:id,unlinkId:row.id};throw error;}return {linkId:id,active:false,reused:!created,note:'关联已停用，计划和作品原件及历史记录保留。'};
}
export async function readPlanSourceLink(root,id,{verify=true}={}){
 const link=await readRow(root,id);validatePlanSourceLink(link);if(verify)await verifyPlanSourceLink(root,link);let disabled=false;try{const row=await readRow(root,unlinkId(id));validatePlanSourceUnlink(row);if(row.linkId!==id)throw new SafetyError('计划关联撤销身份不一致',409);disabled=true;}catch(error){if(error.code!=='ENOENT')throw error;}return {link,active:!disabled,verified:verify,note:verify?'已核对保存的计划和作品版本；声明不证明生成过程或视觉效果。':'仅核对关联记录结构，未检查作品字节。'};
}
export async function listPlanSourceLinks(root,{planId,offset=0,limit=30}={}){
 if(planId!==undefined&&!PLAN.test(planId)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new SafetyError('计划关联列表参数无效',422);let entries;try{entries=await readdir(directory(root),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return {items:[],pending:[],offset,nextOffset:null};throw error;}
 const links=entries.filter(item=>/^planlink-[a-f0-9]{64}\.json$/.test(item.name)),temps=entries.filter(item=>/^plan(?:link|unlink)-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(item.name));if(links.length>2000||temps.length>128||[...links,...temps].some(item=>!item.isFile()))throw new SafetyError('计划关联记录超过预算或类型无效',413);
 const filtered=[];for(const item of links){const row=await readRow(root,item.name.slice(0,-5));if(!planId||row.planId===planId)filtered.push(row);}filtered.sort((a,b)=>a.id.localeCompare(b.id));const items=[];for(const row of filtered.slice(offset,offset+limit))items.push(await readPlanSourceLink(root,row.id,{verify:false}));return {items,pending:temps.map(item=>item.name),offset,nextOffset:offset+limit<filtered.length?offset+limit:null,note:'列表仅核对记录结构，实际作品字节请单独核对。'};
}
export async function recoverPlanSourceLink(root,name,signal,current){
 if(!/^plan(?:link|unlink)-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(name||''))throw new SafetyError('计划关联候选身份无效',422);const path=workspacePath(root,join(directory(root),name),{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('计划关联候选无效',409);let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('计划关联候选未完整写入',409);}if(row.kind==='plan-source-link'){validatePlanSourceLink(row);await verifyPlanSourceLink(root,row);}else{validatePlanSourceUnlink(row);await readRow(root,row.linkId);}if(!name.startsWith(row.id+'.json.tmp-'))throw new SafetyError('计划关联候选身份不一致',409);signal?.throwIfAborted();current?.();await immutable(pathFor(root,row.id),row);return {record:row,recovered:true,note:'仅恢复完整本地关联记录，没有修改作品或计划。'};
}
