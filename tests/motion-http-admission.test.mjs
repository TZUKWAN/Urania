// Real HTTP/files with a named admission fixture. Not a claim of actual DSH authentication.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtempSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {motionRoutes} from '../host/motion/routes.js';
import {MotionPreviewHost} from '../host/motion/preview-host.js';
import {reserveDesignAssistantSession} from '../host/design-assistant-session.js';
import {requireDesignScope} from '../host/design-scope.js';
import {workspacePath} from '../host/safety.js';

test('motion routes use admission, reserved project identity and a separate preview',async()=>{
 const root=mkdtempSync(join(tmpdir(),'urania-motion-http-')),previewHost=new MotionPreviewHost();let origin;
 const identity=reserveDesignAssistantSession({root,workspaceId:'owned-test',resolveWorkspace:()=>({path:root})});
 const manager={scope:id=>{if(id!==identity.sessionId)throw new Error('unknown session');return realpathSync(root);}};
 manager.scope=(id,requested)=>{if(id!==identity.sessionId)throw new Error('unknown session');return realpathSync(workspacePath(root,requested||'.',{mustExist:true}));};
 const guard=handler=>async(req,res)=>{
  if(req.headers['x-owned-admission-fixture']!=='yes'){res.writeHead(401);res.end();return;}
  if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403);res.end();return;}
  try{await handler(req,res);}catch{res.writeHead(400);res.end();}
 };
 const [route]=motionRoutes({previewHost},{guard,resolveHttpScope:(_req,body,url)=>{
  const sessionId=body.sessionId||url.searchParams.get('sessionId');return{sessionId,root:requireDesignScope(manager,sessionId,body.root||url.searchParams.get('root'))};
 }});
 const server=http.createServer(route.handler);
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
  const post=(action,body,headers={})=>fetch(origin+'/designcraft/api/v1/motion/'+action,{method:'POST',headers:{'content-type':'application/json','x-owned-admission-fixture':'yes',...headers},body:JSON.stringify({root,sessionId:identity.sessionId,...body})});
  assert.equal((await post('create',{}, {'x-owned-admission-fixture':'no'})).status,401);
  assert.equal((await post('create',{}, {origin:'https://untrusted.invalid'})).status,403);
  assert.equal((await post('create',{sessionId:'host'})).status,403);
  const response=await post('create',{title:'HTTP真实源',operationKey:'http-create',render:{width:1280,height:720,fps:{num:30,den:1},durationFrames:120}});
  assert.equal(response.status,200);const saved=await response.json();assert.equal(saved.sessionId,identity.sessionId);
  const selected=await post('preview_session',{projectId:saved.projectId,revision:saved.revision,leaseId:saved.leaseId,viewEpoch:saved.viewEpoch});
  assert.equal(selected.status,200);const ticket=await selected.json();assert.notEqual(new URL(ticket.url).hostname,'127.0.0.1');
  assert.equal((await fetch(ticket.url)).status,200);
  const old=await fetch(origin+'/designcraft/api/v1/motion/preview/index.html?root='+encodeURIComponent(root)+'&sessionId='+identity.sessionId,{headers:{'x-owned-admission-fixture':'yes'}});
  assert.equal(old.status,410);assert.match(await old.text(),/E_PREVIEW_ORIGIN/);
  const closed=await post('close_lease',{projectId:saved.projectId});assert.equal(closed.status,200);assert.equal((await fetch(ticket.url)).status,410);
 }finally{await previewHost.dispose();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});}
});

test('an unconfigured motion HTTP registry fails closed',async()=>{
 const [route]=motionRoutes({}),server=http.createServer(route.handler);
 try{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));assert.equal((await fetch('http://127.0.0.1:'+server.address().port+'/designcraft/api/v1/motion/projects')).status,503);}
 finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
});
