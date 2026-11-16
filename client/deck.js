/**
 * DesignCraft deck module (DeckCraft fusion) — presentation overlay with
 * transitions, layout gallery metadata, and slide thumbnail helpers.
 */
import { renderPageToCanvas } from './engine.js';

export const LAYOUT_GALLERY = [
	{ id: 'title', name: '标题页', hint: '主标题 + 副标题，适合开场' },
	{ id: 'titleContent', name: '标题+要点', hint: '标题与要点列表' },
	{ id: 'sectionHeader', name: '章节页', hint: '章节分隔' },
	{ id: 'twoContent', name: '双栏内容', hint: '左右两栏要点' },
	{ id: 'comparison', name: '对比页', hint: '两张对比卡片' },
	{ id: 'titleOnly', name: '仅标题', hint: '大标题留白页' },
	{ id: 'blank', name: '空白页', hint: '自由排版' },
	{ id: 'contentPicture', name: '图文页', hint: '大图占位 + 标题' },
	{ id: 'pictureCaption', name: '图注页', hint: '左图右文' },
	{ id: 'quote', name: '引言页', hint: '大字引言 + 署名' },
	{ id: 'chart', name: '图表页', hint: '柱状/折线/饼图' }
];

const TRANSITION_CSS = {
	none: { enter: 'dcSlideEnterNone' },
	fade: { enter: 'dcSlideEnterFade' },
	slide: { enter: 'dcSlideEnterSlide' },
	push: { enter: 'dcSlideEnterSlide' },
	wipe: { enter: 'dcSlideEnterWipe' }
};

function injectTransitionStyles() {
	if (document.getElementById('designcraft-deck-styles')) return;
	const style = document.createElement('style');
	style.id = 'designcraft-deck-styles';
	style.textContent = `
@keyframes dcSlideEnterFade{from{opacity:0}to{opacity:1}}
@keyframes dcSlideEnterSlide{from{transform:translateX(6%);opacity:.4}to{transform:none;opacity:1}}
@keyframes dcSlideEnterWipe{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}
.dcSlideEnterNone{animation:none}
.dcSlideEnterFade{animation:dcSlideEnterFade .45s ease both}
.dcSlideEnterSlide{animation:dcSlideEnterSlide .45s cubic-bezier(.22,.8,.36,1) both}
.dcSlideEnterWipe{animation:dcSlideEnterWipe .45s ease both}
.dcPresentOverlay{position:fixed;inset:0;z-index:99999;background:#000;display:flex;align-items:center;justify-content:center}
.dcPresentOverlay canvas{max-width:100vw;max-height:100vh;box-shadow:0 0 60px rgba(0,0,0,.8)}
.dcPresentHint{position:fixed;left:16px;bottom:14px;color:rgba(255,255,255,.55);font:12px/1.6 "Segoe UI","Microsoft YaHei",sans-serif;z-index:100000;user-select:none}
.dcPresentCount{position:fixed;right:16px;bottom:14px;color:rgba(255,255,255,.55);font:12px/1.6 Consolas,monospace;z-index:100000}
`;
	document.head.appendChild(style);
}

/**
 * Presentation overlay (imperative mount — used via a portal-less bootstrap).
 * Returns a disposer. Keyboard: →/space/PageDown next, ←/PageUp prev, Esc exit.
 */
export async function openPresentation(doc, startPageId) {
    if(doc.pages?.some(page=>page.transition?.kind==='morph'))throw new Error('本地预览尚未实现真实 Morph，请使用原生 PPTX 播放；未替换为淡入');
	injectTransitionStyles();
	const pages = (doc.pages || []).filter(p => !p.hidden);
	if (!pages.length) return () => { };
	let index = Math.max(0, pages.findIndex(p => p.id === startPageId));
	const overlay = document.createElement('div');
	overlay.className = 'dcPresentOverlay';
	const hint = document.createElement('div');
	hint.className = 'dcPresentHint';
	hint.textContent = (doc.native?.deck?.mode==='source'?'原生底稿静态预览（不播放对象动画） · ':'')+'→ / 空格 下一页 · ← 上一页 · Esc 退出';
	const count = document.createElement('div');
	count.className = 'dcPresentCount';
	const canvas = document.createElement('canvas');
	overlay.appendChild(canvas);
	document.body.appendChild(overlay);
	document.body.appendChild(hint);
	document.body.appendChild(count);

	function fit() {
		const W = doc.canvas.width, H = doc.canvas.height;
		const scale = Math.min(window.innerWidth / W, window.innerHeight / H);
		canvas.width = Math.round(W * scale);
		canvas.height = Math.round(H * scale);
	}
	function show(direction = 1) {
		const page = pages[index];
		if (!page) return;
		fit();
		const kind = (page.transition?.kind || 'fade');
		canvas.className = TRANSITION_CSS[kind]?.enter || 'dcSlideEnterFade';
		// restart animation
		void canvas.offsetWidth;
		renderPageToCanvas(page, doc, canvas.width, canvas.height).then((rendered) => {
			const ctx = canvas.getContext('2d');
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(rendered, 0, 0);
		});
		count.textContent = (index + 1) + ' / ' + pages.length + (page.name ? ' · ' + page.name : '');
	}
	function next() { if (index < pages.length - 1) { index++; show(1); } }
	function prev() { if (index > 0) { index--; show(-1); } }
	function onKey(e) {
		if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); next(); }
		else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
		else if (e.key === 'Escape') dispose();
		else if (e.key === 'Home') { index = 0; show(); }
		else if (e.key === 'End') { index = pages.length - 1; show(); }
	}
	function onResize() { fit(); show(); }
	function dispose() {
		window.removeEventListener('keydown', onKey, true);
		window.removeEventListener('resize', onResize);
		try { overlay.remove(); hint.remove(); count.remove(); } catch { }
	}
	window.addEventListener('keydown', onKey, true);
	window.addEventListener('resize', onResize);
	overlay.addEventListener('click', next);
	show();
	return dispose;
}

/** Render slide thumbnails (returns dataURLs). */
export async function renderThumbnails(doc, width = 168) {
	const out = [];
	for (const page of doc.pages || []) {
		const canvas = await renderPageToCanvas(page, doc, width, Math.round(width * doc.canvas.height / doc.canvas.width));
		try { out.push({ id: page.id, url: canvas.toDataURL('image/png') }); } catch { out.push({ id: page.id, url: null }); }
	}
	return out;
}
