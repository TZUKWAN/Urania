// Protocol-v2 host contract. The historical v1 runner is preserved in the pre-implementation snapshot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executeCommands,catalog} from '../host/commands.js';
import {readDoc} from '../host/docstore.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});
test('v2 common commands create and edit real document structure with a revision',t=>{
 const root=mkdtempSync(join(base,'host-v2-'));t.after(()=>{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
 const result=executeCommands(root,[{op:'deck.fromOutline',save:true,title:'真实结构',slides:[{layout:'titleContent',title:'当前页',bullets:['真实正文']}]}],{requireRevision:true,stopOnError:true});assert.ok(result.results.every(r=>r.ok),JSON.stringify(result));
 const {id}=result.results[0],before=readDoc(root,id);const edited=executeCommands(root,[{op:'doc.update',id,patch:{title:'已修改'}}],{requireRevision:true,baseRevisions:{[id]:before.revision}});assert.ok(edited.results.every(r=>r.ok));assert.equal(readDoc(root,id).doc.title,'已修改');
});
test('retired parser/render subsets are explicit failures, never successful native features',()=>{
 for(const op of ['image.op','vector.fromSvg','vector.addSvgToPage','psd.import','export.pptx','export.pdf','export.svg','export.html','task.enqueue']){const result=executeCommands(base,[{op}],{stopOnError:true});assert.equal(result.results[0].ok,false,op);assert.equal(result.results[0].status,410,op);assert.ok(!catalog().commands.includes(op),op);}
});
