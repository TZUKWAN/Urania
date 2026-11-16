import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {openNativeSession,nativeSessionPoolStatus} from '../host/native.js';
import {WorkspaceNative} from '../host/workspace-native.js';
import * as store from '../host/docstore.js';
import {createImage,toPNG} from '../host/raster.js';
test('actual helper and editing sessions share two slots; queued cancellation does not start an engine',async()=>{
 const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||'tests/.work');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'native-pool-'));let first,second,third;
 try{
  [first,second]=await Promise.all([openNativeSession('photocraft',root),openNativeSession('vectorcraft',root)]);assert.equal(nativeSessionPoolStatus().active,2);
  const controller=new AbortController(),cancelled=openNativeSession('deckcraft',root,{signal:controller.signal});assert.equal(nativeSessionPoolStatus().queued,1);controller.abort();await assert.rejects(cancelled,/取消/);assert.equal(nativeSessionPoolStatus().queued,0);
  store.saveAsset(root,'pixel.png',toPNG(createImage(1,1,[255,0,0,255])));store.createDoc(root,{id:'queued',canvas:{width:100,height:100},pages:[{id:'p',layers:[{id:'image',type:'image',x:0,y:0,w:1,h:1,asset:'pixel.png'}]}]});
  const adapter=new WorkspaceNative(),pending=adapter.run({root,id:'queued',pageId:'p',layerId:'image',operation:'native.inspect',baseRevision:store.readDoc(root,'queued').revision});const record=adapter.list(root)[0];assert.equal(record.status,'queued');assert.equal(adapter.cancel(record.id),true);await assert.rejects(pending,/取消/);adapter.dispose();assert.equal(nativeSessionPoolStatus().queued,0);
  const waiting=openNativeSession('deckcraft',root);assert.equal(nativeSessionPoolStatus().queued,1);await first.close();first=null;third=await waiting;assert.equal(third.identity.name,'deckcraft');assert.equal(nativeSessionPoolStatus().active,2);
 }finally{await Promise.all([first?.close(),second?.close(),third?.close()]);}
 assert.deepEqual(nativeSessionPoolStatus(),{active:0,queued:0,limit:2});
});
