// Real native command outputs; only explicit refusal cases alter codec JSON.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {nativeVectorHeader,nativeVectorEmbedded,assertVectorEmbeddedContentOnly} from '../host/native-vector-header.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const before=await load('vector-embedded-svg/before.vectorcraft'),after=await load('vector-embedded-svg/after.vectorcraft'),meta=JSON.parse(await load('vector-embedded-svg/metadata.json')),proof=JSON.parse(await load('vector-embedded-svg/origin.json'));
for(const [name,bytes] of [['before.vectorcraft',before],['after.vectorcraft',after]])assert.equal(sha(bytes),proof.files[name].sha256);
const nodes=file=>{const result=new Map(),walk=list=>{for(const n of list){result.set(String(n.id),n);if(n.kind?.children)walk(n.kind.children);}};walk(file.document.layers);return result;};
const target=String(meta.targetId),other=String(meta.otherId),old=nodes(nativeVectorHeader(before)),next=nodes(nativeVectorHeader(after));
const expected={projectId:meta.originBefore.projectId,previousAssetId:meta.originBefore.assetId,assetId:meta.originAfter.assetId};
const magic=Buffer.from([10,0,86,67,66,76,79,66,83,0]);
function changed(mutate){const at=after.indexOf(magic);assert.ok(at>0);const header=JSON.parse(after.subarray(0,at));mutate(header,nodes(header));return Buffer.concat([Buffer.from(JSON.stringify(header)),after.subarray(at)]);}
test('real native vector use retains the exact original source and independent second use',async()=>{
 assert.deepEqual(nativeVectorEmbedded(before,old.get(target)),await load('svg-material/source.vectorcraft'));
 assert.deepEqual(nativeVectorEmbedded(after,next.get(target)),await load('svg-material/edited-source.vectorcraft'));
 assert.deepEqual(nativeVectorEmbedded(after,next.get(other)),await load('svg-material/source.vectorcraft'));
 assert.notEqual(sha(nativeVectorEmbedded(before,old.get(target))),sha(nativeVectorEmbedded(after,next.get(target))));
});
test('only authorized source and identity changes pass the whole-poster proof',()=>{
 assert.doesNotThrow(()=>assertVectorEmbeddedContentOnly(before,after,[target],expected));
 assert.throws(()=>assertVectorEmbeddedContentOnly(before,after,[target]),e=>e.status===409);
 assert.throws(()=>assertVectorEmbeddedContentOnly(before,after,[other],expected),e=>e.status===409);
});
test('frame, origin and embedded source tampering fail before publication',()=>{
 assert.throws(()=>assertVectorEmbeddedContentOnly(before,changed((_,n)=>n.get(target).kind.xf[4]+=1),[target],expected),e=>e.status===409);
 assert.throws(()=>assertVectorEmbeddedContentOnly(before,changed((_,n)=>n.get(target).opacity=0.1),[target],expected),e=>e.status===409);
 assert.throws(()=>assertVectorEmbeddedContentOnly(before,changed(h=>{h.images['unrelated-injected']={mime:'image/png',data:'AA=='};}),[target],expected),e=>e.status===409);
 const linked=changed((_,n)=>n.get(target).kind.link.path='external.vectorcraft');assert.throws(()=>nativeVectorEmbedded(linked,nodes(nativeVectorHeader(linked)).get(target)),e=>e.status===409);
 const wrong=changed((h,n)=>{h.images[n.get(target).kind.key].mime='image/png';});assert.throws(()=>nativeVectorEmbedded(wrong,nodes(nativeVectorHeader(wrong)).get(target)),e=>e.status===409);
});
