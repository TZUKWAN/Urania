// Base archives are real native SVG command outputs. Only explicit negative
// cases below alter codec fields, to verify rejection rather than simulate UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {nativeDeckDocument,nativeDeckNodes,nativeDeckPicture,nativeDeckSvg,assertDeckContentOnly} from '../host/native-deck-header.js';
import {readZip,createZip} from '../host/zip.js';
const load=name=>readFile(new URL('./fixtures/'+name,import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const before=await load('deck-svg/before.deckcraft'),after=await load('deck-svg/after.deckcraft'),meta=JSON.parse(await load('deck-svg/metadata.json'));
const proof=JSON.parse(await load('deck-svg/origin.json'));
for(const [name,bytes]of [['before.deckcraft',before],['after.deckcraft',after]])assert.equal(sha(bytes),proof.files[name].sha256);
const expected={projectId:meta.originBefore.projectId,previousAssetId:meta.originBefore.assetId,assetId:meta.originAfter.assetId};
const old=nativeDeckNodes(before),next=nativeDeckNodes(after),target=String(meta.targetId),other=String(meta.otherId);
const node=(doc,id)=>{const walk=shapes=>{for(const shape of shapes){if(shape.id===id)return shape;if(shape.kind.type==='group'){const found=walk(shape.kind.children);if(found)return found;}}};return doc.slides.map(s=>walk(s.shapes)).find(Boolean);};
function changed(mutate){const entries=readZip(after),part=entries.find(e=>e.name==='presentation.json'),value=JSON.parse(part.data);mutate(value.presentation,entries);part.data=Buffer.from(JSON.stringify(value));return createZip(entries);}
test('real native SVG commands retain exact original/edited SVG and preview with an independent second use',async()=>{
 assert.deepEqual(nativeDeckSvg(before,old.get(target)),await load('svg-material/source.svg'));assert.deepEqual(nativeDeckPicture(before,old.get(target)),await load('svg-material/preview.png'));
 assert.deepEqual(nativeDeckSvg(after,next.get(target)),await load('svg-material/edited-source.svg'));assert.deepEqual(nativeDeckPicture(after,next.get(target)),await load('svg-material/edited-preview.png'));
 assert.deepEqual(nativeDeckSvg(after,next.get(other)),await load('svg-material/source.svg'));assert.deepEqual(nativeDeckPicture(after,next.get(other)),await load('svg-material/preview.png'));
 assert.notEqual(sha(nativeDeckSvg(before,old.get(target))),sha(nativeDeckSvg(after,next.get(target))));
 assert.equal(nativeDeckDocument(before).slides.length,nativeDeckDocument(after).slides.length);
});
test('real SVG content-only native update passes whole-document proof only for its authorized target and origin',()=>{
 assert.doesNotThrow(()=>assertDeckContentOnly(before,after,[target],expected));
 assert.throws(()=>assertDeckContentOnly(before,after,[target]),e=>e.status===409);
 assert.throws(()=>assertDeckContentOnly(before,after,[other],expected),e=>e.status===409);
});
test('geometry, crop, SVG-source discard and MIME tampering are refused',()=>{
 assert.throws(()=>assertDeckContentOnly(before,changed(doc=>node(doc,meta.targetId).xfrm.x+=1),[target],expected),e=>e.status===409);
 assert.throws(()=>assertDeckContentOnly(before,changed(doc=>node(doc,meta.targetId).kind.fill.crop=[0,0,0,0]),[target],expected),e=>e.status===409);
 assert.throws(()=>assertDeckContentOnly(before,changed(doc=>delete node(doc,meta.targetId).kind.fill.svgSource),[target],expected),e=>e.status===409);
 const wrong=changed(doc=>doc.media.find(m=>m.id===node(doc,meta.targetId).kind.fill.svgSource).contentType='image/png');
 assert.throws(()=>nativeDeckSvg(wrong,nativeDeckNodes(wrong).get(target)),e=>e.status===409);
 const alteredOther=changed((_doc,entries)=>{const entry=entries.find(e=>e.name==='media/'+next.get(other).kind.fill.media);entry.data=Buffer.from(entry.data);entry.data[entry.data.length-1]^=1;});
 assert.throws(()=>assertDeckContentOnly(before,alteredOther,[target],expected),e=>e.status===409);
 const extra=changed((_doc,entries)=>entries.push({name:'media/999999',data:Buffer.from('unrelated')}));
 assert.throws(()=>assertDeckContentOnly(before,extra,[target],expected),e=>e.status===409);
});
