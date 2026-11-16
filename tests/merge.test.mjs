import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeDocuments } from '../client/merge.js';
const doc=()=>({title:'base',pages:[{id:'p1',layers:[{id:'a',text:'old',x:0}]}]});
test('AI layer insertion and manual object move are both preserved',()=>{
  const base=doc(),local=doc(),remote=doc();local.pages[0].layers[0].x=20;remote.pages[0].layers.push({id:'AI',text:'new'});
  const r=mergeDocuments(base,local,remote);assert.deepEqual(r.conflicts,[]);assert.equal(r.doc.pages[0].layers[0].x,20);assert.equal(r.doc.pages[0].layers[1].id,'AI');
});
test('editing the same field raises a visible conflict',()=>{
  const base=doc(),local=doc(),remote=doc();local.title='manual';remote.title='AI';
  assert.deepEqual(mergeDocuments(base,local,remote).conflicts,['/title']);
});
test('delete versus remote edit does not silently choose deletion',()=>{
  const base=doc(),local=doc(),remote=doc();local.pages[0].layers=[];remote.pages[0].layers[0].text='AI';
  assert.deepEqual(mergeDocuments(base,local,remote).conflicts,['/pages/p1/layers/a']);
});
test('remote deletion and unchanged local object merge without resurrection',()=>{
  const base=doc(),local=doc(),remote=doc();local.title='manual';remote.pages[0].layers=[];
  const r=mergeDocuments(base,local,remote);assert.deepEqual(r.conflicts,[]);assert.deepEqual(r.doc.pages[0].layers,[]);assert.equal(r.doc.title,'manual');
});
test('independent additions from an empty object list both survive',()=>{
  const base={layers:[]},local={layers:[{id:'a',x:1}]},remote={layers:[{id:'b',x:2}]};
  assert.deepEqual(mergeDocuments(base,local,remote).doc.layers.map(x=>x.id).sort(),['a','b']);
});
