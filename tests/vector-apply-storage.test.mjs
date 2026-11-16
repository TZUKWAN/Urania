// Storage/proof gate: paired real source/PNG fixtures, with explicit native-codec
// grammar input for replacement. This is not a native UI/rendering claim.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
import {nativeVectorHeader} from '../host/native-vector-header.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
test('Vector PNG apply checks whole native frame before publication and reconciles actual saved source receipt idempotently',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dc-vector-apply-')),sources=new NativeSourceStore(root),graph=new ProjectGraph(root,sources),origin=JSON.parse(await load('vector-image-origin.json')),editedProof=JSON.parse(await load('instance-fixture-provenance.json'));
 const original=await sources.commit('photo',{engine:'photocraft',bytes:await load('vector-image-original.pcraft'),engineState:origin.engineState});
 const old=await graph.addDerivative({operationId:randomUUID(),baseRevision:null,sourceId:'photo',sourceRevision:original.revision,sourceHash:original.meta.sourceHash,engineState:original.meta.engineState,format:'png',bytes:await load('vector-image-original.png'),title:'原生配对源'});
 const before=await load('vector-web-blobs.vectorcraft'),saved=await sources.commit('poster',{engine:'vectorcraft',bytes:before,engineState:origin.vectorEngineState});
 const use=await graph.bind({operationId:randomUUID(),assetId:old.asset.id,sourceId:'poster',sourceRevision:saved.revision,nativeId:2});
 const {edit,fork}=await graph.startInstanceEdit({operationId:randomUUID(),instanceId:use.instance.id,sourceId:'poster'});
 const next=await sources.commit(fork.sourceId,{engine:'photocraft',bytes:await load('instance-edited.pcraft'),engineState:editedProof.files['instance-edited.pcraft'].engineState,baseRevision:fork.revision});
 const png=await load('instance-edited.png'),material=await graph.addDerivative({operationId:randomUUID(),baseRevision:(await graph.read()).revision,sourceId:fork.sourceId,sourceRevision:next.revision,sourceHash:next.meta.sourceHash,engineState:next.meta.engineState,format:'png',bytes:png,title:'另一个实际配对快照'});
 const plan={...await graph.prepareInstanceApply({editId:edit.id,assetId:material.asset.id,sourceId:'poster'}),sourceId:'poster'},header=nativeVectorHeader(before),node=header.document.layers[0].kind.children.find(n=>n.id===2),a=structuredClone(node.kind);
 Object.assign(node.kind,{key:'image-storage-proof',width:320,height:240,xf:[a.xf[0]*a.width/320,a.xf[1]*a.width/320,a.xf[2]*a.height/240,a.xf[3]*a.height/240,a.xf[4],a.xf[5]]});delete header.images[a.key];header.images[node.kind.key]={mime:'image/png',data:png.toString('base64')};
 const bytes=Buffer.from(JSON.stringify(header));await graph.verifyInstanceApplySource(plan,bytes);
 node.kind.xf[4]+=4;await assert.rejects(graph.verifyInstanceApplySource(plan,Buffer.from(JSON.stringify(header))),e=>e.status===409);node.kind.xf[4]-=4;assert.equal((await sources.head('poster')).revision,saved.revision);
 const id=randomUUID(),committed=await sources.commit('poster',{engine:'vectorcraft',bytes,baseRevision:saved.revision,engineState:origin.vectorEngineState,operation:{action:'apply-instance',id,editId:edit.id,instanceId:use.instance.id,assetId:material.asset.id,previousAssetId:old.asset.id,nativeId:2,baseRevision:saved.revision}});
 const receipt={sourceId:'poster',sourceRevision:committed.revision,operationId:id},done=await new ProjectGraph(root).completeInstanceApply(receipt);assert.equal(done.instance.assetId,material.asset.id);assert.equal(done.edit.phase,'applied');assert.equal((await graph.completeInstanceApply(receipt)).reused,true);assert.equal((await sources.head('poster')).revision,committed.revision);
 assert.equal((await sources.head('photo')).revision,original.revision);
});
