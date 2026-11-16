import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedFrame} from '../host/material-layout.js';
const from={width:320,height:240},to={width:240,height:400};
function point(matrix,x,y){return [matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];}
function close(a,b){assert(a.every((v,i)=>Math.abs(v-b[i])<1e-8),JSON.stringify([a,b]));}
test('nine local vector anchors survive a ratio change on a rotated, skewed object',()=>{
 const xf=[.9,.3,-.2,1.2,71,-9],node={kind:{type:'image',width:320,height:240,xf}};
 for(let i=0;i<9;i++){
  const ax=(i%3)/2,ay=Math.floor(i/3)/2,expected=point(xf,320*ax,240*ay);
  const changed=linkedFrame(node,'vectorcraft','png',from,to,'fit-'+i);
  close(point(changed.xf,240*ax,400*ay),expected);close(point(changed.matrix,...expected),expected);
  const w=Math.hypot(changed.xf[0],changed.xf[1])*240,h=Math.hypot(changed.xf[2],changed.xf[3])*400;
  assert(Math.abs(w/h-.6)<1e-12);assert(h<=Math.hypot(xf[2],xf[3])*240+1e-8);
 }
 assert.equal(linkedFrame(node,'vectorcraft','png',from,to,'fixed'),null);
});
test('rotated and reversed Deck frame holds the chosen anchor and respects the visible crop',()=>{
 const initial={x:23,y:36,w:250,h:160,rot:37,flipH:true},node={xfrm:initial,kind:{fill:{crop:[.1,0,.15,.08]}}};
 function anchor(f,ax,ay){
  const rad=initial.rot*Math.PI/180,dx=-(ax-.5)*f.w,dy=(ay-.5)*f.h;
  return [f.x+f.w/2+dx*Math.cos(rad)-dy*Math.sin(rad),f.y+f.h/2+dx*Math.sin(rad)+dy*Math.cos(rad)];
 }
 for(let i=0;i<9;i++){
  const ax=(i%3)/2,ay=Math.floor(i/3)/2,b=linkedFrame(node,'deckcraft','svg',from,to,'fit-'+i).bounds;
  close(anchor(b,ax,ay),anchor(initial,ax,ay));
  assert(Math.abs(b.w/b.h-(240*.75)/(400*.92))<1e-12);
 }
 assert.throws(()=>linkedFrame(node,'deckcraft','svg',from,to,'unused'));
});
