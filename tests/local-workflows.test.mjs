import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {OpenDesignLibrary} from '../host/open-design-library.js';
import {LocalDesignWorkflows,localWorkflowExport} from '../host/local-design-workflows.js';
import {HtmlArtifacts} from '../host/html-artifacts.js';
import {unlinkPlanSource} from '../host/design-plan-links.js';
const operation=()=>createHash('sha256').update(randomUUID()).digest('hex');
function project(t){const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||'tests/.work');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'local-workflow-'));t.after(()=>{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});return root;}
const files=()=>[{path:'index.html',data:Buffer.from('<!doctype html><html lang="zh"><title>实际验收稿</title><h1>手工HTML测试源，不是模型生成</h1></html>').toString('base64')}];
test('real pinned-rule workflow saves exact plan and HTML bytes, distinguishes manual reading and completes idempotently',async t=>{
 const root=project(t),service=new LocalDesignWorkflows(null,new OpenDesignLibrary()),request={skillId:'skills/design-brief',title:'本地工作流验收',brief:'核对实际规则、计划及HTML源，不调用模型',outputKind:'html'},key=operation();
 let state=await service.prepare(root,request,key);const id=state.workflow.id;assert.equal(state.rulesDelivered,false);assert.equal(state.verifiedArtifactCount,0);assert.equal((await service.prepare(root,request,key)).workflow.id,id);
 const manual=service.readRule(root,{runId:id,revision:state.workflow.revision,limit:40000},'manual');assert.ok(manual.content.length>1000);assert.equal(manual.deliveredToCurrentSession,false);assert.equal((await service.status(root,id)).rulesDelivered,false);
 await assert.rejects(service.finish(root,{runId:id,revision:state.workflow.revision}),e=>e.status===409);
 const delivered=service.readRule(root,{runId:id,revision:state.workflow.revision,limit:40000},'agent');assert.equal(delivered.content,manual.content);state=await service.status(root,id);assert.equal(state.rulesDelivered,true);assert.equal(state.modelComplianceVerified,false);
 state=await service.publishHtml(root,{runId:id,revision:state.workflow.revision,entry:'index.html',files:files()});assert.equal(state.eligibleArtifactCount,1);const artifact=state.workflow.artifacts[0],saved=await new HtmlArtifacts(root).read(artifact.sourceId,artifact.sourceRevision);assert.equal(saved.document.files[0].data,files()[0].data);
 const retry=await service.publishHtml(root,{runId:id,revision:state.workflow.revision,entry:'index.html',files:files()});assert.equal(retry.workflow.artifacts.length,1);
 const done=await service.finish(root,{runId:id,revision:retry.workflow.revision});assert.equal(done.workflow.status,'completed');assert.equal((await service.finish(root,{runId:id,revision:done.workflow.revision})).reused,true);assert.equal((await localWorkflowExport(root)).length,1);
});
test('excluded services are rejected and revoked artifact declarations cannot satisfy completion',async t=>{
 const root=project(t),service=new LocalDesignWorkflows(null,new OpenDesignLibrary()),request={skillId:'skills/design-brief',title:'停用关联验收',brief:'已停用声明不能算有效产物',outputKind:'html'};
 for(const skillId of ['skills/figma-use','skills/agent-browser','skills/pr-feedback-quality-gate','skills/remotion','skills/venice-video'])await assert.rejects(service.prepare(root,{...request,skillId},operation()),e=>e.status===422);
 let state=await service.prepare(root,request,operation()),id=state.workflow.id;service.readRule(root,{runId:id,revision:state.workflow.revision,limit:40000},'agent');state=await service.status(root,id);state=await service.publishHtml(root,{runId:id,revision:state.workflow.revision,entry:'index.html',files:files()});
 await unlinkPlanSource(root,state.workflow.artifacts[0].planLink.id);state=await service.status(root,id);assert.equal(state.verifiedArtifactCount,1);assert.equal(state.eligibleArtifactCount,0);await assert.rejects(service.finish(root,{runId:id,revision:state.workflow.revision}),e=>e.status===409);
});
