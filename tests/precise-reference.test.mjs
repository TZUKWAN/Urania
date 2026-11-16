import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionIdentity,validateSelectionReference} from '../client/selection.js';
import {designChatContext,designChatPrompt,designContextTextRule} from '../client/dsh-context.js';
const state=()=>({root:'D:/project',revision:'r1',doc:{id:'work',title:'设计',pages:[{id:'p',layers:[{id:'proxy',type:'native',native:{engine:'deckcraft',source:'v1.deckcraft',nodes:[{id:12},{id:13}]}},{id:'other',type:'text'}]}]},ui:{pageId:'p',selectedId:'proxy',selectedIds:['proxy','other'],nativeSelection:{pageId:'p',layerId:'proxy',source:'v1.deckcraft',ids:[12]}},uiSelection:{kind:'rect',x:10,y:20,w:30,h:40,pageId:'p',layerId:'proxy'}});
test('exact multi-object, native ID and canvas region survive the native chat serializer text',()=>{
 const s=state(),context=designChatContext(s);assert.equal(context.schema,2);assert.deepEqual(context.selection.layerIds,['proxy','other']);assert.deepEqual(context.selection.native.ids,[12]);assert.deepEqual(context.selection.region,{kind:'rect',x:10,y:20,w:30,h:40,space:'canvas',pageId:'p',layerId:'proxy'});assert.ok(designContextTextRule.match(designChatPrompt(context,''),0));validateSelectionReference(context,s.doc);
});
test('a reused native ID on a different source cannot silently retarget an old quote',()=>{const s=state(),context=designChatContext(s);s.doc.pages[0].layers[0].native.source='v2.deckcraft';assert.throws(()=>validateSelectionReference(context,s.doc),/源版本/);});
test('removed secondary selected object invalidates the whole multi-object quote',()=>{const s=state(),context=designChatContext(s);s.doc.pages[0].layers.pop();assert.throws(()=>validateSelectionReference(context,s.doc),/删除/);});
test('whole-page and foreign-region references do not leak old selection',()=>{const s=state();assert.equal(designChatContext(s,{wholePage:true}).selection.native,null);s.uiSelection.pageId='old';assert.equal(selectionIdentity(s).region,null);});
