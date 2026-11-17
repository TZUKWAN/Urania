import test from 'node:test';import assert from 'node:assert/strict';import {buildZip,readZip,inspectDcmotion} from '../host/motion/package.js';
test('ZIP bounds are enforced before inflate, including aggregate size and entry count',()=>{
 const bytes=buildZip([{name:'a',data:'1234567890'},{name:'b',data:'1234567890'}]);assert.throws(()=>readZip(bytes,{maxTotalBytes:15}),/budget/);assert.throws(()=>readZip(bytes,{maxEntries:1}),/entries/);
 const malicious=Buffer.from(bytes),central=malicious.readUInt32LE(malicious.length-22+16);malicious.writeUInt32LE(0x7fffffff,central+24);assert.throws(()=>inspectDcmotion(malicious),/budget/);
});
test('ZIP symlinks, local/central confusion and corrupted bytes are refused',()=>{
 const bytes=buildZip([{name:'manifest.json',data:'{"format":"dcmotion"}'}]),central=bytes.readUInt32LE(bytes.length-22+16),link=Buffer.from(bytes);link.writeUInt32LE((0o120777<<16)>>>0,central+38);assert.throws(()=>inspectDcmotion(link),/links/);
 const confused=Buffer.from(bytes);confused[30]^=1;assert.throws(()=>inspectDcmotion(confused),/mismatch/);
 const corrupt=Buffer.from(bytes);corrupt.writeUInt32LE(0,central+16);assert.throws(()=>inspectDcmotion(corrupt),/checksum/);
});
