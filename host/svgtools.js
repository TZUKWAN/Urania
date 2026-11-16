/**
 * DesignCraft SVG tools (host-side, regex-based subset parser + serializer).
 * parseSvg: SVG text → vector layers (rect/circle/ellipse/line/polyline/polygon/path + g transforms).
 * pageToSvg: dcDoc page → SVG string (used by export.svg / export.html).
 * VectorCraft fusion surface: SVG import/export for the vector editor.
 */
import { parseSegments } from './pptx.js';

/* ---------------- transforms ---------------- */

function mulMatrix(a, b) {
	return [
		a[0] * b[0] + a[2] * b[2], a[1] * b[0] + a[3] * b[2],
		a[0] * b[1] + a[2] * b[3], a[1] * b[1] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
	];
}

const IDENT = [1, 0, 0, 1, 0, 0];

function applyMatrix(m, x, y) {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseTransform(str) {
	let m = IDENT;
	const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
	let match;
	while ((match = re.exec(String(str || '')))) {
		const args = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
		let next = IDENT;
		switch (match[1]) {
			case 'matrix': next = args.length >= 6 ? args.slice(0, 6) : IDENT; break;
			case 'translate': next = [1, 0, 0, 1, args[0] || 0, args[1] || 0]; break;
			case 'scale': next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]; break;
			case 'rotate': {
				const a = ((args[0] || 0) * Math.PI) / 180;
				const cos = Math.cos(a), sin = Math.sin(a);
				next = [cos, sin, -sin, cos, 0, 0];
				if (args.length >= 3) {
					next = mulMatrix([1, 0, 0, 1, args[1], args[2]], mulMatrix(next, [1, 0, 0, 1, -args[1], -args[2]]));
				}
				break;
			}
			case 'skewX': next = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0]; break;
			case 'skewY': next = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0]; break;
		}
		m = mulMatrix(m, next);
	}
	return m;
}

/** Convert parsed absolute segments through a matrix; returns new `d` string. */
function transformSegments(d, m) {
	const out = [];
	for (const seg of parseSegments(d)) {
		const [cmd, ...args] = seg;
		if (cmd === 'Z') { out.push('Z'); continue; }
		const pts = [];
		for (let i = 0; i < args.length; i += 2) {
			const [x, y] = applyMatrix(m, args[i], args[i + 1]);
			pts.push(round(x), round(y));
		}
		out.push(cmd + ' ' + pts.join(' '));
	}
	return out.join(' ');
}

const round = (v) => Math.round(v * 100) / 100;

function transformBoundingBox(bbox, m) {
	const corners = [[bbox.x, bbox.y], [bbox.x + bbox.w, bbox.y], [bbox.x, bbox.y + bbox.h], [bbox.x + bbox.w, bbox.y + bbox.h]]
		.map(([x, y]) => applyMatrix(m, x, y));
	const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
	return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/* ---------------- parsing ---------------- */

function attr(tag, name) {
	const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag) || new RegExp(`(?:^|\\s)${name}\\s*=\\s*'([^']*)'`, 'i').exec(tag);
	return m ? m[1] : undefined;
}

function segsBounds(d) {
	let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
	for (const seg of parseSegments(d)) {
		const [cmd, ...args] = seg;
		if (cmd === 'Z') continue;
		for (let i = 0; i < args.length; i += 2) {
			if (args[i] < minX) minX = args[i];
			if (args[i] > maxX) maxX = args[i];
			if (args[i + 1] < minY) minY = args[i + 1];
			if (args[i + 1] > maxY) maxY = args[i + 1];
		}
	}
	if (!isFinite(minX)) return { x: 0, y: 0, w: 100, h: 100 };
	return { x: minX, y: minY, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) };
}

/**
 * Parse an SVG document into dcDoc vector layers.
 * Returns { width, height, layers: [...vector layers...], warnings: [] }.
 */
export function parseSvg(svgText) {
	const warnings = [];
	const text = String(svgText || '');
	const svgTag = /<svg[^>]*>/i.exec(text)?.[0] || '';
	let width = parseFloat(attr(svgTag, 'width')) || 0;
	let height = parseFloat(attr(svgTag, 'height')) || 0;
	const viewBox = (attr(svgTag, 'viewBox') || '').split(/[\s,]+/).map(Number);
	if ((!width || !height) && viewBox.length === 4) { width = viewBox[2]; height = viewBox[3]; }
	if (!width) width = 1280;
	if (!height) height = 720;

	const layers = [];
	const styleOf = (tag, inherited) => {
		const fill = attr(tag, 'fill') ?? inherited.fill;
		const stroke = attr(tag, 'stroke') ?? inherited.stroke;
		const strokeWidth = parseFloat(attr(tag, 'stroke-width') ?? attr(tag, 'strokeWidth')) || inherited.strokeWidth;
		const opacity = inherited.opacity;
		const dash = (attr(tag, 'stroke-dasharray') || attr(tag, 'strokeDasharray'));
		return {
			fill: fill === 'none' ? null : (fill || inherited.fill),
			stroke: stroke === 'none' ? null : (stroke || inherited.stroke),
			strokeWidth: strokeWidth || 1,
			opacity: opacity == null ? inherited.opacity : opacity,
			dash: dash && dash !== 'none' ? dash.split(/[\s,]+/).map(Number).filter(n => n > 0) : null
		};
	};

	const addShape = (tag, m, inherited, geometryD) => {
		const style = styleOf(tag, inherited);
		const bounds = segsBounds(geometryD);
		if (!style.fill && !style.stroke) return;
		layers.push({
			id: 'vec' + layers.length + '-' + Math.random().toString(36).slice(2, 6),
			type: 'vector', name: '矢量 ' + (layers.length + 1),
			x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h,
			opacity: style.opacity,
			paths: [{
				d: geometryD,
				fill: style.fill || null,
				stroke: style.stroke ? { color: style.stroke, width: style.strokeWidth, ...(style.dash ? { dash: style.dash } : {}) } : null
			}]
		});
	};

	const walk = (chunk, inherited) => {
		const re = /<(\/?)(rect|circle|ellipse|line|polyline|polygon|path|g|svg|defs|style|text|use|image)\b([^>]*)>/gi;
		let match;
		while ((match = re.exec(chunk))) {
			const closing = match[1] === '/';
			const name = match[2].toLowerCase();
			const tag = match[3];
			if (closing) continue;
			if (['defs', 'style', 'text', 'use', 'image'].includes(name)) {
				if (name === 'text') warnings.push('SVG 文本未转换为矢量（建议先转曲）');
				continue;
			}
			const m = parseTransform(attr(tag, 'transform'));
			const localInherited = {
				...inherited,
				fill: attr(tag, 'fill') ?? inherited.fill,
				stroke: attr(tag, 'stroke') ?? inherited.stroke,
				strokeWidth: parseFloat(attr(tag, 'stroke-width')) || inherited.strokeWidth,
				opacity: (Number.isFinite(parseFloat(attr(tag,'opacity'))) ? Math.max(0,Math.min(1,parseFloat(attr(tag,'opacity')))) : 1) * inherited.opacity
			};
			if (name === 'g') {
				// find matching close and recurse on inner content
				const start = re.lastIndex;
				let depth = 1; let idx = start; let inner = '';
				const gRe = /<(\/?)g\b[^>]*>/gi;
				gRe.lastIndex = start;
				let gm;
				while ((gm = gRe.exec(chunk))) {
					if (gm[1] === '/') depth--; else depth++;
					if (depth === 0) { inner = chunk.slice(start, gm.index); idx = gRe.lastIndex; break; }
				}
				if (inner) walk(inner, { ...localInherited, __m: mulMatrix(inherited.__m || IDENT, m) });
				else walk('', inherited);
				re.lastIndex = idx || start;
				continue;
			}
			let d = '';
			let localMatrix = mulMatrix(inherited.__m || IDENT, m);
			const toD = (d0) => transformSegments(d0, localMatrix);
			if (name === 'path') {
				d = toD(attr(tag, 'd') || '');
				addShape(tag, m, localInherited, d);
			} else if (name === 'rect') {
				const x = parseFloat(attr(tag, 'x')) || 0, y = parseFloat(attr(tag, 'y')) || 0;
				const w = parseFloat(attr(tag, 'width')) || 0, h = parseFloat(attr(tag, 'height')) || 0;
				if (!w || !h) continue;
				d = toD(`M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`);
				addShape(tag, m, localInherited, d);
			} else if (name === 'circle' || name === 'ellipse') {
				const cx = parseFloat(attr(tag, 'cx')) || 0, cy = parseFloat(attr(tag, 'cy')) || 0;
				const rx = parseFloat(attr(tag, 'r') ?? attr(tag, 'rx')) || 0;
				const ry = parseFloat(attr(tag, 'r') ?? attr(tag, 'ry')) || 0;
				if (!rx || !ry) continue;
				d = toD(`M ${cx - rx} ${cy} C ${cx - rx} ${cy - ry * 0.5523} ${cx - rx * 0.5523} ${cy - ry} ${cx} ${cy - ry} C ${cx + rx * 0.5523} ${cy - ry} ${cx + rx} ${cy - ry * 0.5523} ${cx + rx} ${cy} C ${cx + rx} ${cy + ry * 0.5523} ${cx + rx * 0.5523} ${cy + ry} ${cx} ${cy + ry} C ${cx - rx * 0.5523} ${cy + ry} ${cx - rx} ${cy + ry * 0.5523} ${cx - rx} ${cy} Z`);
				addShape(tag, m, localInherited, d);
			} else if (name === 'line') {
				const x1 = parseFloat(attr(tag, 'x1')) || 0, y1 = parseFloat(attr(tag, 'y1')) || 0;
				const x2 = parseFloat(attr(tag, 'x2')) || 0, y2 = parseFloat(attr(tag, 'y2')) || 0;
				d = toD(`M ${x1} ${y1} L ${x2} ${y2}`);
				addShape(tag, m, localInherited, d);
			} else if (name === 'polyline' || name === 'polygon') {
				const nums = (attr(tag, 'points') || '').split(/[\s,]+/).filter(Boolean).map(Number);
				const pts = [];
				for (let i = 0; i + 1 < nums.length; i += 2) pts.push(nums[i], nums[i + 1]);
				if (pts.length < 4) continue;
				d = toD('M ' + pts.slice(0, 2).join(' ') + ' L ' + pts.slice(2).join(' ') + (name === 'polygon' ? ' Z' : ''));
				addShape(tag, m, localInherited, d);
			}
		}
	};

	walk(text, { fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1, __m: IDENT });
	return { width, height, layers, warnings };
}

/* ---------------- serialization ---------------- */

function colorStr(c) {
	if (typeof c === 'string') return c;
	if (c && typeof c === 'object') return c.color || '#000000';
	return '#000000';
}

function paintToSvgAttrs(paint, opacity = 1) {
	if (!paint || paint === 'none') return { attrs: ' fill="none"', defs: '' };
	if (typeof paint === 'string') return { attrs: ` fill="${paint}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}`, defs: '' };
	if (paint.kind === 'linear') {
		const stops = (paint.stops || []).map(([off, col]) => `<stop offset="${off}" stop-color="${colorStr(col)}"/>`).join('');
		const id = 'grad' + Math.random().toString(36).slice(2, 8);
		return {
			attrs: ` fill="url(#${id})"`,
			defs: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="1" y2="0" gradientTransform="rotate(${Number(paint.angle) || 0} .5 .5)">${stops}</linearGradient>`
		};
	}
	if (paint.kind === 'solid') return { attrs: ` fill="${colorStr(paint.color)}"${(paint.opacity ?? 1) < 1 ? ` fill-opacity="${paint.opacity}"` : ''}`, defs: '' };
	return { attrs: ' fill="none"', defs: '' };
}

/** Serialize one dcDoc page to an SVG string. assetHref(assetName) → href value (data URL or relative path). */
export function pageToSvg(page, doc, assetHref) {
	const w = doc.canvas?.width || 1280, h = doc.canvas?.height || 720;
	const defs = [];
	const body = [];
	const bg = page.background;
	const bgColor = typeof bg === 'string' ? bg : bg?.kind === 'solid' ? bg.color : (bg?.kind === 'linear' || bg?.kind === 'gradient' ? bg.stops?.[0]?.[1] : null);
	if (bgColor) body.push(`<rect width="${w}" height="${h}" fill="${bgColor}"/>`);

	const emit = (layers) => {
		for (const layer of layers || []) {
			if (layer.hidden || layer.visible === false) continue;
			if (layer.type === 'group') { emit(layer.children); continue; }
			if (layer.type === 'adjustment') continue;
			const tf = [];
			if (layer.rotation) tf.push(`rotate(${layer.rotation} ${(layer.x || 0) + (layer.w ?? 0) / 2} ${(layer.y || 0) + (layer.h ?? 0) / 2})`);
			if (layer.transform?.flipH || layer.transform?.flipV) {
				const cx = (layer.x || 0) + (layer.w ?? 0) / 2, cy = (layer.y || 0) + (layer.h ?? 0) / 2;
				tf.push(`translate(${cx} ${cy}) scale(${layer.transform?.flipH ? -1 : 1} ${layer.transform?.flipV ? -1 : 1}) translate(${-cx} ${-cy})`);
			}
			const transform = tf.length ? ` transform="${tf.join(' ')}"` : '';
			const opacity = layer.opacity != null && layer.opacity !== 1 ? ` opacity="${layer.opacity}"` : '';
			if (layer.type === 'image') {
				const src = layer.asset?.src || layer.asset;
				const href = assetHref ? assetHref(src) : (src || '');
				body.push(`<image x="${layer.x || 0}" y="${layer.y || 0}" width="${layer.w ?? 100}" height="${layer.h ?? 100}" href="${href}" preserveAspectRatio="none"${opacity}${transform}/>`);
			} else if (layer.type === 'text') {
				const lines = String(layer.text ?? '').split(/\r?\n/);
				const size = layer.fontSize || 24;
				const anchor = ({ left: 'start', center: 'middle', right: 'end' })[layer.align] || 'start';
				const lh = size * (layer.lineHeight || 1.4);
				const tspans = lines.map((line, i) => `<tspan x="${layer.x || 0}" y="${(layer.y || 0) + size + i * lh}">${escapeXml(line)}</tspan>`).join('');
				body.push(`<text font-family="${escapeXml(layer.fontFamily || 'sans-serif')}" font-size="${size}"${layer.bold ? ' font-weight="bold"' : ''}${layer.italic ? ' font-style="italic"' : ''} fill="${layer.color || '#202936'}" text-anchor="${anchor}"${opacity}${transform}>${tspans}</text>`);
			} else if (layer.type === 'vector') {
				for (const p of layer.paths || []) {
					const fillP = paintToSvgAttrs(p.fill, 1);
					if (fillP.defs) defs.push(fillP.defs);
					const strokeP = p.stroke
						? ` stroke="${colorStr(p.stroke)}" stroke-width="${p.stroke?.width ?? 1}"${p.stroke?.dash ? ' stroke-dasharray="' + p.stroke.dash.join(' ') + '"' : ''}`
						: ' stroke="none"';
					body.push(`<path d="${p.d}"${fillP.attrs}${strokeP} fill-rule="${p.fillRule || 'nonzero'}"${opacity}${transform}/>`);
				}
			} else if (layer.type === 'shape') {
				const fillP = paintToSvgAttrs(layer.fill ?? '#287D6C', layer.opacity ?? 1);
				if (fillP.defs) defs.push(fillP.defs);
				const stroke = layer.stroke && layer.stroke !== 'none' ? ` stroke="${colorStr(layer.stroke.color || layer.stroke)}" stroke-width="${layer.stroke?.width ?? 2}"` : '';
				const kind = String(layer.shape || 'rect').toLowerCase();
				const x = layer.x || 0, y = layer.y || 0, lw = layer.w ?? 100, lh = layer.h ?? 100;
				let el;
				if (kind === 'ellipse' || kind === 'circle') el = `<ellipse cx="${x + lw / 2}" cy="${y + lh / 2}" rx="${lw / 2}" ry="${lh / 2}"${fillP.attrs}${stroke}/>`;
				else if (kind === 'line') el = `<line x1="${x}" y1="${y}" x2="${x + lw}" y2="${y + lh}"${stroke}/>`;
				else if (kind === 'roundrect') el = `<rect x="${x}" y="${y}" width="${lw}" height="${lh}" rx="${Math.min(lw, lh) * (layer.radius ?? 0.15)}"${fillP.attrs}${stroke}/>`;
				else el = `<rect x="${x}" y="${y}" width="${lw}" height="${lh}"${fillP.attrs}${stroke}/>`;
				body.push(el + (fillP.defs ? '' : ''));
			}
		}
	};
	emit(page.layers || []);
	return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs.length ? '<defs>' + defs.join('') + '</defs>' : ''}${body.join('')}</svg>`;
}

function escapeXml(s) {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
