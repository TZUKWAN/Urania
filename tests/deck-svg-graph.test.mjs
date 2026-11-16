// Actual native command archives plus actual Vector captures; the temporary
// storage envelope deliberately uses assigned metadata, not a live App identity.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectGraph} from '../host/project-graph.js';
import {NativeSourceStore} from '../host/native-source-store.js';
import {readZip,createZip} from '../host/zip.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
async function fixture({previewName='preview.png',withPreview=true}={}){
 const root=await mkdtemp(join(tmpdir(),'dc-native-svg-graph-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store),meta=JSON.parse(await load('deck-svg/metadata.json')),capture=JSON.parse(await load('svg-material/origin.json'));
 // Native CLI fixtures accept generic input identities. Storage receipts use
 // UUID identities: relabel only the origin tags for this storage envelope.
 // These labelled containers are codec inputs, not new native API captures.
 const projectId='project-'+randomUUID(),originalId='asset-'+randomUUID(),editedId='asset-'+randomUUID(),ids=new Map([[meta.originBefore.assetId,originalId],[meta.originAfter.assetId,editedId]]);
 const labelled=bytes=>{const entries=readZip(bytes),part=entries.find(e=>e.name==='presentation.json'),value=JSON.parse(part.data);const walk=shapes=>{for(const shape of shapes){for(const row of shape.tags||[])if(row[0].toUpperCase()==='DSH-MATERIAL-V1'){const ref=JSON.parse(row[1]);ref.projectId=projectId;ref.assetId=ids.get(ref.assetId);row[1]=JSON.stringify(ref);}if(shape.kind.type==='group')walk(shape.kind.children);}};for(const slide of value.presentation.slides)walk(slide.shapes);part.data=Buffer.from(JSON.stringify(value));return createZip(entries);};
 const before=labelled(await load('deck-svg/before.deckcraft')),after=labelled(await load('deck-svg/after.deckcraft'));meta.originBefore.projectId=projectId;meta.originBefore.assetId=originalId;meta.originAfter.projectId=projectId;meta.originAfter.assetId=editedId;
 await graph.change(null,value=>{value.id=meta.originBefore.projectId;});
 const source=await store.commit('vector-source',{engine:'vectorcraft',bytes:await load('svg-material/source.vectorcraft'),engineState:{uid:capture.engineState.uid,revision:capture.engineState.revision}});
 const {asset}=await graph.addDerivative({operationId:meta.originBefore.assetId.slice(6),baseRevision:(await graph.read()).revision,sourceId:'vector-source',sourceRevision:source.revision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,format:'svg',bytes:await load('svg-material/source.svg'),...(withPreview?{preview:await load('svg-material/'+previewName)}:{}),title:'真实 SVG 与预览'});
 const layout=await store.commit('deck',{engine:'deckcraft',bytes:before,engineState:{uid:1,revision:1}});
 return {root,store,graph,meta,asset,source,layout,before,after};
}
test('actual prepared native SVG binds only its exact original and exact preview; another use remains independent',async()=>{
 const f=await fixture(),first=await f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'deck',sourceRevision:f.layout.revision,nativeId:f.meta.targetId}),second=await f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'deck',sourceRevision:f.layout.revision,nativeId:f.meta.otherId});
 assert.equal(first.instance.originToken,f.meta.originBefore.instanceId);assert.notEqual(second.instance.originToken,first.instance.originToken);assert.equal(first.instance.linkId,undefined);assert.equal(second.instance.linkId,undefined);
 const read=await f.graph.instance(first.instance.id);assert.equal(read.asset.format,'svg');assert.equal(read.asset.preview.format,'png');assert.equal(read.node.kind.fill.svgSource!==undefined,true);
});
test('wrong preview or missing preview cannot bind a real native SVG object',async()=>{
 for(const options of [{previewName:'edited-preview.png'},{withPreview:false}]){
  const f=await fixture(options),revision=(await f.graph.read()).revision;
  await assert.rejects(f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'deck',sourceRevision:f.layout.revision,nativeId:f.meta.targetId}),e=>e.status===409);
  assert.equal((await f.graph.read()).revision,revision);assert.equal((await f.graph.inspect()).instances.length,0);
 }
});
test('genuine SVG update verifies before commit and reconciles exactly one saved source receipt',async()=>{
 const f=await fixture(),{instance}=await f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'deck',sourceRevision:f.layout.revision,nativeId:f.meta.targetId});
 const {edit,fork}=await f.graph.startInstanceEdit({operationId:randomUUID(),instanceId:instance.id,sourceId:'deck'}),capture=JSON.parse(await load('svg-material/edited-origin.json'));
 const saved=await f.store.commit(fork.sourceId,{engine:'vectorcraft',bytes:await load('svg-material/edited-source.vectorcraft'),baseRevision:fork.revision,engineState:{uid:capture.engineState.uid,revision:capture.engineState.revision}});
 const {asset}=await f.graph.addDerivative({operationId:f.meta.originAfter.assetId.slice(6),baseRevision:(await f.graph.read()).revision,sourceId:fork.sourceId,sourceRevision:saved.revision,sourceHash:saved.meta.sourceHash,engineState:saved.meta.engineState,format:'svg',bytes:await load('svg-material/edited-source.svg'),preview:await load('svg-material/edited-preview.png'),title:'实际移动节点后的 SVG'});
 const plan={...await f.graph.prepareInstanceApply({editId:edit.id,assetId:asset.id,sourceId:'deck'}),sourceId:'deck'},after=f.after;await f.graph.verifyInstanceApplySource(plan,after);
 const operationId=randomUUID(),committed=await f.store.commit('deck',{engine:'deckcraft',bytes:after,baseRevision:f.layout.revision,engineState:{uid:1,revision:2},operation:{action:'apply-instance',id:operationId,editId:edit.id,instanceId:instance.id,assetId:asset.id,previousAssetId:f.asset.id,nativeId:f.meta.targetId,baseRevision:f.layout.revision}});
 const finished=await f.graph.completeInstanceApply({sourceId:'deck',sourceRevision:committed.revision,operationId});assert.equal(finished.instance.assetId,asset.id);assert.equal(finished.instance.originToken,instance.originToken);assert.equal((await f.graph.instance(instance.id)).asset.format,'svg');
 const again=await f.graph.completeInstanceApply({sourceId:'deck',sourceRevision:committed.revision,operationId});assert.equal(again.reused,true);assert.equal((await f.store.head('deck')).revision,committed.revision);
 const undone=await f.store.commit('deck',{engine:'deckcraft',bytes:f.before,baseRevision:committed.revision,engineState:{uid:1,revision:3}});await f.graph.synchronizeSource({sourceId:'deck',sourceRevision:undone.revision});assert.equal((await f.graph.instance(instance.id)).asset.id,f.asset.id);
 const redone=await f.store.commit('deck',{engine:'deckcraft',bytes:f.after,baseRevision:undone.revision,engineState:{uid:1,revision:4}});await f.graph.synchronizeSource({sourceId:'deck',sourceRevision:redone.revision});assert.equal((await f.graph.instance(instance.id)).asset.id,asset.id);
});
test('a second verified native SVG declaration is adopted independently without implicit linking',async()=>{
 const f=await fixture(),{instance}=await f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'deck',sourceRevision:f.layout.revision,nativeId:f.meta.targetId});
 await f.graph.synchronizeSource({sourceId:'deck',sourceRevision:f.layout.revision});const state=await f.graph.inspect(),other=state.instances.find(i=>i.nativeId===String(f.meta.otherId));assert.ok(other);assert.notEqual(other.id,instance.id);assert.equal(other.assetId,f.asset.id);assert.equal(other.linkId,undefined);
 const revision=state.revision;assert.equal((await f.graph.synchronizeSource({sourceId:'deck',sourceRevision:f.layout.revision})).changed,0);assert.equal((await f.graph.inspect()).revision,revision);
});
