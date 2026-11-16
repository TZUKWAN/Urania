import {selectedNative,selectedIds,unionRects,nativeCanvasRect,layerRect,selectionRoots} from './selection.js';
import {vectorNodeHandles as handlesForVector} from './vector-nodes.js';
/**
 * DesignCraft pointer tools — a defensive state machine driving canvas interactions.
 * Tools: select (move/resize/rotate), text, shape, pen, brush, eraser, fill, gradient,
 * eyedropper, marquee (rect/ellipse/lasso), magicwand, crop, hand.
 * Everything converts through view transform (zoom/pan) and mutates the doc via actions.
 */

const HANDLE_SIZE = 9; // screen px

export function createToolController({ store, sync, actions }) {

	function view() { return store.get().ui; }
	function doc() { return store.get().doc; }
	function page() {
		const s = store.get();
		return s.doc?.pages?.find(p => p.id === s.ui.pageId) || s.doc?.pages?.[0] || null;
	}

	function toDoc(e) {
		const rect = e.currentTarget.getBoundingClientRect();
		const v = view();
		return {
			x: (e.clientX - rect.left) / v.zoom,
			y: (e.clientY - rect.top) / v.zoom
		};
	}

	function toScreen(pt) {
		const v = view();
		return { x: pt.x * v.zoom + v.panX, y: pt.y * v.zoom + v.panY };
	}

	let drag = null; // active gesture
	let penPoints = null;
	let cropState = null;

	/* ---------------- selection handles ---------------- */

	function selectionBounds() {
		const s = store.get();
		const p = page();
		if (!p || !s.ui.selectedId) return null;
    const native=selectedNative(s);if(native)return s.ui.nativeDraft?.bounds||native.bounds;
		const layer = findLayer(p.layers, s.ui.selectedId);
		if (!layer) return null;
		return unionRects(selectionRoots(p,selectedIds(s)).map(layerRect));
	}

	function boundsOf(layer) {
		if (layer.type === 'group') {
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			for (const child of flatten(layer.children)) {
				const b = boundsOf(child);
				minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
				maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
			}
			if (!isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
			return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
		}
		return { x: layer.x, y: layer.y, w: layer.w, h: layer.h };
	}

	function flatten(layers, out = []) {
		for (const l of layers || []) {
			if (l.type === 'group') flatten(l.children, out);
			else out.push(l);
		}
		return out;
	}

	function findLayer(layers, id) {
		for (const l of layers || []) {
			if (l.id === id) return l;
			if (l.type === 'group') {
				const deep = findLayer(l.children, id);
				if (deep) return deep;
			}
		}
		return null;
	}

	function handleHit(docPt) {
		const b = selectionBounds();
		if (!b) return null;
		const v = view();
		const tol = (HANDLE_SIZE / 2 + 1) / v.zoom;
		const positions = handlePositions(b);
		for (const [name, hx, hy] of positions) {
			if (Math.abs(docPt.x - hx) <= tol && Math.abs(docPt.y - hy) <= tol) return name;
		}
		// rotate handle
		if (Math.abs(docPt.x - (b.x + b.w / 2)) <= tol && Math.abs(docPt.y - (b.y - 24 / v.zoom)) <= tol) return 'rotate';
		return null;
	}

	function handlePositions(b) {
		return [
			['nw', b.x, b.y], ['n', b.x + b.w / 2, b.y], ['ne', b.x + b.w, b.y],
			['w', b.x, b.y + b.h / 2], ['e', b.x + b.w, b.y + b.h / 2],
			['sw', b.x, b.y + b.h], ['s', b.x + b.w / 2, b.y + b.h], ['se', b.x + b.w, b.y + b.h]
		];
	}

	/* ---------------- pointer handlers ---------------- */

	function onPointerDown(e) {
		const s = store.get();
		const p = page();
		if (!p) return;
		const docPt = toDoc(e);
		const tool = s.ui.tool;
		e.currentTarget.setPointerCapture?.(e.pointerId);
        const selected=s.ui.selectedId?findLayer(p.layers,s.ui.selectedId):null;
        if(selected?.locked&&['brush','eraser','fill','gradient','crop','magicwand','direct'].includes(tool)){actions.toast('图层已锁定；原生底稿请通过源对象编辑');return;}

		if (tool === 'hand' || e.button === 1 || (e.button === 0 && e.altKey && tool === 'select')) {
			drag = { kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, panX: s.ui.panX, panY: s.ui.panY };
			return;
		}

    if(tool==='direct'){
      let layer=s.ui.selectedId?findLayer(p.layers,s.ui.selectedId):null;
      let handles=layer?.type==='vector'?handlesForVector(layer):[];
      let handle=handles.find(node=>Math.hypot(node.x-docPt.x,node.y-docPt.y)<=7/s.ui.zoom);
      if(!handle){layer=actions.hitTest(p,docPt.x,docPt.y);actions.select(layer?.id||null);if(layer?.type==='native'){actions.toast('复杂原生对象请使用源对象编辑选项');return;}handles=layer?.type==='vector'?handlesForVector(layer):[];handle=handles.find(node=>Math.hypot(node.x-docPt.x,node.y-docPt.y)<=7/s.ui.zoom);}
      if(handle)drag={kind:'node',start:docPt,original:JSON.parse(JSON.stringify(layer)),handle};return;
    }
		if (tool === 'select') {
      if(s.nativeBusy)return;
      const native=selectedNative(s),nativeHandle=native?handleHit(docPt):null;
      if(nativeHandle){drag={kind:'native',mode:nativeHandle==='rotate'?'rotate':'resize',handle:nativeHandle,start:docPt,bounds:native.bounds};return;}
      const picked=actions.pickObject(p,docPt);
      if(picked?.node){if(actions.selectNative(picked.layer,[picked.node.id],{toggle:e.shiftKey})===false)return;const chosen=selectedNative(store.get());if(chosen)drag={kind:'native',mode:'move',start:docPt,bounds:chosen.bounds};return;}
			const handle = handleHit(docPt);
			if (handle && s.ui.selectedId) {
				const layer = findLayer(p.layers, s.ui.selectedId);
				if(layer.locked)return;
				const b = selectionBounds();const selectionIds=selectionRoots(p,selectedIds(s)).flatMap(collectIds);
				if (handle === 'rotate') {
					drag = { kind: 'rotate', start:docPt, owners:groupOwners(selectionRoots(p,selectedIds(s))),layerIds: selectionIds, center: { x: b.x + b.w / 2, y: b.y + b.h / 2 }, startAngle: Math.atan2(docPt.y - (b.y + b.h / 2), docPt.x - (b.x + b.w / 2)), originals: snapshotLayers(p.layers, selectionIds) };
				} else {
					drag = { kind: 'resize', start:docPt, handle, bounds: b, originals: snapshotLayers(p.layers, selectionIds) };
				}
				return;
			}
			const hit = actions.hitTest(p, docPt.x, docPt.y);
			if (hit) {
        if(e.shiftKey&&selectedNative(s)){actions.toast('源内部对象与普通对象请分别选择，选集保持不变');return;}
				if(e.shiftKey)actions.select(hit.id,{toggle:true});else if(!selectedIds(s).includes(hit.id))actions.select(hit.id);
				drag = { kind: 'move', start: docPt, originals: snapshotLayers(p.layers, selectionRoots(p,selectedIds(store.get())).flatMap(collectIds)) };
			} else {
				actions.select(null);
				drag = { kind: 'marquee', start: docPt, current: docPt,additive:e.shiftKey };
			}
			return;
		}

		if (tool === 'text') {
      const picked=actions.pickObject(p,docPt);if(picked?.node&&typeof picked.node.text==='string'){actions.selectNative(picked.layer,[picked.node.id]);actions.editNativeText();return;}
			const hit = actions.hitTest(p, docPt.x, docPt.y);
			if (hit && hit.type === 'text') { actions.select(hit.id); actions.editText(hit.id); return; }
			const layer = actions.createTextLayer(docPt);
			actions.select(layer.id);
			actions.editText(layer.id);
			return;
		}

		if (tool === 'shape') {
			drag = { kind: 'create-shape', start: docPt, current: docPt };
			return;
		}

		if (tool === 'pen') {
			if (!penPoints) penPoints = [];
			penPoints.push(docPt);
			actions.setPenPreview([...penPoints]);
			return;
		}

		if (['brush', 'eraser'].includes(tool)) {
			actions.beginPaint().catch(error=>actions.toast(error?.message||String(error)));
			drag = { kind: 'paint', last: docPt, eraser: tool === 'eraser' };
			paintStroke(docPt, docPt, drag.eraser).catch(error=>actions.toast(error?.message||String(error)));
			return;
		}

		if (tool === 'fill') {
			return actions.bucketFill(docPt, s.ui.fillStyle);
		}

		if (tool === 'gradient') {
			drag = { kind: 'gradient', start: docPt, current: docPt };
			return;
		}

		if (tool === 'eyedropper') {
			return actions.pickColor(docPt);
		}

		if (['marqueeRect', 'marqueeEllipse', 'lasso'].includes(tool)) {
			drag = { kind: 'marquee', mode: tool, start: docPt, current: docPt, points: tool === 'lasso' ? [docPt] : null };
			return;
		}

		if (tool === 'magicwand') {
			return actions.magicWand(docPt, e.shiftKey);
		}

		if (tool === 'crop') {
			drag = {kind:'crop'};
			const b = selectionBounds();
			cropState = { rect: b ? { x: b.x, y: b.y, w: b.w, h: b.h } : { x: docPt.x, y: docPt.y, w: 0, h: 0 }, dragging: true, start: docPt };
			actions.setCropRect({ ...cropState.rect });
			return;
		}
	}

	function snapshotLayers(layers, ids) {
		const map = new Map();
		const walk = (list) => {
			for (const l of list || []) {
				if (ids.includes(l.id)) map.set(l.id, JSON.parse(JSON.stringify(l)));
				if (l.type === 'group') walk(l.children);
			}
		};
		walk(layers);
		return map;
	}

	function collectIds(layer) {
		const ids = [layer.id];
		if (layer.type === 'group') for (const c of flatten(layer.children)) ids.push(c.id);
		return ids;
	}

  function groupOwners(roots){const map=new Map();for(const root of roots)if(root.type==='group')for(const id of collectIds(root))map.set(id,root.id);return map;}
	function onPointerMove(e) {
		const s = store.get();
		const docPt = toDoc(e);
		actions.setPointer(docPt);
		if (!drag) return;
		const p = page();

    if(drag.kind==='native'){
      const b=drag.bounds;let bounds={...b},rotation;
      if(drag.mode==='move'){bounds.x+=docPt.x-drag.start.x;bounds.y+=docPt.y-drag.start.y;}
      else if(drag.mode==='rotate'){rotation=(Math.atan2(docPt.y-b.y-b.h/2,docPt.x-b.x-b.w/2)-Math.atan2(drag.start.y-b.y-b.h/2,drag.start.x-b.x-b.w/2))*180/Math.PI;}
      else{const h=drag.handle;if(h.includes('w')){bounds.x=Math.min(docPt.x,b.x+b.w-1);bounds.w=b.x+b.w-bounds.x;}if(h.includes('e'))bounds.w=Math.max(1,docPt.x-b.x);if(h.includes('n')){bounds.y=Math.min(docPt.y,b.y+b.h-1);bounds.h=b.y+b.h-bounds.y;}if(h.includes('s'))bounds.h=Math.max(1,docPt.y-b.y);}
      drag.edit={bounds,rotation};store.set({ui:{...store.get().ui,nativeDraft:{bounds,rotation}}});return;
    }
		if (drag.kind === 'pan') {
			actions.setView({
				panX: drag.panX + (e.clientX - drag.startClient.x),
				panY: drag.panY + (e.clientY - drag.startClient.y)
			});
			return;
		}
        if(['move','resize','rotate','node'].includes(drag.kind)&&!drag.hasHistory){
          if(Math.hypot(docPt.x-drag.start.x,docPt.y-drag.start.y)*s.ui.zoom<1)return;
          actions.pushUndo();drag.hasHistory=true;
        }
    if(drag.kind==='node'){actions.updateVectorNode(drag.original,drag.handle,docPt);return;}
		if (drag.kind === 'move' && p) {
			const dx = docPt.x - drag.start.x, dy = docPt.y - drag.start.y;
			actions.updateLayersOriginals(drag.originals, (layer, original) => {
				layer.x = original.x + dx;
				layer.y = original.y + dy;
			});
			sync.markLocalEdit();
			return;
		}
		if (drag.kind === 'resize' && p) {
			const { handle, bounds, originals } = drag;
			let nx = bounds.x, ny = bounds.y, nw = bounds.w, nh = bounds.h;
			if (handle.includes('w')) { nx = Math.min(docPt.x, bounds.x + bounds.w); nw = bounds.x + bounds.w - nx; }
			if (handle.includes('e')) { nw = Math.max(1, docPt.x - bounds.x); }
			if (handle.includes('n')) { ny = Math.min(docPt.y, bounds.y + bounds.h); nh = bounds.y + bounds.h - ny; }
			if (handle.includes('s')) { nh = Math.max(1, docPt.y - bounds.y); }
			const sx = bounds.w ? nw / bounds.w : 1, sy = bounds.h ? nh / bounds.h : 1;
			actions.updateLayersOriginals(originals, (layer, original) => {
				layer.x = nx + (original.x - bounds.x) * sx;
				layer.y = ny + (original.y - bounds.y) * sy;
				if (layer.type !== 'text' || true) {
					layer.w = Math.max(1, original.w * sx);
					layer.h = Math.max(1, original.h * sy);
				}
			});
			sync.markLocalEdit();
			return;
		}
		if (drag.kind === 'rotate' && p) {
			const angle = Math.atan2(docPt.y - drag.center.y, docPt.x - drag.center.x);
			const delta = (angle - drag.startAngle) * 180 / Math.PI;
			actions.updateLayersOriginals(drag.originals, (layer, original) => {
				const owner=drag.owners?.get(original.id),root=owner?drag.originals.get(owner):original,a=delta*Math.PI/180,x=root.x+root.w/2-drag.center.x,y=root.y+root.h/2-drag.center.y,dx=drag.center.x+x*Math.cos(a)-y*Math.sin(a)-root.w/2-root.x,dy=drag.center.y+x*Math.sin(a)+y*Math.cos(a)-root.h/2-root.y;layer.x=original.x+dx;layer.y=original.y+dy;layer.rotation=owner&&owner!==original.id?(original.rotation||0):Math.round(((original.rotation||0)+delta)*10)/10;
			});
			sync.markLocalEdit();
			return;
		}
		if (drag.kind === 'create-shape') {
			drag.current = docPt;
			actions.setDraftShape({ x: Math.min(drag.start.x, docPt.x), y: Math.min(drag.start.y, docPt.y), w: Math.abs(docPt.x - drag.start.x), h: Math.abs(docPt.y - drag.start.y) });
			return;
		}
		if (drag.kind === 'paint') {
			paintStroke(drag.last, docPt, drag.eraser).catch(error=>actions.toast(error?.message||String(error)));
			drag.last = docPt;
			return;
		}
		if (drag.kind === 'gradient') {
			drag.current = docPt;
			actions.setGradientDrag({ start: drag.start, current: docPt });
			return;
		}
		if (drag.kind === 'marquee') {
			drag.current = docPt;
			if (drag.mode === 'lasso') drag.points.push(docPt);
			actions.setMarquee({ mode: drag.mode, start: drag.start, current: docPt, points: drag.points ? [...drag.points] : null });
			return;
		}
		if (drag.kind === 'crop' && cropState) {
			cropState.rect = { x: Math.min(cropState.start.x, docPt.x), y: Math.min(cropState.start.y, docPt.y), w: Math.abs(docPt.x - cropState.start.x), h: Math.abs(docPt.y - cropState.start.y) };
			actions.setCropRect({ ...cropState.rect });
			return;
		}
	}

  function onPointerCancel(){if(drag?.kind==='native'){drag=null;store.set({ui:{...store.get().ui,nativeDraft:null}});return;}return onPointerUp();}
	function onPointerUp() {
		const s = store.get();
		if (!drag) return;
		const finished=drag,kind=drag.kind;
		drag=null;
    if(kind==='native'){if(finished.edit)return actions.commitNativeEdit(finished.edit).catch(error=>{store.set({ui:{...store.get().ui,nativeDraft:null}});actions.toast(error.message);});return;}
        if(kind==='node'){if(finished.hasHistory)actions.finishVectorNode(finished.original.id);return;}
		if (kind === 'create-shape') {
			actions.commitDraftShape();
			return;
		}
		if (kind === 'marquee') {
      if(!finished.mode){const a=finished.start,b=finished.current;actions.setMarquee(null);actions.selectInRect({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)},finished.additive);return;}
			actions.commitMarquee();
			return;
		}
		if (kind === 'gradient') {
			actions.commitGradientDrag();
			return;
		}
		if (kind === 'crop') {
			if (cropState) cropState.dragging = false;
			return;
		}
		if (kind==='paint')return actions.bakeDirtySurfaces().then(()=>sync.scheduleSave());
		if (['move', 'resize', 'rotate'].includes(kind)) sync.scheduleSave();
	}

	/* ---------------- paint ops on image layer surfaces ---------------- */

	async function paintStroke(from, to, eraser) {
		const s = store.get();
		const p = page();
		const layer = p && s.ui.selectedId ? findLayer(p.layers, s.ui.selectedId) : null;
		if (!layer || layer.type !== 'image') { actions.toast('请先选中一个图片图层再使用画笔'); return; }
		await actions.paintOnLayer(layer, from, to, { eraser, size: s.ui.brushSize, color: s.ui.fillStyle, opacity: s.ui.brushOpacity });
	}

	function finishPen(close = true) {
		const pts = penPoints;
		penPoints = null;
		actions.setPenPreview(null);
		if (!pts || pts.length < 2) return;
		actions.commitPenPath(pts, close);
	}

	function isPenActive() { return !!penPoints; }
	function penCancel() { penPoints = null; actions.setPenPreview(null); }

	/* ---------------- keyboard ---------------- */

	function onKeyDown(e) {
		const s = store.get();
		if (s.workspaceMode !== 'legacy' || e.isComposing || e.keyCode === 229) return;
		if (e.defaultPrevented||e.target?.isContentEditable||e.target?.closest?.('.dcChat,[contenteditable="true"],[role="textbox"]')||e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
		if (s.ui.presentation) return; // presentation handles its own keys
		if (s.ui.tool === 'pen' && (e.key === 'Enter' || e.key === 'Escape')) {
			if (e.key === 'Enter') finishPen(true); else penCancel();
			e.preventDefault();
			return;
		}
		const meta = e.ctrlKey || e.metaKey;
		if (meta && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			return e.shiftKey?actions.redo():actions.undo();
		}
		if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); return actions.redo(); }
		if (meta && e.key.toLowerCase() === 'c') { e.preventDefault(); actions.copySelection(); return; }
		if (meta && e.key.toLowerCase() === 'v') { e.preventDefault(); actions.pasteClipboard(); return; }
		if (meta && e.key.toLowerCase() === 'd') { e.preventDefault(); actions.duplicateSelection(); return; }
		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (s.ui.selectedId) { e.preventDefault(); actions.deleteSelection(); }
			return;
		}
		if (e.key === 'Escape') {
			if (s.ui.tool === 'pen' && isPenActive()) { penCancel(); return; }
			actions.select(null);
			return;
		}
		if (!meta && 'vtebpsmha'.includes(e.key.toLowerCase()) && e.key.length === 1) {
			const map = {a:'direct', v: 'select', t: 'text', e: 'eraser', b: 'brush', p: 'pen', s: 'shape', m: 'marqueeRect', h: 'hand' };
			const tool = map[e.key.toLowerCase()];
			if (tool) actions.setTool(tool === 'ellipseTool' ? 'shape' : tool);
		}
	}

  function vectorNodeHandles(){const s=store.get(),p=page(),layer=p&&s.ui.selectedId?findLayer(p.layers,s.ui.selectedId):null;try{return handlesForVector(layer);}catch{return [];}}
	return {
		onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown,
		finishPen, penCancel, isPenActive,
		vectorNodeHandles, handlePositions, selectionBounds, toDoc, toScreen
	};
}
