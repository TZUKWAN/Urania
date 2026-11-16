import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HtmlArtifacts, previewFiles, inspectEditablePptx} from '../host/html-artifacts.js';
import {readZip, createZip} from '../host/zip.js';

const file=(path,text)=>({path,data:Buffer.from(text).toString('base64')});
const source=title=>[
 file('index.html',`<!doctype html><html><head><link rel="stylesheet" href="assets/style.css"></head><body><h1>${title}</h1></body></html>`),
 file('assets/style.css','h1{color:#287d6c}'),
 file('assets/extra.unrecognized','exact bytes retained')
];

test('HTML source versions, real archive, stale writes and concurrent saves preserve both history and one head',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-html-source-')),store=new HtmlArtifacts(root);
 const first=await store.create({title:'网页草稿',entry:'index.html',files:source('初稿')});
 assert.match(first.id,/^html-/);assert.match(first.revision,/^[a-f0-9]{64}$/);
 const loaded=await store.read(first.id);assert.equal(loaded.revision,first.revision);
 assert.equal(loaded.document.files.find(row=>row.path.endsWith('.unrecognized')).mime,'application/octet-stream');
 const second=await store.save({id:first.id,baseRevision:first.revision,title:'网页草稿',entry:'index.html',files:source('修订')});
 assert.notEqual(second.revision,first.revision);assert.equal((await store.read(first.id,first.revision)).historical,true);
 await assert.rejects(store.save({id:first.id,baseRevision:first.revision,title:'过期写入',entry:'index.html',files:source('过期')}),/已有新版本/);
 const [a,b]=await Promise.allSettled(['方案甲','方案乙'].map(title=>store.save({id:first.id,baseRevision:second.revision,title,entry:'index.html',files:source(title)})));
 assert.equal([a,b].filter(row=>row.status==='fulfilled').length,1);assert.equal([a,b].filter(row=>row.status==='rejected').length,1);
 const head=await store.read(first.id);assert.notEqual(head.revision,second.revision);
 const archive=await store.archive(first.id,head.revision),members=new Map(readZip(archive).map(row=>[row.name,row.data]));
 assert.equal(members.get('assets/extra.unrecognized').toString(),'exact bytes retained');
 assert.match(members.get('index.html').toString(),/方案甲|方案乙/);
 assert.equal((await store.list()).length,1);
});

test('unsafe or malformed HTML source is rejected and historical corruption is surfaced',async()=>{
 assert.throws(()=>previewFiles([file('../outside.html','x')],'../outside.html'),/路径/);
 assert.throws(()=>previewFiles([{path:'index.html',data:'not base64!'}],'index.html'),/Base64/);
 assert.throws(()=>previewFiles([file('INDEX.html','x'),file('index.html','y')],'index.html'),/重复/);
 const root=await mkdtemp(join(tmpdir(),'designcraft-html-corrupt-')),store=new HtmlArtifacts(root);
 const saved=await store.create({title:'真实源',entry:'index.html',files:source('保留')});
 const history=store.file(saved.id,'history',saved.revision+'.json'),bytes=await readFile(history);bytes[bytes.length-2]^=1;await writeFile(history,bytes);
 await assert.rejects(store.read(saved.id),/完整性/);
});

// Captured from the real, locally run dom-to-pptx converter; not a simulated output.
test('actual converter archive admits empty directory entries but rejects a real embedded-object member',async()=>{
 const source=await readFile(new URL('./fixtures/html-converter-real.pptx',import.meta.url));
 const report=inspectEditablePptx(source);assert.equal(report.slides,1);assert.ok(report.nativeShapes>0);assert.ok(report.textRuns>0);
 const entries=readZip(source);assert.ok(entries.some(row=>row.name==='ppt/embeddings/'&&row.data.length===0));
 const hostile=createZip([...entries,{name:'ppt/embeddings/external.bin',data:Buffer.from('not an executable, but an explicitly forbidden embedded object')}]);
 assert.throws(()=>inspectEditablePptx(hostile),/活动或嵌入/);
});

test('font report reflects the actual embedded font metadata and payload',async()=>{
 const source=await readFile(new URL('./fixtures/html-converter-font-real.pptx',import.meta.url));
 const report=inspectEditablePptx(source);assert.deepEqual(report.embeddedFonts,['Inter']);assert.equal(report.fontParts,1);
 const missing=createZip(readZip(source).filter(row=>!row.name.endsWith('.fntdata')));assert.deepEqual(inspectEditablePptx(missing).embeddedFonts,[]);
});

test('actual converter report separates SVG pictures from rasterized picture objects',async()=>{
 const source=await readFile(new URL('./fixtures/html-converter-raster-real.pptx',import.meta.url));
 const report=inspectEditablePptx(source);assert.equal(report.svgMedia,1);assert.equal(report.svgPictures,1);assert.equal(report.rasterPictures,1);
});
