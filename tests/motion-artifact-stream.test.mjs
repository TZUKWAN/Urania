import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {hashArtifact} from '../host/motion/artifact-verifier.js';
test('streamed file identity matches actual bytes and observes an aborted operation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'urania-hash-')),file=path.join(dir,'data'),data=crypto.randomBytes(5*1024*1024);fs.writeFileSync(file,data);
 try{const result=await hashArtifact(file);assert.equal(result.bytes,data.length);assert.equal(result.sha256,crypto.createHash('sha256').update(data).digest('hex'));const controller=new AbortController();controller.abort();await assert.rejects(hashArtifact(file,{signal:controller.signal}),/abort/i);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
