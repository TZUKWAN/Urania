import test from 'node:test';
import assert from 'node:assert/strict';
import {vectorNodeHandles,vectorPointToDoc,editVectorNode,reboxVectorLayer} from '../client/vector-nodes.js';
import {parseSegments} from '../client/path.js';
const layer={id:'v',type:'vector',x:10,y:20,w:40,h:20,rotation:30,geometryBox:{x:0,y:0,w:20,h:10},paths:[{d:'M0 0 C0 10 20 10 20 0 Z',fill:'#f00'}]};
const near=(a,b)=>{assert.ok(Math.abs(a.x-b.x)<1e-8,JSON.stringify({a,b}));assert.ok(Math.abs(a.y-b.y)<1e-8,JSON.stringify({a,b}));};
test('control-node editing respects rotation and nonuniform object geometry',()=>{const control=vectorNodeHandles(layer).find(node=>node.type==='control');const point=vectorPointToDoc(layer,{x:3,y:4}),paths=editVectorNode(layer,control,point),segments=parseSegments(paths[0].d);assert.ok(Math.abs(segments[1][1]-3)<1e-8);assert.ok(Math.abs(segments[1][2]-4)<1e-8);assert.deepEqual(segments[1].slice(3),[20,10,20,0]);});
test('moving an anchor keeps its attached handles and closed endpoint together',()=>{const shape={...layer,rotation:0,x:0,y:0,w:20,h:10,paths:[{d:'M0 0 C0 10 20 10 20 0 C20 -4 0 -4 0 0 Z'}]},node=vectorNodeHandles(shape)[0],segments=parseSegments(editVectorNode(shape,node,{x:2,y:3})[0].d);assert.deepEqual(segments[0],['M',2,3]);assert.deepEqual(segments[1].slice(0,3),['C',2,13]);assert.deepEqual(segments[2].slice(3),[2,-1,2,3]);});
test('updating interaction bounds does not move any real path coordinate',()=>{const updated={...layer,paths:[{d:'M-5 -3 C2 15 23 11 30 2 Z'}]},boxed=reboxVectorLayer(updated);for(const point of [{x:-5,y:-3},{x:2,y:15},{x:30,y:2}])near(vectorPointToDoc(updated,point),vectorPointToDoc(boxed,point));});
