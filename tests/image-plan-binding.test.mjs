import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DesignPlans} from '../host/design-plans.js';
import {saveAsset} from '../host/docstore.js';
import {pinImagePlan,verifyImagePlan,saveImagePlanTrace,imagePlanTraces} from '../host/image-plan-binding.js';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function project(t){const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||'tests/.work');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'image-plan-'));t.after(()=>{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});return root;}
test('image binding pins the old exact saved plan after later edits and rejects altered identity',t=>{
 const root=project(t),plans=new DesignPlans(root),id='plan-'+randomUUID().replaceAll('-',''),first=plans.save({id,baseRevision:null,title:'原计划',brief:'只修改图片主体',content:'保留背景与版式',sources:[]}),binding=pinImagePlan(root,id,first.revision);
 plans.save({id,baseRevision:first.revision,title:'第二版',brief:'独立的新要求',content:'新要求内容',sources:[]});assert.deepEqual(verifyImagePlan(root,binding),binding);assert.equal(binding.title,'原计划');assert.throws(()=>verifyImagePlan(root,{...binding,title:'伪造标题'}),e=>e.status===409);assert.equal(pinImagePlan(root),null);
});
test('candidate trace exports byte-verified existing PNG/native fixtures and refuses changed candidate files',t=>{
 const root=project(t),plans=new DesignPlans(root),id='plan-'+randomUUID().replaceAll('-',''),plan=plans.save({id,baseRevision:null,title:'图片追溯',brief:'核对候选来源',content:'保留精确修订',sources:[]});
 // Genuine captured native source/preview fixtures; no generated-image service result is claimed.
 const preview=readFileSync(new URL('./fixtures/vector-image-original.png',import.meta.url)),native=readFileSync(new URL('./fixtures/vector-image-original.pcraft',import.meta.url)),asset=saveAsset(root,'captured-preview.png',preview).name,source=saveAsset(root,'captured-source.pcraft',native).name;
 const record={id:'image-'+randomUUID(),root,designPlan:pinImagePlan(root,id,plan.revision),requestSignature:sha(Buffer.from('local trace acceptance, no provider request')),status:'succeeded',candidates:[{id:'candidate-'+randomUUID(),index:0,asset,native:{source},sourceHash:sha(native)}]};
 saveImagePlanTrace(record);const [trace]=imagePlanTraces(root);assert.equal(trace.row.designPlan.planRevision,plan.revision);assert.equal(trace.assets.length,2);assert.ok(trace.assets.some(a=>a.sha256===sha(native)&&a.bytes.equals(native)));
 assert.throws(()=>saveImagePlanTrace({...record,requestSignature:'f'.repeat(64)}),e=>e.status===409);
 const file=join(root,'design/assets',asset);writeFileSync(file,Buffer.from('deliberate isolated tamper'));assert.throws(()=>imagePlanTraces(root),e=>e.status===409);
});
