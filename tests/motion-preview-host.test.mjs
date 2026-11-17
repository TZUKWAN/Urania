// Actual HTTP, content-addressed files and revocation. Browser attacks are a separate check.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {MotionPreviewHost} from '../host/motion/preview-host.js';
import {commitRevision} from '../host/motion/project-store.js';
import {saveAsset} from '../host/motion/asset-store.js';
function cleanup(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});}

test('independent preview serves only exact-revision source, restrictive headers, range and revocation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'urania-preview-')),host=new MotionPreviewHost();
 try{
  const asset=saveAsset(root,{name:'pixel.png',bytes:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64')});
  const projectId='motion-'+randomUUID(),m=commitRevision(root,projectId,{baseRevision:null,title:'真实预览测试',entryFile:'index.html',assets:[{...asset,path:'assets/pixel.png'}],
   render:{width:1280,height:720,fps:{num:30,den:1},durationFrames:120},sources:{'index.html':'<!doctype html><html><head><style>h1{color:blue}</style></head><body><div data-composition-id="x" data-width="1280" data-height="720" data-duration="4"><h1 data-hf-id="title">中文动画</h1></div></body></html>','test.txt':'abcdef'}});
  const ticket=await host.create({root,projectId,revision:m.revision,sessionId:'session-dcdesign-test',viewEpoch:'view-a',parentOrigin:'http://127.0.0.1:34567'});
  assert.notEqual(new URL(ticket.url).hostname,'127.0.0.1');assert.match(ticket.url,/^http:\/\/127\.0\.0\.2:/);
  const shell=await fetch(ticket.url);assert.equal(shell.status,200);const markup=await shell.text();
  assert.match(markup,/sandbox="allow-scripts"/);assert.doesNotMatch(markup,/allow-same-origin/);
  assert.match(shell.headers.get('content-security-policy'),/connect-src http:\/\/127\.0\.0\.2:/);
  assert.match(shell.headers.get('content-security-policy'),/form-action 'none'/);
  assert.equal(shell.headers.get('set-cookie'),null);assert.equal(shell.headers.get('access-control-allow-origin'),'*');
  const entry=ticket.url.replace(/_shell$/,'index.html'),source=await fetch(entry);
  assert.equal(source.status,200);assert.match(await source.text(),/urania-preview-bridge/);
  assert.equal((await fetch(entry,{headers:{cookie:'dsh-private=must-never-arrive'}})).status,403);
  assert.equal((await fetch(entry,{method:'POST',body:'mutate'})).status,405);
  assert.equal((await fetch(ticket.url.replace(/_shell$/,'secret.json'))).status,404);
  assert.equal((await fetch(entry,{headers:{range:'bytes=0-9'}})).status,206);
  const image=await fetch(ticket.url.replace(/_shell$/,'assets/pixel.png'));assert.equal(image.status,200);assert.equal((await image.arrayBuffer()).byteLength,asset.bytes);
  const other=await host.create({root,projectId,revision:m.revision,sessionId:'other-session',viewEpoch:'view-b',parentOrigin:'http://127.0.0.2:34567'});
  assert.equal(new URL(other.url).hostname,'127.0.0.3');
  host.revoke('session-dcdesign-test');assert.equal((await fetch(entry)).status,410);
 }finally{await host.dispose();cleanup(root);}
});

test('preview expiry and changed-session activity fail closed',async()=>{
 const root=mkdtempSync(join(tmpdir(),'urania-preview-expire-'));let active=true;
 const host=new MotionPreviewHost({isActive:()=>active});
 try{
  const projectId='motion-'+randomUUID(),m=commitRevision(root,projectId,{baseRevision:null,title:'test',entryFile:'index.html',render:{width:1280,height:720,fps:{num:30,den:1},durationFrames:120},sources:{'index.html':'<html>test</html>'}});
  const one=await host.create({root,projectId,revision:m.revision,sessionId:'s',leaseId:'old-lease',viewEpoch:'e1',parentOrigin:'http://127.0.0.1:3000'});
  const two=await host.create({root,projectId,revision:m.revision,sessionId:'s',leaseId:'new-lease',viewEpoch:'e2',parentOrigin:'http://127.0.0.1:3000'});
  assert.equal((await fetch(one.url)).status,410);assert.equal((await fetch(two.url)).status,200);
  host.revoke('s',{leaseId:'old-lease',projectId});assert.equal((await fetch(two.url)).status,200,'late close of an old view cannot revoke the new preview');
  active=false;assert.equal((await fetch(two.url)).status,410);
 }finally{await host.dispose();cleanup(root);}
});
