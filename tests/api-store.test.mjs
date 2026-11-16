import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {realDshHost} from './fixtures/real-dsh-host.mjs';

test('HTTP writes enforce revision and recovery keeps both versions',async t=>{
  const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT || fileURLToPath(new URL('./.work/',import.meta.url)));
  mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'api-'));
  const server=await realDshHost(root);
  t.after(async()=>{
    await server.close();
    assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});
  });
  const url='/designcraft/api/v1';
  const post=async(path,body)=>{const r=await server.ownerFetch(url+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({root,...body})});return {status:r.status,body:await r.json()};};
  const get=async(path)=>{const r=await server.ownerFetch(url+path);assert.equal(r.status,200);return r.json()};
  assert.equal((await fetch(server.origin+url+'/doc?root='+encodeURIComponent(root)+'&id=drawing')).status,401,'unauthenticated I/O is rejected');
  assert.equal((await server.ownerFetch(url+'/doc?root='+encodeURIComponent(root)+'&id=drawing',{headers:{origin:'https://untrusted.example'}})).status,403,'signed cookie does not bypass origin admission');
  const doc={id:'drawing',title:'first',canvas:{width:32,height:32},pages:[{id:'p1',layers:[]}],assets:[]};
  const first=await post('/doc/create',{doc});assert.equal(first.status,200);
  const initial=await get('/doc?root='+encodeURIComponent(root)+'&id=drawing');
  const second=await post('/doc',{id:'drawing',doc:{...initial.doc,title:'second'},baseRevision:initial.revision});
  assert.equal(second.status,200);
  const stale=await post('/doc',{id:'drawing',doc:initial.doc,baseRevision:initial.revision});
  assert.equal(stale.status,409);assert.equal(stale.body.current.doc.title,'second');
  const unversioned=await post('/doc',{id:'drawing',doc:initial.doc});assert.equal(unversioned.status,428);
  const oldDelete=await post('/doc/delete',{id:'drawing',baseRevision:initial.revision});assert.equal(oldDelete.status,409);
  const history=await get('/history?root='+encodeURIComponent(root)+'&id=drawing');
  assert.ok(history.history.some(x=>x.revision===initial.revision));
  const restored=await post('/history/restore',{id:'drawing',revision:initial.revision,baseRevision:second.body.revision});assert.equal(restored.status,200);
  const actual=await get('/doc?root='+encodeURIComponent(root)+'&id=drawing');assert.equal(actual.doc.title,'first');
});

test('motion routes serve over the real host (prefix without trailing slash reaches the webserver)',async t=>{
  const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT || fileURLToPath(new URL('./.work/',import.meta.url)));
  mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'motion-http-'));
  const server=await realDshHost(root);
  t.after(async()=>{await server.close();rmSync(root,{recursive:true,force:true});});
  const mb=server.origin+'/designcraft/api/v1/motion/';
  const post=async(path,body)=>{const r=await server.ownerFetch(mb+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({root,...body})});return {status:r.status,body:await r.json().catch(()=>({}))};};
  const RENDER={fps:{num:30,den:1},durationFrames:120,width:1280,height:720};
  // 回归锚点：前缀路由带尾斜杠时，DSH webserver 的 startsWith(prefix+'/') 永不命中，
  // 请求落到 fallback，GET 得 SPA HTML、POST 得 405 空 body。这里要求全部命中我们的 JSON API。
  const list=await server.ownerFetch(mb+'projects?root='+encodeURIComponent(root));
  assert.equal(list.status,200,'GET projects must reach motion routes');
  const listBody=await list.json();assert.equal(listBody.ok,true);
  const created=await post('create',{title:'HTTP-M',operationKey:'mhttp-1',render:RENDER});
  assert.equal(created.status,200,'POST create must reach motion routes');
  assert.ok(created.body.projectId.startsWith('motion-'));
  assert.ok(created.body.dataBase64===undefined);
  const opened=await post('open',{projectId:created.body.projectId});
  assert.equal(opened.status,200);assert.ok(opened.body.leaseId);
  const preview=await server.ownerFetch(mb+'preview?root='+encodeURIComponent(root)+'&projectId='+created.body.projectId+'&revision='+created.body.revision+'&file=composition.html');
  assert.equal(preview.status,200);
  const html=await preview.text();
  assert.match(html,/data-composition-id="dc"/);
  assert.ok(html.includes('__hfSeek')&&html.includes('__hfPlay')&&html.includes('__hfPause'),'template ships the frame-clock runtime');
  const store=await post('write_sources',{projectId:created.body.projectId,baseRevision:created.body.revision,leaseId:opened.body.leaseId,viewEpoch:opened.body.viewEpoch,operationKey:'mhttp-2',sources:{'composition.html':'<!doctype html><html><body><div data-composition-id="dc" data-duration="1" data-width="64" data-height="64"></div></body></html>'}});
  assert.equal(store.status,200);assert.equal(store.body.sourcePersisted,true);
});
