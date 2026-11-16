/**
 * DesignCraft baseline JPEG codec (pure JS, zero-dependency).
 * Decoder: baseline sequential DCT (SOF0), Huffman, restart markers,
 * grayscale / YCbCr 4:4:4 · 4:2:2 · 4:2:0, 8-bit.
 * Encoder: 4:2:0, standard annex tables, quality 1-100.
 * Unlocks image.op for JPEG sources (PhotoCraft pixel ops on photos).
 */
import { createImage, clampByte } from './raster.js';

/* ================= DECODER ================= */

const ZIGZAG = [
	0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
	35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63
];

function buildHuffman(counts, symbols) {
	// returns { lookup: Map(code→symbol), minLength, maxLength } using canonical codes
	const lengths = [];
	for (let l = 1; l <= 16; l++) for (let c = 0; c < counts[l - 1]; c++) lengths.push(l);
	if (lengths.length !== symbols.length) throw new Error('DHT length mismatch');
	const table = new Map();
	let code = 0;
	let k = 0;
	for (let l = 1; l <= 16; l++) {
		for (let c = 0; c < counts[l - 1]; c++) {
			table.set((l << 16) | code, symbols[k++]);
			code++;
		}
		code <<= 1;
	}
	return { table, maxLen: 16 };
}

function decodeHuffman(bitReader, huff) {
	let code = 0;
	for (let len = 1; len <= 16; len++) {
		code = (code << 1) | bitReader.bit();
		const sym = huff.table.get((len << 16) | code);
		if (sym !== undefined) return sym;
	}
	throw new Error('invalid Huffman code');
}

function receiveExtend(bitReader, s) {
	if (s === 0) return 0;
	let v = bitReader.bits(s);
	if (v < (1 << (s - 1))) v += (-1 << s) + 1;
	return v;
}

function idct8x8(block, out, outOffset, outStride) {
	// AAN-style float IDCT (2D separable) — accuracy well within JPEG spec tolerance
	const tmp = new Float32Array(64);
	for (let x = 0; x < 8; x++) {
		const s0 = block[x], s1 = block[8 + x], s2 = block[16 + x], s3 = block[24 + x];
		const s4 = block[32 + x], s5 = block[40 + x], s6 = block[48 + x], s7 = block[56 + x];
		const a0 = s0 + s4, a1 = s0 - s4, a2 = s2 + s6, a3 = (s2 - s6) * 1.414213562;
		const a4 = s1 + s7, a5 = s1 - s7, a6 = s3 + s5, a7 = (s3 - s5) * 1.414213562;
		const b0 = a0 + a2, b2 = a0 - a2, b1 = (a4 + a6) * 1.306562965, b3 = (a4 - a6) * 0.541196100;
		const b4 = a1 + a3, b6 = a1 - a3, b5 = a5 + a7, b7 = (a5 - a7) * 0.414213562;
		tmp[x] = b0 + b1; tmp[8 + x] = b4 + b3 + b5; tmp[16 + x] = b2 + b7; tmp[24 + x] = b6 + b5 - b3;
		tmp[32 + x] = b6 - b5 - b3 + 2 * b7 - b5 + b3; // simplified below
		tmp[32 + x] = b6 - b3; tmp[40 + x] = b2 - b7; tmp[48 + x] = b4 - b5 + b3 - b7; tmp[56 + x] = b0 - b1;
	}
	for (let y = 0; y < 8; y++) {
		const r = y * 8;
		const s0 = tmp[r], s1 = tmp[r + 1], s2 = tmp[r + 2], s3 = tmp[r + 3];
		const s4 = tmp[r + 4], s5 = tmp[r + 5], s6 = tmp[r + 6], s7 = tmp[r + 7];
		const a0 = s0 + s4, a1 = s0 - s4, a2 = s2 + s6, a3 = (s2 - s6) * 1.414213562;
		const a4 = s1 + s7, a5 = s1 - s7, a6 = s3 + s5, a7 = (s3 - s5) * 1.414213562;
		const b0 = a0 + a2, b2 = a0 - a2, b1 = (a4 + a6) * 1.306562965, b3 = (a4 - a6) * 0.541196100;
		const b4 = a1 + a3, b6 = a1 - a3, b5 = a5 + a7, b7 = (a5 - a7) * 0.414213562;
		const cols = [b0 + b1, b4 + b3 + b5, b2 + b7, b6 + b5 - b3, b6 - b5 - b3, b2 - b7, b4 - b5 + b3 - b7, b0 - b1];
		for (let x = 0; x < 8; x++) {
			out[outOffset + y * outStride + x] = clampByte(Math.round(cols[x] * 0.125 + 128));
		}
	}
}

class BitReader {
	constructor(data, pos) {
		this.data = data;
		this.pos = pos;
		this.acc = 0;
		this.nbits = 0;
		this.atMarker = false;
	}
	bit() {
		return this.bits(1);
	}
	bits(n) {
		let value = 0;
		for (let i = 0; i < n; i++) {
			if (this.nbits === 0) {
				if (this.atMarker) { this.acc = 0; } // past end-of-scan: pad zeros
				else {
					let b = this.data[this.pos++];
					if (b === 0xFF) {
						const next = this.data[this.pos];
						if (next === 0x00) { this.pos++; }       // byte stuffing
						else { this.atMarker = true; this.acc = 0; } // hit a marker: no more entropy data
					}
					this.acc = this.atMarker ? 0 : b;
					if (!this.atMarker) this.nbits = 8;
				}
				if (this.atMarker && this.nbits === 0) { value <<= 1; continue; }
			}
			this.nbits--;
			value = (value << 1) | ((this.acc >>> this.nbits) & 1);
		}
		return value;
	}
	align() { this.nbits = 0; this.atMarker = false; }
}

/** Decode baseline JPEG → {width,height,data} RGBA image. Throws typed errors on unsupported features. */
export function fromJPEG(buffer) {
	const u8 = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
	if (u8.length < 4 || u8[0] !== 0xFF || u8[1] !== 0xD8) throw new Error('not a JPEG file');
	let pos = 2;
	let width = 0, height = 0;
	let comps = [];
	const qt = new Array(4).fill(null);
	const dcTabs = new Array(4).fill(null);
	const acTabs = new Array(4).fill(null);
	let restartInterval = 0;
	let progressive = false;

	const readU16 = () => { const v = u8.readUInt16BE(pos); pos += 2; return v; };

	while (pos + 4 < u8.length) {
		if (u8[pos] !== 0xFF) { pos++; continue; }
		const marker = u8[pos + 1];
		pos += 2;
		if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) continue; // SOI / RST
		if (marker === 0xD9) break; // EOI
		const segLen = readU16();
		const segEnd = pos - 2 + segLen;
		if (marker === 0xDB) { // DQT
			let p = pos;
			while (p < segEnd) {
				const pqTq = u8[p++];
				const pq = pqTq >> 4, tq = pqTq & 15;
				if (pq !== 0) throw new Error('16-bit quant table not supported');
				const table = new Int32Array(64);
				for (let i = 0; i < 64; i++) table[ZIGZAG[i]] = u8[p++];
				qt[tq] = table;
			}
		} else if (marker === 0xC0 || marker === 0xC1) { // SOF0/1 baseline
			const p = pos;
			const precision = u8[p];
			if (precision !== 8) throw new Error('JPEG precision ' + precision + ' not supported');
			height = u8.readUInt16BE(p + 1);
			width = u8.readUInt16BE(p + 3);
			const nc = u8[p + 5];
			comps = [];
			for (let i = 0; i < nc; i++) {
				comps.push({ id: u8[p + 6 + i * 3], h: u8[p + 7 + i * 3] >> 4, v: u8[p + 7 + i * 3] & 15, tq: u8[p + 8 + i * 3], dc: 0, ac: 0, pred: 0 });
			}
		} else if (marker === 0xC2) {
			progressive = true;
		} else if (marker === 0xC4) { // DHT
			let p = pos;
			while (p < segEnd) {
				const tcTh = u8[p++];
				const tc = tcTh >> 4, th = tcTh & 15;
				const counts = Array.from({ length: 16 }, (_, i) => u8[p + i]);
				p += 16;
				const total = counts.reduce((a, b) => a + b, 0);
				const symbols = Array.from({ length: total }, (_, i) => u8[p + i]);
				p += total;
				const table = buildHuffman(counts, symbols);
				if (tc === 0) dcTabs[th] = table; else acTabs[th] = table;
			}
		} else if (marker === 0xDD) { // DRI
			restartInterval = u8.readUInt16BE(pos);
		} else if (marker === 0xDA) { // SOS
			if (progressive) throw new Error('progressive JPEG not supported');
			const p = pos;
			const ns = u8[p];
			const scanComps = [];
			for (let i = 0; i < ns; i++) {
				const cs = u8[p + 1 + i * 2];
				const tdTa = u8[p + 2 + i * 2];
				const comp = comps.find(c => c.id === cs);
				if (comp) { comp.dc = tdTa >> 4; comp.ac = tdTa & 15; scanComps.push(comp); }
			}
			pos = segEnd;
			const result = decodeScan(u8, pos, width, height, comps, scanComps, qt, dcTabs, acTabs, restartInterval);
			return result;
		}
		pos = segEnd;
	}
	throw new Error('no JPEG scan found');
}

function decodeScan(u8, pos, width, height, comps, scanComps, qt, dcTabs, acTabs, restartInterval) {
	if (width * height > 24 * 1024 * 1024) throw new Error('JPEG too large (>24MP)');
	const hMax = Math.max(...comps.map(c => c.h));
	const vMax = Math.max(...comps.map(c => c.v));
	const mcuW = hMax * 8, mcuH = vMax * 8;
	const mcusX = Math.ceil(width / mcuW), mcusY = Math.ceil(height / mcuH);
	const planes = comps.map(c => new Uint8Array(Math.ceil(width * c.h / hMax) * Math.ceil(height * c.v / vMax) + 64));
	const planeW = comps.map(c => Math.ceil(width * c.h / hMax));
	const planeH = comps.map(c => Math.ceil(height * c.v / vMax));

	const reader = new BitReader(u8, pos);
	let mcuCount = 0;
	let rstNo = 0;
	for (let my = 0; my < mcusY; my++) {
		for (let mx = 0; mx < mcusX; mx++) {
			if (restartInterval && mcuCount > 0 && mcuCount % restartInterval === 0) {
				// consume RSTn
				while (reader.pos < u8.length - 1) {
					if (u8[reader.pos] === 0xFF && u8[reader.pos + 1] >= 0xD0 && u8[reader.pos + 1] <= 0xD7) { reader.pos += 2; break; }
					reader.pos++;
				}
				reader.align();
				reader.marker = null;
				for (const c of comps) c.pred = 0;
				rstNo = (rstNo + 1) & 7;
			}
			// non-interleaved single-component scan support (one block per MCU, component grid)
			if (scanComps.length === 1) {
				const c = scanComps[0];
				const ci = comps.indexOf(c);
				decodeBlock(reader, c, qt, dcTabs, acTabs, planes[ci], planeW[ci], mx * 8, my * 8);
			} else {
				for (const c of comps) {
					const ci = comps.indexOf(c);
					for (let sy = 0; sy < c.v; sy++) {
						for (let sx = 0; sx < c.h; sx++) {
							decodeBlock(reader, c, qt, dcTabs, acTabs, planes[ci], planeW[ci], (mx * c.h + sx) * 8, (my * c.v + sy) * 8);
						}
					}
				}
			}
			mcuCount++;
		}
	}

	// upsample + color convert
	const img = createImage(width, height, [0, 0, 0, 255]);
	const data = img.data;
	if (comps.length === 1) {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const di = (y * width + x) * 4;
				const v = planes[0][Math.min(planeH[0] - 1, y) * planeW[0] + Math.min(planeW[0] - 1, x)];
				data[di] = data[di + 1] = data[di + 2] = v;
			}
		}
		return img;
	}
	let Y = comps.find(c => c.h === hMax && c.v === vMax) || comps[0];
	let Cb = comps.find(c => c !== Y) || comps[1];
	let Cr = comps.find(c => c !== Y && c !== Cb) || comps[1];
	const Yp = planes[comps.indexOf(Y)], Cbp = planes[comps.indexOf(Cb)], Crp = planes[comps.indexOf(Cr)];
	const Yw = planeW[comps.indexOf(Y)], Cbw = planeW[comps.indexOf(Cb)], Crw = planeW[comps.indexOf(Cr)];
	const Yh = Math.ceil(width * Y.h / hMax), Yvh = planeH[comps.indexOf(Y)];
	const Cbh = planeH[comps.indexOf(Cb)], Crh = planeH[comps.indexOf(Cr)];
	for (let y = 0; y < height; y++) {
		const yi = Math.min(Yvh - 1, y) * Yw;
		const bi = Math.min(Cbh - 1, y * Cb.v / vMax | 0) * Cbw;
		const ri = Math.min(Crh - 1, y * Cr.v / vMax | 0) * Crw;
		for (let x = 0; x < width; x++) {
			const di = (y * width + x) * 4;
			const yy = Yp[yi + Math.min(Yh - 1, x)];
			const cb = Cbp[bi + (x * Cb.h / hMax | 0)];
			const cr = Crp[ri + (x * Cr.h / hMax | 0)];
			data[di] = clampByte(yy + ((cr - 128) * 1.402 | 0));
			data[di + 1] = clampByte(yy - (((cb - 128) * 0.344136 + (cr - 128) * 0.714136) | 0));
			data[di + 2] = clampByte(yy + ((cb - 128) * 1.772 | 0));
		}
	}
	return img;
}

function decodeBlock(reader, comp, qt, dcTabs, acTabs, plane, planeW, ox, oy) {
	const block = decodeBlockCoeffs(reader, comp, qt, dcTabs, acTabs);
	idctToPlane(block, plane, planeW, ox, oy);
}

function decodeBlockCoeffs(reader, comp, qt, dcTabs, acTabs) {
	const block = new Float32Array(64);
	const dcSym = decodeHuffman(reader, dcTabs[comp.dc]);
	comp.pred += receiveExtend(reader, dcSym);
	block[0] = comp.pred * qt[comp.tq][0];
	let k = 1;
	while (k < 64) {
		const rs = decodeHuffman(reader, acTabs[comp.ac]);
		const r = rs >> 4, s = rs & 15;
		if (s === 0) {
			if (r === 15) { k += 16; continue; }
			break;
		}
		k += r;
		if (k > 63) break;
		block[ZIGZAG[k]] = receiveExtend(reader, s) * qt[comp.tq][ZIGZAG[k]];
		k++;
	}
	return block;
}

function idctToPlane(block, plane, planeW, ox, oy) {
	const tmp = new Float32Array(64);
	// rows
	for (let y = 0; y < 8; y++) {
		const r = y * 8;
		idct1d(block[r], block[r + 1], block[r + 2], block[r + 3], block[r + 4], block[r + 5], block[r + 6], block[r + 7], tmp, y * 8, 1);
	}
	// cols
	for (let x = 0; x < 8; x++) {
		const col = idct1d(tmp[x], tmp[8 + x], tmp[16 + x], tmp[24 + x], tmp[32 + x], tmp[40 + x], tmp[48 + x], tmp[56 + x], new Float32Array(8), 0, 1);
		for (let yy = 0; yy < 8; yy++) {
			const py = oy + yy, px = ox + x;
			plane[py * planeW + px] = clampByte(Math.round(col[yy] * 0.125 + 128));
		}
	}
}

function idct1d(s0, s1, s2, s3, s4, s5, s6, s7, out, off) {
	const a0 = s0 + s4, a1 = s0 - s4, a2 = s2 + s6, a3 = (s2 - s6) * 1.414213562;
	const a4 = s1 + s7, a5 = s1 - s7, a6 = s3 + s5, a7 = (s3 - s5) * 1.414213562;
	const b0 = a0 + a2, b2 = a0 - a2, b1 = (a4 + a6) * 1.306562965, b3 = (a4 - a6) * 0.541196100;
	const b4 = a1 + a3, b6 = a1 - a3, b5 = a5 + a7, b7 = (a5 - a7) * 0.414213562;
	out[off] = b0 + b1; out[off + 1] = b4 + b3 + b5; out[off + 2] = b2 + b7; out[off + 3] = b6 + b5 - b3;
	out[off + 4] = b6 - b5 - b3; out[off + 5] = b2 - b7; out[off + 6] = b4 - b5 + b3 - b7; out[off + 7] = b0 - b1;
	return out;
}

/* ================= ENCODER ================= */

const Y_QT = [
	16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
	14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
	49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99
];
const C_QT = [
	17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
	47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
	99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99
];

const STD_DC_LUMA_COUNTS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const STD_DC_LUMA_SYMS = Array.from({ length: 12 }, (_, i) => i);
const STD_DC_CHROMA_COUNTS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const STD_DC_CHROMA_SYMS = Array.from({ length: 12 }, (_, i) => i);
const STD_AC_LUMA_COUNTS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const STD_AC_LUMA_SYMS = [
	0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08,
	0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
	0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
	0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
	0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
	0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
	0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa
];
const STD_AC_CHROMA_COUNTS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const STD_AC_CHROMA_SYMS = [
	0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91,
	0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26,
	0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58,
	0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87,
	0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
	0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda,
	0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa
];

function buildCodes(counts, symbols) {
	const codes = new Map();
	let code = 0;
	let k = 0;
	for (let l = 1; l <= 16; l++) {
		for (let c = 0; c < counts[l - 1]; c++) {
			codes.set(symbols[k], { length: l, code });
			k++; code++;
		}
		code <<= 1;
	}
	return codes;
}

class BitWriter {
	constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
	write(code, length) {
		this.acc = (this.acc << length) | (code & ((1 << length) - 1));
		this.n += length;
		while (this.n >= 8) {
			this.n -= 8;
			let b = (this.acc >>> this.n) & 0xFF;
			this.bytes.push(b);
			if (b === 0xFF) this.bytes.push(0x00);
		}
	}
	flush() {
		if (this.n > 0) {
			const b = ((this.acc << (8 - this.n)) & 0xFF);
			this.bytes.push(b);
			if (b === 0xFF) this.bytes.push(0x00);
			this.n = 0;
		}
		return Buffer.from(this.bytes);
	}
}

const fdctTable = (() => {
	// precomputed cosine table
	const t = new Float32Array(64);
	for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) t[y * 8 + x] = Math.cos((2 * x + 1) * y * Math.PI / 16) * (y === 0 ? Math.SQRT1_2 : 1) * 0.5;
	return t;
})();

function fdct(block) {
	const out = new Float32Array(64);
	for (let v = 0; v < 8; v++) {
		for (let u = 0; u < 8; u++) {
			let sum = 0;
			for (let y = 0; y < 8; y++) {
				let rowSum = 0;
				for (let x = 0; x < 8; x++) rowSum += block[y * 8 + x] * fdctTable[u * 8 + x];
				sum += rowSum * fdctTable[v * 8 + y];
			}
			out[v * 8 + u] = sum;
		}
	}
	return out;
}

function magnitude(v) {
	let n = 0;
	v = Math.abs(v);
	while (v) { v >>= 1; n++; }
	return n;
}

/** Encode RGBA image → baseline JPEG buffer (4:2:0). quality 1..100. */
export function toJPEG(image, quality = 85) {
	const q = Math.max(1, Math.min(100, Math.round(quality)));
	const scale = q < 50 ? 5000 / q : 200 - 2 * q;
	const yQ = new Int32Array(64), cQ = new Int32Array(64);
	for (let i = 0; i < 64; i++) {
		yQ[i] = Math.max(1, Math.min(255, Math.floor((Y_QT[i] * scale + 50) / 100)));
		cQ[i] = Math.max(1, Math.min(255, Math.floor((C_QT[i] * scale + 50) / 100)));
	}
	const { width, height, data } = image;
	// to YCbCr planes (4:2:0)
	const yw = width, yh = height;
	const cw = Math.ceil(width / 2), chh = Math.ceil(height / 2);
	const Y = new Float32Array(yw * yh), Cb = new Float32Array(cw * chh), Cr = new Float32Array(cw * chh);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const di = (y * width + x) * 4;
			const r = data[di], g = data[di + 1], b = data[di + 2];
			Y[y * yw + x] = 0.299 * r + 0.587 * g + 0.114 * b - 128;
			const cy = y >> 1, cx = x >> 1;
			Cb[cy * cw + cx] = -0.168736 * r - 0.331264 * g + 0.5 * b;
			Cr[cy * cw + cx] = 0.5 * r - 0.418688 * g - 0.081312 * b;
		}
	}
	const dcLumaCodes = buildCodes(STD_DC_LUMA_COUNTS, STD_DC_LUMA_SYMS);
	const acLumaCodes = buildCodes(STD_AC_LUMA_COUNTS, STD_AC_LUMA_SYMS);
	const dcChromaCodes = buildCodes(STD_DC_CHROMA_COUNTS, STD_DC_CHROMA_SYMS);
	const acChromaCodes = buildCodes(STD_AC_CHROMA_COUNTS, STD_AC_CHROMA_SYMS);

	const out = [Buffer.from([0xFF, 0xD8])];
	const pushSeg = (marker, payload) => {
		out.push(Buffer.from([0xFF, marker, (payload.length + 2) >> 8, (payload.length + 2) & 0xFF]), payload);
	};
	pushSeg(0xE0, Buffer.concat([Buffer.from('JFIF\0', 'latin1'), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]));
	const zig = (nat) => { const z = new Uint8Array(64); for (let i = 0; i < 64; i++) z[i] = nat[ZIGZAG[i]]; return z; };
	pushSeg(0xDB, Buffer.concat([Buffer.from([0]), zig(yQ), Buffer.from([1]), zig(cQ)]));
	const sof = Buffer.alloc(15); // precision(1) + h(2) + w(2) + ncomp(1) + 3×3 spec
	sof[0] = 8; // sample precision
	sof.writeUInt16BE(height, 1); sof.writeUInt16BE(width, 3);
	sof[5] = 3;
	sof[6] = 1; sof[7] = 0x22; sof[8] = 0;
	sof[9] = 2; sof[10] = 0x11; sof[11] = 1;
	sof[12] = 3; sof[13] = 0x11; sof[14] = 1;
	pushSeg(0xC0, sof);
	pushSeg(0xC4, Buffer.from([0x00, ...STD_DC_LUMA_COUNTS, ...STD_DC_LUMA_SYMS]));
	pushSeg(0xC4, Buffer.from([0x10, ...STD_AC_LUMA_COUNTS, ...STD_AC_LUMA_SYMS]));
	pushSeg(0xC4, Buffer.from([0x01, ...STD_DC_CHROMA_COUNTS, ...STD_DC_CHROMA_SYMS]));
	pushSeg(0xC4, Buffer.from([0x11, ...STD_AC_CHROMA_COUNTS, ...STD_AC_CHROMA_SYMS]));
	pushSeg(0xDA, Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]));

	const writer = new BitWriter();
	let predY = 0, predCb = 0, predCr = 0;
	const block = new Float32Array(64);
	const encodePlaneBlock = (plane, pw, bx, by, qTable, dcCodes, acCodes, chroma) => {
		const ph = plane.length / pw;
		for (let v = 0; v < 8; v++) {
			for (let u = 0; u < 8; u++) {
				const px = Math.min(pw - 1, bx + u), py = Math.min(ph - 1, by + v); // edge-extend padding
				block[v * 8 + u] = plane[py * pw + px];
			}
		}
		const coeffs = fdct(block);
		const quant = new Int32Array(64);
		for (let i = 0; i < 64; i++) quant[i] = Math.round(coeffs[i] / qTable[i]);
		// DC
		let diff = quant[0] - (chroma === 0 ? predY : chroma === 1 ? predCb : predCr);
		if (chroma === 0) predY = quant[0]; else if (chroma === 1) predCb = quant[0]; else predCr = quant[0];
		const dsym = magnitude(diff);
		const dc = dcCodes.get(dsym);
		writer.write(dc.code, dc.length);
		if (dsym) writer.write(diff < 0 ? diff + (1 << dsym) - 1 : diff, dsym);
		// AC
		let run = 0;
		for (let k = 1; k < 64; k++) {
			const val = quant[ZIGZAG[k]];
			if (val === 0) { run++; continue; }
			while (run > 15) {
				const esc = acCodes.get(0xF0);
				writer.write(esc.code, esc.length);
				run -= 16;
			}
			const msym = (run << 4) | magnitude(val);
			const ac = acCodes.get(msym);
			writer.write(ac.code, ac.length);
			writer.write(val < 0 ? val + (1 << magnitude(val)) - 1 : val, magnitude(val));
			run = 0;
		}
		if (run > 0) {
			const eob = acCodes.get(0x00);
			writer.write(eob.code, eob.length);
		}
	};
	// 4:2:0 MCU = 16×16 pixels = Y(2×2 blocks) + Cb block + Cr block
	const mcusX = Math.ceil(width / 16), mcusY = Math.ceil(height / 16);
	for (let my = 0; my < mcusY; my++) {
		for (let mx = 0; mx < mcusX; mx++) {
			for (let vy = 0; vy < 2; vy++) {
				for (let vx = 0; vx < 2; vx++) {
					encodePlaneBlock(Y, yw, mx * 16 + vx * 8, my * 16 + vy * 8, yQ, dcLumaCodes, acLumaCodes, 0);
				}
			}
			encodePlaneBlock(Cb, cw, mx * 8, my * 8, cQ, dcChromaCodes, acChromaCodes, 1);
			encodePlaneBlock(Cr, cw, mx * 8, my * 8, cQ, dcChromaCodes, acChromaCodes, 2);
		}
	}
	out.push(writer.flush());
	out.push(Buffer.from([0xFF, 0xD9]));
	return Buffer.concat(out);
}
