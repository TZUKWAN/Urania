import {currentDesignScope} from './design-session.js?v=165';
import {MotionPreviewBridge} from './motion-preview.js?v=165';
import {selectionIdentity,matrixPoint,inverseMatrix,multiplyMatrix,alignmentOffsets,layerRect,selectionRoots,selectedIds,selectedNative,nativeNodes,nativeAtPoint,nativePoint,nodeRect,nativeCanvasRect,unionRects} from './selection.js';
import {editVectorNode,reboxVectorLayer,vectorNodeHandles} from './vector-nodes.js';
/**
 * DesignCraft client actions — every mutation flows through here so undo,
 * autosave, realtime render, and paint-surface baking stay consistent.
 */
import { normalizeDoc, normalizeLayer, normalizePage, cloneLayer, genId, flattenLayers, hitTest, getPaintSurface, dropPaintSurface, invalidateLayerCache, magicWandMask, loadImage, api, surfacePeek, capturePaintState, restorePaintState, captureDraftPixels } from './engine.js';
import { parseSvgClient } from './svgtools.js';

export function createActions({ store, sync, engine, toast }) {

  let pixelQueue=Promise.resolve(),pendingPixelOps=0,baking=null,disposed=false,nativeGesture=null,nativeTrail=[];
  const scope=()=>({root:store.get().root,id:store.get().doc?.id});
  const sameScope=c=>!disposed&&c.root===store.get().root&&c.id===store.get().doc?.id;
  function enqueuePixel(operation){
    const c=scope();pendingPixelOps++;store.set({pendingPixelOps});
    const task=pixelQueue.then(()=>{if(!sameScope(c))throw new Error('像素操作期间作品已切换');return operation();});
    pixelQueue=task.catch(()=>{}).finally(()=>{pendingPixelOps--;store.set({pendingPixelOps});});
    return task;
  }
  const historyEntry=s=>({doc:JSON.parse(JSON.stringify(s.doc)),pageId:s.ui.pageId,selectedId:s.ui.selectedId,selectedIds:selectedIds(s),nativeSelection:s.ui.nativeSelection,pixels:capturePaintState()});
  const pendingNative=()=>store.get().doc?.pages?.flatMap(p=>flattenLayers(p.layers)).filter(l=>l.pendingNativePaint?.strokes?.length)||[];
  const dirtyPixels=()=>store.get().doc?.pages?.some(p=>flattenLayers(p.layers).some(l=>{const entry=surfacePeek(l.id);return entry&&(entry.canvas.__rev||0)>(entry.bakedRev||0);}));
  function trimHistory(stack){
    const bytes=()=>stack.reduce((sum,entry)=>sum+(entry.pixels||[]).reduce((n,p)=>n+p.canvas.width*p.canvas.height*4,0),0);
    while(stack.length>60||(stack.length>1&&bytes()>96*1024*1024))stack.shift();
    return stack;
  }
  sync.setPixelHooks?.({
    hasPending:()=>pendingPixelOps>0||!!baking||dirtyPixels()||pendingNative().length>0,
    hasNativePending:()=>pendingNative().length>0,
    flush:bakeDirtySurfaces,
    draft:async()=>{await pixelQueue;return captureDraftPixels();},
    restoreDraft:async(doc,pixels)=>{
      for(const item of pixels||[]){const result=await sync.uploadAsset(new File([item.blob],'recovery-'+item.layerId+'.png',{type:'image/png'}));
        for(const page of doc.pages||[]){const found=findLayerDeep(page.layers,item.layerId);if(found)found.layer.asset=result.name;}}
      return doc;
    }
  });

  function nativeWandFor(doc,id){
    for(const page of doc?.pages||[]){const layer=findLayerDeep(page.layers,id)?.layer;if(layer?.native?.engine==='photocraft'&&layer.native.hasSelection)return {native:true,layerId:layer.id,bounds:layer.native.selectionBounds};}
    return null;
  }
	/* ---------------- undo / redo ---------------- */

	function pushUndo({queued=false}={}) {
		if(pendingPixelOps&&!queued)throw new Error('像素操作正在处理，请稍候');
		const s = store.get();
		if (!s.doc) return;
		const stack = trimHistory([...(s.undoStack || []), historyEntry(s)]);
		store.set({ undoStack: stack, redoStack: [] });
	}

	async function undo() {
		try{await bakeDirtySurfaces();}catch(error){if(!pendingNative().length||store.get().conflict)throw error;const doc=JSON.parse(JSON.stringify(store.get().doc));for(const page of doc.pages)for(const layer of flattenLayers(page.layers))delete layer.pendingNativePaint;store.set({doc,nativeError:null,ui:{...store.get().ui,penPreview:null}});sync.markLocalEdit();sync.scheduleSave();return;}
		const s = store.get();
		const prev = (s.undoStack || []).pop();
		if (!prev) return;
		const redoStack = [...(s.redoStack || []), historyEntry(s)];
		restorePaintState(prev.pixels);
		store.set({ doc: prev.doc, wandMask:nativeWandFor(prev.doc,prev.selectedId), undoStack: s.undoStack, redoStack, ui: { ...s.ui, pageId: prev.doc.pages?.some(p => p.id === prev.pageId) ? prev.pageId : (prev.doc.pages?.[0]?.id || null), selectedId: prev.selectedId,selectedIds:prev.selectedIds||[prev.selectedId].filter(Boolean),nativeSelection:prev.nativeSelection||null } });
		sync.markLocalEdit();
		sync.scheduleSave();
	}

	async function redo() {
		await bakeDirtySurfaces();
		const s = store.get();
		const next = (s.redoStack || []).pop();
		if (!next) return;
		const undoStack = [...(s.undoStack || []), historyEntry(s)];
		restorePaintState(next.pixels);
		store.set({ doc: next.doc, wandMask:nativeWandFor(next.doc,next.selectedId), undoStack, redoStack: s.redoStack, ui: { ...s.ui, pageId: next.doc.pages?.some(p => p.id === next.pageId) ? next.pageId : (next.doc.pages?.[0]?.id || null), selectedId: next.selectedId,selectedIds:next.selectedIds||[next.selectedId].filter(Boolean),nativeSelection:next.nativeSelection||null } });
		sync.markLocalEdit();
		sync.scheduleSave();
	}

	/* ---------------- doc mutation helpers ---------------- */

	function mutateDoc(mutator, { history = true, queued = false } = {}) {
		if((pendingPixelOps||baking)&&!queued)throw new Error('像素正在保存，请稍候');
		const s = store.get();
		if (!s.doc) return null;
		if (history) pushUndo({queued});
		const doc = JSON.parse(JSON.stringify(s.doc));
		const result = mutator(doc);
		store.set({ doc });
		sync.markLocalEdit();
		sync.scheduleSave();
		return result;
	}

	function currentPage(doc) {
		const s = store.get();
		return doc.pages.find(p => p.id === s.ui.pageId) || doc.pages[0] || null;
	}

	function findLayerDeep(layers, id) {
		for (const l of layers || []) {
			if (l.id === id) return { layer: l, list: layers };
			if (l.type === 'group') {
				const deep = findLayerDeep(l.children, id);
				if (deep) return deep;
			}
		}
		return null;
	}

  const nativePageLayer=layer=>layer?.type==='native'&&layer.native?.engine==='deckcraft'&&layer.native.role==='page';
  const protectNativePage=layer=>{if(nativePageLayer(layer))throw new Error('原生底稿请通过源对象编辑；复制/删除整页请使用页面按钮');};
	function updateLayerFields(patch) {
		const s = store.get();
		if (!s.ui.selectedId) return;
		mutateDoc((doc) => {
			const page = currentPage(doc);
			const found = findLayerDeep(page.layers, s.ui.selectedId);
			if (found){protectNativePage(found.layer);if(found.layer.type==='vector'&&!found.layer.geometryBox)found.layer.geometryBox={x:found.layer.x,y:found.layer.y,w:found.layer.w,h:found.layer.h};Object.assign(found.layer, patch);}
		});
	}

  function updateVectorNode(original,handle,point){
    const paths=editVectorNode(original,handle,point);
    mutateDoc(doc=>{const found=findLayerDeep(currentPage(doc).layers,original.id);if(!found||found.layer.type!=='vector')throw new Error('矢量对象已变化');found.layer.paths=paths;},{history:false});
  }
  function finishVectorNode(id){mutateDoc(doc=>{const found=findLayerDeep(currentPage(doc).layers,id);if(found)Object.assign(found.layer,reboxVectorLayer(found.layer));},{history:false});}
	/* ---------------- selection & view ---------------- */

  function select(id,{toggle=false}={}){const s=store.get(),ids=toggle?selectedIds(s).filter(x=>x!==id):[];if(id&&(!toggle||!selectedIds(s).includes(id)))ids.push(id);store.set({wandMask:nativeWandFor(s.doc,id)||(id===s.ui.selectedId&&!s.wandMask?.native?s.wandMask:null),ui:{...s.ui,selectedId:ids.at(-1)||null,selectedIds:ids,nativeSelection:null,nativeWholeId:null,nativeDraft:null,nativeTextEditor:null}});}
  function selectWhole(id,options){select(id,options);store.set({ui:{...store.get().ui,nativeWholeId:id}});}
  function selectNative(layer,ids,{toggle=false}={}){
    const s=store.get(),known=new Set(nativeNodes(layer).map(n=>Number(n.id))),old=s.ui.nativeSelection,chosen=toggle&&old?.layerId===layer.id?new Set(old.ids):new Set();
    if(toggle&&(old&&old.layerId!==layer.id||selectedIds(s).some(id=>id!==layer.id))){toast('不同源的内部对象不能混合变换，请分别选择；普通对象可一起选择');return false;}
    for(const raw of ids){const id=Number(raw);if(!known.has(id))throw new Error('原生对象不存在');if(toggle&&chosen.has(id))chosen.delete(id);else chosen.add(id);}
    if(chosen.size>32)throw new Error('一次最多选择32个原生对象');
    store.set({ui:{...s.ui,selectedId:chosen.size?layer.id:null,selectedIds:chosen.size?[layer.id]:[],nativeWholeId:null,nativeDraft:null,nativeTextEditor:null,nativeSelection:chosen.size?{pageId:s.ui.pageId,layerId:layer.id,engine:layer.native.engine,source:layer.native.source,ids:[...chosen]}:null,nativeTargets:{...s.ui.nativeTargets,...(layer.native.engine==='photocraft'?{[layer.id]:chosen.size?[...chosen].at(-1):null}:{})}}});return true;
  }
  function pickObject(page,point,{deep=false}={}){
    for(const layer of [...(page?.layers||[])].reverse()){
      if(layer.hidden)continue;
      const s=store.get(),sourceFocused=deep||s.ui.nativeSelection?.layerId===layer.id||s.ui.nativeWholeId!==layer.id&&(['image','photo'].includes(s.doc.type)&&layer.native?.engine==='photocraft'||s.doc.type==='vector'&&layer.native?.engine==='vectorcraft')||layer.native?.engine==='deckcraft';
      if(sourceFocused&&nativeNodes(layer).length&&(layer.type==='native'||layer.native?.engine==='photocraft')){const node=nativeAtPoint(layer,point);if(node)return {layer,node};}
      const hit=hitTest({layers:[layer]},point.x,point.y);if(hit)return {layer:hit};
    }return null;
  }
  async function commitNativeEdit({bounds,text,rotation,offsets}={}){
    const s=store.get(),selection=selectedNative(s);if(!selection)throw new Error('请先选中原生源对象');
    const {layer,nodes,bounds:old}=selection,engine=layer.native.engine,editorBefore=s.ui.nativeTextEditor,target=JSON.stringify(s.ui.nativeSelection);let commands=[];
    if(offsets){commands=offsets.map(o=>{const zero=nativePoint(layer,{x:0,y:0},true),end=nativePoint(layer,{x:o.dx,y:o.dy},true),dx0=end.x-zero.x,dy0=end.y-zero.y,node=nodes.find(n=>n.id===o.id),inv=engine==='deckcraft'&&node?.parentMatrix?inverseMatrix(node.parentMatrix):[1,0,0,1,0,0],dx=inv[0]*dx0+inv[2]*dy0,dy=inv[1]*dx0+inv[3]*dy0;return {id:engine==='deckcraft'?'shape.move':engine==='vectorcraft'?'object.move':'layer.translate',params:engine==='photocraft'?{layer:o.id,dx:Math.round(dx),dy:Math.round(dy)}:{ids:[o.id],dx,dy}};});}
    else if(text!=null){if(editorBefore&&(editorBefore.source!==layer.native.source||editorBefore.layerId!==layer.id||editorBefore.nodeId!==nodes[0]?.id))throw new Error('源对象在文字编辑期间已更新，请保留草稿后重新选择');if(nodes.length!==1||typeof nodes[0].text!=='string'||nodes[0].textTruncated)throw new Error('请选择一个完整文字对象');commands=[{id:engine==='deckcraft'?'text.set':engine==='vectorcraft'?'text.setText':'type.edit',params:engine==='photocraft'?{layer:nodes[0].id,text}:{id:nodes[0].id,text}}];}
    else{
      if(!old||!bounds&&rotation==null)return;
      const dest=bounds||old,sx=dest.w/old.w,sy=dest.h/old.h,a=(rotation||0)*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),center={x:dest.x+dest.w/2,y:dest.y+dest.h/2};
      const convert=p=>{const q=nativePoint(layer,p),x=dest.x+(q.x-old.x)*sx-center.x,y=dest.y+(q.y-old.y)*sy-center.y;return nativePoint(layer,{x:center.x+x*c-y*sn,y:center.y+x*sn+y*c},true);};
      const o=convert({x:0,y:0}),u=convert({x:1,y:0}),v=convert({x:0,y:1}),m=[u.x-o.x,u.y-o.y,v.x-o.x,v.y-o.y,o.x,o.y];
      if(!m.every(Number.isFinite))throw new Error('原生对象坐标无效');
      if(engine==='deckcraft')commands=nodes.map(node=>{const parent=node.parentMatrix||[1,0,0,1,0,0],local=multiplyMatrix(inverseMatrix(parent),multiplyMatrix(m,parent));const convertLocal=p=>matrixPoint(local,p);const r=nodeRect(node),ang=(node.rotation||0)*Math.PI/180,ux={x:Math.cos(ang),y:Math.sin(ang)},vy={x:-Math.sin(ang),y:Math.cos(ang)},tx={x:local[0]*ux.x+local[2]*ux.y,y:local[1]*ux.x+local[3]*ux.y},ty={x:local[0]*vy.x+local[2]*vy.y,y:local[1]*vy.x+local[3]*vy.y},wx=Math.hypot(tx.x,tx.y),hy=Math.hypot(ty.x,ty.y);
        if(Math.abs(tx.x*ty.x+tx.y*ty.y)>1e-6)throw new Error('此非等比变换会使旋转对象产生剪切，PPT 对象不支持，未近似修改');
        const cp=convertLocal({x:r.x+r.w/2,y:r.y+r.h/2}),w=r.w*wx,h=r.h*hy;return {id:'shape.sizePosition',params:{ids:[node.id],x:cp.x-w/2,y:cp.y-h/2,w,h,rot:Math.atan2(tx.y,tx.x)*180/Math.PI}};
      });
      else commands=[{id:engine==='vectorcraft'?'object.transform':'edit.transform',params:{...(engine==='photocraft'?{layers:nodes.map(n=>n.id)}:{ids:nodes.map(n=>n.id)}),matrix:m}}];
    }
    if(commands.length>32)throw new Error('一次原生编辑最多32个目标，请分批操作');
    const result=await sync.nativeOperation({operation:engine==='deckcraft'?'deck.apply':engine==='vectorcraft'?'vector.apply':'photo.apply',layerId:layer.id,expectedSource:layer.native.source,commands});
    const current=store.get();if(current.doc?.id===s.doc.id&&JSON.stringify(current.ui.nativeSelection)===target){const next=findLayerDeep(currentPage(current.doc).layers,layer.id)?.layer;if(next)selectNative(next,nodes.map(n=>n.id).filter(id=>nativeNodes(next).some(n=>Number(n.id)===id)));}
    const latestEditor=store.get().ui.nativeTextEditor,latestLayer=findLayerDeep(currentPage(store.get().doc).layers,layer.id)?.layer;const keep=editorBefore&&latestEditor&&(latestEditor.layerId!==editorBefore.layerId||latestEditor.nodeId!==editorBefore.nodeId)?latestEditor:editorBefore&&latestEditor&&latestEditor.text!==text?{...latestEditor,source:latestLayer?.native?.source,originalText:text}:null;store.set({ui:{...store.get().ui,nativeDraft:null,nativeTextEditor:keep}});return result;
  }
  function selectInRect(rect,additive=false){
    const s=store.get(),page=currentPage(s.doc),inside=r=>r&&r.x>=rect.x&&r.y>=rect.y&&r.x+r.w<=rect.x+rect.w&&r.y+r.h<=rect.y+rect.h;
    const ordinary=page.layers.filter(l=>!l.hidden&&!l.locked&&inside(layerRect(l))&&!(l.type==='native'&&nativeNodes(l).length));
    const native=page.layers.filter(l=>!l.hidden&&nativeNodes(l).length).map(layer=>({layer,nodes:nativeNodes(layer).filter(n=>!n.container&&n.visible!==false&&!n.locked&&inside(nativeCanvasRect(layer,n)))})).filter(x=>x.nodes.length);
    if(native.length&&ordinary.length||native.length>1){toast('框选包含不同原生源；请分别选择源内部对象，或选择普通对象');return;}
    if(native.length){selectNative(native[0].layer,native[0].nodes.map(n=>n.id));return;}
    const ids=[...new Set([...(additive?selectedIds(s):[]),...ordinary.map(l=>l.id)])];store.set({ui:{...s.ui,selectedIds:ids,selectedId:ids.at(-1)||null,nativeSelection:null}});
  }
  function translateTree(layer,dx,dy){layer.x=(layer.x||0)+dx;layer.y=(layer.y||0)+dy;for(const child of layer.children||[])translateTree(child,dx,dy);}
  async function alignSelection(mode,toPage=false){
    const s=store.get(),native=selectedNative(s),page=currentPage(s.doc),frame=toPage?{x:0,y:0,w:s.doc.canvas.width,h:s.doc.canvas.height}:null;
    if(native){const offsets=alignmentOffsets(native.nodes.map(n=>({id:n.id,rect:nativeCanvasRect(native.layer,n)})),mode,frame);return commitNativeEdit({offsets});}
    const roots=selectionRoots(page,selectedIds(s));if(roots.some(l=>l.locked))throw new Error('选集中有锁定对象');const offsets=alignmentOffsets(roots.map(l=>({id:l.id,rect:layerRect(l)})),mode,frame);
    mutateDoc(doc=>{const p=currentPage(doc);for(const offset of offsets){const layer=findLayerDeep(p.layers,offset.id)?.layer;if(!layer)throw new Error('选中对象已变化');translateTree(layer,offset.dx,offset.dy);}});
  }
  function groupSelection(ungroup=false){
    const s=store.get();if(selectedNative(s))throw new Error('原生对象的分组保留在源中；请使用同一源的图层层级编辑');const ids=selectedIds(s),page=currentPage(s.doc);
    if(ungroup){let next=[];mutateDoc(doc=>{for(const id of ids){const found=findLayerDeep(currentPage(doc).layers,id);if(found?.layer.type!=='group')throw new Error('请选择普通对象组');const index=found.list.indexOf(found.layer);found.list.splice(index,1,...found.layer.children);next.push(...found.layer.children.map(l=>l.id));}});store.set({ui:{...store.get().ui,selectedIds:next,selectedId:next.at(-1)}});return;}
    if(ids.length<2)throw new Error('编组需要至少两个对象');const found=ids.map(id=>findLayerDeep(page.layers,id));if(found.some(x=>!x||x.layer.locked)||found.some(x=>x.list!==found[0].list))throw new Error('请选择同一级的未锁定普通对象');
    const id=genId('group');mutateDoc(doc=>{const p=currentPage(doc),items=ids.map(id=>findLayerDeep(p.layers,id)),list=items[0].list,children=list.filter(l=>ids.includes(l.id)),bounds=unionRects(children.map(layerRect)),index=Math.min(...items.map(x=>list.indexOf(x.layer)));for(let i=list.length-1;i>=0;i--)if(ids.includes(list[i].id))list.splice(i,1);list.splice(index,0,{id,type:'group',name:'对象组',...bounds,opacity:1,children});});select(id);
  }
  let quotedWand=null;
  async function prepareRegionReference(){
    const s=store.get(),wand=s.wandMask,region=s.uiSelection;if(region&&region.kind!=='mask')return;if(!wand)return;
    const layer=findLayerDeep(currentPage(s.doc).layers,s.ui.selectedId)?.layer;if(!layer||layer.type!=='image'||wand.layerId!==layer.id)return;
    if(quotedWand===wand&&region?.kind==='mask'&&region.sourceAsset===layer.asset&&(!region.nativeSource||region.nativeSource===layer.native?.source))return;
    const signature=JSON.stringify(layer),pageId=s.ui.pageId;let mask;
    if(wand.native){const result=await sync.nativeOperation({operation:'photo.selection',layerId:layer.id,expectedSource:layer.native.source});mask=result.candidate;}
    else{const surface=await getPaintSurface(layer);if(surface.width*surface.height!==wand.mask.length)throw new Error('像素选区尺寸已变化，请重新选择');const canvas=document.createElement('canvas');canvas.width=surface.width;canvas.height=surface.height;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);for(let i=0;i<wand.mask.length;i++){pixels.data[i*4]=pixels.data[i*4+1]=pixels.data[i*4+2]=255;pixels.data[i*4+3]=wand.mask[i]?255:0;}ctx.putImageData(pixels,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('实际选区蒙版编码失败');const asset=await sync.uploadAsset(new File([blob],'selection-mask.png',{type:'image/png'}));mask={maskAsset:asset.name,width:canvas.width,height:canvas.height,encoding:'alpha'};}
    const latest=store.get(),current=latest.doc?.id===s.doc.id&&latest.root===s.root&&findLayerDeep(currentPage(latest.doc).layers,layer.id)?.layer;
    if(!current||JSON.stringify(current)!==signature||latest.ui.selectedId!==layer.id||latest.ui.pageId!==pageId||latest.wandMask!==wand||JSON.stringify(latest.ui.nativeSelection)!==JSON.stringify(s.ui.nativeSelection)||JSON.stringify(latest.ui.selectedIds)!==JSON.stringify(s.ui.selectedIds)||latest.uiSelection!==s.uiSelection||latest.ui.marquee!==s.ui.marquee)throw new Error('准备选区期间图片或选择已变化，未替换引用');
    quotedWand=wand;store.set({uiSelection:{kind:'mask',maskAsset:mask.maskAsset,width:mask.width,height:mask.height,encoding:'alpha',pageId,layerId:layer.id,sourceAsset:layer.asset,nativeSource:wand.native?layer.native.source:null}});
  }
  async function openLinkedMedia(){const selected=selectedNative(store.get());if(!selected||selected.layer.native.engine!=='deckcraft'||selected.nodes.length!==1||selected.nodes[0].kind!=='picture')throw new Error('请在演示画布点选一张原生图片');return sync.openLinkedMedia(selected.nodes[0].id);}
  async function commitLinkedMedia({raster=false}={}){
    if(store.get().nativeBusy)throw new Error('原生处理尚未结束，请完成后应用源图');if(store.get().ui.nativeTextEditor&&store.get().ui.nativeTextEditor.text!==store.get().ui.nativeTextEditor.originalText)throw new Error('请先应用或取消原生文字草稿，再返回演示');await sync.flush();const s=store.get();if(!s.doc?.native?.mediaLink)throw new Error('当前作品没有演示图片关联');const snapshot=JSON.stringify(s.doc),page=currentPage(s.doc);let blob,extension;
    if(s.doc.native.mediaLink.editor==='vector'&&!raster){const {serializePageSvg}=await import('./svg-export.js');const svg=await serializePageSvg(s.doc,page,{assetUrl:name=>sync.assetUrl(name)});blob=new Blob([svg],{type:'image/svg+xml'});extension='svg';}
    else{const {renderPageToCanvas}=await import('./engine.js'),canvas=await renderPageToCanvas(page,s.doc);blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));extension='png';}
    const valid=()=>store.get().root===s.root&&store.get().doc?.id===s.doc.id&&JSON.stringify(store.get().doc)===snapshot;if(!blob||!valid())throw new Error('渲染源图时作品已变化，未应用旧图');const asset=await sync.uploadAsset(new File([blob],'linked-edited.'+extension,{type:blob.type}));if(!valid())throw new Error('准备源图时作品已变化，未应用旧图');return sync.commitLinkedMedia(asset.name,s.revision);
  }
  async function prepareImageEdit(){
    if(store.get().nativeBusy)throw new Error('原生处理尚未结束，请完成后开始重绘');await sync.flush();let s=store.get(),layer=findLayerDeep(currentPage(s.doc).layers,s.ui.selectedId)?.layer;if(!layer||layer.type!=='image')throw new Error('请先选中图片并圈选重绘区域');
    if(layer.native?.engine!=='photocraft')await sync.nativeOperation({operation:'photo.attach',layerId:layer.id});await prepareRegionReference();s=store.get();layer=findLayerDeep(currentPage(s.doc).layers,s.ui.selectedId)?.layer;const region=selectionIdentity(s).region;if(!region)throw new Error('请用矩形、椭圆、套索或魔棒圈选重绘区域');return {layerId:layer.id,region};
  }
  function editNativeText(){const s=store.get(),sel=selectedNative(s);if(!sel||sel.nodes.length!==1||typeof sel.nodes[0].text!=='string'||sel.nodes[0].textTruncated)throw new Error('请选择一个完整原生文字对象');store.set({ui:{...s.ui,nativeTextEditor:{text:sel.nodes[0].text,originalText:sel.nodes[0].text,source:sel.layer.native.source,layerId:sel.layer.id,nodeId:sel.nodes[0].id,bounds:sel.bounds}}});}


	function setTool(tool) { const s = store.get(); store.set({ ui: { ...s.ui, tool } }); }

	function setView(patch) { const s = store.get(); store.set({ ui: { ...s.ui, ...patch } }); }

	function zoomBy(factor, centerScreen) {
		const s = store.get();
		const zoom = Math.max(0.05, Math.min(8, s.ui.zoom * factor));
		store.set({ ui: { ...s.ui, zoom } });
	}

	function fitToView(canvasEl) {
		const s = store.get();
		if (!s.doc || !canvasEl) return;
		const pad = 60;
		const zoom = Math.min((canvasEl.clientWidth - pad) / s.doc.canvas.width, (canvasEl.clientHeight - pad) / s.doc.canvas.height);
		store.set({ ui: { ...s.ui, zoom: Math.max(0.05, Math.min(8, zoom)), panX: (canvasEl.clientWidth - s.doc.canvas.width * zoom) / 2, panY: (canvasEl.clientHeight - s.doc.canvas.height * zoom) / 2 } });
	}

	function setPageId(pageId) { const s = store.get(); store.set({wandMask:null,uiSelection:null,ui:{...s.ui,pageId,selectedId:null,selectedIds:[],nativeSelection:null,nativeWholeId:null,nativeDraft:null,nativeTextEditor:null,nativeTargets:{},marquee:null,cropRect:null}}); }

	function setPointer(pt) { const s = store.get(); store.set({ ui: { ...s.ui, pointer: pt } }); }

	/* ---------------- layer operations ---------------- */

	function hitTestLayer(page, x, y) { return hitTest(page, x, y); }

	function createTextLayer(pt) {
		const layer = normalizeLayer({
			id: genId('txt'), type: 'text', name: '文本', text: '双击编辑文字',
			x: Math.round(pt.x), y: Math.round(pt.y), w: 320, h: 40,
			fontSize: 28, color: 'var(--color-ink)', bold: false
		});
		mutateDoc((doc) => { currentPage(doc).layers.push(layer); });
		return layer;
	}

	function createShapeLayer(shape, rect) {
		const s = store.get();
		const layer = normalizeLayer({
			id: genId('shp'), type: 'shape', name: shape, shape,
			x: Math.round(rect.x), y: Math.round(rect.y), w: Math.max(4, Math.round(rect.w)), h: Math.max(4, Math.round(rect.h)),
			fill: s.ui.fillStyle, stroke: null
		});
		mutateDoc((doc) => { currentPage(doc).layers.push(layer); });
		return layer;
	}

	function commitPenPath(points, close) {
		if (points.length < 2) return;
		let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} `;
		for (let i = 1; i < points.length; i++) d += `L ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)} `;
		if (close) d += 'Z';
		const xs = points.map(p => p.x), ys = points.map(p => p.y);
		const layer = normalizeLayer({
			id: genId('vec'), type: 'vector', name: '路径',
			x: Math.round(Math.min(...xs)), y: Math.round(Math.min(...ys)),
			w: Math.round(Math.max(...xs) - Math.min(...xs)) || 2, h: Math.round(Math.max(...ys) - Math.min(...ys)) || 2,
			paths: [{ d, fill: null, stroke: { color: store.get().ui.fillStyle, width: 2 } }]
		});
		mutateDoc((doc) => { currentPage(doc).layers.push(layer); });
	}

	function commitDraftShape() {
		const s = store.get();
		const draft = s.ui.draftShape;
		store.set({ ui: { ...s.ui, draftShape: null } });
		if (!draft || draft.w < 3 || draft.h < 3) return;
		const shape = s.ui.shapePreset || 'rect';
		createShapeLayer(shape, draft);
	}

	function updateLayersOriginals(originals, mutator) {
		const s = store.get();
		if (!s.doc) return;
		const doc = JSON.parse(JSON.stringify(s.doc));
		const page = currentPage(doc);
		const applyTo = (layers) => {
			for (const l of layers || []) {
				const original = originals.get(l.id);
				if(original){if(l.type==='vector'&&!l.geometryBox)l.geometryBox={x:original.x,y:original.y,w:original.w,h:original.h};mutator(l,original);}
				if (l.type === 'group') applyTo(l.children);
			}
		};
		applyTo(page.layers);
		store.set({ doc });
		sync.markLocalEdit();
	}

  function deleteSelection(){const s=store.get();if(selectedNative(s))throw new Error('当前选择是源对象，不能删除整个原生底稿');const ids=selectionRoots(currentPage(s.doc),selectedIds(s)).map(l=>l.id);if(!ids.length)return;mutateDoc(doc=>{for(const id of ids){const found=findLayerDeep(currentPage(doc).layers,id);protectNativePage(found.layer);found.list.splice(found.list.indexOf(found.layer),1);}});select(null);}
  function cloneObjectTree(layer){const copy=JSON.parse(JSON.stringify(layer));const assign=object=>{object.id=genId('object');for(const child of object.children||[])assign(child);};assign(copy);return copy;}
  function copySelection(){const s=store.get();if(selectedNative(s))throw new Error('源对象不能作为整个素材复制，请先选择素材本身');const layers=selectionRoots(currentPage(s.doc),selectedIds(s));for(const layer of layers)protectNativePage(layer);if(layers.length)store.set({clipboard:JSON.parse(JSON.stringify(layers))});}
  function pasteClipboard(){const s=store.get();if(!s.clipboard)return;const entries=Array.isArray(s.clipboard)?s.clipboard:[s.clipboard],ids=[];mutateDoc(doc=>{for(const layer of entries){protectNativePage(layer);const copy=cloneObjectTree(layer);translateTree(copy,24,24);currentPage(doc).layers.push(copy);ids.push(copy.id);}});store.set({ui:{...store.get().ui,selectedIds:ids,selectedId:ids.at(-1),nativeSelection:null}});}
  function duplicateSelection(){copySelection();pasteClipboard();}

	function reorderLayer(id, direction) {
		mutateDoc((doc) => {
			const page = currentPage(doc);
			const found = findLayerDeep(page.layers, id);
			if (!found) return;
			protectNativePage(found.layer);
			const index = found.list.indexOf(found.layer);
			const target = index + direction;
            if(target===0&&page.native?.engine==='deckcraft')return;
			if (target < 0 || target >= found.list.length) return;
			found.list.splice(index, 1);
			found.list.splice(target, 0, found.layer);
		});
	}

	/* ---------------- pages ---------------- */

	function addPage(layoutVars) {
		const s = store.get();
		const page = normalizePage({ id: genId('pg'), name: '页面 ' + ((s.doc.pages?.length || 0) + 1), background: { kind: 'solid', color: '#FFFFFF' }, layers: [] });
		mutateDoc((doc) => { doc.pages.push(page); });
		setPageId(page.id);
	}

	function duplicatePage(pageId) {
        if(store.get().doc.pages.find(p=>p.id===pageId)?.native?.engine==='deckcraft')return sync.nativeOperation({operation:'deck.clone',pageId});
		mutateDoc((doc) => {
			const index = doc.pages.findIndex(p => p.id === pageId);
			if (index < 0) return;
			const copy = JSON.parse(JSON.stringify(doc.pages[index]));
			copy.id = genId('pg');
			copy.name = (copy.name || '页面') + ' 副本';
			const reid = (layers) => { for (const l of layers || []) { l.id = genId('ly'); if (l.type === 'group') reid(l.children); } };
			reid(copy.layers);
			doc.pages.splice(index + 1, 0, copy);
		});
	}

	function deletePage(pageId) {
        if(store.get().doc.pages.find(p=>p.id===pageId)?.native?.engine==='deckcraft')return sync.nativeOperation({operation:'deck.delete',pageId});
		mutateDoc((doc) => {
			if (doc.pages.length <= 1) return;
			doc.pages = doc.pages.filter(p => p.id !== pageId);
		});
		const s = store.get();
		if (s.ui.pageId === pageId) setPageId(s.doc.pages[0]?.id || null);
	}

	function movePage(pageId, direction) {
		mutateDoc((doc) => {
			const index = doc.pages.findIndex(p => p.id === pageId);
			const target = index + direction;
			if (index < 0 || target < 0 || target >= doc.pages.length) return;
			const [page] = doc.pages.splice(index, 1);
			doc.pages.splice(target, 0, page);
		});
	}

	function updatePage(patch) {
		if(patch.background&&currentPage(store.get().doc)?.native?.engine==='deckcraft')throw new Error('原生背景请通过源对象编辑选项修改');
		mutateDoc((doc) => {
			const page = currentPage(doc);
			Object.assign(page, patch);
		});
	}

	/* ---------------- shared canvas pixel tools ---------------- */

  function imagePoint(layer,surface,pt){
    const angle=-(layer.rotation||0)*Math.PI/180,cx=layer.x+layer.w/2,cy=layer.y+layer.h/2;
    const dx=pt.x-cx,dy=pt.y-cy;
    let x=(dx*Math.cos(angle)-dy*Math.sin(angle)+layer.w/2)/layer.w;
    let y=(dx*Math.sin(angle)+dy*Math.cos(angle)+layer.h/2)/layer.h;
    const crop=layer.crop||{x:0,y:0,w:surface.width,h:surface.height};
    x=crop.x+x*crop.w;y=crop.y+y*crop.h;
    if(layer.transform?.flipH)x=surface.width-x;if(layer.transform?.flipV)y=surface.height-y;
    return {x,y};
  }
  function nativePixelTarget(layer){
    const selected=store.get().ui.nativeTargets?.[layer.id];return layer.native?.layers?.find(item=>item.id===Number(selected))?.id||layer.native?.layers?.find(item=>item.kind==='Pixel')?.id;
  }
  function editNativeImage(layer,commands){return sync.nativeOperation({operation:'photo.apply',layerId:layer.id,nativeLayerId:nativePixelTarget(layer),commands});}
  function nativeImagePoint(layer,point){return imagePoint(layer,{width:layer.naturalWidth,height:layer.naturalHeight},point);}
	function beginPaint(){return enqueuePixel(()=>{nativeGesture=genId('stroke');nativeTrail=[];const s=store.get(),layer=findLayerDeep(currentPage(s.doc).layers,s.ui.selectedId)?.layer;if(layer?.native?.engine!=='photocraft')pushUndo({queued:true});});}
	function paintOnLayer(layer,from,to,opts){return enqueuePixel(()=>paintOnLayerNow(layer,from,to,opts));}
	async function paintOnLayerNow(layer, from, to, opts) {
		layer=store.get().doc.pages.flatMap(p=>flattenLayers(p.layers)).find(l=>l.id===layer.id);
		if(!layer)throw new Error('图片图层已删除');
    if(layer.native?.engine==='photocraft'){
      const doc=JSON.parse(JSON.stringify(store.get().doc)),target=doc.pages.flatMap(p=>flattenLayers(p.layers)).find(item=>item.id===layer.id);
      const journal=target.pendingNativePaint||(target.pendingNativePaint={source:layer.native.source,asset:layer.asset,strokes:[]});
      const gesture=nativeGesture||genId('stroke'),selected=store.get().ui.nativeTargets?.[layer.id];
      const layerId=layer.native.layers.find(item=>item.id===Number(selected))?.id||layer.native.layers.find(item=>item.kind==='Pixel')?.id;
      if(layerId==null)throw new Error('请在原生对象中选择一个可绘画图层');
      const dimensions={width:layer.naturalWidth,height:layer.naturalHeight},a=imagePoint(layer,dimensions,from),b=imagePoint(layer,dimensions,to),size=opts.size*dimensions.width/layer.w;
      if(size<.5||size>5000)throw new Error('原生画笔尺寸需要为 0.5 至 5000 源像素');
      let stroke=journal.strokes.find(item=>item.gesture===gesture);
      if(!stroke){if(journal.strokes.length>=32)throw new Error('待处理笔画已满，请先保存');stroke={gesture,layerId,params:{points:[[a.x,a.y,1]],size,hardness:1,opacity:opts.opacity??1,flow:1,spacing:.1,smoothing:0,color:opts.color,erase:opts.eraser===true,mode:opts.eraser?'clear':'normal'}};journal.strokes.push(stroke);}
      if(stroke.params.points.length>=10000)throw new Error('单笔超过10000个采样点，请结束此笔画后继续');stroke.params.points.push([b.x,b.y,1]);
      nativeTrail.push({...to});store.set({doc,paintRev:(store.get().paintRev||0)+1,ui:{...store.get().ui,penPreview:[...nativeTrail]}});sync.markLocalEdit();scheduleBake();return;
    }
		const surface = await getPaintSurface(layer, store.get().doc);
		if (!surface) { toast('图片尚未加载'); return; }
		const ctx = surface.getContext('2d');
		const scale = surface.width / layer.w;
		const sx = pt => imagePoint(layer,surface,pt);
		const a = sx(from), b = sx(to);
		ctx.save();
		if (opts.eraser) ctx.globalCompositeOperation = 'destination-out';
		ctx.strokeStyle = opts.color;
		ctx.lineWidth = Math.max(1, opts.size * scale);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		ctx.globalAlpha = Math.max(0.05, Math.min(1, opts.opacity ?? 1));
		ctx.beginPath();
		ctx.moveTo(a.x, a.y);
		ctx.lineTo(b.x, b.y);
		ctx.stroke();
		ctx.restore();
		surface.__rev = (surface.__rev || 0) + 1;
		invalidateLayerCache(layer.id);
		store.set({ paintRev: (store.get().paintRev || 0) + 1 });
		sync.markLocalEdit();
		scheduleBake();
	}

	function bucketFill(docPt,color){
    const state=store.get(),page=currentPage(state.doc),layer=state.ui.selectedId?findLayerDeep(page.layers,state.ui.selectedId)?.layer:hitTest(page,docPt.x,docPt.y);
    if(layer?.type==='native')throw new Error('复杂原生对象请在源对象编辑中设置填充，当前对象未被转换成普通位图');
    if(layer?.native?.engine==='photocraft'){const point=nativeImagePoint(layer,docPt);return editNativeImage(layer,[{id:'paint.bucket',params:{x:point.x,y:point.y,color,tolerance:40,opacity:100}}]);}
    return enqueuePixel(()=>bucketFillNow(docPt,color));
  }
	async function bucketFillNow(docPt, color) {
		const s = store.get();
		const p = s.doc.pages.find(pg => pg.id === s.ui.pageId) || s.doc.pages[0];
		const layer = s.ui.selectedId ? findLayerDeep(p.layers, s.ui.selectedId)?.layer : hitTest(p, docPt.x, docPt.y);
		if (!layer || layer.type !== 'image') {
			if (layer) { // fill shape/vector/text color
				mutateDoc((doc) => {
					const page = currentPage(doc);
					const target = findLayerDeep(page.layers, layer.id);
					if (target) target.layer.fill = color;
				}, {queued:true});
				return;
			}
			toast('油漆桶：请选中图片图层，或点击形状填充');
			return;
		}
		pushUndo({queued:true});
		const surface = await getPaintSurface(layer);
		if (!surface) return;
		const scale = surface.width / layer.w;
		const px = Math.max(0, Math.min(surface.width - 1, Math.round((docPt.x - layer.x) * scale)));
		const py = Math.max(0, Math.min(surface.height - 1, Math.round((docPt.y - layer.y) * scale)));
		const ctx = surface.getContext('2d');
		const image = ctx.getImageData(0, 0, surface.width, surface.height);
		const mask = floodFillMask(image.data, surface.width, surface.height, px, py, 40);
		const rgb = hexToRgb(color);
		for (let i = 0; i < mask.length; i++) {
			if (!mask[i]) continue;
			const di = i * 4;
			image.data[di] = rgb[0]; image.data[di + 1] = rgb[1]; image.data[di + 2] = rgb[2]; image.data[di + 3] = 255;
		}
		ctx.putImageData(image, 0, 0);
		surface.__rev = (surface.__rev || 0) + 1;
		invalidateLayerCache(layer.id);
		store.set({ paintRev: (store.get().paintRev || 0) + 1 });
		sync.markLocalEdit();
		scheduleBake();
	}

	function floodFillMask(data, w, h, sx, sy, tolerance) {
		const target = (sy * w + sx) * 4;
		const tr = data[target], tg = data[target + 1], tb = data[target + 2], ta = data[target + 3];
		const mask = new Uint8Array(w * h);
		const visited = new Uint8Array(w * h);
		const stack = [sy * w + sx];
		const tol2 = tolerance * tolerance * 4;
		while (stack.length) {
			const p = stack.pop();
			if (visited[p]) continue;
			visited[p] = 1;
			const i = p * 4;
			const d = (data[i] - tr) ** 2 + (data[i + 1] - tg) ** 2 + (data[i + 2] - tb) ** 2 + (data[i + 3] - ta) ** 2;
			if (d > tol2) continue;
			mask[p] = 1;
			const x = p % w, y = (p / w) | 0;
			if (x > 0) stack.push(p - 1);
			if (x < w - 1) stack.push(p + 1);
			if (y > 0) stack.push(p - w);
			if (y < h - 1) stack.push(p + w);
		}
		return mask;
	}

	const hexToRgb = (hex) => {
		const c = String(hex).replace('#', '');
		const n = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
		return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
	};

  async function pickColor(point){
    const c=scope();await sync.flush();if(!sameScope(c))throw new Error('作品已切换，取色已取消');
    const state=store.get(),doc=state.doc,page=currentPage(doc),mod=await import('./engine.js'),canvas=await mod.renderPageToCanvas(page,doc);
    if(!sameScope(c))throw new Error('作品已切换，取色已取消');
    const x=Math.max(0,Math.min(canvas.width-1,Math.floor(point.x*canvas.width/doc.canvas.width))),y=Math.max(0,Math.min(canvas.height-1,Math.floor(point.y*canvas.height/doc.canvas.height))),rgba=canvas.getContext('2d').getImageData(x,y,1,1).data;
    const color='#'+[...rgba.slice(0,3)].map(value=>value.toString(16).padStart(2,'0')).join('');store.set({ui:{...store.get().ui,fillStyle:color}});toast('取色 '+color);return color;
  }

	async function magicWand(docPt, additive) {
		const s = store.get();
		const p = s.doc.pages.find(pg => pg.id === s.ui.pageId) || s.doc.pages[0];
		const layer = s.ui.selectedId ? findLayerDeep(p.layers, s.ui.selectedId)?.layer : hitTest(p, docPt.x, docPt.y);
		if (!layer || layer.type !== 'image') { toast('魔棒：请点击图片图层'); return; }
    if(layer.native?.engine==='photocraft'){
      const point=nativeImagePoint(layer,docPt),result=await editNativeImage(layer,[{id:'select.magicWand',params:{x:point.x,y:point.y,tolerance:s.ui.wandTolerance??32,antiAlias:s.ui.wandAntiAlias!==false,sampleAllLayers:s.ui.wandSampleAll===true,mode:additive?'add':'replace'}}]);
      store.set({uiSelection:null,wandMask:result.candidate.inspect.hasSelection?{native:true,layerId:layer.id,bounds:result.candidate.inspect.selectionBounds}:null});return result;
    }

		const surface = await getPaintSurface(layer);
		if (!surface) return;
		const scale = surface.width / layer.w;
		const px = Math.round((docPt.x - layer.x) * scale), py = Math.round((docPt.y - layer.y) * scale);
		if (px < 0 || py < 0 || px >= surface.width || py >= surface.height) return;
		const ctx = surface.getContext('2d');
		const image = ctx.getImageData(0, 0, surface.width, surface.height);
		const { mask, bounds } = magicWandMask(image, surface.width, surface.height, px, py, s.ui.wandTolerance || 32);
		// visualize + remember
		const overlayCanvas = document.createElement('canvas');
		overlayCanvas.width = surface.width; overlayCanvas.height = surface.height;
		const octx = overlayCanvas.getContext('2d');
		const visual = octx.createImageData(surface.width, surface.height);
		for (let i = 0; i < mask.length; i++) {
			if (mask[i]) { const di = i * 4; visual.data[di] = 94; visual.data[di + 1] = 168; visual.data[di + 2] = 255; visual.data[di + 3] = 70; }
		}
		octx.putImageData(visual, 0, 0);
		store.set({
			uiSelection:null,wandMask: { layerId: layer.id, mask, bounds, scale, layerOrigin: { x: layer.x, y: layer.y }, previewUrl: overlayCanvas.toDataURL() }
		});
		toast('魔棒选区 ' + bounds.w + '×' + bounds.h + ' — 可用「填充选区/删除选区」');
	}

	function fillWandSelection(color) {
		const s = store.get();
		const wand = s.wandMask;
		if (!wand) { toast('没有魔棒选区'); return; }
    if(wand.native){const layer=findLayerDeep(currentPage(s.doc).layers,wand.layerId)?.layer;return editNativeImage(layer,[{id:'edit.fill',params:{contents:'color',color,opacity:100}}]);}

		pushUndo();
		return enqueuePixel(async () => {
			const page = currentPage(store.get().doc);
			const found = findLayerDeep(page.layers, wand.layerId);
			if (!found) return;
			const surface = await getPaintSurface(found.layer);
			if (!surface) return;
			const ctx = surface.getContext('2d');
			const image = ctx.getImageData(0, 0, surface.width, surface.height);
			const rgb = hexToRgb(color);
			for (let i = 0; i < wand.mask.length; i++) {
				if (!wand.mask[i]) continue;
				const di = i * 4;
				image.data[di] = rgb[0]; image.data[di + 1] = rgb[1]; image.data[di + 2] = rgb[2]; image.data[di + 3] = 255;
			}
			ctx.putImageData(image, 0, 0);
			surface.__rev = (surface.__rev || 0) + 1;
			invalidateLayerCache(found.layer.id);
			store.set({ paintRev: (store.get().paintRev || 0) + 1, wandMask: null });
			sync.markLocalEdit();
			scheduleBake();
		});
	}

	function deleteWandSelection() {
		const s = store.get();
		const wand = s.wandMask;
		if (!wand) { toast('没有魔棒选区'); return; }
    if(wand.native){const layer=findLayerDeep(currentPage(s.doc).layers,wand.layerId)?.layer;return editNativeImage(layer,[{id:'edit.clear',params:{}}]);}

		pushUndo();
		return enqueuePixel(async () => {
			const page = currentPage(store.get().doc);
			const found = findLayerDeep(page.layers, wand.layerId);
			if (!found) return;
			const surface = await getPaintSurface(found.layer);
			if (!surface) return;
			const ctx = surface.getContext('2d');
			const image = ctx.getImageData(0, 0, surface.width, surface.height);
			for (let i = 0; i < wand.mask.length; i++) {
				if (wand.mask[i]) image.data[i * 4 + 3] = 0;
			}
			ctx.putImageData(image, 0, 0);
			surface.__rev = (surface.__rev || 0) + 1;
			invalidateLayerCache(found.layer.id);
			store.set({ paintRev: (store.get().paintRev || 0) + 1, wandMask: null });
			sync.markLocalEdit();
			scheduleBake();
		});
	}

  async function clearWandSelection(){
    const s=store.get(),wand=s.wandMask;
    if(wand?.native){const layer=findLayerDeep(currentPage(s.doc).layers,wand.layerId)?.layer;if(layer)await editNativeImage(layer,[{id:'select.deselect'}]);}
    store.set({wandMask:null});
  }

	/* ---------------- marquee & crop ---------------- */

	function setMarquee(marquee) { const s = store.get(); store.set({ ui: { ...s.ui, marquee } }); }

	function commitMarquee() {
		const s = store.get();
		const m = s.ui.marquee;
		store.set({ ui: { ...s.ui, marquee: null } });
		if (!m) return;
		if (m.mode === 'lasso' && m.points && m.points.length > 2) {
			const d = 'M ' + m.points.map(p => p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' L ') + ' Z';
			store.set({ uiSelection: { kind: 'path', d,pageId:s.ui.pageId,layerId:s.ui.selectedId } });
		} else {
			const x = Math.min(m.start.x, m.current.x), y = Math.min(m.start.y, m.current.y);
			const w = Math.abs(m.current.x - m.start.x), h = Math.abs(m.current.y - m.start.y);
			if (w > 2 && h > 2) store.set({ uiSelection: { kind: m.mode === 'marqueeEllipse' ? 'ellipse' : 'rect', x, y, w, h,pageId:s.ui.pageId,layerId:s.ui.selectedId } });
		}
	}

	function setDraftShape(draftShape) { const s = store.get(); store.set({ ui: { ...s.ui, draftShape } }); }
	function setGradientDrag(gradientDrag) { const s = store.get(); store.set({ ui: { ...s.ui, gradientDrag } }); }
	function setPenPreview(penPreview) { const s = store.get(); store.set({ ui: { ...s.ui, penPreview } }); }
	function setCropRect(cropRect) { const s = store.get(); store.set({ ui: { ...s.ui, cropRect } }); }

	function commitGradientDrag() {
    const s=store.get(),drag=s.ui.gradientDrag;store.set({ui:{...s.ui,gradientDrag:null}});
    const layer=s.ui.selectedId?findLayerDeep(currentPage(s.doc).layers,s.ui.selectedId)?.layer:null;
    if(!drag||!layer)return;
    if(layer.native?.engine==='photocraft'){
      const a=nativeImagePoint(layer,drag.start),b=nativeImagePoint(layer,drag.current);
      return editNativeImage(layer,[{id:'paint.gradient',params:{from:[a.x,a.y],to:[b.x,b.y],stops:[[0,s.ui.fillStyle],[1,s.ui.gradientEnd||'#ffffff']],transparency:[[0,100],[1,100]],dither:false,method:'classic',opacity:100}}]);
    }
    if(layer.type==='native')throw new Error('该原生对象请使用专业编辑选项设置渐变');
    if(layer.type==='image')return enqueuePixel(async()=>{
      pushUndo({queued:true});const surface=await getPaintSurface(layer);if(!surface)throw new Error('图片尚未加载');
      const a=imagePoint(layer,surface,drag.start),b=imagePoint(layer,surface,drag.current),ctx=surface.getContext('2d');
      const gradient=ctx.createLinearGradient(a.x,a.y,b.x,b.y);gradient.addColorStop(0,s.ui.fillStyle);gradient.addColorStop(1,s.ui.gradientEnd||'#fff');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,surface.width,surface.height);surface.__rev=(surface.__rev||0)+1;
      invalidateLayerCache(layer.id);store.set({paintRev:(store.get().paintRev||0)+1});sync.markLocalEdit();scheduleBake();
    });
    mutateDoc(doc=>{const target=findLayerDeep(currentPage(doc).layers,layer.id);if(!target)return;const paint={kind:'linear',angle:Math.atan2(drag.current.y-drag.start.y,drag.current.x-drag.start.x)*180/Math.PI-(layer.rotation||0),stops:[[0,s.ui.fillStyle],[1,s.ui.gradientEnd||'#fff']]};if(target.layer.type==='vector')target.layer.paths=target.layer.paths.map(path=>({...path,fill:paint}));else target.layer.fill=paint;});
  }

  async function applyCrop(){
    const s=store.get(),rect=s.ui.cropRect;if(!rect||rect.w<4||rect.h<4)throw new Error('裁剪区域太小');
    const layer=s.ui.selectedId?findLayerDeep(currentPage(s.doc).layers,s.ui.selectedId)?.layer:null;
    if(layer)protectNativePage(layer);
    if(layer&&['image','native'].includes(layer.type)){
      if(layer.rotation)throw new Error('旋转对象请先在原生引擎中裁剪，避免将矩形选区错误映射到源图');
      const signature=JSON.stringify(layer),image=await loadImage(layer.asset);if(!image)throw new Error('裁剪源图片未加载');
      if(store.get().root!==s.root||store.get().doc?.id!==s.doc.id)throw new Error('作品已经切换');
      const current=findLayerDeep(currentPage(store.get().doc).layers,layer.id)?.layer;if(JSON.stringify(current)!==signature)throw new Error('裁剪期间图层已变化，请重新选择区域');
      const x=Math.max(layer.x,rect.x),y=Math.max(layer.y,rect.y),w=Math.min(layer.x+layer.w,rect.x+rect.w)-x,h=Math.min(layer.y+layer.h,rect.y+rect.h)-y;
      if(w<=0||h<=0)throw new Error('裁剪区域与图片不相交');
      const original=layer.crop||{x:0,y:0,w:image.naturalWidth,h:image.naturalHeight};
      mutateDoc(doc=>{const target=findLayerDeep(currentPage(doc).layers,layer.id).layer;target.crop={x:original.x+(x-layer.x)/layer.w*original.w,y:original.y+(y-layer.y)/layer.h*original.h,w:w/layer.w*original.w,h:h/layer.h*original.h};Object.assign(target,{x,y,w,h});});
    }else{
      mutateDoc(doc=>{
        doc.canvas={width:Math.round(rect.w),height:Math.round(rect.h)};
        const shift=layers=>{for(const layer of layers||[]){if(layer.type==='vector'&&!layer.geometryBox)layer.geometryBox={x:layer.x,y:layer.y,w:layer.w,h:layer.h};layer.x=(layer.x||0)-rect.x;layer.y=(layer.y||0)-rect.y;if(layer.type==='group')shift(layer.children);}};
        for(const page of doc.pages)shift(page.layers);
      });
    }
    store.set({ui:{...store.get().ui,cropRect:null}});
  }

	/* ---------------- inline text editing ---------------- */

	function editText(layerId) { const s = store.get(); store.set({ ui: { ...s.ui, editingTextId: layerId } }); }
	function commitText(layerId, text) {
		const s = store.get();
		store.set({ ui: { ...s.ui, editingTextId: null } });
		mutateDoc((doc) => {
			const page = currentPage(doc);
			const found = findLayerDeep(page.layers, layerId);
			if (found) found.layer.text = text;
		});
	}

	/* ---------------- assets ---------------- */

  async function importDeckAsset(asset){
    const created=await sync.createDoc(normalizeDoc({title:asset,type:'deck',canvas:{width:1280,height:720},pages:[{id:genId('page'),name:'待导入',layers:[]}]}));
    if(store.get().activeId!==created.id)throw new Error('空白作品已建立；当前作品已切换，导入未向其他作品写入');
    const result=await sync.nativeOperation({operation:'deck.import',asset});
    const first=store.get().doc.pages[0];setPageId(first.id);select(first.layers[0]?.id);setTool('select');return result;
  }
  async function importDeckFiles(files){for(const file of files){const saved=await sync.uploadAsset(file);await importDeckAsset(saved.name);}}
  async function addImageLayerFromAsset(assetName,at){
    const s=store.get(),existing=s.doc.pages.flatMap(p=>flattenLayers(p.layers)).find(l=>(l.type==='image'||l.type==='native')&&(typeof l.asset==='string'?l.asset:l.asset?.src)===assetName);
    if(existing){
      const layer=JSON.parse(JSON.stringify(existing));layer.id=genId('img');layer.x=(at?.x??s.doc.canvas.width/2)-layer.w/2;layer.y=(at?.y??s.doc.canvas.height/2)-layer.h/2;
      mutateDoc(doc=>currentPage(doc).layers.push(layer));select(layer.id);return layer;
    }
    if(/\.(deckcraft|pptx)$/i.test(assetName))return importDeckAsset(assetName);
    const operation=/\.(svg|svgz|vectorcraft|ai|pdf)$/i.test(assetName)?'vector.import':'photo.import';
    const result=await sync.nativeOperation({operation,asset:assetName,at});
    select(result.candidate.layerId||result.candidate.layerIds?.[0]);return result;
  }
  async function importFilesAsLayers(files,at){
    for(const file of files){const uploaded=await sync.uploadAsset(file);await addImageLayerFromAsset(uploaded.name,at);}
  }
  const importSvgFiles=importFilesAsLayers;
  async function createPhotoWork(){
    const created=await sync.createDoc(normalizeDoc({title:'新图片作品',type:'photo',canvas:{width:1080,height:1080},pages:[{id:genId('page'),name:'图片',background:{kind:'solid',color:'#FFFFFF'},layers:[]}]}));
    if(store.get().activeId!==created.id)throw new Error('空白图片作品已建立；当前作品已切换，未向其他作品添加图层');
    const result=await sync.nativeOperation({operation:'photo.create'});select(result.candidate.layerId);setTool('brush');
  }
  async function createVectorWork(){
    await sync.createDoc(normalizeDoc({title:'新矢量画板',type:'canvas',workspaceMode:'vector',canvas:{width:1280,height:720},pages:[{id:genId('page'),name:'画板',background:{kind:'solid',color:'#FFFFFF'},layers:[]}]}));setTool('pen');
  }

	/* ---------------- paint surface baking (autosave pixels) ---------------- */

	let bakeTimer = null;
	function scheduleBake() {
		if (bakeTimer) clearTimeout(bakeTimer);
		if(disposed)return;
		bakeTimer = setTimeout(() => bakeDirtySurfaces().then(()=>sync.scheduleSave()).catch(error=>toast(error?.message||String(error))), 1200);
	}

  async function bakeDirtySurfaces(){
    clearTimeout(bakeTimer);bakeTimer=null;
    if(!pendingPixelOps&&!baking&&!dirtyPixels()&&!pendingNative().length)return;
    if(baking){await baking;await pixelQueue;return bakeDirtySurfaces();}
    const c=scope();
    const task=pixelQueue.then(async()=>{
      if(!c.root||!store.get().doc)return;
      for(const layer of pendingNative()){
        const before=JSON.parse(JSON.stringify(store.get().doc));for(const page of before.pages)for(const item of flattenLayers(page.layers))delete item.pendingNativePaint;
        await sync.nativeOperation({operation:'photo.apply',layerId:layer.id,pageId:store.get().doc.pages.find(p=>flattenLayers(p.layers).some(l=>l.id===layer.id)).id,commands:[]},{skipPixels:true,historyBefore:before});
        invalidateLayerCache(layer.id);store.set({ui:{...store.get().ui,penPreview:null}});
      }
      const layers=store.get().doc.pages.flatMap(p=>flattenLayers(p.layers)).filter(l=>l.type==='image');
      for(const layer of layers){
        const entry=surfacePeek(layer.id);if(!entry||!(entry.canvas.__rev>(entry.bakedRev||0)))continue;
        const revision=entry.canvas.__rev;
        const blob=await new Promise(resolve=>entry.canvas.toBlob(resolve,'image/png'));
        if(!blob)throw new Error('像素编码失败，修改仍保留在本地');
        const result=await sync.uploadAsset(new File([blob],'paint-'+layer.id+'.png',{type:'image/png'}));
        if(!sameScope(c))throw new Error('像素保存期间作品已切换');
        const doc=JSON.parse(JSON.stringify(store.get().doc));let found;
        for(const page of doc.pages){found=findLayerDeep(page.layers,layer.id);if(found)break;}
        if(!found)continue;
        if(found.layer.asset!==layer.asset)throw new Error('图片源已变更，未覆盖新的源文件');
        found.layer.asset=result.name;entry.assetKey=result.name+'|'+entry.canvas.width+'x'+entry.canvas.height;entry.bakedRev=revision;
        store.set({doc});sync.markLocalEdit();invalidateLayerCache(layer.id);
      }
    });
    baking=task;pixelQueue=task.catch(()=>{});try{await task;}finally{if(baking===task)baking=null;}
  }

	/* ---------------- exports ---------------- */

  async function exportPagePng(scale=2){
    await sync.flush();const s=store.get(),page=currentPage(s.doc);if(!page)return;
    const mod=await import('./engine.js'),canvas=await mod.renderPageToCanvas(page,s.doc,s.doc.canvas.width*scale,s.doc.canvas.height*scale);
    if(store.get().root!==s.root||store.get().doc?.id!==s.doc.id)throw new Error('作品已切换，导出已取消');
    downloadCanvas(canvas,(s.doc.title||'page')+'-'+(page.name||'1')+'.png');
  }

	function downloadCanvas(canvas, name) {
		canvas.toBlob((blob) => {
			if (!blob) return;
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = name;
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 4000);
		}, 'image/png');
	}

  async function exportWholePageSvg(){await sync.flush();const s=store.get(),snapshot=JSON.stringify(s.doc),{serializePageSvg}=await import('./svg-export.js');const content=await serializePageSvg(s.doc,currentPage(s.doc),{assetUrl:name=>sync.assetUrl(name,s.root)});if(store.get().root!==s.root||JSON.stringify(store.get().doc)!==snapshot)throw new Error('SVG 生成期间作品已变化，未导出旧版本');downloadBlob(content,(s.doc.title||'page')+'.svg','image/svg+xml');return content;}
  async function exportPageSvg(){
    await sync.flush();const s=store.get();if(!s.ui.selectedId)throw new Error('请先选中一个矢量或形状对象');
    const result=await sync.nativeOperation({operation:'vector.export',layerId:s.ui.selectedId,out:(s.doc.title||'vector').slice(0,80)+'.svg'});
    if(operation==='deck.promote'){select(null);toast('已转为原生演示，可直接编辑源对象；原版本可从历史恢复');return result;}
    const a=document.createElement('a');a.href=sync.downloadUrl(result.candidate.file,s.root);a.download=result.candidate.file;a.click();return result;
  }

	function downloadBlob(content, name, type) {
		const blob = content instanceof Blob ? content : new Blob([content], { type });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 4000);
	}

  async function exportNativePdf(){const result=await exportPptx('deck.pdf'),s=store.get();return result;}
  async function exportPhoto(format='psd'){await sync.flush();let s=store.get(),layer=findLayerDeep(currentPage(s.doc).layers,s.ui.selectedId)?.layer;if(!layer)throw new Error('请先选择图片源对象');if(layer.native?.engine!=='photocraft'||layer.native.renderedAsset!==layer.asset){const id=layer.id;await sync.nativeOperation({operation:'photo.attach',layerId:id});if(store.get().root!==s.root||store.get().doc?.id!==s.doc.id)throw new Error('作品已切换');s=store.get();layer=findLayerDeep(currentPage(s.doc).layers,id)?.layer;}const result=await sync.nativeOperation({operation:'photo.export',layerId:layer.id,expectedSource:layer.native?.source,format,out:(s.doc.title||'photo')+'-source.'+format});const a=document.createElement('a');a.href=sync.downloadUrl(result.candidate.file,s.root);a.download=result.candidate.file;a.click();return result;}
  async function exportPptx(operation='deck.export'){
    if(store.get().nativeBusy)throw new Error('原生处理尚未结束，请完成后导出');if(store.get().ui.nativeTextEditor&&store.get().ui.nativeTextEditor.text!==store.get().ui.nativeTextEditor.originalText)throw new Error('请先应用或取消原生文字草稿，再导出');await sync.flush();const s=store.get();if(!s.doc)return;
    const snapshot=JSON.stringify(s.doc),preparedAssets={},mod=await import('./engine.js');
    for(const layer of s.doc.pages.flatMap(page=>flattenLayers(page.layers)).filter(l=>l.type==='image')){
      if(layer.adjust&&Object.keys(layer.adjust).length||layer.filters?.length||layer.mask?.kind==='luminance'||layer.transform?.flipH||layer.transform?.flipV){
        const blob=await mod.exportImagePixels(layer,s.doc),saved=await sync.uploadAsset(new File([blob],'ppt-picture-'+layer.id+'.png',{type:'image/png'}));
        preparedAssets[layer.id]={name:saved.name,flipsBaked:true};
      }
    }
    if(store.get().root!==s.root||JSON.stringify(store.get().doc)!==snapshot)throw new Error('导出准备期间作品已变化，请使用最新版本重新导出');
    const result=await sync.nativeOperation({operation,out:(s.doc.title||'deck')+(operation==='deck.pdf'?'.pdf':'.pptx'),preparedAssets});
    const a=document.createElement('a');a.href=sync.downloadUrl(result.candidate.file,s.root);a.download=result.candidate.file;a.click();
    toast(operation==='deck.pdf'?'原生 PDF 已导出（含文字层）':'PPTX 已由 DeckCraft 原生引擎导出；原生源文件已保存在当前作品中。');
    return result;
  }

	async function exportPdf() {
        await sync.flush();
		const s = store.get();
		try {
			const mod = await import('./engine.js');
			const pages = [];
			for (const page of s.doc.pages || []) {
				const scale=s.doc.canvas.width*s.doc.canvas.height*4<=24_000_000?2:1;
				const canvas = await mod.renderPageToCanvas(page,s.doc,s.doc.canvas.width*scale,s.doc.canvas.height*scale);
                if(store.get().root!==s.root||store.get().doc?.id!==s.doc.id)throw new Error('作品已切换，PDF 导出已取消');
				const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
				const buffer = await blob.arrayBuffer();
				let binary = '';
				const bytes = new Uint8Array(buffer);
				for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
				pages.push({ name: page.name, widthPx: s.doc.canvas.width, heightPx: s.doc.canvas.height, kind: 'jpeg', dataBase64: btoa(binary) });
			}
			const saved = await sync.exportClientPdf(pages, (s.doc.title || 'export') + '.pdf',{root:s.root,id:s.activeId});
			const a = document.createElement('a');
			a.href = sync.downloadUrl(saved.name,s.root);
			a.download = saved.name;
			a.click();
			toast('PDF 已导出');
		} catch (error) { toast('PDF 导出失败: ' + String(error)); }
	}

  async function exportHtml(){
    await sync.flush();const s=store.get(),mod=await import('./engine.js'),pages=[];let bytes=0;
    const escape=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    for(const page of s.doc.pages){
      const canvas=await mod.renderPageToCanvas(page,s.doc),blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
      if(!blob)throw new Error('页面编码失败');bytes+=Math.ceil(blob.size*4/3);if(bytes>32*1024*1024)throw new Error('HTML 图像预览超过32MB预算，请使用 PPTX 或 PDF');
      const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});
      pages.push('<figure><img alt="'+escape(page.name)+'" src="'+url+'"><figcaption>'+escape(page.name)+'</figcaption></figure>');
    }
    if(store.get().root!==s.root||store.get().doc?.id!==s.doc.id)throw new Error('作品已切换，HTML 导出已取消');
    downloadBlob('<!doctype html><html><head><meta charset="utf-8"><title>'+escape(s.doc.title)+'</title><style>body{margin:0;padding:24px;background:#202936;color:white;font:14px sans-serif}figure{margin:0 auto 24px;max-width:1280px}img{display:block;width:100%;height:auto}figcaption{padding:8px}</style></head><body>'+pages.join('')+'</body></html>',(s.doc.title||'preview')+'.html','text/html');
  }

	async function exportMd() {
		const s = store.get();
		try {
			const result = await sync.runCommands([{ op: 'export.md', id: s.activeId, out: (s.doc.title || 'deck') + '.md' }]);
			const r = result.results?.[0];
			if (r?.ok) { const a = document.createElement('a'); a.href = sync.downloadUrl(r.file); a.download = r.file; a.click(); toast('Markdown 已导出'); }
		} catch (error) { toast('MD 导出失败: ' + String(error)); }
	}

	/* ---------------- presentation ---------------- */

	async function startPresentation() {
        await sync.flush();
		const s = store.get();
		const mod = await import('./deck.js');
		mod.openPresentation(s.doc, s.ui.pageId);
	}

	/* ---------------- templates & design systems & layouts ---------------- */

	async function instantiateTemplate(templateId, vars) {
		try {
			const result = await sync.runCommands([{ op: 'template.instantiate', templateId, vars: vars || {}, save: true }]);
			const r = result.results?.[0];
			if (r?.ok) { await sync.refreshState(); await sync.openDoc(r.id); toast('模板已创建: ' + r.id); }
			else toast('模板创建失败: ' + (r?.error || '?'));
		} catch (error) { toast('模板创建失败: ' + String(error)); }
	}

	async function appendTemplatePages(templateId, vars) {
		try {
			const s = store.get();
			const result = await sync.runCommands([{ op: 'template.instantiate', templateId, vars: vars || {}, save: false }]);
			const r = result.results?.[0];
			if (r?.ok && r.doc?.pages) {
				mutateDoc((doc) => {
					for (const page of r.doc.pages) {
						const copy = JSON.parse(JSON.stringify(page));
						copy.id=genId('pg');copy.layers=(copy.layers||[]).map(cloneObjectTree);
						doc.pages.push(copy);
					}
				});
				toast('已追加 ' + r.doc.pages.length + ' 页');
			}
		} catch (error) { toast('追加失败: ' + String(error)); }
	}

	async function applyDesignSystem(presetId) {
		try {
			const s = store.get();
			const result = await sync.runCommands([{ op: 'designsystem.applyPreset', id: s.activeId, presetId }]);
			const r = result.results?.[0];
			if (r?.ok) toast('设计系统已应用: ' + (r.name || presetId));
			else if (r) toast('应用失败: ' + r.error);
		} catch (error) { toast('应用失败: ' + String(error)); }
	}

	async function addLayoutSlide(layoutId, vars) {
		try {
			const s = store.get();
			const result = await sync.runCommands([{ op: 'deck.addSlide', id: s.activeId, layout: layoutId, vars: vars || {} }]);
			const r = result.results?.[0];
			if (r?.ok) toast('已添加版式页');
		} catch (error) { toast('添加失败: ' + String(error)); }
	}

	async function generateDeckFromOutline(outline) {
		try {
			const result = await sync.runCommands([{ op: 'deck.fromOutline', save: true, ...outline }]);
			const r = result.results?.[0];
			if (r?.ok) { await sync.refreshState(); await sync.openDoc(r.id); toast('演示文稿已生成: ' + r.id + '（' + r.pages + ' 页）'); }
			else toast('生成失败: ' + (r?.error || '?'));
		} catch (error) { toast('生成失败: ' + String(error)); }
	}

	/* ---------------- isolated motion workspace ---------------- */

	let motionRenderPoll=null,motionGeneration=0;
	const motionBridge=new MotionPreviewBridge();
	function motionScope(){const s=currentDesignScope(store.get().services);if(!s?.root||!s.sessionId)throw new Error('项目设计对话尚未就绪');return s;}
	const sameMotionScope=s=>{try{const now=motionScope();return now.root===s.root&&now.sessionId===s.sessionId;}catch{return false;}};
	async function motionPostAt(scope,action,payload){
		const r=await fetch('/designcraft/api/v1/motion/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...payload,root:scope.root,sessionId:scope.sessionId})});
		const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));return j;
	}
	const motionPost=(action,payload)=>motionPostAt(motionScope(),action,payload);
	async function motionGet(action,params){
		const scope=motionScope(),q=new URLSearchParams({...params,root:scope.root,sessionId:scope.sessionId});
		const r=await fetch('/designcraft/api/v1/motion/'+action+'?'+q,{cache:'no-store'});
		const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||('HTTP '+r.status));return j;
	}
	function motionPreviewUrl(m){return m?.preview?.url||'';}
	async function prepareMotionPreview(m){
		const scope=m.scope,generation=motionGeneration;
		const descriptor=await motionPostAt(scope,'preview_session',{projectId:m.projectId,revision:m.revision,leaseId:m.leaseId,viewEpoch:m.viewEpoch});
		const cur=store.get().motion;
		if(generation!==motionGeneration||!sameMotionScope(scope)||cur?.projectId!==m.projectId||cur.revision!==m.revision)return;
		store.set({motion:{...cur,preview:descriptor,previewReady:false,previewError:null}});
	}
	async function publishMotion(opened,metadata,scope){
		if(!sameMotionScope(scope))throw new Error('项目已切换，动画已保存在原项目中');
		motionGeneration++;motionBridge.dispose();
		const manifest=metadata?.manifest||metadata||{},render=manifest.render||opened.render||{fps:{num:30,den:1},durationFrames:120,width:1280,height:720};
		const m={projectId:opened.projectId,revision:opened.revision,leaseId:opened.leaseId,viewEpoch:opened.viewEpoch,scope,
			entryFile:manifest.entryFile||opened.entryFile||'composition.html',title:manifest.title||opened.title||'动画',render,
			playing:false,currentFrame:0,fps:render.fps,durationFrames:render.durationFrames,renderStatus:null,preview:null,previewError:null};
		store.set({motion:m});
		try{await prepareMotionPreview(m);}catch(error){const now=store.get().motion;if(now?.projectId===m.projectId&&now.revision===m.revision)store.set({motion:{...now,previewError:error.message}});throw error;}
		return opened;
	}
	async function listMotionTemplates(){const r=await motionGet('templates');store.set({motionTemplates:r.templates||[]});return r.templates||[];}
	async function createMotionFromTemplate(templateId,title){
		const scope=motionScope(),r=await motionPostAt(scope,'create_from_template',{templateId,title:title||undefined,operationKey:'ui-tpl-'+crypto.randomUUID()});
		return publishMotion(r,r,scope);
	}
	async function createMotionProject(title,render){
		const scope=motionScope(),r=await motionPostAt(scope,'create',{title:title||'新动画',operationKey:'ui-create-'+crypto.randomUUID(),render:render||{fps:{num:30,den:1},durationFrames:120,width:1280,height:720}});
		const meta=await motionGet('project',{projectId:r.projectId});return publishMotion(r,meta,scope);
	}
	async function listMotionProjects(){const r=await motionGet('projects');store.set({motionProjects:r.projects||[]});return r.projects||[];}
	async function openMotionProject(projectId){
		const scope=motionScope(),r=await motionPostAt(scope,'open',{projectId}),meta=await motionGet('project',{projectId});return publishMotion(r,meta,scope);
	}
	async function motionAutoEnter(){
		const scope=motionScope(),existing=store.get().motion;
		if(existing?.projectId&&sameMotionScope(existing.scope)){
			if(!existing.preview)await prepareMotionPreview(existing);return existing;
		}
		const projects=await listMotionProjects();return projects.length?openMotionProject(projects[0].projectId):createMotionProject();
	}
	function bindMotionPreview(frame){
		const m=store.get().motion;if(!m?.preview||!frame)return()=>{};
		const identity=m.preview.nonce;
		const current=()=>!disposed&&sameMotionScope(m.scope)&&store.get().workspaceMode==='motion'&&store.get().motion?.preview?.nonce===identity;
		return motionBridge.bind(frame,m.preview,{render:m.render,isCurrent:current,
			onReady(){if(!current())return;const cur=store.get().motion;store.set({motion:{...cur,previewReady:true,previewError:null}});motionBridge.command('seek',{frame:cur.currentFrame||0});motionBridge.command('play');},
			onTime(update){if(current())store.set({motion:{...store.get().motion,currentFrame:update.frame,playing:update.playing}});},
			onSelection(selection){if(current()){motionBridge.command('pause');store.set({motion:{...store.get().motion,selection,playing:false}});}},
			onError(message){if(current())store.set({motion:{...store.get().motion,playing:false,previewReady:false,previewError:message}});}});
	}
	function motionPreviewAutoplay(){motionBridge.hello();}
	function toggleMotionPlay(){const m=store.get().motion;if(m?.previewReady)motionBridge.command(m.playing?'pause':'play');}
	function seekMotionFrame(frame){
		const m=store.get().motion;if(!m?.projectId)return;
		const next=Math.max(0,Math.min((m.durationFrames||120)-1,Math.trunc(frame)));
		motionBridge.command('pause');motionBridge.command('seek',{frame:next});
		store.set({motion:{...m,playing:false,currentFrame:next}});
	}
	function motionPreviewSeek(){const m=store.get().motion;if(m?.projectId)motionBridge.command('seek',{frame:m.currentFrame||0});}
	function closeMotionWorkspace(){
		const m=store.get().motion;motionGeneration++;motionBridge.dispose();
		if(m?.scope&&m.projectId)void motionPostAt(m.scope,'close_lease',{projectId:m.projectId}).catch(()=>{});
		if(m)store.set({motion:{...m,preview:null,previewReady:false,playing:false}});
	}
	async function motionPollHead(){
		const m=store.get().motion;if(!m?.projectId||!sameMotionScope(m.scope))return;
		const meta=await motionGet('project',{projectId:m.projectId});
		if(store.get().motion?.projectId!==m.projectId)return;
		if(meta.manifest?.revision!==m.revision){const opened=await motionPostAt(m.scope,'open',{projectId:m.projectId});await publishMotion(opened,meta,m.scope);}
	}
	async function motionDoctor(){
		const report=await motionPostAt(motionScope(),'doctor',{});store.set({motionEnvironment:report});return report;
	}
	async function cancelMotionRender(){
		const m=store.get().motion;if(!m?.renderStatus?.jobId)throw new Error('没有正在运行的渲染任务');
		const result=await motionPostAt(m.scope,'cancel_render',{jobId:m.renderStatus.jobId});
		if(store.get().motion?.projectId===m.projectId&&sameMotionScope(m.scope))store.set({motion:{...store.get().motion,renderStatus:{...m.renderStatus,status:'cancelling'}}});return result;
	}
	async function renderMotion(){
		const m=store.get().motion;if(!m?.projectId)throw new Error('请先创建或打开动画');
		const active=new Set(['starting','running','rendering','verifying','cleaning','cancelling']);
		if(active.has(m.renderStatus?.status))throw new Error('上一项导出仍在运行或清理，请稍候');
		if(motionRenderPoll)clearInterval(motionRenderPoll);
		const opKey='ui-render-'+crypto.randomUUID();store.set({motion:{...m,renderStatus:{status:'starting',opRevision:m.revision,opKey}}});
		let r;try{r=await motionPostAt(m.scope,'render',{projectId:m.projectId,baseRevision:m.revision,leaseId:m.leaseId,viewEpoch:m.viewEpoch,operationKey:opKey});}
		catch(error){if(store.get().motion?.projectId===m.projectId&&sameMotionScope(m.scope))store.set({motion:{...store.get().motion,renderStatus:{status:'failed',error:error.message,opKey,opRevision:m.revision}}});throw error;}
		if(store.get().motion?.projectId!==m.projectId||!sameMotionScope(m.scope))return r;
		store.set({motion:{...store.get().motion,renderStatus:{status:'rendering',jobId:r.jobId,progress:0,opRevision:m.revision,opKey}}});
		let polling=false;motionRenderPoll=setInterval(async()=>{
			if(polling)return;polling=true;
			try{
				const st=await motionPostAt(m.scope,'render_status',{jobId:r.jobId}),cur=store.get().motion;
				if(cur?.projectId!==m.projectId||!sameMotionScope(m.scope)){clearInterval(motionRenderPoll);motionRenderPoll=null;return;}
				store.set({motion:{...cur,renderStatus:{...cur.renderStatus,status:st.status,jobId:r.jobId,progress:st.progress||0,receipt:st.receipt,error:st.error}}});
				if(!active.has(st.status)){clearInterval(motionRenderPoll);motionRenderPoll=null;if(st.status==='completed'&&st.receipt?.verified){toast('MP4 已导出并通过验证（'+st.receipt.frames+' 帧）');if(store.get().motion?.revision===m.revision)downloadMotionArtifact();}else toast('渲染未完成: '+(st.error||st.status));}
			}catch(error){toast('渲染状态尚未确认，正在核对: '+error.message);}
			finally{polling=false;}
		},1500);return r;
	}
	async function exportMotionProject(){
		const m=store.get().motion;if(!m?.projectId)throw new Error('请先打开动画');
		const r=await motionPostAt(m.scope,'export_project',{projectId:m.projectId,operationKey:'ui-export-'+crypto.randomUUID()});
		const bytes=Uint8Array.from(atob(r.dataBase64),c=>c.charCodeAt(0)),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type:'application/zip'}));a.download=(m.title||'motion')+'.dcmotion';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);toast('.dcmotion 工程已导出');
	}
	async function downloadMotionArtifact(){
		const m=store.get().motion;if(!m?.projectId||m.renderStatus?.status!=='completed')throw new Error('尚无已验证的渲染产物');
		const scope=motionScope(),q=new URLSearchParams({root:scope.root,sessionId:scope.sessionId,projectId:m.projectId,operationKey:m.renderStatus.opKey});
		const a=document.createElement('a');a.href='/designcraft/api/v1/motion/artifact?'+q;a.download=(m.title||'motion')+'.mp4';a.click();
	}

	/* ---------------- toast ---------------- */

	function showToast(message) { toast(message); }

	return {
		dispose(){disposed=true;clearTimeout(bakeTimer);if(motionRenderPoll){clearInterval(motionRenderPoll);motionRenderPoll=null;}motionBridge.dispose();},
		pushUndo, undo, redo,
		select, setTool, setView, zoomBy, fitToView, setPageId, setPointer,
		updateLayerFields, updateVectorNode, finishVectorNode,
		hitTestLayer, hitTest: hitTestLayer, createTextLayer, createShapeLayer, commitPenPath, commitDraftShape,
		updateLayersOriginals, deleteSelection, duplicateSelection, copySelection, pasteClipboard, reorderLayer,
		addPage, duplicatePage, deletePage, movePage, updatePage,
		beginPaint, paintOnLayer, bucketFill, pickColor, magicWand, fillWandSelection, deleteWandSelection, clearWandSelection,
		openLinkedMedia,commitLinkedMedia,prepareRegionReference,prepareImageEdit, selectWhole,selectInRect, alignSelection, groupSelection, selectNative, pickObject, commitNativeEdit, editNativeText, setMarquee, commitMarquee, setDraftShape, setGradientDrag, commitGradientDrag, setPenPreview, setCropRect, applyCrop,
		editText, commitText,
		addImageLayerFromAsset, importFilesAsLayers, importSvgFiles, createPhotoWork, createVectorWork, importDeckFiles, importDeckAsset,
		scheduleBake, bakeDirtySurfaces,
		exportWholePageSvg, exportPhoto, exportNativePdf, exportPagePng, exportPageSvg, exportPptx, exportPdf, exportHtml, exportMd,
		startPresentation,
		instantiateTemplate, appendTemplatePages, applyDesignSystem, addLayoutSlide, generateDeckFromOutline,
		createMotionProject, listMotionProjects, listMotionTemplates, createMotionFromTemplate, openMotionProject, toggleMotionPlay, seekMotionFrame,
		motionAutoEnter, motionPreviewAutoplay, bindMotionPreview, closeMotionWorkspace,
        motionScopeKey:()=>{try{const s=motionScope();return s.root+'|'+s.sessionId;}catch{return '';}} ,
		motionPreviewSeek, motionPollHead, motionDoctor, renderMotion, cancelMotionRender, exportMotionProject, downloadMotionArtifact, motionPreviewUrl,
		toast: showToast,
		findLayerDeep
	};
}
