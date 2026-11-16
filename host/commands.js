/**
 * DesignCraft command executor — the AI orchestration surface.
 * Stages a single-work document transaction; failed batches never commit document changes.
 * Assets and exports are immutable outputs. Multiple work documents require separate batches.
 * Native engines are executed by workspace-native.js; this module owns common structure
 * and local layout/template operations, without pretending a parser subset is a native engine.
 */
import * as store from './docstore.js';
import { instantiateTemplate, listTemplates } from './templates.js';
import { buildDeckFromOutline, buildLayoutSlide } from './decklayouts.js';
import { listDesignSystems, getDesignSystem } from './designsystems.js';
import {existsSync} from 'node:fs';
import { assertSafeJson, validateDocument, workspacePath, LIMITS } from './safety.js';

let uid = 0;
const genId = (p) => `${p}_${Date.now().toString(36)}${(++uid).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function catalog() {
	return {
		templates: listTemplates(),
		designSystems: listDesignSystems(),
		commands: [
			'doc.create', 'doc.update', 'doc.list', 'doc.read',
			'page.add', 'page.update', 'page.delete', 'page.reorder',
			'layer.add', 'layer.update', 'layer.delete', 'layer.reorder',
			'asset.add', 'asset.addFromFile',
			'designsystem.apply', 'designsystem.applyPreset',
			'template.instantiate', 'deck.fromOutline', 'deck.addSlide',
			'export.md',
		]
	};
}

class Batch {
	constructor(root, options = {}) {
		this.root = root;
		this.docs = new Map(); // id → {doc, touched}
		this.options = options;
		this.exports=[];
		this.baseRevisions = new Map(Object.entries(options.baseRevisions || {}));
	}

	load(id) {
		if (this.docs.has(id)) return this.docs.get(id).doc;
		const { doc, revision } = store.readDoc(this.root, id);
		if (this.options.requireRevision && !this.baseRevisions.has(id)) throw new store.StoreError('修改已有作品需要 baseRevisions['+id+']；请先读取最新版本',428);
		if (this.baseRevisions.has(id) && this.baseRevisions.get(id)!==revision) {
			const conflict=new store.StoreError('作品已更新，命令未覆盖任何修改',409);conflict.current={doc,revision};throw conflict;
		}
		this.docs.set(id, { doc, revision, touched: false });
		return doc;
	}


  create(input){
    const doc=validateDocument(JSON.parse(JSON.stringify({...input,id:input.id||genId('doc')})));
    if(this.docs.has(doc.id)||existsSync(workspacePath(this.root,'design/'+doc.id+'.dc.json')))throw new store.StoreError('文档已存在: '+doc.id,409);
    this.docs.set(doc.id,{doc,revision:null,created:true,touched:true});this.assertSingleWork();return {id:doc.id,revision:null};
  }
  assertSingleWork(){if([...this.docs.values()].filter(entry=>entry.touched).length>1)throw new store.StoreError('一个批次只提交一个作品；请将多个作品分成独立的版本化请求',422);}
  export(name,buffer){
    const exportToken=this.exports.length;this.exports.push({name,buffer});return {file:name,exportToken};
  }

	touch(id) {
		const entry = this.docs.get(id);
		if (!entry) throw new store.StoreError('文档未加载: ' + id, 500);
		entry.touched = true;this.assertSingleWork();
		return entry.doc;
	}

  flush(writer='host'){
    this.assertSingleWork();const written=[];
    for(const entry of this.docs.values())if(entry.touched)validateDocument(entry.doc);
    try{
      for(const [id,entry]of this.docs){if(!entry.touched)continue;const result=store.writeDoc(this.root,id,entry.doc,writer,{baseRevision:entry.revision,create:entry.created===true});written.push(result);entry.revision=result.revision;entry.touched=false;}
      for(const item of this.exports)item.saved=store.saveExport(this.root,item.name,item.buffer);
      return written;
    }catch(error){error.written=written;throw error;}
  }

}

function findPage(doc, pageId) {
	const page = (doc.pages || []).find(p => p.id === pageId || p.name === pageId);
	if (!page) throw new store.StoreError('页面不存在: ' + pageId, 404);
	return page;
}

function findLayer(page, layerId) {
	const found = findLayerDeep(page.layers || [], layerId);
	if (!found) throw new store.StoreError('图层不存在: ' + layerId, 404);
	return found;
}

function findLayerDeep(layers, layerId) {
	for (let i = 0; i < layers.length; i++) {
		if (layers[i].id === layerId) return { layer: layers[i], list: layers, index: i };
		if (layers[i].type === 'group' && Array.isArray(layers[i].children)) {
			const deep = findLayerDeep(layers[i].children, layerId);
			if (deep) return deep;
		}
	}
	return null;
}

function deepMerge(target, patch) {
	assertSafeJson(patch);
	for (const [key, value] of Object.entries(patch || {})) {
		if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(target, key) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
			deepMerge(target[key], value);
		} else if (value === '__DELETE__') {
			delete target[key];
		} else {
			target[key] = value;
		}
	}
	return target;
}

/* ---------------- command dispatch ---------------- */

export function executeCommands(root, commands, options = {}) {
	if (!Array.isArray(commands) || commands.length > LIMITS.commands) throw new store.StoreError('命令必须为数组且不超过 ' + LIMITS.commands + ' 条', 413);
	const batch = new Batch(root, options);
	const results = [];
	for (let i = 0; i < (commands || []).length; i++) {
		const cmd = commands[i];
		const kind = String(cmd?.op || cmd?.kind || '').trim();
		options.onProgress?.({index:i,total:commands.length,operation:kind});
		try {
			assertSafeJson(cmd);
			const result = dispatch(batch, root, kind, cmd, options);
			results.push({ i, op: kind, ok: true, ...(result || {}) });
		} catch (error) {
			results.push({ i, op: kind, ok: false, error: error?.message || String(error), status:error.status||400, ...(error.current?{current:error.current}:{}) });
			if (options.stopOnError) break;
		}
	}
  let written=[];
  if(!results.some(result=>!result.ok)){
    try{written=batch.flush('host');}
    catch(error){written=error.written||[];results.push({i:-1,op:'commit',ok:false,error:error.message,status:error.status||500,...(error.current?{current:error.current}:{})});}
  }
  const committed=new Map(written.map(item=>[item.id,item.revision]));
  for(const result of results){
    if(result.revision===null&&committed.has(result.id))result.revision=committed.get(result.id);
    if(result.exportToken!=null){
      const item=batch.exports[result.exportToken];delete result.exportToken;
      if(item.saved)Object.assign(result,{file:item.saved.name,path:item.saved.path,size:item.saved.size});
      else{delete result.file;result.ok=false;result.error='批次未完成，导出产物未提交';result.rolledBack=true;}
    }
    if(results.some(item=>!item.ok))result.documentsCommitted=written.length>0;
  }
  return {results,written,transaction:{scope:'single-work',committed:written.length>0,retainedAssets:'immutable'}};

}

function dispatch(batch, root, kind, cmd, options) {
	switch (kind) {
		case 'doc.list': return { docs: store.listDocs(root) };
		case 'doc.read': {
			const { doc, revision } = store.readDoc(root, String(cmd.id));
			return { doc, revision };
		}
		case 'doc.create': {
			const doc = typeof cmd.doc === 'object' && cmd.doc ? cmd.doc : {};
			doc.pages = Array.isArray(doc.pages) ? doc.pages : [];
			doc.assets = Array.isArray(doc.assets) ? doc.assets : [];
			const created = batch.create(doc);
			return { id: created.id, revision: created.revision };
		}
		case 'doc.update': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			if (cmd.patch) deepMerge(doc, cmd.patch);
			return { id: doc.id };
		}
		case 'page.add': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const page = cmd.page && typeof cmd.page === 'object' ? cmd.page : {};
			page.id = page.id || genId('pg');
			page.layers = Array.isArray(page.layers) ? page.layers : [];
			if (cmd.index != null) doc.pages.splice(Math.max(0, Math.min(doc.pages.length, cmd.index)), 0, page);
			else doc.pages.push(page);
			return { pageId: page.id };
		}
		case 'page.update': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const page = findPage(doc, String(cmd.pageId));
			deepMerge(page, cmd.patch || {});
			return { pageId: page.id };
		}
		case 'page.delete': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const before = doc.pages.length;
			doc.pages = doc.pages.filter(p => p.id !== cmd.pageId && p.name !== cmd.pageId);
			return { removed: before - doc.pages.length };
		}
		case 'page.reorder': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const order = (cmd.order || []).map(String);
			const map = new Map((doc.pages || []).map(p => [p.id, p]));
			const next = order.map(id => map.get(id)).filter(Boolean);
			for (const p of doc.pages || []) if (!order.includes(p.id)) next.push(p);
			doc.pages = next;
			return { pages: doc.pages.length };
		}
		case 'layer.add': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const page = findPage(doc, String(cmd.pageId));
			const layer = cmd.layer && typeof cmd.layer === 'object' ? cmd.layer : {};
            const unsupported=items=>(items||[]).some(l=>l?.type==='instance'||unsupported(l?.children));if(unsupported([layer]))throw new store.StoreError('组件实例尚未接通渲染，未创建不可见对象',422);
			layer.id = layer.id || genId(layer.type === 'text' ? 'txt' : layer.type === 'image' ? 'img' : layer.type === 'vector' ? 'vec' : 'lyr');
			if (cmd.index != null) page.layers.splice(Math.max(0, Math.min(page.layers.length, cmd.index)), 0, layer);
			else page.layers.push(layer);
			return { layerId: layer.id };
		}
		case 'layer.update': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const page = findPage(doc, String(cmd.pageId));
			const found = findLayer(page, String(cmd.layerId));
            if(cmd.patch?.type==='instance')throw new store.StoreError('组件实例尚未接通渲染',422);
			if(found.layer.type==='vector'&&!found.layer.geometryBox)found.layer.geometryBox={x:found.layer.x,y:found.layer.y,w:found.layer.w,h:found.layer.h};
			deepMerge(found.layer, cmd.patch || {});
			return { layerId: found.layer.id };
		}
		case 'layer.delete': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const page = findPage(doc, String(cmd.pageId));
			const found = findLayer(page, String(cmd.layerId));
			found.list.splice(found.index, 1);
			return { removed: found.layer.id };
		}
		case 'layer.reorder': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const page = findPage(doc, String(cmd.pageId));
			const order = (cmd.order || []).map(String);
			page.layers.sort((a, b) => {
				const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
				return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
			});
			return { layers: page.layers.length };
		}
		case 'asset.add': {
			const buffer = Buffer.from(String(cmd.dataBase64 || ''), 'base64');
			const saved = store.saveAsset(root, String(cmd.name || genId('asset') + '.png'), buffer);
			if (cmd.docId) {
				const doc = batch.load(String(cmd.docId));
				batch.touch(String(cmd.docId));
				doc.assets = doc.assets || [];
				if (!doc.assets.some(a => a.src === saved.path)) {
					doc.assets.push({ id: genId('as'), kind: 'asset', name: saved.name, src: saved.path });
				}
			}
			return { asset: saved.name, path: saved.path, size: saved.size };
		}
		case 'asset.addFromFile': {
			const saved = store.importFileAsAsset(root,workspacePath(root,String(cmd.path),{mustExist:true}));
			if (cmd.docId) {
				const doc = batch.load(String(cmd.docId));
				batch.touch(String(cmd.docId));
				doc.assets = doc.assets || [];
				if (!doc.assets.some(a => a.src === saved.path)) {
					doc.assets.push({ id: genId('as'), kind: 'asset', name: saved.name, src: saved.path });
				}
			}
			return { asset: saved.name, path: saved.path };
		}
		case 'image.op': {throw new store.StoreError('请使用原生 photo.import/photo.apply；旧 CPU 图片子集入口已停用',410);}

		case 'vector.fromSvg': {throw new store.StoreError('请使用原生 vector.import/native.inspect；旧 SVG 子集解析入口已停用',410);}

		case 'vector.addSvgToPage': {throw new store.StoreError('请上传 SVG 并使用原生 vector.import；旧解析器不会再冒充完整导入',410);}

		case 'designsystem.apply': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			doc.designSystem = cmd.designSystem && typeof cmd.designSystem === 'object' ? cmd.designSystem : doc.designSystem;
			return { applied: true };
		}
		case 'designsystem.applyPreset': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const preset = getDesignSystem(String(cmd.presetId));
			if (!preset) throw new store.StoreError('设计系统不存在: ' + cmd.presetId, 404);
			doc.designSystem = preset.tokens;
			return { applied: preset.id, name: preset.name };
		}
		case 'template.instantiate': {
			const doc = instantiateTemplate(String(cmd.templateId), cmd.vars || {}, cmd.designSystem && getDesignSystem(cmd.designSystem)?.tokens);
			if (!doc) throw new store.StoreError('模板不存在: ' + cmd.templateId, 404);
			if (cmd.save) {
				const created = batch.create(doc);
				return { id: created.id, revision: created.revision, pages: doc.pages.length };
			}
			return { doc };
		}
		case 'deck.fromOutline': {
			const doc = buildDeckFromOutline({
				title: cmd.title, subtitle: cmd.subtitle, theme: cmd.theme || 'midnight',
				canvas: cmd.canvas, footer: cmd.footer, slides: cmd.slides || []
			});
			if (cmd.designSystemId && getDesignSystem(String(cmd.designSystemId))) doc.designSystem = getDesignSystem(String(cmd.designSystemId)).tokens;
			if (cmd.save) {
				const created = batch.create(doc);
				return { id: created.id, revision: created.revision, pages: doc.pages.length };
			}
			return { doc };
		}
		case 'deck.addSlide': {
			const doc = batch.load(String(cmd.id));
			batch.touch(String(cmd.id));
			const page = buildLayoutSlide(String(cmd.layout || 'titleContent'), cmd.vars || {}, cmd.theme || doc.theme || 'midnight', doc.canvas);
			if (cmd.index != null) doc.pages.splice(Math.max(0, Math.min(doc.pages.length, cmd.index)), 0, page);
			else doc.pages.push(page);
			return { pageId: page.id };
		}
		case 'export.pptx': {throw new store.StoreError('请调用原生操作 deck.export；旧形状近似导出已停用',410);}

		case 'export.pdf': {throw new store.StoreError('请使用原生 deck.pdf 或编辑视图的渲染 PDF；旧子集导出已停用',410);}

		case 'export.svg': {throw new store.StoreError('请使用原生 vector.export 导出当前对象；旧页面 SVG 子集导出已停用',410);}

		case 'export.html': {throw new store.StoreError('请从编辑视图导出 HTML 图像预览；旧不完整导出已停用',410);}

		case 'export.md': {
			const doc = batch.load(String(cmd.id));
			const lines = ['# ' + (doc.title || '演示文稿'), ''];
			(doc.pages || []).forEach((page, i) => {
				lines.push(`## ${i + 1}. ${page.name || '未命名'}`);
				if (page.notes) lines.push('', page.notes);
				for (const layer of page.layers || []) {
					if (layer.type === 'text' && layer.text) lines.push('', String(layer.text));
				}
				lines.push('');
			});
			return batch.export(String(cmd.out || (doc.title || cmd.id) + '.md'), Buffer.from(lines.join('\n'), 'utf8'));
		}
		case 'psd.import': {throw new store.StoreError('请上传源文件并使用原生 photo.import；旧8位子集导入已停用',410);}

		case 'task.enqueue': {
			throw new store.StoreError('旧任务入队接口已停用；请直接提交受监管的命令任务。',410);
		}
		default:
			throw new store.StoreError('未知命令: ' + kind, 400);
	}
}

