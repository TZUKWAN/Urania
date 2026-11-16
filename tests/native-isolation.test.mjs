import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openNativeSession} from '../host/native.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
test('closing the owned native launcher kills its engine descendant',async()=>{
 const root=mkdtempSync(join(base,'native-job-'));let session;
 try{
  session=await openNativeSession('photocraft',root);assert.ok(session.nativePid);assert.notEqual(session.nativePid,session.child.pid);assert.equal(alive(session.nativePid),true);
  await session.close();for(let i=0;i<40&&alive(session.nativePid);i++)await new Promise(r=>setTimeout(r,25));assert.equal(alive(session.nativePid),false);
 }finally{await session?.close();assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});}
});
test('Windows job budget refuses a real oversized child allocation',async()=>{
 const root=mkdtempSync(join(base,'memory-job-'));
 try{
  const script=join(root,'allocation.cjs');writeFileSync(script,"process.stdout.write('entered\\n');const bytes=Buffer.alloc(256*1024*1024,1);process.stdout.write('allocation-completed\\n');");
  const runner=fileURLToPath(new URL('../runtimes/native-runner.exe',import.meta.url));
  const child=spawn(runner,['--memory-mb','96','--',process.execPath,script],{windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  const timer=setTimeout(()=>child.kill(),5000);const code=await new Promise((yes,no)=>{child.on('error',no);child.on('close',yes)});clearTimeout(timer);
  assert.ok(stdout.includes('entered'),stderr);assert.ok(!stdout.includes('allocation-completed'));assert.notEqual(code,0);
 }finally{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});}
});
