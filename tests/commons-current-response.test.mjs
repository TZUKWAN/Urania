import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {StockImages,readStockSearch} from '../host/stock-images.js';
const actual=readFileSync(new URL('./fixtures/commons-imageinfo-20261113.json',import.meta.url));
function root(t){const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||'tests/.work');mkdirSync(base,{recursive:true});const value=mkdtempSync(join(base,'commons-actual-response-'));t.after(()=>{assert.ok(!relative(base,value).startsWith('..'));rmSync(value,{recursive:true,force:true});});return value;}
function replay(bytes){const service=new StockImages();service.request=async(url,kind)=>{assert.equal(new URL(url).origin,'https://commons.wikimedia.org');assert.equal(kind,'api');return {bytes,type:'application/json'};};return service;}
test('replay actual public imageinfo response: official tracking URLs and thumbnail domain remain usable with correct original dimensions',async t=>{
 const project=root(t),result=await replay(actual).search(project,'File:Example.jpg');
 assert.equal(result.search.responseSha256,createHash('sha256').update(actual).digest('hex'));
 assert.equal(result.search.items.length,7);const original=result.search.items.find(row=>row.pageId===29901624);assert.ok(original);assert.equal(original.downloadKind,'original');assert.equal(original.width,1000);assert.equal(original.height,750);assert.equal(new URL(original.downloadUrl).search,'');
 const scaled=result.search.items.find(row=>row.pageId===157351576);assert.ok(scaled);assert.equal(scaled.downloadKind,'scaled');assert.equal(new URL(scaled.downloadUrl).hostname,'thumb.wikimedia.org');assert.equal(scaled.width,1600);
 const saved=await readStockSearch(project,result.search.id);assert.deepEqual(saved.bytes,actual);assert.deepEqual(saved.row.items,result.search.items);
});
test('replay malformed image sources: foreign hosts, unknown/duplicate tracking fields and nonthumbnail paths are still rejected',async t=>{
 const input=JSON.parse(actual),source=input.query.pages.find(row=>row.pageid===29901624);
 for(const url of ['https://example.com/wikipedia/commons/a/a0/test.jpg','https://upload.wikimedia.org/wikipedia/commons/a/a0/test.jpg?redirect=https%3A%2F%2Fexample.com','https://upload.wikimedia.org/wikipedia/commons/a/a0/test.jpg?utm_source=commons.wikimedia.org&utm_source=other','https://thumb.wikimedia.org/wikipedia/commons/a/a0/test.jpg']){
  const page=structuredClone(source);page.imageinfo[0].url=url;const response=Buffer.from(JSON.stringify({batchcomplete:true,query:{pages:[page]}}));const result=await replay(response).search(root(t),'source validation');assert.equal(result.search.items.length,0,url);assert.equal(result.search.skipped.length,1);
 }
});
