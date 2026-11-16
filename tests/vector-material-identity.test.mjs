// Actual paired Photo source/PNG and actual host7 Vector placement bytes.
// Filesystem identity checks only; replacement/rendering is a separate gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url)),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
test('real binary native PNG use binds exact asset bytes; a different actual paired Photo material cannot relabel it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dc-vector-material-')),sources=new NativeSourceStore(root),graph=new ProjectGraph(root,sources),proof=JSON.parse(await load('vector-image-origin.json'));
 const photoBytes=await load('vector-image-original.pcraft'),png=await load('vector-image-original.png'),vector=await load('vector-web-blobs.vectorcraft');
 assert.equal(sha(photoBytes),proof.asset.sourceHash);assert.equal(sha(png),proof.asset.sha256);assert.equal(sha(vector),proof.nativeVectorSourceSha256);
 const photo=await sources.commit('photo',{engine:'photocraft',title:'实际来源',bytes:photoBytes,engineState:proof.engineState});
 const saved=await sources.commit('poster',{engine:'vectorcraft',title:'实际海报',bytes:vector,engineState:proof.vectorEngineState});
 const {asset}=await graph.addDerivative({operationId:randomUUID(),baseRevision:null,sourceId:'photo',sourceRevision:photo.revision,sourceHash:photo.meta.sourceHash,engineState:photo.meta.engineState,format:'png',bytes:png,title:'真实原生图片'});
 const bound=await graph.bind({operationId:randomUUID(),assetId:asset.id,sourceId:'poster',sourceRevision:saved.revision,nativeId:2});assert.equal((await graph.instance(bound.instance.id)).asset.sha256,proof.asset.sha256);
 const other=JSON.parse(await load('instance-fixture-provenance.json')),otherSource=await sources.commit('other-photo',{engine:'photocraft',bytes:await load('instance-old.pcraft'),engineState:other.files['instance-old.pcraft'].engineState});
 const {asset:wrong}=await graph.addDerivative({operationId:randomUUID(),baseRevision:(await graph.read()).revision,sourceId:'other-photo',sourceRevision:otherSource.revision,sourceHash:otherSource.meta.sourceHash,engineState:otherSource.meta.engineState,format:'png',bytes:await load('instance-old.png'),title:'另一真实素材'});
 await assert.rejects(graph.bind({operationId:randomUUID(),assetId:wrong.id,sourceId:'poster',sourceRevision:saved.revision,nativeId:2}),e=>e.status===409);
 assert.equal((await graph.inspect()).instances.length,1);assert.equal((await sources.head('poster')).revision,saved.revision);assert.deepEqual((await sources.read('poster')).bytes,vector);
});
