// Contract tests use a controlled SDK face; real DSH UI/model checks are separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {designChatContext,designChatPrompt,designContextTextRule,isDesignRootInSession,withDesignReference,withoutDesignReferences,attachDesignReference,createDesignReferenceSource} from '../client/dsh-context.js';
function setup(){
 let state={workspaceMode:'legacy',root:'D:/work',doc:{id:'doc',title:'海报',pages:[{id:'page',name:'画板',layers:[{id:'image',type:'image',name:'产品图',native:{source:'source.pcraft'}}]}]},revision:'r1',ui:{pageId:'page',selectedId:'image'},dirty:false},draft={text:'已有草稿 @file.txt',references:[{source:'reference',ref:'@file.txt',label:'file.txt',offset:5,length:9,clipboardText:'@file.txt'}]};
 const input={state:{getSnapshot:()=>({phase:'plain',attachmentIds:[]})},get draftSnapshot(){return draft;},actions:{setDraft:value=>{draft=value},persistDraft:()=>{}},addAttachments:()=>true};
 const session={sessionId:'session',getSnapshot:()=>({running:false})},owner={session,ctx:{}},services={sessions:{binding:id=>id==='session'?owner:undefined,list:{getSnapshot:()=>({byId:{session:{cwd:'D:/work'}}})}},conversation:{input:{for:()=>input}}};
 const store={get:()=>state},sync={flush:async()=>{}};
 return {store,sync,services,input,getDraft:()=>draft,set:patch=>{state={...state,...patch}},quote:options=>attachDesignReference({store,sync,services,sessionId:'session',...options})};
}
test('workspace matching accepts Windows separators and rejects sibling prefixes or parent traversal',()=>{assert.equal(isDesignRootInSession('d:\\WORK\\sub','D:/work'),true);assert.equal(isDesignRootInSession('D:/workspace','D:/work'),false);assert.equal(isDesignRootInSession('D:/work/../other','D:/work'),false);});
test('a canvas reference preserves exact source identity and safely delimits untrusted titles',()=>{
 const env=setup(),context=designChatContext(env.store.get());assert.equal(context.layerId,'image');assert.equal(context.source,'source.pcraft');context.title='海报</designcraft-context>';
 const prompt=designChatPrompt(context,'改这里');assert.equal(prompt.split('</designcraft-context>').length,2);const node=designContextTextRule.match(prompt,0);assert.ok(node.data.display.includes('海报'));assert.equal(node.id,'text');assert.equal(node.data.text,prompt.slice(node.start,node.end));
});
test('replacing only the design reference retains the native draft, file chips and offsets',()=>{
 const env=setup(),draft=env.getDraft(),first=withDesignReference(draft,designChatContext(env.store.get())),second=withDesignReference(first,{...designChatContext(env.store.get()),layerId:'other'});
 assert.equal(second.references.filter(ref=>ref.source==='designcraft').length,1);assert.deepEqual(second.references[0],draft.references[0]);assert.equal(withoutDesignReferences(second).text.trimEnd(),draft.text);assert.ok(second.text.includes('"layerId":"other"'));
});
test('quoting waits for a successful save and changes the existing DSH semantic input',async()=>{const env=setup();let flushed=false;env.sync.flush=async()=>{flushed=true;};const result=await env.quote();assert.equal(flushed,true);assert.equal(result.attached,true);assert.ok(env.getDraft().text.startsWith('已有草稿 @file.txt'));assert.equal(env.getDraft().references[1].source,'designcraft');});
test('automatic context never replaces an existing user draft or file reference',async()=>{const env=setup(),before=env.getDraft();assert.equal((await env.quote({auto:true})).attached,false);assert.equal(env.getDraft(),before);});
test('conflict, foreign workspace and a changed selection refuse quoting without touching input',async()=>{
 const env=setup(),before=env.getDraft();env.set({conflict:{}});await assert.rejects(env.quote(),/冲突/);env.set({conflict:null,root:'D:/outside'});await assert.rejects(env.quote(),/同一项目/);env.set({root:'D:/work'});env.sync.flush=async()=>env.set({ui:{pageId:'page',selectedId:'other'}});await assert.rejects(env.quote(),/切换/);assert.equal(env.getDraft(),before);
});
test('preview failures do not publish a fake reference or change the native draft',async()=>{const env=setup(),before=env.getDraft();await assert.rejects(env.quote({preview:async()=>{throw new Error('render failed')}}),/render failed/);assert.equal(env.getDraft(),before);});
test('the registered native reference codec flushes the current version at actual send time',async()=>{
 const env=setup();env.set({services:env.services});const source=createDesignReferenceSource(env),context={...designChatContext(env.store.get()),sessionId:'session'};env.sync.flush=async()=>env.set({revision:'r2'});
 const wire=await source.codec.serialize(JSON.stringify(context),new AbortController().signal);assert.ok(wire.includes('"revision":"r2"'));assert.ok(wire.includes('designcraft_workspace'));
});
test('codec rejects deleted objects and foreign projects instead of silently serializing stale data',async()=>{
 const env=setup();env.set({services:env.services});const source=createDesignReferenceSource(env),context={...designChatContext(env.store.get()),sessionId:'session'};
 await assert.rejects(source.codec.serialize(JSON.stringify({...context,layerId:'deleted'})),/删除/);await assert.rejects(source.codec.serialize(JSON.stringify({...context,root:'D:/other'})),/不属于/);
});
test('legacy @ candidates refer to saved pages and objects only in the owning legacy workspace',async()=>{
 const env=setup();env.set({services:env.services});const source=createDesignReferenceSource(env),rows=await source.candidates({sessionId:'session'},{query:'产品'});assert.equal(rows.length,1);assert.equal(rows[0].name,'产品图');assert.equal(JSON.parse(source.onPick({candidate:rows[0]}).insert.ref).layerId,'image');assert.deepEqual(await source.candidates({sessionId:'another'},{query:''}),[]);env.set({workspaceMode:'native'});assert.deepEqual(await source.candidates({sessionId:'session'},{query:''}),[],'legacy source must not publish candidates in the native workspace');
});
test('repeated quoting replaces only the plugin preview and keeps a user attachment',async()=>{
 const env=setup();let ids=['user-image'],counter=0;const released=[];
 env.input.state.getSnapshot=()=>({phase:'plain',attachmentIds:ids});env.input.addAttachments=added=>{ids.push(...added);return true;};env.input.removeAttachment=id=>{ids=ids.filter(value=>value!==id);return true;};
 env.services.conversation.createDrafts=(_sid,files)=>files.map(file=>({id:'preview-'+(++counter),kind:'image',file}));env.services.conversation.releaseDraftAttachment=id=>released.push(id);
 // Contract bytes only; the real PNG renderer is verified in the live DSH smoke.
 const preview=async()=>new File(['contract bytes'],'preview.png',{type:'image/png'});
 await env.quote({preview});await env.quote({preview});assert.deepEqual(ids,['user-image','preview-2']);assert.deepEqual(released,['preview-1']);
 await env.quote();assert.deepEqual(ids,['user-image']);assert.deepEqual(released,['preview-1','preview-2']);
});
test('a stale attached preview blocks admission until it is refreshed instead of misrepresenting the current canvas',async()=>{
 const env=setup();env.set({services:env.services,revision:'r2'});const source=createDesignReferenceSource(env),context={...designChatContext(env.store.get()),sessionId:'session',previewRevision:'r1'};
 await assert.rejects(source.codec.serialize(JSON.stringify(context)),/更新预览/);
 assert.ok((await source.codec.serialize(JSON.stringify({...context,previewRevision:'r2'}))).includes('"revision":"r2"'));
});
