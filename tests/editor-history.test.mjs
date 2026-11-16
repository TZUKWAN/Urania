// These are policy-input tests, not evidence of native execution or an AI call.
// The live DSH/native browser checks are recorded separately.
import test from 'node:test';
import assert from 'node:assert/strict';
import {checkHostedCommand,singleUndoProof} from '../host/editor-policy.js';

test('AI history control and document lifecycle cannot bypass the live boundary through a batch',()=>{
 for(const command of ['edit.undo','edit.redo','edit.clearHistory','edit.undoGroup.begin','edit.undoGroup.end','file.new','document.close','action.batch']){
  assert.throws(()=>checkHostedCommand(command,{}),error=>error.status===422,command);
  assert.throws(()=>checkHostedCommand('command.batch',{commands:[{command,params:{}}]}),error=>error.status===422,command);
 }
 assert.throws(()=>checkHostedCommand('command.batch',{commands:[{command:'command.batch',params:{commands:[{command:'paint.setFill',params:{}}]}}]}),error=>error.status===422);
 assert.doesNotThrow(()=>checkHostedCommand('command.batch',{commands:[{command:'paint.setFill',params:{id:2,color:'#a855f7'}},{command:'object.move',params:{ids:[2],dx:1,dy:0}}]}));
});

test('undo proof requires exactly one native history entry and its exact saved revision',()=>{
 const before={uid:3,revision:7,history:['Import']},after={uid:3,revision:8,history:['Import','Set Fill']};
 assert.deepEqual(singleUndoProof(before,after,8),{uid:3,revision:8,label:'Set Fill',beforeCount:1,afterCount:2});
 assert.equal(singleUndoProof(before,after,9),null,'a manual edit included in the later checkpoint is not owned by this step');
 assert.equal(singleUndoProof(before,{...after,uid:4},8),null,'another document cannot own this history');
 assert.equal(singleUndoProof(before,{...after,history:['Other','Set Fill']},8),null,'a changed history prefix is not a proven new step');
 assert.equal(singleUndoProof(before,{...after,history:['Import','Set Fill','Move']},8),null,'multiple steps cannot be guessed as one');
 assert.equal(singleUndoProof(before,{...after,history:['Import']},8),null,'a command without a new undo step cannot own the previous manual step');
});

test('sliced history and non-edit replies have no automatic undo ownership',()=>{
 const before={uid:1,revision:22,history:Array.from({length:20},(_,i)=>'Step '+i)};
 assert.equal(singleUndoProof(before,{...before,revision:23,history:[...before.history.slice(1),'New Step']},23),null);
 assert.equal(singleUndoProof({uid:1,revision:2,history:[]},{uid:1,revision:2,history:[]},2),null);
 assert.equal(singleUndoProof(null,null,0),null);
});

test('uint64 native history revisions and identity are proved without numeric conversion',()=>{
 const before={uid:'18446744073709551614',revision:'9007199254740993',history:['Import']};
 const after={uid:'18446744073709551614',revision:'9007199254740994',history:['Import','Set Fill']};
 assert.equal(singleUndoProof(before,after,'9007199254740994').revision,'9007199254740994');
 assert.equal(singleUndoProof(before,{...after,uid:'18446744073709551615'},after.revision),null);
 assert.equal(singleUndoProof(before,{...after,revision:'9007199254740992'},'9007199254740992'),null);
 assert.equal(singleUndoProof(before,{...after,revision:Number(after.revision)},after.revision),null);
});
