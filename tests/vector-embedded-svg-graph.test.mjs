// Native source/archive bytes are genuine command captures. This unit assigns
// project/asset UUIDs in a temporary storage envelope; it is not a live UI test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectGraph} from '../host/project-graph.js';
import {NativeSourceStore} from '../host/native-source-store.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url)),magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]);
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-vector-svg-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store),meta=JSON.parse(await load('vector-embedded-svg/metadata.json')),origin=JSON.parse(await load('svg-material/origin.json')),edited=JSON.parse(await load('svg-material/edited-origin.json'));
 const project='project-'+randomUUID(),oldAsset='asset-'+randomUUID(),newAsset='asset-'+randomUUID(),labels=new Map([[meta.originBefore.assetId,oldAsset],[meta.originAfter.assetId,newAsset]]);
 const relabel=bytes=>{const at=bytes.indexOf(magic);assert.ok(at>0);const doc=JSON.parse(bytes.subarray(0,at)),walk=items=>{for(const n of items){for(const row of n.attrs?.data||[])if(row[0]==='dsh-material-v1'){const ref=JSON.parse(row[1]);ref.projectId=project;ref.assetId=labels.get(ref.assetId);row[1]=JSON.stringify(ref);}if(n.kind?.children)walk(n.kind.children);}};walk(doc.document.layers);return Buffer.concat([Buffer.from(JSON.stringify(doc)),bytes.subarray(at)]);};
 const before=relabel(await load('vector-embedded-svg/before.vectorcraft')),after=relabel(await load('vector-embedded-svg/after.vectorcraft'));
 await graph.change(null,v=>{v.id=project;});
 const source=await store.commit('source',{engine:'vectorcraft',bytes:await load('svg-material/source.vectorcraft'),engineState:{uid:origin.engineState.uid,revision:origin.engineState.revision}});
 const {asset}=await graph.addDerivative({operationId:oldAsset.slice(6),baseRevision:(await graph.read()).revision,sourceId:'source',sourceRevision:source.revision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,format:'svg',bytes:await load('svg-material/source.svg'),preview:await load('svg-material/preview.png'),title:'实际矢量源'});
 const layout=await store.commit('poster',{engine:'vectorcraft',bytes:before,engineState:{uid:1,revision:1}});
 return {store,graph,meta,origin,edited,before,after,source,layout,asset,newAsset};
}
test('actual embedded source binds to its exact Vector source and automatically discovers an independent second use',async()=>{
 const f=await fixture(),{instance}=await f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'poster',sourceRevision:f.layout.revision,nativeId:f.meta.targetId});
 assert.equal((await f.graph.instance(instance.id)).asset.id,f.asset.id);await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:f.layout.revision});
 const project=await f.graph.inspect(),other=project.instances.find(i=>i.nativeId===String(f.meta.otherId));assert.ok(other);assert.equal(other.assetId,f.asset.id);assert.equal(other.linkId,undefined);assert.notEqual(other.originToken,instance.originToken);
});
test('SVG apply checks the original and changed source and reconciles undo/redo to the same instance',async()=>{
 const f=await fixture(),{instance}=await f.graph.bind({operationId:randomUUID(),assetId:f.asset.id,sourceId:'poster',sourceRevision:f.layout.revision,nativeId:f.meta.targetId}),{edit,fork}=await f.graph.startInstanceEdit({operationId:randomUUID(),instanceId:instance.id,sourceId:'poster'});
 const changed=await f.store.commit(fork.sourceId,{engine:'vectorcraft',bytes:await load('svg-material/edited-source.vectorcraft'),baseRevision:fork.revision,engineState:{uid:f.edited.engineState.uid,revision:f.edited.engineState.revision}});
 const {asset}=await f.graph.addDerivative({operationId:f.newAsset.slice(6),baseRevision:(await f.graph.read()).revision,sourceId:fork.sourceId,sourceRevision:changed.revision,sourceHash:changed.meta.sourceHash,engineState:changed.meta.engineState,format:'svg',bytes:await load('svg-material/edited-source.svg'),preview:await load('svg-material/edited-preview.png'),title:'移动节点后的 SVG'});
 const plan={...await f.graph.prepareInstanceApply({editId:edit.id,assetId:asset.id,sourceId:'poster'}),sourceId:'poster'};await f.graph.verifyInstanceApplySource(plan,f.after);
 const id=randomUUID(),applied=await f.store.commit('poster',{engine:'vectorcraft',bytes:f.after,baseRevision:f.layout.revision,engineState:{uid:1,revision:2},operation:{action:'apply-instance',id,editId:edit.id,instanceId:instance.id,assetId:asset.id,previousAssetId:f.asset.id,nativeId:f.meta.targetId,baseRevision:f.layout.revision}});
 await f.graph.completeInstanceApply({sourceId:'poster',sourceRevision:applied.revision,operationId:id});assert.equal((await f.graph.instance(instance.id)).asset.id,asset.id);
 const undone=await f.store.commit('poster',{engine:'vectorcraft',bytes:f.before,baseRevision:applied.revision,engineState:{uid:1,revision:3}});await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:undone.revision});assert.equal((await f.graph.instance(instance.id)).asset.id,f.asset.id);
 const redone=await f.store.commit('poster',{engine:'vectorcraft',bytes:f.after,baseRevision:undone.revision,engineState:{uid:1,revision:4}});await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:redone.revision});assert.equal((await f.graph.instance(instance.id)).asset.id,asset.id);assert.equal((await f.store.head('poster')).revision,redone.revision);
});
