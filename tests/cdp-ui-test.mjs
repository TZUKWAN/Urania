/** CDP UI test v2 — drives the real DSH renderer through the full DesignCraft flow. */
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';

const port = process.argv[2] || '9223';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const res = await fetch(`http://127.0.0.1:${port}/json`);
const page = (await res.json()).find(t => t.type === 'page' && t.url.startsWith('dsh-app://'));
if (!page) { console.log('NO-DSH-TARGET'); process.exit(1); }
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
let id = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
	const mid = ++id;
	ws.send(JSON.stringify({ id: mid, method, params }));
	const h = (data) => {
		const msg = JSON.parse(data.toString());
		if (msg.id === mid) { ws.off('message', h); msg.error ? reject(new Error(JSON.stringify(msg.error).slice(0, 400))) : resolve(msg.result); }
	};
	ws.on('message', h);
});
await send('Runtime.enable');
const evalJs = async (expr) => {
	const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
	if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
	return r.result?.value;
};

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
	if (cond) { pass++; console.log('PASS', name); }
	else { fail++; console.log('FAIL', name, extra); }
};

// wait for the designcraft rail entry (svg with rounded-rect icon in the left rail)
let entryKind = null;
for (let k = 0; k < 12; k++) {
	entryKind = await evalJs(`(() => {
		const svgs = [...document.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.left < 130 && r.width < 44 && !s.closest('.dcApp') && s.innerHTML.includes('rx="6"'); });
		if (!svgs.length) return null;
		return svgs[0].closest('button') ? 'button' : (svgs[0].closest('[role=button]') ? 'role' : 'svg');
	})()`);
	if (entryKind) break;
	await sleep(1500);
}
check('sidebar entry present', !!entryKind, String(entryKind));

const openPanel = await evalJs(`(async () => {
	let appRendered = false;
	for (let k = 0; k < 4 && !appRendered; k++) {
		const svgs = [...document.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.left < 130 && r.width < 44 && !s.closest('.dcApp') && s.innerHTML.includes('rx="6"'); });
		const node = svgs[0] && (svgs[0].closest('button') || svgs[0].closest('[role=button]') || svgs[0]);
		if (!node) return { devBridge: !!window.__DESIGNCRAFT_DEV__, appRendered: false, err: 'entry gone' };
		node.click();
		await new Promise(r2 => setTimeout(r2, 1800));
		appRendered = !!document.querySelector('.dcApp');
	}
	return { devBridge: !!window.__DESIGNCRAFT_DEV__, appRendered };
})()`);
console.log('open panel:', JSON.stringify(openPanel));
check('dev bridge exposed', openPanel.devBridge === true);
check('editor app rendered', openPanel.appRendered === true);

// set root through the bridge (in real use: the landing buttons do this with the session cwd)
const rootState = await evalJs(`(async () => {
	const dev = window.__DESIGNCRAFT_DEV__;
	if (!dev.store.get().root) dev.setRoot('D:/智能体工作空间/DSH-METIS-TEST');
	await new Promise(r2 => setTimeout(r2, 4500));
	const s = dev.store.get();
	return { root: !!s.root, sse: s.sseStatus, docs: (s.docs || []).length };
})()`);
console.log('root state:', JSON.stringify(rootState));
check('workspace root set', rootState.root === true);
check('sync loop running (live/polling)', ['live', 'polling', 'offline'].includes(rootState.sse) && rootState.sse !== 'offline' ? true : false, 'sse=' + rootState.sse);

// create blank doc via the real UI menu
const created = await evalJs(`(async () => {
	const app = document.querySelector('.dcApp');
	const newBtn = [...app.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '新建');
	if (!newBtn) return { err: 'no new button' };
	newBtn.click();
	await new Promise(r2 => setTimeout(r2, 450));
	const blank = [...app.querySelectorAll('.dcMenu button')].find(b => (b.textContent || '').includes('空白画板'));
	if (!blank) return { err: 'no blank item' };
	blank.click();
	await new Promise(r2 => setTimeout(r2, 3000));
	const canvas = app.querySelector('.dcCanvasStack canvas');
	let painted = false;
	if (canvas && canvas.width > 0) {
		const ctx = canvas.getContext('2d');
		const d = ctx.getImageData(0, 0, Math.min(300, canvas.width), Math.min(200, canvas.height)).data;
		painted = [...d].some(v => v > 0);
	}
	return {
		canvasSize: canvas ? canvas.width + 'x' + canvas.height : null,
		painted,
		docId: window.__DESIGNCRAFT_DEV__.store.get().doc?.id,
		topText: (app.querySelector('.dcTop')?.textContent || '').replace(/\\s+/g, ' ').slice(0, 90)
	};
})()`);
console.log('created:', JSON.stringify(created));
check('canvas mounted after 新建', !!created.canvasSize, JSON.stringify(created));
check('canvas painted (WYSIWYG)', created.painted === true);

// text tool: click canvas → layer + inline editor
const textFlow = await evalJs(`(async () => {
	// ensure panel is open (layout may switch back to the session view after doc ops)
	if (!document.querySelector('.dcApp')) {
		for (let k = 0; k < 4 && !document.querySelector('.dcApp'); k++) {
			const svgs = [...document.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.left < 130 && r.width < 44 && !s.closest('.dcApp') && s.innerHTML.includes('rx="6"'); });
			if (!svgs.length) return { err: 'entry gone' };
			(svgs[0].closest('button') || svgs[0]).click();
			await new Promise(r2 => setTimeout(r2, 1500));
		}
	}
	const app = document.querySelector('.dcApp');
	const tool = [...app.querySelectorAll('.dcToolBtn')].find(b => (b.title || '').includes('文字'));
	if (!tool) return { err: 'no text tool' };
	tool.click();
	await new Promise(r2 => setTimeout(r2, 200));
	const canvases = app.querySelectorAll('.dcCanvasStack canvas');
	const overlay = canvases[1] || canvases[0];
	const rect = overlay.getBoundingClientRect();
	const opts = { bubbles: true, pointerId: 1, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2, isPrimary: true };
	overlay.dispatchEvent(new PointerEvent('pointerdown', opts));
	overlay.dispatchEvent(new PointerEvent('pointerup', opts));
	await new Promise(r2 => setTimeout(r2, 1000));
	return {
		layers: [...app.querySelectorAll('.dcLayerItem .dcLName')].map(e => e.textContent).slice(0, 5),
		inlineEditor: !!app.querySelector('.dcTextEditor')
	};
})()`);
console.log('text flow:', JSON.stringify(textFlow));
check('text layer created by canvas click', (textFlow.layers || []).length > 0, JSON.stringify(textFlow));

// shape tool flow: drag creates a shape
const shapeFlow = await evalJs(`(async () => {
	if (!document.querySelector('.dcApp')) {
		for (let k = 0; k < 4 && !document.querySelector('.dcApp'); k++) {
			const svgs = [...document.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.left < 130 && r.width < 44 && !s.closest('.dcApp') && s.innerHTML.includes('rx="6"'); });
			if (!svgs.length) return { err: 'entry gone' };
			(svgs[0].closest('button') || svgs[0]).click();
			await new Promise(r2 => setTimeout(r2, 1500));
		}
	}
	const app = document.querySelector('.dcApp');
	const tool = [...app.querySelectorAll('.dcToolBtn')].find(b => (b.title || '').includes('形状'));
	if (!tool) return { err: 'no shape tool' };
	tool.click();
	await new Promise(r2 => setTimeout(r2, 200));
	const canvases = app.querySelectorAll('.dcCanvasStack canvas');
	const overlay = canvases[1] || canvases[0];
	const rect = overlay.getBoundingClientRect();
	const mk = (type, x, y) => new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, clientY: y, isPrimary: true });
	overlay.dispatchEvent(mk('pointerdown', rect.x + 300, rect.y + 300));
	overlay.dispatchEvent(mk('pointermove', rect.x + 440, rect.y + 400));
	overlay.dispatchEvent(mk('pointerup', rect.x + 440, rect.y + 400));
	await new Promise(r2 => setTimeout(r2, 900));
	return { layers: [...app.querySelectorAll('.dcLayerItem .dcLName')].map(e => e.textContent).slice(0, 6) };
})()`);
console.log('shape flow:', JSON.stringify(shapeFlow));
check('shape layer created by drag', (shapeFlow.layers || []).length >= 2, JSON.stringify(shapeFlow));

// undo/redo buttons
const undoRedo = await evalJs(`(async () => {
	if (!document.querySelector('.dcApp')) {
		for (let k = 0; k < 4 && !document.querySelector('.dcApp'); k++) {
			const svgs = [...document.querySelectorAll('svg')].filter(s => { const r = s.getBoundingClientRect(); return r.left < 130 && r.width < 44 && !s.closest('.dcApp') && s.innerHTML.includes('rx="6"'); });
			if (!svgs.length) return { err: 'entry gone' };
			(svgs[0].closest('button') || svgs[0]).click();
			await new Promise(r2 => setTimeout(r2, 1500));
		}
	}
	const app = document.querySelector('.dcApp');
	const before = [...app.querySelectorAll('.dcLayerItem .dcLName')].map(e => e.textContent);
	const undoBtn = [...app.querySelectorAll('.dcTop button')][2];
	if (undoBtn) undoBtn.click();
	await new Promise(r2 => setTimeout(r2, 400));
	const mid = [...app.querySelectorAll('.dcLayerItem .dcLName')].map(e => e.textContent);
	return { before: before.length, mid: mid.length };
})()`);
console.log('undo:', JSON.stringify(undoRedo));
check('undo removes layer', undoRedo.mid < undoRedo.before);

// save to disk: verify the doc file exists on the real filesystem through the store state
const saveState = await evalJs(`(() => {
	const s = window.__DESIGNCRAFT_DEV__.store.get();
	return { activeId: s.activeId, dirty: s.dirty, revision: s.revision };
})()`);
console.log('save state:', JSON.stringify(saveState));
check('doc persisted (revision assigned)', !!saveState.revision);

// realtime: external file edit → store updates (WYSIWYG core)
const external = await evalJs(`(async () => {
	const dev = window.__DESIGNCRAFT_DEV__;
	const before = JSON.stringify(dev.store.get().doc);
	const res = await fetch('/designcraft/api/v1/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: dev.store.get().root, commands: [{ op: 'layer.add', id: dev.store.get().doc.id, pageId: dev.store.get().doc.pages[0].id, layer: { type: 'text', name: 'AI实时层', text: 'AI 写入的实时验证', x: 120, y: 400, fontSize: 40, color: '#B44846' } }] }) });
	const body = await res.json();
	await new Promise(r2 => setTimeout(r2, 4500));
	const after = dev.store.get().doc;
	const hasAiLayer = JSON.stringify(after).includes('AI 写入的实时验证');
	return { cmdOk: body.ok, hasAiLayer, layerCount: (after.pages[0].layers || []).length };
})()`);
console.log('realtime:', JSON.stringify(external));
check('AI external edit appears in UI (realtime)', external.hasAiLayer === true, JSON.stringify(external));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync('D:/METIS超级合并/dsh-plugin/designcraft/tests/ui-final.png', Buffer.from(shot.data, 'base64'));
console.log('screenshot: tests/ui-final.png');

ws.close();
console.log(`\n=== CDP UI TESTS v2: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
