/**
 * DesignCraft deck layout engine (DeckCraft fusion).
 * 11 slide layouts × 8 original themes, generating concrete layer JSON.
 * Shared by: deck.fromOutline command, template.instantiate, client layout gallery.
 */

export const THEMES = {
	midnight: { bg: '#101826', ink: '#ECF0F5', muted: '#8C9AAE', primary: '#5EA8FF', accent: '#8CCFBC', surface: '#1B2536' },
	aurora: { bg: '#0E1F1A', ink: '#EAF5F0', muted: '#93B8A9', primary: '#2FBF8F', accent: '#9EE493', surface: '#143028' },
	ivory: { bg: '#FAF7F2', ink: '#2B2622', muted: '#8A8178', primary: '#B4633A', accent: '#D9A45B', surface: '#FFFFFF' },
	corporate: { bg: '#FFFFFF', ink: '#1A2733', muted: '#64748B', primary: '#2563EB', accent: '#0EA5E9', surface: '#F1F5F9' },
	sunset: { bg: '#1F1418', ink: '#FBEFE8', muted: '#C39A8E', primary: '#E86A4A', accent: '#F2B45C', surface: '#2D1C22' },
	forest: { bg: '#F4F8F4', ink: '#1D2B22', muted: '#71857A', primary: '#287E59', accent: '#7FB069', surface: '#FFFFFF' },
	graphite: { bg: '#17181A', ink: '#F2F2F2', muted: '#9BA0A6', primary: '#9CA3AF', accent: '#E5E7EB', surface: '#242629' },
	crimson: { bg: '#FFFFFF', ink: '#25161A', muted: '#8C7378', primary: '#B44846', accent: '#E1A140', surface: '#FBF3F3' }
};

export const LAYOUT_IDS = ['title', 'titleContent', 'sectionHeader', 'twoContent', 'comparison', 'titleOnly', 'blank', 'contentPicture', 'pictureCaption', 'quote', 'chart'];

let idCounter = 0;
export function nextId(prefix) {
	idCounter += 1;
	return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function themeOf(theme) {
	return THEMES[theme] || THEMES.midnight;
}

function textLayer(page, props) {
	return {
		id: nextId('txt'), type: 'text', rotation: 0, opacity: 1,
		fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif', lineHeight: 1.35, align: 'left', vAlign: 'top',
		...props
	};
}

function backgroundFor(theme) {
	const t = themeOf(theme);
	return { kind: 'solid', color: t.bg };
}

/**
 * Build a slide from a layout id. vars: {title, subtitle, body, bullets, notes, leftTitle, leftBody,
 * rightTitle, rightBody, quote, author, imageUrl, imageAsset, chart, footer}
 */
export function buildLayoutSlide(layoutId, vars = {}, theme = 'midnight', canvas = { width: 1280, height: 720 }) {
	const t = themeOf(theme);
	const W = canvas.width, H = canvas.height;
	const M = Math.round(W * 0.08);
	const layers = [];
	const title = vars.title ?? '';
	const body = vars.body ?? '';
	const bullets = vars.bullets ?? [];
	const footer = vars.footer;

	const footerLayer = footer ? textLayer(null, {
		type: 'text', name: '页脚', text: footer, x: M, y: H - 52, w: W - M * 2, h: 32,
		fontSize: Math.round(H * 0.022), color: t.muted, align: 'left'
	}) : null;

	switch (layoutId) {
		case 'title': {
			layers.push(
				{ id: nextId('bg'), type: 'shape', name: '装饰', shape: 'rect', x: 0, y: H * 0.72, w: W, h: H * 0.28, fill: { kind: 'linear', angle: 0, stops: [[0, t.primary], [1, t.surface]] }, opacity: 0.9 },
				textLayer(null, { name: '主标题', text: title, x: M, y: H * 0.3, w: W - M * 2, h: H * 0.2, fontSize: Math.round(H * 0.09), bold: true, color: t.ink }),
				vars.subtitle ? textLayer(null, { name: '副标题', text: vars.subtitle, x: M, y: H * 0.53, w: W - M * 2, h: H * 0.1, fontSize: Math.round(H * 0.038), color: t.muted }) : null,
				footerLayer
			);
			break;
		}
		case 'titleContent':
		case 'titleOnly': {
			layers.push(
				textLayer(null, { name: '标题', text: title, x: M, y: M * 0.6, w: W - M * 2, h: H * 0.14, fontSize: Math.round(H * 0.06), bold: true, color: t.ink }),
				{ id: nextId('ln'), type: 'shape', name: '强调线', shape: 'rect', x: M, y: M * 0.6 + H * 0.15, w: Math.round(W * 0.1), h: 6, fill: t.primary },
				...(layoutId === 'titleContent' ? [textLayer(null, {
					name: '正文', text: bullets.length ? bullets.map(b => '•  ' + b).join('\n') : body,
					x: M, y: H * 0.3, w: W - M * 2, h: H * 0.55, fontSize: Math.round(H * 0.034), color: t.ink, lineHeight: 1.7
				})] : []),
				footerLayer
			);
			break;
		}
		case 'sectionHeader': {
			layers.push(
				{ id: nextId('bg'), type: 'shape', name: '色块', shape: 'rect', x: 0, y: 0, w: W, h: H, fill: { kind: 'linear', angle: 135, stops: [[0, t.surface], [1, t.bg]] } },
				textLayer(null, { name: '节标题', text: title, x: M, y: H * 0.4, w: W - M * 2, h: H * 0.16, fontSize: Math.round(H * 0.075), bold: true, color: t.ink, align: 'center' }),
				vars.subtitle ? textLayer(null, { name: '节说明', text: vars.subtitle, x: M, y: H * 0.58, w: W - M * 2, h: H * 0.08, fontSize: Math.round(H * 0.032), color: t.muted, align: 'center' }) : null,
				footerLayer
			);
			break;
		}
		case 'twoContent': {
			const colW = (W - M * 2 - Math.round(W * 0.06)) / 2;
			layers.push(
				textLayer(null, { name: '标题', text: title, x: M, y: M * 0.6, w: W - M * 2, h: H * 0.12, fontSize: Math.round(H * 0.055), bold: true, color: t.ink }),
				textLayer(null, { name: '左栏', text: (vars.leftBullets || bullets).map(b => '•  ' + b).join('\n'), x: M, y: H * 0.28, w: colW, h: H * 0.6, fontSize: Math.round(H * 0.03), color: t.ink, lineHeight: 1.7 }),
				textLayer(null, { name: '右栏', text: (vars.rightBullets || vars.rightBody || '').split(/\r?\n/).map(b => '•  ' + b).join('\n'), x: M + colW + Math.round(W * 0.06), y: H * 0.28, w: colW, h: H * 0.6, fontSize: Math.round(H * 0.03), color: t.ink, lineHeight: 1.7 }),
				footerLayer
			);
			break;
		}
		case 'comparison': {
			const colW = (W - M * 2 - Math.round(W * 0.06)) / 2;
			const card = (cx, heading, items) => ([
				{ id: nextId('card'), type: 'shape', name: '卡片', shape: 'roundRect', x: cx, y: H * 0.26, w: colW, h: H * 0.6, fill: t.surface, radius: 0.06 },
				textLayer(null, { name: '栏标题', text: heading, x: cx + 28, y: H * 0.3, w: colW - 56, h: H * 0.08, fontSize: Math.round(H * 0.038), bold: true, color: t.primary }),
				textLayer(null, { name: '栏内容', text: items.map(b => '•  ' + b).join('\n'), x: cx + 28, y: H * 0.4, w: colW - 56, h: H * 0.42, fontSize: Math.round(H * 0.026), color: t.ink, lineHeight: 1.7 })
			]);
			layers.push(
				textLayer(null, { name: '标题', text: title, x: M, y: M * 0.6, w: W - M * 2, h: H * 0.12, fontSize: Math.round(H * 0.055), bold: true, color: t.ink }),
				...card(M, vars.leftTitle || '方案 A', vars.leftBullets || []),
				...card(M + colW + Math.round(W * 0.06), vars.rightTitle || '方案 B', vars.rightBullets || []),
				footerLayer
			);
			break;
		}
		case 'contentPicture': {
			layers.push(
				textLayer(null, { name: '标题', text: title, x: M, y: M * 0.6, w: W - M * 2, h: H * 0.12, fontSize: Math.round(H * 0.055), bold: true, color: t.ink }),
				(vars.imageAsset ? {
					id: nextId('img'), type: 'image', name: '配图', asset: vars.imageAsset,
					x: M, y: H * 0.26, w: W - M * 2, h: H * 0.6, opacity: 1, rotation: 0,
					style: { shadow: { color: 'rgba(0,0,0,0.25)', blur: 18, distance: 6, angle: 90 } }
				} : { id: nextId('ph'), type: 'shape', name: '图片占位', shape: 'roundRect', x: M, y: H * 0.26, w: W - M * 2, h: H * 0.6, fill: t.surface, radius: 0.04, text: '图片占位 — 通过 designcraft 命令 asset.addFromFile 替换', fontSize: Math.round(H * 0.03), color: t.muted, align: 'center', vAlign: 'middle' }),
				footerLayer
			);
			break;
		}
		case 'pictureCaption': {
			const imgW = W * 0.58;
			layers.push(
				(vars.imageAsset ? {
					id: nextId('img'), type: 'image', name: '配图', asset: vars.imageAsset,
					x: M, y: H * 0.14, w: imgW, h: H * 0.72, opacity: 1, rotation: 0
				} : { id: nextId('ph'), type: 'shape', name: '图片占位', shape: 'roundRect', x: M, y: H * 0.14, w: imgW, h: H * 0.72, fill: t.surface, radius: 0.04 }),
				textLayer(null, { name: '标题', text: title, x: M + imgW + Math.round(W * 0.05), y: H * 0.24, w: W - M - (M + imgW + Math.round(W * 0.05)), h: H * 0.2, fontSize: Math.round(H * 0.05), bold: true, color: t.ink }),
				textLayer(null, { name: '说明', text: vars.caption || body, x: M + imgW + Math.round(W * 0.05), y: H * 0.46, w: W - M - (M + imgW + Math.round(W * 0.05)), h: H * 0.4, fontSize: Math.round(H * 0.028), color: t.muted, lineHeight: 1.8 }),
				footerLayer
			);
			break;
		}
		case 'quote': {
			layers.push(
				{ id: nextId('q'), type: 'shape', name: '引号块', shape: 'rect', x: M, y: H * 0.2, w: 8, h: H * 0.42, fill: t.primary },
				textLayer(null, { name: '引言', text: title, x: M + 40, y: H * 0.2, w: W - M * 2 - 40, h: H * 0.34, fontSize: Math.round(H * 0.05), color: t.ink, lineHeight: 1.6, italic: true }),
				vars.author ? textLayer(null, { name: '署名', text: '— ' + vars.author, x: M + 40, y: H * 0.6, w: W - M * 2 - 40, h: H * 0.08, fontSize: Math.round(H * 0.03), color: t.muted }) : null,
				footerLayer
			);
			break;
		}
		case 'chart': {
			layers.push(
				textLayer(null, { name: '标题', text: title, x: M, y: M * 0.6, w: W - M * 2, h: H * 0.12, fontSize: Math.round(H * 0.055), bold: true, color: t.ink }),
				{
					id: nextId('chart'), type: 'chart', name: '图表', chartKind: vars.chartKind || 'bar',
					x: M, y: H * 0.26, w: W - M * 2, h: H * 0.6,
					data: vars.chart || { labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: '系列 1', values: [30, 55, 40, 70] }] },
					colors: [t.primary, t.accent, '#9E7129', '#B44846']
				},
				footerLayer
			);
			break;
		}
		case 'blank':
		default: {
			if (title) layers.push(textLayer(null, { name: '标题', text: title, x: M, y: M * 0.6, w: W - M * 2, h: H * 0.12, fontSize: Math.round(H * 0.05), bold: true, color: t.ink }));
			if (body) layers.push(textLayer(null, { name: '正文', text: body, x: M, y: H * 0.28, w: W - M * 2, h: H * 0.6, fontSize: Math.round(H * 0.032), color: t.ink, lineHeight: 1.7 }));
			layers.push(footerLayer);
			break;
		}
	}
	return {
		id: nextId('pg'), name: title || layoutId, layout: layoutId,
		notes: vars.notes || '', transition: { kind: 'fade', duration: 400 },
		background: backgroundFor(theme),
		layers: layers.filter(Boolean)
	};
}

/** Build a complete deck doc from an outline (DeckCraft fusion: outline → styled deck). */
export function buildDeckFromOutline({ title, subtitle, theme, canvas, footer, slides }) {
	const ds = { ...defaultDesignSystem(), ...{} };
	const t = themeOf(theme);
	ds.colors = { primary: t.primary, accent: t.accent, ink: t.ink, muted: t.muted, bg: t.bg, surface: t.surface };
	const pages = (slides || []).map((s) => buildLayoutSlide(s.layout || (s.bullets ? 'titleContent' : 'blank'), s, theme, canvas));
	pages.unshift(buildLayoutSlide('title', { title, subtitle, footer }, theme, canvas));
	return {
		version: 1,
		id: 'deck-' + Date.now().toString(36),
		title: title || '新演示文稿',
		type: 'deck',
		canvas: canvas || { width: 1280, height: 720 },
		designSystem: ds,
		theme,
		assets: [],
		pages
	};
}

export function defaultDesignSystem() {
	return {
		colors: { primary: '#287D6C', accent: '#9E7129', ink: '#202936', muted: '#74808C', bg: '#F5F6F8', surface: '#FFFFFF', success: '#287E59', warning: '#9E7129', danger: '#B44846' },
		fonts: { heading: 'Segoe UI, Microsoft YaHei, sans-serif', body: 'Segoe UI, Microsoft YaHei, sans-serif' },
		radius: { sm: 6, md: 12, lg: 20 },
		spacing: { sm: 8, md: 16, lg: 32 }
	};
}
