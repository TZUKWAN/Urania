// Real store/tool execution with explicit DSH execution/resolver fixtures.
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve,sep} from 'node:path';
import {motionToolDefinition,registerMotionTool} from '../host/motion/tool.js';
import {reserveDesignAssistantSession} from '../host/design-assistant-session.js';import {workspacePath} from '../host/safety.js';
import {readRevision,readSourceBytes} from '../host/motion/project-store.js';
test('registered tool schema, real execution session and binary-safe source patches',async()=>{
 const root=mkdtempSync(join(tmpdir(),'urania-motion-tool-'));
 try{
  const scope=reserveDesignAssistantSession({root,workspaceId:'ws',resolveWorkspace:()=>({path:root})});
  const manager={scope:(id,p)=>{assert.equal(id,scope.sessionId);return realpathSync(workspacePath(root,p||'.',{mustExist:true}));}};
  let registered;registerMotionTool({inject:(_deps,callback)=>callback({tools:{register:def=>{registered=def;return()=>{};}},effect:()=>{}})},manager);
  assert.equal(registered.name,'designcraft_motion');assert.ok(registered.parameters);assert.equal(registered.params,undefined);
  const tool=motionToolDefinition(manager),execution={agent:{session:{id:scope.sessionId,header:{cwd:root}}},callId:'tool-check'};
  const call=async(args,actor=execution)=>JSON.parse((await tool.execute(args,actor)).json);
  assert.equal((await call({action:'templates'},{agent:{session:{id:'ordinary-chat',header:{cwd:root}}}})).ok,false);
  assert.equal((await call({action:'templates'},{agent:{session:scope.sessionId}})).ok,false);
  const templates=await call({action:'templates'});assert.ok(templates.templates.length>=6);
  const created=await call({action:'create_from_template',templateId:'frame-product-promo-30s',operationKey:'tool-create'});assert.equal(created.ok,true);
  const before=readRevision(root,created.projectId,created.revision),binary=Object.keys(before.sources).find(p=>p.endsWith('.woff2'));
  const original=readSourceBytes(root,created.projectId,before,binary);
  const source=await call({action:'read_source',projectId:created.projectId,file:'index.html',length:100});assert.equal(source.ok,true,JSON.stringify(source));assert.equal(source.content.length,100);assert.equal(source.truncated,true);
  const saved=await call({action:'write_sources',projectId:created.projectId,baseRevision:created.revision,leaseId:created.leaseId,viewEpoch:created.viewEpoch,operationKey:'tool-write',sources:{'note.txt':'真实修改'}});assert.equal(saved.sourcePersisted,true);
  const after=readRevision(root,created.projectId,saved.revision);assert.deepEqual(readSourceBytes(root,created.projectId,after,binary),original);
  assert.equal((await call({action:'write_sources',projectId:created.projectId,baseRevision:created.revision,leaseId:created.leaseId,viewEpoch:created.viewEpoch,operationKey:'tool-write-late',sources:{'note.txt':'stale'}})).ok,false);
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});}
});
