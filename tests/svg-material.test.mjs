// Real same-revision Vector source/SVG/PNG capture, not a simulated renderer.
// This target checks persisted pair integrity, separately from native/UI work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
const load=name=>readFile(new URL('./fixtures/svg-material/'+name,import.meta.url));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-svg-pair-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store),proof=JSON.parse(await load('origin.json'));
 const bytes=await load('source.vectorcraft'),svg=await load('source.svg'),preview=await load('preview.png');
 for(const [name,data]of [['source.vectorcraft',bytes],['source.svg',svg],['preview.png',preview]])assert.equal(digest(data),proof.files[name].sha256);
 const source=await store.commit('svg-source',{engine:'vectorcraft',bytes,engineState:{uid:proof.engineState.uid,revision:proof.engineState.revision}});
 const input={operationId:randomUUID(),baseRevision:null,sourceId:'svg-source',sourceRevision:source.revision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,format:'svg',bytes:svg,preview,title:'真实 SVG 与透明兼容预览'};
 return {root,store,graph,source,input,svg,preview};
}
test('actual SVG and its separately retained preview persist as one immutable source-bound material',async()=>{
 const f=await fixture(),first=await f.graph.addDerivative(f.input),reopened=new ProjectGraph(f.root);
 assert.deepEqual(first.asset.preview,{format:'png',sha256:digest(f.preview),bytes:f.preview.length,width:320,height:240});
 assert.equal(first.asset.format,'svg');assert.equal(first.asset.sha256,digest(f.svg));
 assert.deepEqual((await reopened.asset(first.asset.id)).bytes,f.svg);assert.deepEqual((await reopened.preview(first.asset.id)).bytes,f.preview);
 assert.deepEqual((await reopened.assetSource(first.asset.id)).bytes,await load('source.vectorcraft'));
 assert.equal((await reopened.preview(first.asset.id)).format,'png');assert.equal((await reopened.asset(first.asset.id)).asset.sourceRevision,f.source.revision);
 const again=await reopened.addDerivative(f.input);assert.equal(again.reused,true);assert.equal(again.revision,first.revision);
 await assert.rejects(reopened.addDerivative({...f.input,preview:undefined}),e=>e.status===409);
 const anotherPng=await readFile(new URL('./fixtures/vector-image-original.png',import.meta.url));await assert.rejects(reopened.addDerivative({...f.input,preview:anotherPng}),e=>e.status===409);
 assert.equal((await reopened.inspect()).assets.length,1);
});
test('invalid previews refuse before material publication; legacy SVG stays readable without a fabricated preview',async()=>{
 const f=await fixture();await assert.rejects(f.graph.addDerivative({...f.input,preview:Buffer.from('invalid PNG')}),e=>e.status===422);
 assert.equal((await f.graph.read()).revision,null);assert.equal((await f.store.head('svg-source')).revision,f.source.revision);
 const legacy=await f.graph.addDerivative({...f.input,preview:undefined});assert.equal(legacy.asset.preview,undefined);assert.deepEqual((await f.graph.asset(legacy.asset.id)).bytes,f.svg);
 await assert.rejects(f.graph.preview(legacy.asset.id),e=>e.status===409);assert.equal((await f.graph.inspect()).assets.length,1);
});
test('a damaged preview is rejected while the original SVG and native source remain intact',async()=>{
 const f=await fixture(),{asset}=await f.graph.addDerivative(f.input),path=f.graph.path('derivatives',asset.preview.sha256+'.png');
 const damaged=Buffer.from(f.preview);damaged[damaged.length-1]^=1;await writeFile(path,damaged);
 await assert.rejects(f.graph.preview(asset.id),e=>e.status===422);assert.deepEqual((await f.graph.asset(asset.id)).bytes,f.svg);
 assert.equal((await f.store.source('svg-source',f.source.revision)).meta.sourceHash,f.source.meta.sourceHash);
});
