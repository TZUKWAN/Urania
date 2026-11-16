import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseSegments } from '../host/pptx.js';

test('cubic control points and endpoints retain SVG order', () => {
  assert.deepEqual(parseSegments('M0 0 C1 2 3 4 5 6'), [['M',0,0], ['C',1,2,3,4,5,6]]);
});
test('relative and repeated coordinates follow current point', () => {
  assert.deepEqual(parseSegments('m10 20 5 6 h2 v-3 z'), [['M',10,20], ['L',15,26], ['L',17,26], ['L',17,23], ['Z']]);
});
test('smooth cubic reflects the preceding second control point', () => {
  assert.deepEqual(parseSegments('M0 0 C1 2 3 4 5 6 S8 9 10 11')[2], ['C',7,8,8,9,10,11]);
});
test('smooth quadratic works after repeated T commands', () => {
  const s = parseSegments('M0 0 Q3 6 6 0 T12 0 18 0');
  assert.deepEqual(s.map(x=>x.slice(-2)), [[0,0],[6,0],[12,0],[18,0]]);
  assert.ok(Math.abs(s[2][2] + 4) < 1e-9);
  assert.ok(Math.abs(s[3][2] - 4) < 1e-9);
});
test('scientific notation is a number, not an SVG command', () => {
  assert.deepEqual(parseSegments('M1e2 -2E1 L.5 +3.'), [['M',100,-20], ['L',.5,3]]);
});
test('arc rotation is honored and all coordinates stay finite', () => {
  const a = parseSegments('M0 0 A20 10 45 0 1 30 0');
  const b = parseSegments('M0 0 A20 10 0 0 1 30 0');
  assert.notDeepEqual(a,b);
  assert.ok(a.flatMap(x=>x.slice(1)).every(Number.isFinite));
  assert.ok(Math.abs(a.at(-1).at(-2)-30)<1e-7);
});
test('missing operands, unsupported commands and bad arc flags reject', () => {
  for (const path of ['M0','M0 0 L1','M0 0 X1 2','M0 0 A10 10 0 2 0 4 5','M0 0 L1e999 2']) {
    assert.throws(()=>parseSegments(path), /SVG|path/i, path);
  }
});
test('close followed by coordinates terminates in a bounded child', () => {
  const moduleUrl = new URL('../host/pptx.js',import.meta.url).href;
  const code = `import{parseSegments}from ${JSON.stringify(moduleUrl)};try{parseSegments('M0 0 Z 1');process.exit(2)}catch(e){console.log(e.message)}`;
  const r=spawnSync(process.execPath,['--max-old-space-size=128','--input-type=module','-e',code],{timeout:800,encoding:'utf8',windowsHide:true});
  assert.equal(r.error,undefined);
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/SVG|path/i);
});
test('path input and segment budgets are enforced', () => {
  assert.throws(()=>parseSegments('M0 0 '+ 'L1 1 '.repeat(110000)),/limit|budget|large/i);
});
