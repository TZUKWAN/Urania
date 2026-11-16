import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,existsSync,statSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {openNativeSession} from '../host/native.js';
import {fromPNG} from '../host/raster.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});
async function session(t,engine) {
 const root=mkdtempSync(join(base,'native-'));const native=await openNativeSession(engine,root);
 t.after(async()=>{await native.close();assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
 return {root,native};
}
test('real PhotoCraft edits, previews and saves a native source',async t=>{
 const {root,native}=await session(t,'photocraft');
 assert.equal(native.identity.name,'photocraft');
 await native.call('doc_new',{width:32,height:24,background:'#ff0000',name:'source'});
 const preview=await native.call('doc_render_preview',{max_side:64});
 const block=preview.content.find(x=>x.type==='image');assert.ok(block);
 const img=fromPNG(Buffer.from(block.data,'base64'));assert.equal(img.width,32);assert.equal(img.height,24);assert.deepEqual([...img.data.slice(0,4)],[255,0,0,255]);
 const output=join(native.directory,'source.pcraft');await native.call('doc_save',{path:output});assert.ok(statSync(output).size>0);
 await assert.rejects(native.call('doc_save',{path:join(root,'outside-write-root.pcraft')}));assert.equal(existsSync(join(root,'outside-write-root.pcraft')),false);
});
test('real VectorCraft performs boolean union and saves editable vectors',async t=>{
 const {native}=await session(t,'vectorcraft');
 await native.call('command_run',{id:'file.new',params:{width:64,height:64,units:'Points'}});
 const a=await native.call('command_run',{id:'shape.rectangle',params:{x:2,y:2,width:20,height:20}});
 const b=await native.call('command_run',{id:'shape.rectangle',params:{x:12,y:2,width:20,height:20}});
 assert.equal(typeof a.data.id,'number');assert.equal(typeof b.data.id,'number');
 const union=await native.call('pathfinder',{operation:'unite',ids:[a.data.id,b.data.id]});assert.equal(union.data.ids.length,1);
 const inspected=await native.call('doc_inspect',{});assert.equal(inspected.data.layers[0].children.length,1);assert.equal(inspected.data.layers[0].children[0].bounds.width,30);
 const output=join(native.directory,'source.vectorcraft');await native.call('save_file',{path:output,compress:false});assert.ok(statSync(output).size>0);
 const preview=await native.call('render_preview',{max_side:64});assert.ok(preview.content.some(x=>x.type==='image'));
});
test('real DeckCraft creates native text and exports readable PPTX',async t=>{
 const {native}=await session(t,'deckcraft');
 await native.call('new_presentation',{blank:true});await native.call('add_slide',{layout:'blank'});
 await native.call('add_text_box',{text:'中文 Native',x:20,y:20,w:300,h:60,size:24,color:'#000000'});
 const source=join(native.directory,'source.deckcraft'),pptx=join(native.directory,'source.pptx');
 await native.call('save_presentation',{path:source});await native.call('save_presentation',{path:pptx});
 assert.ok(statSync(source).size>0);assert.ok(statSync(pptx).size>0);
 await native.call('open_presentation',{path:pptx});const slide=await native.call('inspect_slide',{});assert.ok(slide.data.shapes.some(shape=>shape.text==='中文 Native'));
 const result=await native.call('render_slide',{scale:.25});assert.ok(result.content.some(x=>x.type==='image'));
});
