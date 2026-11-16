import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';
import {auditSavedNativeColors} from '../host/native-color-source.js';
for(const [engine,file]of [['vectorcraft','vector-web.vectorcraft'],['photocraft','vector-image-original.pcraft'],['deckcraft','deck-web.deckcraft']])test('full saved '+engine+' structure is inspected instead of the live summary',async t=>{
 const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||'tests/.work');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'native-colors-'));t.after(()=>{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
 const bytes=readFileSync(new URL('./fixtures/'+file,import.meta.url)),store=new NativeSourceStore(root),saved=await store.commit('actual-source',{engine,title:'真实序列化源结构验收',bytes,engineState:{uid:1,revision:1,...(engine==='photocraft'?{nativeDocumentId:1}:{})},actor:'import'});
 // A minimal checkpoint envelope exercises decoder admission. No live App result is simulated.
 const view={root,sourceId:'actual-source',sourceRevision:saved.revision,epoch:'owned-source-inspection',engine,savedEngineRevision:1,document:{revision:1,text:'SUMMARY_MUST_NOT_BE_AUDITED'}};
 const result=await auditSavedNativeColors(view,{background:'#ffffff'});assert.equal(result.source.fullSavedModel,true);assert.equal(result.source.liveSummaryUsed,false);assert.equal(result.source.nativeSourceSha256,createHash('sha256').update(bytes).digest('hex'));assert.ok(result.coverage.nodesVisited>10);assert.ok(!JSON.stringify(result).includes('SUMMARY_MUST_NOT_BE_AUDITED'));assert.equal(result.conformanceCertified,false);
 view.document.revision=2;await assert.rejects(auditSavedNativeColors(view),e=>e.status===409);assert.ok((await store.read('actual-source')).bytes.equals(bytes));
});
