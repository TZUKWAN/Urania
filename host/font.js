/**
 * DesignCraft TrueType/TTC font parser — enables CJK text in headless PDF export
 * by converting glyph outlines to PDF vector paths (text-to-outline, no font embedding needed).
 * Supports: TTC/TTF, cmap format 4 (BMP) & 12, simple + composite glyphs,
 * quadratic → cubic bezier conversion. Zero dependencies.
 */
import { existsSync, readFileSync } from 'node:fs';

const FONT_CANDIDATES = {
	regular: ['msyh.ttc', 'msyhl.ttc', 'simhei.ttf', 'simsun.ttc', 'Deng.ttf', 'Dengb.ttf'],
	bold: ['msyhbd.ttc', 'simhei.ttf', 'msyh.ttc', 'Dengb.ttf']
};

const cache = new Map(); // path → parsed font

function findFontPath(bold) {
	const list = bold ? FONT_CANDIDATES.bold : FONT_CANDIDATES.regular;
	for (const name of list) {
		const p = 'C:\\Windows\\Fonts\\' + name;
		if (existsSync(p)) return p;
	}
	return null;
}

class Reader {
	constructor(buf, offset = 0) {
		this.buf = buf;
		this.pos = offset;
	}
	u8() { return this.buf[this.pos++]; }
	u16() { const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
	s16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
	u32() { const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
	skip(n) { this.pos += n; }
}

/** Parse a TTF/TTC file → { upem, cmap, glyfTable, loca, indexToLocFormat, advance, numGlyphs } */
export function parseFontFile(path) {
	if (cache.has(path)) return cache.get(path);
	const buf = readFileSync(path);
	let base = 0;
	const r0 = new Reader(buf);
	if (r0.u32() === 0x74746366) { // 'ttcf'
		r0.u32(); // version
		const numFonts = r0.u32();
		if (numFonts < 1) throw new Error('empty TTC');
		base = r0.u32(); // first font offset (msyh.ttc[0] = 常规体)
	}
	const r = new Reader(buf, base);
	const sfnt = r.u32();
	if (sfnt !== 0x00010000 && sfnt !== 0x74727565 && sfnt !== 0x4F54544F) throw new Error('not a TrueType font: ' + path);
	const numTables = r.u16();
	r.skip(6);
	const tables = {};
	for (let i = 0; i < numTables; i++) {
		const tag = buf.toString('latin1', r.pos, r.pos + 4);
		r.skip(8); // tag(4, read via buf above) + checksum(4)
		const offset = r.u32();
		const length = r.u32();
		tables[tag] = { offset, length };
	}
	for (const need of ['head', 'cmap', 'loca', 'glyf', 'maxp', 'hhea', 'hmtx']) {
		if (!tables[need]) throw new Error('font missing table ' + need);
	}
	const head = tables.head;
	const rh = new Reader(buf, head.offset + 18);
	const upem = rh.u16();
	const indexToLocFormat = (() => { const rr = new Reader(buf, head.offset + 50); return rr.s16(); })();
	const numGlyphs = (() => { const rr = new Reader(buf, tables.maxp.offset + 4); return rr.u16(); })();
	const numberOfHMetrics = (() => { const rr = new Reader(buf, tables.hhea.offset + 34); return rr.u16(); })();

	// cmap: prefer format 12 then format 4
	const rc = new Reader(buf, tables.cmap.offset);
	rc.u16(); // version
	const numSub = rc.u16();
	let sub12 = null, sub4 = null;
	for (let i = 0; i < numSub; i++) {
		const platform = rc.u16(), encoding = rc.u16(), offset = rc.u32();
		const abs = tables.cmap.offset + offset;
		const fmt = buf.readUInt16BE(abs);
		if (fmt === 12) sub12 = abs;
		else if (fmt === 4 && !sub4) sub4 = abs;
	}
	const cmap = buildCmap(buf, sub4, sub12);

	// loca
	const loca = [];
	{
		const rl = new Reader(buf, tables.loca.offset);
		const count = numGlyphs + 1;
		if (indexToLocFormat === 0) for (let i = 0; i < count; i++) loca.push(rl.u16() * 2);
		else for (let i = 0; i < count; i++) loca.push(rl.u32());
	}

	// hmtx advances
	const adv = new Uint16Array(numGlyphs);
	{
		const rm = new Reader(buf, tables.hmtx.offset);
		let last = 0;
		for (let i = 0; i < numberOfHMetrics; i++) { last = rm.u16(); rm.s16(); adv[i] = last; }
		for (let i = numberOfHMetrics; i < numGlyphs; i++) adv[i] = last;
	}

	const font = { upem, cmap, loca, glyf: tables.glyf.offset, buf, numGlyphs, adv };
	cache.set(path, font);
	return font;
}

function buildCmap(buf, sub4, sub12) {
	const map = new Map();
	if (sub12) {
		const r = new Reader(buf, sub12);
		r.u16(); r.skip(2); r.u32(); // format, reserved, length
		r.u32(); // language
		const nGroups = r.u32();
		for (let g = 0; g < nGroups; g++) {
			const start = r.u32(), end = r.u32(), startGid = r.u32();
			if (end - start < 65536) {
				for (let c = start; c <= end; c++) map.set(c, startGid + (c - start));
			} else {
				// huge ranges (e.g. all-emoji) — store sparsely via function fallback
				map.set(-1 - start, { end, startGid }); // marker entries
			}
		}
	}
	if (sub4) {
		const r = new Reader(buf, sub4);
		const format = r.u16();
		if (format === 4) {
			r.u16(); r.u16(); r.u16();
			r.u16(); // language
			const segCountX2 = r.u16();
			const segCount = segCountX2 / 2;
			r.skip(6); // searchRange, entrySelector, rangeShift
			const endCodes = []; for (let i = 0; i < segCount; i++) endCodes.push(r.u16());
			r.u16(); // reservedPad
			const startCodes = []; for (let i = 0; i < segCount; i++) startCodes.push(r.u16());
			const idDeltas = []; for (let i = 0; i < segCount; i++) idDeltas.push(r.s16());
			const idRangeOffsets = []; const rangeBase = [];
			for (let i = 0; i < segCount; i++) { idRangeOffsets.push(r.u16()); rangeBase.push(r.pos); }
			for (let seg = 0; seg < segCount; seg++) {
				for (let c = startCodes[seg]; c <= endCodes[seg] && c !== 0x10000; c++) {
					if (map.has(c) && map.get(c) !== 0) continue; // format 12 wins
					let gid = 0;
					if (idRangeOffsets[seg] === 0) {
						gid = (c + idDeltas[seg]) & 0xFFFF;
					} else {
						const glyphAddr = rangeBase[seg] + (c - startCodes[seg]) * 2 + idRangeOffsets[seg] - 2;
						if (glyphAddr + 1 < buf.length) {
							const g = buf.readUInt16BE(glyphAddr);
							if (g !== 0) gid = (g + idDeltas[seg]) & 0xFFFF;
						}
					}
					if (gid) map.set(c, gid);
				}
			}
		}
	}
	return map;
}

function glyphId(font, code) {
	let gid = font.cmap.get(code);
	if (gid) return gid;
	// sparse range markers from format 12
	for (const [key, value] of font.cmap) {
		if (key < 0 && code >= (-1 - key) && code <= value.end) return value.startGid + (code - (-1 - key));
	}
	return 0;
}

/** Extract outline contours (font units) for a glyph, resolving composites. */
function glyphContours(font, gid, depth = 0) {
	if (!gid || gid >= font.numGlyphs || depth > 8) return [];
	const start = font.loca[gid], end = font.loca[gid + 1];
	if (end <= start) return [];
	const r = new Reader(font.buf, font.glyf + start);
	const numberOfContours = r.s16();
	if (numberOfContours >= 0) {
		r.skip(8); // xMin yMin xMax yMax
		const endPts = [];
		for (let i = 0; i < numberOfContours; i++) endPts.push(r.u16());
		const numPoints = endPts.length ? endPts[endPts.length - 1] + 1 : 0;
		const instrLen = r.u16();
		r.skip(instrLen);
		const flags = new Uint8Array(numPoints);
		for (let i = 0; i < numPoints; i++) {
			let f = r.u8();
			flags[i] = f;
			if (f & 8) { // repeat
				const repeat = r.u8();
				for (let k = 0; k < repeat; k++) flags[++i] = f;
			}
		}
		const xs = new Int32Array(numPoints);
		let x = 0;
		for (let i = 0; i < numPoints; i++) {
			const f = flags[i];
			if (f & 2) { const dx = r.u8(); x += (f & 16) ? dx : -dx; }
			else if (!(f & 16)) x += r.s16();
			xs[i] = x;
		}
		const ys = new Int32Array(numPoints);
		let y = 0;
		for (let i = 0; i < numPoints; i++) {
			const f = flags[i];
			if (f & 4) { const dy = r.u8(); y += (f & 32) ? dy : -dy; }
			else if (!(f & 32)) y += r.s16();
			ys[i] = y;
		}
		const contours = [];
		let startPt = 0;
		for (const endPt of endPts) {
			const pts = [];
			for (let i = startPt; i <= endPt; i++) pts.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) === 1 });
			if (pts.length) contours.push(pts);
			startPt = endPt + 1;
		}
		return contours;
	}
	// composite
	const contours = [];
	for (;;) {
		const flags = r.u16();
		const glyphIndex = r.u16();
		let dx = 0, dy = 0, a = 1, b = 0, c2 = 0, d = 1;
		const argWords = flags & 1;
		const xyValues = flags & 2;
		if (argWords) { dx = r.s16(); dy = xyValues ? r.s16() : 0; if (!xyValues) dx = dx; }
		else { dx = r.u8(); dy = r.u8(); if (!xyValues) { /* point matching — treat as offset */ } }
		if (xyValues) { /* dx,dy read above when argWords; else bytes */ }
		if (argWords && !xyValues) { /* ARGS are point numbers; treat as 0 offset */ dx = 0; dy = 0; }
		if (flags & 8) { a = d = r.s16() / 16384; }
		else if (flags & 64) { a = r.s16() / 16384; d = r.s16() / 16384; }
		else if (flags & 128) { a = r.s16() / 16384; b = r.s16() / 16384; c2 = r.s16() / 16384; d = r.s16() / 16384; }
		const sub = glyphContours(font, glyphIndex, depth + 1).map(contour =>
			contour.map(p => ({
				x: Math.round(dx + a * p.x + c2 * p.y),
				y: Math.round(dy + b * p.x + d * p.y),
				on: p.on
			}))
		);
		contours.push(...sub);
		if (!(flags & 32)) break;
	}
	return contours;
}

/** Quadratic contour → cubic PDF path ops at given scale. Returns { ops, advance } — coords are PDF-space (y-up), baseline at 0. */
function contourToPdfOps(font, text, fontSizePt, x0, y0) {
	const scale = fontSizePt / font.upem;
	const ops = [];
	let penX = x0;
	for (const ch of text) {
		const code = ch.codePointAt(0);
		const gid = glyphId(font, code);
		if (!gid) return { ops, advance: penX - x0, missing: ch };
		penX += drawGlyph(font, gid, ops, penX, y0, scale);
	}
	return { ops, advance: penX - x0, missing: null };
}

function drawGlyph(font, gid, ops, ox, oy, scale) {
	const contours = glyphContours(font, gid);
	for (const pts of contours) {
		if (pts.length < 2) continue;
		// normalize contour: ensure it starts at an on-curve point
		let start = pts.findIndex(p => p.on);
		if (start === -1) {
			const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2, on: true };
			pts.splice(1, 0, mid);
			start = 0;
		}
		const ring = pts.slice(start).concat(pts.slice(0, start));
		const n = ring.length;
		const P = (p) => `${(ox + p.x * scale).toFixed(2)} ${(oy + p.y * scale).toFixed(2)}`;
		const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true });
		ops.push(`${P(ring[0])} m`);
		let cur = ring[0];
		for (let i = 1; i <= n; i++) {
			const pt = ring[i % n];
			if (pt.on) {
				ops.push(`${P(pt)} l`);
				cur = pt;
			} else {
				const q1 = pt;
				let end;
				if (i + 1 <= n && ring[(i + 1) % n].on) { end = ring[(i + 1) % n]; i++; }
				else if (i + 1 <= n) { end = mid(q1, ring[(i + 1) % n]); i++; }
				else { end = ring[0]; }
				const c1x = cur.x + (2 / 3) * (q1.x - cur.x), c1y = cur.y + (2 / 3) * (q1.y - cur.y);
				const c2x = end.x + (2 / 3) * (q1.x - end.x), c2y = end.y + (2 / 3) * (q1.y - end.y);
				ops.push(`${(ox + c1x * scale).toFixed(2)} ${(oy + c1y * scale).toFixed(2)} ${(ox + c2x * scale).toFixed(2)} ${(oy + c2y * scale).toFixed(2)} ${P(end)} c`);
				cur = end;
			}
		}
		ops.push('h');
	}
	return (font.adv[gid] || font.upem / 2) * scale;
}

/**
 * Render a text line (multi-line via \n) as PDF fill paths.
 * Returns { ops: string[], warnings: string[], width } — caller wraps with fill color set.
 * dry:true skips emitting ops and only measures width (for alignment).
 */
export function textToPdfPaths(text, { x = 0, y = 0, fontSizePx, lineHeight = 1.4, bold = false, fontPath, align = 'left', dry = false } = {}) {
	const warnings = [];
	const path = fontPath || findFontPath(bold);
	if (!path) {
		warnings.push('未找到系统中文字体（尝试过 msyh/simhei/simsun/Deng）');
		return { ops: [], warnings, width: 0 };
	}
	let font;
	try { font = parseFontFile(path); } catch (error) {
		warnings.push('字体解析失败: ' + error.message);
		return { ops: [], warnings, width: 0 };
	}
	const sizePt = fontSizePx * 0.75;
	const lh = sizePt * lineHeight;
	const lines = String(text).split(/\r?\n/);
	const measure = (line) => {
		let w = 0;
		for (const ch of line) {
			const gid = glyphId(font, ch.codePointAt(0));
			w += (gid ? (font.adv[gid] || font.upem / 2) : 0) * sizePt / font.upem;
		}
		return w;
	};
	let maxW = 0;
	for (const line of lines) if (line.length) maxW = Math.max(maxW, measure(line));
	if (dry) return { ops: [], warnings, width: maxW };
	const ops = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.length) continue;
		let lx = x;
		if (align === 'center') lx = x - measure(line) / 2;
		else if (align === 'right') lx = x - measure(line);
		const result = contourToPdfOps(font, line, sizePt, lx, y - i * lh);
		ops.push(...result.ops);
		if (result.missing) warnings.push(`字形缺失: "${result.missing}" (U+${result.missing.codePointAt(0).toString(16)})`);
	}
	return { ops, warnings, width: maxW };
}

/** Check availability (used for diagnostics). */
export function fontStatus() {
	return {
		regular: findFontPath(false),
		bold: findFontPath(true)
	};
}
