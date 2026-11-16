import test from 'node:test';
import assert from 'node:assert/strict';
import {transformPathData} from '../client/svgtools.js';
import {parseSegments} from '../host/pptx.js';
import {createToolController} from '../client/tools.js';
import {normalizeDoc} from '../client/engine.js';
import {pathBounds} from '../client/path.js';
test('H/V and relative SVG coordinates survive an affine transform',()=>{
  const transformed=transformPathData('m1 2 h3 v4 h-3 z',[2,0,0,3,5,7]);
  assert.deepEqual(parseSegments(transformed),[['M',7,13],['L',13,13],['L',13,25],['L',7,25],['Z']]);
});
test('Bezier bounds include curve extrema',()=>{assert.deepEqual(pathBounds('M0 0 C0 100 100 100 100 0'),{x:0,y:0,w:100,h:75});});
test('normalization retains native extension and object identity metadata',()=>{
  const native={engine:'vectorcraft',source:'source.vectorcraft',objectIds:[3]};
  const normalized=normalizeDoc({id:'design',native,canvas:{width:32,height:32},pages:[{id:'p',native,layers:[{id:'v',type:'vector',native,paths:[{d:'M0 0 L1 1'}]}]}]});
  assert.deepEqual(normalized.native,native);assert.deepEqual(normalized.pages[0].native,native);assert.deepEqual(normalized.pages[0].layers[0].native,native);
});
test('pointer coordinates use the translated canvas rectangle once',()=>{
  const controller=createToolController({store:{get:()=>({ui:{zoom:2,panX:40,panY:30}})}});
  assert.deepEqual(controller.toDoc({clientX:120,clientY:90,currentTarget:{getBoundingClientRect:()=>({left:100,top:70})}}),{x:10,y:10});
});
