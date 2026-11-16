/** Versioned project design briefs and plans, with immutable CAS pointers. */
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {atomicCreate} from './persistence.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';

const ID=/^plan-[a-f0-9]{32}$/,REV=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const pathText=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!value.startsWith('/')&&!/[\\\x00-\x1f]/.test(value)&&!value.split('/').some(part=>!part||part==='.'||part==='..');
function validateFields(value){
 assertSafeJson(value);
 if(!value||typeof value.title!=='string'||!value.title.trim()||value.title.length>200||typeof value.brief!=='string'||!value.brief.trim()||value.brief.length>40000||typeof value.content!=='string'||!value.content.trim()||value.content.length>80000||!Array.isArray(value.sources)||value.sources.length>40)throw new SafetyError('设计计划需要实际简报和计划内容，且不能超过预算',422);
 const seen=new Set();
 for(const source of value.sources){
  const pinned=/^resource-[a-f0-9]{64}$/.test(source?.resourceId||''),external=/^(?:externalfile|externallfs)-[a-f0-9]{64}$/.test(source?.resourceId||''),director=/^external-[a-f0-9]{64}$/.test(source?.resourceId||''),figma=/^figmaexport-[a-f0-9]{64}$/.test(source?.resourceId||'');
  if(!source||!pinned&&!external&&!director&&!figma||pinned&&!pathText(source.packageId)||external&&!/^externalbundle-[a-f0-9]{64}$/.test(source.bundleId||'')||!figma&&(!pathText(source.file)||!/^[a-f0-9]{40}$/.test(source.gitSha1||''))||figma&&(!/^[A-Za-z0-9]{22,128}$/.test(source.fileKey||'')||!/^(?:I)?\d+:\d+(?:;\d+:\d+)*$/.test(source.nodeId||'')||!/^[A-Za-z0-9._-]{1,128}$/.test(source.version||'')||!['svg','png'].includes(source.format))||!REV.test(source.sha256||''))throw new SafetyError('设计计划来源记录无效',422);
  const key=pinned?'od\0'+source.packageId+'\0'+source.file:external?'external\0'+source.bundleId+'\0'+source.file:director?'director\0'+source.resourceId+'\0'+source.file:'figma\0'+source.resourceId;if(seen.has(key))throw new SafetyError('设计计划来源重复',422);seen.add(key);
 }
 return {title:value.title.trim(),brief:value.brief,content:value.content,sources:value.sources.map(({resourceId,packageId,bundleId,file,gitSha1,sha256,fileKey,nodeId,version,format})=>resourceId.startsWith('figmaexport-')?{resourceId,fileKey,nodeId,version,format,sha256}:/^(?:externalfile|externallfs)-/.test(resourceId)?{resourceId,bundleId,file,gitSha1,sha256}:resourceId.startsWith('external-')?{resourceId,file,gitSha1,sha256}:{resourceId,packageId,file,gitSha1,sha256})};
}
const sameFields=(left,right)=>JSON.stringify(validateFields(left))===JSON.stringify(validateFields(right));

export class DesignPlans {
 constructor(root){this.root=root;}
 directory(id){if(!ID.test(id||''))throw new SafetyError('设计计划身份无效',422);return workspacePath(this.root,join('design','.designcraft','v2','plans',id));}
 file(id,...parts){return workspacePath(this.root,join(this.directory(id),...parts));}
 pointer(path){
  try{
   if(statSync(path).size>1024)throw new SafetyError('设计计划版本指针超过预算',413);
   const data=JSON.parse(readFileSync(path,'utf8'));if(!REV.test(data.revision||''))throw new SafetyError('设计计划版本指针损坏',409);return data.revision;
  }catch(error){if(error.code==='ENOENT')return null;throw error;}
 }
 candidate(id,revision,{allowTemporary=false}={}){
  if(!REV.test(revision||''))throw new SafetyError('设计计划候选版本无效',422);
  let name=revision+'.json',path=this.file(id,'history',name),size;
  try{size=statSync(path).size;}catch(error){
   if(error.code!=='ENOENT')throw error;
   if(!allowTemporary)throw new SafetyError('设计计划候选版本不存在',404);
   let names;try{names=readdirSync(this.file(id,'history')).sort();}catch(failure){if(failure.code==='ENOENT')throw new SafetyError('设计计划候选版本不存在',404);throw failure;}
   const pattern=new RegExp('^'+revision+'\\.json\\.tmp-[a-f0-9-]{36}$');
   name=names.filter(item=>pattern.test(item)).find(item=>{const candidate=this.file(id,'history',item),info=statSync(candidate);return info.isFile()&&info.size<=256*1024&&hash(readFileSync(candidate))===revision;});
   if(!name)throw new SafetyError('临时计划内容不完整或不存在，未自动恢复',409);
   path=this.file(id,'history',name);size=statSync(path).size;
  }
  if(size>256*1024)throw new SafetyError('设计计划候选版本超过预算',413);
  const bytes=readFileSync(path);if(hash(bytes)!==revision)throw new SafetyError('设计计划候选版本摘要不一致',409);
  const value=JSON.parse(bytes.toString('utf8'));validateFields(value);
  if(value.schema!==1||value.id!==id||value.parentRevision!==null&&!REV.test(value.parentRevision||'')||typeof value.at!=='string')throw new SafetyError('设计计划候选版本身份无效',409);
  return {id,revision,plan:value,storageName:name,temporary:name!==revision+'.json'};
 }
 lineage(id){
  const rows=[],seen=new Set();let revision=this.pointer(this.file(id,'root.json')),previous=null,total=0;
  while(revision){
   if(seen.has(revision)||rows.length>=5000)throw new SafetyError('设计计划版本链损坏或过长',409);
   seen.add(revision);total+=statSync(this.file(id,'history',revision+'.json')).size;if(total>64*1024*1024)throw new SafetyError('设计计划历史超过读取预算',413);const value=this.candidate(id,revision).plan;
   if(value.parentRevision!==previous)throw new SafetyError('设计计划版本身份不一致',409);
   rows.push({revision,value});previous=revision;revision=this.pointer(this.file(id,'next',revision+'.json'));
  }
  return rows;
 }
 read(id,revision){
  if(revision!==undefined&&!REV.test(revision))throw new SafetyError('设计计划修订无效',422);
  const rows=this.lineage(id),item=revision?rows.find(row=>row.revision===revision):rows.at(-1);
  if(!item)throw new SafetyError('设计计划或版本不存在',404);
  return {id,revision:item.revision,plan:item.value,historical:item.revision!==rows.at(-1).revision};
 }
 history(id){
  const rows=this.lineage(id);if(!rows.length)throw new SafetyError('设计计划不存在',404);
  return rows.map(({revision,value})=>({revision,parentRevision:value.parentRevision,title:value.title,at:value.at})).reverse();
 }
 recoverable(id){
  const rows=this.lineage(id),head=rows.at(-1)?.revision||null,published=new Set(rows.map(row=>row.revision));let names;
  try{names=readdirSync(this.file(id,'history'));}catch(error){if(error.code==='ENOENT')return {id,head,items:[]};throw error;}
  if(names.length>6000)throw new SafetyError('设计计划历史超过数量预算',413);
  const items=[],seen=new Set(),invalidRevisions=new Set();let total=0;
  for(const name of names){
   const match=/^([a-f0-9]{64})\.json(?:\.tmp-[a-f0-9-]{36})?$/.exec(name);if(!match||published.has(match[1])||seen.has(match[1]))continue;
   if(name.includes('.tmp-')){
    try{const path=this.file(id,'history',name),info=statSync(path);if(!info.isFile()||info.size>256*1024){invalidRevisions.add(match[1]);continue;}total+=info.size;if(total>32*1024*1024)throw new SafetyError('未发布计划候选超过读取预算',413);if(hash(readFileSync(path))!==match[1]){invalidRevisions.add(match[1]);continue;}}
    catch(error){if(error.status===413)throw error;invalidRevisions.add(match[1]);continue;}
   }
   if(!name.includes('.tmp-')){total+=statSync(this.file(id,'history',name)).size;if(total>32*1024*1024)throw new SafetyError('未发布计划候选超过读取预算',413);}
   let item;try{item=this.candidate(id,match[1],{allowTemporary:true});}catch(error){if(name.includes('.tmp-')){invalidRevisions.add(match[1]);continue;}throw error;}
   invalidRevisions.delete(match[1]);seen.add(match[1]);items.push({revision:item.revision,parentRevision:item.plan.parentRevision,title:item.plan.title,at:item.plan.at,temporary:item.temporary,storageName:item.storageName,canRecover:item.plan.parentRevision===head});
  }
  return {id,head,items:items.sort((a,b)=>String(b.at).localeCompare(String(a.at))),invalidTemporary:invalidRevisions.size};
 }
 unpublished(id,revision){
  const state=this.recoverable(id),item=state.items.find(row=>row.revision===revision);
  if(!item)throw new SafetyError('该版本已发布或不是可读取的未发布候选',409);
  return {...this.candidate(id,revision,{allowTemporary:true}),unpublished:true,canRecover:item.canRecover,head:state.head};
 }
 publishCandidate(id,revision,baseRevision){
  if(baseRevision!==null&&!REV.test(baseRevision||''))throw new SafetyError('恢复计划需要准确的基础版本',422);
  const rows=this.lineage(id),head=rows.at(-1)?.revision||null;
  if(head===revision)return {...this.read(id),alreadySaved:true};
  if(head!==baseRevision)throw new SafetyError('设计计划已有新版本，未覆盖',409);
  const candidate=this.candidate(id,revision,{allowTemporary:true});
  if(candidate.plan.parentRevision!==baseRevision)throw new SafetyError('候选计划基于其他版本，请另存为独立计划',409);
  if(candidate.temporary){
   const bytes=readFileSync(this.file(id,'history',candidate.storageName)),history=this.file(id,'history',revision+'.json');
   if(hash(bytes)!==revision)throw new SafetyError('临时计划内容已变化，未恢复',409);
   if(!atomicCreate(history,bytes)&&hash(readFileSync(history))!==revision)throw new SafetyError('计划历史文件冲突，未覆盖',409);
  }
  if(baseRevision)mkdirSync(this.file(id,'next'),{recursive:true});
  const pointer=baseRevision?this.file(id,'next',baseRevision+'.json'):this.file(id,'root.json');
  if(!atomicCreate(pointer,encode({revision}))){
   const latest=this.lineage(id).at(-1);if(latest?.revision===revision)return {...this.read(id),alreadySaved:true};
   throw new SafetyError('另一处已保存设计计划，未覆盖',409);
  }
  return this.read(id);
 }
 list(){
  const path=workspacePath(this.root,join('design','.designcraft','v2','plans'));let entries;
  try{entries=readdirSync(path,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
  if(entries.length>1000)throw new SafetyError('设计计划超过数量预算',413);
  return entries.filter(item=>ID.test(item.name)).map(item=>{
   if(!item.isDirectory())return {id:item.name,error:'计划目录不是普通目录'};
   try{const row=this.read(item.name);return {id:item.name,revision:row.revision,title:row.plan.title,updatedAt:row.plan.at};}
   catch(error){
    if(error.status===404){try{const pending=this.recoverable(item.name),first=pending.items.find(row=>row.canRecover)||pending.items[0];if(first)return {id:item.name,title:first.title,pending:true,updatedAt:first.at};if(pending.invalidTemporary)return {id:item.name,title:'未完成的计划',pending:true,invalidTemporary:pending.invalidTemporary};}catch(recoveryError){return {id:item.name,error:String(recoveryError.message||recoveryError)};}}
    return {id:item.name,error:String(error.message||error)};
   }
  }).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
 }
 save({id,baseRevision,...input}){
  const fields=validateFields(input),rows=this.lineage(id),head=rows.at(-1),current=head?.revision||null;
  if(baseRevision!==null&&!REV.test(baseRevision||''))throw new SafetyError('保存设计计划需要准确的基础版本',422);
  if(current!==baseRevision){
   if(baseRevision===null&&rows.length&&sameFields(rows[0].value,fields))return {...this.read(id),alreadySaved:true};
   if(head&&head.value.parentRevision===baseRevision&&sameFields(head.value,fields))return {...this.read(id),alreadySaved:true};
   throw new SafetyError('设计计划已有新版本，未覆盖任何内容；请先读取最新版本',409);
  }
  const value={schema:1,id,parentRevision:baseRevision,...fields,at:new Date().toISOString()},body=encode(value);
  if(body.length>256*1024)throw new SafetyError('设计计划版本超过保存预算',413);
  const revision=hash(body);mkdirSync(this.file(id,'history'),{recursive:true});mkdirSync(this.file(id,'next'),{recursive:true});
  const history=this.file(id,'history',revision+'.json');
  if(!atomicCreate(history,body)&&hash(readFileSync(history))!==revision)throw new SafetyError('设计计划历史记录冲突，未覆盖',409);
  const pointer=baseRevision?this.file(id,'next',baseRevision+'.json'):this.file(id,'root.json');
  if(!atomicCreate(pointer,encode({revision}))){
   const latest=this.lineage(id).at(-1);
   if(latest&&latest.value.parentRevision===baseRevision&&sameFields(latest.value,fields))return {...this.read(id),alreadySaved:true};
   throw new SafetyError('另一处已保存设计计划，当前内容未覆盖',409);
  }
  return {id,revision,plan:value,historical:false};
 }
}
