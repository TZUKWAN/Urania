// Durable records use real disk/native source storage; native execution is tested separately in DSH.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,realpathSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';import {randomUUID} from 'node:crypto';
import {DesignFeedback,feedbackToolDefinition} from '../host/design-feedback.js';import {NativeSourceStore} from '../host/native-source-store.js';import {reserveDesignAssistantSession} from '../host/design-assistant-session.js';import {workspacePath} from '../host/safety.js';import {feedbackTargetKey,nativeFeedbackTarget} from '../client/feedback-contract.js';
test('draft CAS, per-page/object keys, durable queue, batch retry and actual-read receipt',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'urania-feedback-')));
 try{
  const reservation=reserveDesignAssistantSession({root,workspaceId:'ws-feedback',resolveWorkspace:()=>({path:root})}),sessionId=reservation.sessionId;
  const store=new NativeSourceStore(root),head=await store.commit('source-one',{engine:'vectorcraft',title:'real serializer fixture, not a new native execution',bytes:readFileSync(new URL('./fixtures/vector-web.vectorcraft',import.meta.url)),engineState:{uid:1,revision:1},actor:'manual'});
  const document={uid:1,revision:1,selection:[2],nativeSelection:{kind:'vectorcraft',data:{objects:[2]}},page:{},engine:'vectorcraft'};
  const view={root,sessionId,sourceId:'source-one',sourceRevision:head.revision,ready:true,document};
  const manager={scope:(id,p)=>{assert.equal(id,sessionId);return realpathSync(workspacePath(root,p||'.',{mustExist:true}));},store:()=>store,active:new Map([[sessionId,'view']]),views:new Map([['view',view]]),jobs:new Map()};
  let service=new DesignFeedback(manager);const call=args=>service.run(sessionId,root,args);
  const target=nativeFeedbackTarget({sourceId:view.sourceId,sourceRevision:head.revision,engine:'vectorcraft',engineUid:1,engineRevision:1,objectIds:[2],nativeSelection:document.nativeSelection,title:'草稿'});
  const saved=await call({action:'save_draft',target,text:'重载后保留的中文意见',baseVersion:0});assert.equal(saved.draft.version,1);
  service=new DesignFeedback(manager);assert.equal((await call({action:'list'})).drafts[0].text,'重载后保留的中文意见');
  await assert.rejects(()=>call({action:'save_draft',target,text:'不能覆盖',baseVersion:0}),/其他窗口/);
  const request={action:'add',target,text:'重载后保留的中文意见',operationId:'op-'+randomUUID()},one=await call(request);assert.equal((await call(request)).item.id,one.item.id);assert.equal((await call({action:'list'})).drafts.length,0);
  await assert.rejects(()=>call({...request,text:'同动作不同输入'}),/不能重试/);
  const two=await call({...request,operationId:'op-'+randomUUID()});assert.notEqual(one.item.id,two.item.id);
  const id='submission-'+randomUUID(),batch=await call({action:'submit',submissionId:id,itemIds:[one.item.id,two.item.id]});assert.equal(batch.submission.status,'saved');assert.equal((await call({action:'submit',submissionId:id,itemIds:[one.item.id,two.item.id]})).replayed,true);
  const attemptId='delivery-'+randomUUID();assert.equal((await call({action:'claim_delivery',submissionId:id,attemptId})).accepted,true);assert.equal((await call({action:'claim_delivery',submissionId:id,attemptId:'delivery-'+randomUUID()})).accepted,false);
  await call({action:'delivery',submissionId:id,attemptId,delivery:'submitted'});assert.equal((await call({action:'read',submissionId:id})).submission.status,'saved','HTTP delivery/read does not impersonate AI acknowledgement');
  const tool=feedbackToolDefinition(service),received=JSON.parse((await tool.execute({action:'read',submissionId:id},{agent:{session:{id:sessionId,header:{cwd:root}}}})).json);assert.equal(received.submission.status,'received');assert.ok(received.submission.receivedAt);
  await assert.rejects(()=>service.run(sessionId,root,{action:'complete',submissionId:id,jobIds:['not-real']},{ai:true}),/尚未实际完成/);
  assert.equal((await call({action:'list'})).submissions[0].status,'received');
  assert.notEqual(feedbackTargetKey(target),feedbackTargetKey({...target,objectIds:[3]}));
  assert.notEqual(feedbackTargetKey({...target,page:{kind:'slide',id:7,index:0}}),feedbackTargetKey({...target,page:{kind:'slide',id:8,index:0}}));
  assert.equal(feedbackTargetKey({...target,page:{kind:'slide',id:7,index:0}}),feedbackTargetKey({...target,page:{kind:'slide',id:7,index:3}}),'page order is display, stable UID is identity');
  const currentBytes=(await store.read(view.sourceId)).bytes;service.registerRejected(view,{id:randomUUID()},currentBytes,'historical navigation rejection');assert.ok(service.rejectedCandidate(view,currentBytes));assert.equal(await service.isRejected(view,currentBytes),false,'the exact current durable source can always reopen without overwriting content');
  const differentBytes=Buffer.from(currentBytes.toString().replace('Web','WEB'));if(!differentBytes.equals(currentBytes)){service.registerRejected(view,{id:randomUUID()},differentBytes,'rejected content');assert.equal(await service.isRejected(view,differentBytes),true);}
  view.document={...document,revision:2};await assert.rejects(()=>call({...request,operationId:'op-'+randomUUID()}),/设计已变化/);
  await assert.rejects(()=>service.run('ordinary-chat',root,{action:'list'}),/设计对话/);
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});}
});
