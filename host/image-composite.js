// Runs only in the supervised computation process, never on the DSH event loop.
import * as store from './docstore.js';
import {fromPNG,toPNG,createImage,resize} from './raster.js';
import {parseSegments} from '../client/path.js';
import {nativePoint} from '../client/selection.js';
import {SafetyError,assertPortableName} from './safety.js';

function load(root,name){assertPortableName(name);const bytes=store.readAsset(root,name);if(!bytes)throw new SafetyError('图像素材不存在',404);if(bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new SafetyError('精确像素处理需使用规范 PNG',422);if(bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>8_000_000)throw new SafetyError('局部重绘目前最多8MP，未移除资源保护',413);return fromPNG(bytes);}
export function prepareEditMask({root,sourceAsset,layer,region,name}){
 const source=load(root,sourceAsset),{width:w,height:h}=source,mask=createImage(w,h),guide=createImage(w,h);let supplied=null;
 if(region.kind==='mask'){supplied=load(root,region.maskAsset);if(supplied.width!==w||supplied.height!==h)throw new SafetyError('蒙版与原图尺寸不一致',422);}
 const target={...layer,naturalWidth:w,naturalHeight:h,native:{...layer.native,engine:'photocraft'}},points=[];
 if(region.kind==='path'){
  const segments=parseSegments(region.d);if(segments.some(s=>!['M','L','Z'].includes(s[0]))||segments.length>4000)throw new SafetyError('自由选区必须为实际套索多边形，未用曲线采样近似',422);
  let contour=[];for(const segment of segments){if(segment[0]==='M'){if(contour.length)points.push(contour);contour=[nativePoint(target,{x:segment[1],y:segment[2]},true)];}else if(segment[0]==='L')contour.push(nativePoint(target,{x:segment[1],y:segment[2]},true));else if(contour.length){points.push(contour);contour=[];}}if(contour.length)points.push(contour);
 }else if(region.kind==='rect'){const r=region;points.push([[r.x,r.y],[r.x+r.w,r.y],[r.x+r.w,r.y+r.h],[r.x,r.y+r.h]].map(([x,y])=>nativePoint(target,{x,y},true)));}
 else if(!supplied&&region.kind!=='ellipse')throw new SafetyError('没有可用的精确选区',422);
 if(!supplied&&region.kind!=='path'&&![region.x,region.y,region.w,region.h].every(Number.isFinite))throw new SafetyError('选区坐标无效',422);
 let count=0,minX=w,minY=h,maxX=-1,maxY=-1,soft=0;
 const put=(x,y,alpha)=>{if(!alpha)return;const i=(y*w+x)*4;mask.data[i]=mask.data[i+1]=mask.data[i+2]=255;mask.data[i+3]=alpha;count++;if(alpha<255)soft++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);};
 for(let y=0;y<h;y++){
  if(supplied){for(let x=0;x<w;x++){const i=(y*w+x)*4,a=region.encoding==='luminance'?Math.round((supplied.data[i]*.2126+supplied.data[i+1]*.7152+supplied.data[i+2]*.0722)*supplied.data[i+3]/255):supplied.data[i+3];put(x,y,a);}}
  else if(region.kind==='ellipse'){for(let x=0;x<w;x++){const p=nativePoint(target,{x:x+.5,y:y+.5}),u=(p.x-region.x-region.w/2)/(region.w/2),v=(p.y-region.y-region.h/2)/(region.h/2);if(u*u+v*v<=1)put(x,y,255);}}
  else{
   const crossings=[],yc=y+.5;for(const contour of points)for(let n=0;n<contour.length;n++){const a=contour[n],b=contour[(n+1)%contour.length];if((a.y<=yc&&b.y>yc)||(b.y<=yc&&a.y>yc))crossings.push({x:a.x+(yc-a.y)*(b.x-a.x)/(b.y-a.y),winding:b.y>a.y?1:-1});}
   crossings.sort((a,b)=>a.x-b.x);let winding=0;for(let n=0;n<crossings.length-1;n++){winding+=crossings[n].winding;if(winding){const start=Math.max(0,Math.ceil(crossings[n].x-.5)),end=Math.min(w,Math.ceil(crossings[n+1].x-.5));for(let x=start;x<end;x++)put(x,y,255);}}
  }
 }
 if(!count)throw new SafetyError('选区没有覆盖图片像素，未调用生成服务',422);
 for(let i=0;i<mask.data.length;i+=4){guide.data[i]=guide.data[i+1]=guide.data[i+2]=mask.data[i+3];guide.data[i+3]=255;}
 const maskAsset=store.saveAsset(root,name+'-mask.png',toPNG(mask)),guideAsset=store.saveAsset(root,name+'-guide.png',toPNG(guide));return {maskAsset:maskAsset.name,guideAsset:guideAsset.name,width:w,height:h,selectedPixels:count,softEdgePixels:soft,bounds:{x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1}};
}
export function composeEditOverlay({root,sourceAsset,resultAsset,maskAsset,name}){
 const source=load(root,sourceAsset),mask=load(root,maskAsset);let result=load(root,resultAsset);if(source.width!==mask.width||source.height!==mask.height)throw new SafetyError('选区尺寸与原图不一致',422);
 if(source.width!==result.width||source.height!==result.height){if(Math.abs(source.width/source.height-result.width/result.height)>.002)throw new SafetyError('服务改变了图像宽高比，未拉伸并覆盖原图',422);result=resize(result,source.width,source.height);}
 const overlay=createImage(source.width,source.height);for(let i=0;i<overlay.data.length;i+=4){const alpha=Math.round(result.data[i+3]*mask.data[i+3]/255);overlay.data[i]=result.data[i];overlay.data[i+1]=result.data[i+1];overlay.data[i+2]=result.data[i+2];overlay.data[i+3]=alpha;}
 const saved=store.saveAsset(root,name+'-overlay.png',toPNG(overlay));return {overlayAsset:saved.name,width:source.width,height:source.height};
}
export function verifyOutsideMask({root,sourceAsset,resultAsset,maskAsset}){
 const source=load(root,sourceAsset),result=load(root,resultAsset),mask=load(root,maskAsset);if(source.width!==result.width||source.height!==result.height||source.width!==mask.width||source.height!==mask.height)throw new SafetyError('原生重绘结果尺寸不一致',422);
 let outsidePixels=0,mismatchedOutside=0,changedInside=0;for(let i=0;i<source.data.length;i+=4){const changed=[0,1,2,3].some(c=>source.data[i+c]!==result.data[i+c]);if(!mask.data[i+3]){outsidePixels++;if(changed)mismatchedOutside++;}else if(changed)changedInside++;}
 if(mismatchedOutside)throw new SafetyError('原生结果改变了选区外 '+mismatchedOutside+' 个像素，结果未采用',422);if(!changedInside)throw new SafetyError('重绘没有改变选区内像素，未报告完成',422);return {outsidePixels,mismatchedOutside,changedInside,width:source.width,height:source.height};
}
