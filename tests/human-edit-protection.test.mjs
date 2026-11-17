// Policy checks over real serializer fixtures and immutable history; not a native UI execution claim.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync,readFileSync,realpathSync} from 'node:fs';import {join,resolve,sep} from 'node:path';import {tmpdir} from 'node:os';
import {NativeSourceStore} from '../host/native-source-store.js';import {HumanEditProtection,protectionSnapshot} from '../host/human-edit-protection.js';import {nativeVectorHeader} from '../host/native-vector-header.js';
import {readZip} from '../host/zip.js';import {buildZip} from '../host/motion/package.js';
const raw=readFileSync(new URL('./fixtures/vector-web.vectorcraft',import.meta.url));
test('whole-page candidates retain human fields, non-target objects and deleted markers across later AI revisions',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'urania-human-fields-'))),store=new NativeSourceStore(root),protection=new HumanEditProtection({store:()=>store});
 try{
  const first=await store.commit('guarded',{engine:'vectorcraft',title:'真实格式策略验收',bytes:raw,engineState:{uid:1,revision:1},actor:'import'});
  const model=nativeVectorHeader(raw),nodes=protectionSnapshot('vectorcraft',raw).nodes,leafId=Object.keys(nodes).find(id=>!nodes[id].data.kind?.children&&!nodes[id].data.children);assert.ok(leafId);
  const find=(items,id)=>{for(const n of items){if(String(n.id)===id)return n;const found=find(n.kind?.children||n.children||[],id);if(found)return found;}};
  const human=structuredClone(model);find(human.document.layers,leafId).name='用户手工命名';
  const encoded=Buffer.from(JSON.stringify(human)),manual=await store.commit('guarded',{engine:'vectorcraft',title:'真实格式策略验收',bytes:encoded,baseRevision:first.revision,engineState:{uid:1,revision:2},actor:'manual'});
  const view={root,sourceId:'guarded',sourceRevision:manual.revision,engine:'vectorcraft'},job={beforeDocument:{selection:[Number(leafId)]}};
  const target={kind:'native',sourceId:'guarded',revision:manual.revision,objectIds:[],page:null};
  await assert.rejects(()=>protection.verify(view,job,raw,[target]),/人工字段/);
  const unchanged=await protection.verify(view,job,encoded,[target]);assert.ok(unchanged.checked&&unchanged.protectedFields>=1);
  await assert.rejects(()=>protection.verify(view,job,raw,[{...target,revision:first.revision,objectIds:[leafId]}]),/人工字段/,'an older object request cannot override later human edits');
  const allowed=await protection.verify(view,job,raw,[{...target,objectIds:[leafId]}]);assert.equal(allowed.checked,true,'a current explicit request for that object grants only that scope');
  const next=await store.commit('guarded',{engine:'vectorcraft',title:'真实格式策略验收',bytes:encoded,baseRevision:manual.revision,engineState:{uid:1,revision:3},actor:'ai'});view.sourceRevision=next.revision;
  await assert.rejects(()=>new HumanEditProtection({store:()=>store}).verify(view,job,raw,[{...target,revision:next.revision}]),/人工字段/,'manual protection survives host object reconstruction and later AI checkpoints');
 }finally{assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));rmSync(root,{recursive:true,force:true});}
});
test('all saved Deck pages are inspected rather than the current UI summary',()=>{const snapshot=protectionSnapshot('deckcraft',readFileSync(new URL('./fixtures/deck-web.deckcraft',import.meta.url)));assert.ok(Object.keys(snapshot.pages).length>=1);assert.ok(Object.keys(snapshot.nodes).length>=1);});
test('Photo raster tile fingerprints belong to actual layer identities',()=>{const old=protectionSnapshot('photocraft',readFileSync(new URL('./fixtures/instance-old.pcraft',import.meta.url))),edited=protectionSnapshot('photocraft',readFileSync(new URL('./fixtures/instance-edited.pcraft',import.meta.url)));assert.deepEqual(old.global,edited.global);assert.deepEqual(Object.keys(old.nodes),Object.keys(edited.nodes));assert.notDeepEqual(old.nodes['2'].data.content,edited.nodes['2'].data.content);});

test('navigation from an unrequested Deck page is allowed only when the whole native content stays identical',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'urania-feedback-navigation-'))),store=new NativeSourceStore(root),bytes=readFileSync(new URL('./fixtures/deck-web.deckcraft',import.meta.url)),snapshot=protectionSnapshot('deckcraft',bytes),pages=Object.keys(snapshot.pages);assert.ok(pages.length>=2);
 try{
  const head=await store.commit('navigation-deck',{engine:'deckcraft',title:'actual serializer fixture',bytes,engineState:{uid:1,revision:1},actor:'import'}),view={root,sourceId:'navigation-deck',sourceRevision:head.revision,engine:'deckcraft'},target={kind:'native',sourceId:view.sourceId,revision:head.revision,objectIds:[],page:{kind:'slide',id:pages[0].slice(6)}},job={beforeDocument:{page:{nativePage:{kind:'slide',id:pages[1].slice(6)}}},payload:{command:'slide.go',params:{id:{$u64:target.page.id}}}},guard=new HumanEditProtection({store:()=>store});
  const proof=await guard.verify(view,job,bytes,[target]);assert.equal(proof.checked,true);assert.equal(proof.changed,false);assert.equal(proof.navigationOnly,true);assert.deepEqual(proof.changedPages,[]);
  await assert.rejects(()=>guard.verify(view,{...job,payload:{command:'slide.go',params:{id:pages[1].slice(6)}}},bytes,[target]),/不属于/);
  const entries=readZip(bytes),entry=entries.find(e=>e.name==='presentation.json'),document=JSON.parse(entry.data);document.presentation.slides[0].shapes[0].name='unexpected content edit';entry.data=Buffer.from(JSON.stringify(document));const bad=buildZip(entries);await assert.rejects(()=>guard.verify(view,job,bad,[target]),/定位改变了原生内容/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
