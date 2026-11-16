// Unsupported semantic conversion must fail visibly, rather than bake an approximation into an editable deck.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDeckPackage} from '../host/deck-native.js';
const document=layer=>({id:'work',canvas:{width:32,height:32},pages:[{id:'p',background:{kind:'solid',color:'#fff'},layers:[layer]}]});
test('unsupported common blend and isolated group opacity are rejected for native PPTX',()=>{
 for(const layer of [{id:'blend',type:'shape',shape:'rect',x:0,y:0,w:8,h:8,fill:'#f00',blend:'multiply'},{id:'group',type:'group',opacity:.5,children:[]}])assert.throws(()=>buildDeckPackage(document(layer)),error=>error.status===422);
});
