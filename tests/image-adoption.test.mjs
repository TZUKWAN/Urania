import test from 'node:test';
import assert from 'node:assert/strict';
import {imageBaselineMatches} from '../client/image-adoption.js';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';

test('image candidate can be reused only when its complete saved source bytes match the original',()=>{
 const job={id:'image-one',studio:{source:{sourceId:'source',sourceRevision:'original',sourceHash:'original-hash'}}};
 const base={id:'source',revision:'original',sourceHash:'original-hash'};
 const reverted={...base,revision:'undo',operation:{action:'image-revert',imageJobId:job.id,restoreRevision:'original',sourceHash:'original-hash'}};
 assert.equal(imageBaselineMatches(base,job),true);
 assert.equal(imageBaselineMatches(reverted,job),true);
 assert.equal(imageBaselineMatches({...reverted,sourceHash:'changed'},job),false);
 assert.equal(imageBaselineMatches({...reverted,operation:{...reverted.operation,imageJobId:'other-job'}},job),true);
 assert.equal(imageBaselineMatches({...base,revision:'reopened-unchanged'},job),true);
 assert.equal(imageBaselineMatches({...base,revision:'manual-edit',sourceHash:'edited-hash'},job),false);
 assert.equal(imageBaselineMatches({...base,id:'other-source'},job),false);
});

test('real Photo source history retains original baseline identity in repeated-adoption receipts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'image-adopt-receipt-')),store=new NativeSourceStore(root),bytes=await readFile(new URL('./fixtures/instance-old.pcraft',import.meta.url));
 const input={engine:'photocraft',title:'Photo source',bytes,engineState:{uid:1,revision:1,nativeDocumentId:1},actor:'manual'};
 const initial=await store.commit('source',input),sameBytes=await store.commit('source',{...input,baseRevision:initial.revision});
 const op={action:'image-adopt',id:randomUUID(),imageJobId:'image-'+randomUUID(),candidateId:'candidate-'+randomUUID(),sourceHash:'a'.repeat(64),baseRevision:sameBytes.revision,originalRevision:initial.revision};
 const adopted=await store.commit('source',{...input,baseRevision:sameBytes.revision,operation:op});
 assert.equal((await store.read('source',adopted.revision)).meta.operation.originalRevision,initial.revision);
 await assert.rejects(store.commit('source',{...input,baseRevision:adopted.revision,operation:{...op,baseRevision:adopted.revision,originalRevision:'invalid'}}),/回执无效/);
 assert.equal((await store.head('source')).revision,adopted.revision);
});
