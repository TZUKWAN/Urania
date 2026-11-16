import test from 'node:test';
import assert from 'node:assert/strict';
import {uint64,isUint64,sameUint64,compareUint64,uint64Parameter,encodeNativeJson,decodeNativeJson,nativeCallParameters} from '../client/native-protocol.js';

test('exact uint64 boundaries survive native JSON without converting numeric text',()=>{
 const source='{"uid":18446744073709551615,"revision":9007199254740993,"selection":[9007199254740995],"text":"18446744073709551615","escaped":"\\\" 9007199254740993","fraction":1.25,"exponent":1e20}';
 const decoded=decodeNativeJson(source);
 assert.equal(decoded.uid,'18446744073709551615');assert.equal(decoded.revision,'9007199254740993');assert.deepEqual(decoded.selection,['9007199254740995']);assert.equal(decoded.text,'18446744073709551615');assert.equal(decoded.escaped,'" 9007199254740993');assert.equal(decoded.fraction,1.25);assert.equal(decoded.exponent,1e20);
 const base={uid:decoded.uid,revision:decoded.revision,selection:decoded.selection};
 const wire=encodeNativeJson(nativeCallParameters('host.execute',{base,command:'paint.setFill',params:{id:uint64Parameter(decoded.selection[0]),text:decoded.text}}));
 assert.ok(wire.includes('"id":9007199254740995'));assert.ok(wire.includes('"text":"18446744073709551615"'));assert.equal(decodeNativeJson(wire).params.id,'9007199254740995');
 const bundle=encodeNativeJson(nativeCallParameters('host.bundle',{base,format:'svg'}));assert.ok(bundle.includes('"uid":18446744073709551615'));assert.deepEqual(decodeNativeJson(bundle).base,base);
});
test('identity equality and ordering remain exact above 2^53 and across decimal lengths',()=>{
 assert.equal(sameUint64(1,'1'),true);assert.equal(compareUint64('10','9'),1);assert.equal(compareUint64('9007199254740993','9007199254740992'),1);
 assert.equal(uint64('18446744073709551615'),'18446744073709551615');assert.equal(isUint64('18446744073709551616'),false);
 for(const value of [-1,Number.MAX_SAFE_INTEGER+1,'01','1e2','-1','1.0','',null])assert.equal(isUint64(value),false,String(value));
});
test('rounding, malformed atoms, cycles, invalid JSON and budget overflow fail before dispatch',()=>{
 assert.throws(()=>encodeNativeJson({id:9007199254740993}),/丢精度/);
 assert.throws(()=>encodeNativeJson({id:{$u64:'18446744073709551616'}}),/uint64/);
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>encodeNativeJson(cyclic),/循环/);
 assert.throws(()=>decodeNativeJson('{"x":01}'));assert.throws(()=>decodeNativeJson('{"x":1e999}'),/不可表示/);
 assert.throws(()=>encodeNativeJson({text:'中文中文'},{maxBytes:12}),/预算/);
 assert.throws(()=>decodeNativeJson('{"x":1}',{maxCharacters:3}),/预算/);
});
test('native save/receipt IDs are typed explicitly while source text and small integers stay compatible',()=>{
 const saved=encodeNativeJson(nativeCallParameters('host.saved',{uid:'18446744073709551615',revision:'9007199254740993',checkpoint:'a'.repeat(64)}));
 assert.ok(saved.includes('"uid":18446744073709551615'));assert.ok(saved.includes('"revision":9007199254740993'));
 assert.equal(encodeNativeJson({name:'u64:9007199254740993',small:12,optional:undefined}),'{'+'"name":"u64:9007199254740993","small":12}');
 assert.equal(encodeNativeJson(nativeCallParameters('host.file.finish',{id:'9007199254740999',ok:true})),'{"id":9007199254740999,"ok":true}');
 const other=decodeNativeJson(encodeNativeJson(nativeCallParameters('host.execute',{base:{uid:'9007199254740999',revision:2,engine:'photocraft',selectionStamp:'native-mask-context'},command:'example'})));
 assert.equal(other.base.uid,'9007199254740999');assert.equal(Object.hasOwn(other.base,'selection'),false,'A generic wire envelope must not invent a Vector object list for a raster mask');
});
