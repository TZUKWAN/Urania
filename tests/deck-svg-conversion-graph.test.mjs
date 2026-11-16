// Actual Vector and Deck conversion captures; only origin tags/project IDs are
// assigned by this temporary test storage envelope.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readZip,createZip} from '../host/zip.js';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
import {validateConvertedShapes} from '../host/native-deck-conversion.js';
import {EditorSessions} from '../host/editor-session.js';
import {nativeBase} from '../client/native-contract.js';
const load=name=>readFile(new URL('./fixtures/f5-native-conversion/'+name,import.meta.url));
function label(bytes,project,asset,token,originalId){
 const entries=readZip(bytes,{maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024}),row=entries.find(e=>e.name==='presentation.json'),doc=JSON.parse(row.data),shape=doc.presentation.slides[0].shapes.find(s=>s.id===originalId);
 assert(shape);shape.tags=[...(shape.tags||[]),['DSH-MATERIAL-V1',JSON.stringify({schema:1,projectId:project,assetId:asset,instanceId:token})]];row.data=Buffer.from(JSON.stringify(doc));return createZip(entries);
}
function shift(bytes,id){
 const entries=readZip(bytes,{maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024}),row=entries.find(e=>e.name==='presentation.json'),doc=JSON.parse(row.data);
 doc.presentation.slides[0].shapes.find(shape=>shape.id===id).xfrm.x+=10;row.data=Buffer.from(JSON.stringify(doc));return createZip(entries);
}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-svg-convert-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store),project='project-'+randomUUID(),token=randomBytes(16).toString('hex');
 await graph.change(null,v=>{v.id=project;});
 const source=await store.commit('source',{engine:'vectorcraft',bytes:await load('source.vectorcraft'),engineState:{uid:1,revision:1}});
 const {asset}=await graph.addDerivative({operationId:randomUUID(),baseRevision:(await graph.read()).revision,sourceId:'source',sourceRevision:source.revision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,format:'svg',bytes:await load('source.svg'),preview:await load('preview.png'),title:'实际基础 SVG'});
 const result=JSON.parse(await load('native-result.json')),before=label(await load('before.deckcraft'),project,asset.id,token,result.originalId),after=label(await load('after.deckcraft'),project,asset.id,token,result.originalId),id=randomUUID();
 const bound=await store.commit('deck',{engine:'deckcraft',bytes:before,engineState:{uid:2,revision:1},operation:{action:'place',id,assetId:asset.id,nativeId:result.originalId}});
 const {instance}=await graph.bind({operationId:id,assetId:asset.id,sourceId:'deck',sourceRevision:bound.revision,nativeId:result.originalId});
 return {root,store,graph,project,asset,bound,instance,result,before,after};
}
test('actual native conversion is accepted only for its saved SVG use and exact generated shapes',async()=>{
 const f=await fixture(),plan=await f.graph.prepareSvgConversion({instanceId:f.instance.id,sourceId:'deck'});plan.nativeShapes=f.result.nativeShapes;
 const proof=await f.graph.verifySvgConversionSource(plan,f.after);assert.equal(proof.originalId,f.result.originalId);assert.deepEqual(proof.ids,f.result.ids);
 const wrong=structuredClone(plan);wrong.nativeShapes[0].xfrm.x+=3;await assert.rejects(f.graph.verifySvgConversionSource(wrong,f.after));
 assert.equal((await f.store.head('deck')).revision,f.bound.revision);
});
test('an explicitly linked SVG use must be unlinked before conversion',async()=>{
 const f=await fixture(),other=await f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'deck',sourceRevision:f.bound.revision,nativeId:263});
 await f.graph.linkInstances({operationId:randomUUID(),instanceIds:[f.instance.id,other.instance.id]});
 await assert.rejects(f.graph.prepareSvgConversion({instanceId:f.instance.id,sourceId:'deck'}),/解除.*关联/);
});
test('conversion receipt and native undo/redo preserve the original SVG relation',async()=>{
 const f=await fixture(),plan=await f.graph.prepareSvgConversion({instanceId:f.instance.id,sourceId:'deck'});plan.nativeShapes=f.result.nativeShapes;await f.graph.verifySvgConversionSource(plan,f.after);
 const id=randomUUID(),shapesHash=createHash('sha256').update(validateConvertedShapes(f.result.originalId,f.result.nativeShapes)).digest('hex');
 const saved=await f.store.commit('deck',{engine:'deckcraft',bytes:f.after,baseRevision:f.bound.revision,engineState:{uid:2,revision:2},operation:{action:'convert-svg',id,instanceId:f.instance.id,assetId:f.asset.id,nativeId:f.result.originalId,baseRevision:f.bound.revision,shapeIds:f.result.ids,shapesHash}});
 assert.equal(saved.meta.operation.shapesHash,shapesHash);await f.graph.synchronizeSource({sourceId:'deck',sourceRevision:saved.revision});assert.equal((await f.graph.instance(f.instance.id)).asset.id,f.asset.id);
 const recovered=await f.graph.verifySavedSvgConversion({sourceId:'deck',sourceRevision:saved.revision,operationId:id});assert.deepEqual(recovered.shapeIds,f.result.ids);
 await assert.rejects(f.graph.verifySavedSvgConversion({sourceId:'deck',sourceRevision:saved.revision,operationId:randomUUID()}));
 assert.equal((await f.graph.inspect()).instances.find(i=>i.id===f.instance.id).nativeObject.hidden,true);
 const undone=await f.store.commit('deck',{engine:'deckcraft',bytes:f.before,baseRevision:saved.revision,engineState:{uid:2,revision:3}});await f.graph.synchronizeSource({sourceId:'deck',sourceRevision:undone.revision});assert.equal((await f.graph.instance(f.instance.id)).asset.id,f.asset.id);assert.equal((await f.graph.inspect()).instances.find(i=>i.id===f.instance.id).nativeObject.hidden,undefined);
 const redone=await f.store.commit('deck',{engine:'deckcraft',bytes:f.after,baseRevision:undone.revision,engineState:{uid:2,revision:4}});await f.graph.synchronizeSource({sourceId:'deck',sourceRevision:redone.revision});assert.equal((await f.graph.instance(f.instance.id)).asset.id,f.asset.id);
});
test('authorized conversion stores exact native receipt and refuses a shifted output before commit',async()=>{
 const f=await fixture(),pre=await f.graph.prepareSvgConversion({instanceId:f.instance.id,sourceId:'deck'}),manager=new EditorSessions({resolveScope:()=>f.root});
 const view={id:'view-'+randomUUID(),root:f.root,epoch:'epoch-'+randomUUID(),sourceId:'deck',sourceRevision:f.bound.revision,engine:'deckcraft',savedEngineRevision:1,document:{uid:2,revision:1,page:{nativePage:pre.nativePage}},lastSeen:Date.now()};
 manager.views.set(view.id,view);manager.stores.set(f.root,f.store);manager.leases.set(manager.leaseKey(view),view.id);
 const job={id:randomUUID(),viewId:view.id,root:f.root,epoch:view.epoch,sessionId:'session-test',sourceId:'deck',action:'convert_svg',status:'running',executionStartedAt:new Date().toISOString(),at:new Date().toISOString(),payload:{instanceId:f.instance.id}};manager.jobs.set(job.id,job);
 await manager.prepareSvgConversion(view,{epoch:view.epoch,jobId:job.id});
 await assert.rejects(manager.recordSvgConversion(view,{epoch:'wrong',jobId:job.id,result:f.result}));
 await assert.rejects(manager.recordSvgConversion(view,{epoch:view.epoch,jobId:job.id,result:{...f.result,originalId:999}}));
 await manager.recordSvgConversion(view,{epoch:view.epoch,jobId:job.id,result:f.result});
 const changed=structuredClone(f.result);changed.nativeShapes[0].xfrm.x+=1;await assert.rejects(manager.recordSvgConversion(view,{epoch:view.epoch,jobId:job.id,result:changed}));
 view.document.revision=2;const options={epoch:view.epoch,baseRevision:f.bound.revision,engineState:{uid:2,revision:2},jobId:job.id,instanceUpdate:{jobId:job.id}};
 const bad=shift(f.after,f.result.ids[0]);await assert.rejects(manager.save(view,options,(async function*(){yield bad;})()));assert.equal((await f.store.head('deck')).revision,f.bound.revision);
 const saved=await manager.save(view,options,(async function*(){yield f.after;})());assert.equal(saved.meta.operation.action,'convert-svg');assert.deepEqual(saved.meta.operation.shapeIds,f.result.ids);
 assert.equal(job.conversionReceipt.sourceRevision,saved.revision);assert.equal((await f.graph.instance(f.instance.id)).asset.id,f.asset.id);
 const pending=await manager.projectState('session-test');assert(pending.recoverableConversions.some(item=>item.operationId===job.id));
 const recovered=await manager.reconcileSvgConversion(view,{epoch:view.epoch,jobId:job.id});assert.equal(recovered.reconciled,true);assert.equal(recovered.historical,false);assert.equal((await f.store.head('deck')).revision,saved.revision);
 assert(!(await manager.projectState('session-test')).recoverableConversions.some(item=>item.operationId===job.id));
});
test('dedicated conversion job is admitted, checkpointed and completed with the actual native result',async()=>{
 const f=await fixture(),pre=await f.graph.prepareSvgConversion({instanceId:f.instance.id,sourceId:'deck'}),manager=new EditorSessions({resolveScope:()=>f.root}),sessionId='session-'+randomUUID(),page=pre.nativePage;
 const document={engine:'deckcraft',contextProtocol:2,contextSequence:1,uid:2,revision:1,identityKind:'native-document-instance-uid',selectionStamp:'f5-test',objectIds:[],slideCount:1,slides:[{id:page.id,index:0}],nativeSelection:{kind:'deckcraft',data:{selection:{slide:0,slides:[page.id],shapes:[],text:null,cells:null,target:{kind:'slides'}}}},page:{target:{kind:'slides'},nativePage:page,width:960,height:540},history:[],redo:[]};
 const view={id:'view-'+randomUUID(),sessionId,root:f.root,epoch:'epoch-'+randomUUID(),sourceId:'deck',sourceRevision:f.bound.revision,engine:'deckcraft',savedEngineRevision:1,document,editorProtocol:2,ready:true,nativeResponsive:true,lastSeen:Date.now()};
 manager.views.set(view.id,view);manager.active.set(sessionId,view.id);manager.stores.set(f.root,f.store);manager.leases.set(manager.leaseKey(view),view.id);
 const pending=manager.request(sessionId,{action:'convert_svg',sourceId:'deck',epoch:view.epoch,base:nativeBase(document),payload:{instanceId:f.instance.id},operationId:randomUUID()});
 for(let i=0;i<200&&!manager.jobs.size;i++)await new Promise(resolve=>setTimeout(resolve,5));
 const queued=manager.poll(view).job;assert(queued);assert.equal(queued.action,'convert_svg');manager.begin(view,{jobId:queued.id,epoch:view.epoch});
 await manager.prepareSvgConversion(view,{epoch:view.epoch,jobId:queued.id});await manager.recordSvgConversion(view,{epoch:view.epoch,jobId:queued.id,result:f.result});
 view.document={...document,revision:2,history:['Convert SVG']};
 const saved=await manager.save(view,{epoch:view.epoch,baseRevision:f.bound.revision,engineState:{uid:2,revision:2},jobId:queued.id,instanceUpdate:{jobId:queued.id}},(async function*(){yield f.after;})());
 const {nativeShapes,...summary}=f.result;await manager.finish(view,{jobId:queued.id,epoch:view.epoch,ok:true,result:{document:view.document,value:summary}});
 const completed=await pending;assert.equal(completed.persisted,true);assert.equal(completed.conversionReceipt.sourceRevision,saved.revision);assert.equal((await f.graph.instance(f.instance.id)).asset.id,f.asset.id);
});
test('after a lost acknowledgement and later edit, recovery verifies history without overwriting the newer source',async()=>{
 const f=await fixture(),plan=await f.graph.prepareSvgConversion({instanceId:f.instance.id,sourceId:'deck'});plan.nativeShapes=f.result.nativeShapes;await f.graph.verifySvgConversionSource(plan,f.after);
 const id=randomUUID(),shapesHash=createHash('sha256').update(validateConvertedShapes(f.result.originalId,f.result.nativeShapes)).digest('hex');
 const saved=await f.store.commit('deck',{engine:'deckcraft',bytes:f.after,baseRevision:f.bound.revision,engineState:{uid:2,revision:2},operation:{action:'convert-svg',id,instanceId:f.instance.id,assetId:f.asset.id,nativeId:f.result.originalId,baseRevision:f.bound.revision,shapeIds:f.result.ids,shapesHash}});
 const newer=await f.store.commit('deck',{engine:'deckcraft',bytes:shift(f.after,f.result.ids[0]),baseRevision:saved.revision,engineState:{uid:2,revision:3}});
 const manager=new EditorSessions({resolveScope:()=>f.root});manager.stores.set(f.root,f.store);const view={id:'view-'+randomUUID(),root:f.root,epoch:'epoch-'+randomUUID(),sourceId:'deck',sourceRevision:newer.revision};
 assert((await manager.projectState('session-test')).recoverableConversions.some(item=>item.operationId===id));
 const recovered=await manager.reconcileSvgConversion(view,{epoch:view.epoch,jobId:id});assert.equal(recovered.reconciled,true);assert.equal(recovered.historical,true);
 assert.equal((await f.store.head('deck')).revision,newer.revision);assert(!(await manager.projectState('session-test')).recoverableConversions.some(item=>item.operationId===id));
});
