import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WorkspaceNative} from '../host/workspace-native.js';
import * as store from '../host/docstore.js';
import {createImage,toPNG,fromPNG} from '../host/raster.js';
import {openNativeSession} from '../host/native.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});
function setup(t,layers){
 const root=mkdtempSync(join(base,'workspace-native-'));const runtime=new WorkspaceNative();
 store.saveAsset(root,'red.png',toPNG(createImage(16,12,[255,0,0,255])));
 store.createDoc(root,{id:'work',canvas:{width:64,height:64},pages:[{id:'page',layers}],assets:[]});
 t.after(()=>{runtime.dispose();assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
 return {root,runtime,input:extra=>({root,id:'work',pageId:'page',baseRevision:store.readDoc(root,'work').revision,...extra})};
}
test('image operations update the same object and retain a real PhotoCraft source across reopen',async t=>{
 const {root,runtime,input}=setup(t,[{id:'image',type:'image',asset:'red.png',x:5,y:6,w:32,h:24}]);
 const first=await runtime.run(input({operation:'photo.apply',layerId:'image',commands:[{id:'image.adjustments.invert'}]}));
 let doc=store.readDoc(root,'work').doc,layer=doc.pages[0].layers[0];assert.equal(layer.id,'image');assert.equal(layer.x,5);assert.ok(first.candidate.source.endsWith('.pcraft'));
 assert.deepEqual([...fromPNG(store.readAsset(root,layer.asset)).data.slice(0,4)],[0,255,255,255]);
 assert.deepEqual([...fromPNG(store.readAsset(root,'red.png')).data.slice(0,4)],[255,0,0,255]);
 await runtime.run(input({operation:'photo.apply',layerId:'image',commands:[{id:'image.adjustments.invert'}]}));
 layer=store.readDoc(root,'work').doc.pages[0].layers[0];assert.deepEqual([...fromPNG(store.readAsset(root,layer.asset)).data.slice(0,4)],[255,0,0,255]);
 assert.ok(store.readAsset(root,layer.native.source).length>0);
});
test('real VectorCraft union produces common editable paths inside the same page',async t=>{
 const {root,runtime,input}=setup(t,[{id:'left',type:'shape',shape:'rect',x:2,y:2,w:20,h:20,fill:'#ff0000'},{id:'right',type:'shape',shape:'rect',x:12,y:2,w:20,h:20,fill:'#ff0000'}]);
 await runtime.run(input({operation:'vector.boolean',mode:'unite',layerIds:['left','right']}));
 const doc=store.readDoc(root,'work').doc;assert.equal(doc.pages.length,1);assert.equal(doc.pages[0].layers.length,1);
 const path=doc.pages[0].layers[0];assert.equal(path.type,'vector');assert.equal(path.w,30);assert.equal(path.paths[0].fill,'#ff0000');assert.ok(path.paths[0].d.includes('L'));
 const native=JSON.parse(store.readAsset(root,path.native.source).toString('utf8'));assert.equal(native.format,'vectorcraft');assert.equal(path.native.objectId,native.document.layers[0].kind.children[0].id);
});
test('concurrent edit during a real native operation prevents overwrite and retains the candidate',async t=>{
 const {root,runtime,input}=setup(t,[{id:'image',type:'image',asset:'red.png',x:0,y:0,w:16,h:12}]);
 let changed=false;runtime.onChange=event=>{if(event.status==='running'&&!changed){changed=true;const current=store.readDoc(root,'work');current.doc.title='Concurrent user edit';store.writeDoc(root,'work',current.doc,'user',{baseRevision:current.revision});}};
 await assert.rejects(runtime.run(input({operation:'photo.apply',layerId:'image',commands:[{id:'image.adjustments.invert'}]})),error=>{assert.equal(error.status,409);assert.ok(store.readAsset(root,error.candidate.source));return true;});
 const doc=store.readDoc(root,'work').doc;assert.equal(doc.title,'Concurrent user edit');assert.equal(doc.pages[0].layers[0].asset,'red.png');
});
test('layered PSD import retains the original bytes and actual native adjustment layers',async t=>{
 const {root,runtime,input}=setup(t,[]);const producer=await openNativeSession('photocraft',root);let psd;
 try{await producer.call('doc_new',{width:16,height:12,background:'#ff0000'});await producer.call('command_run',{id:'layer.newAdjustmentLayer.invert',params:{},wait:true});const path=join(producer.directory,'original.psd');await producer.call('doc_save',{path});psd=readFileSync(path);}finally{await producer.close();}
 store.saveAsset(root,'original.psd',psd);
 await runtime.run(input({operation:'photo.import',asset:'original.psd',fitCanvas:true}));
 const doc=store.readDoc(root,'work').doc,layer=doc.pages[0].layers[0];assert.equal(doc.canvas.width,16);assert.equal(layer.native.original,'original.psd');assert.ok(layer.native.layers.length>=2);assert.ok(layer.native.layers.some(l=>l.kind==='Adjustment'));
 assert.deepEqual(store.readAsset(root,'original.psd'),psd);assert.deepEqual([...fromPNG(store.readAsset(root,layer.asset)).data.slice(0,4)],[0,255,255,255]);
});
test('blank photo creation makes an actual editable native image in the common page',async t=>{
 const {root,runtime,input}=setup(t,[]);await runtime.run(input({operation:'photo.create'}));const doc=store.readDoc(root,'work').doc,layer=doc.pages[0].layers[0];assert.equal(layer.type,'image');assert.ok(store.readAsset(root,layer.native.source).length);const image=fromPNG(store.readAsset(root,layer.asset));assert.equal(image.width,64);assert.equal(image.height,64);assert.equal(image.data[3],0);
});
test('SVG import returns common paths while retaining exact original bytes and native source',async t=>{
 const {root,runtime,input}=setup(t,[]),svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><path d="M2 2H30V22H2Z" fill="#ff0000"/></svg>';
 store.saveAsset(root,'basic.svg',Buffer.from(svg));await runtime.run(input({operation:'vector.import',asset:'basic.svg',fitCanvas:true}));const doc=store.readDoc(root,'work').doc,layer=doc.pages[0].layers[0];assert.equal(layer.type,'vector');assert.equal(layer.paths[0].fill,'#ff0000');assert.equal(layer.native.original,'basic.svg');assert.equal(store.readAsset(root,'basic.svg').toString(),svg);assert.ok(store.readAsset(root,layer.native.source).length);
});
test('complex SVG stays native, edits through VectorCraft and never loses its source',async t=>{
 const {root,runtime,input}=setup(t,[]),svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#00ff00"/></linearGradient></defs><path d="M0 0H32V24H0Z" fill="url(#g)"/></svg>';
 store.saveAsset(root,'gradient.svg',Buffer.from(svg));await runtime.run(input({operation:'vector.import',asset:'gradient.svg',fitCanvas:true}));let doc=store.readDoc(root,'work').doc,layer=doc.pages[0].layers[0];assert.equal(layer.type,'native');assert.ok(store.readAsset(root,layer.native.svg).toString().includes('linearGradient'));
 const revision=store.readDoc(root,'work').revision,inspection=await runtime.run(input({operation:'native.inspect',layerId:layer.id,filter:'paint.setFill'}));assert.equal(inspection.candidate.readOnly,true);assert.ok(inspection.candidate.commands.some(command=>command.id==='paint.setFill'));assert.equal(store.readDoc(root,'work').revision,revision);
 const node=layer.native.nodes.find(node=>node.kind==='Path');assert.ok(node,JSON.stringify(layer.native.nodes));await runtime.run(input({operation:'vector.apply',layerId:layer.id,nativeObjectId:node.id,commands:[{id:'paint.setFill',params:{color:'#0000ff'}}]}));
 layer=store.readDoc(root,'work').doc.pages[0].layers[0];const preview=fromPNG(store.readAsset(root,layer.asset)),pixel=(Math.floor(preview.height/2)*preview.width+Math.floor(preview.width/2))*4;assert.deepEqual([...preview.data.slice(pixel,pixel+4)],[0,0,255,255]);assert.equal(store.readAsset(root,'gradient.svg').toString(),svg);assert.ok(store.readAsset(root,layer.native.source).length);
 const deck=await runtime.run(input({operation:'deck.export',out:'vector.pptx'}));assert.ok(store.readExport(root,deck.candidate.file).includes(Buffer.from('.svg')),'complex vector must be embedded as SVG, not its bitmap preview');
});
test('SVG export uses current Bezier nodes and real stroke/opacity instead of the provenance file',async t=>{
 const {root,runtime,input}=setup(t,[{id:'path',type:'vector',name:'current nodes',x:2,y:2,w:20,h:20,geometryBox:{x:0,y:0,w:20,h:20},opacity:.5,paths:[{d:'M0 0 C0 20 20 20 20 0 Z',fill:'#ff0000',stroke:{color:'#0000ff',width:2}}]}]);
 const revision=store.readDoc(root,'work').revision,result=await runtime.run(input({operation:'vector.export',layerId:'path',out:'current.svg'}));
 const text=store.readExport(root,result.candidate.file).toString();assert.ok(text.includes('<svg'));assert.ok(/stroke/.test(text));assert.ok(/opacity/.test(text));assert.ok(/C|c/.test(text));assert.equal(store.readDoc(root,'work').revision,revision);
});
