// Contract fixtures are not real SDK/model acceptance. Host tests use actual files.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {reserveDesignAssistantSession} from '../host/design-assistant-session.js';
import {DesignAssistantSession,selectedDesignProject} from '../client/design-session.js';
const ID='session-dcdesign-01234567-0123-4123-8123-0123456789ab';
test('host atomically reserves one durable dedicated identity without any transcript',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dc-session-'));try{
  const request={root,workspaceId:'workspace-a',resolveWorkspace:id=>id==='workspace-a'?{path:root}:null};
  const all=await Promise.all(Array.from({length:6},()=>Promise.resolve().then(()=>reserveDesignAssistantSession(request))));
  assert.ok(all.every(row=>row.sessionId===all[0].sessionId));assert.match(all[0].sessionId,/^session-dcdesign-/);assert.equal(all[0].purpose,'designcraft-ai-assistant');
  const bytes=await readFile(join(root,'design/.designcraft/assistant-sessions',(await readdir(join(root,'design/.designcraft/assistant-sessions')))[0]),'utf8');assert.ok(!bytes.includes('messages'));
  const second=reserveDesignAssistantSession({...request,workspaceId:'workspace-b',resolveWorkspace:()=>({path:root})});assert.notEqual(second.sessionId,all[0].sessionId);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('host refuses foreign workspace directory before creating metadata',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dc-session-'));try{
  assert.throws(()=>reserveDesignAssistantSession({root,workspaceId:'w',resolveWorkspace:()=>null}),e=>e.status===403);
  assert.throws(()=>reserveDesignAssistantSession({root,workspaceId:'w',resolveWorkspace:()=>({path:tmpdir()})}),e=>e.status===403);assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('host preserves and rejects a corrupted or ordinary-session registry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'dc-session-'));try{
  const req={root,workspaceId:'w',resolveWorkspace:()=>({path:root})};reserveDesignAssistantSession(req);const directory=join(root,'design/.designcraft/assistant-sessions'),file=join(directory,(await readdir(directory))[0]);
  const bad=JSON.stringify({schema:1,purpose:'designcraft-ai-assistant',workspaceId:'w',root,sessionId:'session-an-ordinary-chat'});await writeFile(file,bad);assert.throws(()=>reserveDesignAssistantSession(req),e=>e.status===422);assert.equal(await readFile(file,'utf8'),bad);
 }finally{await rm(root,{recursive:true,force:true});}
});
function observable(value){const listeners=new Set();return {getSnapshot:()=>value,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},set(next){value=next;for(const fn of listeners)fn();}};}
function fixture({persisted=false,createResult=ID,reserve}={}){
 const current=observable({key:'ordinary-a'}),list=observable({phase:'ready',byId:{'ordinary-a':{cwd:'C:/owned',blank:true},'ordinary-b':{cwd:'C:/owned',blank:false}}}),groups=observable({phase:'ready',items:[{workspaceId:'w',path:'C:/owned',title:'Owned',sessionIds:['ordinary-a','ordinary-b',...(persisted?[ID]:[])]}]}),owners=new Map(),calls=[],releases=[];
 if(persisted)list.getSnapshot().byId[ID]={cwd:'C:/owned',blank:false};
 const services={uiSession:{adapter:{current,bindingSource:ref=>observable({key:ref.sessionId})}},uiWorkspace:{workspaces:{list:groups}},sessions:{list,binding:id=>owners.get(id),async create(options){calls.push(options);list.getSnapshot().byId[createResult]={cwd:'C:/owned'};groups.getSnapshot().items[0].sessionIds.push(createResult);return createResult;},retain(id){const owner={session:{sessionId:id,rename:async title=>calls.push({rename:title})}};owners.set(id,owner);return {sessionId:id,binding:owner,ready:Promise.resolve(owner),release(){releases.push(id);owners.delete(id)}};}}};
 const manager=new DesignAssistantSession({getServices:()=>services,reserve:reserve||(async()=>({workspaceId:'w',root:'C:/owned',sessionId:ID}))});services.designAssistant=manager;
 return {manager,services,current,list,groups,calls,releases};
}
const settled=async()=>{for(let n=0;n<8;n++)await new Promise(resolve=>setImmediate(resolve));};
test('project selection uses catalog membership and normalized Windows paths',()=>{const f=fixture();f.list.getSnapshot().byId['ordinary-a'].cwd='C:\\owned';assert.equal(selectedDesignProject(f.services)?.workspaceId,'w');f.groups.getSnapshot().items[0].sessionIds=[];assert.equal(selectedDesignProject(f.services),null);});
test('dedicated create never reuses the ordinary blank or changes global selection',async()=>{const f=fixture(),stop=f.manager.start();await settled();assert.equal(f.manager.state.phase,'ready');assert.deepEqual(f.calls[0],{workspaceId:'w',sessionId:ID});assert.equal(f.current.getSnapshot().key,'ordinary-a');assert.equal(f.manager.scope().sessionId,ID);stop();f.manager.dispose();});
test('switching ordinary conversations in the same project preserves design identity',async()=>{const f=fixture(),stop=f.manager.start();await settled();f.current.set({key:'ordinary-b'});await settled();assert.equal(f.manager.scope().sessionId,ID);assert.equal(f.calls.filter(c=>c.sessionId).length,1);stop();f.manager.dispose();});
test('persisted nonblank design session is retained without create or rename',async()=>{const f=fixture({persisted:true}),stop=f.manager.start();await settled();assert.equal(f.manager.scope().sessionId,ID);assert.deepEqual(f.calls,[]);stop();f.manager.dispose();});
test('failed dedicated creation never displays or adopts an alternate ordinary session',async()=>{const f=fixture({createResult:'session-alternate'}),stop=f.manager.start();await settled();assert.equal(f.manager.state.phase,'error');assert.equal(f.manager.scope(),null);assert.equal(f.manager.state.reference,null);assert.equal(f.current.getSnapshot().key,'ordinary-a');stop();f.manager.dispose();});
test('late reservation after project removal is discarded without creating a session',async()=>{let answer;const wait=new Promise(resolve=>answer=resolve),f=fixture({reserve:()=>wait}),stop=f.manager.start();f.current.set({key:undefined});answer({workspaceId:'w',root:'C:/owned',sessionId:ID});await settled();assert.equal(f.manager.scope(),null);assert.deepEqual(f.calls,[]);stop();f.manager.dispose();});
test('stale project is rejected synchronously and disposal releases the owned reference',async()=>{const f=fixture(),stop=f.manager.start();await settled();const reference=f.manager.state.reference;Object.defineProperty(reference,'binding',{get(){throw new Error('released SDK reference');}});assert.equal(f.manager.scope(),null);f.groups.getSnapshot().items=[];assert.equal(f.manager.scope(),null);stop();f.manager.dispose();assert.equal(f.manager.scope(),null);assert.ok(f.releases.includes(ID));});
