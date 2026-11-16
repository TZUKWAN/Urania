import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {nativeDeckNodes,assertDeckContentOnly} from '../host/native-deck-header.js';
import {readZip,createZip} from '../host/zip.js';
const bytes=await readFile(new URL('./fixtures/deck-web.deckcraft',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
test('actual Deck WASM source yields real page/object identity without changing native source',()=>{
 const before=sha(bytes),nodes=nativeDeckNodes(bytes),rectangle=nodes.get('260'),text=nodes.get('261');assert.ok(rectangle&&text);assert.equal(rectangle.kind.type,'shape');assert.equal(rectangle.layoutPage.kind,'slide');assert.equal(rectangle.layoutPage.id,257);assert.equal(rectangle.xfrm.x,106);assert.equal(sha(bytes),before);
});
test('selective metadata read does not inflate unrelated binary members and still enforces selected budgets',()=>{
 const archive=createZip([{name:'presentation.json',data:'{"metadata":"actual test input"}'},{name:'media/1',data:Buffer.alloc(1024*1024,17)}]);
 const selected=readZip(archive,{includeNames:['presentation.json'],maxSelectedBytes:128});assert.equal(selected.length,1);assert.equal(selected[0].name,'presentation.json');
 assert.throws(()=>readZip(archive,{includeNames:['presentation.json'],maxSelectedBytes:2}));
 assert.throws(()=>nativeDeckNodes(Buffer.from('not a native archive')));
});
test('actual native content-only replacement passes whole-presentation proof; unrelated or formatting changes are refused',async()=>{
 const before=await readFile(new URL('./fixtures/instance-before.deckcraft',import.meta.url)),after=await readFile(new URL('./fixtures/instance-after.deckcraft',import.meta.url));
 assert.doesNotThrow(()=>assertDeckContentOnly(before,after,['261']));
 const changed=mutate=>{
  const entries=readZip(after),entry=entries.find(item=>item.name==='presentation.json'),value=JSON.parse(entry.data);mutate(value.presentation);entry.data=Buffer.from(JSON.stringify(value));return createZip(entries);
 };
 assert.throws(()=>assertDeckContentOnly(before,changed(doc=>doc.props.title='unexpected title change'),['261']),e=>e.status===409);
 assert.throws(()=>assertDeckContentOnly(before,changed(doc=>doc.slides[0].shapes.find(shape=>shape.id===261).kind.fill.crop=[0,0,0,0]),['261']),e=>e.status===409);
});
