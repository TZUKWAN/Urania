/** DesignCraft client pure-function tests (no DOM/canvas needed). */
import { normalizeDoc, normalizeLayer, normalizePage, resolveColor, withAlpha, hitTest, layerBounds, flattenLayers } from '../client/engine.js';
import { transformPathData } from '../client/svgtools.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
	if (cond) { pass++; console.log('PASS', name); }
	else { fail++; console.log('FAIL', name, extra); }
}

// doc normalization
const doc = normalizeDoc({ title: 'T', type: 'deck', canvas: { width: 800 }, pages: [{ layers: [{ type: 'text', text: 'hi' }, { type: 'unknown-type' }, null] }] });
check('normalizeDoc defaults', doc.canvas.width === 800 && doc.canvas.height === 720);
check('normalizePage id assigned', !!doc.pages[0].id);
check('normalizeLayer coerces', doc.pages[0].layers[0].type === 'text' && doc.pages[0].layers[0].fontSize === 24);
check('unknown layer → shape', doc.pages[0].layers[1].type === 'shape');
check('null layer dropped', doc.pages[0].layers.length === 2);

const img = normalizeLayer({ type: 'image', asset: 'a.png', x: 10, opacity: 2, filters: [{ kind: 'blur', amount: 4 }] });
check('image layer coerce', img.opacity === 1 && img.filters.length === 1 && img.adjust === null);

// colors
check('resolveColor var', resolveColor('var(--color-primary)', { colors: { primary: '#123456' } }) === '#123456');
check('resolveColor named', resolveColor('white', null) === '#FFFFFF');
check('resolveColor passthrough', resolveColor('#ABCDEF', null) === '#ABCDEF');
check('withAlpha hex', /^#0000004d$/i.test(withAlpha('#000000', 0.3)));
check('withAlpha rgba', withAlpha('rgb(10,20,30)', 0.5) === 'rgba(10,20,30,0.5)');

// hit test
const page = { layers: [
	{ id: 'a', type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100 },
	{ id: 'b', type: 'shape', shape: 'rect', x: 50, y: 50, w: 100, h: 100, hidden: false },
	{ id: 'c', type: 'shape', shape: 'rect', x: 200, y: 200, w: 10, h: 10, hidden: true }
] };
check('hitTest topmost', hitTest(page, 60, 60)?.id === 'b');
check('hitTest miss', hitTest(page, 300, 300) === null);
check('hitTest skips hidden', hitTest(page, 205, 205) === null);

// bounds & flatten
const group = normalizeLayer({ type: 'group', x: 0, y: 0, w: 0, h: 0, children: [
	{ type: 'shape', shape: 'rect', x: 10, y: 10, w: 20, h: 20 },
	{ type: 'group', children: [{ type: 'shape', shape: 'rect', x: 100, y: 100, w: 10, h: 10 }] }
] });
check('group bounds', (() => { const b = layerBounds(group); return b.x === 10 && b.y === 10 && b.w === 100 && b.h === 100; })());
check('flatten', flattenLayers([group]).length === 2);

// path transform
const moved = transformPathData('M 10 10 L 20 10 L 20 20 Z', [1, 0, 0, 1, 5, 7]);
check('transformPathData translate', moved.includes('M 15 17') && moved.includes('L 25 17') && moved.includes('Z'));
check('transformPathData identity passthrough', transformPathData('M 1 2 L 3 4', [1, 0, 0, 1, 0, 0]) === 'M 1 2 L 3 4' || transformPathData('M 1 2 L 3 4', [1, 0, 0, 1, 0, 0]).replace(/\s+/g, ' ') === 'M 1 2 L 3 4');
const scaled = transformPathData('M 10 10 L 30 10', [2, 0, 0, 2, 0, 0]);
check('transformPathData scale', scaled.includes('M 20 20') && scaled.includes('L 60 20'));

console.log(`\n=== CLIENT TESTS: ${pass} pass, ${fail} fail ===`);
process.exit(fail ? 1 : 0);
