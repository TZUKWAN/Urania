import {readdir as asyncReaddir,stat as asyncStat} from 'node:fs/promises';
/**
 * DesignCraft document store: docs + assets + client tasks under <workspace>/design/.
 * - Atomic writes (tmp+rename), revision = sha1 of content.
 * - Watcher: fs.watch recursive (Windows OK) + 2s polling sweep, debounced, loop-guarded
 *   against our own writes via writer token.
 * - Everything defensive: failures throw typed errors the router converts to HTTP codes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync, statSync, watch, rmSync, copyFileSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { validateDocument, workspacePath, assertPortableName, LIMITS } from './safety.js';
import { persistDocument, revisionOf, listHistory, readHistory, atomicWrite, atomicCreate } from './persistence.js';
export { revisionOf } from './persistence.js';

export class StoreError extends Error {
	constructor(message, status = 400) {
		super(message);
		this.status = status;
	}
}

const DOC_EXT = '.dc.json';

export function designDir(root) {
	return join(String(root || ''), 'design');
}
function assetsDir(root) {
	return join(designDir(root), 'assets');
}
function tasksDir(root) {
	return join(designDir(root), '.tasks');
}
function exportsDir(root) {
	return join(designDir(root), 'exports');
}

export function validateRoot(root) {
	const r = String(root || '').trim();
	if (!r) throw new StoreError('root required', 400);
	const resolved = resolve(r);
	if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new StoreError('workspace 目录不存在: ' + resolved, 400);
	return resolved;
}

/** Resolve a path that must stay inside the design dir (traversal guard). */
function inside(base, candidate) {
	const resolved = resolve(base, candidate);
	const baseResolved = resolve(base);
	return resolved === baseResolved || resolved.startsWith(baseResolved + '\\') || resolved.startsWith(baseResolved + '/');
}

export function ensureDirs(root) {
	const dir = workspacePath(root, 'design');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const assets = workspacePath(root, 'design/assets');
	if (!existsSync(assets)) mkdirSync(assets, { recursive: true });
	return dir;
}

function docPath(root, id) {
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(String(id || ''))) throw new StoreError('非法文档 ID: ' + id, 400);
	assertPortableName(id + DOC_EXT);
	return workspacePath(root, join('design', id + DOC_EXT));
}

export function listDocs(root) {
	const dir = designDir(root);
	if (!existsSync(dir)) return [];
	const out = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith(DOC_EXT)) continue;
		const full = join(dir, name);
		try {
			if (!statSync(full).isFile()) continue;
			if (statSync(full).size > LIMITS.documentBytes) continue;
			const content = readFileSync(full, 'utf8');
			const doc = JSON.parse(content);
			out.push({ id: name.slice(0, -DOC_EXT.length), title: doc.title || name, type: doc.type || 'canvas', revision: revisionOf(content), mtime: statSync(full).mtime.toISOString() });
		} catch { /* skip broken file, never crash */ }
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function readDoc(root, id) {
	const file = docPath(root, id);
	if (!existsSync(file)) throw new StoreError('文档不存在: ' + id, 404);
	if (statSync(file).size > LIMITS.documentBytes) throw new StoreError('文档超过结构预算', 413);
	const content = readFileSync(file, 'utf8');
	try {
		return { doc: validateDocument(JSON.parse(content)), revision: revisionOf(content), mtime: statSync(file).mtime.toISOString() };
	} catch (error) {
		throw new StoreError('文档 JSON 损坏: ' + id + ' — ' + error.message, 422);
	}
}

export function writeDoc(root, id, input, writer = 'host', options = {}) {
	const doc = validateDocument(input);
	docPath(root, id);
	ensureDirs(root);
	try {
		doc.version = doc.version || 1;
		doc.id = id;
		doc.updatedAt = new Date().toISOString();
		const result=persistDocument(root,id,doc,writer,options);return options.returnDocument?{...result,doc}:result;
	} catch (error) {
		if (typeof error.status === 'number') throw error;
		throw new StoreError('写入文档失败: ' + error.message, 500);
	}
}

export function createDoc(root, doc) {
	ensureDirs(root);
	let id = String(doc.id || '').trim();
	if (!id) {
		const base = 'doc-' + Date.now().toString(36);
		id = base;
		let n = 1;
		while (existsSync(docPath(root, id))) id = base + '-' + (n++);
	}
	if (existsSync(docPath(root, id))) throw new StoreError('文档已存在: ' + id, 409);
	return writeDoc(root, id, doc, 'host', { create: true });
}

export function listDocHistory(root,id) { docPath(root,id); return listHistory(root,id); }
export function restoreDocHistory(root,id,revision,baseRevision) {
	docPath(root,id);
	return writeDoc(root,id,readHistory(root,id,revision),'restore',{baseRevision});
}

export function deleteDoc(root, id, options = {}) {
	const file = docPath(root, id);
	if (!existsSync(file)) throw new StoreError('文档不存在: ' + id, 404);
	return persistDocument(root,id,null,'delete',{...options,delete:true});
}

/* ---------------- assets ---------------- */

const ASSET_EXT_CONTENT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.html': 'text/html; charset=utf-8' };

export function assetContentType(name) {
	return ASSET_EXT_CONTENT_TYPES[extname(String(name)).toLowerCase()] || 'application/octet-stream';
}

function safeAssetName(name) {
	const base = basename(String(name || '')).replace(/[\\/:*?"<>|]/g, '_');
	if (!base || base.startsWith('.')) throw new StoreError('非法资产名: ' + name, 400);
	if (base.length > 120) throw new StoreError('资产名过长', 400);
	if(extname(base).length>32)throw new StoreError('文件扩展名过长',400);
	return assertPortableName(base);
}

function saveImmutable(root,folder,name,buffer,maxBytes){
  const original=safeAssetName(name);if(!Buffer.isBuffer(buffer)||buffer.length===0)throw new StoreError('文件内容为空',400);
  if(buffer.length>maxBytes)throw new StoreError('文件超过大小预算',413);
  const directory=workspacePath(root,join('design',folder));mkdirSync(directory,{recursive:true});
  const ext=extname(original),stem=original.slice(0,original.length-ext.length).slice(0,Math.min(75,120-25-ext.length)),hash=createHash('sha256').update(buffer).digest('hex').slice(0,24);
  let safe=original;
  for(let attempt=0;attempt<2;attempt++){
    const file=workspacePath(root,join('design',folder,safe));
    if(atomicCreate(file,buffer))return {name:safe,size:buffer.length,path:'design/'+folder+'/'+safe};
    if(statSync(file).size===buffer.length&&readFileSync(file).equals(buffer))return {name:safe,size:buffer.length,path:'design/'+folder+'/'+safe};
    safe=stem+'-'+hash+ext;
  }
  throw new StoreError('不可变文件版本冲突，原文件未被覆盖',409);
}
export function saveAsset(root,name,buffer){ensureDirs(root);return saveImmutable(root,'assets',name,buffer,64*1024*1024);}

export function readAsset(root, name) {
	const safe = safeAssetName(name);
	const file = workspacePath(root, join('design', 'assets', safe));
	if (!existsSync(file)) return null;
	if(statSync(file).size>64*1024*1024)throw new StoreError('资产超过64MB读取预算',413);
	return readFileSync(file);
}

export function listAssets(root) {
	const dir = assetsDir(root);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter(n => !n.startsWith('.') && !n.endsWith('.tmp') && !/\.tmp-/.test(n))
		.map(n => {
			try { const st = statSync(join(dir, n)); return { name: n, size: st.size, mtime: st.mtime.toISOString(), contentType: assetContentType(n) }; }
			catch { return null; }
		})
		.filter(Boolean)
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Copy any file into design/assets (used by asset.addFromFile). Returns {name,...}. */
export function importFileAsAsset(root, filePath) {
	const resolved = resolve(String(filePath || '').trim());
	if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new StoreError('文件不存在: ' + filePath, 400);
	if(statSync(resolved).size>64*1024*1024)throw new StoreError('资产超过64MB导入预算，请使用原生大文件导入',413);
	return saveAsset(root, basename(resolved), readFileSync(resolved));
}

/* ---------------- exports ---------------- */

export function saveExport(root,name,buffer){return saveImmutable(root,'exports',name,buffer,128*1024*1024);}

export function readExport(root, name) {
	const safe = safeAssetName(name);
	const file = workspacePath(root, join('design', 'exports', safe));
	if (!inside(exportsDir(root), file) || !existsSync(file)) return null;
	return readFileSync(file);
}

/* ---------------- client tasks (raster jobs) ---------------- */

export function addTask(root, job) {
	const dir = tasksDir(root);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const id = 'task-' + randomUUID().slice(0, 12);
	const record = { id, createdAt: new Date().toISOString(), status: 'pending', ...job };
	writeFileSync(join(dir, id + '.json'), JSON.stringify(record, null, 2), 'utf8');
	return record;
}

export function listTasks(root) {
	const dir = tasksDir(root);
	if (!existsSync(dir)) return [];
	return readdirSync(dir).filter(n => n.endsWith('.json')).map(n => {
		try { return JSON.parse(readFileSync(join(dir, n), 'utf8')); } catch { return null; }
	}).filter(t => t && t.status === 'pending');
}

export function completeTask(root, taskId, result) {
	const dir = tasksDir(root);
	const file = join(dir, (String(taskId || '')) + '.json');
	if (!inside(dir, file) || !existsSync(file)) throw new StoreError('任务不存在: ' + taskId, 404);
	const record = JSON.parse(readFileSync(file, 'utf8'));
	record.status = 'done';
	record.completedAt = new Date().toISOString();
	record.result = { asset: result?.asset || null };
	writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
	return record;
}

/* ---------------- watcher ---------------- */

/**
 * Watch <root>/design recursively. Emits debounced change events:
 * { kind: 'doc'|'asset'|'export'|'task', name, writer } — writer is 'host' when unknown.
 * Loop-guard: writes performed with markSelfWrite(path) are suppressed once.
 */
export function createWatcher(root, emit, options = {}) {
	const dir = designDir(root);
	if (!existsSync(dir)) ensureDirs(root);
	let selfWrites = new Map(); // path → expiry timestamp
	const pending = new Map();
	let timer = null;
	let closed = false;

	const markSelfWrite = (path) => { selfWrites.set(resolve(path), Date.now() + 1500); };

	const flush = () => {
		timer = null;
		const batch = [...pending.values()];
		pending.clear();
		if(batch.length>50){try{emit({kind:'batch',count:batch.length,at:new Date().toISOString()});}catch{}return;}
		for (const event of batch) {
			try { emit(event); } catch { /* never crash on emit */ }
		}
	};

	const classify = (filePath) => {
		const rel = resolve(filePath);
		if (rel.includes(join(dir,'.designcraft'))) return null;
		if (rel.endsWith('.dc.json') && !rel.includes('.tmp')) return 'doc';
		if (rel.includes(assetsDir(root)) && !/\.tmp-/.test(rel)) return 'asset';
		if (rel.includes(exportsDir(root)) && !/\.tmp-/.test(rel)) return 'export';
		if (rel.includes(tasksDir(root)) && rel.endsWith('.json')) return 'task';
		return null;
	};

	const handleChange = (filePath) => {
		if (closed) return;
		const resolved = resolve(filePath);
		const kind = classify(resolved);
		if (!kind) return;
		const until = selfWrites.get(resolved);
		if (until && Date.now() < until) return;
		const name = kind === 'doc' ? basename(resolved).slice(0, -DOC_EXT.length) : basename(resolved);
		pending.set(resolved, { kind, name, at: new Date().toISOString() });
		if (!timer) timer = setTimeout(flush, 180);
	};

	// polling sweep — catches fs.watch misses (network drives, batch renames)
  let lastSnapshot=new Map(),sweeping=false;
  async function snapshot(){
    const out=new Map();
    // Store-owned files are flat. Do not walk unrelated project directories or native history.
    for(const folder of ['', 'assets','exports','.tasks']){
      let base,entries;try{base=workspacePath(root,join('design',folder));entries=await asyncReaddir(base,{withFileTypes:true});}catch{continue;}
      if(closed)return out;
      if(entries.length>10000)throw new StoreError('文件监听目录超过10000项预算，保留原生监听',413);
      const files=entries.filter(entry=>entry.isFile()&&!entry.name.startsWith('.')&&!/\.tmp-/.test(entry.name)&&(folder||entry.name.endsWith('.dc.json')));
      for(let index=0;index<files.length;index+=16){
        if(closed)return out;
        await Promise.all(files.slice(index,index+16).map(async entry=>{try{const relative=folder?folder+'/'+entry.name:entry.name;out.set(relative,(await asyncStat(join(base,entry.name))).mtimeMs);}catch{}}));
      }
    }
    return out;
  }
  async function sweep(){
    if(closed||sweeping)return;sweeping=true;
    try{
      for(const [key,expires]of selfWrites)if(expires<=Date.now())selfWrites.delete(key);
      const now=await snapshot();if(closed)return;
      for(const [relative,mtime]of now)if(lastSnapshot.get(relative)!==mtime)handleChange(join(dir,relative));
      for(const relative of lastSnapshot.keys())if(!now.has(relative))handleChange(join(dir,relative));
      lastSnapshot=now;
    }catch(error){if(!closed)try{emit({kind:'watcher-error',error:String(error.message),fallback:'native-watch'});}catch{}}
    finally{sweeping=false;}
  }
  sweep();

	const pollTimer = setInterval(sweep, options.pollMs || 2000);
	pollTimer.unref?.();

	let watcher = null;
	try {
		watcher = (options.watchImpl || watch)(dir, { recursive: true }, (_event, fileName) => { if (fileName) handleChange(join(dir, fileName)); });
		watcher.on('error', (error) => {
			try { watcher?.close(); } catch {}
			watcher = null;
			if (!closed) { try { emit({kind:'watcher-error', error:String(error?.message || error), fallback:'polling'}); } catch {} }
		});
	} catch { /* polling covers creation errors too */ }

	return {
		markSelfWrite,
		close() {
			closed = true;
			try { watcher?.close(); } catch { }
			try { clearInterval(pollTimer); } catch { }
			try { clearTimeout(timer); } catch { }
		}
	};
}
