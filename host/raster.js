/**
 * DesignCraft pixel engine (host-side, zero-dependency).
 * PNG decode/encode + adjustment LUTs + filters + compositing with blend modes.
 * Used by: image.op commands, PPTX/PDF export baking, asset processing.
 * All operations are pure functions over {width, height, data: Uint8ClampedArray} RGBA images.
 */
import { inflateSync } from 'node:zlib';
import { deflateSync } from 'node:zlib';
import { crc32 } from './zip.js';
import { assertImageSize } from './safety.js';

export const MAX_PIXELS = 24 * 1024 * 1024; // refuse >24MP to protect host memory

export function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

/* ---------------- PNG codec ---------------- */

export function fromPNG(buffer) {
	const u8 = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
	if (u8.length < 8 || !u8.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('not a PNG file');
	if (u8.length > 64 * 1024 * 1024) throw new Error('PNG input limit exceeded');
	let pos = 8;
	let width = 0, height = 0, bitDepth = 8, colorType = 6, interlace = 0;
	const palette = []; const trns = [];
	const idat = [];
	let seenHeader = false, seenEnd = false;
	while (pos + 8 <= u8.length) {
		const length = u8.readUInt32BE(pos);
		const type = u8.toString('ascii', pos + 4, pos + 8);
		const dataStart = pos + 8;
		if (length > u8.length - dataStart - 4) throw new Error('PNG chunk data truncated');
		if (crc32(u8.subarray(pos+4,dataStart+length)) !== u8.readUInt32BE(dataStart+length)) throw new Error('PNG chunk CRC mismatch');
		if (!seenHeader && type !== 'IHDR') throw new Error('PNG IHDR must be first');
		if (type === 'IHDR') {
			if (seenHeader || length !== 13) throw new Error('invalid PNG IHDR');
			seenHeader = true;
			width = u8.readUInt32BE(dataStart);
			height = u8.readUInt32BE(dataStart + 4);
			bitDepth = u8[dataStart + 8];
			colorType = u8[dataStart + 9];
			interlace = u8[dataStart + 12];
			assertImageSize(width,height);
		} else if (type === 'PLTE') {
			if (!length || length > 768 || length % 3) throw new Error('invalid PNG palette length');
			for (let i = 0; i < length; i += 3) palette.push([u8[dataStart + i], u8[dataStart + i + 1], u8[dataStart + i + 2]]);
		} else if (type === 'tRNS') {
			if (length > 256 || (colorType === 0 && length !== 2) || (colorType === 2 && length !== 6) || [4,6].includes(colorType)) throw new Error('invalid PNG transparency length');
			for (let i = 0; i < length; i++) trns.push(u8[dataStart + i]);
		} else if (type === 'IDAT') {
			idat.push(u8.subarray(dataStart, dataStart + length));
		} else if (type === 'IEND') { seenEnd=true; break; }
		pos = dataStart + length + 4; // skip CRC
	}
	if (!width || !height) throw new Error('PNG missing IHDR');
	if (!seenEnd || !idat.length) throw new Error('PNG missing image data or IEND');
	if (interlace) throw new Error('interlaced PNG not supported');
	if (bitDepth !== 8) throw new Error('PNG bit depth ' + bitDepth + ' not supported (8-bit only)');
	if (width * height > MAX_PIXELS) throw new Error('image too large: ' + width + 'x' + height);
	const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
	if (!channels) throw new Error('PNG color type ' + colorType + ' not supported');
	const stride = width * channels;
	const expected = (stride + 1) * height;
	const raw = inflateSync(Buffer.concat(idat),{maxOutputLength:expected});
	if (raw.length !== expected) throw new Error('PNG decompressed length does not match dimensions');
	const out = new Uint8ClampedArray(width * height * 4);
	const bpp = channels;
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		if (filter > 4) throw new Error('invalid PNG row filter');
		const row = y * (stride + 1) + 1;
		const prev = row - (stride + 1);
		for (let x = 0; x < stride; x++) {
			const i = row + x;
			const left = x >= bpp ? raw[i - bpp] : 0;
			const up = y > 0 ? raw[prev + x] : 0;
			const ul = (y > 0 && x >= bpp) ? raw[prev + x - bpp] : 0;
			let v = raw[i];
			if (filter === 1) v = (v + left) & 0xFF;
			else if (filter === 2) v = (v + up) & 0xFF;
			else if (filter === 3) v = (v + ((left + up) >> 1)) & 0xFF;
			else if (filter === 4) {
				const p = left + up - ul, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
				v = (v + (pa <= pb && pa <= pc ? left : pb <= pc ? up : ul)) & 0xFF;
			}
			raw[i] = v & 0xFF;
		}
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const si = y * (stride + 1) + 1 + x * channels;
			const di = (y * width + x) * 4;
			if (colorType === 6) { out[di] = raw[si]; out[di + 1] = raw[si + 1]; out[di + 2] = raw[si + 2]; out[di + 3] = raw[si + 3]; }
			else if (colorType === 2) { out[di] = raw[si]; out[di + 1] = raw[si + 1]; out[di + 2] = raw[si + 2]; out[di + 3] = trns.length === 6 && raw[si] === trns[0]*256+trns[1] && raw[si+1] === trns[2]*256+trns[3] && raw[si+2] === trns[4]*256+trns[5] ? 0 : 255; }
			else if (colorType === 0) { out[di] = out[di + 1] = out[di + 2] = raw[si]; out[di + 3] = trns.length === 2 && raw[si] === trns[0]*256+trns[1] ? 0 : 255; }
			else if (colorType === 4) { out[di] = out[di + 1] = out[di + 2] = raw[si]; out[di + 3] = raw[si + 1]; }
			else if (colorType === 3) {
				const c = palette[raw[si]];
				if (!c) throw new Error('PNG palette index out of range');
				out[di] = c[0]; out[di + 1] = c[1]; out[di + 2] = c[2];
				out[di + 3] = trns.length > raw[si] ? trns[raw[si]] : 255;
			}
		}
	}
	return { width, height, data: out };
}

function chunk(type, data) {
	const buf = Buffer.alloc(12 + data.length);
	buf.writeUInt32BE(data.length, 0);
	buf.write(type, 4, 'ascii');
	data.copy(buf, 8);
	buf.writeUInt32BE(crc32(buf.subarray(4, 8 + data.length)), 8 + data.length);
	return buf;
}

export function toPNG(image) {
	const { width, height, data } = image;
	assertImageSize(width,height);
	if (!ArrayBuffer.isView(data) || data.byteLength !== width*height*4) throw new Error('invalid RGBA image buffer');
	const stride = width * 4;
	const raw = Buffer.alloc((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (stride + 1)] = 0; // filter none
		Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 6 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

export function createImage(width, height, fill = [0, 0, 0, 0]) {
	assertImageSize(width,height);
	const data = new Uint8ClampedArray(width * height * 4);
	if (fill && (fill[3] !== 0 || fill[0] || fill[1] || fill[2])) {
		for (let i = 0; i < data.length; i += 4) { data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = fill[3] ?? 255; }
	}
	return { width, height, data };
}

export function cloneImage(image) {
	return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/* ---------------- Adjustments ---------------- */

const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;

/** Build a 256-entry per-channel LUT from separable params. Returns Uint8ClampedArray(256) applied to R,G,B. */
function buildLUT(p) {
	const lut = new Uint8ClampedArray(256);
	const brightness = Number(p.brightness) || 0;      // -1..1
	const contrast = Number(p.contrast) || 0;          // -1..1
	const exposure = Number(p.exposure) || 0;          // -2..2 (stops)
	const gamma = Number(p.gamma) || 1;                // 0.1..3
	const invert = p.invert === true;
	for (let i = 0; i < 256; i++) {
		let v = i / 255;
		v *= Math.pow(2, exposure);
		v += brightness;
		v = (v - 0.5) * (1 + contrast) + 0.5;
		if (gamma !== 1) v = v <= 0 ? 0 : Math.pow(v, 1 / gamma);
		if (invert) v = 1 - v;
		lut[i] = clampByte(Math.round(clamp01(v) * 255));
	}
	return lut;
}

function hueMatrix(degrees) {
	const a = (degrees * Math.PI) / 180;
	const c = Math.cos(a), s = Math.sin(a);
	// Standard hue-rotate matrix
	return [
		0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
		0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
		0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072
	];
}

const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Apply full adjustment param set. Recognized keys: brightness, contrast, exposure, gamma, invert, saturation, hue, temperature, tint, highlights, shadows, grayscale, sepia, threshold. */
export function applyAdjust(image, params = {}, mask = null) {
	const lut = buildLUT(params);
	const sat = params.saturation == null ? 1 : 1 + Number(params.saturation);   // -1..1 → 0..2
	const hue = (Number(params.hue) || 0);
	const m = hue ? hueMatrix(hue) : null;
	const temperature = Number(params.temperature) || 0;  // -1..1
	const tint = Number(params.tint) || 0;                // -1..1
	const highlights = Number(params.highlights) || 0;    // -1..1
	const shadows = Number(params.shadows) || 0;          // -1..1
	const grayscale = params.grayscale === true;
	const sepia = params.sepia === true;
	const threshold = params.threshold == null ? null : clampByte(Math.round((Number(params.threshold) || 0.5) * 255));
	const tr = temperature * 60, tg = tint * 30, tb = -temperature * 60;
	const data = image.data;
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
			const hw = l > 0.5 ? (l - 0.5) * 2 : 0;
			const sw = l < 0.5 ? (0.5 - l) * 2 : 0;
			const lift = shadows * sw * 160 - highlights * hw * 160;
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
		let alpha = 255;
		if (mask) {
			const x = (i >> 2) % image.width, y = ((i >> 2) / image.width) | 0;
			const mx = Math.min(mask.width - 1, x), my = Math.min(mask.height - 1, y);
			const mi = (my * mask.width + mx) * 4;
			const lum = mask.data[mi + 3] < 255 ? mask.data[mi + 3] : lumOf(mask.data[mi], mask.data[mi + 1], mask.data[mi + 2]);
			alpha = Math.round((lum / 255) * 255);
		}
		data[i] = clampByte(r); data[i + 1] = clampByte(g); data[i + 2] = clampByte(b);
		if (mask) data[i + 3] = Math.min(data[i + 3], alpha);
	}
	return image;
}

/* ---------------- Filters ---------------- */

export function boxBlur(image, radius, passes = 3) {
	if (radius < 1) return image;
	const { width: w, height: h, data } = image;
	let src = data;
	const tmp = new Uint8ClampedArray(src.length);
	for (let p = 0; p < passes; p++) {
		blurPass(src, tmp, w, h, radius, true);
		blurPass(tmp, src, w, h, radius, false);
		src = data;
	}
	return image;
}

function blurPass(src, dst, w, h, r, horizontal) {
	const length = horizontal ? w : h;
	const other = horizontal ? h : w;
	const windowSize = r * 2 + 1;
	for (let o = 0; o < other; o++) {
		let sr = 0, sg = 0, sb = 0, sa = 0;
		const get = (i) => {
			const idx = horizontal ? ((o * w + Math.min(w - 1, Math.max(0, i))) * 4) : ((Math.min(h - 1, Math.max(0, i)) * w + o) * 4);
			return idx;
		};
		for (let i = -r; i <= r; i++) { const idx = get(i); sr += src[idx]; sg += src[idx + 1]; sb += src[idx + 2]; sa += src[idx + 3]; }
		for (let i = 0; i < length; i++) {
			const di = horizontal ? (o * w + i) * 4 : (i * w + o) * 4;
			dst[di] = sr / windowSize; dst[di + 1] = sg / windowSize; dst[di + 2] = sb / windowSize; dst[di + 3] = sa / windowSize;
			const outIdx = get(i - r), inIdx = get(i + r + 1);
			sr += src[inIdx] - src[outIdx]; sg += src[inIdx + 1] - src[outIdx + 1];
			sb += src[inIdx + 2] - src[outIdx + 2]; sa += src[inIdx + 3] - src[outIdx + 3];
		}
	}
}

export function sharpen(image, amount = 0.5) {
	const { width: w, height: h, data } = image;
	const src = new Uint8ClampedArray(data);
	const k = amount;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const i = (y * w + x) * 4;
			for (let c = 0; c < 3; c++) {
				const center = src[i + c];
				const around = src[i - 4 + c] + src[i + 4 + c] + src[i - w * 4 + c] + src[i + w * 4 + c];
				data[i + c] = clampByte(center + (center * 4 - around) * 0.25 * k);
			}
		}
	}
	return image;
}

export function pixelate(image, blockSize = 8) {
	const { width: w, height: h, data } = image;
	const b = Math.max(2, blockSize | 0);
	for (let by = 0; by < h; by += b) {
		for (let bx = 0; bx < w; bx += b) {
			let r = 0, g = 0, bl = 0, a = 0, n = 0;
			for (let y = by; y < Math.min(by + b, h); y++) for (let x = bx; x < Math.min(bx + b, w); x++) {
				const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; bl += data[i + 2]; a += data[i + 3]; n++;
			}
			r /= n; g /= n; bl /= n; a /= n;
			for (let y = by; y < Math.min(by + b, h); y++) for (let x = bx; x < Math.min(bx + b, w); x++) {
				const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = bl; data[i + 3] = a;
			}
		}
	}
	return image;
}

export function noise(image, amount = 0.2, seed = 7) {
	const data = image.data;
	let s = seed >>> 0 || 7;
	const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
	const k = amount * 255;
	for (let i = 0; i < data.length; i += 4) {
		const d = (rand() - 0.5) * k;
		data[i] = clampByte(data[i] + d); data[i + 1] = clampByte(data[i + 1] + d); data[i + 2] = clampByte(data[i + 2] + d);
	}
	return image;
}

export function vignette(image, strength = 0.5) {
	const { width: w, height: h, data } = image;
	const cx = w / 2, cy = h / 2;
	const maxD = Math.sqrt(cx * cx + cy * cy);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const i = (y * w + x) * 4;
		const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxD;
		const f = 1 - strength * Math.max(0, d - 0.4) / 0.6;
		data[i] *= f; data[i + 1] *= f; data[i + 2] *= f;
	}
	return image;
}

export function applyFilter(image, filter = {}) {
	const kind = String(filter.kind || '').toLowerCase();
	const amount = Number(filter.amount ?? filter.radius ?? 4);
	if (kind === 'blur') return boxBlur(image, Math.max(1, amount | 0));
	if (kind === 'sharpen') return sharpen(image, Math.min(2, Math.max(0, amount / 10)));
	if (kind === 'pixelate') return pixelate(image, Math.max(2, amount | 0));
	if (kind === 'noise') return noise(image, Math.min(1, amount / 100));
	if (kind === 'vignette') return vignette(image, Math.min(1, amount / 100));
	throw new Error('unknown filter kind: ' + kind);
}

/* ---------------- Geometry ---------------- */

export function crop(image, x, y, w, h) {
	x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
	x = Math.max(0, Math.min(image.width - 1, x)); y = Math.max(0, Math.min(image.height - 1, y));
	w = Math.max(1, Math.min(image.width - x, w)); h = Math.max(1, Math.min(image.height - y, h));
	const out = createImage(w, h);
	for (let row = 0; row < h; row++) {
		const srcStart = ((y + row) * image.width + x) * 4;
		out.data.set(image.data.subarray(srcStart, srcStart + w * 4), row * w * 4);
	}
	return out;
}

export function resize(image, w, h) {
	w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
	if (w * h > MAX_PIXELS) throw new Error('resize target too large');
	const out = createImage(w, h);
	const sx = image.width / w, sy = image.height / h;
	for (let y = 0; y < h; y++) {
		const fy = Math.max(0, Math.min(image.height - 1, (y + 0.5) * sy - 0.5));
		const y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(image.height - 1, y0 + 1), wy = fy - y0;
		for (let x = 0; x < w; x++) {
			const fx = Math.max(0, Math.min(image.width - 1, (x + 0.5) * sx - 0.5));
			const x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(image.width - 1, x0 + 1), wx = fx - x0;
			const i00 = (y0 * image.width + x0) * 4, i10 = (y0 * image.width + x1) * 4;
			const i01 = (y1 * image.width + x0) * 4, i11 = (y1 * image.width + x1) * 4;
			const di = (y * w + x) * 4;
			for (let c = 0; c < 4; c++) {
				const top = image.data[i00 + c] * (1 - wx) + image.data[i10 + c] * wx;
				const bottom = image.data[i01 + c] * (1 - wx) + image.data[i11 + c] * wx;
				out.data[di + c] = top * (1 - wy) + bottom * wy;
			}
		}
	}
	return out;
}

export function flip(image, horizontal = true) {
	const { width: w, height: h, data } = image;
	const out = createImage(w, h);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const si = (y * w + (horizontal ? w - 1 - x : x)) * 4;
		const di = ((horizontal ? y : h - 1 - y) * w + x) * 4;
		out.data[di] = data[si]; out.data[di + 1] = data[si + 1]; out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
		if (!horizontal) { /* handled above */ }
	}
	return out;
}

export function rotate90(image, clockwise = true) {
	const { width: w, height: h, data } = image;
	const out = createImage(h, w);
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		const si = (y * w + x) * 4;
		const nx = clockwise ? h - 1 - y : y;
		const ny = clockwise ? x : w - 1 - x;
		const di = (ny * h + nx) * 4;
		out.data[di] = data[si]; out.data[di + 1] = data[si + 1]; out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3];
	}
	return out;
}

/* ---------------- Compositing ---------------- */

const blendFormulas = {
	normal: (cb, cs) => cs,
	multiply: (cb, cs) => cb * cs,
	screen: (cb, cs) => cb + cs - cb * cs,
	overlay: (cb, cs) => cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs),
	darken: (cb, cs) => Math.min(cb, cs),
	lighten: (cb, cs) => Math.max(cb, cs),
	colordodge: (cb, cs) => (cs >= 1 ? 1 : Math.min(1, cb / (1 - cs))),
	colorburn: (cb, cs) => (cs <= 0 ? 0 : Math.max(0, 1 - (1 - cb) / cs)),
	hardlight: (cb, cs) => cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs),
	softlight: (cb, cs) => {
		if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
		const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
		return cb + (2 * cs - 1) * (d - cb);
	},
	difference: (cb, cs) => Math.abs(cb - cs),
	exclusion: (cb, cs) => cb + cs - 2 * cb * cs
};

function setSaturation(c, s) {
	const [low,mid,high]=[0,1,2].sort((a,b)=>c[a]-c[b]);
	if(c[high]>c[low]){c[mid]=(c[mid]-c[low])*s/(c[high]-c[low]);c[high]=s;}
	else c[mid]=c[high]=0;
	c[low]=0;
	return c;
}

function setLuminance(c, l) {
	const d = l - blendLum(c);
	return [c[0] + d, c[1] + d, c[2] + d];
}

function clipColor(c) {
	const l = blendLum(c);
	const n = Math.min(c[0], c[1], c[2]);
	const x = Math.max(c[0], c[1], c[2]);
	if (n < 0) for (let i = 0; i < 3; i++) c[i] = l + (c[i] - l) * l / (l - n);
	if (x > 1) for (let i = 0; i < 3; i++) c[i] = l + (c[i] - l) * (1 - l) / (x - l);
	return c;
}

/** Composite src over dst at offset with blend mode + opacity. Mutates dst. */
export function composite(dst, src, { x = 0, y = 0, opacity = 1, blend = 'normal' } = {}) {
	const mode = String(blend || 'normal').toLowerCase().replace(/[^a-z]/g, '');
	const formula = blendFormulas[mode] || blendFormulas.normal;
	const nonSeparable = mode === 'hue' || mode === 'saturation' || mode === 'color' || mode === 'luminosity';
	for (let sy = 0; sy < src.height; sy++) {
		const dy0 = y + sy;
		if (dy0 < 0 || dy0 >= dst.height) continue;
		for (let sx = 0; sx < src.width; sx++) {
			const dx0 = x + sx;
			if (dx0 < 0 || dx0 >= dst.width) continue;
			const si = (sy * src.width + sx) * 4;
			const di = (dy0 * dst.width + dx0) * 4;
			const sa = (src.data[si + 3] / 255) * opacity;
			if (sa <= 0) continue;
			const da=dst.data[di+3]/255,alpha=sa+da*(1-sa);
			const cb = [dst.data[di] / 255, dst.data[di + 1] / 255, dst.data[di + 2] / 255];
			const cs = [src.data[si] / 255, src.data[si + 1] / 255, src.data[si + 2] / 255];
			let B;
			if (nonSeparable) {
				const cbLum = blendLum(cb);
				let out;
				if (mode === 'hue') out = setLuminance(setSaturation([...cs], saturationOf(cb)), cbLum);
				else if (mode === 'saturation') out = setLuminance(setSaturation([...cb], saturationOf(cs)), cbLum);
				else if (mode === 'color') out = setLuminance([...cs], cbLum);
				else out = setLuminance([...cb], blendLum(cs));
				B = clipColor(out);
			} else {
				B = [formula(cb[0], cs[0]), formula(cb[1], cs[1]), formula(cb[2], cs[2])];
			}
			for (let c = 0; c < 3; c++) {
				const blended = (1-da)*cs[c]+da*B[c];
				const premultiplied=sa*blended+(1-sa)*da*cb[c];
				dst.data[di+c]=clampByte(Math.round(255*premultiplied/alpha));
			}
			dst.data[di + 3] = clampByte(Math.round(255*alpha));
		}
	}
	return dst;
}

function saturationOf(c) {
	return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}
function blendLum(c){return .3*c[0]+.59*c[1]+.11*c[2];}

/** Multiply dst alpha by a luminance/alpha mask (destination-in semantics). */
export function applyMask(image, mask) {
	for (let y = 0; y < image.height; y++) {
		const my = Math.min(mask.height - 1, y);
		for (let x = 0; x < image.width; x++) {
			const mx = Math.min(mask.width - 1, x);
			const i = (y * image.width + x) * 4;
			const mi = (my * mask.width + mx) * 4;
			const lum = lumOf(mask.data[mi],mask.data[mi+1],mask.data[mi+2])*(mask.data[mi+3]/255);
			image.data[i + 3] = clampByte(image.data[i + 3] * (lum / 255));
		}
	}
	return image;
}

/** Fill a rect region with a color (paint-over with alpha). */
export function fillRect(image, x, y, w, h, color) {
	const [r, g, b, a] = [clampByte(color[0]), clampByte(color[1]), clampByte(color[2]), color[3] == null ? 255 : clampByte(color[3])];
	const sa = a / 255;
	for (let yy = Math.max(0, y | 0); yy < Math.min(image.height, (y | 0) + (h | 0)); yy++) {
		for (let xx = Math.max(0, x | 0); xx < Math.min(image.width, (x | 0) + (w | 0)); xx++) {
			const i = (yy * image.width + xx) * 4;
			image.data[i] = clampByte(r * sa + image.data[i] * (1 - sa));
			image.data[i + 1] = clampByte(g * sa + image.data[i + 1] * (1 - sa));
			image.data[i + 2] = clampByte(b * sa + image.data[i + 2] * (1 - sa));
			image.data[i + 3] = clampByte(a + image.data[i + 3] * (1 - sa));
		}
	}
	return image;
}

/** Linear gradient fill over a rect (angle in degrees, stops [[offset,color],...]). */
export function gradientRect(image, x, y, w, h, stops, angleDeg = 0) {
	const a = (angleDeg * Math.PI) / 180;
	const cx = x + w / 2, cy = y + h / 2;
	const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
	const stopsSorted = [...stops].sort((p, q) => p[0] - q[0]);
	for (let yy = Math.max(0, y | 0); yy < Math.min(image.height, (y | 0) + (h | 0)); yy++) {
		for (let xx = Math.max(0, x | 0); xx < Math.min(image.width, (x | 0) + (w | 0)); xx++) {
			const px = xx + 0.5 - cx, py = yy + 0.5 - cy;
			let t = 0.5 + (px * Math.cos(a) + py * Math.sin(a)) / (len || 1);
			t = Math.min(1, Math.max(0, t));
			let c0 = stopsSorted[0], c1 = stopsSorted[stopsSorted.length - 1];
			for (let i = 0; i < stopsSorted.length - 1; i++) {
				if (t >= stopsSorted[i][0] && t <= stopsSorted[i + 1][0]) { c0 = stopsSorted[i]; c1 = stopsSorted[i + 1]; break; }
			}
			const span = (c1[0] - c0[0]) || 1;
			const f = Math.min(1, Math.max(0, (t - c0[0]) / span));
			const i2 = (yy * image.width + xx) * 4;
			const r = c0[1][0] + (c1[1][0] - c0[1][0]) * f;
			const g = c0[1][1] + (c1[1][1] - c0[1][1]) * f;
			const b = c0[1][2] + (c1[1][2] - c0[1][2]) * f;
			const al = (c0[1][3] == null ? 255 : c0[1][3]) + ((c1[1][3] == null ? 255 : c1[1][3]) - (c0[1][3] == null ? 255 : c0[1][3])) * f;
			image.data[i2] = clampByte(r); image.data[i2 + 1] = clampByte(g); image.data[i2 + 2] = clampByte(b); image.data[i2 + 3] = clampByte(al);
		}
	}
	return image;
}

/** Parse #rgb/#rrggbb/#rrggbbaa/rgb()/rgba()/named-common → [r,g,b,a]. */
export function parseColor(value, fallback = [0, 0, 0, 255]) {
	if (Array.isArray(value)) return [clampByte(value[0]), clampByte(value[1]), clampByte(value[2]), value[3] == null ? 255 : clampByte(value[3])];
	if (typeof value !== 'string') return fallback;
	const v = value.trim().toLowerCase();
	const named = { black: [0, 0, 0], white: [255, 255, 255], red: [220, 38, 38], green: [22, 163, 74], blue: [37, 99, 235], yellow: [250, 204, 21], orange: [249, 115, 22], purple: [147, 51, 234], pink: [236, 72, 153], gray: [128, 128, 128], grey: [128, 128, 128], transparent: [0, 0, 0, 0] };
	if (named[v]) { const c = named[v]; return [c[0], c[1], c[2], c[3] == null ? 255 : c[3]]; }
	if (v.startsWith('#')) {
		const hex = v.slice(1);
		if (hex.length === 3) return [parseInt(hex[0] + hex[0], 16), parseInt(hex[1] + hex[1], 16), parseInt(hex[2] + hex[2], 16), 255];
		if (hex.length === 6) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 255];
		if (hex.length === 8) return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), parseInt(hex.slice(6, 8), 16)];
		return fallback;
	}
	const fn = /^rgba?\(([^)]+)\)$/.exec(v);
	if (fn) {
		const parts = fn[1].split(/[\s,]+/).filter(Boolean);
		if (parts.length >= 3) {
			const alpha = parts[3] != null ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
			return [clampByte(parseFloat(parts[0])), clampByte(parseFloat(parts[1])), clampByte(parseFloat(parts[2])), clampByte(alpha * 255)];
		}
	}
	return fallback;
}

/** css color → #rrggbb (for OOXML/PDF writers). */
export function colorToHex(value, fallback = '000000') {
	const c = parseColor(value, null);
	if (!c) return fallback;
	return [c[0], c[1], c[2]].map((n) => n.toString(16).padStart(2, '0')).join('');
}

export function colorAlpha(value) {
	const c = parseColor(value, null);
	return c ? (c[3] ?? 255) / 255 : 1;
}
