import {parseSegments,pathBounds,vectorMatrix} from './path.js';
const clone=value=>JSON.parse(JSON.stringify(value));
export function vectorPointToDoc(layer,point){
 const [sx,, ,sy,tx,ty]=vectorMatrix(layer),x=point.x*sx+tx,y=point.y*sy+ty,angle=(layer.rotation||0)*Math.PI/180,cx=layer.x+layer.w/2,cy=layer.y+layer.h/2;
 return {x:cx+(x-cx)*Math.cos(angle)-(y-cy)*Math.sin(angle),y:cy+(x-cx)*Math.sin(angle)+(y-cy)*Math.cos(angle)};
}
export function vectorPointFromDoc(layer,point){
 const [sx,,,sy,tx,ty]=vectorMatrix(layer);if(!sx||!sy)throw new Error('矢量缩放矩阵不可逆');
 const angle=-(layer.rotation||0)*Math.PI/180,cx=layer.x+layer.w/2,cy=layer.y+layer.h/2,x=cx+(point.x-cx)*Math.cos(angle)-(point.y-cy)*Math.sin(angle),y=cy+(point.x-cx)*Math.sin(angle)+(point.y-cy)*Math.cos(angle);
 return {x:(x-tx)/sx,y:(y-ty)/sy};
}
export function vectorNodeHandles(layer){
 if(layer?.type!=='vector')return [];
 const handles=[];
 for(const [pathIndex,path]of(layer.paths||[]).entries()){
  if(/[Aa]/.test(path.d))throw new Error('弧线请先通过原生引擎扩展为可编辑路径');
  const segments=parseSegments(path.d);let previous=null,start=null;
  for(let index=0;index<segments.length;index++){
   const segment=segments[index],kind=segment[0];
   const add=(offset,type,anchor)=>{
    if(handles.length>=1500)throw new Error('当前对象超过1500个控制柄，请拆分对象后编辑');
    const point={x:segment[offset],y:segment[offset+1]},doc=vectorPointToDoc(layer,point);handles.push({pathIndex,segmentIndex:index,offset,type,...doc,...(anchor?{anchor:vectorPointToDoc(layer,anchor)}:{})});
   };
   if(kind==='M'){add(1,'anchor');previous=start={x:segment[1],y:segment[2]};}
   else if(kind==='L'){const point={x:segment[1],y:segment[2]};if(!(segments[index+1]?.[0]==='Z'&&point.x===start.x&&point.y===start.y))add(1,'anchor');previous=point;}
   else if(kind==='C'){
    const end={x:segment[5],y:segment[6]};add(1,'control',previous);add(3,'control',end);
    if(!(segments[index+1]?.[0]==='Z'&&end.x===start.x&&end.y===start.y))add(5,'anchor');previous=end;
   }else if(kind==='Z')previous=start;
  }
 }
 return handles;
}
export function editVectorNode(original,handle,documentPoint){
 const layer=clone(original),path=layer.paths[handle.pathIndex];if(!path)throw new Error('路径已删除');
 if(/[Aa]/.test(path.d))throw new Error('弧线尚未扩展为贝塞尔路径');
 const segments=parseSegments(path.d),segment=segments[handle.segmentIndex];if(!segment||segment[handle.offset]==null)throw new Error('节点已变化');
 const point=vectorPointFromDoc(original,documentPoint),dx=point.x-segment[handle.offset],dy=point.y-segment[handle.offset+1];
 const shift=(segment,offset)=>{segment[offset]+=dx;segment[offset+1]+=dy;};
 if(handle.type==='anchor'){
  if(segment[0]==='C')shift(segment,3);
  const next=segments[handle.segmentIndex+1];if(next?.[0]==='C')shift(next,1);
  if(segment[0]==='M'){
   let end=handle.segmentIndex+1;while(end<segments.length&&!['M','Z'].includes(segments[end][0]))end++;
   const last=segments[end-1],offset=last?.[0]==='C'?5:last?.[0]==='L'?1:null;
   if(segments[end]?.[0]==='Z'&&offset!=null&&last[offset]===segment[1]&&last[offset+1]===segment[2]){if(last[0]==='C')shift(last,3);shift(last,offset);}
  }
 }
 segment[handle.offset]=point.x;segment[handle.offset+1]=point.y;path.d=segments.map(segment=>segment.join(' ')).join(' ');return layer.paths;
}
export function reboxVectorLayer(layer){
 const boxes=layer.paths.map(path=>pathBounds(path.d));if(!boxes.length)return layer;
 const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y)),w=Math.max(1,Math.max(...boxes.map(b=>b.x+b.w))-x),h=Math.max(1,Math.max(...boxes.map(b=>b.y+b.h))-y);
 const [sx,,,sy]=vectorMatrix(layer),center=vectorPointToDoc(layer,{x:x+w/2,y:y+h/2});
 return {...layer,geometryBox:{x,y,w,h},x:center.x-w*sx/2,y:center.y-h*sy/2,w:w*sx,h:h*sy};
}
