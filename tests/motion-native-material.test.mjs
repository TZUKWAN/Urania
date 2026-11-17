// Actual serializer fixture / persisted graph / package bytes. Live engine and AI checks are separate.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID,createHash} from 'node:crypto';
import {NativeSourceStore} from '../host/native-source-store.js';import {ProjectGraph} from '../host/project-graph.js';
import {importNativeAsset} from '../host/motion/native-import.js';import {fileURLToPath} from 'node:url';
import {motionHandleAction} from '../host/motion/routes.js';import {commitRevision,readRevision,readRevisionSources,readSourceBytes,listProjects} from '../host/motion/project-store.js';
import {exportDcmotion,importDcmotion,readZip,buildZip} from '../host/motion/package.js';import {readAssetBytes,saveAsset} from '../host/motion/asset-store.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'),hash=b=>createHash('sha256').update(b).digest('hex');

test('legacy explicit-output import refuses an existing file outside the workspace',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'urania-import-boundary-')));
 try { assert.throws(()=>importNativeAsset(root,fileURLToPath(new URL('./fixtures/vector-web.vectorcraft',import.meta.url)),'vector','source','rev'),/越界|工作区|outside|workspace|允许/); }
 finally { rmSync(root,{recursive:true,force:true}); }
});

test('native immutable materials retain origin, text encodings and aliased media across editable package roundtrip',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'urania-motion-material-'))),store=new NativeSourceStore(root),graph=new ProjectGraph(root,store),url=new URL('http://unit.invalid/?root='+encodeURIComponent(root)),services={execution:{agent:{session:'unit-contract-no-LLM'}}};
 try{
  const original=await store.commit('source',{engine:'vectorcraft',title:'real serializer',bytes:readFileSync(new URL('./fixtures/vector-web.vectorcraft',import.meta.url)),engineState:{uid:1,revision:1},actor:'import'});
  const first=await motionHandleAction('create','POST',{title:'Material contract',render:{fps:{num:24,den:1},durationFrames:24,width:320,height:180},operationKey:'create-material'},url,services),projectId=first.projectId;
  const originalText=readRevisionSources(root,projectId,readRevision(root,projectId,first.revision))['composition.html'];let revision=first.revision;
  for(let i=0;i<2;i++){
   const current=await graph.read(),material=await graph.addDerivative({operationId:randomUUID(),baseRevision:current.revision,sourceId:'source',sourceRevision:original.revision,sourceHash:original.meta.sourceHash,engineState:original.meta.engineState,format:'png',bytes:png,title:'真实字节素材 '+i});
   const opened=await motionHandleAction('open','POST',{projectId},url,services),result=await motionHandleAction('import_native','POST',{projectId,baseRevision:opened.revision,leaseId:opened.leaseId,viewEpoch:opened.viewEpoch,assetId:material.asset.id,operationKey:'import-native-'+i},url,services);
   assert.equal(result.asset.sha256,hash(png));assert.equal(result.asset.nativeSource.sourceHash,original.meta.sourceHash);assert.equal(result.asset.nativeSource.revision,original.revision);assert.equal(result.asset.nativeSource.projectAssetId,material.asset.id);revision=result.revision;
  }
  const manifest=readRevision(root,projectId,revision);assert.equal(manifest.sources['composition.html'].encoding,'utf8');assert.equal(readRevisionSources(root,projectId,manifest)['composition.html'],originalText);assert.equal(manifest.assets.length,2);assert.equal((await store.head('source')).revision,original.revision);
  const opened=await motionHandleAction('open','POST',{projectId},url,services),edited=await motionHandleAction('write_sources','POST',{projectId,baseRevision:opened.revision,leaseId:opened.leaseId,viewEpoch:opened.viewEpoch,operationKey:'add-css',sources:{'unchanged.css':'body{color:red}'}},url,services);assert.equal(readRevision(root,projectId,edited.revision).sources['composition.html'].encoding,'utf8');
  const exported=exportDcmotion(root,projectId),imported=importDcmotion(root,exported.buffer),restored=readRevision(root,imported.projectId,imported.revision);assert.equal(restored.assets.length,2);assert.deepEqual(restored.assets.map(a=>a.nativeSource),manifest.assets.map(a=>a.nativeSource));assert.ok(readAssetBytes(root,restored.assets[0].sha256).bytes.equals(png));assert.equal(readRevisionSources(root,imported.projectId,restored)['composition.html'],originalText);
  const entries=readZip(exported.buffer);entries.find(e=>e.name==='sources/composition.html').data=Buffer.from('tampered');const count=listProjects(root).length;assert.throws(()=>importDcmotion(root,buildZip(entries)),/source missing or hash mismatch/);assert.equal(listProjects(root).length,count,'invalid package cannot publish a project');
 }finally{assert.ok(root.startsWith(realpathSync(tmpdir())));rmSync(root,{recursive:true,force:true});}
});

test('binary source bytes survive package export and import, and asset paths/hashes reject traversal before publication',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'urania-motion-binary-')));
 try{
  const id='motion-'+randomUUID(),binary=Buffer.from([0,255,1,128,48,13,10]),render={fps:{num:24,den:1},durationFrames:24,width:320,height:180};
  // Exercise the real store with a byte source; this is not a claimed renderable media file.
   const m=commitRevision(root,id,{baseRevision:null,title:'Binary contract',entryFile:'index.html',render,sources:{'index.html':'<html></html>','bytes.dat':binary}}),pkg=exportDcmotion(root,id),restored=importDcmotion(root,pkg.buffer),manifest=readRevision(root,restored.projectId,restored.revision);assert.ok(readSourceBytes(root,restored.projectId,manifest,'bytes.dat').equals(binary));assert.equal(manifest.sources['bytes.dat'].encoding,'binary');
   for(const sha of ['../outside','A'.repeat(64),''])assert.throws(()=>readAssetBytes(root,sha),/exact 64-hex/);
   for(const name of ['../outside.png','CON.png','bad\nname.png'])assert.throws(()=>saveAsset(root,{name,bytes:png}));
   assert.throws(()=>commitRevision(root,'motion-'+randomUUID(),{baseRevision:null,title:'Invalid asset',entryFile:'index.html',render,sources:{'index.html':'x'},assets:[{sha256:'../outside',name:'x.png'}]}),/asset sha256/);
 }finally{assert.ok(root.startsWith(realpathSync(tmpdir())));rmSync(root,{recursive:true,force:true});}
});
