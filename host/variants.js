import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,unlinkSync,statSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import * as store from './docstore.js';
import {mergeDocuments} from '../client/merge.js';
import {SafetyError,workspacePath,assertSafeJson} from './safety.js';

const copy=x=>JSON.parse(JSON.stringify(x));
function home(root){const path=workspacePath(root,'design/.designcraft/variants');mkdirSync(path,{recursive:true});return path;}
function groupPath(root,id){if(!/^variants-[a-f0-9-]{36}$/.test(id))throw new SafetyError('方案组 ID 无效',422);return workspacePath(root,join('design','.designcraft','variants',id),{});}
function read(path,limit=16*1024*1024){if(statSync(path).size>limit)throw new SafetyError('方案文件超过预算',413);const d=JSON.parse(readFileSync(path,'utf8'));assertSafeJson(d);return d;}
function atomic(path,data){const temp=path+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(data,null,2),{flag:'wx'});renameSync(temp,path);}
function locked(path,fn){
 const lock=path+'/update.lock',nonce=randomUUID();if(existsSync(lock)){
  const initial=readFileSync(lock,'utf8');let owner;try{owner=JSON.parse(initial);}catch{}
  let alive=true;if(Number.isInteger(owner?.pid)){try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}}
  else if(Date.now()-statSync(lock).mtimeMs>60000)alive=false;
  if(!alive){const contents=readFileSync(lock,'utf8');if(contents===initial)unlinkSync(lock);}
 }
 try{writeFileSync(lock,JSON.stringify({pid:process.pid,nonce},null,2),{flag:'wx'});}catch{throw new SafetyError('方案组正在更新，请稍后重试',409);}
 try{return fn();}finally{try{if(read(lock,1024).nonce===nonce)unlinkSync(lock);}catch{}}
}
function load(root,id){const path=groupPath(root,id);return {path,meta:read(join(path,'group.json'),256*1024)};}
function summary(root,meta){let original=null;try{original=store.readDoc(root,meta.originalDocId);}catch{}
 const branches=meta.branches.map(branch=>{try{const current=store.readDoc(root,branch.docId);return {...branch,revision:current.revision,title:current.doc.title,modified:current.revision!==branch.forkRevision};}catch{return {...branch,missing:true,modified:false};}});
 return {...meta,branches,currentOriginalRevision:original?.revision||null,originalMissing:!original};
}
export function listVariants({root,docId}){root=store.validateRoot(root);const directory=home(root),groups=[],warnings=[];for(const id of readdirSync(directory).filter(n=>/^variants-[a-f0-9-]{36}$/.test(n)).slice(-200)){try{const {meta}=load(root,id);if(meta.id!==id||meta.schema!==1||!Array.isArray(meta.branches))throw new Error('方案组记录无效');if(!docId||meta.originalDocId===docId||meta.branches.some(b=>b.docId===docId))groups.push(summary(root,meta));}catch(error){warnings.push({id,error:'方案组记录未完成，原有文档仍保留：'+String(error.message).slice(0,200)});}}return {ok:true,groups:groups.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),warnings};}
export function forkVariant({root,docId,baseRevision,groupId,label}){
 root=store.validateRoot(root);let current=store.readDoc(root,docId);if(current.revision!==baseRevision)throw new SafetyError('当前作品已更新，请保存后再创建方案',409);
 const id=groupId||'variants-'+randomUUID(),path=groupPath(root,id);mkdirSync(path,{recursive:true});
 return locked(path,()=>{
  let meta,base;if(groupId){meta=read(join(path,'group.json'),256*1024);if(meta.originalDocId!==docId&&!meta.branches.some(b=>b.docId===docId))throw new SafetyError('方案组不属于当前作品',422);base=read(join(path,'base.dc.json'));}
  else{base=current.doc;meta={schema:1,id,originalDocId:docId,originalTitle:base.title,baseRevision:current.revision,createdAt:new Date().toISOString(),branches:[]};writeFileSync(join(path,'base.dc.json'),JSON.stringify(base,null,2),{flag:'wx'});}
  if(meta.branches.length>=20)throw new SafetyError('一组最多20个可编辑作品方案',413);
  const walk=layers=>(layers||[]).some(l=>l.pendingNativePaint?.strokes?.length||walk(l.children));if(base.pages.some(p=>walk(p.layers)))throw new SafetyError('作品仍有待处理笔画，请完成保存后创建方案',409);
  const title=String(label||'方案 '+(meta.branches.length+1)).trim();if(!title||title.length>80)throw new SafetyError('方案名称需为1至80字',422);
  const branch=copy(base);branch.id='variant-'+randomUUID();branch.title=(base.title||'设计')+' · '+title;const saved=store.createDoc(root,branch);
  meta.branches.push({docId:saved.id,label:title,forkTitle:branch.title,forkRevision:saved.revision,createdAt:new Date().toISOString()});atomic(join(path,'group.json'),meta);
  return {ok:true,...saved,group:summary(root,meta)};
 });
}
export function adoptVariant({root,groupId,variantDocId}){
 root=store.validateRoot(root);const {path}=load(root,groupId);return locked(path,()=>{
  const meta=read(join(path,'group.json'),256*1024),entry=meta.branches.find(b=>b.docId===variantDocId);if(!entry)throw new SafetyError('作品方案不属于该方案组',404);
  const base=read(join(path,'base.dc.json')),variant=store.readDoc(root,variantDocId),current=store.readDoc(root,meta.originalDocId);if(variant.revision===entry.forkRevision)throw new SafetyError('这个方案尚未编辑，不能冒充新设计采用',422);
  const proposed=copy(variant.doc);proposed.id=base.id;if(proposed.title===entry.forkTitle)proposed.title=base.title;
  const result=mergeDocuments(base,proposed,current.doc);if(result.conflicts.length){const error=new SafetyError('方案与原作的后续修改冲突，双方均已保留，未覆盖原作',409);error.conflicts=result.conflicts;throw error;}
  const saved=store.writeDoc(root,meta.originalDocId,result.doc,'variant-adopt',{baseRevision:current.revision,returnDocument:true});meta.adoptedDocId=variantDocId;meta.adoptedRevision=variant.revision;meta.adoptedAt=new Date().toISOString();atomic(join(path,'group.json'),meta);return {ok:true,...saved,group:summary(root,meta),previousRevision:current.revision,preservedConcurrentEdits:current.revision!==meta.baseRevision};
 });
}
