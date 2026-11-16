// before/after are actual native legacy_svg test captures, not synthesized files.
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {assertVectorLegacyContentOnly,nativeVectorHeader} from '../host/native-vector-header.js';
const load=name=>readFileSync(new URL('./fixtures/vector-legacy-native/'+name,import.meta.url));
const before=load('before.vectorcraft'),after=load('after.vectorcraft'),origin={projectId:'project-fixture',previousAssetId:'asset-original',assetId:'asset-edited'};
function nodes(header){
 const found=new Map();function walk(items){for(const n of items){found.set(String(n.id),n);if(n.kind?.children)walk(n.kind.children);}}walk(header.document.layers);return found;
}
function modify(bytes,mutate){
 const marker=Buffer.from([10,0,86,67,66,76,79,66,83,0]),at=bytes.indexOf(marker),header=JSON.parse(at<0?bytes:bytes.subarray(0,at));
 mutate(header,nodes(header));return Buffer.concat([Buffer.from(JSON.stringify(header)),at<0?Buffer.alloc(0):bytes.subarray(at)]);
}
const expectedKind=structuredClone(nodes(nativeVectorHeader(after)).get('6').kind);
test('actual native legacy replacement has the same surrounding poster and authorized source',()=>{
 assert.equal(nodes(nativeVectorHeader(before)).get('6').kind.type,'group');
 assert.equal(nodes(nativeVectorHeader(after)).get('6').kind.type,'placeddocument');
 assert.doesNotThrow(()=>assertVectorLegacyContentOnly(before,after,'6',origin,expectedKind));
 const reordered=Object.fromEntries(Object.entries(expectedKind).reverse());
 assert.doesNotThrow(()=>assertVectorLegacyContentOnly(before,after,'6',origin,reordered));
});
test('legacy proof rejects unrelated object changes or foreign source attribution',()=>{
 const unrelated=modify(after,(_doc,n)=>{n.get('12').opacity=0.5;});
 const shifted=modify(after,(_doc,n)=>{n.get('6').kind.xf[4]+=10;});
 const extra=modify(after,doc=>{doc.images['unrelated-injected']={mime:'image/png',data:'AA=='};});
 assert.throws(()=>assertVectorLegacyContentOnly(before,unrelated,'6',origin,expectedKind));
 assert.throws(()=>assertVectorLegacyContentOnly(before,shifted,'6',origin,expectedKind),/边框/);
 assert.throws(()=>assertVectorLegacyContentOnly(before,extra,'6',origin,expectedKind),/无关/);
 assert.throws(()=>assertVectorLegacyContentOnly(before,after,'6',origin,{...expectedKind,page:2}));
 assert.throws(()=>assertVectorLegacyContentOnly(before,after,'6',{...origin,assetId:'asset-foreign'},expectedKind));
 assert.throws(()=>assertVectorLegacyContentOnly(before,before,'6',origin,expectedKind));
});
