import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {nativeVectorHeader,nativeVectorImage,assertVectorImageContentOnly} from '../host/native-vector-header.js';
import {previewImageSize} from '../host/image-header.js';
const actual=await readFile(new URL('./fixtures/vector-web-blobs.vectorcraft',import.meta.url));
const marker=Buffer.from([10,0,86,67,66,76,79,66,83,0]),sha=b=>createHash('sha256').update(b).digest('hex');
test('actual native v4 binary-image source is inspected without changing its image bytes',()=>{
 const before=sha(actual),header=nativeVectorHeader(actual);assert.equal(header.version,4);assert.equal(header.format,'vectorcraft');
 const at=actual.indexOf(marker);assert.ok(at>0);const blobs=actual.subarray(at+marker.length),image=Object.values(header.images).find(image=>image.blob);
 assert.ok(image);const [offset,length]=image.blob;assert.ok(length>8192);assert.deepEqual(blobs.subarray(offset,offset+8),Buffer.from([137,80,78,71,13,10,26,10]));assert.equal(sha(actual),before);
});
test('invalid binary ranges and invalid headers cannot masquerade as a valid native layout',()=>{
 const header=nativeVectorHeader(actual),image=Object.values(header.images).find(image=>image.blob);image.blob=[0,Number.MAX_SAFE_INTEGER];
 assert.throws(()=>nativeVectorHeader(Buffer.concat([Buffer.from(JSON.stringify(header)),marker,Buffer.from('small')])),error=>error.status===422);
 assert.throws(()=>nativeVectorHeader(Buffer.from('not-json')),error=>error.status===422);
});
test('actual saved PNG bytes are selected from a native image identity without rewriting the source',()=>{
 const before=sha(actual),file=nativeVectorHeader(actual),node=file.document.layers[0].kind.children.find(node=>node.kind.type==='image');
 const image=nativeVectorImage(actual,node);assert.equal(image.length,10406);assert.deepEqual(previewImageSize(image),{width:1024,height:1024});assert.equal(sha(actual),before);
 assert.throws(()=>nativeVectorImage(actual,{kind:{type:'group'}}),e=>e.status===409);
 assert.throws(()=>nativeVectorImage(actual,{...node,kind:{...node.kind,link:{path:'external.png'}}}),e=>e.status===409);
 // Codec-grammar input derived from the same real image, not a generation proof.
 const inline=structuredClone(file),entry=inline.images[node.kind.key];delete entry.blob;entry.data=image.toString('base64');assert.deepEqual(nativeVectorImage(Buffer.from(JSON.stringify(inline)),node),image);
 entry.data='bad base64';assert.throws(()=>nativeVectorImage(Buffer.from(JSON.stringify(inline)),node),e=>e.status===422);
});
test('content-proof grammar preserves physical pixel frame and all other native fields; old raw data cannot be silently changed',async()=>{
 // Property-verifier input built from actual files using the documented native
 // grammar. This tests the verifier, not native command execution/generation.
 const file=nativeVectorHeader(actual),old=file.document.layers[0].kind.children.find(n=>n.kind.type==='image'),incoming=await readFile(new URL('./fixtures/instance-old.png',import.meta.url));
 const make=()=>{
  const next=structuredClone(file),node=next.document.layers[0].kind.children.find(n=>n.id===old.id),a=old.kind;
  Object.assign(node.kind,{key:'image-proof-input',width:320,height:240,xf:[a.xf[0]*a.width/320,a.xf[1]*a.width/320,a.xf[2]*a.height/240,a.xf[3]*a.height/240,a.xf[4],a.xf[5]]});
  next.images[node.kind.key]={mime:'image/png',data:incoming.toString('base64')};return next;
 };
 const tail=actual.subarray(actual.indexOf(marker)+marker.length),encode=(header,bytes=tail)=>Buffer.concat([Buffer.from(JSON.stringify(header)),marker,bytes]);
 assert.doesNotThrow(()=>assertVectorImageContentOnly(actual,encode(make()),[old.id]));
 const moved=make();moved.document.layers[0].kind.children.find(n=>n.id===old.id).kind.xf[4]+=1;assert.throws(()=>assertVectorImageContentOnly(actual,encode(moved),[old.id]),e=>e.status===409);
 const restyled=make();restyled.document.layers[0].kind.children.find(n=>n.id===old.id).opacity=.5;assert.throws(()=>assertVectorImageContentOnly(actual,encode(restyled),[old.id]),e=>e.status===409);
 const changed=Buffer.from(tail);changed[changed.length-1]^=1;assert.throws(()=>assertVectorImageContentOnly(actual,encode(make(),changed),[old.id]),e=>e.status===409);
 const pruned=make();delete pruned.images[old.kind.key];assert.doesNotThrow(()=>assertVectorImageContentOnly(actual,encode(pruned),[old.id]));
});
