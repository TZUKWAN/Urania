/** Project-retained, content-verified creative-director bundles across plugin versions. */
import {readFileSync,lstatSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {atomicCreate} from './persistence.js';
import {readZip} from './zip.js';
import {SafetyError,workspacePath,assertSafeJson} from './safety.js';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const git=raw=>createHash('sha1').update(Buffer.concat([Buffer.from('blob '+raw.length+'\0'),raw])).digest('hex');
const ID=/^external-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/;
const bundleDir=(root,id)=>{if(!ID.test(id||''))throw new SafetyError('创意指导资源身份无效',422);return workspacePath(root,'design/.designcraft/v2/resource-bundles/creative-director/'+id);};
function safeRead(file,max){const info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>max)throw new SafetyError('留存资源文件类型或大小无效',409);return readFileSync(file);}
export function validateDirectorUsage(value){
 assertSafeJson(value);if(!value||Object.keys(value).some(k=>!['schema','kind','id','resource','repository','revision','archiveSha256','license'].includes(k))||value.schema!==1||value.kind!=='external-source'||value.resource!=='creative-director'||value.repository!=='smixs/creative-director-skill'||!/^[a-f0-9]{40}$/.test(value.revision||'')||!HASH.test(value.archiveSha256||'')||value.license!=='CC-BY-4.0'||value.id!=='external-'+sha(Buffer.from(JSON.stringify([value.repository,value.revision,value.archiveSha256]))))throw new SafetyError('留存创意指导来源身份无效',409);return value;
}
export class RetainedDirectorBundle{
 constructor(root,usage,files){this.projectRoot=root;this.usage=validateDirectorUsage(usage);this.files=files;this.validate();}
 validate(){
  const raw=this.files.get('source-lock.json'),archive=this.files.get('creative-director.zip');if(!raw||raw.length>1024*1024||!archive||archive.length>32*1024*1024||sha(archive)!==this.usage.archiveSha256)throw new SafetyError('留存创意指导包缺失或摘要不一致',409);
  let index;try{index=JSON.parse(raw.toString('utf8'));}catch{throw new SafetyError('留存创意指导索引损坏',409);}assertSafeJson(index);
  if(index.repository!==this.usage.repository||index.revision!==this.usage.revision||index.archive!=='creative-director.zip'||index.archiveSha256!==this.usage.archiveSha256||index.archiveBytes!==archive.length||index.license!==this.usage.license||!Array.isArray(index.files)||index.files.length>1024)throw new SafetyError('留存创意指导索引与历史来源不一致',409);
  const entries=readZip(archive,{maxEntries:1024,maxEntryBytes:2*1024*1024,maxTotalBytes:32*1024*1024,maxSelectedBytes:32*1024*1024}),actual=new Map(entries.map(row=>[row.name,row.data])),files=new Map();
  if(actual.size!==entries.length||actual.size!==index.files.length)throw new SafetyError('留存创意指导包文件数量不一致',409);
  for(const item of index.files){
   if(typeof item.path!=='string'||item.path.startsWith('/')||item.path.includes('\\')||item.path.split('/').some(p=>!p||p==='.'||p==='..')||files.has(item.path)||!HASH.test(item.sha256||'')||!/^[a-f0-9]{40}$/.test(item.gitSha1||''))throw new SafetyError('留存创意指导文件清单无效',409);
   const bytes=actual.get(item.path);if(!bytes||bytes.length!==item.bytes||sha(bytes)!==item.sha256||git(bytes)!==item.gitSha1)throw new SafetyError('留存创意指导文件摘要不一致',409);files.set(item.path,item);
  }
  for(const name of ['LICENSE','NOTICE'])if(!this.files.get(name)||sha(this.files.get(name))!==files.get(name)?.sha256)throw new SafetyError('留存创意指导许可或署名文件不一致',409);
  this.loaded={...index,files};this.contents=actual;
 }
 index(){return this.loaded;}
 referenceId(){return this.usage.id;}
 archive(){return this.files.get('creative-director.zip');}
 read({file,offset=0,limit=20000}={}){
  const entry=this.loaded.files.get(file);if(!entry)throw new SafetyError('文件不在该历史创意指导包内',404);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('留存资源读取范围无效',422);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(this.contents.get(file));}catch{throw new SafetyError('留存资源不是UTF-8文本',422);}
  return {repository:this.usage.repository,revision:this.usage.revision,resourceId:this.usage.id,file,gitSha1:entry.gitSha1,sha256:entry.sha256,license:this.usage.license,attribution:this.loaded.attribution,content:text.slice(offset,offset+limit),offset,totalCharacters:text.length,nextOffset:offset+limit<text.length?offset+limit:null,retainedVersion:true,executed:false};
 }
 list({query='',offset=0,limit=50}={}){if(typeof query!=='string'||query.length>160||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new SafetyError('历史资源分页无效',422);const rows=[...this.loaded.files.values()].filter(row=>row.path.toLowerCase().includes(query.toLowerCase()));return {repository:this.usage.repository,revision:this.usage.revision,resourceId:this.usage.id,license:this.usage.license,total:rows.length,items:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null,retainedVersion:true,executed:false};}
 verifyUsage(value){validateDirectorUsage(value);if(JSON.stringify(value)!==JSON.stringify(this.usage))throw new SafetyError('历史资源来源记录不一致',409);return true;}
 markUsed(root){if(root!==this.projectRoot)throw new SafetyError('历史资源属于另一项目',409);retainDirectorFiles(root,this.usage,this.files);return {usage:this.usage,usageRecorded:true,retainedVersion:true};}
 exportFiles(){return [...this.files].map(([file,bytes])=>({file,sha256:sha(bytes),bytes}));}
}
function retainDirectorFiles(root,usage,files){
 const directory=bundleDir(root,usage.id);mkdirSync(directory,{recursive:true});if(lstatSync(directory).isSymbolicLink())throw new SafetyError('资源留存目录不能是链接',409);
 for(const [name,bytes]of files){const path=workspacePath(root,join(directory,name));if(!atomicCreate(path,bytes)){const prior=safeRead(path,32*1024*1024);if(!prior.equals(bytes))throw new SafetyError('同一资源身份已有不同原件，未覆盖',409);}}
}
export function retainDirectorBundle(root,resource,usage){
 const files=new Map(resource.exportFiles().map(row=>[row.file,safeRead(join(resource.root,row.file),32*1024*1024)]));
 new RetainedDirectorBundle(root,usage,files);retainDirectorFiles(root,usage,files);return files;
}
export function loadRetainedDirector(root,id){
 if(!ID.test(id||''))throw new SafetyError('历史创意指导身份无效',422);const usageFile=workspacePath(root,'design/.designcraft/v2/resource-imports/'+id+'.json');
 let usage;try{usage=JSON.parse(safeRead(usageFile,16384).toString('utf8'));}catch{throw new SafetyError('项目没有可核对的历史创意指导来源记录',409);}validateDirectorUsage(usage);if(usage.id!==id)throw new SafetyError('历史创意指导来源不一致',409);
 let files;for(const base of [bundleDir(root,id),workspacePath(root,'dependencies/creative-director')]){
  try{files=new Map(['creative-director.zip','source-lock.json','LICENSE','NOTICE'].map(name=>[name,safeRead(join(base,name),32*1024*1024)]));}catch(error){if(error.code==='ENOENT')continue;throw error;}
  const bundle=new RetainedDirectorBundle(root,usage,files);retainDirectorFiles(root,usage,files);return bundle;
 }
 throw new SafetyError('旧创意指导原包未随项目留存；请从原项目包恢复 dependencies/creative-director，不能用新规则冒充旧版本',409);
}
