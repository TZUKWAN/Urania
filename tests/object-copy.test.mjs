import test from 'node:test';
import assert from 'node:assert/strict';
import {createActions} from '../client/actions.js';
import {validateDocument} from '../host/safety.js';
test('group duplication and clipboard paste allocate fresh descendant identities',()=>{
 let state={root:'project',doc:{id:'work',canvas:{width:100,height:100},pages:[{id:'p',layers:[{id:'group',type:'group',x:0,y:0,w:20,h:20,children:[{id:'child',type:'shape',x:0,y:0,w:10,h:10,fill:'#f00'}]}]}],assets:[]},undoStack:[],redoStack:[],ui:{pageId:'p',selectedId:'group'}};
 const store={get:()=>state,set:patch=>state={...state,...patch}},sync={markLocalEdit(){},scheduleSave(){}},actions=createActions({store,sync,toast(){}});
 actions.duplicateSelection();assert.doesNotThrow(()=>validateDocument(state.doc));assert.notEqual(state.doc.pages[0].layers[0].children[0].id,state.doc.pages[0].layers[1].children[0].id);
 actions.copySelection();actions.pasteClipboard();assert.doesNotThrow(()=>validateDocument(state.doc));assert.equal(new Set(state.doc.pages[0].layers.flatMap(layer=>layer.children.map(child=>child.id))).size,3);actions.dispose();
});
