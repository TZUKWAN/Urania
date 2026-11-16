import test from 'node:test';
import assert from 'node:assert/strict';
import {createImage,composite,applyMask} from '../host/raster.js';
test('opaque multiply uses backdrop alpha, not backdrop color',()=>{const d=createImage(1,1,[128,128,128,255]);composite(d,createImage(1,1,[128,128,128,255]),{blend:'multiply'});assert.deepEqual([...d.data],[64,64,64,255]);});
test('transparent destination preserves unpremultiplied source RGB',()=>{const d=createImage(1,1);composite(d,createImage(1,1,[255,0,0,128]));assert.deepEqual([...d.data],[255,0,0,128]);});
test('half-alpha red over white gives the correct visible color',()=>{const d=createImage(1,1,[255,255,255,255]);composite(d,createImage(1,1,[255,0,0,128]));assert.deepEqual([...d.data],[255,127,127,255]);});
test('a translucent black luminance mask still hides the pixel',()=>{const d=createImage(1,1,[255,0,0,255]);applyMask(d,createImage(1,1,[0,0,0,128]));assert.equal(d.data[3],0);});
