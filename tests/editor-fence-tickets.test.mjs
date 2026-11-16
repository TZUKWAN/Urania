// Pure fence-cache tests with actual recorded Photo state; not live LLM/native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EditorFenceTickets} from '../host/editor-fence-tickets.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/editor-long-selection-20261113.json',import.meta.url)));
const session='unit-fence-session',view=fixture.view;
const call=base=>({action:'execute',sourceId:view.sourceId,epoch:view.epoch,base,payload:{command:'layer.setProps',params:{layer:3,opacity:.65}}});
test('actual long Photo state becomes a compact opaque stamp and restores the exact issued bytes',()=>{
 const cache=new EditorFenceTickets(),original=JSON.stringify(view);const compact=cache.issue(session,view);assert.ok(view.base.selectionStamp.length>3000);assert.match(compact.selectionStamp,/^ctx-v1-[a-f0-9]{64}$/);assert.equal(JSON.stringify(view),original);assert.deepEqual(cache.resolve(session,call(compact)).base,view.base);
});
test('session, source, epoch, complete base fields and ticket integrity remain bound',()=>{
 const cache=new EditorFenceTickets(),base=cache.issue(session,view),args=call(base);
 for(const [who,value] of [[session+'-other',args],[session,{...args,sourceId:'other-source'}],[session,{...args,epoch:'other-epoch'}],[session,{...args,base:{...base,revision:999}}],[session,{...args,base:{...base,selectionStamp:base.selectionStamp+'0'}}],[session,{...args,base:{...base,selection:[999]}}]])assert.throws(()=>cache.resolve(who,value),error=>error.status===409);
});
test('issued snapshots are immutable; resolution never substitutes a newer live base',()=>{
 const cache=new EditorFenceTickets(),live=structuredClone(view),old=structuredClone(live.base),ticket=cache.issue(session,live);live.base.revision=987;live.base.selectionStamp='a new actual selection';cache.issue(session,live);assert.deepEqual(cache.resolve(session,call(ticket)).base,old,'the existing manager/frame must see and reject the old base, not a silently refreshed one');
});
test('bounded cache eviction and legacy raw base compatibility are explicit',()=>{
 const cache=new EditorFenceTickets({maxEntries:2,maxBytes:128*1024}),first=cache.issue(session,view);cache.issue(session,{...view,epoch:'next-epoch'});cache.issue(session,{...view,epoch:'last-epoch'});assert.throws(()=>cache.resolve(session,call(first)),e=>e.status===409);const raw=call(structuredClone(view.base));assert.equal(cache.resolve(session,raw),raw);assert.ok(cache.entries.size<=2);
});
test('large exact uint64 identities are preserved when a compact fence is resolved',()=>{
 const v={...view,base:{...view.base,uid:'18446744073709551614',revision:'9007199254740994',selection:['18446744073709551613']}};const cache=new EditorFenceTickets(),ticket=cache.issue(session,v);assert.deepEqual(cache.resolve(session,call(ticket)).base,v.base);assert.throws(()=>cache.resolve(session,call({...ticket,uid:'18446744073709551613'})),e=>e.status===409);
});
