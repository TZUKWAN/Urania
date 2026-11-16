/**
 * DesignCraft PSD importer (PhotoCraft interop) — parses layered Photoshop files:
 * 8-bit RGB PSD (PSB unsupported), raw & PackBits RLE channel data, layer groups,
 * blend modes, opacity, visibility, offsets. Pure JS, zero dependencies.
 * Returns dcDoc layer JSON ready for a canvas/photo document.
 */
import { inflateSync } from 'node:zlib';
import { crc32 } from './zip.js';
import { createImage } from './raster.js';

export class PsdError extends Error {
	constructor(message, status = 422) {
		super(message);
		this.status = status;
	}
}

const BLEND_MAP = {
	norm: 'normal', diss: 'normal', dark: 'darken', mulu: 'multiply', lite: 'lighten', scrn: 'screen',
	over: 'overlay', hLit: 'hard-light', sLit: 'soft-light', diff: 'difference', excl: 'exclusion',
	'hue ': 'hue', 'sat ': 'saturation', colr: 'color', 'lum ': 'luminosity',
	'div ': 'normal', 'dkCl': 'darken', 'add ': 'normal', 'lbrn': 'normal', pass: 'normal'
};

class Reader {
	constructor(buf, pos = 0) {
		this.buf = buf;
		this.pos = pos;
	}
	u8() { return this.buf[this.pos++]; }
	u16() { const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }
	s16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }
	u32() { const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }
	s32() { const v = this.buf.readInt32BE(this.pos); this.pos += 4; return v; }
	read(n) { const s = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return s; }
	skip(n) { this.pos += n; }
	eof() { return this.pos >= this.buf.length; }
}

function unpackBits(src, expected) {
	const out = Buffer.alloc(expected);
	let o = 0, i = 0;
	while (o < expected && i < src.length) {
		const n = src.readInt8(i++);
		if (n >= 0) {
			const count = n + 1;
			src.copy(out, o, i, i + count);
			i += count;
			o += count;
		} else if (n !== -128) {
			const count = 1 - n;
			out.fill(src[i++], o, o + count);
			o += count;
		}
	}
	return out;
}

/** Parse a PSD buffer → { width, height, layers, composite } (imageData objects). */
export function parsePSD(buffer) {
	const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
	if (buf.length < 26 || buf.toString('latin1', 0, 4) !== '8BPS') throw new PsdError('不是 PSD 文件');
	const r = new Reader(buf);
	r.skip(4); // signature '8BPS' (already verified above)
	if (r.u16() !== 1) throw new PsdError('仅支持 PSD（不支持 PSB 大文件格式）');
	r.skip(6); // reserved
	const channels = r.u16();
	const height = r.u32();
	const width = r.u32();
	const depth = r.u16();
	const colorMode = r.u16();
	if (depth !== 8) throw new PsdError('仅支持 8-bit PSD（当前 ' + depth + '-bit）');
	if (colorMode !== 3) throw new PsdError('仅支持 RGB 模式 PSD（当前模式 ' + colorMode + '）');
	if (width * height > 24 * 1024 * 1024) throw new PsdError('PSD 尺寸过大（>24MP）');

	// Color mode data
	const cmLen = r.u32();
	r.skip(cmLen);
	// Image resources
	const irLen = r.u32();
	r.skip(irLen);
	// Layer and mask information
	const lmiLen = r.u32();
	const lmiEnd = r.pos + lmiLen;
	let layerRecords = [];
	if (lmiLen > 0) {
		const layerInfoLen = r.u32();
		if (layerInfoLen > 0) {
			const layerInfoEnd = r.pos + layerInfoLen;
			let count = r.s16();
			const hasAlpha = count < 0;
			count = Math.abs(count);
			const records = [];
			for (let i = 0; i < count; i++) {
				records.push(readLayerRecord(r));
			}
			// channel image data follows, in the same order
			for (const rec of records) {
				for (const ch of rec.channels) {
					const compression = r.u16();
					const rows = rec.bottom - rec.top;
					const cols = rec.right - rec.left;
					const bytesPerRow = cols * (depth / 8);
					if (compression === 0) {
						ch.data = Buffer.from(r.read(bytesPerRow * rows));
					} else if (compression === 1) {
						const rowLens = [];
						for (let y = 0; y < rows; y++) rowLens.push(r.u16());
						const parts = [];
						for (const len of rowLens) {
							parts.push(unpackBits(Buffer.from(r.read(len)), bytesPerRow));
						}
						ch.data = Buffer.concat(parts);
					} else if (compression === 2) {
						// ZIP without prediction (rare) — try inflate
						const len = r.u32?.() ?? 0;
						try { ch.data = inflateSync(Buffer.from(r.read(len))); } catch { ch.data = null; }
					} else {
						ch.data = null;
						throw new PsdError('不支持的通道压缩方式: ' + compression);
					}
				}
			}
			layerRecords = records;
			r.pos = layerInfoEnd;
		}
	}
	r.pos = lmiEnd;

	// merged image data (composite) — NOTE: RLE row lengths are ALL channels' rows listed together
	let composite = null;
	try {
		if (!r.eof()) {
			const compression = r.u16();
			const bytesPerRow = width * (depth / 8);
			const channelRows = [];
			if (compression === 0) {
				for (let c = 0; c < Math.min(channels, 4); c++) channelRows.push(Buffer.from(r.read(bytesPerRow * height)));
			} else if (compression === 1) {
				const nCh = Math.min(channels, 4);
				const rowLens = [];
				for (let i = 0; i < nCh * height; i++) rowLens.push(r.u16());
				let idx = 0;
				for (let c = 0; c < nCh; c++) {
					const parts = [];
					for (let y = 0; y < height; y++) {
						parts.push(unpackBits(Buffer.from(r.read(rowLens[idx++])), bytesPerRow));
					}
					channelRows.push(Buffer.concat(parts));
				}
			}
			if (channelRows.length >= 3) {
				const img = createImage(width, height, [0, 0, 0, 255]);
				for (let y = 0; y < height; y++) {
					for (let x = 0; x < width; x++) {
						const di = (y * width + x) * 4;
						const si = y * bytesPerRow + x;
						img.data[di] = channelRows[0][si];
						img.data[di + 1] = channelRows[1][si];
						img.data[di + 2] = channelRows[2][si];
						img.data[di + 3] = channelRows.length > 3 ? channelRows[3][si] : 255;
					}
				}
				composite = img;
			}
		}
	} catch { /* composite is best-effort */ }

	const layers = assembleLayers(layerRecords);
	return { width, height, layers, composite };
}

function readLayerRecord(r) {
	const rec = { top: r.s32(), left: r.s32(), bottom: r.s32(), right: r.s32() };
	const channelCount = r.u16();
	rec.channels = [];
	for (let i = 0; i < channelCount; i++) {
		const id = r.s16();
		const len = r.u32();
		rec.channels.push({ id, len });
	}
	const sig = r.read(4).toString('latin1');
	if (sig !== '8BIM') throw new PsdError('图层签名异常: ' + sig);
	const blendKey = r.read(4).toString('latin1');
	rec.blend = BLEND_MAP[blendKey] || 'normal';
	rec.blendKey = blendKey;
	rec.opacity = r.u8();
	r.u8(); // clipping
	const flags = r.u8();
	rec.hidden = (flags & 2) === 2;
	r.u8(); // filler
	const extraLen = r.u32();
	const extraEnd = r.pos + extraLen;
	const maskLen = r.u32();
	r.skip(maskLen);
	const rangesLen = r.u32();
	r.skip(rangesLen);
	// name: pascal string padded to 4
	const nameLen = r.u8();
	const nameBytes = Math.max(4, (1 + nameLen + 3) & ~3);
	rec.name = r.read(nameLen).toString('utf8');
	r.skip(nameBytes - 1 - nameLen);
	// additional layer info — look for 'lsct' (group marker) and 'luni' (unicode name)
	rec.groupType = null;
	rec.unicodeName = null;
	while (r.pos + 8 <= extraEnd) {
		const sig = r.read(4).toString('latin1');
		if (sig !== '8BIM') break;
		const key = r.read(4).toString('latin1');
		const len = r.u32();
		const dataStart = r.pos;
		if (key === 'lsct' && len >= 4) {
			rec.groupType = r.u32(); // 0=layer 1=open group 2=closed 3=section divider
		} else if (key === 'luni' && len >= 4) {
			const uLen = r.u32();
			rec.unicodeName = Buffer.from(r.read(Math.min(uLen * 2, len - 4))).swap16().toString('utf16le').replace(/\0+$/, '');
		}
		r.pos = dataStart + len;
		// blocks are padded to 2 bytes
		if ((len & 1) === 1 && r.pos < extraEnd) r.pos += 1;
	}
	r.pos = extraEnd;
	return rec;
}

/** Build a dcDoc layer tree. PSD order is top→bottom; doc order is bottom→top. */
function assembleLayers(records) {
	const result = [];
	// iterate in PSD order, building groups; then reverse for doc order
	const buildRange = (list, from, until) => {
		// returns { layers, nextIndex } — processes a group's children starting at `from`
		const out = [];
		let i = from;
		while (i < until) {
			const rec = list[i];
			if (rec.groupType === 3) { i++; continue; } // section divider consumed
			if (rec.groupType === 1 || rec.groupType === 2) {
				// group open/closed — children follow until a type-3 divider at this nesting level
				let j = i + 1;
				let depth = 1;
				while (j < until && depth > 0) {
					const t = list[j].groupType;
					if (t === 1 || t === 2) depth++;
					else if (t === 3) depth--;
					if (depth === 0) break;
					j++;
				}
				const children = buildRange(list, i + 1, j); // excludes the divider
				out.push({
					id: 'psdg_' + i, type: 'group', name: rec.unicodeName || rec.name || '组',
					hidden: rec.hidden, open: rec.groupType === 1, children
				});
				i = j + 1; // skip divider
			} else {
				out.push(layerFromRecord(rec, i));
				i++;
			}
		}
		return out;
	};
	const tree = buildRange(records, 0, records.length);
	// PSD lists top→bottom; doc wants bottom→top
	const flip = (layers) => { layers.reverse(); for (const l of layers) if (l.type === 'group') flip(l.children); return layers; };
	return flip(tree);
}

function layerFromRecord(rec, index) {
	const w = rec.right - rec.left;
	const h = rec.bottom - rec.top;
	const layer = {
		id: 'psd_' + index,
		type: 'image',
		name: rec.unicodeName || rec.name || ('图层 ' + (index + 1)),
		x: rec.left, y: rec.top,
		w: Math.max(1, w), h: Math.max(1, h),
		opacity: Math.round((rec.opacity / 255) * 100) / 100,
		blend: rec.blend,
		hidden: rec.hidden,
		rotation: 0
	};
	if (w > 0 && h > 0 && rec.channels.length) {
		const img = createImage(w, h, [0, 0, 0, 0]);
		const byId = new Map(rec.channels.map(c => [c.id, c]));
		const chR = byId.get(0), chG = byId.get(1), chB = byId.get(2), chA = byId.get(-1);
		const valid = [chR, chG, chB].every(c => c && c.data && c.data.length >= w * h);
		if (valid) {
			for (let i = 0; i < w * h; i++) {
				const di = i * 4;
				img.data[di] = chR.data[i];
				img.data[di + 1] = chG.data[i];
				img.data[di + 2] = chB.data[i];
				img.data[di + 3] = chA && chA.data && chA.data.length >= w * h ? chA.data[i] : 255;
			}
			layer.__pixels = img;
		} else {
			layer.__pixels = null; // empty/adjustment layer record
		}
	} else {
		layer.__pixels = null;
	}
	return layer;
}

/** Encode an RGBA image to PNG (reuse raster's encoder via dynamic import to avoid cycle). */
export async function imageToPng(image) {
	const { toPNG } = await import('./raster.js');
	return toPNG(image);
}
