import test from 'node:test';
import assert from 'node:assert/strict';
import {previewImageSize} from '../host/image-header.js';
import {createImage,toPNG} from '../host/raster.js';
test('inline preview admits a real bounded PNG without changing its bytes',()=>{const png=toPNG(createImage(8,6,[1,2,3,255]));const copy=Buffer.from(png);assert.deepEqual(previewImageSize(png),{width:8,height:6});assert.deepEqual(png,copy);});
test('oversized dimensions and malformed JPEG lengths are rejected before image decode',()=>{const png=toPNG(createImage(1,1));png.writeUInt32BE(100000,16);assert.throws(()=>previewImageSize(png),error=>error.status===413);assert.throws(()=>previewImageSize(Buffer.from([255,216,255,224,0,0])),/长度/);assert.throws(()=>previewImageSize(Buffer.from('<svg/>')),error=>error.status===415);});
