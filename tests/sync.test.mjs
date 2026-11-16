// Controlled transport tests for actual sync code; real HTTP is covered separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, createSync } from '../client/sync.js';

const documentFor=(id='d')=>({id,title:'base',canvas:{width:32,height:32},pages:[{id:'p1',layers:[{id:'a',type:'shape',x:0}]}],assets:[]});
const copy=x=>JSON.parse(JSON.stringify(x));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
async function until(check) {for(let n=0;n<100;n++){if(check())return;await new Promise(r=>setTimeout(r,2));}throw new Error('test condition not reached');}
function setup(t,fetcher) {
  const originalFetch=globalThis.fetch,originalDocument=globalThis.document;
  globalThis.document={baseURI:'http://designcraft.test/'};globalThis.fetch=fetcher;
  const doc=documentFor(),store=createStore({root:'D:/project',activeId:'d',doc,revision:'r1',backendProtocol:2,dirty:false,undoStack:[],redoStack:[],ui:{pageId:'p1',selectedId:'a'}});
  const sync=createSync(store);
  t.after(()=>{sync.dispose();globalThis.fetch=originalFetch;globalThis.document=originalDocument;});
  return {store,sync};
}

test('save ACK does not clear a newer manual edit',async t=>{
  const gate=deferred();let sent;
  const {store,sync}=setup(t,async(_url,opts)=>{sent=JSON.parse(opts.body);return gate.promise;});
  store.set({doc:{...store.get().doc,title:'first edit'}});sync.markLocalEdit();
  const saving=sync.pushDoc();await until(()=>sent);
  assert.equal(sent.baseRevision,'r1');
  store.set({doc:{...store.get().doc,title:'second edit'}});sync.markLocalEdit();
  gate.resolve(reply({ok:true,revision:'r2'}));await saving;
  assert.equal(store.get().dirty,true);assert.equal(store.get().doc.title,'second edit');
});
test('independent external AI edit merges with local move',t=>{
  const {store,sync}=setup(t,()=>{throw new Error('not requested')});
  const local=copy(store.get().doc);local.pages[0].layers[0].x=20;store.set({doc:local});sync.markLocalEdit();
  const remote=documentFor();remote.pages[0].layers.push({id:'AI',type:'text',text:'new'});
  sync.applyExternal(remote,'r2');
  assert.equal(store.get().doc.pages[0].layers[0].x,20);assert.equal(store.get().doc.pages[0].layers[1].id,'AI');assert.equal(store.get().conflict,null);
});
test('conflicting revision keeps local data and blocks switching',async t=>{
  const remote={...documentFor(),title:'remote'};
  const {store,sync}=setup(t,async()=>reply({ok:false,error:'conflict',current:{doc:remote,revision:'r2'}},409));
  store.set({doc:{...store.get().doc,title:'manual'}});sync.markLocalEdit();
  await assert.rejects(sync.flush(),/冲突|conflict/);
  assert.equal(store.get().doc.title,'manual');assert.deepEqual(store.get().conflict.paths,['/title']);
  await assert.rejects(sync.setRoot('D:/another'),/冲突/);assert.equal(store.get().root,'D:/project');
});
test('document switching waits for the old document save',async t=>{
  const gate=deferred(),calls=[];
  const {store,sync}=setup(t,async(url,opts)=>{
    calls.push(opts?.method==='POST'?'save':'open');
    return opts?.method==='POST'?gate.promise:reply({ok:true,doc:documentFor('other'),revision:'other-r1'});
  });
  store.set({doc:{...store.get().doc,title:'unsaved'}});sync.markLocalEdit();
  const opening=sync.openDoc('other');await until(()=>calls.length===1);assert.deepEqual(calls,['save']);
  gate.resolve(reply({ok:true,revision:'r2'}));await opening;
  assert.deepEqual(calls,['save','open']);assert.equal(store.get().activeId,'other');assert.equal(store.get().ui.pageId,'p1');assert.equal(store.get().ui.selectedId,null);
});
test('late response for an older document cannot replace the newer one',async t=>{
  const a=deferred(),b=deferred();let calls=0;
  const {store,sync}=setup(t,async url=>{calls++;return url.includes('id=A')?a.promise:b.promise;});
  const openA=sync.openDoc('A');await until(()=>calls===1);
  const openB=sync.openDoc('B');await until(()=>calls===2);
  b.resolve(reply({ok:true,doc:documentFor('B'),revision:'b1'}));await openB;
  a.resolve(reply({ok:true,doc:documentFor('A'),revision:'a1'}));await openA;
  assert.equal(store.get().activeId,'B');assert.equal(store.get().doc.id,'B');
});
test('commands execute after autosave and include current revision',async t=>{
  const calls=[];
  const {store,sync}=setup(t,async(url,opts)=>{
    if(opts?.method==='POST') {
      const body=JSON.parse(opts.body);calls.push({url,body});
      return reply(url.endsWith('/command')?{ok:true,results:[{ok:true}]}:{ok:true,revision:'r2'});
    }
    return reply(url.includes('/state')?{ok:true,docs:[{id:'d',revision:'r2'}]}:{ok:true,doc:store.get().doc,revision:'r2'});
  });
  store.set({doc:{...store.get().doc,title:'manual'}});sync.markLocalEdit();
  await sync.runCommands([{op:'export.pptx',id:'d'}]);
  assert.ok(calls[0].url.endsWith('/doc'));assert.ok(calls[1].url.endsWith('/command'));assert.equal(calls[1].body.baseRevisions.d,'r2');
});
test('partial command failure is not reported as successful export',async t=>{
  const {sync}=setup(t,async()=>reply({ok:false,results:[{ok:true},{op:'flush',ok:false,error:'revision conflict'}]}));
  await assert.rejects(sync.runCommands([{op:'export.pptx',id:'d'}]),/revision conflict/);
});
test('polling opens the first AI-created work when the canvas is still empty',async t=>{
 const originalInterval=globalThis.setInterval;let tick,available=false;
 globalThis.setInterval=fn=>{tick=fn;return {unref(){}};};t.after(()=>{globalThis.setInterval=originalInterval;});
 const {store,sync}=setup(t,async url=>reply(url.includes('/state')?{ok:true,docs:available?[{id:'ai-created',revision:'ai-r1'}]:[],assets:[]}:{ok:true,doc:documentFor('ai-created'),revision:'ai-r1'}));
 store.set({root:null,doc:null,activeId:null,dirty:false});await sync.setRoot('D:/project');assert.equal(store.get().doc,null);
 available=true;await tick();assert.equal(store.get().doc?.id,'ai-created');
});
test('an automatic open delayed by pixel flushing cannot replace a manually opened work or selection',async t=>{
 const gate=deferred();let flushes=0;
 const {store,sync}=setup(t,async url=>reply(url.includes('/state')?{ok:true,docs:[{id:'auto',revision:'a1'}]}:{ok:true,doc:documentFor(url.includes('id=manual')?'manual':'auto'),revision:'read-r1'}));
 store.set({doc:null,activeId:null,dirty:false});sync.setPixelHooks({flush:()=>++flushes===1?gate.promise:Promise.resolve(),hasNativePending:()=>false,draft:async()=>[]});
 const automatic=sync.refreshState();await until(()=>flushes===1);await sync.openDoc('manual');store.set({ui:{...store.get().ui,selectedId:'a'}});gate.resolve();await automatic;
 assert.equal(store.get().activeId,'manual');assert.equal(store.get().ui.selectedId,'a');
});
