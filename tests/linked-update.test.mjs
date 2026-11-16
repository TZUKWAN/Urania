// Actual native browser-produced files. These tests verify durable source/graph
// coordination; the separate editor journey must prove rendering/dispatch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
const proof=JSON.parse(await load('instance-fixture-provenance.json'));
const files={};for(const[name,entry]of Object.entries(proof.files)){files[name]=await load(name);assert.equal(createHash('sha256').update(files[name]).digest('hex'),entry.sha256);}
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'dc-linked-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store);
 const original=await store.commit('photo',{engine:'photocraft',title:'原生图片',bytes:files['instance-old.pcraft'],engineState:proof.files['instance-old.pcraft'].engineState});
 const first=await graph.addDerivative({operationId:randomUUID(),baseRevision:null,sourceId:'photo',sourceRevision:original.revision,sourceHash:original.meta.sourceHash,engineState:original.meta.engineState,format:'png',bytes:files['instance-old.png'],title:'原图'}),uses=[];
 for(const id of ['layout-a','layout-b','independent']){
  const saved=await store.commit(id,{engine:'deckcraft',title:id,bytes:files['instance-before.deckcraft'],engineState:{uid:1,revision:1}});
  uses.push((await graph.bind({operationId:randomUUID(),assetId:first.asset.id,sourceId:id,sourceRevision:saved.revision,nativeId:261})).instance);
 }
 const {link}=await graph.linkInstances({operationId:randomUUID(),instanceIds:uses.slice(0,2).map(i=>i.id)});
 const {edit,fork}=await graph.startInstanceEdit({operationId:randomUUID(),instanceId:uses[0].id,sourceId:'layout-a'});
 const edited=await store.commit(fork.sourceId,{engine:'photocraft',bytes:files['instance-edited.pcraft'],baseRevision:fork.revision,engineState:proof.files['instance-edited.pcraft'].engineState});
 const replacement=await graph.addDerivative({operationId:randomUUID(),baseRevision:(await graph.read()).revision,sourceId:fork.sourceId,sourceRevision:edited.revision,sourceHash:edited.meta.sourceHash,engineState:edited.meta.engineState,format:'png',bytes:files['instance-edited.png'],title:'独立编辑结果'});
 const input={operationId:randomUUID(),editId:edit.id,assetId:replacement.asset.id,linkId:link.id,instanceIds:[...link.instanceIds]};return {root,store,graph,uses,link,edit,input,first: first.asset};
}
async function commitSource(f,update,sourceId){
 const target=update.sources[sourceId];await f.graph.verifyLinkedSource(update.id,sourceId,files['instance-after.deckcraft']);
 return f.store.commit(sourceId,{engine:'deckcraft',bytes:files['instance-after.deckcraft'],baseRevision:target.baseRevision,engineState:{uid:2,revision:2},operation:{action:'linked-update',id:update.id.slice(7),updateId:update.id,linkId:update.linkId,assetId:update.assetId,baseRevision:target.baseRevision,instanceIds:target.instanceIds}});
}
test('linked two-source updates have durable bounded intent and progress; independent third use stays untouched',async()=>{
 const f=await setup(),independent=await f.store.head('independent'),{update}=await f.graph.prepareLinkedUpdate(f.input);
 assert.equal(update.status,'prepared');assert.equal(Object.keys(update.sources).length,2);
 assert.equal((await f.graph.prepareLinkedUpdate(f.input)).reused,true);
 await assert.rejects(f.graph.unlinkInstance(f.uses[0].id),e=>e.status===409);
 await assert.rejects(f.graph.prepareInstanceApply({editId:f.edit.id,assetId:f.input.assetId,sourceId:'layout-a'}),e=>e.status===409);
 const one=await commitSource(f,update,'layout-a'),progress=await f.graph.completeLinkedSource({updateId:update.id,sourceId:'layout-a',sourceRevision:one.revision});assert.equal(progress.update.status,'partial');
 const two=await commitSource(f,update,'layout-b'),done=await f.graph.completeLinkedSource({updateId:update.id,sourceId:'layout-b',sourceRevision:two.revision});assert.equal(done.update.status,'succeeded');
 assert.equal((await f.graph.completeLinkedSource({updateId:update.id,sourceId:'layout-a',sourceRevision:one.revision})).reused,true);
 const actual=await new ProjectGraph(f.root).inspect();assert.equal(actual.links[0].assetId,f.input.assetId);assert.equal(actual.links[0].pendingUpdate,undefined);assert.equal(actual.edits[0].phase,'applied');
 assert.equal(actual.instances.filter(i=>i.assetId===f.input.assetId).length,2);assert.equal(actual.instances.find(i=>i.sourceId==='independent').assetId,f.first.id);assert.equal((await f.store.head('independent')).revision,independent.revision);
});
test('published native source receipt recovers interrupted progress without replay or extra source revision',async()=>{
 const f=await setup(),{update}=await f.graph.prepareLinkedUpdate(f.input),committed=await commitSource(f,update,'layout-a');
 assert.equal((await f.graph.read()).manifest.updates[update.id].status,'prepared');
 const recovered=await new ProjectGraph(f.root).completeLinkedSource({updateId:update.id,sourceId:'layout-a',sourceRevision:committed.revision});assert.equal(recovered.update.status,'partial');
 assert.equal((await f.store.head('layout-a')).revision,committed.revision);assert.equal((await f.store.versions('layout-a')).length,2);
 await assert.rejects(f.graph.verifyLinkedSource(update.id,'layout-b',files['instance-before.deckcraft']),e=>e.status===409);
 const base=update.sources['layout-b'].baseRevision;const external=await f.store.commit('layout-b',{engine:'deckcraft',bytes:files['instance-before.deckcraft'],baseRevision:base,engineState:{uid:3,revision:9},title:'其他编辑之后'});
 await assert.rejects(commitSource(f,update,'layout-b'),e=>e.status===409);
 assert.equal((await f.store.head('layout-b')).revision,external.revision);assert.equal((await f.graph.read()).manifest.updates[update.id].status,'partial');
 const refreshed=await new ProjectGraph(f.root).refreshLinkedUpdate(update.id);assert.equal(refreshed.sources['layout-b'].baseRevision,external.revision);assert.equal(refreshed.committed['layout-a'],committed.revision);
 const remaining=await commitSource(f,refreshed,'layout-b');const done=await f.graph.completeLinkedSource({updateId:update.id,sourceId:'layout-b',sourceRevision:remaining.revision});assert.equal(done.update.status,'succeeded');assert.equal((await f.store.head('layout-a')).revision,committed.revision);
});
test('stale linked member authorization cannot silently target a different group or member list',async()=>{
 const f=await setup(),heads=(await f.store.list()).map(s=>[s.id,s.revision]);
 await assert.rejects(f.graph.prepareLinkedUpdate({...f.input,instanceIds:[f.uses[0].id,f.uses[2].id]}),e=>e.status===409);
 await f.graph.unlinkInstance(f.uses[0].id);const changed=await f.graph.linkInstances({operationId:randomUUID(),instanceIds:[f.uses[0].id,f.uses[2].id]});
 await assert.rejects(f.graph.prepareLinkedUpdate(f.input),e=>e.status===409);
 const current=await f.graph.read();assert.equal(Object.keys(current.manifest.updates||{}).length,0);assert.equal(current.manifest.links[changed.link.id].pendingUpdate,undefined);
 assert.deepEqual((await f.store.list()).map(s=>[s.id,s.revision]),heads);
});
