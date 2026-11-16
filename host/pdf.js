/**
 * DesignCraft PDF exporter.
 * Path A (preferred): client renders page bitmaps → exportPdfFromClientPages (full fidelity, CJK ok).
 * Path B (headless fallback): exportPdfHeadless draws background/images/shapes/vector paths;
 *      text is drawn only for Latin-1 (Helvetica); CJK text is skipped with warnings.
 */
import { deflateSync } from 'node:zlib';
import { fromPNG, colorToHex, colorAlpha, parseColor } from './raster.js';
import { parseSegments } from './pptx.js';
import { textToPdfPaths, fontStatus } from './font.js';

function pdfEscape(s) {
	return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function toWinAnsi(s) {
	// Keep Latin-1 range; drop the rest (CJK) — reported as warnings by the caller.
	let out = '';
	for (const ch of String(s)) {
		const code = ch.codePointAt(0);
		if (code >= 32 && code <= 126) out += ch;
		else if (code >= 160 && code <= 255) out += ch; // PDFDocEncoding ≈ Latin-1 here
		else out += '?';
	}
	return out;
}

class PdfBuilder {
	constructor() {
		this.objects = []; // {num, body:string|Buffer, stream?:Buffer, dict?:string}
	}

	add(body) {
		this.objects.push(body);
		return this.objects.length; // 1-based object number
	}

	addStream(dict, data) {
		dict=String(dict).trim();
		if(dict.startsWith('<<')&&dict.endsWith('>>'))dict=dict.slice(2,-2).trim();
		const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1');
		this.objects.push({ streamDict: dict, data: buf });
		return this.objects.length;
	}

	build(rootNum) {
		const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
		const offsets = [0];
		this.objects.forEach((obj, i) => {
			offsets.push(chunks.reduce((a, c) => a + c.length, 0));
			const num = i + 1;
			if (typeof obj === 'string') {
				chunks.push(Buffer.from(`${num} 0 obj\n${obj}\nendobj\n`, 'latin1'));
			} else if ('streamDict' in obj) {
				chunks.push(Buffer.from(`${num} 0 obj\n<<${obj.streamDict} /Length ${obj.data.length}>>\nstream\n`, 'latin1'));
				chunks.push(obj.data);
				chunks.push(Buffer.from('\nendstream\nendobj\n', 'latin1'));
			} else if (Buffer.isBuffer(obj)) {
				chunks.push(Buffer.from(`${num} 0 obj\n`, 'latin1'), obj, Buffer.from('\nendobj\n', 'latin1'));
			}
		});
		const xrefStart = chunks.reduce((a, c) => a + c.length, 0);
		let xref = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
		for (let i = 1; i <= this.objects.length; i++) xref += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
		chunks.push(Buffer.from(xref + `trailer\n<< /Size ${this.objects.length + 1} /Root ${rootNum} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`, 'latin1'));
		return Buffer.concat(chunks);
	}
}

const pt = (px) => Number(px) * 0.75; // px@96dpi → pt

/** Build an image-only PDF from rendered page buffers (png or jpeg). */
export function exportPdfFromClientPages(pages) {
	const pdf = new PdfBuilder();
	const catalogNum = pdf.add('PLACEHOLDER_CATALOG');
	const pagesNum = pdf.add('PLACEHOLDER_PAGES');
	const fontNum = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
	const pageObjNums = [];
	const kids = [];
	for (const page of pages) {
		const buf = page.buffer;
		const isJpeg = page.kind === 'jpeg' || (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8);
		let imageDict; let imageStream;
		if (isJpeg) {
			const dims = jpegSize(buf);
			imageStream = buf;
			imageDict = `<< /Type /XObject /Subtype /Image /Width ${dims.width} /Height ${dims.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`;
		} else {
			const img = fromPNG(buf);
			const rgb = Buffer.alloc(img.width * img.height * 3);
			for (let i = 0, j = 0; i < img.data.length; i += 4) {
				const a = img.data[i + 3] / 255;
				rgb[j++] = img.data[i] * a + 255 * (1 - a);
				rgb[j++] = img.data[i + 1] * a + 255 * (1 - a);
				rgb[j++] = img.data[i + 2] * a + 255 * (1 - a);
			}
			imageStream = deflateSync(rgb, { level: 6 });
			imageDict = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>`;
		}
		const imgNum = pdf.addStream(imageDict, imageStream);
		const wPt = pt(page.widthPx || 1280), hPt = pt(page.heightPx || 720);
		const content = `q ${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm /Im1 Do Q`;
		const contentNum = pdf.addStream('', content);
		const pageNum = pdf.add(`<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] /Resources << /XObject << /Im1 ${imgNum} 0 R >> /Font << /F1 ${fontNum} 0 R >> >> /Contents ${contentNum} 0 R >>`);
		pageObjNums.push(pageNum);
		kids.push(`${pageNum} 0 R`);
	}
	pdf.objects[catalogNum - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
	pdf.objects[pagesNum - 1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
	return pdf.build(catalogNum);
}

function jpegSize(buf) {
	let i = 2;
	while (i < buf.length) {
		if (buf[i] !== 0xFF) { i++; continue; }
		const marker = buf[i + 1];
		if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
			return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
		}
		i += 2 + buf.readUInt16BE(i + 2);
	}
	return { width: 1280, height: 720 };
}

/**
 * Headless fallback: draws background / images / shapes / vector paths / tables / bar-chart rects.
 * Returns { buffer, warnings:[...] }.
 */
export function exportPdfHeadless(doc, loadAsset) {
	const warnings = [];
	const pdf = new PdfBuilder();
	const catalogNum = pdf.add('PLACEHOLDER_CATALOG');
	const pagesNum = pdf.add('PLACEHOLDER_PAGES');
	const fontNum = pdf.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
	const widthPx = doc.canvas?.width || 1280, heightPx = doc.canvas?.height || 720;
	const W = pt(widthPx), H = pt(heightPx);
	const pageObjNums = [];
	const kids = [];

	const colorOp = (color, op, alpha = 1) => {
		const hex = colorToHex(color, '000000');
		const nums = [0, 2, 4].map(i => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3));
		return `${nums.join(' ')} ${op}${alpha < 1 ? ` /CA ${alpha.toFixed(3)} /ca ${alpha.toFixed(3)}` : ''}\n`;
	};

	const graphicsForPage = (page) => {
		let g = '';
		const images=[];
		const bg = page.background;
		const bgColor = typeof bg === 'string' ? bg : bg?.kind === 'solid' ? bg.color : (bg?.kind === 'linear' || bg?.kind === 'gradient' ? bg.stops?.[0]?.[1] : '#FFFFFF');
		g += colorOp(bgColor || '#FFFFFF', 'rg') + `0 0 ${W.toFixed(2)} ${H.toFixed(2)} re f\n`;
		const drawLayers = (layers) => {
			for (const layer of layers || []) {
				if (layer.hidden || layer.visible === false) continue;
				if (layer.type === 'group') { drawLayers(layer.children); continue; }
				if (layer.type === 'adjustment') continue;
				const x = pt(layer.x || 0), y = H - pt((layer.y || 0)) - pt(layer.h ?? layer.height ?? 100);
				const w = pt(layer.w ?? layer.width ?? 100), h = pt(layer.h ?? layer.height ?? 100);
				if (layer.type === 'image') {
					const src = layer.asset?.src || layer.asset;
					const buffer = src ? loadAsset(src) : null;
					if (!buffer) { warnings.push(`图片缺失 ${src}`); continue; }
					let imgDict; let stream;
					if (buffer.length > 3 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
						const dims = jpegSize(buffer);
						imgDict = `<< /Type /XObject /Subtype /Image /Width ${dims.width} /Height ${dims.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode >>`;
						stream = buffer;
					} else {
						try {
							const img = fromPNG(buffer);
							const rgb = Buffer.alloc(img.width * img.height * 3);
							for (let i = 0, j = 0; i < img.data.length; i += 4) {
								const a = img.data[i + 3] / 255;
								rgb[j++] = img.data[i] * a + 255 * (1 - a);
								rgb[j++] = img.data[i + 1] * a + 255 * (1 - a);
								rgb[j++] = img.data[i + 2] * a + 255 * (1 - a);
							}
							imgDict = `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>`;
							stream = deflateSync(rgb, { level: 6 });
						} catch { warnings.push(`图片格式不支持 ${src}`); continue; }
					}
					const imgNum = pdf.addStream(imgDict, stream);
					images.push({name:'Im'+imgNum,num:imgNum});
					g += `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm /Im${imgNum} Do Q\n`;
				} else if (layer.type === 'shape' && (!layer.shape || ['rect', 'roundrect', 'roundedrectangle', 'ellipse', 'circle'].includes(String(layer.shape).toLowerCase()))) {
					const fill = layer.fill && layer.fill !== 'none' ? (layer.fill.color || layer.fill) : null;
					const isEllipse = ['ellipse', 'circle'].includes(String(layer.shape).toLowerCase());
					const isRound = ['roundrect', 'roundedrectangle'].includes(String(layer.shape).toLowerCase());
					if (fill) {
						g += colorOp(fill, 'rg', layer.opacity ?? 1);
						if (isEllipse) {
							g += ellipsePath(x, y, w, h) + ' f\n';
						} else if (isRound) {
							g += roundRectPath(x, y, w, h, Math.min(w, h) * (layer.radius ?? 0.15)) + ' f\n';
						} else g += `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`;
					}
				} else if (layer.type === 'chart') {
					g += chartPdfOps(layer, H, colorOp);
				} else if (layer.type === 'vector') {
					for (const p of layer.paths || []) {
						if (p.fill && p.fill !== 'none') g += colorOp(typeof p.fill === 'string' ? p.fill : (p.fill.color || '#888888'), 'rg', (typeof p.fill === 'object' ? (p.fill.opacity ?? 1) : 1) * (layer.opacity ?? 1));
						g += pathOps(p.d, layer.x || 0, layer.y || 0, H);
						g += (p.fill && p.fill !== 'none' ? 'f' : 'S') + '\n';
					}
				} else if (layer.type === 'text') {
					const rawText = String(layer.text ?? '');
					const hasCJK = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(rawText);
					// preferred: glyph-outline rendering via system TrueType font (full CJK fidelity)
					let outline = null;
					try {
						outline = textToPdfPaths(rawText, {
							x: pt(layer.align === 'center' ? (layer.x || 0) + (layer.w || 0) / 2 : layer.align === 'right' ? (layer.x || 0) + (layer.w || 0) : (layer.x || 0)),
							y: H - pt((layer.y || 0) + (layer.fontSize || 24)),
							fontSizePx: layer.fontSize || 24,
							lineHeight: layer.lineHeight || 1.4,
							bold: !!layer.bold,
							align: layer.align === 'center' || layer.align === 'right' ? layer.align : 'left'
						});
					} catch { outline = null; }
					if (outline && outline.ops.length) {
						g += colorOp(layer.color || '#202936', 'rg', layer.opacity ?? 1);
						g += outline.ops.join('\n') + ' f\n';
						for (const w of outline.warnings) warnings.push(w);
					} else if (hasCJK) {
						warnings.push(`无头 PDF 中文字体不可用，文字层 "${layer.name || ''}" 被跳过（请用客户端渲染导出获得完整保真）`);
					} else if (rawText.trim()) {
						const text = toWinAnsi(rawText);
						const size = pt(layer.fontSize || 24);
						const lines = text.split(/\r?\n/);
						g += `BT /F1 ${size.toFixed(1)} Tf ${colorOp(layer.color || '#202936', 'rg')}${x.toFixed(2)} ${(y + h - size).toFixed(2)} Td`;
						lines.forEach((line, i) => { g += `${i ? ` 0 ${(-size * 1.4).toFixed(1)} Td` : ''} (${pdfEscape(line)}) Tj`; });
						g += ' ET\n';
					}
				}
			}
		};
		drawLayers(page.layers || []);
		return {graphics:g,images};
	};

	for (const page of doc.pages || []) {
		const rendered=graphicsForPage(page);
		const contentNum = pdf.addStream('', rendered.graphics);
		const pageNum = pdf.add(`<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}] /Resources << /Font << /F1 ${fontNum} 0 R >> /XObject << ${rendered.images.map(image=>'/'+image.name+' '+image.num+' 0 R').join(' ')} >> >> /Contents ${contentNum} 0 R >>`);
		pageObjNums.push(pageNum);
		kids.push(`${pageNum} 0 R`);
	}
	pdf.objects[catalogNum - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`;
	pdf.objects[pagesNum - 1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
	return { buffer: pdf.build(catalogNum), warnings };
}

function ellipsePath(x, y, w, h) {
	const k = 0.5523;
	const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
	return `${(cx + rx).toFixed(2)} ${cy.toFixed(2)} m ` +
		`${(cx + rx).toFixed(2)} ${(cy + k * ry).toFixed(2)} ${(cx + k * rx).toFixed(2)} ${(cy + ry).toFixed(2)} ${cx.toFixed(2)} ${(cy + ry).toFixed(2)} c ` +
		`${(cx - k * rx).toFixed(2)} ${(cy + ry).toFixed(2)} ${(cx - rx).toFixed(2)} ${(cy + k * ry).toFixed(2)} ${(cx - rx).toFixed(2)} ${cy.toFixed(2)} c ` +
		`${(cx - rx).toFixed(2)} ${(cy - k * ry).toFixed(2)} ${(cx - k * rx).toFixed(2)} ${(cy - ry).toFixed(2)} ${cx.toFixed(2)} ${(cy - ry).toFixed(2)} c ` +
		`${(cx + k * rx).toFixed(2)} ${(cy - ry).toFixed(2)} ${(cx + rx).toFixed(2)} ${(cy - k * ry).toFixed(2)} ${(cx + rx).toFixed(2)} ${cy.toFixed(2)} c`;
}

function roundRectPath(x, y, w, h, r) {
	const rr = Math.max(0, Math.min(r, w / 2, h / 2));
	const k = 0.5523 * rr;
	return `${(x + rr).toFixed(2)} ${y.toFixed(2)} m ` +
		`${(x + w - rr).toFixed(2)} ${y.toFixed(2)} l ${(x + w - rr + k).toFixed(2)} ${y.toFixed(2)} ${(x + w).toFixed(2)} ${(y + rr - k).toFixed(2)} ${(x + w).toFixed(2)} ${(y + rr).toFixed(2)} c ` +
		`${(x + w).toFixed(2)} ${(y + h - rr).toFixed(2)} l ${(x + w).toFixed(2)} ${(y + h - rr + k).toFixed(2)} ${(x + w - rr + k).toFixed(2)} ${(y + h).toFixed(2)} ${(x + w - rr).toFixed(2)} ${(y + h).toFixed(2)} c ` +
		`${(x + rr).toFixed(2)} ${(y + h).toFixed(2)} l ${(x + rr - k).toFixed(2)} ${(y + h).toFixed(2)} ${x.toFixed(2)} ${(y + h - rr + k).toFixed(2)} ${x.toFixed(2)} ${(y + h - rr).toFixed(2)} c ` +
		`${x.toFixed(2)} ${(y + rr).toFixed(2)} l ${(x).toFixed(2)} ${(y + rr - k).toFixed(2)} ${(x + rr - k).toFixed(2)} ${y.toFixed(2)} ${(x + rr).toFixed(2)} ${y.toFixed(2)} c`;
}

/** Simple chart rendering for headless PDF (bar/line/pie basics) — mirrors client chart semantics. */
function chartPdfOps(layer, pageH, colorOp) {
	const kind = String(layer.chartKind || 'bar');
	const data = layer.data || {};
	const labels = data.labels || [];
	const series = data.series || [{ name: 'Series 1', values: data.values || [] }];
	const colors = (layer.colors && layer.colors.length ? layer.colors : ['#287D6C', '#8CCFBC', '#9E7129']);
	const X = (px) => pt(layer.x + px);
	const Y = (py) => pageH - pt((layer.y || 0) + py);
	let g = '';
	const rect = (x, y2, w2, h2, hex) => { g += `${hexToRgbStr(hex)} rg ${X(x).toFixed(2)} ${Y(y2 + h2).toFixed(2)} ${pt(w2).toFixed(2)} ${pt(h2).toFixed(2)} re f\n`; };
	if (kind === 'bar') {
		const maxV = Math.max(1, ...series.flatMap(s => (s.values || []).map(Number)));
		const plotH = layer.h * 0.72, plotY = layer.h * 0.18;
		const groupW = layer.w * 0.82 / Math.max(1, labels.length);
		const barW = groupW * 0.7 / series.length;
		series.forEach((s, si) => {
			(s.values || []).forEach((v, vi) => {
				const vh = (Number(v) / maxV) * plotH;
				rect(layer.w * 0.09 + vi * groupW + si * barW, plotY + plotH - vh, barW * 0.92, vh, colors[si % colors.length]);
			});
		});
	} else if (kind === 'pie' || kind === 'donut') {
		const total = Math.max(1e-9, series[0].values.map(Number).reduce((a, b) => a + b, 0));
		const r = Math.min(layer.w, layer.h) * 0.4;
		const cx = layer.w * 0.36, cy = layer.h * 0.5;
		let angle = -Math.PI / 2;
		series[0].values.forEach((v, vi) => {
			const sweep = (Number(v) / total) * Math.PI * 2;
			const a0 = angle, a1 = angle + sweep;
			angle = a1;
			const hex = colors[vi % colors.length];
			g += `${hexToRgbStr(hex)} rg `;
			g += `${X(cx).toFixed(2)} ${Y(cy).toFixed(2)} m `;
			const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 12)));
			for (let k2 = 0; k2 <= steps; k2++) {
				const a = a0 + (sweep * k2) / steps;
				g += `${X(cx + r * Math.cos(a)).toFixed(2)} ${Y(cy + r * Math.sin(a)).toFixed(2)} l `;
			}
			g += 'h f\n';
		});
	}
	return g;
}

function hexToRgbStr(hex) {
	const v = colorToHex(hex, '888888');
	return [0, 2, 4].map(i => (parseInt(v.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
}

function pathOps(d, offX, offY, pageH) {
	let ops = '';
	let cur = null;
	for (const seg of parseSegments(d)) {
		const [cmd, ...args] = seg;
		const fx = (v) => pt(offX + v).toFixed(2);
		const fy = (v) => (pageH - pt(offY + v)).toFixed(2);
		if (cmd === 'M') { cur = [args[0], args[1]]; ops += `${fx(args[0])} ${fy(args[1])} m `; }
		else if (cmd === 'L') { cur = [args[0], args[1]]; ops += `${fx(args[0])} ${fy(args[1])} l `; }
		else if (cmd === 'C') { ops += `${fx(args[0])} ${fy(args[1])} ${fx(args[2])} ${fy(args[3])} ${fx(args[4])} ${fy(args[5])} c `; cur = [args[4], args[5]]; }
		else if (cmd === 'Z') ops += 'h ';
	}
	return ops;
}
