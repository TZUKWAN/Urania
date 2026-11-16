// The native source, SVG, rendered preview and poster before/after are actual
// native test captures. Only project/asset labels are changed in a temporary
// storage envelope so the isolated project can authenticate its own receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {ProjectGraph} from '../host/project-graph.js';
import {EditorSessions} from '../host/editor-session.js';
import {canonicalLegacyKind} from '../host/native-vector-legacy.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url));
const magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]);
const digest=value=>createHash('sha256').update(value).digest('hex');
function modify(bytes,fn){
 const at=bytes.indexOf(magic),doc=JSON.parse(at<0?bytes:bytes.subarray(0,at));
 const find=(list,id)=>{for(const n of list){if(String(n.id)===id)return n;const child=n.kind?.children&&find(n.kind.children,id);if(child)return child;}};
 fn(doc,find(doc.document.layers,'6'));return Buffer.concat([Buffer.from(JSON.stringify(doc)),at<0?Buffer.alloc(0):bytes.subarray(at)]);
}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-legacy-apply-')),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store),project='project-'+randomUUID();
 await graph.change(null,value=>{value.id=project;});
 const source=await store.commit('source',{engine:'vectorcraft',bytes:await load('vector-legacy-svg/source.vectorcraft'),engineState:{uid:1,revision:1}});
 const {asset:original}=await graph.addDerivative({operationId:randomUUID(),baseRevision:(await graph.read()).revision,sourceId:'source',sourceRevision:source.revision,sourceHash:source.meta.sourceHash,engineState:source.meta.engineState,format:'svg',bytes:await load('vector-legacy-svg/source.svg'),title:'原始 SVG'});
 const before=await load('vector-legacy-native/before.vectorcraft'),id=randomUUID();
 const bound=await store.commit('poster',{engine:'vectorcraft',bytes:before,engineState:{uid:2,revision:1},operation:{action:'place',id,assetId:original.id,nativeId:6}});
 const {instance}=await graph.bind({operationId:id,assetId:original.id,sourceId:'poster',sourceRevision:bound.revision,nativeId:6});
 const {edit,fork}=await graph.startInstanceEdit({operationId:randomUUID(),instanceId:instance.id,sourceId:'poster'});
 const changed=await store.commit(fork.sourceId,{engine:'vectorcraft',bytes:await load('vector-legacy-native/edited-source.vectorcraft'),baseRevision:fork.revision,engineState:{uid:1,revision:2}});
 const {asset:replacement}=await graph.addDerivative({operationId:randomUUID(),baseRevision:(await graph.read()).revision,sourceId:fork.sourceId,sourceRevision:changed.revision,sourceHash:changed.meta.sourceHash,engineState:changed.meta.engineState,format:'svg',bytes:await load('vector-legacy-native/edited.svg'),preview:await load('vector-legacy-native/edited-preview.png'),title:'编辑 SVG'});
 const kind=JSON.parse(await load('vector-legacy-native/native-kind.json'));
 const after=modify(await load('vector-legacy-native/after.vectorcraft'),(_doc,node)=>{
  const row=node.attrs.data.find(([key])=>key==='dsh-material-v1'),origin=JSON.parse(row[1]);origin.projectId=project;origin.assetId=replacement.id;row[1]=JSON.stringify(origin);
 });
 const plan={...await graph.prepareInstanceApply({editId:edit.id,assetId:replacement.id,sourceId:'poster'}),sourceId:'poster',nativeKind:kind};
 return {root,store,graph,project,source,original,bound,instance,edit,replacement,before,after,kind,plan};
}
test('actual legacy native output is checked and committed with its original placement receipt',async()=>{
 const f=await fixture();assert.equal(f.plan.legacyGroup,true);await f.graph.verifyInstanceApplySource(f.plan,f.after);
 const shifted=modify(f.after,(_doc,node)=>{node.kind.xf[4]+=10;});await assert.rejects(f.graph.verifyInstanceApplySource(f.plan,shifted),/边框/);
 const id=randomUUID(),legacyKindHash=digest(canonicalLegacyKind(f.kind));
 const applied=await f.store.commit('poster',{engine:'vectorcraft',bytes:f.after,baseRevision:f.bound.revision,engineState:{uid:2,revision:2},operation:{action:'apply-instance',id,editId:f.edit.id,instanceId:f.instance.id,assetId:f.replacement.id,previousAssetId:f.original.id,nativeId:6,baseRevision:f.bound.revision,legacyKindHash}});
 assert.equal(applied.meta.operation.legacyKindHash,legacyKindHash);
 await f.graph.completeInstanceApply({sourceId:'poster',sourceRevision:applied.revision,operationId:id});
 const actual=(await f.graph.instance(f.instance.id)).instance;assert.equal(actual.assetId,f.replacement.id);assert.equal(actual.legacyPlacementRevision,f.bound.revision);
 const undone=await f.store.commit('poster',{engine:'vectorcraft',bytes:f.before,baseRevision:applied.revision,engineState:{uid:2,revision:3}});
 await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:undone.revision});
 const original=(await f.graph.instance(f.instance.id)).instance;assert.equal(original.assetId,f.original.id);assert.equal(original.originToken,undefined);
 await f.graph.legacyVectorPreflight(f.instance.id,{sourceId:'poster'});
 const redone=await f.store.commit('poster',{engine:'vectorcraft',bytes:f.after,baseRevision:undone.revision,engineState:{uid:2,revision:4}});
 await f.graph.synchronizeSource({sourceId:'poster',sourceRevision:redone.revision});
 const again=(await f.graph.instance(f.instance.id)).instance;assert.equal(again.assetId,f.replacement.id);assert.equal(again.originToken,actual.originToken);
});

test('authorized host save rejects a shifted frame before committing and persists the native receipt',async()=>{
 const f=await fixture(),manager=new EditorSessions({resolveScope:()=>f.root});
 const view={id:'view-'+randomUUID(),root:f.root,epoch:'epoch-'+randomUUID(),sourceId:'poster',sourceRevision:f.bound.revision,engine:'vectorcraft',document:{uid:2,revision:2},lastSeen:Date.now()};
 manager.views.set(view.id,view);manager.stores.set(f.root,f.store);manager.leases.set(manager.leaseKey(view),view.id);
 const job={id:randomUUID(),viewId:view.id,root:f.root,epoch:view.epoch,sessionId:'session-test',sourceId:'poster',action:'apply_instance',status:'running',executionStartedAt:new Date().toISOString(),at:new Date().toISOString(),payload:{},applyPlan:{...f.plan}};delete job.applyPlan.nativeKind;
 manager.jobs.set(job.id,job);await manager.recordLegacyNativeKind(view,{epoch:view.epoch,jobId:job.id,nativeKind:f.kind});
 const options={epoch:view.epoch,baseRevision:f.bound.revision,engineState:{uid:2,revision:2},jobId:job.id,instanceUpdate:{jobId:job.id}};
 const shifted=modify(f.after,(_doc,node)=>{node.kind.xf[4]+=10;});
 await assert.rejects(manager.save(view,options,(async function*(){yield shifted;})()),/边框/);
 assert.equal((await f.store.head('poster')).revision,f.bound.revision);
 const result=await manager.save(view,options,(async function*(){yield f.after;})());
 assert.equal(result.meta.operation.legacyKindHash,digest(canonicalLegacyKind(f.kind)));
 await f.graph.completeInstanceApply({sourceId:'poster',sourceRevision:result.revision,operationId:job.id});
 assert.equal((await f.graph.instance(f.instance.id)).instance.assetId,f.replacement.id);
});
