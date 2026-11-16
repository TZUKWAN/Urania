import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
import * as store from '../host/docstore.js';
import { atomicWrite } from '../host/persistence.js';
import { executeCommands } from '../host/commands.js';
import { createImage, toPNG } from '../host/raster.js';

const TEST_BASE=resolve(process.env.DESIGNCRAFT_TEST_ROOT || fileURLToPath(new URL('./.work/',import.meta.url)));
mkdirSync(TEST_BASE,{recursive:true});
function workspace(t) {
  const root=mkdtempSync(join(TEST_BASE,'store-'));
  t.after(()=>{assert.ok(!relative(TEST_BASE,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
  return root;
}
const doc = (title='base') => ({title,type:'canvas',canvas:{width:64,height:64},pages:[{id:'p1',layers:[]}],assets:[]});

test('stale UI save cannot remove an AI layer',t=>{
  const root=workspace(t);store.writeDoc(root,'drawing',doc());
  const before=store.readDoc(root,'drawing');
  const result=executeCommands(root,[{op:'layer.add',id:'drawing',pageId:'p1',layer:{id:'ai-layer',type:'text',text:'AI',x:0,y:0,w:20,h:20}}]);
  assert.ok(result.results.every(x=>x.ok));
  assert.throws(()=>store.writeDoc(root,'drawing',{...before.doc,title:'UI'},'ui',{baseRevision:before.revision}),e=>e.status===409 && e.current.doc.pages[0].layers[0].id==='ai-layer');
  assert.equal(store.readDoc(root,'drawing').doc.pages[0].layers[0].id,'ai-layer');
});
test('existing document requires an explicit base revision',t=>{
  const root=workspace(t);store.writeDoc(root,'drawing',doc());
  assert.throws(()=>store.writeDoc(root,'drawing',doc('old client')),e=>e.status===428);
  assert.equal(store.readDoc(root,'drawing').doc.title,'base');
});
test('valid update preserves a restorable previous version',t=>{
  const root=workspace(t);store.writeDoc(root,'drawing',doc());
  const first=store.readDoc(root,'drawing');
  store.writeDoc(root,'drawing',doc('second'),'ui',{baseRevision:first.revision});
  assert.ok(store.listDocHistory(root,'drawing').some(x=>x.revision===first.revision));
  const second=store.readDoc(root,'drawing');
  store.restoreDocHistory(root,'drawing',first.revision,second.revision);
  assert.equal(store.readDoc(root,'drawing').doc.title,'base');
  assert.ok(store.listDocHistory(root,'drawing').some(x=>x.revision===second.revision));
});
test('atomic rename failure does not truncate the previous file',t=>{
  const root=workspace(t),file=join(root,'atomic.json');writeFileSync(file,'previous');
  assert.throws(()=>atomicWrite(file,'new',{rename:()=>{throw new Error('injected rename failure')}}),/injected/);
  assert.equal(readFileSync(file,'utf8'),'previous');
});
test('invalid documents are rejected before creating a file',t=>{
  const root=workspace(t);
  for(const value of [{...doc(),pages:'bad'}, {...doc(),canvas:{width:-10,height:10}}, {...doc(),canvas:{width:100000,height:100000}}]) {
    assert.throws(()=>store.writeDoc(root,'bad',value));
    assert.equal(existsSync(join(root,'design/bad.dc.json')),false);
  }
});
test('command patch cannot mutate Object.prototype',t=>{
  const root=workspace(t);store.writeDoc(root,'drawing',doc());
  const patch=JSON.parse('{"__proto__":{"designcraftPrototypePollution":"bad"}}');
  const result=executeCommands(root,[{op:'doc.update',id:'drawing',patch}]);
  assert.equal(result.results[0].ok,false);assert.equal(({}).designcraftPrototypePollution,undefined);
});
test('a sibling directory sharing the workspace name is not inside it',t=>{
  const parent=workspace(t),root=join(parent,'workspace'),sibling=join(parent,'workspace-other');
  mkdirSync(root);mkdirSync(sibling);
  writeFileSync(join(sibling,'image.png'),toPNG(createImage(2,2,[255,0,0,255])));
  const result=executeCommands(root,[{op:'asset.addFromFile',path:'../workspace-other/image.png'}]);
  assert.equal(result.results[0].ok,false);assert.match(result.results[0].error,/工作区/);
});
test('watcher async failure is handled and polling still reports changes',async t=>{
  const root=workspace(t),events=[],faults=new EventEmitter();let closed=false;
  faults.close=()=>{closed=true};
  const watcher=store.createWatcher(root,e=>events.push(e),{watchImpl:()=>faults,pollMs:10});
  t.after(()=>watcher.close());
  assert.doesNotThrow(()=>faults.emit('error',new Error('injected watch error')));
  assert.ok(closed);assert.equal(events[0].kind,'watcher-error');
  store.createDoc(root,{...doc(),id:'after-error'});
  await new Promise(r=>setTimeout(r,260));
  assert.ok(events.some(e=>e.kind==='doc'&&e.name==='after-error'));
});
