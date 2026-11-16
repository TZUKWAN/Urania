// The native kind is an actual legacy migration capture; the small job/view
// envelope is created solely to exercise the host's receipt admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {EditorSessions} from '../host/editor-session.js';
const kind=JSON.parse(await readFile(new URL('./fixtures/vector-legacy-native/native-kind.json',import.meta.url)));
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-legacy-receipt-')),manager=new EditorSessions({resolveScope:()=>root});
 const view={id:'view-'+randomUUID(),root,epoch:'epoch-'+randomUUID(),sourceId:'poster',sourceRevision:'a'.repeat(64)};
 manager.views.set(view.id,view);
 const job={id:randomUUID(),viewId:view.id,root,epoch:view.epoch,sessionId:'session-test',sourceId:'poster',action:'apply_instance',status:'running',executionStartedAt:new Date().toISOString(),at:new Date().toISOString(),payload:{},applyPlan:{legacyGroup:true,sourceId:'poster',baseRevision:view.sourceRevision,asset:{sourceHash:kind.key.slice('dsh-native-'.length)}}};
 manager.jobs.set(job.id,job);return {manager,view,job,root};
}
test('a genuine native frame is durably recorded for its authorized legacy job',async()=>{
 const f=await fixture();assert.deepEqual(await f.manager.recordLegacyNativeKind(f.view,{epoch:f.view.epoch,jobId:f.job.id,nativeKind:kind}),{recorded:true});
 const saved=JSON.parse(await readFile(join(f.root,'design','.designcraft','v2','operations',f.job.id+'.json'),'utf8'));
 assert.deepEqual(saved.applyPlan.nativeKind,kind);
 assert.deepEqual(await f.manager.recordLegacyNativeKind(f.view,{epoch:f.view.epoch,jobId:f.job.id,nativeKind:kind}),{recorded:true});
});
test('wrong context, wrong asset source and a changed recorded frame are refused',async()=>{
 const f=await fixture();await assert.rejects(f.manager.recordLegacyNativeKind(f.view,{epoch:'wrong',jobId:f.job.id,nativeKind:kind}));
 await assert.rejects(f.manager.recordLegacyNativeKind(f.view,{epoch:f.view.epoch,jobId:f.job.id}));
 await assert.rejects(f.manager.recordLegacyNativeKind(f.view,{epoch:f.view.epoch,jobId:f.job.id,nativeKind:{...kind,key:'dsh-native-'+'f'.repeat(64)}}));
 await f.manager.recordLegacyNativeKind(f.view,{epoch:f.view.epoch,jobId:f.job.id,nativeKind:kind});
 const shifted=structuredClone(kind);shifted.xf[4]+=10;
 await assert.rejects(f.manager.recordLegacyNativeKind(f.view,{epoch:f.view.epoch,jobId:f.job.id,nativeKind:shifted}));
});
