// Shared selection identity for the canvas, native inspectors and DSH references.
export function findLayer(layers,id){for(const layer of layers||[]){if(layer.id===id)return layer;const found=findLayer(layer.children,id);if(found)return found;}return null;}
export function selectedIds(state){const page=state.doc?.pages?.find(p=>p.id===state.ui?.pageId)||state.doc?.pages?.[0];return [...new Set(state.ui?.selectedIds?.length?state.ui.selectedIds:state.ui?.selectedId?[state.ui.selectedId]:[])].filter(id=>findLayer(page?.layers,id));}
export function nativeNodes(layer){return layer?.native?.engine==='photocraft'?layer.native.layers||[]:layer?.native?.nodes||[];}
export function rectOf(value){if(Array.isArray(value)&&value.length===4)return {x:value[0],y:value[1],w:value[2],h:value[3]};if(value)return {x:value.x,y:value.y,w:value.width??value.w,h:value.height??value.h};return null;}
export function unionRects(rects){const list=rects.filter(r=>r&&[r.x,r.y,r.w,r.h].every(Number.isFinite));if(!list.length)return null;const x=Math.min(...list.map(r=>r.x)),y=Math.min(...list.map(r=>r.y));return {x,y,w:Math.max(...list.map(r=>r.x+r.w))-x,h:Math.max(...list.map(r=>r.y+r.h))-y};}
export function layerRect(layer){return layer?.type==='group'?unionRects((layer.children||[]).map(layerRect)):{x:layer.x,y:layer.y,w:layer.w,h:layer.h};}
export function selectionRoots(page,ids){const chosen=new Set(ids),result=[];const walk=layers=>{for(const layer of layers||[]){if(chosen.has(layer.id))result.push(layer);else walk(layer.children);}};walk(page?.layers);return result;}
export function alignmentOffsets(items,mode,frame){
 if(items.length<2&&!frame)throw new Error('请选择至少两个对象，或选择按画板对齐');
 const all=frame||unionRects(items.map(x=>x.rect));if(!all)return [];
 if(mode==='distributeX'||mode==='distributeY'){
  if(items.length<3)throw new Error('等距分布需要至少三个对象');const axis=mode==='distributeX'?'x':'y',size=axis==='x'?'w':'h',sorted=[...items].sort((a,b)=>a.rect[axis]-b.rect[axis]);
  const first=sorted[0].rect[axis],last=sorted.at(-1).rect[axis]+sorted.at(-1).rect[size],gap=(last-first-sorted.reduce((n,x)=>n+x.rect[size],0))/(sorted.length-1);let cursor=first;
  return sorted.map(item=>{const out={id:item.id,dx:axis==='x'?cursor-item.rect.x:0,dy:axis==='y'?cursor-item.rect.y:0};cursor+=item.rect[size]+gap;return out;});
 }
 if(!['left','centerX','right','top','centerY','bottom'].includes(mode))throw new Error('未知对齐方式');
 return items.map(({id,rect:r})=>({id,dx:mode==='left'?all.x-r.x:mode==='centerX'?all.x+all.w/2-r.x-r.w/2:mode==='right'?all.x+all.w-r.x-r.w:0,dy:mode==='top'?all.y-r.y:mode==='centerY'?all.y+all.h/2-r.y-r.h/2:mode==='bottom'?all.y+all.h-r.y-r.h:0}));
}
export function nodeRect(node){return rectOf(node?.box||node?.bounds);}
export const matrixPoint=(m,p)=>({x:m[0]*p.x+m[2]*p.y+m[4],y:m[1]*p.x+m[3]*p.y+m[5]});
export function multiplyMatrix(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
export function inverseMatrix(m){const d=m[0]*m[3]-m[1]*m[2];if(Math.abs(d)<1e-12)throw new Error('原生组变换不可逆');return [m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
export function nativeRootIds(layer,ids){const chosen=new Set(ids),map=new Map(nativeNodes(layer).map(n=>[Number(n.id),n]));return ids.filter(id=>{let parent=map.get(id)?.parentId,seen=new Set();while(parent!=null&&!seen.has(parent)){if(chosen.has(parent))return false;seen.add(parent);parent=map.get(parent)?.parentId;}return true;});}
function nativeFrame(layer){const n=layer.native||{engine:'photocraft'};return n.engine==='deckcraft'?{x:0,y:0,w:layer.w*.75,h:layer.h*.75}:layer.crop?{...layer.crop}:n.engine==='photocraft'?{x:0,y:0,w:layer.naturalWidth,h:layer.naturalHeight}:{x:n.artboards?.[n.artboard||0]?.x||0,y:n.artboards?.[n.artboard||0]?.y||0,w:n.width,h:n.height};}
export function nativePoint(layer,point,inverse=false){
 const f=nativeFrame(layer),a=(layer.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=layer.x+layer.w/2,cy=layer.y+layer.h/2;
 if(inverse){let x=point.x-cx,y=point.y-cy;const px=x*c+y*s+layer.w/2,py=-x*s+y*c+layer.h/2;return {x:f.x+px/layer.w*f.w,y:f.y+py/layer.h*f.h};}
 const x=(point.x-f.x)/f.w*layer.w-layer.w/2,y=(point.y-f.y)/f.h*layer.h-layer.h/2;return {x:cx+x*c-y*s,y:cy+x*s+y*c};
}
export function nativeCanvasRect(layer,node){const r=nodeRect(node);if(!r)return null;const a=(node.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=r.x+r.w/2,cy=r.y+r.h/2;return unionRects([[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]].map(([x,y])=>{let q={x:cx+(x-cx)*c-(y-cy)*s,y:cy+(x-cx)*s+(y-cy)*c};if(node.parentMatrix)q=matrixPoint(node.parentMatrix,q);const p=nativePoint(layer,q);return {...p,w:0,h:0};}));}
export function nativeAtPoint(layer,point){
 const p=nativePoint(layer,point,true),nodes=nativeNodes(layer),ordered=layer.native.engine==='photocraft'?nodes:[...nodes].reverse();
 for(const node of ordered){if(node.hidden||node.visible===false||node.locked||node.container)continue;const r=nodeRect(node);if(!r||r.w<=0||r.h<=0)continue;const q=node.parentMatrix?matrixPoint(inverseMatrix(node.parentMatrix),p):p,a=-(node.rotation||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),cx=r.x+r.w/2,cy=r.y+r.h/2,x=cx+(q.x-cx)*c-(q.y-cy)*s,y=cy+(q.x-cx)*s+(q.y-cy)*c;if(x>=r.x&&y>=r.y&&x<=r.x+r.w&&y<=r.y+r.h)return node;}
 return null;
}
export function selectedNative(state){const page=state.doc?.pages?.find(p=>p.id===state.ui?.pageId)||state.doc?.pages?.[0],layer=findLayer(page?.layers,state.ui?.nativeSelection?.layerId),target=state.ui?.nativeSelection;if(!layer||target.source!==layer.native?.source)return null;const ids=nativeRootIds(layer,target.ids),nodes=nativeNodes(layer).filter(n=>ids.includes(Number(n.id)));return nodes.length?{layer,nodes,bounds:unionRects(nodes.map(n=>nativeCanvasRect(layer,n)))}:null;}
export function selectionIdentity(state){
 const page=state.doc?.pages?.find(p=>p.id===state.ui?.pageId)||state.doc?.pages?.[0],ids=selectedIds(state),layer=findLayer(page?.layers,state.ui?.selectedId),native=state.ui?.nativeSelection;
 let target=null;
 if(native&&native.pageId===page?.id&&native.layerId===layer?.id&&native.ids?.length)target={engine:native.engine||layer.native.engine,source:native.source,ids:[...new Set(native.ids)]};
 const raw=state.uiSelection;let region=null;
 if(raw&&(!raw.pageId||raw.pageId===page?.id)&&(!raw.layerId||raw.layerId===layer?.id)){
  if(raw.kind==='mask'&&typeof raw.maskAsset==='string')region={kind:'mask',maskAsset:raw.maskAsset,width:raw.width,height:raw.height,encoding:raw.encoding||'alpha',sourceAsset:raw.sourceAsset,nativeSource:raw.nativeSource};
  else if(raw.kind==='path'&&typeof raw.d==='string'&&raw.d.length<=16000)region={kind:'path',d:raw.d};
  else if(['rect','ellipse'].includes(raw.kind)&&[raw.x,raw.y,raw.w,raw.h].every(Number.isFinite)&&raw.w>0&&raw.h>0)region={kind:raw.kind,x:raw.x,y:raw.y,w:raw.w,h:raw.h};
 }
 if(!region&&state.wandMask?.layerId===layer?.id&&state.wandMask)region=state.wandMask.native?{kind:'native-selection',source:layer.native.source,sourceAsset:layer.asset,encoding:'alpha'}:{kind:'pending-mask'};
 return {layerIds:ids,native:target,region:region?{...region,...(layer?.type==='image'?{sourceAsset:layer.asset}:{}),space:['mask','native-selection','pending-mask'].includes(region.kind)?'source':'canvas',pageId:page.id,layerId:layer?.id||null}:null};
}
export function validateSelectionReference(context,doc){
 const page=doc?.pages?.find(p=>p.id===context.pageId);if(!page)throw new Error('引用的画板已不存在');
 for(const id of new Set([...(context.selection?.layerIds||[]),...[context.layerId].filter(Boolean)]))if(!findLayer(page.layers,id))throw new Error('引用对象已被删除，请重新选择');
 const target=context.selection?.native;
 if(target){const layer=findLayer(page.layers,context.layerId),known=new Set(nativeNodes(layer).map(n=>Number(n.id)));
  if(layer?.native?.source!==target.source||layer?.native?.engine!==target.engine||!target.ids?.length||target.ids.some(id=>!Number.isSafeInteger(id)||!known.has(id)))throw new Error('原生源版本或对象已变化，请重新引用');
 }
 const region=context.selection?.region;if(region){const layer=findLayer(page.layers,context.layerId);if(region.kind==='pending-mask')throw new Error('请重新引用，将实际像素选区保存为蒙版');if(region.sourceAsset&&region.sourceAsset!==layer?.asset||region.nativeSource&&region.nativeSource!==layer?.native?.source||region.kind==='native-selection'&&region.source!==layer?.native?.source)throw new Error('选区对应的图片源已变化，请重新引用');}
 return page;
}
