import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeUiView} from '../client/store-view.js';

test('native display identity ignores only observation ordering; raw state remains current',()=>{
 const view=nativeUiView(),first={document:{uid:'9',revision:'7',contextSequence:'11',selection:['a'],layers:[]},dirty:false};
 const shown=view(first),actual={...first,document:{...first.document,contextSequence:'12',selection:['a'],layers:[]}};
 assert.equal(view(actual),shown);
 assert.equal(actual.document.contextSequence,'12');
 assert.equal(shown.document,first.document);
});
test('native selection, revision, bounds and pending interaction update the displayed state',()=>{
 const view=nativeUiView();let actual={document:{uid:'9',revision:'7',contextSequence:'1',selection:['a'],selectionBounds:{x:0},pendingInteraction:false},dirty:false};
 let shown=view(actual);
 for(const update of [{selection:['b']},{revision:'8'},{selectionBounds:{x:2}},{pendingInteraction:true}]){
  actual={...actual,document:{...actual.document,...update}};
  const next=view(actual);assert.notEqual(next,shown);assert.equal(next.document,actual.document);shown=next;
 }
});
test('native display keeps current save/error state and nested content and resets on detach',()=>{
 const view=nativeUiView(),first={document:{uid:'9',contextSequence:'1',layers:[{contextSequence:'content'}]},saving:false,error:null};
 const shown=view(first),saving=view({...first,saving:true});assert.notEqual(saving,shown);assert.equal(saving.saving,true);
 const failed=view({...first,error:'actual save failure'});assert.equal(failed.error,'actual save failure');
 const changed=view({...first,document:{...first.document,layers:[{contextSequence:'different content'}]}});assert.notEqual(changed.document,shown.document);
 assert.equal(view(undefined),undefined);assert.notEqual(view(first),shown);
});
