import {vectorMatrix} from './path.js';
/**
 * DesignCraft client render engine — Canvas-2D WYSIWYG pipeline.
 * Renders dcDoc pages: background + layers (image/text/shape/vector/table/chart/
 * adjustment/group) with blend modes, masks, per-layer adjustments & filters,
 * layer styles (shadow/glow), design-system var() resolution, caches.
 * No framework dependencies; safe to import from anywhere.
 */

/* ---------------- caches ---------------- */

const processCache = new Map(); // key → HTMLCanvasElement
const surfaceCache = new Map(); // layerId → { canvas, assetKey } (paint surfaces)
const imageFlights=new Map();
function serial(){let tail=Promise.resolve(),queued=0;return run=>{if(queued>=256)return Promise.reject(new Error('渲染队列超过256项，请减少同时预览的页面'));queued++;const task=tail.then(run);tail=task.catch(()=>{});return task.finally(()=>queued--);};}
const decodeSerial=serial(),processSerial=serial();
const imageCache = new Map();   // src → HTMLImageElement (decoded)
let assetContext={root:null,documentId:null,versions:new Map()};
const surfaceKey=id=>String(assetContext.root)+'|'+String(assetContext.documentId)+'|'+id;
export function configureAssets(root,documentId,assets=[]) {
	if(root!==assetContext.root||documentId!==assetContext.documentId){surfaceCache.clear();processCache.clear();}
	if(root!==assetContext.root)imageCache.clear();
	assetContext={root,documentId,versions:new Map(assets.map(asset=>[asset.name,String(asset.version||asset.mtime||'')+':'+asset.size]))};
}
export function assetUrl(src) {
	const name=String(typeof src==='object'?src?.src:src||'').split(/[\\/]/).pop();
	if(!assetContext.root)return null;
	return api('/designcraft/api/v1/asset?root='+encodeURIComponent(assetContext.root)+'&name='+encodeURIComponent(name)+'&v='+encodeURIComponent(assetContext.versions.get(name)||''));
}

function cacheSet(map, key, value, cap = 80) {
	const size=item=>(item?.canvas?.width||item?.naturalWidth||item?.width||0)*(item?.canvas?.height||item?.naturalHeight||item?.height||0)*4;
	const budget=map===surfaceCache?128*1024*1024:96*1024*1024;
	let bytes=[...map.entries()].reduce((sum,[k,v])=>sum+(k===key?0:size(v)),0)+size(value);
	for(const [k,old] of map){
		if(k===key)continue;
		if(bytes<=budget&&map.size<cap)break;
		if(map===surfaceCache&&(old.canvas.__rev||0)>(old.bakedRev||0))continue;
		bytes-=size(old);map.delete(k);
	}
	if(map===surfaceCache&&bytes>budget)throw new Error('像素编辑缓存已满，请先保存当前修改');
	map.set(key, value);
	if (map!==surfaceCache&&map.size > cap) {
		const first = map.keys().next().value;
		const old = map.get(first);
		if (old && old.canvas && old.canvas.width) { /* allow GC */ }
		map.delete(first);
	}
}

/* ---------------- document model ---------------- */

export function normalizeDoc(raw) {
	const doc = raw && typeof raw === 'object' ? raw : {};
	return {
		...doc,
		version: doc.version || 1,
		id: doc.id || ('doc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
		title: doc.title || '未命名',
		type: ['deck','photo','image','vector','canvas'].includes(doc.type)?doc.type:'canvas',
		canvas: { width: doc.canvas?.width || 1280, height: doc.canvas?.height || 720 },
		designSystem: doc.designSystem && typeof doc.designSystem === 'object' ? doc.designSystem : null,
		theme: doc.theme || null,
		assets: Array.isArray(doc.assets) ? doc.assets : [],
		pages: (Array.isArray(doc.pages) ? doc.pages : []).map(normalizePage)
	};
}

export function normalizePage(page) {
	const p = page && typeof page === 'object' ? page : {};
	return {
		...p,
		id: p.id || ('pg' + Math.random().toString(36).slice(2, 9)),
		name: p.name || '页面',
		layout: p.layout || 'custom',
		notes: p.notes || '',
		hidden: p.hidden === true,
		transition: p.transition && typeof p.transition === 'object' ? p.transition : { kind: 'none', duration: 0 },
		background: p.background || { kind: 'solid', color: '#FFFFFF' },
		layers: (Array.isArray(p.layers) ? p.layers : []).map(normalizeLayer).filter(Boolean)
	};
}

export function normalizeLayer(layer) {
	if (!layer || typeof layer !== 'object') return null;
	const base = {
		...layer,
		id: layer.id || ('ly' + Math.random().toString(36).slice(2, 9)),
		type: layer.type || 'shape',
		name: layer.name || layer.type || '图层',
		x: Number(layer.x) || 0,
		y: Number(layer.y) || 0,
		w: layer.w != null ? Number(layer.w) : (layer.width != null ? Number(layer.width) : 100),
		h: layer.h != null ? Number(layer.h) : (layer.height != null ? Number(layer.height) : 100),
		rotation: Number(layer.rotation) || 0,
		opacity: layer.opacity == null ? 1 : Math.max(0, Math.min(1, Number(layer.opacity))),
		blend: layer.blend || 'normal',
		hidden: layer.hidden === true || layer.visible === false,
		locked: layer.locked === true,
		style: layer.style && typeof layer.style === 'object' ? layer.style : null,
		mask: layer.mask && typeof layer.mask === 'object' ? layer.mask : null
	};
	switch (base.type) {
		case 'image':
			return { ...base, type: 'image', asset: layer.asset || null, adjust: layer.adjust || null, filters: Array.isArray(layer.filters) ? layer.filters : null, crop: layer.crop || null, transform: layer.transform || null };
		case 'text':
			return {
				...base, type: 'text',
				text: layer.text != null ? String(layer.text) : '',
				fontSize: Number(layer.fontSize) || 24,
				fontFamily: layer.fontFamily || 'Segoe UI, Microsoft YaHei, sans-serif',
				color: layer.color || '#202936',
				bold: layer.bold === true, italic: layer.italic === true,
				align: layer.align || 'left', vAlign: layer.vAlign || 'top',
				lineHeight: Number(layer.lineHeight) || 1.4,
				letterSpacing: Number(layer.letterSpacing) || 0,
				bullets: layer.bullets === true
			};
		case 'shape':
			return { ...base, type: 'shape', shape: layer.shape || 'rect', fill: layer.fill == null ? '#287D6C' : layer.fill, stroke: layer.stroke || null, radius: layer.radius != null ? Number(layer.radius) : 0.15, text: layer.text != null ? String(layer.text) : null, fontSize: Number(layer.fontSize) || 18, align: layer.align || 'center', vAlign: layer.vAlign || 'middle' };
		case 'vector':
			return { ...base, type: 'vector', geometryBox:layer.geometryBox||{x:base.x,y:base.y,w:base.w,h:base.h}, paths: (Array.isArray(layer.paths) ? layer.paths : []).map(p => ({ d: String(p?.d || ''), fill: p?.fill == null ? null : p.fill, stroke: p?.stroke || null, fillRule: p?.fillRule === 'evenodd' ? 'evenodd' : 'nonzero' })) };
		case 'table':
			return { ...base, type: 'table', rows: Array.isArray(layer.rows) ? layer.rows : [], header: layer.header !== false, fontSize: Number(layer.fontSize) || 16, rowHeight: Number(layer.rowHeight) || 40, headerFill: layer.headerFill || 'var(--color-primary)', stripeFill: layer.stripeFill || '#F5F6F8' };
		case 'chart':
			return { ...base, type: 'chart', chartKind: layer.chartKind || 'bar', data: layer.data && typeof layer.data === 'object' ? layer.data : { labels: [], series: [] }, colors: Array.isArray(layer.colors) ? layer.colors : ['#287D6C', '#8CCFBC', '#9E7129', '#B44846'], title: layer.title || null };
		case 'adjustment':
			return { ...base, type: 'adjustment', adjust: layer.adjust && typeof layer.adjust === 'object' ? layer.adjust : {} };
		case 'group':
			return { ...base, type: 'group', children: (Array.isArray(layer.children) ? layer.children : []).map(normalizeLayer).filter(Boolean), open: layer.open === true };
		case 'native':
			return {...base,type:'native',asset:layer.asset||null,native:layer.native||null,crop:layer.crop||null,transform:layer.transform||null};
		case 'instance':
			return { ...base, type: 'instance', template: layer.template || null, vars: layer.vars && typeof layer.vars === 'object' ? layer.vars : {} };
		default:
			return { ...base, type: 'shape', shape: 'rect', fill: '#888888' };
	}
}

/** Deep clone a layer (plain JSON). */
export function cloneLayer(layer) {
	return JSON.parse(JSON.stringify(layer));
}

export function flattenLayers(layers, out = []) {
	for (const layer of layers || []) {
		if (layer.type === 'group') flattenLayers(layer.children, out);
		else out.push(layer);
	}
	return out;
}

export function layerBounds(layer) {
	if (layer.type === 'group') {
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const child of flattenLayers(layer.children)) {
			const b = layerBounds(child);
			minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
			maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
		}
		if (!isFinite(minX)) return { x: layer.x, y: layer.y, w: 0, h: 0 };
		return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
	}
	return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
}

export function docBounds(doc) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const page of doc.pages) for (const layer of page.layers) {
		const b = layerBounds(layer);
		minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
		maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
	}
	if (!isFinite(minX)) return { x: 0, y: 0, w: doc.canvas.width, h: doc.canvas.height };
	return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Unique layer id. */
let uidSeed = 0;
export function genId(prefix = 'ly') {
	uidSeed += 1;
	return `${prefix}_${Date.now().toString(36)}${uidSeed.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

/* ---------------- colors & design system ---------------- */

const NAMED = { black: '#000000', white: '#FFFFFF', red: '#DC2626', green: '#16A34A', blue: '#2563EB', yellow: '#FACC15', orange: '#F97316', purple: '#9333EA', pink: '#EC4899', gray: '#808080', grey: '#808080', transparent: 'rgba(0,0,0,0)' };

export function resolveColor(value, designSystem) {
	if (typeof value !== 'string') return value || '#000000';
	let v = value.trim();
	const varRe = /^var\(--(?:color-)?([a-zA-Z0-9-]+)\)$/.exec(v);
	if (varRe && designSystem?.colors) {
		const key = varRe[1];
		const hit = designSystem.colors[key] ?? designSystem.colors['color-' + key];
		if (hit != null) v = String(hit);
	}
	if (NAMED[v.toLowerCase()]) return NAMED[v.toLowerCase()];
	return v;
}

export function withAlpha(color, alpha) {
	const c = String(color || '#000000');
	if (alpha >= 1) return c;
	const hex6 = /^#([0-9a-f]{6})$/i.exec(c);
	if (hex6) {
		const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0');
		return `#${hex6[1]}${a}`;
	}
	const rgb = /^rgba?\(([^)]+)\)$/i.exec(c);
	if (rgb) {
		const parts = rgb[1].split(/[\s,]+/).filter(Boolean);
		return `rgba(${parts[0]},${parts[1]},${parts[2]},${Math.max(0, Math.min(1, alpha))})`;
	}
	return c;
}

/* ---------------- asset/paint surfaces ---------------- */

/** Load an image element for an asset path (cached). */
export function loadImage(src){
  if(!src)return Promise.resolve(null);if(!/\.(png|jpe?g)$/i.test(typeof src==='string'?src:src.src||''))return Promise.reject(new Error('此源格式需通过原生导入生成安全预览，原始文件未被更改'));const key=assetUrl(src);if(!key)return Promise.resolve(null);
  if(imageCache.has(key))return Promise.resolve(imageCache.get(key));if(imageFlights.has(key))return imageFlights.get(key);
  const loading=decodeSerial(()=>new Promise(resolve=>{
    const img=new Image(),timer=setTimeout(()=>{img.src='';resolve(null);},15000);
    img.onload=()=>{clearTimeout(timer);if(img.naturalWidth*img.naturalHeight>24_000_000){img.src='';resolve(null);return;}cacheSet(imageCache,key,img,32);resolve(img);};
    img.onerror=()=>{clearTimeout(timer);resolve(null);};img.src=key;
  })).finally(()=>imageFlights.delete(key));imageFlights.set(key,loading);return loading;
}

export function api(path) {
	const u = new URL(String(path).replace(/^\/+/, ''), document.baseURI);
	return u.pathname + u.search;
}

/**
 * Get (or lazily create) the paint surface for an image layer — the editable
 * bitmap behind the layer. Paint tools draw here; rendering prefers it.
 */
export async function getPaintSurface(layer, doc) {
	const id=surfaceKey(layer.id);
	const src = typeof layer.asset === 'string' ? layer.asset : layer.asset?.src;
	if (!src) return null;
	const img = await loadImage(src);
	if (!img) return null;
	if(id!==surfaceKey(layer.id))throw new Error('图片加载期间作品已切换');
	if(img.naturalWidth*img.naturalHeight>24_000_000)throw new Error('图片超过 2400 万像素编辑限制');
	const key = src + '|' + img.naturalWidth + 'x' + img.naturalHeight;
	const existing = surfaceCache.get(id);
	if (existing && existing.assetKey === key) return existing.canvas;
	const canvas = document.createElement('canvas');
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	canvas.getContext('2d').drawImage(img, 0, 0);
	cacheSet(surfaceCache, id, { canvas, assetKey: key, layerId:layer.id }, 40);
	return canvas;
}

export function dropPaintSurface(layerId) {
	surfaceCache.delete(surfaceKey(layerId));
}

/** Peek a paint surface entry (used by the bake pipeline). */
export function surfacePeek(layerId) {
	return surfaceCache.get(surfaceKey(layerId)) || null;
}

export function dirtyPaintSurfaces() {
	return [...surfaceCache.keys()];
}

// History keeps only uncommitted pixels; committed images are immutable asset references.
export function capturePaintState() {
  return [...surfaceCache.entries()].filter(([,entry])=>(entry.canvas.__rev||0)>(entry.bakedRev||0)).map(([key,entry])=>{
    const canvas=document.createElement('canvas');canvas.width=entry.canvas.width;canvas.height=entry.canvas.height;
    canvas.getContext('2d').drawImage(entry.canvas,0,0);canvas.__rev=entry.canvas.__rev;
    return {key,assetKey:entry.assetKey,layerId:entry.layerId,canvas};
  });
}
export function restorePaintState(entries=[]) {
  surfaceCache.clear();processCache.clear();
  for(const entry of entries){
    const canvas=document.createElement('canvas');canvas.width=entry.canvas.width;canvas.height=entry.canvas.height;
    canvas.getContext('2d').drawImage(entry.canvas,0,0);canvas.__rev=entry.canvas.__rev||1;
    cacheSet(surfaceCache,entry.key,{canvas,assetKey:entry.assetKey,layerId:entry.layerId},40);
  }
}
export async function captureDraftPixels() {
  const snapshots=capturePaintState(),result=[];
  for(const entry of snapshots){const blob=await new Promise(resolve=>entry.canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('无法保存像素恢复草稿');result.push({layerId:entry.layerId,blob});}
  return result;
}

/* ---------------- per-layer processed bitmap (adjust/filters/mask) ---------------- */

function processedImageCanvas(layer,doc,srcOverride){return processSerial(()=>processedImageCanvasNow(layer,doc,srcOverride));}
async function processedImageCanvasNow(layer, doc, srcOverride) {
	const scopedId=surfaceKey(layer.id);
	const src = srcOverride || (typeof layer.asset === 'string' ? layer.asset : layer.asset?.src);
	if (!src) throw new Error('图片源缺失，请重新关联素材：'+(layer.name||layer.id));
	const img = await loadImage(src);
	if (!img) throw new Error('图片加载失败，请检查素材是否存在或超出预览限制：'+src);
	const entry=surfaceCache.get(scopedId);
	const expected=src+'|'+img.naturalWidth+'x'+img.naturalHeight;
	const paintSurface = entry?.assetKey===expected?entry.canvas:null;
	const hasPaint = !!paintSurface;
	const adjustKey = layer.adjust && Object.keys(layer.adjust).length ? JSON.stringify(layer.adjust) : '';
	const filterKey = layer.filters && layer.filters.length ? JSON.stringify(layer.filters) : '';
	const maskKey = layer.mask?.kind === 'luminance' ? (typeof layer.mask.asset === 'string' ? layer.mask.asset : layer.mask.asset?.src || '') : '';
	if (layer.mask?.kind === 'luminance' && !maskKey) throw new Error('蒙版源缺失，请重新关联素材：'+(layer.name||layer.id));
	const flipKey = layer.transform ? JSON.stringify(layer.transform) : '';
	const key = [scopedId,assetUrl(src),img.naturalWidth,adjustKey,filterKey,maskKey,flipKey,hasPaint?'p'+(paintSurface.__rev||0):''].join('|');
	if (processCache.has(key)) return processCache.get(key);

	const canvas = document.createElement('canvas');
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	const ctx = canvas.getContext('2d');
	ctx.drawImage(paintSurface || img, 0, 0);

	if (adjustKey || filterKey) {
		const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
		applyAdjustClient(data.data, layer.adjust || {});
		for (const f of layer.filters || []) applyFilterClient(data, canvas.width, canvas.height, f);
		ctx.putImageData(data, 0, 0);
	}
	if (layer.transform?.flipH || layer.transform?.flipV) {
		const flipped = document.createElement('canvas');
		flipped.width = canvas.width; flipped.height = canvas.height;
		const fctx = flipped.getContext('2d');
		fctx.translate(layer.transform.flipH ? canvas.width : 0, layer.transform.flipV ? canvas.height : 0);
		fctx.scale(layer.transform.flipH ? -1 : 1, layer.transform.flipV ? -1 : 1);
		fctx.drawImage(canvas, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.drawImage(flipped, 0, 0);
	}
	if (maskKey) {
		const maskImg = await loadImage(maskKey);
		if (!maskImg) throw new Error('蒙版加载失败，请检查素材是否存在或超出预览限制：'+maskKey);
		if (maskImg) {
			const masked = document.createElement('canvas');
			masked.width = canvas.width; masked.height = canvas.height;
			const mctx = masked.getContext('2d');
			mctx.drawImage(canvas, 0, 0);
			const maskCanvas=document.createElement('canvas');maskCanvas.width=canvas.width;maskCanvas.height=canvas.height;
			const maskCtx=maskCanvas.getContext('2d');maskCtx.drawImage(maskImg,0,0,canvas.width,canvas.height);
			const pixels=maskCtx.getImageData(0,0,canvas.width,canvas.height);
			for(let i=0;i<pixels.data.length;i+=4){const alpha=pixels.data[i+3]/255;pixels.data[i+3]=Math.round((.2126*pixels.data[i]+.7152*pixels.data[i+1]+.0722*pixels.data[i+2])*alpha);}
			maskCtx.putImageData(pixels,0,0);
			mctx.globalCompositeOperation = 'destination-in';
			mctx.drawImage(maskCanvas,0,0);
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(masked, 0, 0);
		}
	}
	cacheSet(processCache, key, canvas, 60);
	return canvas;
}

/** Intrinsic image pixels after live corrections; used for a faithful embedded picture in PPTX. */
export async function exportImagePixels(layer,doc){
  const canvas=await processedImageCanvas(layer,doc);if(!canvas)throw new Error('图片源尚未加载');
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片编码失败');return blob;
}

export function invalidateLayerCache(layerId) {
	for (const key of [...processCache.keys()]) if (key.startsWith(surfaceKey(layerId) + '|')) processCache.delete(key);
}

/* ---------------- client pixel ops (PhotoCraft) ---------------- */

const clamp255 = (v) => v < 0 ? 0 : v > 255 ? 255 : v;

function buildLut(params) {
	const lut = new Uint8ClampedArray(256);
	const brightness = Number(params.brightness) || 0;
	const contrast = Number(params.contrast) || 0;
	const exposure = Number(params.exposure) || 0;
	const invert = params.invert === true;
	for (let i = 0; i < 256; i++) {
		let v = i / 255;
		v *= Math.pow(2, exposure);
		v += brightness;
		v = (v - 0.5) * (1 + contrast) + 0.5;
		if (invert) v = 1 - v;
		lut[i] = clamp255(Math.round(Math.max(0, Math.min(1, v)) * 255));
	}
	return lut;
}

const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** In-place RGBA adjust — mirrors host raster.applyAdjust semantics. */
export function applyAdjustClient(data, params = {}) {
	const lut = buildLut(params);
	const sat = params.saturation == null ? 1 : 1 + Number(params.saturation);
	const hue = Number(params.hue) || 0;
	const a = (hue * Math.PI) / 180;
	const c = Math.cos(a), s = Math.sin(a);
	const m = hue ? [
		0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
		0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
		0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072
	] : null;
	const temperature = Number(params.temperature) || 0;
	const tint = Number(params.tint) || 0;
	const highlights = Number(params.highlights) || 0;
	const shadows = Number(params.shadows) || 0;
	const grayscale = params.grayscale === true;
	const sepia = params.sepia === true;
	const threshold = params.threshold == null ? null : clamp255(Math.round((Number(params.threshold) || 0.5) * 255));
	const tr = temperature * 60, tg = tint * 30, tb = -temperature * 60;
	for (let i = 0; i < data.length; i += 4) {
		let r = lut[data[i]], g = lut[data[i + 1]], b = lut[data[i + 2]];
		if (tr || tg || tb) { r += tr; g += tg; b += tb; }
		if (m) {
			const nr = m[0] * r + m[1] * g + m[2] * b;
			const ng = m[3] * r + m[4] * g + m[5] * b;
			const nb = m[6] * r + m[7] * g + m[8] * b;
			r = nr; g = ng; b = nb;
		}
		if (sat !== 1) {
			const l = lumOf(r, g, b);
			r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
		}
		if (highlights || shadows) {
			const l = lumOf(r, g, b) / 255;
			const lift = shadows * (l < 0.5 ? (0.5 - l) * 2 : 0) * 160 - highlights * (l > 0.5 ? (l - 0.5) * 2 : 0) * 160;
			r += lift; g += lift; b += lift;
		}
		if (grayscale) { const l = lumOf(r, g, b); r = g = b = l; }
		else if (sepia) {
			const nr = 0.393 * r + 0.769 * g + 0.189 * b;
			const ng = 0.349 * r + 0.686 * g + 0.168 * b;
			const nb = 0.272 * r + 0.534 * g + 0.131 * b;
			r = nr; g = ng; b = nb;
		}
		if (threshold !== null) { const l = lumOf(r, g, b) >= threshold ? 255 : 0; r = g = b = l; }
		data[i] = clamp255(r); data[i + 1] = clamp255(g); data[i + 2] = clamp255(b);
	}
}

/** Client filters on ImageData. */
export function applyFilterClient(imageData, w, h, filter = {}) {
	const kind = String(filter.kind || '').toLowerCase();
	const amount = Number(filter.amount ?? filter.radius ?? 4);
	const data = imageData.data;
	if (kind === 'blur') boxBlurData(data, w, h, Math.max(1, amount | 0));
	else if (kind === 'sharpen') {
		const src = new Uint8ClampedArray(data);
		const k = Math.min(2, Math.max(0, amount / 10));
		for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
			const i = (y * w + x) * 4;
			for (let ch = 0; ch < 3; ch++) {
				const center = src[i + ch];
				const around = src[i - 4 + ch] + src[i + 4 + ch] + src[i - w * 4 + ch] + src[i + w * 4 + ch];
				data[i + ch] = clamp255(center + (center * 4 - around) * 0.25 * k);
			}
		}
	} else if (kind === 'pixelate') {
		const b = Math.max(2, amount | 0);
		for (let by = 0; by < h; by += b) for (let bx = 0; bx < w; bx += b) {
			let r = 0, g = 0, bl = 0, al = 0, n = 0;
			for (let y = by; y < Math.min(by + b, h); y++) for (let x = bx; x < Math.min(bx + b, w); x++) {
				const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; bl += data[i + 2]; al += data[i + 3]; n++;
			}
			r /= n; g /= n; bl /= n; al /= n;
			for (let y = by; y < Math.min(by + b, h); y++) for (let x = bx; x < Math.min(bx + b, w); x++) {
				const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = bl; data[i + 3] = al;
			}
		}
	} else if (kind === 'noise') {
		const k = Math.min(1, amount / 100) * 255;
		for (let i = 0; i < data.length; i += 4) {
			const d = (Math.random() - 0.5) * k;
			data[i] = clamp255(data[i] + d); data[i + 1] = clamp255(data[i + 1] + d); data[i + 2] = clamp255(data[i + 2] + d);
		}
	} else if (kind === 'vignette') {
		const strength = Math.min(1, amount / 100);
		const cx = w / 2, cy = h / 2, maxD = Math.sqrt(cx * cx + cy * cy);
		for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxD;
			const f = 1 - strength * Math.max(0, d - 0.4) / 0.6;
			data[i] *= f; data[i + 1] *= f; data[i + 2] *= f;
		}
	}
}

function boxBlurData(data, w, h, radius) {
	const tmp = new Uint8ClampedArray(data.length);
	for (let pass = 0; pass < 3; pass++) {
		blurAxis(data, tmp, w, h, radius, true);
		blurAxis(tmp, data, w, h, radius, false);
	}
}

function blurAxis(src, dst, w, h, r, horizontal) {
	const win = r * 2 + 1;
	const length = horizontal ? w : h;
	const other = horizontal ? h : w;
	const get = (i) => horizontal ? ((arguments.length, Math.min(length - 1, Math.max(0, i)))) : Math.min(length - 1, Math.max(0, i));
	for (let o = 0; o < other; o++) {
		let sr = 0, sg = 0, sb = 0, sa = 0;
		const idxOf = (i) => {
			const clamped = Math.min(length - 1, Math.max(0, i));
			return horizontal ? (o * w + clamped) * 4 : (clamped * w + o) * 4;
		};
		for (let i = -r; i <= r; i++) { const idx = idxOf(i); sr += src[idx]; sg += src[idx + 1]; sb += src[idx + 2]; sa += src[idx + 3]; }
		for (let i = 0; i < length; i++) {
			const di = horizontal ? (o * w + i) * 4 : (i * w + o) * 4;
			dst[di] = sr / win; dst[di + 1] = sg / win; dst[di + 2] = sb / win; dst[di + 3] = sa / win;
			const outIdx = idxOf(i - r), inIdx = idxOf(i + r + 1);
			sr += src[inIdx] - src[outIdx]; sg += src[inIdx + 1] - src[outIdx + 1];
			sb += src[inIdx + 2] - src[outIdx + 2]; sa += src[inIdx + 3] - src[outIdx + 3];
		}
	}
}

/** Magic wand: flood-fill selection mask. Returns {mask: Uint8Array(w*h), bounds} in image pixel space. */
export function magicWandMask(imageData, w, h, sx, sy, tolerance = 32) {
	const data = imageData.data;
	const target = (sy * w + sx) * 4;
	const tr = data[target], tg = data[target + 1], tb = data[target + 2], ta = data[target + 3];
	const mask = new Uint8Array(w * h);
	const tol2 = tolerance * tolerance * 3;
	const stack = [sy * w + sx];
	const visited = new Uint8Array(w * h);
	let minX = w, minY = h, maxX = 0, maxY = 0;
	while (stack.length) {
		const p = stack.pop();
		if (visited[p]) continue;
		visited[p] = 1;
		const i = p * 4;
		const d = (data[i] - tr) ** 2 + (data[i + 1] - tg) ** 2 + (data[i + 2] - tb) ** 2 + (data[i + 3] - ta) ** 2;
		if (d > tol2) continue;
		mask[p] = 1;
		const x = p % w, y = (p / w) | 0;
		if (x < minX) minX = x; if (x > maxX) maxX = x;
		if (y < minY) minY = y; if (y > maxY) maxY = y;
		if (x > 0) stack.push(p - 1);
		if (x < w - 1) stack.push(p + 1);
		if (y > 0) stack.push(p - w);
		if (y < h - 1) stack.push(p + w);
	}
	return { mask, bounds: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/* ---------------- layer painting ---------------- */

function setShadow(ctx, style) {
	if (!style?.shadow || style.shadow === 'none') return;
	const sh = typeof style.shadow === 'string' ? { color: style.shadow, blur: 12, distance: 4, angle: 90 } : style.shadow;
	ctx.shadowColor = withAlpha(sh.color || 'rgba(0,0,0,0.35)', sh.opacity ?? 1);
	ctx.shadowBlur = sh.blur ?? 12;
	ctx.shadowOffsetX = Math.cos(((sh.angle ?? 90) * Math.PI) / 180) * (sh.distance ?? 4);
	ctx.shadowOffsetY = Math.sin(((sh.angle ?? 90) * Math.PI) / 180) * (sh.distance ?? 4);
}

function clearShadow(ctx) {
	ctx.shadowColor = 'transparent';
	ctx.shadowBlur = 0;
	ctx.shadowOffsetX = 0;
	ctx.shadowOffsetY = 0;
}

function makeGradient(ctx, paint, x, y, w, h, designSystem) {
	if (!paint || typeof paint === 'string') return null;
	if (paint.kind === 'linear') {
		const angle = ((Number(paint.angle) || 0) * Math.PI) / 180;
		const cx = x + w / 2, cy = y + h / 2;
		const len = (Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle))) / 2 || 1;
		const g = ctx.createLinearGradient(cx - Math.cos(angle) * len, cy - Math.sin(angle) * len, cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
		for (const [off, col] of (paint.stops || [[0, '#888888'], [1, '#222222']])) g.addColorStop(Math.max(0, Math.min(1, Number(off) || 0)), resolveColor(col, designSystem));
		return g;
	}
	if (paint.kind === 'radial') {
		const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) / 2);
		for (const [off, col] of (paint.stops || [[0, '#888888'], [1, '#222222']])) g.addColorStop(Math.max(0, Math.min(1, Number(off) || 0)), resolveColor(col, designSystem));
		return g;
	}
	return null;
}

export function paintToStyle(ctx, paint, x, y, w, h, designSystem, opacity = 1) {
	if (paint == null || paint === 'none') return null;
	if (typeof paint === 'string') return withAlpha(resolveColor(paint, designSystem), opacity);
	if (paint.kind === 'solid') return withAlpha(resolveColor(paint.color, designSystem), (paint.opacity ?? 1) * opacity);
	const g = makeGradient(ctx, paint, x, y, w, h, designSystem);
	return g || withAlpha('#888888', opacity);
}

export function shapePath(ctx, layer, x, y, w, h) {
	const kind = String(layer.shape || 'rect').toLowerCase();
	ctx.beginPath();
	if (kind === 'ellipse' || kind === 'circle') {
		ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.1, w / 2), Math.max(0.1, h / 2), 0, 0, Math.PI * 2);
	} else if (kind === 'roundrect' || kind === 'roundedrectangle') {
		const r = Math.min(w, h) * (layer.radius ?? 0.15);
		roundRectPath(ctx, x, y, w, h, r);
	} else if (kind === 'triangle') {
		ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath();
	} else if (kind === 'diamond') {
		ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w / 2, y + h); ctx.lineTo(x, y + h / 2); ctx.closePath();
	} else if (kind === 'pentagon' || kind === 'hexagon' || kind === 'star5' || kind === 'star4' || kind === 'star6' || kind === 'star8') {
		const points = kind === 'pentagon' ? 5 : kind === 'hexagon' ? 6 : kind === 'star4' ? 4 : kind === 'star6' ? 6 : kind === 'star8' ? 8 : 5;
		const star = kind.startsWith('star');
		const inner = star ? 0.42 : 0.55;
		const rot = kind === 'hexagon' ? Math.PI / 6 : -Math.PI / 2;
		for (let i = 0; i < (star ? points * 2 : points); i++) {
			const radius = star ? (i % 2 === 0 ? 0.5 : 0.5 * inner) : 0.5;
			const a = rot + (Math.PI * 2 * i) / (star ? points * 2 : points);
			const px = x + w / 2 + Math.cos(a) * w * radius;
			const py = y + h / 2 + Math.sin(a) * h * radius;
			if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
		}
		ctx.closePath();
	} else if (kind === 'arrowright' || kind === 'arrow' || kind === 'arrowleft' || kind === 'arrowup' || kind === 'arrowdown') {
		const head = Math.min(w, h) * 0.45;
		if (kind === 'arrowleft') {
			ctx.moveTo(x, y + h / 2); ctx.lineTo(x + head, y); ctx.lineTo(x + head, y + h * 0.3); ctx.lineTo(x + w, y + h * 0.3);
			ctx.lineTo(x + w, y + h * 0.7); ctx.lineTo(x + head, y + h * 0.7); ctx.lineTo(x + head, y + h); ctx.closePath();
		} else if (kind === 'arrowup') {
			ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + head); ctx.lineTo(x + w * 0.7, y + head); ctx.lineTo(x + w * 0.7, y + h);
			ctx.lineTo(x + w * 0.3, y + h); ctx.lineTo(x + w * 0.3, y + head); ctx.lineTo(x, y + head); ctx.closePath();
		} else if (kind === 'arrowdown') {
			ctx.moveTo(x + w / 2, y + h); ctx.lineTo(x, y + h - head); ctx.lineTo(x + w * 0.3, y + h - head); ctx.lineTo(x + w * 0.3, y);
			ctx.lineTo(x + w * 0.7, y); ctx.lineTo(x + w * 0.7, y + h - head); ctx.lineTo(x + w, y + h - head); ctx.closePath();
		} else {
			ctx.moveTo(x, y); ctx.lineTo(x + w - head, y); ctx.lineTo(x + w - head, y + h * 0.3); ctx.lineTo(x + w, y + h / 2);
			ctx.lineTo(x + w - head, y + h * 0.7); ctx.lineTo(x + w - head, y + h); ctx.lineTo(x, y + h); ctx.closePath();
		}
	} else if (kind === 'plus') {
		const t = 0.32;
		ctx.moveTo(x + w * (0.5 - t / 2), y); ctx.lineTo(x + w * (0.5 + t / 2), y); ctx.lineTo(x + w * (0.5 + t / 2), y + h * (0.5 - t / 2));
		ctx.lineTo(x + w, y + h * (0.5 - t / 2)); ctx.lineTo(x + w, y + h * (0.5 + t / 2)); ctx.lineTo(x + w * (0.5 + t / 2), y + h);
		ctx.lineTo(x + w * (0.5 + t / 2), y + h); ctx.lineTo(x + w * (0.5 - t / 2), y + h); ctx.lineTo(x + w * (0.5 - t / 2), y + h * (0.5 + t / 2));
		ctx.lineTo(x, y + h * (0.5 + t / 2)); ctx.lineTo(x, y + h * (0.5 - t / 2)); ctx.lineTo(x + w * (0.5 - t / 2), y + h * (0.5 - t / 2));
		ctx.closePath();
	} else if (kind === 'line') {
		ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
	} else if (kind === 'chevron') {
		ctx.moveTo(x, y); ctx.lineTo(x + w * 0.6, y); ctx.lineTo(x + w, y + h / 2); ctx.lineTo(x + w * 0.6, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x + w * 0.4, y + h / 2); ctx.closePath();
	} else {
		ctx.rect(x, y, w, h);
	}
}

function roundRectPath(ctx, x, y, w, h, r) {
	const rr = Math.max(0, Math.min(r, w / 2, h / 2));
	ctx.moveTo(x + rr, y);
	ctx.arcTo(x + w, y, x + w, y + h, rr);
	ctx.arcTo(x + w, y + h, x, y + h, rr);
	ctx.arcTo(x, y + h, x, y, rr);
	ctx.arcTo(x, y, x + w, y, rr);
	ctx.closePath();
}

/** Wrap text into lines by width; CJK-aware. */
function wrapLines(ctx, text, maxWidth) {
	const out = [];
	for (const rawLine of String(text).split(/\r?\n/)) {
		if (!rawLine.length) { out.push(''); continue; }
		let line = '';
		let current = '';
		const chars = [...rawLine];
		for (const ch of chars) {
			const test = current + ch;
			if (ctx.measureText(test).width > maxWidth && current.length) {
				out.push(line + current);
				line = '';
				current = ch === ' ' ? '' : ch;
			} else {
				current = test;
			}
			// flush trailing spaces at wrap points
			if (current.endsWith(' ') && current.trim().length === 0) current = '';
			line = '';
			line = out.length >= 0 ? line : line;
		}
		out.push(current);
	}
	return out;
}

export function drawTextLayer(ctx, layer, designSystem, forExport = false) {
	const size = layer.fontSize;
	const family = resolveFontFamily(layer.fontFamily, designSystem);
	ctx.font = `${layer.italic ? 'italic ' : ''}${layer.bold ? '600 ' : ''}${size}px ${family}`;
	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = resolveColor(layer.color, designSystem);
	const lines = wrapLines(ctx, layer.text, layer.w || 10000);
	const lineHeight = size * (layer.lineHeight || 1.4);
	const spacing = layer.letterSpacing || 0;
	const bullets = layer.bullets === true;
	const totalH = lines.length * lineHeight;
	let startY = layer.y + size;
	if (layer.vAlign === 'middle') startY = layer.y + Math.max(size, ((layer.h || totalH) - totalH) / 2) + size * 0.85;
	else if (layer.vAlign === 'bottom') startY = layer.y + (layer.h || totalH) - totalH + size;
	const bulletIndent = bullets ? size * 0.9 : 0;
	lines.forEach((line, i) => {
		const y = startY + i * lineHeight;
		let x = layer.x;
		if (layer.align === 'center') x = layer.x + ((layer.w || 0) - Math.min(ctx.measureText(line).width + (bullets ? bulletIndent : 0), layer.w || Infinity)) / 2;
		else if (layer.align === 'right') x = layer.x + (layer.w || 0) - ctx.measureText(line).width - (bullets ? bulletIndent : 0);
		if (bullets && line.trim()) {
			ctx.fillText('•', x, y);
			x += bulletIndent;
		}
		if (spacing) {
			let cx = x;
			for (const ch of line) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
		} else {
			ctx.fillText(line, x, y);
		}
	});
}

function resolveFontFamily(family, designSystem) {
	if (!family) return 'Segoe UI, Microsoft YaHei, sans-serif';
	const m = /^var\(--font-([a-z]+)\)$/.exec(family.trim());
	if (m && designSystem?.fonts?.[m[1]]) return designSystem.fonts[m[1]];
	return family;
}

export function drawShapeLayer(ctx, layer, designSystem) {
	const { x, y, w, h } = layer;
	setShadow(ctx, layer.style);
	const fill = paintToStyle(ctx, layer.fill, x, y, w, h, designSystem, 1);
	const stroke = layer.stroke && layer.stroke !== 'none'
		? paintToStyle(ctx, typeof layer.stroke === 'string' ? layer.stroke : layer.stroke.color, x, y, w, h, designSystem, 1)
		: null;
	shapePath(ctx, layer, x, y, w, h);
	if (fill) { ctx.fillStyle = fill; ctx.fill(); }
	clearShadow(ctx);
	if (stroke) {
		ctx.strokeStyle = stroke;
		ctx.lineWidth = (typeof layer.stroke === 'object' ? (layer.stroke.width ?? 2) : 2);
		if (typeof layer.stroke === 'object' && layer.stroke.dash?.length) ctx.setLineDash(layer.stroke.dash);
		ctx.stroke();
		ctx.setLineDash([]);
	}
	if (layer.text) {
		ctx.fillStyle = withAlpha(resolveColor(layer.color || '#202936', designSystem),1);
		ctx.font = `${layer.fontSize}px ${resolveFontFamily(null, designSystem)}`;
		const lines = wrapLines(ctx, layer.text, w * 0.9);
		const lh = layer.fontSize * 1.35;
		const startY = layer.vAlign === 'middle' ? y + h / 2 - (lines.length - 1) * lh / 2 : y + h * 0.5 - (lines.length - 1) * lh / 2;
		ctx.textAlign = layer.align === 'left' ? 'left' : layer.align === 'right' ? 'right' : 'center';
		const tx = layer.align === 'left' ? x + 8 : layer.align === 'right' ? x + w - 8 : x + w / 2;
		lines.forEach((line, i) => ctx.fillText(line, tx, startY + i * lh));
		ctx.textAlign = 'left';
	}
}

function drawVectorLayer(ctx, layer, designSystem) {
	ctx.save();ctx.transform(...vectorMatrix(layer));
	for (const path of layer.paths || []) {
		if (!path.d) continue;
		let p2d;
		try { p2d = new Path2D(path.d); } catch { continue; }
		const fill = paintToStyle(ctx,path.fill,(layer.geometryBox||layer).x,(layer.geometryBox||layer).y,(layer.geometryBox||layer).w,(layer.geometryBox||layer).h,designSystem,1);
		if (fill) { ctx.fillStyle = fill; ctx.fill(p2d, path.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); }
		if(path.stroke&&path.stroke.width!==0){
			ctx.strokeStyle = paintToStyle(ctx, path.stroke.color ?? path.stroke, layer.x, layer.y, layer.w, layer.h, designSystem, 1);
			ctx.lineWidth = path.stroke.width ?? 1;
			if (path.stroke.dash?.length) ctx.setLineDash(path.stroke.dash);
			ctx.stroke(p2d);
			ctx.setLineDash([]);
		}
	}
	ctx.restore();
}

export function drawTableLayer(ctx, layer, designSystem) {
	const rows = layer.rows || [];
	if (!rows.length) return;
	const cols = Math.max(...rows.map(r => (r || []).length), 1);
	const colW = layer.w / cols;
	const rowH = layer.rowHeight || 40;
	ctx.font = `${layer.fontSize}px ${resolveFontFamily(null, designSystem)}`;
	rows.forEach((row, ri) => {
		const y = layer.y + ri * rowH;
		const header = ri === 0 && layer.header !== false;
		ctx.fillStyle = header ? withAlpha(resolveColor(layer.headerFill || '#287D6C', designSystem), 1) : (ri % 2 ? withAlpha(resolveColor(layer.stripeFill || '#F5F6F8', designSystem), 1) : '#FFFFFF');
		ctx.fillRect(layer.x, y, layer.w, rowH);
		ctx.strokeStyle = withAlpha('#DEE3E9', 1);
		ctx.lineWidth = 1;
		ctx.strokeRect(layer.x + 0.5, y + 0.5, layer.w - 1, rowH - 1);
		for (let ci = 0; ci < cols; ci++) {
			const cell = row?.[ci];
			const text = cell == null ? '' : (typeof cell === 'object' ? String(cell.text ?? '') : String(cell));
			ctx.fillStyle = header ? '#FFFFFF' : withAlpha(resolveColor('#202936', designSystem), 1);
			ctx.textAlign = header ? 'center' : 'left';
			const maxW = colW - 16;
			const lines = wrapLines(ctx, text, maxW).slice(0, 2);
			lines.forEach((line, li) => ctx.fillText(line, header ? layer.x + ci * colW + colW / 2 : layer.x + ci * colW + 8, y + rowH / 2 + layer.fontSize * 0.35 + li * layer.fontSize * 1.2));
			ctx.textAlign = 'left';
			if (ci > 0) {
				ctx.beginPath(); ctx.moveTo(layer.x + ci * colW + 0.5, y); ctx.lineTo(layer.x + ci * colW + 0.5, y + rowH); ctx.stroke();
			}
		}
	});
}

export function drawChartLayer(ctx, layer, designSystem) {
	const kind = String(layer.chartKind || 'bar');
	const data = layer.data || {};
	const labels = data.labels || [];
	const series = data.series || [{ name: '系列 1', values: data.values || [] }];
	const colors = (layer.colors || ['#287D6C']).map(c => resolveColor(c, designSystem));
	const { x, y, w, h } = layer;
	const titleH = layer.title ? 34 : 0;
	if (layer.title) {
		ctx.fillStyle = withAlpha(resolveColor('#202936', designSystem), 1);
		ctx.font = `600 18px ${resolveFontFamily(null, designSystem)}`;
		ctx.fillText(layer.title, x, y + 22);
	}
	const legendRight = kind === 'pie' || kind === 'donut';
	const plotW = legendRight ? w * 0.62 : w * 0.94;
	const plotH = h * 0.66;
	const px = x + (legendRight ? w * 0.04 : w * 0.03);
	const py = y + titleH + h * 0.14;
	ctx.font = `12px ${resolveFontFamily(null, designSystem)}`;
	if (kind === 'bar') {
		const maxV = Math.max(1, ...series.flatMap(s => (s.values || []).map(Number)));
		const groupW = plotW / Math.max(1, labels.length);
		const barW = groupW * 0.7 / series.length;
		// grid
		ctx.strokeStyle = 'rgba(116,128,140,0.25)';
		for (let i = 0; i <= 4; i++) {
			const gy = py + plotH - (plotH * i) / 4;
			ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px + plotW, gy); ctx.stroke();
		}
		series.forEach((s, si) => {
			(s.values || []).forEach((v, vi) => {
				const vh = (Number(v) / maxV) * plotH;
				ctx.fillStyle = colors[si % colors.length];
				ctx.fillRect(px + vi * groupW + si * barW + groupW * 0.15, py + plotH - vh, Math.max(2, barW * 0.92), vh);
			});
		});
		ctx.fillStyle = withAlpha('#74808C', 1);
		labels.forEach((label, vi) => ctx.fillText(String(label), px + vi * groupW + groupW / 2 - 10, py + plotH + 16));
	} else if (kind === 'line' || kind === 'area') {
		const maxV = Math.max(1, ...series.flatMap(s => (s.values || []).map(Number)));
		const n = Math.max(1, labels.length - 1);
		series.forEach((s, si) => {
			const vals = (s.values || []).map(Number);
			const pts = vals.map((v, i) => [px + (i / n) * plotW, py + plotH - (v / maxV) * plotH]);
			ctx.beginPath();
			pts.forEach(([ax, ay], i) => (i ? ctx.lineTo(ax, ay) : ctx.moveTo(ax, ay)));
			if (kind === 'area') {
				ctx.lineTo(px + plotW, py + plotH); ctx.lineTo(px, py + plotH); ctx.closePath();
				ctx.fillStyle = withAlpha(colors[si % colors.length], 0.25);
				ctx.fill();
			} else {
				ctx.strokeStyle = colors[si % colors.length];
				ctx.lineWidth = 2.5;
				ctx.stroke();
			}
			if (kind === 'line') for (const [ax, ay] of pts) {
				ctx.fillStyle = colors[si % colors.length];
				ctx.beginPath(); ctx.arc(ax, ay, 3.5, 0, Math.PI * 2); ctx.fill();
			}
		});
		ctx.fillStyle = withAlpha('#74808C', 1);
		labels.forEach((label, vi) => ctx.fillText(String(label), px + (vi / Math.max(1, labels.length - 1)) * plotW - 10, py + plotH + 16));
	} else if (kind === 'pie' || kind === 'donut') {
		const total = Math.max(1e-9, series[0].values.map(Number).reduce((a, b) => a + b, 0));
		const r = Math.min(plotW, plotH) / 2;
		const cx = px + plotW / 2, cy = py + plotH / 2;
		let angle = -Math.PI / 2;
		series[0].values.forEach((v, vi) => {
			const sweep = (Number(v) / total) * Math.PI * 2;
			ctx.beginPath();
			ctx.moveTo(cx, cy);
			ctx.arc(cx, cy, r, angle, angle + sweep);
			ctx.closePath();
			ctx.fillStyle = colors[vi % colors.length];
			ctx.fill();
			angle += sweep;
		});
		if (kind === 'donut') {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2); ctx.fill();
			ctx.globalCompositeOperation = 'source-over';
		}
	}
	// legend
	const legendX = x + (legendRight ? w * 0.7 : w * 0.06);
	const legendY = y + titleH + (legendRight ? h * 0.22 : h * 0.02);
	series.forEach((s, si) => {
		ctx.fillStyle = colors[si % colors.length];
		ctx.fillRect(legendX, legendY + si * 22, 12, 12);
		ctx.fillStyle = withAlpha(resolveColor('#202936', designSystem), 1);
		ctx.fillText(String(s.name || '系列 ' + (si + 1)), legendX + 18, legendY + si * 22 + 10);
	});
}

function drawMaskClip(ctx, layer) {
	const mask = layer.mask;
	if (!mask || mask.kind === 'luminance') return false;
	if (mask.kind === 'rect') {
		ctx.beginPath();
		ctx.rect(layer.x + (mask.x ?? 0), layer.y + (mask.y ?? 0), mask.w ?? layer.w, mask.h ?? layer.h);
		ctx.clip();
		return true;
	}
	if (mask.kind === 'ellipse') {
		ctx.beginPath();
		ctx.ellipse(layer.x + (layer.w || 0) / 2, layer.y + (layer.h || 0) / 2, (layer.w || 0) / 2, (layer.h || 0) / 2, 0, 0, Math.PI * 2);
		ctx.clip();
		return true;
	}
	if (mask.kind === 'path' && mask.d) {
		try { ctx.clip(new Path2D(mask.d), mask.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'); return true; } catch { return false; }
	}
	return false;
}

async function drawLayer(ctx, layer, doc, opts = {}) {
	if (layer.hidden) return;
	const designSystem = doc.designSystem;
	ctx.save();try{
	if (layer.opacity < 1) ctx.globalAlpha *= layer.opacity;
	if (layer.rotation) {
		const cx = layer.x + (layer.w || 0) / 2, cy = layer.y + (layer.h || 0) / 2;
		ctx.translate(cx, cy);
		ctx.rotate((layer.rotation * Math.PI) / 180);
		ctx.translate(-cx, -cy);
	}
	const clipped = drawMaskClip(ctx, layer);
	const needsIsolation = (layer.blend && layer.blend !== 'normal') || (layer.type==='group' && layer.opacity<1)||(layer.type==='chart'&&layer.chartKind==='donut');
	if (needsIsolation) {
        const budget=opts.renderBudget||(opts.renderBudget={pixels:0}),pixels=doc.canvas.width*doc.canvas.height;
        if(budget.pixels+pixels>48_000_000)throw new Error('嵌套混合/组透明度超过预览内存预算，请减少隔离层或使用原生对象');
        budget.pixels+=pixels;
        const temp = document.createElement('canvas');
		temp.width = Math.max(1, doc.canvas.width);
		temp.height = Math.max(1, doc.canvas.height);
		const tctx = temp.getContext('2d');
		try{await paintLayerBody(tctx, layer, doc, opts);}finally{budget.pixels-=pixels;}
		ctx.save();
		ctx.globalCompositeOperation = layer.blend && layer.blend!=='normal'?layer.blend:'source-over';
		ctx.drawImage(temp, 0, 0);
		ctx.restore();
	} else {
		await paintLayerBody(ctx, layer, doc, opts);
	}
	}finally{ctx.restore();}
}

async function paintLayerBody(ctx, layer, doc, opts = {}) {
	const designSystem = doc.designSystem;
	switch (layer.type) {
		case 'native':
		case 'image': {
			const canvas = await processedImageCanvas(layer, doc);
			const c = layer.crop;
			setShadow(ctx, layer.style);
			if (c && c.w && c.h) {
				ctx.drawImage(canvas, c.x, c.y, c.w, c.h, layer.x, layer.y, layer.w, layer.h);
			} else {
				ctx.drawImage(canvas, layer.x, layer.y, layer.w, layer.h);
			}
			clearShadow(ctx);
			break;
		}
		case 'text': drawTextLayer(ctx, layer, designSystem); break;
		case 'shape': drawShapeLayer(ctx, layer, designSystem); break;
		case 'vector': drawVectorLayer(ctx, layer, designSystem); break;
		case 'table': drawTableLayer(ctx, layer, designSystem); break;
		case 'chart': drawChartLayer(ctx, layer, designSystem); break;
		case 'group':
			for (const child of layer.children || []) await drawLayer(ctx, child, doc, opts);
			break;
		case 'adjustment': {
			// composite everything below into a snapshot, apply LUT, restore
			const region = opts.adjustRegion || { x: 0, y: 0, w: doc.canvas.width, h: doc.canvas.height };
			const rw = Math.max(1, Math.round(region.w)), rh = Math.max(1, Math.round(region.h));
			const snapshot = document.createElement('canvas');
			snapshot.width = rw; snapshot.height = rh;
			const sctx = snapshot.getContext('2d');
			sctx.drawImage(ctx.canvas, region.x, region.y, rw, rh, 0, 0, rw, rh);
			const data = sctx.getImageData(0, 0, rw, rh);
			applyAdjustClient(data.data, layer.adjust || {});
			sctx.putImageData(data, 0, 0);
			ctx.save();
			if (layer.mask && (layer.mask.kind === 'rect' || layer.mask.kind === 'ellipse' || layer.mask.kind === 'path')) drawMaskClip(ctx, layer);
			ctx.drawImage(snapshot, region.x, region.y);
			ctx.restore();
			break;
		}
		case 'instance': throw new Error('组件实例尚未接通渲染，请保留源数据或转换为实际对象');
		default: throw new Error('该对象类型尚未支持渲染：'+layer.type);
	}
}

/**
 * Render a page onto a 2D context. opts: { scale, signal, skipAdjust }.
 * Clears the target first (caller controls clear color via page background).
 */
export async function renderPage(ctx, page, doc, opts = {}) {
    opts={...opts,renderBudget:{pixels:0}};
	const scale = opts.scale || 1;
	ctx.save();
	ctx.scale(scale, scale);
	// background
	const bg = page.background;
	const W = doc.canvas.width, H = doc.canvas.height;
	ctx.clearRect(0, 0, W, H);
	const bgStyle = typeof bg === 'string' ? bg : bg?.kind === 'solid' ? bg.color
		: (bg?.kind === 'linear' || bg?.kind === 'gradient') ? paintToStyle(ctx, { kind: 'linear', angle: bg.angle || 0, stops: bg.stops || [[0, '#fff'], [1, '#eee']] }, 0, 0, W, H, doc.designSystem)
			: '#FFFFFF';
	if (bgStyle) {
		ctx.fillStyle = typeof bgStyle==='string'?resolveColor(bgStyle,doc.designSystem):bgStyle;
		ctx.fillRect(0, 0, W, H);
	}
	if (bg?.kind === 'image' && bg.asset) {
		const src = typeof bg.asset === 'string' ? bg.asset : bg.asset.src;
		const img = await loadImage(src);
		if (img) ctx.drawImage(img, 0, 0, W, H);
	}
	for (const layer of page.layers || []) {
		await drawLayer(ctx, layer, doc, opts);
	}
	ctx.restore();
}

/** Render page to a fresh canvas (thumbnails, exports). */
export async function renderPageToCanvas(page, doc, width, height) {
	const W = doc.canvas.width, H = doc.canvas.height;
    const pixelWidth=Math.round(width||W),pixelHeight=Math.round(height||H);
    if(!Number.isSafeInteger(pixelWidth)||!Number.isSafeInteger(pixelHeight)||pixelWidth<1||pixelHeight<1||pixelWidth>16384||pixelHeight>16384||pixelWidth*pixelHeight>24_000_000)throw new Error('导出超过单边16384/总量2400万像素预算，请降低倍率或使用原生矢量导出');
	const canvas = document.createElement('canvas');
	canvas.width=pixelWidth;canvas.height=pixelHeight;
	const ctx = canvas.getContext('2d');
	await renderPage(ctx, page, doc, { scale: canvas.width / W });
	return canvas;
}

/** Hit test: topmost layer containing point (doc coords). */
export function hitTest(page, x, y) {
	const layers = page.layers || [];
	for (let i = layers.length - 1; i >= 0; i--) {
		const layer = layers[i];
		if (layer.hidden || layer.locked) continue;
		const b = layerBounds(layer);
		if (layer.rotation) {
			const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
			const a = (-layer.rotation * Math.PI) / 180;
			const dx = x - cx, dy = y - cy;
			const rx = dx * Math.cos(a) - dy * Math.sin(a) + cx;
			const ry = dx * Math.sin(a) + dy * Math.cos(a) + cy;
			if (rx >= b.x && rx <= b.x + b.w && ry >= b.y && ry <= b.y + b.h) return layer;
		} else if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
			return layer;
		}
	}
	return null;
}
