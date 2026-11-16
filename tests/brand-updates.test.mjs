// Source-store recovery and authorization using native Deck captures. The UI
// journey independently exercises real native dispatch and both renderers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
import {EditorSessions} from '../host/editor-session.js';
import {BrandBindings,actualSolidFill} from '../host/brand-bindings.js';
import {createZip,readZip} from '../host/zip.js';
const load=name=>readFile(new URL('./fixtures/brand-bindings/'+name,import.meta.url));
const prior=await load('brand-deck-marker-before.deckcraft');
const marked=await load('brand-deck-marker-after.deckcraft');
const recolored=await load('brand-deck-after.deckcraft');
const capture=JSON.parse(await load('brand-deck-marker.json'));
function editCapture(bytes,fn){
 const entries=readZip(bytes),row=entries.find(e=>e.name==='presentation.json'),doc=JSON.parse(row.data);
 fn(doc.presentation.slides[0].shapes.find(shape=>String(shape.id)===String(capture.nativeId)));
 row.data=Buffer.from(JSON.stringify(doc));return createZip(entries);
}
function withMarker(bytes,projectId,bindingId){
 return editCapture(bytes,shape=>{shape.tags=[['DSH-BRAND-COLOR-V1',JSON.stringify({...capture.marker,projectId,bindingId})]];});
}
test('lost graph acknowledgement is recovered from source receipt, manual layout and local color survive',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dc-brand-recovery-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store);
 const manager=new EditorSessions({resolveScope:()=>root}),registry=new BrandBindings(graph);
 const {brand}=await registry.create({baseRevision:null,name:'测试品牌',primary:'#287D6C'});
 const pid=(await graph.read()).manifest.id,sourceIds=['poster','deck','local'];
 const view={root,id:randomUUID(),epoch:randomUUID(),engine:'deckcraft',sessionId:randomUUID(),sourceId:'other',lastSeen:Date.now(),ready:true};
 manager.views.set(view.id,view);
 function grant(payload){
  const id=randomUUID(),job={id,root,epoch:view.epoch,viewId:view.id,payload,action:'brand',initiator:'manual',status:'running',executionStartedAt:new Date().toISOString()};
  manager.jobs.set(id,job);return {job,body:{jobId:id,epoch:view.epoch}};
 }
 const ids=new Map();
 for(const sourceId of sourceIds){
  const base=await store.commit(sourceId,{engine:'deckcraft',bytes:prior,engineState:{uid:2,revision:1}});
  const body=grant({command:'attach',revision:(await graph.read()).revision,brandId:brand.id,nativeId:String(capture.nativeId),sourceRevision:base.revision});
  view.sourceId=sourceId;view.sourceRevision=base.revision;view.savedEngineRevision=1;
  view.document={engine:'deckcraft',revision:1,objectIds:[capture.nativeId],nativeSelection:{kind:'deckcraft',data:{selection:{shapes:[capture.nativeId]}}},page:{nativePage:{kind:'slide',id:256}}};
  view.document.page.nativePage.id=JSON.parse(readZip(prior).find(e=>e.name==='presentation.json').data).presentation.slides[0].id;
  const start=await manager.brands.start(view,body.body),bid=start.targets[0].rows[0].bindingId;ids.set(sourceId,bid);
  const saved=await manager.brands.commit(view,{...body.body,sourceId,engineState:{uid:2,revision:2}},[withMarker(marked,pid,bid)]);
  assert.equal(saved.result.status,'succeeded');
  manager.linked.release(body.job);
 }
 const changeLocal=await store.read('local');
 await store.commit('local',{engine:'deckcraft',bytes:editCapture(changeLocal.bytes,shape=>{shape.fill.color.base.rgb={r:255,g:255,b:255,a:255};}),baseRevision:changeLocal.revision,engineState:{uid:2,revision:3}});
 view.sourceId='other';
 const inspected=await registry.inspect(),request={command:'recolor',revision:inspected.revision,brandId:brand.id,primary:'#C03020',bindingIds:[...ids.values()],overrideIds:[ids.get('local')]};
 const refused=grant({...request,overrideIds:[]});await assert.rejects(manager.brands.start(view,refused.body),/手动改色/);
 const first=grant(request),start=await manager.brands.start(view,first.body);
 assert.equal(start.targets.length,2);
 const a=start.targets[0],b=start.targets[1],changed=withMarker(recolored,pid,ids.get(a.sourceId));
 const receipt=await store.commit(a.sourceId,{engine:'deckcraft',bytes:changed,baseRevision:a.baseRevision,engineState:{uid:2,revision:4},operation:{action:'brand-edit',id:start.transactionId,kind:'recolor',brandId:brand.id,baseRevision:a.baseRevision,bindingIds:[ids.get(a.sourceId)]}});
 manager.linked.release(first.job);
 const manual=await store.read(b.sourceId),moved=editCapture(manual.bytes,shape=>{shape.xfrm.x+=24;});
 await store.commit(b.sourceId,{engine:'deckcraft',bytes:moved,baseRevision:manual.revision,engineState:{uid:2,revision:5}});
 const resume=grant({command:'resume',updateId:start.transactionId}),plan=await manager.brands.start(view,resume.body);
 assert.equal(plan.targets.length,1);assert.equal(plan.targets[0].sourceId,b.sourceId);assert.equal((await store.head(a.sourceId)).revision,receipt.revision);
 const correct=editCapture(withMarker(recolored,pid,ids.get(b.sourceId)),shape=>{shape.xfrm.x+=24;});
 await assert.rejects(manager.brands.commit(view,{...resume.body,sourceId:b.sourceId,engineState:{uid:2,revision:6}},[withMarker(recolored,pid,ids.get(b.sourceId))]),/改变了其他/);
 const done=await manager.brands.commit(view,{...resume.body,sourceId:b.sourceId,engineState:{uid:2,revision:6}},[correct]);
 assert.equal(done.result.status,'succeeded');assert.equal(done.result.primary,'#C03020');
 assert.equal(actualSolidFill((await store.read('local')).bytes,'deckcraft',capture.nativeId),'#FFFFFF');
 assert.equal((await registry.inspect()).bindings.find(b=>b.id===ids.get('local')).status,'color_changed');
});
