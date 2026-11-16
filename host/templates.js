/**
 * DesignCraft built-in templates (OpenDesign fusion: scenes + atoms).
 * Each template: { id, name, kind: 'deck'|'canvas', tags, description, build(vars) → {pages...} }
 * Host-side instantiation works headless (pure JSON transform).
 */
import { buildLayoutSlide, nextId, THEMES, defaultDesignSystem } from './decklayouts.js';

function canvasDoc(type, title, canvasSize, pages, designSystem) {
	return {
		version: 1, id: nextId('doc').replace('doc_', 'doc-'), title, type,
		canvas: canvasSize, designSystem: designSystem || defaultDesignSystem(),
		assets: [], pages
	};
}

function posterLayers(vars, ds, W, H) {
	const ink = 'var(--color-ink)', primary = 'var(--color-primary)', muted = 'var(--color-muted)';
	return [
		{ id: nextId('bg'), type: 'shape', name: '底色', shape: 'rect', x: 0, y: 0, w: W, h: H, fill: 'var(--color-bg)' },
		{ id: nextId('band'), type: 'shape', name: '主视觉带', shape: 'rect', x: 0, y: H * 0.58, w: W, h: H * 0.42, fill: { kind: 'linear', angle: 25, stops: [[0, primary], [1, 'var(--color-surface)']] } },
		...(vars.imageAsset ? [{ id: nextId('img'), type: 'image', name: '主图', asset: vars.imageAsset, x: W * 0.08, y: H * 0.08, w: W * 0.84, h: H * 0.44, rotation: 0, opacity: 1, style: { shadow: { color: 'rgba(0,0,0,0.3)', blur: 24, distance: 8, angle: 90 } } }] : []),
		{ id: nextId('t1'), type: 'text', name: '主标题', text: vars.title || '活动标题', x: W * 0.08, y: H * 0.62, w: W * 0.84, h: H * 0.16, fontSize: Math.round(W * 0.085), bold: true, color: ink, rotation: 0, opacity: 1, fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
		{ id: nextId('t2'), type: 'text', name: '副标题', text: vars.subtitle || vars.body || '', x: W * 0.08, y: H * 0.79, w: W * 0.84, h: H * 0.1, fontSize: Math.round(W * 0.032), color: muted, rotation: 0, opacity: 1, fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' },
		{ id: nextId('t3'), type: 'text', name: '信息', text: vars.meta || '时间 · 地点 · 主办方', x: W * 0.08, y: H * 0.9, w: W * 0.84, h: H * 0.06, fontSize: Math.round(W * 0.024), color: ink, rotation: 0, opacity: 0.85, fontFamily: 'Segoe UI, Microsoft YaHei, sans-serif' }
	];
}

const POSTER_SIZES = { a4: { width: 794, height: 1123 }, square: { width: 1080, height: 1080 }, story: { width: 720, height: 1280 }, banner: { width: 1500, height: 500 } };

export const TEMPLATES = [
	{
		id: 'poster-a4', name: '活动海报 A4', kind: 'canvas', tags: ['海报', '打印'],
		description: '标准活动海报：主图区 + 渐变信息带。vars: title/subtitle/meta/imageAsset',
		build: (vars = {}, designSystem) => {
			const size = POSTER_SIZES.a4;
			return canvasDoc('canvas', vars.title || '活动海报', size,
				[{ id: nextId('pg'), name: '海报', layout: 'poster', background: { kind: 'solid', color: 'var(--color-bg)' }, layers: posterLayers(vars, designSystem, size.width, size.height), notes: '', transition: { kind: 'none', duration: 0 } }],
				designSystem);
		}
	},
	{
		id: 'poster-square', name: '社交方图', kind: 'canvas', tags: ['社交', '媒体'],
		description: '1080×1080 社交媒体图。vars: title/subtitle/meta/imageAsset',
		build: (vars = {}, designSystem) => {
			const size = POSTER_SIZES.square;
			return canvasDoc('canvas', vars.title || '社交方图', size,
				[{ id: nextId('pg'), name: '方图', layout: 'poster', background: { kind: 'solid', color: 'var(--color-bg)' }, layers: posterLayers(vars, designSystem, size.width, size.height), notes: '', transition: { kind: 'none', duration: 0 } }],
				designSystem);
		}
	},
	{
		id: 'poster-story', name: '竖版快拍', kind: 'canvas', tags: ['社交', '快拍'],
		description: '720×1280 手机竖版。vars: title/subtitle/meta/imageAsset',
		build: (vars = {}, designSystem) => {
			const size = POSTER_SIZES.story;
			return canvasDoc('canvas', vars.title || '快拍', size,
				[{ id: nextId('pg'), name: '快拍', layout: 'poster', background: { kind: 'solid', color: 'var(--color-bg)' }, layers: posterLayers(vars, designSystem, size.width, size.height), notes: '', transition: { kind: 'none', duration: 0 } }],
				designSystem);
		}
	},
	{
		id: 'banner-wide', name: '横幅 Banner', kind: 'canvas', tags: ['网页', '横幅'],
		description: '1500×500 网页横幅。vars: title/subtitle/imageAsset',
		build: (vars = {}, designSystem) => {
			const size = POSTER_SIZES.banner;
			const layers = [
				{ id: nextId('bg'), type: 'shape', name: '底', shape: 'rect', x: 0, y: 0, w: size.width, h: size.height, fill: { kind: 'linear', angle: 15, stops: [[0, 'var(--color-primary)'], [1, 'var(--color-bg)']] } },
				{ id: nextId('t1'), type: 'text', name: '标题', text: vars.title || 'Banner 标题', x: size.width * 0.06, y: size.height * 0.26, w: size.width * 0.6, h: size.height * 0.3, fontSize: 72, bold: true, color: 'var(--color-ink)' },
				{ id: nextId('t2'), type: 'text', name: '副标题', text: vars.subtitle || '', x: size.width * 0.06, y: size.height * 0.58, w: size.width * 0.6, h: size.height * 0.2, fontSize: 28, color: 'var(--color-muted)' },
				...(vars.imageAsset ? [{ id: nextId('img'), type: 'image', name: '配图', asset: vars.imageAsset, x: size.width * 0.68, y: size.height * 0.1, w: size.width * 0.26, h: size.height * 0.8, rotation: 0, opacity: 1 }] : [])
			];
			return canvasDoc('canvas', vars.title || '横幅', size,
				[{ id: nextId('pg'), name: '横幅', layout: 'banner', background: { kind: 'solid', color: 'var(--color-bg)' }, layers, notes: '', transition: { kind: 'none', duration: 0 } }], designSystem);
		}
	},
	{
		id: 'deck-product-launch', name: '产品发布 Deck', kind: 'deck', tags: ['PPT', '发布'],
		description: '8 页产品发布结构：封面/痛点/方案/特性×2/数据/路线图/结尾。',
		build: (vars = {}, designSystem) => {
			const theme = vars.theme || 'midnight';
			const slides = [
				{ layout: 'sectionHeader', title: vars.sectionName || '问题', subtitle: '为什么现在必须改变' },
				{ layout: 'titleContent', title: '现状痛点', bullets: vars.painPoints || ['效率低', '成本高', '体验差'], notes: '用真实数据支撑每条痛点' },
				{ layout: 'titleContent', title: '我们的方案', bullets: vars.solutions || ['更快的引擎', '更低的成本', '更好的体验'] },
				{ layout: 'comparison', title: '对比', leftTitle: '过去', leftBullets: vars.painPoints || ['旧方式'], rightTitle: '现在', rightBullets: vars.solutions || ['新方式'] },
				{ layout: 'contentPicture', title: '产品一览', imageAsset: vars.imageAsset || null },
				{ layout: 'chart', title: '关键数据', chartKind: 'bar', chart: { labels: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: '增长', values: [20, 45, 65, 90] }] } },
				{ layout: 'titleContent', title: '路线图', bullets: vars.roadmap || ['Q1 内测', 'Q2 公测', 'Q3 正式版'] },
				{ layout: 'quote', title: '让设计人人可用', author: 'DesignCraft 团队' }
			];
			const pages = slides.map(s => buildLayoutSlide(s.layout, s, theme));
			pages.unshift(buildLayoutSlide('title', { title: vars.title || '产品发布', subtitle: vars.subtitle || '', footer: vars.footer || '' }, theme));
			return canvasDoc('deck', vars.title || '产品发布', { width: 1280, height: 720 }, pages, designSystem);
		}
	},
	{
		id: 'deck-weekly-report', name: '周报 Deck', kind: 'deck', tags: ['PPT', '汇报'],
		description: '6 页周报：封面/本周完成/数据/问题/下周计划/备注。',
		build: (vars = {}, designSystem) => {
			const theme = vars.theme || 'corporate';
			const slides = [
				{ layout: 'titleContent', title: '本周完成', bullets: vars.done || ['完成 A', '完成 B'] },
				{ layout: 'chart', title: '数据看板', chartKind: vars.chartKind || 'line', chart: vars.chart || { labels: ['周一', '周二', '周三', '周四', '周五'], series: [{ name: '进度', values: [10, 25, 45, 70, 95] }] } },
				{ layout: 'titleContent', title: '问题与风险', bullets: vars.risks || ['风险 1'] },
				{ layout: 'titleContent', title: '下周计划', bullets: vars.next || ['计划 1'] }
			];
			const pages = slides.map(s => buildLayoutSlide(s.layout, s, theme));
			pages.unshift(buildLayoutSlide('title', { title: vars.title || '周报', subtitle: vars.subtitle || vars.meta || '' }, theme));
			return canvasDoc('deck', vars.title || '周报', { width: 1280, height: 720 }, pages, designSystem);
		}
	},
	{
		id: 'deck-lecture', name: '授课 Deck', kind: 'deck', tags: ['PPT', '教育'],
		description: '6 页课程结构：封面/目标/概念/示例/练习/小结。',
		build: (vars = {}, designSystem) => {
			const theme = vars.theme || 'forest';
			const slides = [
				{ layout: 'titleContent', title: '学习目标', bullets: vars.goals || ['理解概念', '掌握方法'] },
				{ layout: 'titleContent', title: '核心概念', bullets: vars.concepts || ['概念 1', '概念 2'] },
				{ layout: 'contentPicture', title: '示例讲解', imageAsset: vars.imageAsset || null },
				{ layout: 'titleContent', title: '课堂练习', bullets: vars.exercises || ['练习 1'] },
				{ layout: 'quote', title: vars.summary || '本节小结', author: vars.author || '' }
			];
			const pages = slides.map(s => buildLayoutSlide(s.layout, s, theme));
			pages.unshift(buildLayoutSlide('title', { title: vars.title || '课程', subtitle: vars.subtitle || '' }, theme));
			return canvasDoc('deck', vars.title || '课程', { width: 1280, height: 720 }, pages, designSystem);
		}
	},
	{
		id: 'canvas-moodboard', name: '情绪板', kind: 'canvas', tags: ['设计', '灵感'],
		description: '四宫格情绪板画板，替换 4 张图片即可使用。',
		build: (vars = {}, designSystem) => {
			const W = 1200, H = 900;
			const cell = (x, y, asset, label) => ([
				...(asset ? [{ id: nextId('img'), type: 'image', name: label, asset, x, y, w: W / 2 - 30, h: H / 2 - 30, rotation: 0, opacity: 1 }] : [{ id: nextId('ph'), type: 'shape', name: label + ' 占位', shape: 'roundRect', x, y, w: W / 2 - 30, h: H / 2 - 30, fill: 'var(--color-surface)', radius: 0.08 }]),
			]);
			const layers = [
				{ id: nextId('bg'), type: 'shape', name: '底', shape: 'rect', x: 0, y: 0, w: W, h: H, fill: 'var(--color-bg)' },
				...cell(20, 20, vars.image1, '图 1'), ...cell(W / 2 + 10, 20, vars.image2, '图 2'),
				...cell(20, H / 2 + 10, vars.image3, '图 3'), ...cell(W / 2 + 10, H / 2 + 10, vars.image4, '图 4'),
				{ id: nextId('t'), type: 'text', name: '标题', text: vars.title || '情绪板', x: 20, y: H - 60, w: W - 40, h: 44, fontSize: 30, bold: true, color: 'var(--color-ink)' }
			];
			return canvasDoc('canvas', vars.title || '情绪板', { width: W, height: H },
				[{ id: nextId('pg'), name: '情绪板', layout: 'moodboard', background: { kind: 'solid', color: 'var(--color-bg)' }, layers, notes: '', transition: { kind: 'none', duration: 0 } }], designSystem);
		}
	},
	{
		id: 'canvas-dashboard', name: '数据仪表盘', kind: 'canvas', tags: ['设计', '数据'],
		description: '仪表盘画板：KPI 卡片×3 + 柱状图 + 折线图。',
		build: (vars = {}, designSystem) => {
			const W = 1440, H = 900;
			const kpi = (x, label, value) => ([
				{ id: nextId('card'), type: 'shape', name: label + ' 卡', shape: 'roundRect', x, y: 90, w: 280, h: 140, fill: 'var(--color-surface)', radius: 0.1, style: { shadow: { color: 'rgba(0,0,0,0.12)', blur: 16, distance: 4, angle: 90 } } },
				{ id: nextId('kl'), type: 'text', name: label, text: label, x: x + 24, y: 112, w: 232, h: 30, fontSize: 18, color: 'var(--color-muted)' },
				{ id: nextId('kv'), type: 'text', name: value, text: value, x: x + 24, y: 150, w: 232, h: 56, fontSize: 40, bold: true, color: 'var(--color-primary)' }
			]);
			const layers = [
				{ id: nextId('bg'), type: 'shape', name: '底', shape: 'rect', x: 0, y: 0, w: W, h: H, fill: 'var(--color-bg)' },
				{ id: nextId('title'), type: 'text', name: '标题', text: vars.title || '数据仪表盘', x: 60, y: 28, w: 600, h: 48, fontSize: 34, bold: true, color: 'var(--color-ink)' },
				...kpi(60, '用户数', vars.kpi1 || '12,480'), ...kpi(380, '转化率', vars.kpi2 || '4.2%'), ...kpi(700, '营收', vars.kpi3 || '¥860K'),
				{ id: nextId('c1'), type: 'chart', name: '柱状图', chartKind: 'bar', x: 60, y: 280, w: 620, h: 420, data: vars.bar || { labels: ['一月', '二月', '三月', '四月', '五月', '六月'], series: [{ name: '新增', values: [120, 200, 150, 90, 240, 300] }] }, colors: ['var(--color-primary)', 'var(--color-accent)'] },
				{ id: nextId('c2'), type: 'chart', name: '折线图', chartKind: 'line', x: 720, y: 280, w: 660, h: 420, data: vars.line || { labels: ['周一', '周二', '周三', '周四', '周五'], series: [{ name: '活跃', values: [400, 480, 460, 520, 610] }] }, colors: ['var(--color-accent)', 'var(--color-primary)'] }
			];
			return canvasDoc('canvas', vars.title || '仪表盘', { width: W, height: H },
				[{ id: nextId('pg'), name: '仪表盘', layout: 'dashboard', background: { kind: 'solid', color: 'var(--color-bg)' }, layers, notes: '', transition: { kind: 'none', duration: 0 } }], designSystem);
		}
	}
];

export function listTemplates() {
	return TEMPLATES.map(({ id, name, kind, tags, description }) => ({ id, name, kind, tags, description }));
}

export function getTemplate(id) {
	return TEMPLATES.find(t => t.id === id) || null;
}

/** Instantiate a template headlessly. Returns a fresh dcDoc. */
export function instantiateTemplate(id, vars = {}, designSystem) {
	const tpl = getTemplate(id);
	if (!tpl) return null;
	const doc = tpl.build(vars, designSystem);
	doc.template = { id: tpl.id, name: tpl.name };
	return doc;
}
