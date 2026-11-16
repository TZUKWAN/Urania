import {retainDirectorBundle,loadRetainedDirector} from './director-snapshots.js';
/** Pinned external bundle explicitly linked by OpenDesign's catalogue entry. */
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {atomicCreate} from './persistence.js';
import {readZip} from './zip.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';

const ROOT=fileURLToPath(new URL('../resources/creative-director/',import.meta.url));
const REPO='smixs/creative-director-skill',REV='ac06eb255371da35d1db0a146dbfcca8c8857543';
const LOCK_SHA='56c1b0ed2a79dac9d7e07aa89eef486c807a5aadf612fd47bc63f19595094f5b';
const ARCHIVE_SHA='b69479796e8b2b5b648a91b7d97fd416a6b80d6117e38c6ecf52b13e08852760';
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
const sha=bytes=>hash('sha256',bytes);
const gitHash=bytes=>hash('sha1',Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]));
const usageId='external-'+sha(Buffer.from(JSON.stringify([REPO,REV,ARCHIVE_SHA])));
const usage={schema:1,kind:'external-source',id:usageId,resource:'creative-director',repository:REPO,revision:REV,archiveSha256:ARCHIVE_SHA,license:'CC-BY-4.0'};

export class CreativeDirectorResource {
 constructor(){this.root=ROOT;}
 referenceId(){this.index();return usageId;}
 index(){
  if(this.loaded)return this.loaded;
  const raw=readFileSync(join(this.root,'source-lock.json'));
  if(raw.length>1024*1024||sha(raw)!==LOCK_SHA)throw new SafetyError('创意指导资源索引校验失败',503);
  const data=JSON.parse(raw.toString('utf8'));assertSafeJson(data);
  if(data.repository!==REPO||data.revision!==REV||data.archive!=='creative-director.zip'||data.archiveSha256!==ARCHIVE_SHA||data.license!=='CC-BY-4.0'||!Array.isArray(data.files)||data.files.length>1024)throw new SafetyError('创意指导资源来源无效',503);
  const files=new Map();
  for(const row of data.files){
   if(typeof row.path!=='string'||!row.path||row.path.startsWith('/')||row.path.includes('\\')||row.path.split('/').some(part=>!part||part==='.'||part==='..')||
    files.has(row.path)||!/^[a-f0-9]{40}$/.test(row.gitSha1||'')||!/^[a-f0-9]{64}$/.test(row.sha256||'')||!Number.isSafeInteger(row.bytes)||row.bytes<0||row.bytes>2*1024*1024)throw new SafetyError('创意指导资源清单无效',503);
   files.set(row.path,row);
  }
  this.loaded={...data,files};return this.loaded;
 }
 archive(){
  if(this.archiveBytes)return this.archiveBytes;
  const index=this.index(),bytes=readFileSync(join(this.root,index.archive));
  if(bytes.length!==index.archiveBytes||sha(bytes)!==ARCHIVE_SHA)throw new SafetyError('创意指导资源包校验失败',503);
  this.archiveBytes=bytes;return bytes;
 }
 list({query='',offset=0,limit=50}={}){
  if(typeof query!=='string'||query.length>160||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new SafetyError('创意指导资源分页无效',422);
  const index=this.index(),items=[...index.files.values()].filter(row=>row.path.toLowerCase().includes(query.toLowerCase()));
  return {repository:REPO,revision:REV,license:index.license,attribution:index.attribution,scope:index.scope,total:items.length,
   items:items.slice(offset,offset+limit),nextOffset:offset+limit<items.length?offset+limit:null,executed:false};
 }
 read({file,offset=0,limit=20000}={}){
  const index=this.index(),entry=index.files.get(file);
  if(!entry)throw new SafetyError('文件不在固定创意指导资源中',404);
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('读取范围无效',422);
  let rows;try{rows=readZip(this.archive(),{maxEntries:1024,maxEntryBytes:2*1024*1024,maxTotalBytes:32*1024*1024,maxSelectedBytes:2*1024*1024,includeNames:[file]});}
  catch{throw new SafetyError('创意指导资源包损坏',503);}
  const bytes=rows[0]?.data;
  if(!bytes||bytes.length!==entry.bytes||sha(bytes)!==entry.sha256||gitHash(bytes)!==entry.gitSha1)throw new SafetyError('创意指导原文件校验失败',503);
  let content;try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('创意指导文件不是有效 UTF-8',422);}
  return {repository:REPO,revision:REV,file,gitSha1:entry.gitSha1,sha256:entry.sha256,license:index.license,attribution:index.attribution,
   content:content.slice(offset,offset+limit),offset,totalCharacters:content.length,nextOffset:offset+limit<content.length?offset+limit:null,
   executed:false,...(/\.py$/i.test(file)?{note:'原始脚本仅供查阅，不自动执行。'}:{})};
 }
 markUsed(root){
  this.archive(); // Refuse to record use of a missing or changed bundle.
  for(const file of ['LICENSE','NOTICE'])if(sha(readFileSync(join(this.root,file)))!==this.index().files.get(file).sha256)throw new SafetyError('创意指导许可或署名文件不一致',503);
  retainDirectorBundle(root,this,usage);
  const directory=workspacePath(root,join('design','.designcraft','v2','resource-imports'));
  mkdirSync(directory,{recursive:true});
  const path=workspacePath(root,join(directory,usageId+'.json')),bytes=Buffer.from(JSON.stringify(usage,null,2)+'\n');
  if(!atomicCreate(path,bytes)){
   let previous;try{previous=JSON.parse(readFileSync(path,'utf8'));}catch{throw new SafetyError('创意指导来源记录损坏，未覆盖',409);}
   this.verifyUsage(previous);
  }
  return {usage,usageRecorded:true,repository:REPO,revision:REV,license:'CC-BY-4.0',attribution:this.index().attribution,
   note:'请遵循原作者署名要求；上游规则仅在符合用户任务和当前会话权限时作为参考，不自动执行脚本。'};
 }
 verifyUsage(value){
  assertSafeJson(value);
  if(JSON.stringify(value)!==JSON.stringify(usage))throw new SafetyError('创意指导来源记录无效',409);
  return true;
 }
 exportFiles(){
  const index=this.index();this.archive();
  return [{file:'creative-director.zip',sha256:ARCHIVE_SHA},{file:'source-lock.json',sha256:LOCK_SHA},
   ...['LICENSE','NOTICE'].map(file=>({file,sha256:index.files.get(file).sha256}))];
 }
}

/** Resolve the exact recorded version; never substitute current rules for an older project. */
export function openCreativeDirector(root,id){
 const current=new CreativeDirectorResource();
 if(!id)return current;
 if(usageId===id){current.markUsed(root);return current;}
 return loadRetainedDirector(root,id);
}
