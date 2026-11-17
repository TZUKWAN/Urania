import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {resolveProjectResource} from '../host/motion/resource-path.js';
test('resource boundary rejects traversal/encoding/absolute/Windows paths and accepts real Chinese/spaced subdirectory assets',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'urania-resource-')),root=path.join(parent,'project'),assets=path.join(root,'场景','素材');fs.mkdirSync(assets,{recursive:true});const file=path.join(assets,'音乐 1.wav');fs.writeFileSync(file,'actual test fixture, path contract only');fs.writeFileSync(path.join(parent,'private.wav'),'private outside');
 try{
  assert.equal(resolveProjectResource(root,'素材/音乐%201.wav',{baseFile:'场景/index.html'}),fs.realpathSync(file));
  for(const ref of ['../private.wav','%2e%2e/private.wav','%252e%252e%252fprivate.wav','C:/private.wav','C:\\private.wav','/private.wav','\\\\host\\private.wav','file:///private.wav','http://remote/private.wav','bad%ZZ.wav','missing.wav'])assert.throws(()=>resolveProjectResource(root,ref),undefined,ref);
  const link=path.join(root,'outside');fs.symlinkSync(parent,link,process.platform==='win32'?'junction':'dir');assert.throws(()=>resolveProjectResource(root,'outside/private.wav'),/链接越出/);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
