import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {JobSupervisor} from '../host/jobs.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});
const doc={id:'drawing',title:'job',canvas:{width:32,height:32},pages:[{id:'p1',layers:[]}],assets:[]};
function setup(t,options={}) {const root=mkdtempSync(join(base,'jobs-')),jobs=new JobSupervisor(options);t.after(()=>{jobs.dispose();assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});return {root,jobs};}
test('actual worker writes and reads a versioned document',async t=>{const {root,jobs}=setup(t);const r=await jobs.run('commands',{root,commands:[{op:'doc.create',doc}],options:{requireRevision:true}});assert.equal(r.results[0].ok,true);const d=await jobs.run('read-doc',{root,id:'drawing'});assert.equal(d.doc.title,'job');assert.equal(jobs.list(root)[0].status,'completed');});
test('worker failure is localized and the next job still runs',async t=>{const {root,jobs}=setup(t);await assert.rejects(jobs.run('not-a-kind',{root}),/Unknown/);const next=await jobs.run('state',{root});assert.deepEqual(next.docs,[]);});
test('worker transport retains Chinese and emoji across pipe chunk boundaries',async t=>{const {root,jobs}=setup(t);const text='中文😀'.repeat(18000);await jobs.run('commands',{root,commands:[{op:'doc.create',doc:{...doc,title:text}}],options:{requireRevision:true}});assert.equal((await jobs.run('read-doc',{root,id:doc.id})).doc.title,text);});
test('a blocked child times out while the parent stays responsive',async t=>{
 const events=[],workerPath=fileURLToPath(new URL('./fixtures/blocked-worker.mjs',import.meta.url));let entered;const ready=new Promise(r=>entered=r);const {root,jobs}=setup(t,{workerPath,concurrency:1,timeoutMs:2500,onChange:e=>{events.push(e);if(e.progress?.entered)entered();}});
 const pending=jobs.run('commands',{root,commands:[]}).catch(e=>e);
 await Promise.race([ready,pending.then(()=>{throw new Error('worker did not enter blocked computation');})]);
 const start=Date.now();await new Promise(r=>setTimeout(r,25));assert.ok(Date.now()-start<250);
 const error=await pending;assert.equal(error.status,504);assert.ok(events.some(e=>e.progress?.entered));assert.equal(jobs.active.size,0);
});
test('queued cancellation does not start a second child',async t=>{
 const workerPath=fileURLToPath(new URL('./fixtures/blocked-worker.mjs',import.meta.url));const {root,jobs}=setup(t,{workerPath,concurrency:1,timeoutMs:1000});
 const first=jobs.run('commands',{root,commands:[]}).catch(e=>e),second=jobs.run('commands',{root,commands:[]}).catch(e=>e);
 const queued=jobs.list(root).find(j=>j.status==='queued');assert.ok(queued);assert.equal(jobs.cancel(queued.id),true);assert.equal((await second).status,499);
 const running=jobs.list(root).find(j=>j.status==='running');assert.equal(jobs.cancel(running.id),true);assert.equal((await first).status,499);assert.equal(jobs.active.size,0);
});
test('combined queued parameters have a byte budget that cancellation releases',async t=>{
 const workerPath=fileURLToPath(new URL('./fixtures/blocked-worker.mjs',import.meta.url));
 const {root,jobs}=setup(t,{workerPath,concurrency:1,timeoutMs:300,parameterBudgetBytes:32*1024});
 const payload={root,content:'x'.repeat(24*1024)},first=jobs.run('commands',payload).catch(e=>e);
 await assert.rejects(jobs.run('commands',payload),error=>error.status===429);
 const running=jobs.list(root).find(job=>job.status==='running');jobs.cancel(running.id);assert.equal((await first).status,499);assert.equal(jobs.parameterBytes,0);
 const next=jobs.run('commands',payload).catch(e=>e),active=jobs.list(root).find(job=>job.status==='running');assert.ok(jobs.parameterBytes>0);jobs.cancel(active.id);assert.equal((await next).status,499);assert.equal(jobs.parameterBytes,0);
});
