import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as store from '../host/docstore.js';
import {LegacyMigration} from '../host/legacy-migration.js';
import {readZip} from '../host/zip.js';
import {nativeDeckPackage} from '../host/deck-source.js';

test('old-work migration keeps exact backup, reports missing assets and detects stale or corrupted data',async()=>{
 const root=await mkdtemp(join(tmpdir(),'legacy-migration-')),photo=await readFile(new URL('./fixtures/instance-old.pcraft',import.meta.url));
 store.saveAsset(root,'original.pcraft',photo);
 const saved=store.createDoc(root,{id:'old',title:'旧作品',type:'canvas',canvas:{width:80,height:60},pages:[{id:'p',layers:[{id:'image',type:'image',asset:'missing.png',x:0,y:0,w:40,h:30,native:{engine:'photocraft',source:'original.pcraft'}}]}]});
 const raw=await readFile(join(root,'design/old.dc.json')),migration=new LegacyMigration(root),plan=await migration.snapshot('old',saved.revision);
 assert.deepEqual(plan.missing,['missing.png']);assert.equal(plan.items.length,1);assert.equal(plan.items[0].engine,'photocraft');
 const archived=new Map(readZip(await migration.backup(plan.id)).map(row=>[row.name,row.data]));
 assert.deepEqual(archived.get('original/old.dc.json'),raw);assert.deepEqual(archived.get('original/assets/original.pcraft'),photo);
 assert.deepEqual((await migration.item(plan.id,plan.items[0].id,plan.items[0].sha256)).bytes,photo);
 const current=store.readDoc(root,'old');store.writeDoc(root,'old',{...current.doc,title:'手工修改'},'manual',{baseRevision:current.revision});const manualBytes=await readFile(join(root,'design/old.dc.json'));
 await assert.rejects(migration.snapshot('old',saved.revision),/旧作品已改变/);
 assert.deepEqual(await readFile(join(root,'design/old.dc.json')),manualBytes);
 const backup=migration.file(plan.id,'original.zip');const damaged=await readFile(backup);damaged[damaged.length-1]^=1;await writeFile(backup,damaged);
 await assert.rejects(migration.backup(plan.id),/完整性失败/);
 assert.equal(store.readDoc(root,'old').doc.title,'手工修改');
});

test('old editable slide content produces a real native deck migration item',async()=>{
 const root=await mkdtemp(join(tmpdir(),'legacy-deck-'));
 const saved=store.createDoc(root,{id:'old-deck',title:'旧演示',type:'deck',canvas:{width:320,height:240},pages:[{id:'p',name:'第一页',background:{kind:'solid',color:'#ffffff'},layers:[{id:'t',type:'text',text:'可编辑演示',x:20,y:20,w:220,h:40,fontSize:24,color:'#222222'},{id:'s',type:'shape',shape:'rect',x:20,y:90,w:80,h:50,fill:'#287d6c'}]}]});
 const migration=new LegacyMigration(root),plan=await migration.snapshot('old-deck',saved.revision),item=plan.items.find(row=>row.kind==='deck-composition');
 assert.ok(item,JSON.stringify(plan.warnings));const result=await migration.item(plan.id,item.id,item.sha256),deck=nativeDeckPackage(result.bytes);
 assert.ok(deck.model.presentation.slides.length>0);assert.equal(store.readDoc(root,'old-deck').revision,saved.revision);
});
