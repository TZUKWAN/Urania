// Uses previously captured real native Deck/PPTX bytes; new export/UI verification is separate.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';import {join,resolve,sep} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID,createHash} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';import {inspectPptx,recordPptxExport,readPptxReceipt} from '../host/export-receipt.js';
test('actual PPTX package inspection, fixed source/asset fingerprints, idempotence and tamper refusal',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'urania-export-'))),store=new NativeSourceStore(root);
 try{
  const source=readFileSync(new URL('./fixtures/deck-svg/after.deckcraft',import.meta.url)),bytes=readFileSync(new URL('./fixtures/deck-svg/after.pptx',import.meta.url));
  const check=inspectPptx(bytes);assert.ok(check.slideCount>=1);assert.equal(check.editableTextRuns,0,'this historical vector-shape fixture has no text; do not invent editable text');
  assert.ok(inspectPptx(readFileSync(new URL('./fixtures/f5-native-conversion/converted-text.pptx',import.meta.url))).editableTextRuns>=1);
  const saved=await store.commit('deck-export',{engine:'deckcraft',title:'真实格式导出回执验收',bytes:source,engineState:{uid:1,revision:1},actor:'import'});
  const view={root,id:'view',sessionId:'session',sourceId:'deck-export',sourceRevision:saved.revision,epoch:'epoch'},manager={store:()=>store,active:new Map([['session','view']])};
  const request={operationId:'export-'+randomUUID(),sourceId:view.sourceId,revision:saved.revision,epoch:view.epoch,bytes,warnings:['实际测试告警']},receipt=await recordPptxExport(manager,view,request);
  assert.equal(receipt.artifact.sha256,createHash('sha256').update(bytes).digest('hex'));assert.equal(receipt.source.sha256,saved.meta.sourceHash);assert.equal(receipt.renderReview.performed,false);assert.equal(receipt.source.pageOrder.length,check.slideCount);
  assert.deepEqual(await recordPptxExport(manager,view,request),receipt);assert.deepEqual(readPptxReceipt(root,request.operationId),receipt);
  await assert.rejects(()=>recordPptxExport(manager,view,{...request,revision:'f'.repeat(64)}),/作品已切换/);
  writeFileSync(join(root,receipt.artifact.file),Buffer.from('tampered'));assert.throws(()=>readPptxReceipt(root,request.operationId),/摘要不一致/);
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});}
});
