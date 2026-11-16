import { existsSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, basename, join, isAbsolute } from 'node:path';

export class SafetyError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'SafetyError'; this.status = status; }
}
export const LIMITS = Object.freeze({ pixels:24_000_000,maxDimension:16384,documentBytes:16*1024*1024,nodes:100000,depth:64,commands:10000 });
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

export function assertSafeJson(value) {
  let nodes = 0;
  const seen = new WeakSet();
  const visit = (item, depth) => {
    if (++nodes > LIMITS.nodes || depth > LIMITS.depth) throw new SafetyError('文档结构超过安全预算', 413);
    if (typeof item === 'number' && !Number.isFinite(item)) throw new SafetyError('数值必须为有限数字');
    if (item == null || typeof item !== 'object') {
      if (['function', 'symbol', 'bigint'].includes(typeof item)) throw new SafetyError('仅支持可序列化的 JSON 数据');
      return;
    }
    if (seen.has(item)) throw new SafetyError('JSON 数据不能包含循环引用');
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key)) throw new SafetyError('禁止的文档字段: ' + key);
      visit(child, depth + 1);
    }
    seen.delete(item);
  };
  visit(value, 0);
}

export function assertImageSize(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width>LIMITS.maxDimension||height>LIMITS.maxDimension||width * height > LIMITS.pixels) {
    throw new SafetyError('图片尺寸无效或超过单边16384/总量24MP预算',413);
  }
}

export function validateDocument(input) {
  assertSafeJson(input);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SafetyError('doc 必须为对象');
  const doc = { ...input };
  const stringField=(obj,key)=>{if(obj[key]!=null&&typeof obj[key]!=='string')throw new SafetyError(key+' 必须为文本');};
  for(const key of ['id','title','type','theme'])stringField(doc,key);
  if(doc.designSystem!=null&&(typeof doc.designSystem!=='object'||Array.isArray(doc.designSystem)))throw new SafetyError('designSystem 必须为令牌对象');
  if (doc.pages == null) doc.pages = [];
  if (!Array.isArray(doc.pages)) throw new SafetyError('pages 必须为数组');
  if (doc.assets == null) doc.assets = [];
  if (!Array.isArray(doc.assets)) throw new SafetyError('assets 必须为数组');
  if (doc.canvas == null) doc.canvas = { width: 1280, height: 720 };
  if(!Number.isFinite(doc.canvas.width)||!Number.isFinite(doc.canvas.height)||doc.canvas.width<=0||doc.canvas.height<=0||doc.canvas.width*doc.canvas.height>LIMITS.pixels)throw new SafetyError('画板尺寸无效或超过24MP预算',413);
  const ids = new Set();
  const id = (value, label) => {
    if (typeof value !== 'string' || !value || value.length > 160) throw new SafetyError(label + ' 需要有效 ID');
    if (ids.has(value)) throw new SafetyError('文档包含重复 ID: ' + value);
    ids.add(value);
  };
  const layers = (items) => {
    if (!Array.isArray(items)) throw new SafetyError('layers 必须为数组');
    for (const layer of items) {
      if (!layer || typeof layer !== 'object' || Array.isArray(layer)) throw new SafetyError('图层必须为对象');
      id(layer.id, '图层');
      for(const key of ['name','text','fontFamily','color','align','vAlign','shape','blend'])stringField(layer,key);
      if(layer.adjust!=null) {
        if(typeof layer.adjust!=='object'||Array.isArray(layer.adjust))throw new SafetyError('adjust 必须为对象');
        for(const value of Object.values(layer.adjust))if(typeof value!=='number'&&typeof value!=='boolean')throw new SafetyError('调整参数必须为数字或布尔值');
      }
      if (!['image','text','shape','vector','table','chart','adjustment','group','instance','native'].includes(layer.type)) throw new SafetyError('未知图层类型: ' + layer.type);
      for (const key of ['x','y','w','h','rotation','opacity','fontSize','lineHeight','letterSpacing']) {
        if (layer[key] != null && (typeof layer[key] !== 'number' || !Number.isFinite(layer[key]))) throw new SafetyError('图层 ' + key + ' 必须为有限数字');
      }
      if (layer.opacity != null && (layer.opacity < 0 || layer.opacity > 1)) throw new SafetyError('不透明度必须为 0 到 1');
      if (layer.type === 'group') layers(layer.children || []);
      if (layer.type === 'vector' && !Array.isArray(layer.paths)) throw new SafetyError('矢量 paths 必须为数组');
      if (layer.type === 'table' && (!Array.isArray(layer.rows) || layer.rows.some(row=>!Array.isArray(row)))) throw new SafetyError('表格 rows 必须为二维数组');
      if (layer.type === 'chart') {
        if (!layer.data || !Array.isArray(layer.data.series) || !layer.data.series.length || layer.data.series.some(s=>!s || !Array.isArray(s.values) || s.values.some(v=>typeof v !== 'number' || !Number.isFinite(v)))) throw new SafetyError('图表需要有效数值系列');
      }
    }
  };
  for (const page of doc.pages) {
    if (!page || typeof page !== 'object') throw new SafetyError('页面必须为对象');
    for(const key of ['name','notes','layout'])stringField(page,key);
    id(page.id, '页面'); layers(page.layers || []);
    if(page.native?.engine==='deckcraft'&&doc.native?.deck?.mode==='source'){
      const proxy=page.layers?.[0],previews=page.layers.filter(layer=>layer.type==='native'&&layer.native?.engine==='deckcraft'&&layer.native.role==='page');
      if(previews.length!==1||proxy!==previews[0]||proxy.native.slideId!==page.native.slideId||proxy.native.source!==doc.native.deck.source||proxy.asset!==proxy.native.renderedAsset||proxy.x!==0||proxy.y!==0||proxy.w!==doc.canvas.width||proxy.h!==doc.canvas.height||proxy.opacity!==1||proxy.rotation||proxy.crop||proxy.hidden||proxy.mask||proxy.locked!==true)throw new SafetyError('原生页底稿引用或预览变换无效，请通过原生编辑接口修改',422);
    }
  }
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > LIMITS.documentBytes) throw new SafetyError('文档超过 16MB 结构预算', 413);
  return doc;
}

function canonical(path) {
  let current = resolve(path); const missing = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) throw new SafetyError('路径不存在', 404);
    missing.unshift(basename(current)); current = parent;
  }
  return join(realpathSync(current), ...missing);
}

export function workspacePath(root, candidate, { mustExist = false } = {}) {
  const base = canonical(root), file = canonical(resolve(root, String(candidate)));
  const rel = relative(base, file);
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new SafetyError('路径超出工作区', 403);
  if (mustExist && !existsSync(file)) throw new SafetyError('文件不存在: ' + candidate, 404);
  return file;
}

export function assertPortableName(name) {
  if (!name || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new SafetyError('非法文件名: ' + name);
  return name;
}
