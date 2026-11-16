import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {nativeVectorHeader} from '../host/native-vector-header.js';
import {verifyLegacyVectorBinding} from '../host/native-vector-legacy.js';

const read=name=>readFileSync(fileURLToPath(new URL('./fixtures/vector-legacy-svg/'+name,import.meta.url)));
const provenance=JSON.parse(read('provenance.json'));
function find(doc,id){
 let result;
 function walk(nodes){for(const node of nodes){if(String(node.id)===id)result=node;if(node.kind?.children)walk(node.kind.children);}}
 walk(doc.document.layers);return result;
}
function fixture(){
 const binding=structuredClone(provenance.binding),receipt=structuredClone(provenance.receipt),asset=structuredClone(provenance.asset);
 const boundNode=find(nativeVectorHeader(read('bound.vectorcraft')),binding.nativeId),currentNode=find(nativeVectorHeader(read('current.vectorcraft')),binding.nativeId);
 assert(boundNode&&currentNode);
 return {binding,receipt,asset,boundRevision:binding.boundAtRevision,boundNode,currentNode,instances:{[binding.id]:binding}};
}
const hash=node=>createHash('sha256').update(JSON.stringify(node)).digest('hex');

test('an actual unchanged legacy SVG group matches its durable native placement record',()=>{
 const input=fixture();assert.equal(hash(input.boundNode),input.binding.nativeNodeHash);assert.equal(hash(input.currentNode),input.binding.nativeNodeHash);
 assert.deepEqual(verifyLegacyVectorBinding(input),{nativeId:input.binding.nativeId,assetId:input.asset.id,boundAtRevision:input.boundRevision});
});
test('legacy preflight refuses changed contents, a mismatched receipt and a wrong asset',()=>{
 for(const alter of [
  x=>{x.currentNode.kind.children[0].opacity=0.5;},
  x=>{x.receipt.assetId='asset-foreign';},
  x=>{x.receipt.nativeId=999;},
  x=>{x.asset.id='asset-foreign';},
  x=>{x.boundRevision='f'.repeat(64);},
  x=>{x.binding.originToken='a'.repeat(32);}
 ]){const input=fixture();alter(input);assert.throws(()=>verifyLegacyVectorBinding(input));}
});
test('a separate tracked descendant or pre-existing native material origin blocks migration',()=>{
 const descendant=fixture();const child=descendant.currentNode.kind.children[0];
 descendant.instances.other={id:'use-other',sourceId:descendant.binding.sourceId,nativeId:String(child.id)};
 assert.throws(()=>verifyLegacyVectorBinding(descendant),/其他已登记使用处/);
 const marked=fixture();const marker=JSON.stringify({schema:1,projectId:'project-test',assetId:'asset-test',instanceId:'a'.repeat(32)});
 for(const root of [marked.boundNode,marked.currentNode]){const child=root.kind.children[0];child.attrs={...(child.attrs||{}),data:[...(child.attrs?.data||[]),['dsh-material-v1',marker]]};}
 marked.binding.nativeNodeHash=hash(marked.boundNode);assert.equal(hash(marked.currentNode),marked.binding.nativeNodeHash);
 assert.throws(()=>verifyLegacyVectorBinding(marked),/独立素材来源/);
});
