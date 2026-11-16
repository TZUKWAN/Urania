// Real native fixture bytes, real filesystem CAS and restart; this storage gate
// does not stand in for the separate actual editor/PNG/apply journey.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
const bytes=await readFile(new URL('./fixtures/vector-web.vectorcraft',import.meta.url));
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0H10V10H0Z"/></svg>');
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'dc-instance-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store);
 const original=await store.commit('original',{engine:'vectorcraft',bytes,title:'原始',engineState:{uid:1,revision:1}});
 const {asset}=await graph.addDerivative({operationId:randomUUID(),baseRevision:null,sourceId:'original',sourceRevision:original.revision,sourceHash:original.meta.sourceHash,engineState:original.meta.engineState,format:'svg',bytes:svg,title:'固定版本'});
 const one=await graph.bind({operationId:randomUUID(),assetId:asset.id,sourceId:'original',sourceRevision:original.revision,nativeId:2});
 await store.commit('second-layout',{engine:'vectorcraft',bytes,title:'另一个使用处',engineState:{uid:2,revision:1}});
 const secondSource=await store.head('second-layout'),two=await graph.bind({operationId:randomUUID(),assetId:asset.id,sourceId:'second-layout',sourceRevision:secondSource.revision,nativeId:2});
 return {root,store,graph,original,asset,one,two};
}
test('instance fork uses exact bound historical version, keeps both uses and newer original intact',async()=>{
 const f=await setup();
 const newer=await f.store.commit('original',{engine:'vectorcraft',bytes,title:'之后的新版本',engineState:{uid:1,revision:8},baseRevision:f.original.revision});
 const input={operationId:randomUUID(),instanceId:f.one.instance.id,sourceId:'original'},result=await f.graph.startInstanceEdit(input);
 const fork=await f.store.read(result.fork.sourceId);assert.deepEqual(fork.bytes,bytes);
 assert.equal(fork.meta.engineState.revision,1);assert.equal(fork.meta.origin.revision,f.original.revision);
 assert.equal((await f.store.head('original')).revision,newer.revision);
 assert.equal((await f.graph.read()).manifest.instances[f.two.instance.id].assetId,f.asset.id);
 const edited=await f.store.commit(fork.meta.id,{engine:'vectorcraft',bytes,title:'只改独立实例',engineState:{uid:3,revision:2},baseRevision:fork.revision});
 const reopened=new ProjectGraph(f.root),again=await reopened.startInstanceEdit(input);
 assert.equal(again.fork.revision,edited.revision);assert.equal(again.fork.reused,true);
 assert.equal((await reopened.inspect()).edits.length,1);
 assert.equal((await f.store.head('original')).revision,newer.revision);
 assert.equal((await f.store.head('second-layout')).revision,f.two.instance.boundAtRevision);
 await assert.rejects(reopened.startInstanceEdit({...input,instanceId:f.two.instance.id}),e=>e.status===409);
 await assert.rejects(reopened.startInstanceEdit({...input,operationId:randomUUID(),sourceId:'second-layout'}),e=>e.status===409);
});
test('durable editing intent recovers a fork interrupted before publication; competing fork calls reuse one source',async()=>{
 const f=await setup(),operationId=randomUUID(),id='edit-'+operationId,current=await f.graph.read();
 await f.graph.change(current.revision,value=>{value.edits={[id]:{id,instanceId:f.one.instance.id,assetId:f.asset.id,sourceId:'fork-'+operationId,fromSourceId:'original',fromRevision:f.original.revision,fromHash:f.original.meta.sourceHash,mode:'independent',phase:'editing'}};});
 assert.equal(await f.store.head('fork-'+operationId),null);
 const resumed=await new ProjectGraph(f.root).startInstanceEdit({operationId,instanceId:f.one.instance.id,sourceId:'original'});
 assert.deepEqual((await f.store.read(resumed.fork.sourceId)).bytes,bytes);
 const op=randomUUID(),results=await Promise.all([f.store.forkVersion('original',f.original.revision,{operationId:op}),new NativeSourceStore(f.root).forkVersion('original',f.original.revision,{operationId:op})]);
 assert.equal(results[0].rootRevision,results[1].rootRevision);assert.equal((await f.store.versions(results[0].sourceId)).length,1);
});
test('ordinary uses stay independent until explicitly linked; durable membership, identity reuse and detach do not mutate native sources',async()=>{
 const f=await setup(),before=(await f.store.list()).map(s=>[s.id,s.revision]);
 assert.equal((await f.graph.inspect()).links.length,0);
 const input={operationId:randomUUID(),instanceIds:[f.one.instance.id,f.two.instance.id]},created=await f.graph.linkInstances(input);
 assert.equal((await f.graph.linkInstances(input)).reused,true);
 const restarted=new ProjectGraph(f.root),state=await restarted.inspect();assert.equal(state.links.length,1);assert.equal(state.instances.filter(i=>i.linkId===created.link.id).length,2);
 await assert.rejects(restarted.linkInstances({...input,operationId:randomUUID()}),e=>e.status===409);
 await assert.rejects(restarted.linkInstances({...input,instanceIds:[f.two.instance.id,f.one.instance.id]}),e=>e.status===409);
 await restarted.unlinkInstance(f.one.instance.id);const after=await restarted.inspect();assert.equal(after.instances.find(i=>i.id===f.one.instance.id).linkId,undefined);assert.deepEqual(after.links[0].instanceIds,[f.two.instance.id]);
 assert.deepEqual((await f.store.list()).map(s=>[s.id,s.revision]),before);
});
