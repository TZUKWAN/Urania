import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSvg} from '../host/svgtools.js';
test('standard default fill and opacity remain valid document values',()=>{
 const r=parseSvg('<svg width="20" height="20"><rect width="10" height="10"/></svg>');
 assert.equal(r.layers.length,1);assert.equal(r.layers[0].paths[0].fill,'#000000');assert.equal(r.layers[0].opacity,1);
});
test('nested opacity is multiplied exactly once',()=>{
 const r=parseSvg('<svg><g opacity="0.5"><rect width="10" height="10" opacity="0.5"/></g></svg>');
 assert.equal(r.layers[0].opacity,.25);
});
test('data-fill attributes do not masquerade as actual fill',()=>{
 const r=parseSvg('<svg><rect data-fill="#ff0000" width="10" height="10"/></svg>');assert.equal(r.layers[0].paths[0].fill,'#000000');
});
