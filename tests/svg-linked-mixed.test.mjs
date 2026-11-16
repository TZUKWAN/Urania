// Actual native Vector/Deck before/after captures and actual Vector source,
// SVG and PNG preview. Only temporary project/asset origin labels are changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readZip,createZip} from '../host/zip.js';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url)),magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]);
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-svg-linked-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store),project='project-'+randomUUID(),old='asset-'+randomUUID(),next='asset-'+randomUUID();
 const vectorMeta=JSON.parse(await load('vector-embedded-svg/metadata.json')),deckMeta=JSON.parse(await load('deck-svg/metadata.json')),capture=JSON.parse(await load('svg-material/origin.json')),edited=JSON.parse(await load('svg-material/edited-origin.json'));
 const labels=new Map([['asset-original',old],['asset-edited',next]]);
 const relabel=shape=>{for(const row of shape.attrs?.data||shape.tags||[])if(row[0].toLowerCase()==='dsh-material-v1'){const ref=JSON.parse(row[1]);ref.projectId=project;ref.assetId=labels.get(ref.assetId);row[1]=JSON.stringify(ref);}if(shape.kind?.children)for(const child of shape.kind.children)relabel(child);};
 const vector=bytes=>{const at=bytes.indexOf(magic);assert.ok(at>0);const doc=JSON.parse(bytes.subarray(0,at));for(const layer of doc.document.layers)relabel(layer);return Buffer.concat([Buffer.from(JSON.stringify(doc)),bytes.subarray(at)]);};
 const deck=bytes=>{const entries=readZip(bytes),row=entries.find(e=>e.name==='presentation.json'),doc=JSON.parse(row.data);for(const slide of doc.presentation.slides)for(const shape of slide.shapes)relabel(shape);row.data=Buffer.from(JSON.stringify(doc));return createZip(entries);};
 const beforeVector=vector(await load('vector-embedded-svg/before.vectorcraft')),afterVector=vector(await load('vector-embedded-svg/after.vectorcraft')),beforeDeck=deck(await load('deck-svg/before.deckcraft')),afterDeck=deck(await load('deck-svg/after.deckcraft'));
 await graph.change(null,v=>{v.id=project;});
 const source=await store.commit('source',{engine:'vectorcraft',bytes:await load('svg-material/source.vectorcraft'),engineState:capture.engineState});
 const {asset}=await graph.addDerivative({operationId:old.slice(6),baseRevision:(await graph.read()).revision,sourceId:'source',sourceRevision:source.revision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,format:'svg',bytes:await load('svg-material/source.svg'),preview:await load('svg-material/preview.png'),title:'原始 SVG'});
 const v=await store.commit('poster',{engine:'vectorcraft',bytes:beforeVector,engineState:{uid:1,revision:1}}),d=await store.commit('deck',{engine:'deckcraft',bytes:beforeDeck,engineState:{uid:2,revision:1}});
 const targetV=(await graph.bind({operationId:randomUUID(),assetId:asset.id,sourceId:'poster',sourceRevision:v.revision,nativeId:vectorMeta.targetId})).instance;
 const otherV=(await graph.bind({operationId:randomUUID(),assetId:asset.id,sourceId:'poster',sourceRevision:v.revision,nativeId:vectorMeta.otherId})).instance;
 const targetD=(await graph.bind({operationId:randomUUID(),assetId:asset.id,sourceId:'deck',sourceRevision:d.revision,nativeId:deckMeta.targetId})).instance;
 const otherD=(await graph.bind({operationId:randomUUID(),assetId:asset.id,sourceId:'deck',sourceRevision:d.revision,nativeId:deckMeta.otherId})).instance;
 const {link}=await graph.linkInstances({operationId:randomUUID(),instanceIds:[targetV.id,targetD.id]}),{edit,fork}=await graph.startInstanceEdit({operationId:randomUUID(),instanceId:targetV.id,sourceId:'poster'});
 const changed=await store.commit(fork.sourceId,{engine:'vectorcraft',bytes:await load('svg-material/edited-source.vectorcraft'),baseRevision:fork.revision,engineState:edited.engineState});
 const {asset:replacement}=await graph.addDerivative({operationId:next.slice(6),baseRevision:(await graph.read()).revision,sourceId:fork.sourceId,sourceRevision:changed.revision,sourceHash:changed.meta.sourceHash,engineState:changed.meta.engineState,format:'svg',bytes:await load('svg-material/edited-source.svg'),preview:await load('svg-material/edited-preview.png'),title:'编辑 SVG'});
 return {root,store,graph,asset,replacement,targetV,targetD,otherV,otherD,edit,link,beforeVector,afterVector,beforeDeck,afterDeck};
}
async function commit(f,update,sourceId,bytes){
 const target=update.sources[sourceId];await f.graph.verifyLinkedSource(update.id,sourceId,bytes);
 return f.store.commit(sourceId,{engine:target.engine,bytes,baseRevision:target.baseRevision,engineState:{uid:sourceId==='poster'?1:2,revision:2},operation:{action:'linked-update',id:update.id.slice(7),updateId:update.id,linkId:update.linkId,assetId:update.assetId,baseRevision:target.baseRevision,instanceIds:target.instanceIds}});
}
test('actual SVG Vector and Deck updates preserve unrelated uses and recover a committed receipt',async()=>{
 const f=await fixture(),{update}=await f.graph.prepareLinkedUpdate({operationId:randomUUID(),editId:f.edit.id,assetId:f.replacement.id,linkId:f.link.id,instanceIds:[f.targetV.id,f.targetD.id]});
 assert.equal(update.status,'prepared');await assert.rejects(f.graph.verifyLinkedSource(update.id,'poster',f.beforeVector));
 const savedV=await commit(f,update,'poster',f.afterVector);assert.equal((await f.graph.read()).manifest.updates[update.id].status,'prepared');
 const recovered=await f.graph.completeLinkedSource({updateId:update.id,sourceId:'poster',sourceRevision:savedV.revision});assert.equal(recovered.update.status,'partial');assert.equal((await f.store.head('poster')).revision,savedV.revision);
 const savedD=await commit(f,recovered.update,'deck',f.afterDeck),done=await f.graph.completeLinkedSource({updateId:update.id,sourceId:'deck',sourceRevision:savedD.revision});assert.equal(done.update.status,'succeeded');
 const project=await f.graph.inspect();for(const id of [f.targetV.id,f.targetD.id])assert.equal(project.instances.find(i=>i.id===id).assetId,f.replacement.id);
 for(const id of [f.otherV.id,f.otherD.id])assert.equal(project.instances.find(i=>i.id===id).assetId,f.asset.id);
 assert.equal((await f.graph.completeLinkedSource({updateId:update.id,sourceId:'poster',sourceRevision:savedV.revision})).reused,true);
});
