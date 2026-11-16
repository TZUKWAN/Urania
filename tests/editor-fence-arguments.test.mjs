// Definition/validation unit tests only. Sentinel exceptions prove delegation;
// no synthetic manager result is treated as a real native execution or service call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {editorToolDefinition} from '../host/editor-tools.js';
import {SafetyError} from '../host/safety.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/editor-missing-epoch-20261113.json',import.meta.url)));
const exec={agent:{session:{id:'unit-validation-session',header:{cwd:'unit-validation-root'}}},callId:'unit-validation-call'};
const base={uid:1,revision:3,engine:'vectorcraft',selectionStamp:'exact-observed-stamp',selection:[2]};
const invoke=async(manager,args)=>JSON.parse((await editorToolDefinition(manager).execute(args,exec)).json);
test('recorded real GLM missing-epoch arguments identify epoch before any manager mutation',async()=>{
 let reached=false;const manager={request(){reached=true;throw new Error('Must not reach mutation');}};
 const result=await invoke(manager,fixture.arguments);assert.equal(result.ok,false);assert.equal(result.status,422);assert.deepEqual(result.missingExecutionFields,['epoch']);assert.match(result.error,/view\.epoch/);assert.match(result.retryInstruction,/do not use open/);assert.equal(reached,false);
});
test('all currently fenced public actions name missing fields; no implicit fence is supplied',async()=>{
 for(const action of ['execute','undo','derive','place','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','brand']){
  const result=await invoke({}, {action});assert.equal(result.status,422);assert.deepEqual(result.missingExecutionFields,['sourceId','epoch','base']);
 }
 const blank=await invoke({}, {action:'execute',sourceId:' ',epoch:'',base:{uid:1}});assert.deepEqual(blank.missingExecutionFields,['sourceId','epoch','base.revision','base.engine','base.selectionStamp']);
});
test('complete fences delegate unchanged; backend conflict checks retain responsibility',async()=>{
 let observed;const result=await invoke({request(session,args){observed={session,args};throw new SafetyError('delegation sentinel; no native execution',418);}}, {action:'execute',sourceId:'source-exact',epoch:'epoch-exact',base,payload:{command:'paint.setFill',params:{ids:[2],color:'#c2410c'}}});
 assert.equal(result.status,418);assert.equal(result.missingExecutionFields,undefined);assert.equal(observed.session,exec.agent.session.id);assert.equal(observed.args.epoch,'epoch-exact');assert.deepEqual(observed.args.base,base);assert.equal(observed.args.operationId,exec.callId);
});
test('state and non-base read/save contracts remain compatible',async()=>{
 const state=await invoke({state(){throw new SafetyError('state delegation sentinel',418);}}, {action:'state'});assert.equal(state.status,418);assert.equal(state.missingExecutionFields,undefined);
 for(const action of ['inspect_node','save']){
  const result=await invoke({request(){throw new SafetyError('source-only delegation sentinel',418);}}, {action,sourceId:'source-exact',epoch:'epoch-exact'});assert.equal(result.status,418);assert.equal(result.missingExecutionFields,undefined);
 }
});
test('portable schema exposes all three fence requirements in model-visible descriptions',()=>{
 const definition=editorToolDefinition({});assert.match(definition.description.slice(0,1000),/epoch/);assert.match(definition.parameters.properties.epoch.description,/REQUIRED at the top level/);assert.match(definition.parameters.properties.base.description,/alongside sourceId AND epoch/);
});
test('actual GLM open arguments with a target misplaced inside payload never reopen the current App',async()=>{
 const recorded=JSON.parse(readFileSync(new URL('./fixtures/editor-open-missing-source-20261113.json',import.meta.url)));let delegated=0;
 for(const args of recorded.arguments){const result=await invoke({request(){delegated++;throw new Error('Must not reopen');}},args);assert.equal(result.status,422);assert.deepEqual(result.missingExecutionFields,['sourceId']);assert.match(result.error,/顶层 sourceId/);assert.match(result.retryInstruction,/TOP-LEVEL sourceId/);}
 assert.equal(delegated,0);
});
test('an explicit open target still delegates without requiring the previous view epoch/base',async()=>{
 let actual;const result=await invoke({request(session,args){actual=args;throw new SafetyError('explicit open delegation sentinel',418);}}, {action:'open',sourceId:'existing-target-source',payload:{}});assert.equal(result.status,418);assert.equal(actual.sourceId,'existing-target-source');assert.equal(result.missingExecutionFields,undefined);
});
