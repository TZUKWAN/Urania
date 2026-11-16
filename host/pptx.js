import {parseSegments,arcToBeziers,pathBounds} from '../client/path.js';
/**
 * DesignCraft PPTX exporter — writes Office Open XML .pptx from dcDoc.
 * Fusion surface: DeckCraft slides/layouts/notes/transitions, PhotoCraft
 * adjustment/filter baking (via raster.js), VectorCraft custGeom paths,
 * OpenDesign design-system var resolution.
 * Zero runtime dependencies (zip.js + raster.js).
 */
import { createZip } from './zip.js';
import { fromPNG, toPNG, applyAdjust, applyFilter, applyMask, composite, createImage, colorToHex, colorAlpha, parseColor } from './raster.js';
import { fromJPEG } from './jpeg.js';

const decodeAny = (buffer) => {
	if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return fromPNG(buffer);
	if (buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8) return fromJPEG(buffer);
	return null;
};

const EMU_PX = 9525; // 1 px @96dpi
const emu = (px) => Math.round(Number(px) || 0) * EMU_PX;
const rotAttr = (deg) => Math.round((Number(deg) || 0) * 60000);
const szAttr = (px) => Math.round((Number(px) || 18) * 75); // px → hundredths of a point

export function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;').replace(/'/g, '&apos;')
		// strip control chars that are illegal in XML
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

const REL_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/* ---------------- style helpers ---------------- */

function resolveVar(color, designSystem) {
	if (typeof color !== 'string') return color;
	const m = /^var\(--([a-zA-Z0-9-]+)\)$/.exec(color.trim());
	if (!m || !designSystem) return color;
	const ds = designSystem.colors || {};
	const key = m[1].replace(/^color-/, '');
	return ds[key] != null ? ds[key] : color;
}

function fillXml(color, designSystem, opacity) {
	const c = resolveVar(color, designSystem);
	if (!c || c === 'none') return '';
	const alpha = opacity != null ? opacity : colorAlpha(c);
	const a = alpha < 1 ? `<a:alpha val="${Math.round(alpha * 100000)}"/>` : '';
	return `<a:solidFill><a:srgbClr val="${colorToHex(c, '000000')}">${a}</a:srgbClr></a:solidFill>`;
}

function gradientFillXml(grad, designSystem, opacity = 1) {
	const stops = (grad.stops || [[0, '#888888'], [1, '#222222']]).map(([off, col]) => {
		const a = opacity < 1 ? `<a:alpha val="${Math.round(opacity * 100000)}"/>` : '';
		return `<a:gs pos="${Math.round((Number(off) || 0) * 100000)}"><a:srgbClr val="${colorToHex(resolveVar(col, designSystem), '888888')}"/>${a}</a:gs>`;
	}).join('');
	const angle = Math.round(((Number(grad.angle) || 0) % 360) * 60000);
	return `<a:gradFill><a:gsLst>${stops}</a:gsLst><a:lin ang="${angle}" scaled="1"/></a:gradFill>`;
}

function paintFill(paint, designSystem, opacity) {
	if (!paint || paint === 'none') return '<a:noFill/>';
	if (typeof paint === 'string') return fillXml(paint, designSystem, opacity);
	if (paint.kind === 'linear' || paint.kind === 'gradient') return gradientFillXml(paint, designSystem, paint.opacity ?? opacity);
	if (paint.kind === 'solid') return fillXml(paint.color, designSystem, paint.opacity ?? opacity);
	return fillXml('#888888', designSystem, opacity);
}

function lineXml(stroke, designSystem, defaultWidthPx = 1) {
	if (!stroke || stroke === 'none' || (typeof stroke === 'object' && stroke.width === 0)) return '<a:ln><a:noFill/></a:ln>';
	if (typeof stroke === 'string') {
		return `<a:ln w="${emu(defaultWidthPx)}">${fillXml(stroke, designSystem)}</a:ln>`;
	}
	const w = emu(stroke.width ?? defaultWidthPx);
	const fill = paintFill(stroke.color ?? '#000000', designSystem);
	const dash = stroke.dash && stroke.dash.length ? `<a:prstDash val="dash"/>` : '';
	return `<a:ln w="${w}" cap="flat">${fill}${dash}</a:ln>`;
}

function effectXml(style = {}, designSystem) {
	let out = '';
	const shadow = style.shadow;
	if (shadow && shadow !== 'none') {
		const color = typeof shadow === 'string' ? shadow : (shadow.color || 'rgba(0,0,0,0.35)');
		const blur = typeof shadow === 'object' ? (shadow.blur ?? 12) : 12;
		const dist = typeof shadow === 'object' ? (shadow.distance ?? 4) : 4;
		const dir = typeof shadow === 'object' ? ((shadow.angle ?? 90)) : 90;
		const a = Math.round(colorAlpha(color) * 100000);
		out += `<a:outerShdw blurRad="${emu(blur)}" dist="${emu(dist)}" dir="${Math.round(dir * 60000)}" rotWithShape="0"><a:srgbClr val="${colorToHex(color, '000000')}"><a:alpha val="${a}"/></a:srgbClr></a:outerShdw>`;
	}
	const glow = style.glow;
	if (glow && glow !== 'none') {
		const color = typeof glow === 'string' ? glow : (glow.color || '#8CCFBC');
		const r = typeof glow === 'object' ? (glow.radius ?? 8) : 8;
		out += `<a:glow rad="${emu(r)}"><a:srgbClr val="${colorToHex(color, '8CCFBC')}"><a:alpha val="${Math.round(colorAlpha(color) * 100000)}"/></a:srgbClr></a:glow>`;
	}
	return out ? `<a:effectLst>${out}</a:effectLst>` : '';
}

const SHAPE_MAP = {
	rect: 'rect', roundrect: 'roundRect', ellipse: 'ellipse', circle: 'ellipse', triangle: 'triangle',
	diamond: 'diamond', pentagon: 'pentagon', hexagon: 'hexagon', star5: 'star5', star: 'star5',
	star4: 'star4', star6: 'star6', star8: 'star8', arrowright: 'rightArrow', arrow: 'rightArrow',
	arrowleft: 'leftArrow', arrowup: 'upArrow', arrowdown: 'downArrow', chevron: 'chevron',
	plus: 'mathPlus', cross: 'mathMultiply', heart: 'heart', cloud: 'cloud', lightning: 'lightningBolt',
	line: 'line', roundedrectangle: 'roundRect', can: 'can', cylinder: 'can', cube: 'cube', donut: 'donut',
	blockarc: 'blockArc', smiley: 'smileyFace', pie: 'pie', chord: 'chord', arc: 'arc', bracket: 'bracketPair'
};

/* ---------------- text ---------------- */

function textBodyXml(layer, designSystem) {
	const lines = String(layer.text ?? '').split(/\r?\n/);
	const align = ({ left: 'l', center: 'ctr', right: 'r', justify: 'just' })[layer.align] || 'l';
	const lineHeight = Number(layer.lineHeight) || 1.4;
	const spcPct = Math.round(lineHeight * 100000);
	const fontSize = layer.fontSize ?? 24;
	const spc = layer.letterSpacing ? Math.round(Number(layer.letterSpacing) * 75) : 0;
	const paragraphs = lines.map((line) => {
		const isBullet = layer.bullets === true && line.trim().length > 0;
		const bu = isBullet ? `<a:buChar char="•"/>` : '<a:buNone/>';
		const indent = isBullet ? `<a:pPr marL="${emu(fontSize * 0.9)}" indent="${-emu(fontSize * 0.9)}" algn="${align}"><a:lnSpc><a:spcPct val="${spcPct}"/></a:lnSpc>${bu}</a:pPr>`
			: `<a:pPr algn="${align}"><a:lnSpc><a:spcPct val="${spcPct}"/></a:lnSpc>${bu}</a:pPr>`;
		const runProps = [`lang="zh-CN"`, `sz="${szAttr(fontSize)}"`];
		if (layer.bold) runProps.push('b="1"');
		if (layer.italic) runProps.push('i="1"');
		if (spc) runProps.push(`spc="${spc}"`);
		let runChildren = `<a:solidFill>${fillInner(resolveVar(layer.color ?? '#202936', designSystem),layer.opacity??1)}</a:solidFill>`;
		const latin = fontNameFor(layer.fontFamily, designSystem);
		runChildren += `<a:latin typeface="${esc(latin)}"/><a:ea typeface="${esc(latin)}"/>`;
		const text = line.length ? `<a:r><a:rPr ${runProps.join(' ')}>${runChildren}</a:rPr><a:t>${esc(line)}</a:t></a:r>` : '<a:endParaRPr lang="zh-CN"/>';
		return `<a:p>${indent}${text}</a:p>`;
	}).join('');
	const anchor = ({ top: 't', middle: 'ctr', bottom: 'b' })[layer.vAlign] || 't';
	return `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${anchor}"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody>`;
}

function fillInner(color,opacity=1) {
	const a = colorAlpha(color)*opacity;
	const alpha = a < 1 ? `<a:alpha val="${Math.round(a * 100000)}"/>` : '';
	return `<a:srgbClr val="${colorToHex(color, '202936')}">${alpha}</a:srgbClr>`;
}

function fontNameFor(family, designSystem) {
	if (!family && designSystem?.fonts?.body) family = designSystem.fonts.body;
	if (family && family.startsWith('var(--')) {
		const key = family.replace(/var\(--font-|\)/g, '');
		family = designSystem?.fonts?.[key] || family;
	}
	const first = String(family || '').split(',')[0].replace(/["']/g, '').trim();
	return first || 'Microsoft YaHei';
}

/* ---------------- vector → custGeom ---------------- */

function pathContoursToCustGeom(layer, designSystem) {
	const paths = layer.paths || [];
	let w = Number(layer.w) || 100, h = Number(layer.h) || 100;
	// compute bbox across contours for normalized coordinate space
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	const contours = [];
	for (const p of paths) {
		const pts = contourPoints(p.d || '');
		for (const [x, y] of pts) {
			if (x < minX) minX = x; if (y < minY) minY = y;
			if (x > maxX) maxX = x; if (y > maxY) maxY = y;
		}
		contours.push({ d: p.d, closed: !!p.closed });
	}
	if (!isFinite(minX)) { minX = 0; minY = 0; maxX = w; maxY = h; }
	if(layer.geometryBox){minX=layer.geometryBox.x;minY=layer.geometryBox.y;maxX=minX+layer.geometryBox.w;maxY=minY+layer.geometryBox.h;}
	const bw = Math.max(1e-6, maxX - minX), bh = Math.max(1e-6, maxY - minY);
	const pathEls = contours.map(({ d, closed }) => {
		const segs = parseSegments(d);
		const norm = (x, y) => `${Math.round(((x - minX) / bw) * 100000)},${Math.round(((y - minY) / bh) * 100000)}`;
		let xml = `<a:path w="100000" h="100000" fill="norm">`;
		let cur = null, start = null;
		const moveTo = (x, y) => { xml += `<a:moveTo><a:pt x="${norm(x, y).split(',')[0]}" y="${norm(x, y).split(',')[1]}"/></a:moveTo>`; };
		const lineTo = (x, y) => { const [nx, ny] = norm(x, y).split(','); xml += `<a:lnTo><a:pt x="${nx}" y="${ny}"/></a:lnTo>`; };
		const curveTo = (x1, y1, x2, y2, x, y) => {
			const [a1x, a1y] = norm(x1, y1).split(','); const [a2x, a2y] = norm(x2, y2).split(',');
			const [ax, ay] = norm(x, y).split(',');
			xml += `<a:cubicBezTo><a:pt x="${a1x}" y="${a1y}"/><a:pt x="${a2x}" y="${a2y}"/><a:pt x="${ax}" y="${ay}"/></a:cubicBezTo>`;
		};
		for (const seg of segs) {
			const [cmd, ...args] = seg;
			if (cmd === 'M') { cur = [args[0], args[1]]; start = cur; moveTo(cur[0], cur[1]); }
			else if (cmd === 'L') { cur = [args[0], args[1]]; lineTo(cur[0], cur[1]); }
			else if (cmd === 'C') { curveTo(args[0], args[1], args[2], args[3], args[4], args[5]); cur = [args[4], args[5]]; }
			else if (cmd === 'Q') {
				const [x0, y0] = cur || [0, 0];
				const cx = args[0], cy = args[1], x = args[2], y = args[3];
				const c1x = x0 + 2 / 3 * (cx - x0), c1y = y0 + 2 / 3 * (cy - y0);
				const c2x = x + 2 / 3 * (cx - x), c2y = y + 2 / 3 * (cy - y);
				curveTo(c1x, c1y, c2x, c2y, x, y);
				cur = [x, y];
			}
			else if (cmd === 'Z') { xml += '<a:close/>'; cur = start; }
		}
		xml += '</a:path>';
		return xml;
	}).join('');
	const fill = layer.paths?.[0]?.fill ? paintFill(layer.paths[0].fill, designSystem) : '<a:noFill/>';
	const stroke = layer.paths?.[0]?.stroke ? lineXml(layer.paths[0].stroke, designSystem, layer.paths[0].strokeWidth ?? 1) : '<a:ln><a:noFill/></a:ln>';
	return { minX, minY, bw, bh, geom: `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="100000" b="100000"/><a:pathLst>${pathEls}</a:pathLst></a:custGeom>`, fill, stroke };
}

export {parseSegments,arcToBeziers} from '../client/path.js';

function contourPoints(d) {
	const pts = [];
	for (const seg of parseSegments(d)) {
		if (seg[0] === 'C') pts.push([seg[5], seg[6]]);
		else if (seg[0] === 'M' || seg[0] === 'L') pts.push([seg[1], seg[2]]);
	}
	return pts;
}

/* ---------------- baking (PhotoCraft fusion) ---------------- */

function layerSignature(layer) {
	return JSON.stringify([layer.asset, layer.adjust, layer.filters, layer.mask && layer.mask.kind, layer.opacity]);
}

/**
 * Produce a display asset for an image layer: applies adjust + filters + luminance mask.
 * cache: Map signature → {name, buffer}. loadAsset(name) → Buffer|null.
 */
function bakeImageLayer(layer, designSystem, loadAsset, cache, tag) {
	const srcName = layer.asset && layer.asset.src ? layer.asset.src : (typeof layer.asset === 'string' ? layer.asset : null);
	if (!srcName) return null;
	const sig = layerSignature(layer);
	if (cache.has(sig)) return cache.get(sig);
	const needsBake = (layer.adjust && Object.keys(layer.adjust).length) || (layer.filters && layer.filters.length) || (layer.mask && layer.mask.kind === 'luminance') || (layer.transform && (layer.transform.flipH || layer.transform.flipV));
	if (!needsBake) return null;
	let buffer = loadAsset(srcName);
	if (!buffer) return null;
	let img = decodeAny(buffer);
	if (!img) return null; // unsupported format passes through unbaked
	const hasAdjust = layer.adjust && Object.keys(layer.adjust).length;
	if (hasAdjust) applyAdjust(img, layer.adjust);
	for (const f of layer.filters || []) { try { applyFilter(img, f); } catch { } }
	if (layer.transform && layer.transform.flipH) img = flipImg(img, true);
	if (layer.transform && layer.transform.flipV) img = flipImg(img, false);
	if (layer.mask && layer.mask.kind === 'luminance' && layer.mask.asset) {
		const mBuf = loadAsset(typeof layer.mask.asset === 'string' ? layer.mask.asset : layer.mask.asset.src);
		if (mBuf) { try { applyMask(img, fromPNG(mBuf)); } catch { } }
	}
	const outName = `bake-${tag}-${cache.size}.png`;
	const out = toPNG(img);
	const record = { name: outName, buffer: out };
	cache.set(sig, record);
	return record;
}

function flipImg(img, horizontal) {
	const out = createImage(img.width, img.height);
	for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
		const sx = horizontal ? img.width - 1 - x : x;
		const sy = horizontal ? y : img.height - 1 - y;
		const si = (sy * img.width + sx) * 4, di = (y * img.width + x) * 4;
		out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1]; out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = img.data[si + 3];
	}
	return out;
}

/* ---------------- slide assembly ---------------- */

function collectLayers(layers) {
	// flatten groups (children absolute coords) + expand nothing else; instances are baked earlier
	const out = [];
	for (const layer of layers || []) {
		if(layer.hidden||layer.visible===false)continue;
		if (layer.type === 'group') out.push(...collectLayers(layer.children));
		else out.push(layer);
	}
	return out;
}

function imageRelId(layer, media, loadAsset, cache, tag) {
	let srcName = layer.asset && layer.asset.src ? layer.asset.src : (typeof layer.asset === 'string' ? layer.asset : null);
	let buffer = null; let ext = 'png';
	if (layer.__bakedBuffer) {
		// pre-composited bitmap (blend baking) — goes straight into media
		buffer = layer.__bakedBuffer;
		srcName = `baked-${tag}-${media.list.length}`;
		ext = 'png';
	}
	const baked = buffer ? null : bakeImageLayer(layer, null, loadAsset, cache, tag);
	if (baked) { buffer = baked.buffer; srcName = baked.name; ext = 'png'; }
	else if (!buffer && srcName) {
		buffer = loadAsset(srcName);
		ext = (/\.jpe?g$/i.test(srcName) ? 'jpg' : 'png');
	}
	if (!buffer) return null;
	const key = srcName;
	if (media.map.has(key)) return media.map.get(key);
	const id = `img${media.list.length + 1}`;
	media.list.push({ id, name: `${id}.${ext}`, buffer });
	media.map.set(key, id);
	return id;
}

function shapeTreeXml(layers, designSystem, media, loadAsset, cache, tag, warnings) {
	let picId = 100;
	const xml = [];
	for (const layer of layers) {
		if (layer.hidden === true || layer.visible === false) continue;
		const x = emu(layer.x), y = emu(layer.y), w = emu(layer.w ?? layer.width ?? 100), h = emu(layer.h ?? layer.height ?? 100);
		const rot = rotAttr(layer.rotation);
		const flipH = layer.transform?.flipH ? ' flipH="1"' : '';
		const flipV = layer.transform?.flipV ? ' flipV="1"' : '';
		const opacity = layer.opacity == null ? 1 : Number(layer.opacity);
		const xfrm = `<a:xfrm${rot ? ` rot="${rot}"` : ''}${flipH}${flipV}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;
		const common = `id="${picId++}" name="${esc(layer.name || layer.type)}"`;
		if (layer.type === 'image') {
			const relId = imageRelId(layer, media, loadAsset, cache, tag);
			if (!relId) { warnings.push(`图片资产缺失：${layer.name || layer.asset?.src}`); continue; }
			let srcRect = '';
			const c = layer.crop;
			if (c) {
				const iw = layer.asset?.width || (layer.naturalWidth ?? 0), ih = layer.asset?.height || (layer.naturalHeight ?? 0);
				if (iw && ih) {
					const l = Math.round((Number(c.x) || 0) / iw * 100000), t = Math.round((Number(c.y) || 0) / ih * 100000);
					const r = 100000 - Math.round(((Number(c.x) || 0) + (Number(c.w) || iw)) / iw * 100000);
					const b = 100000 - Math.round(((Number(c.y) || 0) + (Number(c.h) || ih)) / ih * 100000);
					srcRect = `<a:srcRect l="${Math.max(0, l)}" t="${Math.max(0, t)}" r="${Math.max(0, r)}" b="${Math.max(0, b)}"/>`;
				}
			}
			xml.push(`<p:pic><p:nvPicPr><p:cNvPr ${common}/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}">${opacity<1?`<a:alphaModFix amt="${Math.round(opacity*100000)}"/>`:''}</a:blip>${srcRect}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
		} else if (layer.type === 'text') {
			xml.push(`<p:sp><p:nvSpPr><p:cNvPr ${common}/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>${textBodyXml(layer, designSystem)}</p:sp>`);
		} else if (layer.type === 'shape') {
			const preset = SHAPE_MAP[String(layer.shape || 'rect').toLowerCase()] || 'rect';
			const adj = preset === 'roundRect' ? `<a:avLst><a:gd name="adj" fmla="val ${Math.round((layer.radius == null ? 0.15 : Number(layer.radius)) * 50000)}"/></a:avLst>` : '<a:avLst/>';
			const fill = paintFill(layer.fill ?? '#287D6C', designSystem, layer.opacity);
			const stroke = lineXml(layer.stroke, designSystem, 2);
			xml.push(`<p:sp><p:nvSpPr><p:cNvPr ${common}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}<a:prstGeom prst="${preset}">${adj}</a:prstGeom>${fill}${stroke}${effectXml(layer.style, designSystem)}</p:spPr>${layer.text != null && layer.text !== '' ? textBodyXml({ ...layer, fontSize: layer.fontSize ?? 18 }, designSystem) : ''}</p:sp>`);
		} else if (layer.type === 'vector') {
			const { geom, fill, stroke } = pathContoursToCustGeom(layer, designSystem);
			xml.push(`<p:sp><p:nvSpPr><p:cNvPr ${common}/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm}${geom}${fill}${stroke}</p:spPr></p:sp>`);
		} else if (layer.type === 'table') {
			xml.push(tableXml(layer, designSystem, xfrm, common));
		} else if (layer.type === 'chart') {
			xml.push(...chartXml(layer, designSystem, () => picId++));
		} else if (layer.type === 'adjustment') {
			warnings.push(`调整层 "${layer.name || ''}" 已烘焙至下方图片；下方无图片时被跳过`);
		}
	}
	return xml.join('');
}

function tableXml(layer, designSystem, xfrm, common) {
	const rows = layer.rows || [];
	const cols = Math.max(1, ...rows.map(r => (r || []).length));
	const colW = Math.round(emu(layer.w ?? 600) / cols);
	const grid = `<a:tblGrid>${Array.from({ length: cols }, () => `<a:gridCol w="${colW}"/>`).join('')}</a:tblGrid>`;
	const body = rows.map((row, ri) => {
		const header = ri === 0 && layer.header !== false;
		const cells = Array.from({ length: cols }, (_, ci) => {
			const cell = row?.[ci];
			const text = cell == null ? '' : (typeof cell === 'object' ? String(cell.text ?? '') : String(cell));
			const fill = header ? (layer.headerFill || '#287D6C') : (ri % 2 ? (layer.stripeFill || 'F5F6F8') : 'FFFFFF');
			const color = header ? '#FFFFFF' : '#202936';
			return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${header ? 'ctr' : 'l'}"/><a:r><a:rPr lang="zh-CN" sz="${szAttr(layer.fontSize ?? 16)}"${header ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${colorToHex(color, '202936')}"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="${colorToHex(fill, 'FFFFFF')}"/></a:solidFill><a:lnL w="9525"><a:solidFill><a:srgbClr val="DEE3E9"/></a:solidFill></a:lnL><a:lnR w="9525"><a:solidFill><a:srgbClr val="DEE3E9"/></a:solidFill></a:lnR><a:lnT w="9525"><a:solidFill><a:srgbClr val="DEE3E9"/></a:solidFill></a:lnT><a:lnB w="9525"><a:solidFill><a:srgbClr val="DEE3E9"/></a:solidFill></a:lnB></a:tcPr></a:tc>`;
		}).join('');
		return `<a:tr h="${emu((layer.rowHeight) ?? 40)}">${cells}</a:tr>`;
	}).join('');
	return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr ${common}/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${xfrm.match(/x="(-?\d+)"/)[1]}" y="${xfrm.match(/y="(-?\d+)"/)[1]}"/><a:ext cx="${xfrm.match(/cx="(\d+)"/)[1]}" cy="${xfrm.match(/cy="(\d+)"/)[1]}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"/>${grid}${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/** Native-shape chart rendering for PPTX (host-side, no canvas needed). */
function chartXml(layer, designSystem, allocateId) {
	const out = [];
	const kind = String(layer.chartKind || 'bar');
	const data = layer.data || {};
	const labels = data.labels || [];
	const series = data.series || [{ name: 'Series 1', values: (data.values || []) }];
	const colors = (data.colors && data.colors.length ? data.colors : ['#287D6C', '#8CCFBC', '#9E7129', '#B44846', '#4A5564', '#287E59']);
	const x = Number(layer.x) || 80, y = Number(layer.y) || 80;
	const w = Number(layer.w) || 480, h = Number(layer.h) || 320;
	const sp = (id, x2, y2, w2, h2, body, fill, stroke, geom) => {
		const shapeId=allocateId();
		return `<p:sp><p:nvSpPr><p:cNvPr id="${shapeId}" name="chart-${kind}-${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x2)}" y="${emu(y2)}"/><a:ext cx="${emu(w2)}" cy="${emu(h2)}"/></a:xfrm>${geom || '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'}${fill || '<a:noFill/>'}${stroke || '<a:ln><a:noFill/></a:ln>'}</p:spPr>${body || ''}</p:sp>`;
	};
	const txt = (text, size, color, bold, align) => `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr algn="${align || 'l'}"/><a:r><a:rPr lang="zh-CN" sz="${szAttr(size)}"${bold ? ' b="1"' : ''}><a:solidFill><a:srgbClr val="${colorToHex(color, '202936')}"/></a:solidFill></a:rPr><a:t>${esc(text)}</a:t></a:r></a:p></p:txBody>`;
	const maxV = Math.max(1, ...series.flatMap(s => (s.values || []).map(Number).filter(Number.isFinite)));
	if (kind === 'bar' || kind === 'column') {
		const plotH = h * 0.72, plotY = y + h * 0.18;
		const groupW = w * 0.82 / Math.max(1, labels.length);
		const barW = groupW * 0.7 / series.length;
		series.forEach((s, si) => {
			(s.values || []).forEach((v, vi) => {
				const vh = (Number(v) / maxV) * plotH;
				out.push(sp(si * 100 + vi, x + w * 0.09 + vi * groupW + si * barW, plotY + plotH - vh, barW * 0.92, vh, '', `<a:solidFill><a:srgbClr val="${colorToHex(colors[si % colors.length], '287D6C')}"/></a:solidFill>`));
			});
		});
		labels.forEach((label, vi) => out.push(sp(500 + vi, x + w * 0.09 + vi * groupW, plotY + plotH + 4, groupW, 24, txt(String(label), 12, '#74808C', false, 'ctr'))));
	} else if (kind === 'line' || kind === 'area') {
		const plotW = w * 0.78, plotH = h * 0.66, px0 = x + w * 0.12, py0 = y + h * 0.2;
		series.forEach((s, si) => {
			const vals = (s.values || []).map(Number);
			const n = Math.max(1, vals.length - 1);
			const pts = vals.map((v, i) => [px0 + (i / n) * plotW, py0 + plotH - (v / maxV) * plotH]);
			let d = '';
			pts.forEach(([px, py], i) => { d += i ? `L ${px.toFixed(1)} ${py.toFixed(1)} ` : `M ${px.toFixed(1)} ${py.toFixed(1)} `; });
			if (kind === 'area') d += `L ${(px0 + plotW).toFixed(1)} ${(py0 + plotH).toFixed(1)} L ${px0} ${(py0 + plotH).toFixed(1)} Z`;
			out.push(sp(600 + si, 0, 0, 0, 0, '', kind === 'area' ? `<a:solidFill><a:srgbClr val="${colorToHex(colors[si % colors.length], '287D6C')}"><a:alpha val="40000"/></a:srgbClr></a:solidFill>` : '<a:noFill/>', `<a:ln w="${emu(2.5)}"><a:solidFill><a:srgbClr val="${colorToHex(colors[si % colors.length], '287D6C')}"/></a:solidFill></a:ln>`,
				`<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="w" b="h"/><a:pathLst></a:pathLst></a:custGeom>`));
			pts.forEach(([px, py]) => out.push(sp(700 + si * 40 + Math.round(px), px - 4, py - 4, 8, 8, '', `<a:solidFill><a:srgbClr val="${colorToHex(colors[si % colors.length], '287D6C')}"/></a:solidFill>`, undefined, '<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>')));
		});
		labels.forEach((label, vi) => out.push(sp(900 + vi, px0 + (vi / Math.max(1, labels.length - 1)) * plotW - 40, py0 + plotH + 4, 80, 22, txt(String(label), 12, '#74808C', false, 'ctr'))));
	} else if (kind === 'pie' || kind === 'donut') {
		const total = series[0].values.map(Number).reduce((a2, b2) => a2 + b2, 0) || 1;
		const r = Math.min(w, h) * 0.4, cx = x + w * 0.36, cy = y + h * 0.5;
		let angle = -90;
		series[0].values.forEach((v, vi) => {
			const sweep = (Number(v) / total) * 360;
			const start = angle, end = angle + sweep;
			angle = end;
			const p0 = `${Math.round((cx + r * Math.cos(start * Math.PI / 180)) * 100000) / 100000},${Math.round((cy + r * Math.sin(start * Math.PI / 180)) * 100000) / 100000}`;
			const p1 = `${Math.round((cx + r * Math.cos(end * Math.PI / 180)) * 100000) / 100000},${Math.round((cy + r * Math.sin(end * Math.PI / 180)) * 100000) / 100000}`;
			const st1 = Math.round(((start % 360) + 360) % 360 * 60000), en1 = Math.round(((end % 360) + 360) % 360 * 60000);
			const preset = kind === 'donut' ? 'blockArc' : 'pie';
			const adj = kind === 'donut'
				? `<a:gd name="adj1" fmla="val ${st1}"/><a:gd name="adj2" fmla="val ${en1}"/><a:gd name="adj3" fmla="val 25000"/>`
				: `<a:gd name="adj1" fmla="val ${st1}"/><a:gd name="adj2" fmla="val ${en1}"/>`;
			out.push(sp(1100 + vi, cx - r, cy - r, r * 2, r * 2, '', `<a:solidFill><a:srgbClr val="${colorToHex(colors[vi % colors.length], '287D6C')}"/></a:solidFill>`, '<a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln>', `<a:prstGeom prst="${preset}"><a:avLst>${adj}</a:avLst></a:prstGeom>`));
		});
	}
	// legend
	const legendX = x + w * (kind === 'pie' || kind === 'donut' ? 0.72 : 0.12);
	const legendY = y + h * (kind === 'pie' || kind === 'donut' ? 0.25 : 0.02);
	series.forEach((s, si) => {
		out.push(sp(1300 + si, legendX, legendY + si * 26, 14, 14, '', `<a:solidFill><a:srgbClr val="${colorToHex(colors[si % colors.length], '287D6C')}"/></a:solidFill>`, undefined, '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'));
		out.push(sp(1400 + si, legendX + 20, legendY + si * 26 - 3, 150, 22, txt(String(s.name || ('系列' + (si + 1))), 12, '#202936')));
	});
	if (layer.title) out.push(sp(1500, x, y - 6, w, 34, txt(String(layer.title), 18, '#202936', true)));
	return out;
}

/* ---------------- notes & transitions ---------------- */

function notesXml(text) {
	return `<p:notes xmlns:p="${NS_P}" xmlns:a="${NS_A}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>` +
		`<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN"/><a:t>${esc(text || '')}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`;
}

function transitionXml(page) {
	const t = page?.transition;
	if (!t || t.kind === 'none') return '';
	const dur = `<p:transition spd="slow" p14:dur="${Math.round((Number(t.duration) || 400))}" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main">`;
	if (t.kind === 'fade') return `${dur}<p:fade/></p:transition>`;
	if (t.kind === 'slide' || t.kind === 'push') return `${dur}<p:push dir="l"/></p:transition>`;
	if (t.kind === 'wipe') return `${dur}<p:wipe dir="r"/></p:transition>`;
	if (t.kind === 'morph') return `${dur}<p14:morph option="byObject"/></p:transition>`;
	return `${dur}<p:fade/></p:transition>`;
}

function backgroundXml(page, designSystem, media, loadAsset) {
	const bg = page?.background;
	if (!bg) return '';
	if (typeof bg === 'string') return `<p:bg><p:bgPr>${fillXml(bg, designSystem)}<a:effectLst/></p:bgPr></p:bg>`;
	if (bg.kind === 'solid') return `<p:bg><p:bgPr>${fillXml(bg.color, designSystem)}<a:effectLst/></p:bgPr></p:bg>`;
	if (bg.kind === 'linear' || bg.kind === 'gradient') return `<p:bg><p:bgPr>${gradientFillXml(bg, designSystem)}<a:effectLst/></p:bgPr></p:bg>`;
	if (bg.kind === 'image' && bg.asset) {
		const src = typeof bg.asset === 'string' ? bg.asset : bg.asset.src;
		const buffer = src ? loadAsset(src) : null;
		if (buffer) {
			const id = `bgimg${media.list.length + 1}`;
			media.list.push({ id, name: `${id}.png`, buffer });
			return `<p:bg><p:bgPr><a:blipFill rotWithShape="1"><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>`;
		}
	}
	return '';
}

/* ---------------- main export ---------------- */

/**
 * Export dcDoc → pptx Buffer.
 * loadAsset(srcName) → Buffer|null   (doc assets directory reader)
 */
export function exportPptx(doc, loadAsset) {
	const designSystem = doc.designSystem || null;
	const pages = (doc.pages || []).filter(p => !p.hidden);
	const widthPx = doc.canvas?.width || 1280;
	const heightPx = doc.canvas?.height || 720;
	const warnings = [];
	const media = { list: [], map: new Map() };
	const bakeCache = new Map();

	const slideEntries = [];
	const notesEntries = [];
	pages.forEach((page, index) => {
		const layers = collectLayers(expandInstances(page.layers || [], doc));
		// bake adjustment layers onto image layers below (PhotoCraft fusion)
		const baked = bakeAdjustmentLayers(layers, loadAsset, bakeCache, `p${index}`);
		// bake blend-mode groups into real composited bitmaps (host pixel engine)
		const blended = bakeBlendLayers(baked, doc.canvas.width || 1280, doc.canvas.height || 720, loadAsset, bakeCache, `p${index}`, warnings);
		const body = shapeTreeXml(blended, designSystem, media, loadAsset, bakeCache, `p${index}`, warnings);
		const bg = backgroundXml(page, designSystem, media, loadAsset);
		slideEntries.push({
			name: `ppt/slides/slide${index + 1}.xml`,
			data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree>${bg ? '<p:bg>' + '' + '</p:bg>' : ''}</p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>${transitionXml(page)}</p:sld>`
		});
		if (page.notes) notesEntries.push({ index, text: page.notes });
	});
	// fix: bg must be inside cSld before spTree; rebuild with bg placed correctly
	slideEntries.forEach((entry, index) => {
		const page = pages[index];
		const bg = backgroundXml(page, designSystem, media, loadAsset);
		const bodyMatch = /<p:spTree>[\s\S]*<\/p:spTree>/.exec(entry.data);
		const tree = bodyMatch ? bodyMatch[0] : '';
		const trans = transitionXml(page);
		entry.data = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld>${bg}${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${trans}</p:sld>`;
	});

	const slideRels = slideEntries.map((entry, index) => ({
		name: `ppt/slides/_rels/slide${index + 1}.xml.rels`,
		data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>${notesEntries.some(n => n.index === index) ? `<Relationship Id="rId2" Type="${REL_R}/notesSlide" Target="../notesSlides/notesSlide${notesEntries.findIndex(n => n.index === index) + 1}.xml"/>` : ''}${media.list.map(m=>`<Relationship Id="${m.id}" Type="${REL_R}/image" Target="../media/${m.name}"/>`).join('')}</Relationships>`
	}));

	const notesMaster = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notesMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMap><p:notesStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`;

	const layout1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

	const master = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;

	const theme = buildTheme(designSystem);

	const presentation = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}" saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${slideEntries.map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${emu(widthPx)}" cy="${emu(heightPx)}"/><p:notesSz cx="${emu(960)}" cy="${emu(540)}"/></p:presentation>`;

	const presRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_R}/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="${REL_R}/notesMaster" Target="notesMasters/notesMaster1.xml"/>${slideEntries.map((s, i) => `<Relationship Id="rId${10 + i}" Type="${REL_R}/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}<Relationship Id="rId7" Type="${REL_R}/theme" Target="theme/theme1.xml"/></Relationships>`;

	const entries = [
		{ name: '[Content_Types].xml', data: buildContentTypes(slideEntries.length, notesEntries.length, media.list) },
		{ name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_R}/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="${REL_R}/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL_R}/extended-properties" Target="docProps/app.xml"/></Relationships>` },
		{ name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.title || 'DesignCraft Deck')}</dc:title><dc:creator>DesignCraft for DSH</dc:creator></cp:coreProperties>` },
		{ name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>DesignCraft</Application><Slides>${slideEntries.length}</Slides></Properties>` },
		{ name: 'ppt/presentation.xml', data: presentation },
		{ name: 'ppt/_rels/presentation.xml.rels', data: presRels },
		{ name: 'ppt/theme/theme1.xml', data: theme },
		{ name: 'ppt/slideMasters/slideMaster1.xml', data: master },
		{ name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${REL_R}/theme" Target="../theme/theme1.xml"/></Relationships>` },
		{ name: 'ppt/slideLayouts/slideLayout1.xml', data: layout1 },
		{ name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_R}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>` },
		{ name: 'ppt/notesMasters/notesMaster1.xml', data: notesMaster },
		...slideEntries,
		...slideRels
	];
	notesEntries.forEach((note, i) => {
		entries.push({ name: `ppt/notesSlides/notesSlide${i + 1}.xml`, data: notesXml(note.text) });
		entries.push({ name: `ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL_R}/slide" Target="../slides/slide${note.index + 1}.xml"/><Relationship Id="rId2" Type="${REL_R}/notesMaster" Target="../notesMasters/notesMaster1.xml"/></Relationships>` });
	});
	media.list.forEach(m => entries.push({ name: `ppt/media/${m.name}`, data: m.buffer, isBinary: true }));

	if (warnings.length) {
		entries.push({ name: 'docProps/designcraft-warnings.txt', data: warnings.join('\n') });
	}
	return { buffer: createZip(entries), warnings };
}

function bakeAdjustmentLayers(layers, loadAsset, cache, tag) {
	const out = layers.map(l => ({ ...l }));
	for (let i = 0; i < out.length; i++) {
		const layer = out[i];
		if (layer.type !== 'adjustment') continue;
		const params = layer.adjust || {};
		if (layer.mask && layer.mask.kind === 'luminance' && layer.mask.asset) params.__masked = true;
		for (let j = i - 1; j >= 0; j--) {
			if (out[j].type === 'image') {
				out[j] = { ...out[j], adjust: { ...(out[j].adjust || {}), ...params } };
			}
		}
	}
	return out.filter(l => l.type !== 'adjustment' || l.__keep);
}

/**
 * Blend-mode baking (PhotoCraft × DeckCraft fusion): a blend≠normal image layer,
 * together with the contiguous image layers beneath it, is composited by the host
 * pixel engine into one real bitmap — PowerPoint gets the true blend result.
 * Groups containing text/shape layers below a blend layer keep the opacity
 * approximation (host cannot rasterize text) and emit a warning.
 */
function bakeBlendLayers(layers, pageW, pageH, loadAsset, cache, tag, warnings) {
	const out = layers.map(l => ({ ...l }));
	for (let i = 0; i < out.length; i++) {
		const layer = out[i];
		const blend = String(layer.blend || 'normal').toLowerCase();
		if (blend === 'normal' || layer.hidden) continue;
		if (layer.type !== 'image') {
			warnings.push(`混合模式 "${blend}"（图层 "${layer.name}"）为非图片层，PPTX 以不透明度近似`);
			continue;
		}
		// collect contiguous image layers below
		let j = i - 1;
		while (j >= 0 && out[j].type === 'image' && !out[j].hidden) j--;
		const group = out.slice(j + 1, i + 1);
		if (group.length < 2) {
			warnings.push(`混合模式 "${blend}"（图层 "${layer.name}"）下方无图片层可烘焙，以不透明度近似`);
			continue;
		}
		// composite group bottom→top
		let acc = null;
		let bakeFailed = false;
		for (const gl of group) {
			const srcName = typeof gl.asset === 'string' ? gl.asset : gl.asset?.src;
			const buffer = srcName ? loadAsset(srcName) : null;
			let img = null;
			if (buffer) {
				if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50) { try { img = fromPNG(buffer); } catch { img = null; } }
				else if (buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8) { try { img = fromJPEG(buffer); } catch { img = null; } }
			}
			if (!img) { bakeFailed = true; break; }
			if (!acc) {
				acc = createImage(pageW, pageH, [0, 0, 0, 0]);
			}
			composite(acc, img, { x: Math.round(gl.x), y: Math.round(gl.y), opacity: gl.opacity ?? 1, blend: gl === layer ? blend : (String(gl.blend || 'normal').toLowerCase()) });
		}
		if (bakeFailed || !acc) {
			warnings.push(`混合模式 "${blend}"（图层 "${layer.name}"）烘焙失败（图片缺失），以不透明度近似`);
			continue;
		}
		const outName = `blend-${tag}-${cache.size}.png`;
		const bakedLayer = {
			id: layer.id + '-baked', type: 'image', name: (group.map(g => g.name).join('+')).slice(0, 80) || '混合烘焙',
			x: 0, y: 0, w: pageW, h: pageH,
			asset: { src: outName }, opacity: 1, blend: 'normal', rotation: 0,
			__bakedBuffer: toPNG(acc)
		};
		out.splice(j + 1, group.length, bakedLayer);
		// adjust loop index: we replaced group with 1 layer
		i = j; // next iteration continues from the baked layer
	}
	return out;
}

function buildContentTypes(slideCount, notesCount, mediaList) {
	const defaults = `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>`;
	const overrides = [
		`<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
		`<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
		`<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
		`<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>`,
		`<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
		`<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
		`<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
		...Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
		...Array.from({ length: notesCount }, (_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`)
	].join('');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}${overrides}</Types>`;
}

function buildTheme(designSystem) {
	const c = (key, fallback) => colorToHex(resolveVar(designSystem?.colors?.[key] ? `var(--color-${key})` : fallback, designSystem), fallback);
	const dk1 = colorToHex(designSystem?.colors?.ink || '202936', '202936');
	const lt1 = colorToHex(designSystem?.colors?.surface || 'FFFFFF', 'FFFFFF');
	const accent1 = colorToHex(designSystem?.colors?.primary || '287D6C', '287D6C');
	const accent2 = colorToHex(designSystem?.colors?.accent || '9E7129', '9E7129');
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${NS_A}" name="DesignCraft"><a:themeElements><a:clrScheme name="DesignCraft"><a:dk1><a:srgbClr val="${dk1}"/></a:dk1><a:lt1><a:srgbClr val="${lt1}"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="${accent1}"/></a:accent1><a:accent2><a:srgbClr val="${accent2}"/></a:accent2><a:accent3><a:srgbClr val="A9D18E"/></a:accent3><a:accent4><a:srgbClr val="4472C4"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="DesignCraft"><a:majorFont><a:latin typeface="Segoe UI"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Segoe UI"/><a:ea typeface="Microsoft YaHei"/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="DesignCraft"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}

/** Expand instance layers via template definitions (OpenDesign fusion). templates provided as {id→template}. */
function expandInstances(layers, doc) {
	const registry = doc.__templates || {};
	const out = [];
	for (const layer of layers || []) {
		if (layer.type === 'instance') {
			const tpl = registry[layer.template] || registry[String(layer.template)];
			if (tpl && typeof tpl.expand === 'function') out.push(...tpl.expand(layer.vars || {}));
			else out.push(layer);
		} else if (layer.type === 'group' && Array.isArray(layer.children)) {
			out.push({ ...layer, children: expandInstances(layer.children, doc) });
		} else out.push(layer);
	}
	return out;
}
