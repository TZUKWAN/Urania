import test from 'node:test';
import assert from 'node:assert/strict';
import {colorContrast,convertColor,opaqueColor} from '../host/color-contrast.js';
import {auditDocumentColors} from '../host/document-color-audit.js';
test('WCAG black/white anchors and APCA polarity are computed from actual color inputs',()=>{
 const light=colorContrast('#000000','#FFFFFF'),dark=colorContrast('#FFFFFF','#000000'),equal=colorContrast('#FFFFFF','#FFFFFF');
 assert.equal(light.ratio,21);assert.equal(dark.ratio,21);assert.ok(Object.values(light.thresholds).every(Boolean));assert.ok(light.apca.lc>100);assert.ok(dark.apca.lc< -100);assert.equal(equal.ratio,1);assert.equal(equal.apca.lc,0);assert.equal(equal.thresholds.aaNormalText,false);assert.equal(light.apca.normative,false);
 assert.throws(()=>colorContrast('#0008','#ffffff'),e=>e.status===422);
});
test('OKLCH preserves neutral anchors and Display P3 roundtrips real red without renaming the API space',()=>{
 const white=convertColor('#ffffff','oklch'),black=convertColor('#000000','oklch');assert.ok(Math.abs(white.coords[0]-1)<1e-6);assert.ok(Math.abs(white.coords[1])<1e-6);assert.ok(Math.abs(black.coords[0])<1e-9);
 const p3=convertColor('#ff0000','display-p3');assert.equal(p3.space,'display-p3');assert.ok(p3.css.includes('display-p3'));const rgb=convertColor(p3.css,'srgb');assert.ok(Math.abs(rgb.coords[0]-1)<1e-4&&Math.abs(rgb.coords[1])<1e-4&&Math.abs(rgb.coords[2])<1e-4);
 assert.equal(convertColor('rgb(255 0 0 / 0.5)','oklch').alpha,.5);assert.equal(opaqueColor('rgb(255 0 0 / 0.5)'),null);assert.equal(opaqueColor('#f00'),'#FF0000');assert.equal(opaqueColor('rgb(255 0 0 / 1)'),'#FF0000');assert.ok(convertColor('rgb(255 0 0)','srgb').coords.every(v=>typeof v==='number'));
});
// Explicit hand-authored structural boundary fixture, not rendered-document acceptance.
test('structural color audit measures opaque text, reports complex backgrounds and never certifies conformance',()=>{
 const doc={background:'#FFFFFF',children:[{id:'clear',text:'可测文字',color:'#000000',fontSize:20},{id:'complex',background:{kind:'gradient'},children:[{id:'unknown',text:'复杂背景',color:'#000000'}]},{kind:'picture',name:'pixels-not-inspected'}]},before=JSON.stringify(doc),result=auditDocumentColors(doc);
 assert.equal(result.coverage.textNodes,2);assert.equal(result.findings.length,1);assert.equal(result.findings[0].wcagRatio,21);assert.equal(result.unresolved.length,1);assert.equal(result.unmeasured.length,1);assert.equal(result.conformanceCertified,false);assert.equal(JSON.stringify(doc),before);
});
test('native Deck integer RGBA and run properties are resolved without normalizing alpha 255 as opacity one',()=>{
 const fill=hex=>({kind:'solid',color:{base:{kind:'rgb',rgb:hex},mods:[]}}),white={r:255,g:255,b:255,a:255},black={r:0,g:0,b:0,a:255};
 const result=auditDocumentColors({background:fill(white),slides:[{shapes:[{id:2,text:{paragraphs:[{runs:[{text:'结构文字',props:{fill:fill(black),size:24}}]}]}}]}]},{engine:'deckcraft'});
 assert.equal(result.findings.length,1);assert.equal(result.findings[0].wcagRatio,21);assert.equal(result.findings[0].fontSize,24);
});
