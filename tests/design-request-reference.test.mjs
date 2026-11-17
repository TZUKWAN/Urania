// Public SDK contract fixtures; actual chip display/codec routing is checked in DSH.
import test from 'node:test';
import assert from 'node:assert/strict';
import {withDesignRequestReference,designRequestReferenceSource,designRequestTextRule} from '../client/native-reference.js';
const id='submission-8d8862b0-4bf0-4b84-b458-fb6d82aa5a00',sessionId='design';
test('request chip preserves the human draft, unrelated references/quotes, and full model payload',async()=>{
 const draft={text:'请保留 FILE 和中文',references:[{source:'file',offset:4,length:4,clipboardText:'FILE'}],quotes:[{offset:9,length:2,text:'中文'}]},prompt='[UraniaFeedback]'+JSON.stringify({submissionId:id,items:[{text:'深蓝色',target:{objectIds:['9007199254740993']}}]})+'[/UraniaFeedback]';
 const result=withDesignRequestReference(draft,{sessionId,id,label:'1 条设计意见',prompt}),ref=result.references.at(-1);
 assert.ok(result.text.startsWith(draft.text+'\n\n'));assert.deepEqual(result.references[0],draft.references[0]);assert.deepEqual(result.quotes,draft.quotes);assert.equal(result.text.slice(ref.offset,ref.offset+ref.length),prompt);assert.equal(ref.label,'1 条设计意见');
 const owner={ctx:{},session:{sessionId}},services={sessions:{binding:()=>owner,list:{getSnapshot:()=>({byId:{design:{cwd:'C:/owned'}}})}},designAssistant:{scope:()=>({sessionId,root:'C:/owned'})}},source=designRequestReferenceSource({store:{get:()=>({services})}});
 assert.equal(await source.codec.serialize(ref.ref,new AbortController().signal),prompt);assert.equal(designRequestTextRule.match(prompt,0).data.display,'设计意见 · 1 条');
 services.designAssistant.scope=()=>({sessionId:'other',root:'C:/other'});await assert.rejects(source.codec.serialize(ref.ref,new AbortController().signal),/对话已切换/);
});
test('malformed/oversized request chips and an aborted send fail before serialization',async()=>{
 const draft={text:'原草稿',references:[]};assert.throws(()=>withDesignRequestReference(draft,{sessionId,id:'bad',label:'意见',prompt:'x'}),/引用无效/);assert.throws(()=>withDesignRequestReference(draft,{sessionId,id,label:'意见',prompt:'x'.repeat(512001)}),/引用无效/);assert.equal(draft.text,'原草稿');
 const source=designRequestReferenceSource({store:{get:()=>{throw new Error('should not access state');}}}),abort=new AbortController();abort.abort();await assert.rejects(source.codec.serialize('{}',abort.signal));
});
