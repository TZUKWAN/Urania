import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {designResourceCatalog,readDesignResource,applyDesignResource} from '../host/design-resources.js';
import {createDoc,readDoc,listDocHistory} from '../host/docstore.js';
test('bundled OpenDesign resources retain exact upstream text and checksums',()=>{
 const catalog=designResourceCatalog();assert.equal(catalog.length,5);
 const resource=readDesignResource('editorial');assert.ok(resource.content.includes('Design System Inspired by Editorial'));
 assert.equal(createHash('sha256').update(resource.content).digest('hex'),resource.sha256);
 assert.ok(resource.source.includes('12d970eacc8971150e3c76470d2a9afe16dc2ed1'));
 assert.throws(()=>readDesignResource('editorial','../../runtime-lock.json'));
});
test('OpenDesign tokens apply to existing objects with version protection and preserve native sources',t=>{
 const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'resource-'));
 t.after(()=>{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
 const native={engine:'photocraft',source:'retained.pcraft'};
 createDoc(root,{id:'design',canvas:{width:64,height:64},pages:[{id:'p',background:{kind:'solid',color:'#fff'},layers:[{id:'image',type:'image',x:0,y:0,w:20,h:20,asset:'image.png',native},{id:'text',type:'text',text:'Design',x:10,y:10,w:40,h:20}]}]});
 const before=readDoc(root,'design');applyDesignResource(root,'design','editorial',before.revision);
 const after=readDoc(root,'design');assert.equal(after.doc.designSystem.colors.bg,'#fbf7f0');assert.equal(after.doc.designSystem.colors.primary,'#9a5a2f');assert.equal(Object.keys(after.doc.designSystem.tokens).length,56);
 assert.deepEqual(after.doc.pages[0].layers[0].native,native);assert.equal(after.doc.pages[0].layers[1].text,'Design');assert.equal(after.doc.pages[0].layers[1].fontFamily,'var(--font-body)');
 assert.throws(()=>applyDesignResource(root,'design','clean',before.revision),e=>e.status===409);assert.ok(listDocHistory(root,'design').length>=1);
});
