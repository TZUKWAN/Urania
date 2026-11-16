import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync} from 'node:zlib';
import {fromPNG,toPNG,createImage} from '../host/raster.js';
import {crc32} from '../host/zip.js';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function chunk(type,data){const b=Buffer.alloc(12+data.length);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,-4)),b.length-4);return b;}
function png(raw,color=6,extra=[]){const hdr=Buffer.alloc(13);hdr.writeUInt32BE(1);hdr.writeUInt32BE(1,4);hdr[8]=8;hdr[9]=color;return Buffer.concat([signature,chunk('IHDR',hdr),...extra,chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
test('nonuniform rows round-trip without pixel drift',()=>{
 const original=createImage(17,9);for(let i=0;i<original.data.length;i++)original.data[i]=(i*31)%256;
 assert.deepEqual(fromPNG(toPNG(original)).data,original.data);
});
test('decompression cannot exceed declared pixel data',()=>{assert.throws(()=>fromPNG(png(Buffer.alloc(256*1024))),/large|length|buffer/i);});
test('a forged huge palette chunk fails before allocation',()=>{const b=png(Buffer.from([0,255,0,0,255]));b.writeUInt32BE(0x7fffffff,33);b.write('PLTE',37);assert.throws(()=>fromPNG(b),/truncated|CRC/);});
test('corrupt CRC and invalid row filter are rejected',()=>{
 const b=png(Buffer.from([0,255,0,0,255]));b[20]^=1;assert.throws(()=>fromPNG(b),/CRC/);
 assert.throws(()=>fromPNG(png(Buffer.from([7,255,0,0,255]))),/filter/);
});
test('RGB transparent color key is preserved',()=>{
 const image=fromPNG(png(Buffer.from([0,255,0,0]),2,[chunk('tRNS',Buffer.from([0,255,0,0,0,0]))]));
 assert.deepEqual([...image.data],[255,0,0,0]);
});
test('all image constructors share a bounded dimension check',()=>{
 for(const size of [[-1,2],[NaN,2],[Infinity,2],[100000,100000],[0,2]])assert.throws(()=>createImage(...size),/尺寸|预算/);
});
