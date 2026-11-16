import {transformPathData,pathBounds,vectorMatrix} from './path.js';
export {transformPathData} from './path.js';
/** DesignCraft client SVG tools — DOMParser import + serializer for vector layers. */

/** Parse SVG text into vector layers (client-side, DOMParser-based). */
export function parseSvgClient(svgText) {
	const warnings = [];
	const doc = new DOMParser().parseFromString(String(svgText || ''), 'image/svg+xml');
	const svg = doc.querySelector('svg');
	if (!svg || doc.querySelector('parsererror')) return { width: 1280, height: 720, layers: [], warnings: ['无法解析 SVG'] };
	let width = parseFloat(svg.getAttribute('width')) || 0;
	let height = parseFloat(svg.getAttribute('height')) || 0;
	const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
	if ((!width || !height) && viewBox.length === 4) { width = viewBox[2]; height = viewBox[3]; }
	if (!width) width = 1280;
	if (!height) height = 720;

	const layers = [];
	const inherited = { fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1 };

	const styleOf = (el, inh) => {
		const fillA = el.getAttribute('fill');
		const strokeA = el.getAttribute('stroke');
		const sw = parseFloat(el.getAttribute('stroke-width'));
		const op = parseFloat(el.getAttribute('opacity'));
		const dash = el.getAttribute('stroke-dasharray');
		return {
			fill: fillA === 'none' ? null : (fillA ?? inh.fill),
			stroke: strokeA === 'none' ? null : (strokeA ?? inh.stroke),
			strokeWidth: isFinite(sw) && sw > 0 ? sw : inh.strokeWidth,
			opacity: isFinite(op) ? op * inh.opacity : inh.opacity,
			dash: dash && dash !== 'none' ? dash.split(/[\s,]+/).map(Number).filter(n => n > 0) : inh.dash || null
		};
	};

	const addVector = (d, style) => {
		if (!d) return;
		const b = pathBounds(d);
		layers.push({
			id: 'vec_' + Math.random().toString(36).slice(2, 8),
			type: 'vector', name: '矢量 ' + (layers.length + 1),
			x: b.x, y: b.y, w: b.w, h: b.h, geometryBox:{...b},
			rotation: 0, opacity: style.opacity, blend: 'normal',
			paths: [{
				d,
				fill: style.fill || null,
				stroke: style.stroke ? { color: style.stroke, width: style.strokeWidth, ...(style.dash ? { dash: style.dash } : {}) } : null
			}]
		});
	};

	const walk = (parent, inh, matrix) => {
		for (const el of parent.children || []) {
			const tag = el.tagName.toLowerCase();
			if (['defs', 'style', 'text', 'tspan', 'title', 'desc', 'use', 'image', 'clippath', 'mask'].includes(tag)) {
				if (tag === 'text') warnings.push('SVG 文本未转换（建议先转曲）');
				continue;
			}
			const m = mul(matrix, transformOf(el));
			const style = styleOf(el, inh);
			const localInh = { ...style, opacity: style.opacity };
			if (tag === 'g') { walk(el, localInh, m); continue; }
			let d = '';
			if (tag === 'path') d = el.getAttribute('d');
			else if (tag === 'rect') {
				const x = num(el.getAttribute('x')), y = num(el.getAttribute('y'));
				const w = num(el.getAttribute('width')), h = num(el.getAttribute('height'));
				if (!w || !h) continue;
				d = `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
			} else if (tag === 'circle' || tag === 'ellipse') {
				const cx = num(el.getAttribute('cx')), cy = num(el.getAttribute('cy'));
				const rx = num(tag === 'circle' ? el.getAttribute('r') : el.getAttribute('rx'));
				const ry = num(tag === 'circle' ? el.getAttribute('r') : el.getAttribute('ry'));
				if (!rx || !ry) continue;
				d = `M ${cx - rx} ${cy} C ${cx - rx} ${cy - ry * 0.5523} ${cx - rx * 0.5523} ${cy - ry} ${cx} ${cy - ry} C ${cx + rx * 0.5523} ${cy - ry} ${cx + rx} ${cy - ry * 0.5523} ${cx + rx} ${cy} C ${cx + rx} ${cy + ry * 0.5523} ${cx + rx * 0.5523} ${cy + ry} ${cx} ${cy + ry} C ${cx - rx * 0.5523} ${cy + ry} ${cx - rx} ${cy + ry * 0.5523} ${cx - rx} ${cy} Z`;
			} else if (tag === 'line') {
				d = `M ${num(el.getAttribute('x1'))} ${num(el.getAttribute('y1'))} L ${num(el.getAttribute('x2'))} ${num(el.getAttribute('y2'))}`;
			} else if (tag === 'polyline' || tag === 'polygon') {
				const nums = (el.getAttribute('points') || '').split(/[\s,]+/).filter(Boolean).map(Number);
				if (nums.length < 4) continue;
				d = 'M ' + nums.slice(0, 2).join(' ') + ' L ' + nums.slice(2).join(' ') + (tag === 'polygon' ? ' Z' : '');
			}
			if (d) {
				d = transformPathData(d, m);
				addVector(d, style);
			}
		}
	};

	walk(svg, inherited, [1, 0, 0, 1, 0, 0]);
	return { width, height, layers, warnings };
}

const num = (v) => parseFloat(v) || 0;

function transformOf(el) {
	const t = el.getAttribute('transform');
	if (!t) return [1, 0, 0, 1, 0, 0];
	let m = [1, 0, 0, 1, 0, 0];
	const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
	let match;
	while ((match = re.exec(t))) {
		const a = match[2].split(/[\s,]+/).filter(Boolean).map(Number);
		let next = [1, 0, 0, 1, 0, 0];
		if (match[1] === 'matrix') next = a.slice(0, 6);
		else if (match[1] === 'translate') next = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
		else if (match[1] === 'scale') next = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
		else if (match[1] === 'rotate') {
			const rad = ((a[0] || 0) * Math.PI) / 180;
			const c = Math.cos(rad), s = Math.sin(rad);
			next = [c, s, -s, c, 0, 0];
			if (a.length >= 3) next = mul(mul([1, 0, 0, 1, a[1], a[2]], next), [1, 0, 0, 1, -a[1], -a[2]]);
		} else if (match[1] === 'skewX') next = [1, 0, Math.tan(((a[0] || 0) * Math.PI) / 180), 1, 0, 0];
		else if (match[1] === 'skewY') next = [1, Math.tan(((a[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
		m = mul(m, next);
	}
	return m;
}

function mul(a, b) {
	return [
		a[0] * b[0] + a[2] * b[2], a[1] * b[0] + a[3] * b[2],
		a[0] * b[1] + a[2] * b[3], a[1] * b[1] + a[3] * b[3],
		a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]
	];
}

function applyM(m, x, y) {
	return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}


const colorStr = (c) => typeof c === 'string' ? c : (c?.color || '#000000');

function paintAttrs(paint) {
	if (!paint || paint === 'none') return ' fill="none"';
	if (typeof paint === 'string') return ` fill="${paint}"`;
	if (paint.kind === 'solid') return ` fill="${colorStr(paint.color)}"`;
	if (paint.kind === 'linear') return ` fill="url(#g${Math.abs(hash(String(paint.stops)))})"`;
	return ' fill="none"';
}

const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

/** Serialize one page to SVG (client-side export). assetHref(src) → href. */
export function pageToSvgClient(page, doc, assetHref) {
	const W = doc.canvas.width, H = doc.canvas.height;
	const defs = [];
	const body = [];
	const bg = page.background;
	const bgColor = typeof bg === 'string' ? bg : bg?.kind === 'solid' ? bg.color : (bg?.kind === 'linear' ? (bg.stops?.[0]?.[1] || null) : null);
	if (bgColor) body.push(`<rect width="${W}" height="${H}" fill="${bgColor}"/>`);
	if (bg?.kind === 'linear' && bg.stops) {
		const id = 'bggrad';
		defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${bg.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${colorStr(c)}"/>`).join('')}</linearGradient>`);
		body.length = body.length ? body.length : body.push(`<rect width="${W}" height="${H}" fill="url(#${id})"/>`) && body.length;
		body.pop();
		body.push(`<rect width="${W}" height="${H}" fill="url(#${id})"/>`);
	}
	const emit = (layers) => {
		for (const layer of layers || []) {
			if (layer.hidden) continue;
			if (layer.type === 'group') { emit(layer.children); continue; }
			if (layer.type === 'adjustment') continue;
			const op = layer.opacity != null && layer.opacity !== 1 ? ` opacity="${layer.opacity}"` : '';
			if (layer.type === 'image') {
				const src = typeof layer.asset === 'string' ? layer.asset : layer.asset?.src;
				body.push(`<image x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" href="${assetHref ? assetHref(src) : src}" preserveAspectRatio="none"${op}/>`);
			} else if (layer.type === 'text') {
				const size = layer.fontSize || 24;
				const lh = size * (layer.lineHeight || 1.4);
				const anchor = { left: 'start', center: 'middle', right: 'end' }[layer.align] || 'start';
				const lines = String(layer.text || '').split(/\r?\n/);
				const tspans = lines.map((line, i) => `<tspan x="${layer.x}" y="${layer.y + size + i * lh}">${escapeXml(line)}</tspan>`).join('');
				body.push(`<text font-family="${escapeXml(layer.fontFamily || 'sans-serif')}" font-size="${size}"${layer.bold ? ' font-weight="600"' : ''}${layer.italic ? ' font-style="italic"' : ''} fill="${layer.color || '#202936'}" text-anchor="${anchor}"${op}>${tspans}</text>`);
			} else if (layer.type === 'vector') {
				for (const p of layer.paths || []) {
					const stroke = p.stroke ? ` stroke="${colorStr(p.stroke)}" stroke-width="${p.stroke.width ?? 1}"${p.stroke.dash ? ` stroke-dasharray="${p.stroke.dash.join(' ')}"` : ''}` : ' stroke="none"';
					if (p.fill && typeof p.fill === 'object' && p.fill.kind === 'linear') {
						const id = 'g' + Math.abs(hash(JSON.stringify(p.fill.stops)));
						if (!defs.some(d => d.includes(`id="${id}"`))) {
							defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${layer.x}" y1="${layer.y}" x2="${layer.x + layer.w}" y2="${layer.y + layer.h}">${(p.fill.stops || []).map(([o, c]) => `<stop offset="${o}" stop-color="${colorStr(c)}"/>`).join('')}</linearGradient>`);
						}
						body.push(`<path transform="matrix(${vectorMatrix(layer).join(' ')})" d="${escapeXml(p.d)}" fill="url(#${id})"${stroke} fill-rule="${p.fillRule || 'nonzero'}"${op}/>`);
					} else {
						body.push(`<path transform="matrix(${vectorMatrix(layer).join(' ')})" d="${escapeXml(p.d)}"${paintAttrs(p.fill)}${stroke} fill-rule="${p.fillRule || 'nonzero'}"${op}/>`);
					}
				}
			} else if (layer.type === 'shape') {
				const kind = String(layer.shape || 'rect').toLowerCase();
				const fill = paintAttrs(layer.fill == null ? '#287D6C' : layer.fill);
				const stroke = layer.stroke && layer.stroke !== 'none' ? ` stroke="${colorStr(layer.stroke.color || layer.stroke)}" stroke-width="${layer.stroke.width ?? 2}"` : '';
				if (kind === 'ellipse' || kind === 'circle') body.push(`<ellipse cx="${layer.x + layer.w / 2}" cy="${layer.y + layer.h / 2}" rx="${layer.w / 2}" ry="${layer.h / 2}"${fill}${stroke}${op}/>`);
				else if (kind === 'line') body.push(`<line x1="${layer.x}" y1="${layer.y}" x2="${layer.x + layer.w}" y2="${layer.y + layer.h}"${stroke}/>`);
				else if (kind === 'roundrect') body.push(`<rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" rx="${Math.min(layer.w, layer.h) * (layer.radius ?? 0.15)}"${fill}${stroke}${op}/>`);
				else body.push(`<rect x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}"${fill}${stroke}${op}/>`);
			}
		}
	};
	emit(page.layers);
	return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs.length ? '<defs>' + defs.join('') + '</defs>' : ''}${body.join('')}</svg>`;
}

function escapeXml(s) {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
