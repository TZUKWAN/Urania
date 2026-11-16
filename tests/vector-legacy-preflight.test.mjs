// A genuine old native group and SVG are used; only the temporary store's
// operation/project IDs and the explicit tamper case are test-created.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
const load=name=>readFile(new URL('./fixtures/vector-legacy-svg/'+name,import.meta.url));
const magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]);

async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-legacy-svg-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store);
 const source=await store.commit('svg-source',{engine:'vectorcraft',bytes:await load('source.vectorcraft'),engineState:{uid:1,revision:1}});
 const {asset}=await graph.addDerivative({operationId:randomUUID(),baseRevision:null,sourceId:'svg-source',sourceRevision:source.revision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,format:'svg',bytes:await load('source.svg'),title:'旧 SVG'});
 const id=randomUUID(),bound=await store.commit('poster',{engine:'vectorcraft',bytes:await load('bound.vectorcraft'),engineState:{uid:2,revision:1},operation:{action:'place',id,assetId:asset.id,nativeId:6}});
 const {instance}=await graph.bind({operationId:id,assetId:asset.id,sourceId:'poster',sourceRevision:bound.revision,nativeId:6});
 const current=await store.commit('poster',{engine:'vectorcraft',bytes:await load('current.vectorcraft'),baseRevision:bound.revision,engineState:{uid:2,revision:2}});
 return {store,graph,asset,instance,current};
}
test('source store and graph verify the actual old placement and unchanged group',async()=>{
 const f=await fixture(),proof=await f.graph.legacyVectorPreflight(f.instance.id,{sourceId:'poster'});
 assert.equal(proof.nativeId,'6');assert.equal(proof.assetId,f.asset.id);assert.equal(proof.boundAtRevision,f.instance.boundAtRevision);
});
test('a later edit to the original group is refused by storage-backed preflight',async()=>{
 const f=await fixture(),bytes=await load('current.vectorcraft'),at=bytes.indexOf(magic);
 const doc=JSON.parse(at<0?bytes:bytes.subarray(0,at));const target=doc.document.layers[0].kind.children.find(node=>node.id===6);assert(target);target.opacity=0.5;
 const edited=Buffer.concat([Buffer.from(JSON.stringify(doc)),at<0?Buffer.alloc(0):bytes.subarray(at)]);
 await f.store.commit('poster',{engine:'vectorcraft',bytes:edited,baseRevision:f.current.revision,engineState:{uid:2,revision:3}});
 await assert.rejects(f.graph.legacyVectorPreflight(f.instance.id,{sourceId:'poster'}),/未覆盖手工修改/);
 const original=await f.graph.legacyVectorPreflight(f.instance.id,{sourceId:'poster',atRevision:f.instance.boundAtRevision});
 assert.equal(original.nativeId,'6');
});
