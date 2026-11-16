// Genuine native conversion captures; mutations below are explicit adversarial
// tests and are never presented as real conversion outputs.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {createZip,readZip} from '../host/zip.js';
import {assertDeckSvgConversionOnly,validateConvertedShapes} from '../host/native-deck-conversion.js';
import {checkHostedCommand} from '../host/editor-policy.js';
const load=name=>readFileSync(new URL('./fixtures/f5-native-conversion/'+name,import.meta.url));
const before=load('before.deckcraft'),after=load('after.deckcraft'),result=JSON.parse(load('native-result.json'));
function modify(bytes,fn){
 const entries=readZip(bytes,{maxTotalBytes:256*1024*1024,maxSelectedBytes:256*1024*1024});
 const row=entries.find(item=>item.name==='presentation.json'),doc=JSON.parse(row.data);fn(doc.presentation,entries);row.data=Buffer.from(JSON.stringify(doc));return createZip(entries);
}
test('actual converted native shapes preserve original SVG, all media and unrelated deck data',()=>{
 const proof=assertDeckSvgConversionOnly(before,after,result.originalId,result.nativeShapes);
 assert.deepEqual(proof,{originalId:result.originalId,ids:result.ids});
});
test('tampered generated geometry, unrelated objects or original media are rejected',()=>{
 const moved=modify(after,doc=>{doc.slides[0].shapes.find(s=>s.id===result.ids[0]).xfrm.x+=10;});
 assert.throws(()=>assertDeckSvgConversionOnly(before,moved,result.originalId,result.nativeShapes));
 const unrelated=modify(after,doc=>{doc.slides[0].shapes[0].name='unrelated edit';});
 assert.throws(()=>assertDeckSvgConversionOnly(before,unrelated,result.originalId,result.nativeShapes));
 const media=modify(after,(_doc,entries)=>{const row=entries.find(item=>item.name.startsWith('media/'));row.data=Buffer.from('tampered');});
 assert.throws(()=>assertDeckSvgConversionOnly(before,media,result.originalId,result.nativeShapes));
 const wrong=structuredClone(result.nativeShapes);wrong[0].id=wrong[1].id;
 assert.throws(()=>assertDeckSvgConversionOnly(before,after,result.originalId,wrong));
 wrong[0].id=0;assert.throws(()=>assertDeckSvgConversionOnly(before,after,result.originalId,wrong));
});
test('generic commands cannot bypass the dedicated SVG conversion receipt',()=>{
 assert.throws(()=>checkHostedCommand('picture.convertSvgToShapes',{ids:[result.originalId]}),/专用转换动作/);
 assert.doesNotThrow(()=>checkHostedCommand('picture.inspectSvgConversion',{ids:[result.originalId]}));
});
test('host receipt accepts the native one-MiB limit and refuses larger results',()=>{
 const large=structuredClone(result.nativeShapes);large[0].geom.paths[0].d='M 0 0 '+('L 1 1 '.repeat(100000));
 assert.doesNotThrow(()=>validateConvertedShapes(result.originalId,large));
 large[0].geom.paths[0].d+='L 1 1 '.repeat(100000);assert.throws(()=>validateConvertedShapes(result.originalId,large),/预算/);
});
