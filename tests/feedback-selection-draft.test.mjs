import test from 'node:test';
import assert from 'node:assert/strict';
import {expandsFeedbackSelection} from '../client/feedback-contract.js';
import {DesignFeedbackClient} from '../client/design-feedback.js';
const target={kind:'native',sourceId:'source',revision:'a'.repeat(64),engine:'vectorcraft',engineUid:'9007199254740993',engineRevision:'4',objectIds:['10'],page:{kind:'slide',id:'20',index:0}};
test('draft expansion retains exact document/page/object identity and refuses unrelated scopes',()=>{
 assert.equal(expandsFeedbackSelection(target,{...target,revision:'b'.repeat(64),engineRevision:'5',objectIds:['11','10']}),true);
 for(const change of [{sourceId:'different'},{engineUid:'9007199254740994'},{page:{kind:'slide',id:'21'}},{objectIds:['11','12']},{region:{space:'page-normalized',x:0,y:0,width:1,height:1}},{kind:'motion',objectIds:['11','10']}])assert.equal(expandsFeedbackSelection(target,{...target,objectIds:['11','10'],...change}),false);
});
test('client carries an actively edited draft without overwriting another target draft or an uncertain add',()=>{
 // Pure client-state contract; browser persistence and real DSH behavior are
 // exercised separately by the actual native mouse/Shift selection regression.
 const client=new DesignFeedbackClient({},()=>({}));client.scope={root:'contract',sessionId:'contract'};client.state.loading=false;client.journal=()=>{};
 try{
  const expanded={...target,objectIds:['10','11']};client.setDraft(target,'当前输入');assert.equal(client.carryExpandedDraft(target,expanded),true);assert.equal(client.draft(target),'当前输入');assert.equal(client.draft(expanded),'当前输入');
  client.setDraft(expanded,'另一个选区已有意见');assert.equal(client.carryExpandedDraft(target,expanded),false);assert.equal(client.draft(expanded),'另一个选区已有意见');
  const empty={...target,objectIds:['10','12']};client.setDraft(empty,'');assert.equal(client.carryExpandedDraft(target,empty),false);
  const source=Object.values(client.state.drafts).find(d=>d.target.objectIds.length===1);source.pendingAdd={id:'pending',text:source.text};assert.equal(client.carryExpandedDraft(target,{...target,objectIds:['10','13']}),false);
 }finally{for(const timer of client.timers.values())clearTimeout(timer);}
});
