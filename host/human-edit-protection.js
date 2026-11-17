/** Hash-only field guards over the real immutable native source history. */
import fs from 'node:fs';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';import {gunzipSync} from 'node:zlib';
import {nativeVectorHeader} from './native-vector-header.js';import {nativeDeckDocument} from './native-deck-header.js';import {readZip} from './zip.js';import {decodeNativeJson} from '../client/native-protocol.js';import {workspacePath,SafetyError,assertSafeJson} from './safety.js';
const clone=v=>JSON.parse(JSON.stringify(v)),hash=v=>createHash('sha256').update(JSON.stringify(v)??'undefined').digest('hex');
const deny=message=>{throw new SafetyError(message,409);};
function values(value,prefix='',out={}){if(value&&typeof value==='object'&&!Array.isArray(value)){const keys=Object.keys(value).sort();if(!keys.length)out[prefix]=hash(value);for(const key of keys)values(value[key],prefix+'/'+key.replace(/~/g,'~0').replace(/\//g,'~1'),out);}else out[prefix]=hash(value);return out;}
function ownNode(node){const out=clone(node);if(Array.isArray(out.children))out.children=out.children.map(n=>String(n.id));if(Array.isArray(out.kind?.children))out.kind.children=out.kind.children.map(n=>String(n.id));return out;}
export function protectionSnapshot(engine,bytes){
 let doc;
 if(engine==='vectorcraft'){if(bytes[0]===31&&bytes[1]===139)bytes=gunzipSync(bytes,{maxOutputLength:256*1024*1024});doc=nativeVectorHeader(bytes).document;}
 else if(engine==='deckcraft')doc=nativeDeckDocument(bytes);
 else if(engine==='photocraft'){const entry=readZip(bytes,{includeNames:['manifest.json'],maxSelectedBytes:32*1024*1024,maxEntryBytes:256*1024*1024,maxTotalBytes:1024*1024*1024,maxEntries:65535}).find(e=>e.name==='manifest.json');if(!entry)deny('图片源缺少真实清单');doc=decodeNativeJson(entry.data.toString('utf8'),{maxCharacters:32*1024*1024}).document;}
 else deny('未支持的原生保护类型');
 if(!doc||typeof doc!=='object')deny('无法读取完整原生结构，未使用界面摘要代替');assertSafeJson(doc);
 const nodes={},pages={},parents={};let count=0;
 const walk=(items,page,parent=null,depth=0)=>{if(!Array.isArray(items)||depth>64)deny('原生对象树无效');for(const node of items){if(++count>20000||node.id==null)deny('原生对象树超过保护预算或缺少 UID');const id=String(node.id);if(nodes[id])deny('原生对象 UID 重复');nodes[id]={page,data:ownNode(node)};parents[id]=parent;const children=node.kind?.children||node.children;if(children)walk(children,page,id,depth+1);}};
 const global=clone(doc);for(const key of ['next_id','nextId','revision','selection','activeSlide','currentSlide','view'])delete global[key];
 if(engine==='deckcraft'){
  for(const s of doc.slides){walk(s.shapes,'slide:'+s.id);const page=clone(s);delete page.shapes;pages['slide:'+s.id]=page;}
  global.slides=doc.slides.map(s=>String(s.id));
  for(const m of doc.masters||[]){walk(m.shapes,'master:'+m.id);for(const l of m.layouts||[])walk(l.shapes,'layout:'+l.id);}
  // Master metadata is protected as global structure; shapes are compared by UID.
  const strip=value=>{if(Array.isArray(value))return value.map(strip);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,k==='shapes'&&Array.isArray(v)?v.map(n=>String(n.id)):strip(v)]));return value;};global.masters=strip(doc.masters);
  for(const key of ['notesMaster','handoutMaster'])if(doc[key]){walk(doc[key].shapes,key+':'+doc[key].id);global[key]=strip(doc[key]);}
 }else{walk(doc.layers,'document');global.layers=doc.layers.map(n=>String(n.id));}
 return {nodes,pages,global,parents};
}
function allFields(snapshot){const fields={global:values(snapshot.global)};for(const [id,node]of Object.entries(snapshot.nodes))fields['node:'+id]=values({page:node.page,...node.data});for(const [id,page]of Object.entries(snapshot.pages))fields['page:'+id]=values(page);return fields;}
function writeJson(root,file,value){fs.mkdirSync(workspacePath(root,'design/.designcraft/feedback-protection'),{recursive:true});const temp=file+'.tmp-'+randomUUID();let fd;try{fd=fs.openSync(temp,'wx');fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(temp,file);}finally{if(fd!=null)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}}
export class HumanEditProtection{
 constructor(manager){this.manager=manager;}
 async read(root,sourceId,revision){
  const store=this.manager.store(root),lineage=await store.lineage(sourceId),end=lineage.findIndex(row=>row.revision===revision);if(end<0)deny('保护基线不属于该源的真实历史');
  const file=workspacePath(root,join('design/.designcraft/feedback-protection',sourceId+'.json'));let record={schema:1,sourceId,cursor:null,fields:{}};
  if(fs.existsSync(file)){if(fs.statSync(file).size>8*1024*1024)deny('人工字段保护记录超过预算');record=JSON.parse(fs.readFileSync(file,'utf8'));assertSafeJson(record);if(record.schema!==1||record.sourceId!==sourceId)deny('人工字段保护记录身份错误');}
  let start=record.cursor?lineage.findIndex(row=>row.revision===record.cursor):0;if(start<0||start>end)deny('保护记录与版本链不一致');
  let prior=protectionSnapshot(lineage[start].meta.engine,(await store.read(sourceId,lineage[start].revision)).bytes);
  for(let i=start+1;i<=end;i++){
   const row=lineage[i],next=protectionSnapshot(row.meta.engine,(await store.read(sourceId,row.revision)).bytes);
   if(row.meta.actor==='manual'){
    const a=allFields(prior),b=allFields(next);for(const key of new Set([...Object.keys(a),...Object.keys(b)]))for(const path of new Set([...Object.keys(a[key]||{}),...Object.keys(b[key]||{})]))if(a[key]?.[path]!==b[key]?.[path]){record.fields[key]||={};record.fields[key][path]={since:row.revision,hash:b[key]?.[path]??null};}
   }
   prior=next;
  }
  record.cursor=revision;writeJson(root,file,record);return {record,lineage:lineage.slice(0,end+1),snapshot:prior};
 }
 async verify(view,job,candidateBytes,targets){
  const {record,lineage,snapshot:before}=await this.read(view.root,view.sourceId,view.sourceRevision),after=protectionSnapshot(view.engine,candidateBytes);
  // A requested page can be reached from any current page. Navigation grants
  // no content change and cannot count as completion. Check the entire saved
  // native structure before accepting its display/selection checkpoint.
  if(view.engine==='deckcraft'&&job.payload?.command==='slide.go'){
   const destination=String(job.payload.params?.id?.$u64??job.payload.params?.id),authorized=targets.some(t=>t.sourceId===view.sourceId&&(!t.page||t.page.kind==='slide'&&t.page.id===destination));
   if(!authorized)deny('页面定位不属于本批次目标');if(hash(before)!==hash(after))deny('页面定位改变了原生内容，未保存候选');
   return {checked:true,changed:false,navigationOnly:true,changedObjectIds:[],changedPages:[],baseRevision:view.sourceRevision,protectedFields:Object.values(record.fields).reduce((n,fields)=>n+Object.keys(fields).length,0)};
  }
  const applicable=targets.filter(t=>t.sourceId===view.sourceId&&(!t.page||before.nodes[selectedIds(job)[0]]?.page===t.page.kind+':'+t.page.id||job.beforeDocument?.page?.nativePage?.kind===t.page.kind&&String(job.beforeDocument.page.nativePage.id)===t.page.id));
  if(!applicable.length)deny('这次保存没有对应的意见目标');
  const allowed=new Set(applicable.flatMap(t=>t.objectIds));const pageAllowed=page=>applicable.some(t=>!t.objectIds.length&&(!t.page||page===t.page.kind+':'+t.page.id));
  for(const [id,node]of Object.entries({...before.nodes,...after.nodes}))if(pageAllowed(node.page))allowed.add(id);
  let changed=true;while(changed){changed=false;for(const [id,parent]of Object.entries(before.parents))if(allowed.has(parent)&&!allowed.has(id)){allowed.add(id);changed=true;}}
  for(const id of new Set([...Object.keys(before.nodes),...Object.keys(after.nodes)])){
   if(allowed.has(id))continue;const clean=node=>{if(!node)return node;const value=clone(node);for(const owner of [value.data,value.data.kind])if(Array.isArray(owner?.children))owner.children=owner.children.filter(id=>!allowed.has(id));return value;};
   if(hash(clean(before.nodes[id]))!==hash(clean(after.nodes[id])))deny('AI 候选修改了意见范围之外的原生对象 '+id+'，未覆盖已保存设计');
  }
  for(const id of new Set([...Object.keys(before.pages),...Object.keys(after.pages)]))if(!pageAllowed(id)&&hash(before.pages[id])!==hash(after.pages[id]))deny('AI 候选修改了其他页面的文字、备注或版式');
  if(!applicable.some(t=>!t.objectIds.length&&!t.page)&&hash(before.global)!==hash(after.global))deny('AI 候选修改了整稿结构或资源，超出了本次目标范围');
  const a=allFields(before),b=allFields(after),position=new Map(lineage.map((r,i)=>[r.revision,i]));
  for(const [key,paths]of Object.entries(record.fields))for(const [path,field]of Object.entries(paths)){
   if(a[key]?.[path]===b[key]?.[path])continue;
   const explicit=key.startsWith('node:')&&applicable.some(t=>t.objectIds.includes(key.slice(5))&&(position.get(t.revision)??-1)>=(position.get(field.since)??Infinity));
   const notes=key.startsWith('page:')&&applicable.some(t=>t.nativeSelection?.data?.selection?.text?.notes&&t.page&&key==='page:'+t.page.kind+':'+t.page.id&&(position.get(t.revision)??-1)>=(position.get(field.since)??Infinity));
   if(!explicit&&!notes)deny('AI 候选会覆盖人工字段 '+key+path+'；已保留原件，请针对该对象重新提出当前修改要求');
  }
  const changedObjectIds=new Set(Object.keys({...before.nodes,...after.nodes}).filter(id=>hash(before.nodes[id])!==hash(after.nodes[id]))),changedPages=new Set([...changedObjectIds].map(id=>after.nodes[id]?.page||before.nodes[id]?.page));
  for(const id of [...changedObjectIds])for(let parent=before.parents[id];parent;parent=before.parents[parent])changedObjectIds.add(parent);
  for(const page of Object.keys({...before.pages,...after.pages}))if(hash(before.pages[page])!==hash(after.pages[page]))changedPages.add(page);
  return {checked:true,changed:changedObjectIds.size>0||changedPages.size>0||hash(before.global)!==hash(after.global),changedObjectIds:[...changedObjectIds],changedPages:[...changedPages],baseRevision:view.sourceRevision,protectedFields:Object.values(record.fields).reduce((sum,fields)=>sum+Object.keys(fields).length,0)};
 }
}
const selectedIds=job=>(job.beforeDocument?.objectIds||job.beforeDocument?.selection||[]).map(String);
