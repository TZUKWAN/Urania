import test from 'node:test';
import assert from 'node:assert/strict';
import {createZip,readZip} from '../host/zip.js';
test('canonical native ZIP reader retains stored/deflated bytes exactly',()=>{const data=Buffer.from('真实媒体\0bytes');const entries=readZip(createZip([{name:'mimetype',data:'native',store:true},{name:'media/1',data}]));assert.equal(entries[0].data.toString(),'native');assert.deepEqual(entries[1].data,data);});
test('ZIP entry budgets reject before unbounded inflation and CRC rejects corruption',()=>{const input=createZip([{name:'media/1',data:'hello world',store:true}]);assert.throws(()=>readZip(input,{maxTotalBytes:4}),/budget/);const bad=Buffer.from(input);bad[30+Buffer.byteLength('media/1')]=0;assert.throws(()=>readZip(bad),/CRC/);assert.throws(()=>readZip(input.subarray(0,input.length-2)),/directory/);});
test('unsafe and duplicate ZIP names are never extracted or accepted',()=>{for(const entries of [[{name:'../outside',data:'x'}],[{name:'media/a',data:'x'},{name:'media/A',data:'y'}]])assert.throws(()=>readZip(createZip(entries)),/path/);});
