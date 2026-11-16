import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';

// Actual Vector WASM serializer bytes, captured by the separate browser probe, not mock engine output.
const bytes=await readFile(new URL('./fixtures/vector-web.vectorcraft',import.meta.url));
assert.ok(bytes.length>100);
const input={engine:'vectorcraft',title:'真实专业源保存测试',bytes,engineState:{uid:1,revision:1},actor:'import'};

test('exact uint64 checkpoint metadata survives persistence without changing real serializer bytes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-u64-')),store=new NativeSourceStore(root);
 const engineState={uid:'18446744073709551614',revision:'9007199254740993'};
 const initial=await store.commit('exact-id',{...input,engineState});
 const read=await store.read('exact-id');assert.deepEqual(read.meta.engineState,engineState);assert.deepEqual(read.bytes,bytes);
 const current=await store.commit('exact-id',{...input,engineState:{...engineState,revision:'9007199254740994'},baseRevision:initial.revision,actor:'manual'});
 assert.equal(current.meta.engineState.revision,'9007199254740994');
 await assert.rejects(store.commit('exact-id',{...input,engineState:{uid:Number(engineState.uid),revision:1},baseRevision:current.revision}),error=>error.status===422);
 const after=await store.read('exact-id');assert.equal(after.revision,current.revision);assert.deepEqual(after.bytes,bytes);
});

test('only declared source engines can create source records, including prototype-name inputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-engine-scope-')),store=new NativeSourceStore(root);
 for(const engine of ['constructor','__proto__','toString','unknown'])await assert.rejects(store.commit('bad-engine',{...input,engine}),/未支持的专业源类型/);
 assert.deepEqual(await store.list(),[]);
});

test('native source persists real serializer bytes and retains immutable history',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-')),store=new NativeSourceStore(root);
 const initial=await store.commit('vector-a',input),loaded=await store.read('vector-a');
 assert.deepEqual(loaded.bytes,bytes);assert.equal(loaded.revision,initial.revision);
 const second=await store.commit('vector-a',{...input,baseRevision:initial.revision,engineState:{uid:1,revision:2},actor:'manual'});
 assert.notEqual(second.revision,initial.revision);assert.equal(second.meta.parentRevision,initial.revision);
 const history=await store.versions('vector-a');assert.equal(history.length,2);
 assert.ok(history.some(item=>item.revision===initial.revision));
});

test('stale AI checkpoint cannot overwrite a later manual checkpoint',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-')),store=new NativeSourceStore(root);
 const initial=await store.commit('vector-a',input);
 const manual=await store.commit('vector-a',{...input,baseRevision:initial.revision,engineState:{uid:1,revision:2},actor:'manual'});
 await assert.rejects(store.commit('vector-a',{...input,baseRevision:initial.revision,actor:'ai'}),error=>error.status===409);
 assert.equal((await store.read('vector-a')).revision,manual.revision);
});

test('immutable historical source lookup never rewinds the head or admits an uncommitted record',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-version-')),store=new NativeSourceStore(root);
 const first=await store.commit('vector-a',input);
 const next=await store.commit('vector-a',{...input,baseRevision:first.revision,engineState:{uid:1,revision:2}});
 const prior=await store.read('vector-a',first.revision);
 assert.equal(prior.revision,first.revision);assert.equal(prior.meta.engineState.revision,1);assert.deepEqual(prior.bytes,bytes);
 assert.equal((await store.head('vector-a')).revision,next.revision);
 await assert.rejects(store.source('vector-a','f'.repeat(64)),error=>error.status===404);
 await assert.rejects(store.source('vector-a','../bad'),error=>error.status===422);
 assert.equal((await store.head('vector-a')).revision,next.revision);
});

test('placement receipt is published atomically inside the immutable source commit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-placement-')),store=new NativeSourceStore(root);
 const operation={action:'place',id:randomUUID(),assetId:'asset-'+randomUUID(),nativeId:'9007199254740993'};
 const committed=await store.commit('placed',{...input,operation});
 const reopened=new NativeSourceStore(root),version=await reopened.read('placed',committed.revision);
 assert.deepEqual(version.meta.operation,operation);assert.deepEqual(version.bytes,bytes);
 await assert.rejects(store.commit('invalid',{...input,operation:{...operation,nativeId:Number(operation.nativeId)}}),error=>error.status===422);
 assert.equal(await store.head('invalid'),null);
});

test('concurrent writers preserve exactly one committed head without corrupting source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-')),store=new NativeSourceStore(root);
 const initial=await store.commit('vector-a',input);
 const results=await Promise.allSettled(['manual','ai'].map(actor=>store.commit('vector-a',{...input,actor,baseRevision:initial.revision})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 const refusal=results.find(result=>result.status==='rejected');assert.ok([409,423].includes(refusal.reason.status));
 assert.deepEqual((await store.read('vector-a')).bytes,bytes);
});

test('independent Node processes cannot both publish a successor of the same revision',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-')),store=new NativeSourceStore(root);
 const initial=await store.commit('vector-a',input),fixture=join(root,'real-checkpoint.vectorcraft');await writeFile(fixture,bytes);
 const worker=`import {readFile} from 'node:fs/promises';
 import {NativeSourceStore} from ${JSON.stringify(new URL('../host/native-source-store.js',import.meta.url).href)};
 const [root,revision,fixture,actor]=process.argv.slice(1);
 try{const store=new NativeSourceStore(root);const result=await store.commit('vector-a',{engine:'vectorcraft',bytes:await readFile(fixture),baseRevision:revision,engineState:{uid:1,revision:2},actor});console.log(JSON.stringify({ok:true,revision:result.revision}));}
 catch(error){console.log(JSON.stringify({ok:false,status:error.status,error:error.message}));}`;
 const run=actor=>new Promise((resolve,reject)=>{let output='';const child=spawn(process.execPath,['--input-type=module','--eval',worker,root,initial.revision,fixture,actor],{windowsHide:true});
  child.stdout.on('data',data=>output+=data);child.on('error',reject);child.on('exit',code=>{try{assert.equal(code,0);resolve(JSON.parse(output));}catch(error){reject(error);}});
 });
 const results=await Promise.all(['manual','ai'].map(run));assert.equal(results.filter(result=>result.ok).length,1);
 assert.equal(results.find(result=>!result.ok).status,409);assert.equal((await store.versions('vector-a')).length,2);
});

test('source corruption is surfaced and prior metadata remains available',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-')),store=new NativeSourceStore(root);
 const saved=await store.commit('vector-a',input);
 await writeFile(join(store.directory('vector-a'),'versions',saved.meta.sourceHash+'.vectorcraft'),Buffer.from('corrupted'));
 await assert.rejects(store.read('vector-a'),error=>error.status===422);
 assert.equal((await store.versions('vector-a')).length,1);
});

test('invalid identities and unversioned updates cannot create unintended paths',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-source-')),store=new NativeSourceStore(root);
 await assert.rejects(store.commit('../escape',input),error=>error.status===400);
 const initial=await store.commit('vector-a',input);
 await assert.rejects(store.commit('vector-a',input),error=>error.status===428);
 assert.equal((await store.read('vector-a')).revision,initial.revision);
});

test('streamed native checkpoint is exact and an interrupted upload cannot publish a partial source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-stream-')),store=new NativeSourceStore(root);
 const initial=await store.commitStream('vector-a',(async function*(){for(let i=0;i<bytes.length;i+=2048)yield bytes.subarray(i,i+2048);})(),input);
 assert.deepEqual((await store.read('vector-a')).bytes,bytes);
 await assert.rejects(store.commitStream('vector-a',(async function*(){yield bytes.subarray(0,100);throw new Error('intentional interrupted test transfer');})(),{...input,baseRevision:initial.revision}),/interrupted/);
 assert.equal((await store.read('vector-a')).revision,initial.revision);
 assert.equal((await store.versions('vector-a')).length,1);
 const listed=await store.list();assert.equal(listed.length,1);assert.equal(listed[0].id,'vector-a');
});
