import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import * as store from '../host/docstore.js';
import {forkVariant,adoptVariant,listVariants} from '../host/variants.js';
import {executeCommands} from '../host/commands.js';
import {JobSupervisor} from '../host/jobs.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||'tests/.work');mkdirSync(base,{recursive:true});
function setup(){const root=mkdtempSync(join(base,'variants-'));store.createDoc(root,{id:'original',title:'原作',type:'canvas',canvas:{width:320,height:240},pages:[{id:'p',layers:[{id:'text',type:'text',text:'base',x:20,y:80,w:200,h:30,fontSize:20},{id:'shape',type:'shape',shape:'rect',x:20,y:20,w:60,h:40,fill:'#f00'}]}]});return root;}
function edit(root,id,layerId,patch){const rev=store.readDoc(root,id).revision;const out=executeCommands(root,[{op:'layer.update',id,pageId:'p',layerId,patch}],{requireRevision:true,baseRevisions:{[id]:rev},stopOnError:true});assert.ok(out.results.every(r=>r.ok));}
test('editable variant adopts its real content and merges independent later manual edits',()=>{
 const root=setup(),fork=forkVariant({root,docId:'original',baseRevision:store.readDoc(root,'original').revision,label:'文字方案'});assert.throws(()=>adoptVariant({root,groupId:fork.group.id,variantDocId:fork.id}),/尚未编辑/);
 edit(root,fork.id,'text',{text:'实际方案内容'});edit(root,'original','shape',{x:72});const result=adoptVariant({root,groupId:fork.group.id,variantDocId:fork.id});assert.equal(result.doc.pages[0].layers[0].text,'实际方案内容');assert.equal(result.doc.pages[0].layers[1].x,72);assert.equal(result.doc.title,'原作');assert.ok(result.preservedConcurrentEdits);assert.equal(store.readDoc(root,fork.id).doc.pages[0].layers[0].text,'实际方案内容');
});
test('variant conflict refuses overwrite while preserving both original and branch',()=>{const root=setup(),fork=forkVariant({root,docId:'original',baseRevision:store.readDoc(root,'original').revision});edit(root,fork.id,'shape',{x:100});edit(root,'original','shape',{x:50});assert.throws(()=>adoptVariant({root,groupId:fork.group.id,variantDocId:fork.id}),/冲突/);assert.equal(store.readDoc(root,'original').doc.pages[0].layers[1].x,50);assert.equal(store.readDoc(root,fork.id).doc.pages[0].layers[1].x,100);});
test('concurrent real worker forks cannot silently lose a registered branch',async()=>{const root=setup(),fork=forkVariant({root,docId:'original',baseRevision:store.readDoc(root,'original').revision}),jobs=new JobSupervisor({concurrency:2});try{const results=await Promise.allSettled([1,2].map(n=>jobs.run('variant-fork',{root,docId:'original',baseRevision:store.readDoc(root,'original').revision,groupId:fork.group.id,label:'并行方案'+n})));const groups=listVariants({root,docId:'original'}).groups;for(const r of results)if(r.status==='fulfilled')assert.ok(groups[0].branches.some(b=>b.docId===r.value.id));else assert.equal(r.reason.status,409);assert.equal(new Set(groups[0].branches.map(b=>b.docId)).size,groups[0].branches.length);}finally{jobs.dispose();}});
