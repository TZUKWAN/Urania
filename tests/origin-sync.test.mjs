// Storage reconciliation with actual paired source/PNG/native fixtures and
// explicitly constructed origin/copy grammar. Real native/UI proof is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
import {nativeVectorHeader} from '../host/native-vector-header.js';
const load=n=>readFile(new URL('./fixtures/'+n,import.meta.url)),marker=Buffer.from([10,0,86,67,66,76,79,66,83,0]);
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-origin-sync-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store),proof=JSON.parse(await load('vector-image-origin.json')),before=await load('vector-web-blobs.vectorcraft');
 const photo=await store.commit('photo',{engine:'photocraft',bytes:await load('vector-image-original.pcraft'),engineState:proof.engineState});
 const {asset}=await graph.addDerivative({operationId:randomUUID(),baseRevision:null,sourceId:'photo',sourceRevision:photo.revision,sourceHash:photo.meta.sourceHash,engineState:photo.meta.engineState,format:'png',bytes:await load('vector-image-original.png'),title:'真实配对源'});
 const source=await store.commit('poster',{engine:'vectorcraft',bytes:before,engineState:proof.vectorEngineState});
 const {instance}=await graph.bind({operationId:randomUUID(),assetId:asset.id,sourceId:'poster',sourceRevision:source.revision,nativeId:2});
 const project=(await graph.read()).manifest.id,tail=before.subarray(before.indexOf(marker)+marker.length);
 const origin=(token,assetId=asset.id)=>({schema:1,projectId:project,assetId,instanceId:token.repeat(32)});
 const encode=(ref,copies=[])=>{const file=nativeVectorHeader(before),base=file.document.layers[0].kind.children.find(n=>n.id===2);if(ref)base.attrs={data:[['dsh-material-v1',JSON.stringify(ref)]]};for(const row of copies){const node=structuredClone(base);node.id=row.id;node.kind.xf[4]+=row.dx||0;node.attrs=row.ref?{data:[['dsh-material-v1',JSON.stringify(row.ref)]]}:undefined;file.document.layers[0].kind.children.push(node);}return Buffer.concat([Buffer.from(JSON.stringify(file)),marker,tail]);};
 const commit=async bytes=>store.commit('poster',{engine:'vectorcraft',bytes,baseRevision:(await store.head('poster')).revision,engineState:proof.vectorEngineState});
 return {root,store,graph,asset,instance,project,before,source,origin,encode,commit};
}
test('verified legacy annotation adopts same use; native copies become independent and reused native ids never inherit links',async()=>{
 const f=await fixture(),plan=await f.graph.originAssignments('poster',f.source.revision);assert.equal(plan.origins.length,1);
 const annotated=f.encode(f.origin('a'));await f.graph.verifyOriginAssignments(plan,annotated);let saved=await f.commit(annotated);await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision,annotations:plan});assert.equal((await f.graph.read()).manifest.instances[f.instance.id].originToken,'a'.repeat(32));
 saved=await f.commit(f.encode(f.origin('a'),[{id:3,ref:f.origin('b'),dx:200}]));await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision});let state=await f.graph.inspect();const copy=state.instances.find(i=>i.nativeId==='3');assert.ok(copy);assert.equal(copy.linkId,undefined);assert.notEqual(copy.id,f.instance.id);
 const linked=await f.graph.linkInstances({operationId:randomUUID(),instanceIds:[f.instance.id,copy.id]});assert.ok(linked.link);
 saved=await f.commit(f.encode(f.origin('a')));await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision});assert.equal((await f.graph.inspect()).instances.find(i=>i.id===copy.id).status,'missing');
 saved=await f.commit(f.encode(f.origin('a'),[{id:3,ref:f.origin('c'),dx:250}]));await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision});state=await f.graph.inspect();assert.equal(state.instances.find(i=>i.id===copy.id).status,'replaced');const next=state.instances.find(i=>i.nativeId==='3'&&i.status==='present');assert.ok(next);assert.notEqual(next.id,copy.id);assert.equal(next.linkId,undefined);
 await assert.rejects(f.graph.instance(copy.id),e=>e.status===409);const revision=(await f.graph.read()).revision;assert.equal((await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision})).changed,0);assert.equal((await f.graph.read()).revision,revision);
});
for(const oldEpoch of [false,true])test('native origin annotation retains existing explicit links '+(oldEpoch?'from pre-epoch legacy graphs':'with current epochs'),async()=>{
 const f=await fixture(),base=await f.commit(f.encode(null,[{id:3,ref:null,dx:200}]));
 const {instance:second}=await f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'poster',sourceRevision:base.revision,nativeId:3});
 const {link}=await f.graph.linkInstances({operationId:randomUUID(),instanceIds:[f.instance.id,second.id]});
 if(oldEpoch)await f.graph.change((await f.graph.read()).revision,value=>{for(const id of link.instanceIds)delete value.instances[id].linkEpoch;});
 const plan=await f.graph.originAssignments('poster',base.revision),annotated=f.encode(f.origin('a'),[{id:3,ref:f.origin('b'),dx:200}]);assert.equal(plan.origins.length,2);await f.graph.verifyOriginAssignments(plan,annotated);
 const saved=await f.commit(annotated);await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision,annotations:plan});
 const state=await f.graph.read();assert.deepEqual(new Set(state.manifest.links[link.id].instanceIds),new Set(link.instanceIds));
 for(const id of link.instanceIds){assert.equal(state.manifest.instances[id].linkId,link.id);assert.ok(state.manifest.instances[id].originToken);}
 assert.equal((await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision})).changed,0);
});
test('foreign and duplicate origin identities do not associate by pixel hash; stale source revisions refuse',async()=>{
 const f=await fixture();let saved=await f.commit(f.encode({...f.origin('a'),projectId:'project-foreign'},[{id:3,ref:{...f.origin('b'),projectId:'project-foreign'}}]));let result=await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision});assert.equal(result.changed,0);assert.equal(result.issues.length,2);assert.equal((await f.graph.inspect()).instances.length,1);
 const old=saved;saved=await f.commit(f.encode(f.origin('a'),[{id:3,ref:f.origin('a')}]));result=await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:saved.revision});assert.equal(result.changed,0);assert.equal(result.issues.length,2);await assert.rejects(f.graph.synchronizeSource({sourceId:'poster',sourceRevision:old.revision}),e=>e.status===409);
});
for(const legacy of [false,true])test('same-instance native undo/redo reconciles '+(legacy?'legacy marker-free':'explicit marked')+' source version without replay',async()=>{
 const f=await fixture();let base=f.source,oldBytes=f.before;
 if(!legacy){const plan=await f.graph.originAssignments('poster',base.revision);oldBytes=f.encode(f.origin('a'));await f.graph.verifyOriginAssignments(plan,oldBytes);base=await f.commit(oldBytes);await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:base.revision,annotations:plan});}
 const {edit,fork}=await f.graph.startInstanceEdit({operationId:randomUUID(),instanceId:f.instance.id,sourceId:'poster'}),proof=JSON.parse(await load('instance-fixture-provenance.json'));
 const changed=await f.store.commit(fork.sourceId,{engine:'photocraft',bytes:await load('instance-edited.pcraft'),engineState:proof.files['instance-edited.pcraft'].engineState,baseRevision:fork.revision}),png=await load('instance-edited.png');
 const {asset:newAsset}=await f.graph.addDerivative({operationId:randomUUID(),baseRevision:(await f.graph.read()).revision,sourceId:fork.sourceId,sourceRevision:changed.revision,sourceHash:changed.meta.sourceHash,engineState:changed.meta.engineState,format:'png',bytes:png,title:'实际新配对源'});
 const plan={...await f.graph.prepareInstanceApply({editId:edit.id,assetId:newAsset.id,sourceId:'poster'}),sourceId:'poster'},file=nativeVectorHeader(oldBytes),node=file.document.layers[0].kind.children.find(n=>n.id===2),old=structuredClone(node.kind);
 Object.assign(node.kind,{key:'image-undo-proof',width:320,height:240,xf:[old.xf[0]*old.width/320,old.xf[1]*old.width/320,old.xf[2]*old.height/240,old.xf[3]*old.height/240,old.xf[4],old.xf[5]]});node.attrs={data:[['dsh-material-v1',JSON.stringify(f.origin('a',newAsset.id))]]};delete file.images[old.key];file.images[node.kind.key]={mime:'image/png',data:png.toString('base64')};const editedBytes=Buffer.from(JSON.stringify(file));await f.graph.verifyInstanceApplySource(plan,editedBytes);
 const id=randomUUID(),applied=await f.store.commit('poster',{engine:'vectorcraft',bytes:editedBytes,baseRevision:base.revision,engineState:JSON.parse(await load('vector-image-origin.json')).vectorEngineState,operation:{action:'apply-instance',id,editId:edit.id,instanceId:f.instance.id,assetId:newAsset.id,previousAssetId:f.asset.id,nativeId:2,baseRevision:base.revision}});await f.graph.completeInstanceApply({sourceId:'poster',sourceRevision:applied.revision,operationId:id});
 let state=(await f.graph.read()).manifest;assert.equal(state.instances[f.instance.id].assetId,newAsset.id);
 const undone=await f.commit(oldBytes);await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:undone.revision});state=(await f.graph.read()).manifest;assert.equal(state.instances[f.instance.id].assetId,f.asset.id);assert.equal(Object.keys(state.instances).length,1);
 const redone=await f.commit(editedBytes);await new ProjectGraph(f.root).synchronizeSource({sourceId:'poster',sourceRevision:redone.revision});state=(await f.graph.read()).manifest;assert.equal(state.instances[f.instance.id].assetId,newAsset.id);assert.equal(state.instances[f.instance.id].originToken,'a'.repeat(32));assert.equal(Object.keys(state.instances).length,1);assert.equal((await f.store.head('poster')).revision,redone.revision);
});
