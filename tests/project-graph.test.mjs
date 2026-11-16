// Storage/provenance tests. Hand-authored SVG inputs are not native-generation or placement proof.
// The separate real browser test must establish the same-App bundle/place/source roundtrip.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
const bytes=await readFile(new URL('./fixtures/vector-web.vectorcraft',import.meta.url));
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><path d="M80 80H240V240H80Z" fill="#287d6c"/></svg>');
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-project-')),sources=new NativeSourceStore(root),graph=new ProjectGraph(root,sources);
 const source=await sources.commit('design',{engine:'vectorcraft',title:'原生源',bytes,engineState:{uid:1,revision:1}});
 const input={operationId:randomUUID(),baseRevision:null,sourceId:'design',sourceRevision:source.revision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,format:'svg',bytes:svg,title:'素材'};
 return {root,sources,graph,source,input};
}
test('an actual native source version and immutable derivative have stable explicit project identity',async()=>{
 const f=await fixture(),first=await f.graph.addDerivative(f.input);
 const reopened=new ProjectGraph(f.root),state=await reopened.inspect(),data=await reopened.asset(first.asset.id);
 assert.match(state.id,/^project-/);assert.equal(state.assets.length,1);assert.equal(state.assets[0].sourceRevision,f.source.revision);assert.deepEqual(data.bytes,svg);
 const second=await reopened.addDerivative({...f.input,operationId:randomUUID(),baseRevision:first.revision});
 assert.notEqual(second.asset.id,first.asset.id);assert.equal(second.asset.sha256,first.asset.sha256);
 assert.equal((await reopened.inspect()).id,state.id);assert.equal((await reopened.inspect()).assets.length,2);
});
test('derivation is idempotent by operation and cannot relabel another source result',async()=>{
 const f=await fixture(),first=await f.graph.addDerivative(f.input),again=await f.graph.addDerivative(f.input);
 assert.equal(first.revision,again.revision);assert.equal(again.reused,true);
 await assert.rejects(f.graph.addDerivative({...f.input,bytes:Buffer.from(svg.toString().replace('#287d6c','#ffffff'))}),error=>error.status===409);
 assert.equal((await f.graph.inspect()).assets.length,1);
});
test('old derivatives keep their exact source revision after a later source commit',async()=>{
 const f=await fixture(),asset=await f.graph.addDerivative(f.input);
 const next=await f.sources.commit('design',{engine:'vectorcraft',bytes,engineState:{uid:1,revision:2},baseRevision:f.source.revision});
 assert.equal((await f.graph.asset(asset.asset.id)).asset.sourceRevision,f.source.revision);
 assert.equal((await f.sources.head('design')).revision,next.revision);
 await assert.rejects(f.graph.addDerivative({...f.input,operationId:randomUUID(),baseRevision:asset.revision,sourceHash:'f'.repeat(64)}),error=>error.status===409);
 await assert.rejects(f.graph.addDerivative({...f.input,operationId:randomUUID(),baseRevision:asset.revision,engineState:{uid:1,revision:2}}),error=>error.status===409);
});
test('a binding requires a real saved non-layer object; ordinary source copies are not inferred as uses',async()=>{
 const f=await fixture(),asset=await f.graph.addDerivative(f.input),operationId=randomUUID();
 await assert.rejects(f.graph.bind({operationId,assetId:asset.asset.id,sourceId:'design',sourceRevision:f.source.revision,nativeId:999}),error=>error.status===409);
 await assert.rejects(f.graph.bind({operationId,assetId:asset.asset.id,sourceId:'design',sourceRevision:f.source.revision,nativeId:1}),error=>error.status===409);
 const bound=await f.graph.bind({operationId,assetId:asset.asset.id,sourceId:'design',sourceRevision:f.source.revision,nativeId:2});
 assert.equal((await f.graph.bind({operationId,assetId:asset.asset.id,sourceId:'design',sourceRevision:f.source.revision,nativeId:2})).reused,true);
 await f.sources.commit('independent-copy',{engine:'vectorcraft',bytes,engineState:{uid:2,revision:1}});
 const state=await f.graph.inspect();assert.equal(state.instances.length,1);assert.equal(state.instances[0].status,'present');assert.equal(state.instances[0].nativeId,'2');assert.equal(state.instances[0].id,bound.instance.id);assert.equal(state.sources.length,2);
});
test('independent Node processes cannot publish two graph successors of the same revision',async()=>{
 const f=await fixture(),first=await f.graph.addDerivative(f.input);
 const worker=`import {ProjectGraph} from ${JSON.stringify(new URL('../host/project-graph.js',import.meta.url).href)};
 const [root,text]=process.argv.slice(1);const input=JSON.parse(text);input.bytes=Buffer.from(input.bytes,'base64');
 try{const result=await new ProjectGraph(root).addDerivative(input);console.log(JSON.stringify({ok:true,revision:result.revision}));}
 catch(error){console.log(JSON.stringify({ok:false,status:error.status}));}`;
 const run=()=>new Promise((resolve,reject)=>{
  const input={...f.input,operationId:randomUUID(),baseRevision:first.revision,bytes:svg.toString('base64')};let output='';
  const child=spawn(process.execPath,['--input-type=module','-e',worker,f.root,JSON.stringify(input)],{windowsHide:true});child.stdout.on('data',value=>output+=value);child.on('error',reject);child.on('exit',code=>{try{assert.equal(code,0);resolve(JSON.parse(output));}catch(error){reject(error);}});
 });
 const results=await Promise.all([run(),run()]);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).status,409);
 assert.equal((await f.graph.inspect()).assets.length,2);
});
test('unpublished bytes and history records are ignored after interruption',async()=>{
 const f=await fixture();await mkdir(f.graph.path('derivatives'),{recursive:true});await mkdir(f.graph.path('history'),{recursive:true});
 await writeFile(f.graph.path('derivatives','f'.repeat(64)+'.svg'),svg);await writeFile(f.graph.path('history','e'.repeat(64)+'.json'),'interrupted unpublished record');
 const state=await new ProjectGraph(f.root).inspect();assert.equal(state.id,null);assert.equal(state.revision,null);assert.deepEqual(state.assets,[]);
 assert.equal((await f.sources.read('design')).revision,f.source.revision);
});
test('tampered derivative or referenced manifest is refused while native source remains intact',async()=>{
 const f=await fixture(),first=await f.graph.addDerivative(f.input),data=await f.graph.asset(first.asset.id);
 await writeFile(data.path,'corrupt');await assert.rejects(f.graph.asset(first.asset.id),error=>error.status===422);
 assert.deepEqual((await f.sources.read('design')).bytes,bytes);
 await writeFile(f.graph.path('history',first.revision+'.json'),'corrupt');await assert.rejects(f.graph.read(),error=>error.status===422);
});
test('project boundaries, identities, stale commits and active SVG inputs fail closed',async()=>{
 const f=await fixture(),first=await f.graph.addDerivative(f.input),other=await fixture();
 await assert.rejects(other.graph.asset(first.asset.id),error=>error.status===404);
 await assert.rejects(f.graph.asset('../escape'),error=>error.status===422);
 await assert.rejects(f.graph.addDerivative({...f.input,operationId:randomUUID()}),error=>error.status===409);
 await assert.rejects(f.graph.addDerivative({...f.input,operationId:randomUUID(),baseRevision:first.revision,bytes:Buffer.from('<svg><script>bad</script></svg>')}),error=>error.status===422);
 assert.equal((await f.graph.inspect()).assets.length,1);
});
