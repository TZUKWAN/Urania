import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdirSync,mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {saveAssetStream} from '../host/asset-stream.js';
import {readAsset} from '../host/docstore.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});
test('streamed assets are real, immutable and idempotent without base64 buffering',async t=>{
 const root=mkdtempSync(join(base,'stream-'));t.after(()=>{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
 const first=await saveAssetStream(root,'source.bin',Readable.from([Buffer.from('one'),Buffer.from(' two')]));assert.equal(readAsset(root,first.name).toString(),'one two');
 const same=await saveAssetStream(root,'source.bin',Readable.from(['one two']));assert.equal(first.name,same.name);
 const different=await saveAssetStream(root,'source.bin',Readable.from(['three']));assert.notEqual(first.name,different.name);assert.equal(readAsset(root,first.name).toString(),'one two');assert.equal(readAsset(root,different.name).toString(),'three');
 await assert.rejects(saveAssetStream(root,'over.bin',Readable.from(['123456789']),{maxBytes:8}),e=>e.status===413);
 assert.deepEqual(readdirSync(join(root,'design','.designcraft','uploads')),[]);
 await assert.rejects(saveAssetStream(root,'../escape.bin',Readable.from(['data'])));
 const longName='a'.repeat(112)+'.png';await saveAssetStream(root,longName,Readable.from(['one']));const longer=await saveAssetStream(root,longName,Readable.from(['two']));assert.ok(longer.name.length<=120);assert.equal(readAsset(root,longer.name).toString(),'two');
});
