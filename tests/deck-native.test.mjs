import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as store from '../host/docstore.js';
import {WorkspaceNative} from '../host/workspace-native.js';
import {openNativeSession} from '../host/native.js';
import {createImage,toPNG} from '../host/raster.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});
test('real DeckCraft exports text, picture, editable chart/table and Bezier geometry from the common workspace',async t=>{
 const root=mkdtempSync(join(base,'native-deck-')),runtime=new WorkspaceNative();let native;
 t.after(async()=>{runtime.dispose();await native?.close();assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
 store.saveAsset(root,'red.png',toPNG(createImage(16,12,[255,0,0,255])));
 store.createDoc(root,{id:'deck',canvas:{width:320,height:240},assets:[],pages:[{id:'p',name:'融合页',notes:'保留演讲备注',background:{kind:'solid',color:'#ffffff'},layers:[
  {id:'text',type:'text',text:'中文 Native',x:10,y:10,w:180,h:40,fontSize:20,color:'#000000',opacity:.8},
  {id:'image',type:'image',asset:'red.png',x:10,y:60,w:32,h:24,opacity:.5},
  {id:'vector',type:'vector',name:'Bezier',x:60,y:60,w:40,h:40,geometryBox:{x:0,y:0,w:40,h:40},paths:[{d:'M0 0 C0 40 40 40 40 0 Z',fill:'#0000ff'}]},
  {id:'chart',type:'chart',name:'data chart',x:120,y:60,w:160,h:100,chartKind:'bar',data:{labels:['A','B'],series:[{name:'Real values',values:[12,24]}]},colors:['#287D6C']},
  {id:'table',type:'table',x:10,y:170,w:240,h:40,rowHeight:20,fontSize:12,rows:[['项目','值'],['真实',3]]}
 ]}]});
 const result=await runtime.run({root,id:'deck',operation:'deck.export',baseRevision:store.readDoc(root,'deck').revision,out:'native.pptx'});
 assert.equal(result.candidate.engine,'deckcraft');const doc=store.readDoc(root,'deck').doc;assert.ok(doc.native.deck.source.endsWith('.deckcraft'));
 const pptx=store.readExport(root,'native.pptx');assert.ok(pptx.length>0);const evidence=process.env.DESIGNCRAFT_EXPORT_EVIDENCE;if(evidence){mkdirSync(evidence,{recursive:true});writeFileSync(join(evidence,'native.pptx'),pptx);writeFileSync(join(evidence,'native.deckcraft'),store.readAsset(root,doc.native.deck.source));}
 native=await openNativeSession('deckcraft',root);await native.call('open_presentation',{path:join(root,'design','exports','native.pptx')});
 const slide=(await native.call('inspect_slide',{})).data;
 assert.ok(slide.shapes.some(shape=>shape.text==='中文 Native'));
 assert.ok(slide.shapes.some(shape=>shape.kind==='chart'),JSON.stringify(slide.shapes));
 assert.ok(slide.shapes.some(shape=>shape.kind==='table'),JSON.stringify(slide.shapes));
 const preview=await native.call('render_slide',{scale:1});assert.ok(preview.content.some(block=>block.type==='image'));
 const pdf=await runtime.run({root,id:'deck',operation:'deck.pdf',baseRevision:store.readDoc(root,'deck').revision,out:'native.pdf'});assert.ok(store.readExport(root,pdf.candidate.file).subarray(0,5).equals(Buffer.from('%PDF-')));
 if(evidence)writeFileSync(join(evidence,'native.pdf'),store.readExport(root,pdf.candidate.file));
});
