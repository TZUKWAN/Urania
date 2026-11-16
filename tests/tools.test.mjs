import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolController} from '../client/tools.js';
import {createActions} from '../client/actions.js';
const setup=tool=>{
 let state={workspaceMode:'legacy',doc:{id:'d',canvas:{width:100,height:100},pages:[{id:'p',layers:[]}]},dirty:false,undoStack:[],redoStack:[],ui:{tool,pageId:'p',zoom:1,panX:0,panY:0}};
 const store={get:()=>state,set:patch=>{state={...state,...patch}}};
 const sync={markLocalEdit:()=>store.set({dirty:true}),scheduleSave:()=>{}};
 const actions=createActions({store,sync,toast:()=>{}}),controller=createToolController({store,sync,actions});
 const e=(x,y)=>({currentTarget:{getBoundingClientRect:()=>({left:0,top:0})},clientX:x,clientY:y,button:0,pointerId:1});
 return {store,actions,controller,e};
};
test('pan does not dirty the document or block remote changes',()=>{const {store,controller,e}=setup('hand');controller.onPointerDown(e(2,2));controller.onPointerMove(e(12,12));controller.onPointerUp();assert.equal(store.get().dirty,false);assert.equal(store.get().ui.panX,10);});
test('crop gesture creates the requested rectangle',()=>{const {store,controller,e}=setup('crop');controller.onPointerDown(e(2,3));controller.onPointerMove(e(22,33));controller.onPointerUp();assert.deepEqual(store.get().ui.cropRect,{x:2,y:3,w:20,h:30});assert.equal(store.get().dirty,false);});
test('E and H select the advertised tools',()=>{const {store,controller}=setup('select');for(const [key,expected] of [['e','eraser'],['h','hand']]){controller.onKeyDown({key,target:{tagName:'CANVAS'}});assert.equal(store.get().ui.tool,expected);}});
test('legacy drawing shortcuts do not intercept the native workspace',()=>{const {store,controller}=setup('select');store.set({workspaceMode:'native'});controller.onKeyDown({key:'e',target:{tagName:'CANVAS'}});assert.equal(store.get().ui.tool,'select');});

test('async fill errors are returned to the scoped UI handler',async()=>{const {store,sync,controller,e}=(()=>{const x=setup('fill');return x})();const c=createToolController({store,sync:{},actions:{pushUndo(){},bucketFill:async()=>{throw new Error('fill failed')}}});await assert.rejects(c.onPointerDown(e(1,1)),/fill failed/);});
test('native contenteditable chat owns deletion, undo and drawing shortcuts',()=>{
 const {controller,store}=setup('select');const layer={id:'selected',type:'shape',x:0,y:0,w:10,h:10};store.set({doc:{...store.get().doc,pages:[{id:'p',layers:[layer]}]},ui:{...store.get().ui,selectedId:'selected'}});
 for(const key of ['Backspace','Delete','z','p','t'])controller.onKeyDown({key,ctrlKey:key==='z',target:{tagName:'DIV',isContentEditable:true},preventDefault(){throw new Error('Canvas intercepted the editor key');}});
 assert.equal(store.get().doc.pages[0].layers[0].id,'selected');assert.equal(store.get().ui.tool,'select');assert.equal(store.get().dirty,false);
});
test('rotating a group changes its frame once without rotating its descendants twice',()=>{
 const {store,controller,e}=setup('select'),child={id:'child',type:'shape',x:20,y:80,w:40,h:20,rotation:0},group={id:'group',type:'group',x:20,y:80,w:120,h:80,rotation:0,children:[child,{id:'second',type:'shape',x:100,y:130,w:40,h:30,rotation:0}]};
 store.set({doc:{id:'d',canvas:{width:300,height:300},pages:[{id:'p',layers:[group]}]},ui:{...store.get().ui,selectedId:'group',selectedIds:['group']}});
 controller.onPointerDown(e(80,56));controller.onPointerMove(e(144,120));controller.onPointerUp();
 const result=store.get().doc.pages[0].layers[0];assert.equal(result.rotation,90);assert.equal(result.children[0].rotation,0);assert.equal(result.children[0].x,20);assert.equal(result.children[0].y,80);
});
