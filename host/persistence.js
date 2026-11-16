import { existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, readFileSync, readdirSync, statSync, linkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { SafetyError, workspacePath, LIMITS } from './safety.js';

export const revisionOf = (content) => createHash('sha256').update(content).digest('hex').slice(0, 24);

function readBounded(file) {
  if (statSync(file).size > LIMITS.documentBytes) throw new SafetyError('文档超过结构预算', 413);
  return readFileSync(file, 'utf8');
}

export function atomicWrite(file, content, { rename = renameSync } = {}) {
  const temp = file + '.tmp-' + randomUUID();
  let fd;
  try {
    fd = openSync(temp, 'wx');
    writeFileSync(fd, content, 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined;
    rename(temp, file);
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch {} }
    try { unlinkSync(temp); } catch {}
    throw error; // never fall back to truncating the last good document
  }
}

/** Fully write a new immutable file, then publish it without ever replacing another writer. */
export function atomicCreate(file,content){
  const temp=file+'.tmp-'+randomUUID();let fd;
  try{
    fd=openSync(temp,'wx');writeFileSync(fd,content);fsyncSync(fd);closeSync(fd);fd=undefined;
    try{linkSync(temp,file);return true;}catch(error){if(error.code==='EEXIST')return false;throw error;}
  }finally{if(fd!==undefined)try{closeSync(fd);}catch{}try{unlinkSync(temp);}catch{}}
}

function metadataDir(root, id) {
  return workspacePath(root, join('design','.designcraft','history',id));
}

function acquireLock(lock) {
  for(let attempt=0;attempt<2;attempt++) {
    let fd;
    try {fd=openSync(lock,'wx');writeFileSync(fd,JSON.stringify({pid:process.pid,token:randomUUID(),at:Date.now()}));return fd;}
    catch(error) {
      if(fd!==undefined){try{closeSync(fd);}catch{}try{unlinkSync(lock);}catch{}throw error;}
      if(error.code!=='EEXIST')throw error;
      try {
        if(statSync(lock).size>4096)break;
        const text=readFileSync(lock,'utf8'),owner=JSON.parse(text);
        if(!Number.isSafeInteger(owner.pid)||owner.pid<=0)break;
        let dead=false;
        try{process.kill(owner.pid,0);}catch(e){dead=e.code==='ESRCH';}
        if(dead&&readFileSync(lock,'utf8')===text){unlinkSync(lock);continue;}
      }catch{}
      break;
    }
  }
  throw new SafetyError('文档正被另一个写入者占用，请稍后重试',423);
}

export function persistDocument(root, id, doc, writer, options = {}) {
  const file = workspacePath(root, join('design', id + '.dc.json'));
  const lock = file + '.lock';
  let lockFd;
  try { lockFd = acquireLock(lock); }
  catch (error) {
    if (lockFd !== undefined) { try { closeSync(lockFd); } catch {} try { unlinkSync(lock); } catch {} }
    if(error.status)throw error;
    throw new SafetyError('无法创建文档写入锁: '+error.message,500);
  }
  try {
    const previous = existsSync(file) ? readBounded(file) : null;
    const revision = previous == null ? null : revisionOf(previous);
    if (options.delete && previous == null) throw new SafetyError('文档不存在: ' + id,404);
    if (options.create && previous != null) throw new SafetyError('文档已存在: ' + id, 409);
    if (previous != null && options.baseRevision == null) throw new SafetyError('保存需要 baseRevision；请先读取最新文档', 428);
    if (options.baseRevision != null && options.baseRevision !== revision) {
      const conflict = new SafetyError('文档已被更新，未覆盖任何修改', 409);
      conflict.current = { doc: previous == null ? null : JSON.parse(previous), revision };
      throw conflict;
    }
    const content = options.delete ? null : JSON.stringify(doc, null, 2);
    if(content!=null&&Buffer.byteLength(content,'utf8')>LIMITS.documentBytes)throw new SafetyError('格式化后的文档超过16MB预算，未覆盖原版本',413);
    if (previous != null) {
      const history = metadataDir(root,id); mkdirSync(history,{recursive:true});
      const snapshot = join(history,revision+'.dc.json');
      if (!existsSync(snapshot)) atomicWrite(snapshot,previous);
    }
    // Catch file-tool edits that happened while the history snapshot was written.
    const latest = existsSync(file) ? revisionOf(readBounded(file)) : null;
    if (latest !== revision) {
      const conflict = new SafetyError('保存期间文件被外部更新，未覆盖修改',409);
      conflict.current = existsSync(file) ? {doc:JSON.parse(readBounded(file)),revision:latest} : {doc:null,revision:null};
      throw conflict;
    }
    if (options.delete) unlinkSync(file);
    else atomicWrite(file,content);
    pruneHistory(root,id);
    return { id, revision:content == null ? null : revisionOf(content), writer };
  } finally {
    try { closeSync(lockFd); } catch {}
    try { unlinkSync(lock); } catch {}
  }
}

function pruneHistory(root,id) {
  try {
    const dir=metadataDir(root,id);
    if (!existsSync(dir)) return;
    const files=readdirSync(dir).filter(n=>/^[a-f0-9]{24}\.dc\.json$/.test(n)).map(n=>({path:join(dir,n),...statSync(join(dir,n))})).sort((a,b)=>b.mtimeMs-a.mtimeMs);
    let total=0;
    for (let i=0;i<files.length;i++) {
      total+=files[i].size;
      if (i>=50 || total>128*1024*1024) unlinkSync(files[i].path);
    }
  } catch { /* cleanup failure must not turn an already committed save into failure */ }
}

export function listHistory(root,id) {
  const dir=metadataDir(root,id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n=>/^[a-f0-9]{24}\.dc\.json$/.test(n)).map(n=>{
    const st=statSync(join(dir,n));return {revision:n.slice(0,-8),at:st.mtime.toISOString(),bytes:st.size};
  }).sort((a,b)=>b.at.localeCompare(a.at));
}

export function readHistory(root,id,revision) {
  if (!/^[a-f0-9]{24}$/.test(String(revision))) throw new SafetyError('非法历史版本');
  const file=workspacePath(root,join('design','.designcraft','history',id,revision+'.dc.json'),{mustExist:true});
  return JSON.parse(readBounded(file));
}
