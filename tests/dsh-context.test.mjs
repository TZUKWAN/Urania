// Contract units; these do not claim a model run or a live DSH UI session.
import test from 'node:test';
import assert from 'node:assert/strict';
import {designBrief,insertDesignBrief} from '../client/dsh-context.js';
test('design brief binds to the current work, object, version and real resource',()=>{
 const text=designBrief({root:'D:/work',doc:{id:'design',pages:[{id:'p'}],designSystem:{upstream:{id:'editorial',revision:'commit'}}},revision:'r1',ui:{pageId:'p',selectedId:'image'}},'修改当前作品');
 for(const value of ['design','r1','image','editorial','designcraft_workspace'])assert.ok(text.includes(value));
});
test('input contract collapses the insertion range and preserves the existing draft',()=>{
 let received,persisted=false;const service={adapter:{current:{getSnapshot:()=>({key:'session',props:{inputActions:{captureInsertion:()=>({start:1,end:4,draftRev:3}),insertText:(text,span)=>{received={text,span};return true},persistDraft:()=>{persisted=true;}}}})}}};
 assert.deepEqual(insertDesignBrief({designAssistant:{scope:()=>({sessionId:'session'}),state:{binding:service.adapter.current}}},'task'),{sessionId:'session'});assert.deepEqual(received.span,{start:4,end:4,draftRev:3});assert.equal(persisted,true);
 assert.throws(()=>insertDesignBrief(null,'task'),/未就绪/);
});
