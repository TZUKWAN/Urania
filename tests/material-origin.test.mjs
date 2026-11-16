// Native metadata grammar/whole-model verifier gate; native integration and
// owned browser gates separately prove real command/copy/undo behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {materialOrigin,normalizeMaterialOrigin} from '../host/material-origin.js';
import {nativeVectorHeader,assertVectorImageContentOnly} from '../host/native-vector-header.js';
import {assertDeckContentOnly} from '../host/native-deck-header.js';
import {readZip,createZip} from '../host/zip.js';
const old={schema:1,projectId:'project-fixture',assetId:'asset-old',instanceId:'1'.repeat(32)},next={...old,assetId:'asset-new'},expected={projectId:old.projectId,previousAssetId:old.assetId,assetId:next.assetId};
for(const engine of ['vectorcraft','deckcraft'])test(engine+' origin parser and authorized normalization preserve all unrelated native metadata',()=>{
 const node=origin=>engine==='vectorcraft'?{attrs:{note:'keep',data:[['customer','retain'],['dsh-material-v1',JSON.stringify(origin)]]}}:{tags:[['CUSTOMER','retain'],['DSH-MATERIAL-V1',JSON.stringify(origin)]]};
 const before=node(old),after=node(next);assert.deepEqual(materialOrigin(before,engine),old);normalizeMaterialOrigin(before,after,engine,expected);assert.deepEqual(after,before);
 assert.throws(()=>normalizeMaterialOrigin(node(old),node({...next,instanceId:'2'.repeat(32)}),engine,expected),e=>e.status===409);
 assert.throws(()=>normalizeMaterialOrigin(node(old),node({...next,projectId:'project-foreign'}),engine,expected),e=>e.status===409);
 const changed=node(next);if(engine==='vectorcraft')changed.attrs.note='wrong';else changed.tags[0][1]='wrong';assert.throws(()=>normalizeMaterialOrigin(node(old),changed,engine,expected),e=>e.status===409);
 const extra=node({...old,linkId:'link-never-inherit'});assert.throws(()=>materialOrigin(extra,engine),e=>e.status===422);
});
test('Vector full native proof only admits the specific project/asset marker change',async()=>{
 const source=await readFile(new URL('./fixtures/vector-web-blobs.vectorcraft',import.meta.url)),marker=Buffer.from([10,0,86,67,66,76,79,66,83,0]),tail=source.subarray(source.indexOf(marker)+marker.length),before=nativeVectorHeader(source),after=structuredClone(before);
 const a=before.document.layers[0].kind.children.find(n=>n.id===2),b=after.document.layers[0].kind.children.find(n=>n.id===2);a.attrs={data:[['dsh-material-v1',JSON.stringify(old)]]};b.attrs={data:[['dsh-material-v1',JSON.stringify(next)]]};const encode=h=>Buffer.concat([Buffer.from(JSON.stringify(h)),marker,tail]);
 assert.doesNotThrow(()=>assertVectorImageContentOnly(encode(before),encode(after),[2],expected));assert.throws(()=>assertVectorImageContentOnly(encode(before),encode(after),[2]),e=>e.status===409);
});
test('Deck full native proof changes actual shape tag reference, not only a detached summary',async()=>{
 const source=await readFile(new URL('./fixtures/instance-before.deckcraft',import.meta.url));
 const encode=origin=>{const entries=readZip(source),part=entries.find(e=>e.name==='presentation.json'),doc=JSON.parse(part.data),picture=doc.presentation.slides[0].shapes.find(n=>n.id===261);picture.tags=[['DSH-MATERIAL-V1',JSON.stringify(origin)]];part.data=Buffer.from(JSON.stringify(doc));return createZip(entries);};
 assert.doesNotThrow(()=>assertDeckContentOnly(encode(old),encode(next),[261],expected));assert.throws(()=>assertDeckContentOnly(encode(old),encode(next),[261]),e=>e.status===409);
});
