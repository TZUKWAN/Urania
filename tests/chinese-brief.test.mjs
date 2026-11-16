import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDesignBrief} from '../host/opendesign-design-brief.js';
import {resolveDesignBrief as legacy} from '../host/opendesign-design-brief-v1.js';
const resolve=(brief,dimensions)=>resolveDesignBrief({title:'验收海报',brief,...(dimensions?{dimensions}:{})});
test('Chinese brief resolves palette, layout, density and exclusions with actual evidence spans',()=>{
 const brief='专业商务风，双栏布局，海军蓝与白，珊瑚色点缀，信息紧凑，标题与正文一致，不要动画和渐变。',spec=resolve(brief);
 assert.equal(spec.processorVersion,2);assert.equal(spec.dimensions.palette,'navy_and_white');assert.equal(spec.dimensions.layout,'two_column');assert.equal(spec.dimensions.accent,'coral');assert.equal(spec.dimensions.density,'compact');assert.equal(spec.dimensions.display,'same_as_body');assert.deepEqual(new Set(spec.dimensions.exclude),new Set(['animations','gradients']));
 assert.ok(spec.languageEvidence.length>5);for(const span of spec.languageEvidence)assert.equal(brief.slice(span.start,span.end),span.text);assert.equal(spec.provenance.palette,'chinese_keyword');
});
test('Chinese negation never silently picks a forbidden default, and explicit choices resolve ambiguity',()=>{
 const spec=resolve('浅色背景，避免暗色主题，不要动画和渐变。');assert.equal(spec.dimensions.palette,'light_clean');assert.ok(spec.negativeConstraints.palette.includes('monochrome_dark'));
 assert.throws(()=>resolve('不要浅色背景'),e=>e.status===422);assert.equal(resolve('不要浅色背景',{palette:'monochrome_dark'}).dimensions.palette,'monochrome_dark');
 assert.throws(()=>resolve('浅色背景，也要暗色背景'),e=>e.status===422);const explicit=resolve('浅色背景，也要暗色背景',{palette:'light_clean'});assert.equal(explicit.provenance.palette,'explicit');assert.ok(explicit.warnings.length);
});
test('opposing English and Chinese requirements report a conflict while an explicit dimension wins',()=>{
 assert.throws(()=>resolve('dark theme，浅色背景'),e=>e.status===422);assert.equal(resolve('dark theme，浅色背景',{palette:'light_clean'}).dimensions.palette,'light_clean');
 const spec=resolve('不要动画，但要保留渐变');assert.ok(spec.dimensions.exclude.includes('animations'));assert.ok(!spec.dimensions.exclude.includes('gradients'));
});
test('processor one retains exact historical interpretation and unknown Chinese remains disclosed',()=>{
 const input={title:'历史规范',brief:'minimal dark theme, no animations'};assert.deepEqual(resolveDesignBrief({...input,processorVersion:1}),legacy(input));
 const unknown=resolve('霓虹赛博，动态无限');assert.equal(unknown.languageEvidence.length,0);assert.ok(unknown.defaults.length>0);assert.ok(unknown.warnings.some(w=>w.includes('未识别')));
});
