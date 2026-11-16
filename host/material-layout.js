import {SafetyError} from './safety.js';
export const validLayoutPolicy=value=>value==='fixed'||/^fit-[0-8]$/.test(value);
export function sameCoordinate(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));}

// The chosen anchor is a point in the object's own frame. The user may rotate,
// crop or flip an instance without changing which local point stays fixed.
export function linkedFrame(node,engine,format,original,replacement,policy='fixed'){
 if(!validLayoutPolicy(policy))throw new SafetyError('未知的关联比例处理方式',422);
 if(policy==='fixed'||original.width*replacement.height===original.height*replacement.width)return null;
 const anchor=Number(policy.slice(4)),ax=(anchor%3)/2,ay=Math.floor(anchor/3)/2;
 if(engine==='deckcraft'){
  const frame=node.xfrm,fill=node.kind?.fill;
  if(!frame||!fill||![frame.x,frame.y,frame.w,frame.h].every(Number.isFinite)||frame.w<=0||frame.h<=0)throw new SafetyError('图片缺少可核对的原生外框',409);
  const [left,top,right,bottom]=fill.crop||[0,0,0,0];
  const ratio=(replacement.width*(1-left-right))/(replacement.height*(1-top-bottom));
  if(!Number.isFinite(ratio)||ratio<=0)throw new SafetyError('当前裁剪无法按锚点适配',409);
  const w=Math.min(frame.w,frame.h*ratio),h=w/ratio,angle=(frame.rot||0)*Math.PI/180;
  const dx=(ax-.5)*(frame.w-w)*(frame.flipH?-1:1),dy=(ay-.5)*(frame.h-h)*(frame.flipV?-1:1);
  const x=frame.x+(frame.w-w)/2+dx*Math.cos(angle)-dy*Math.sin(angle);
  const y=frame.y+(frame.h-h)/2+dx*Math.sin(angle)+dy*Math.cos(angle);
  if(![x,y,w,h].every(Number.isFinite))throw new SafetyError('适配结果超出原生外框范围',409);
  return {bounds:{x,y,w,h}};
 }
 const kind=node.kind;
 if(!kind||!['image','placeddocument'].includes(kind.type)||kind.xf?.length!==6)throw new SafetyError('海报素材缺少可核对的外框',409);
 const [a,b,c,d,e,f]=kind.xf,det=a*d-b*c;
 const w=Math.hypot(a,b)*kind.width,h=Math.hypot(c,d)*kind.height;
 if(![a,b,c,d,e,f,w,h,det].every(Number.isFinite)||Math.abs(det)<1e-12||w<=0||h<=0)throw new SafetyError('退化坐标不能按锚点适配',409);
 const ratio=replacement.width/replacement.height,newW=Math.min(w,h*ratio),newH=newW/ratio;
 const sx=newW/w,sy=newH/h;
 // O * scale * O^-1, around the requested original world-space anchor.
 const m00=(a*sx*d-b*c*sy)/det,m10=b*d*(sx-sy)/det,m01=a*c*(sy-sx)/det,m11=(a*d*sy-b*c*sx)/det;
 const px=e+ax*a*kind.width+ay*c*kind.height,py=f+ax*b*kind.width+ay*d*kind.height;
 const matrix=[m00,m10,m01,m11,px-m00*px-m01*py,py-m10*px-m11*py];
 const rx=format==='png'?kind.width/replacement.width:1,ry=format==='png'?kind.height/replacement.height:1;
 const xf=[a*rx*sx,b*rx*sx,c*ry*sy,d*ry*sy,e+a*kind.width*ax*(1-sx)+c*kind.height*ay*(1-sy),f+b*kind.width*ax*(1-sx)+d*kind.height*ay*(1-sy)];
 return {matrix,xf};
}
