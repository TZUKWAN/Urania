import {shapePath,drawShapeLayer,drawTextLayer,drawTableLayer,drawChartLayer,paintToStyle,exportImagePixels} from './engine.js';
import {vectorMatrix} from './path.js';

const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const number=n=>{if(!Number.isFinite(n))throw new Error('SVG 几何含无效数值');return Math.abs(n)<1e-10?0:Number(n.toFixed(8));};
export class PathWriter{
 constructor(){this.beginPath();}
 beginPath(){this.path='';this.point=null;}
 moveTo(x,y){this.path+=`M${number(x)} ${number(y)}`;this.point={x,y};}
 lineTo(x,y){this.path+=`L${number(x)} ${number(y)}`;this.point={x,y};}
 closePath(){this.path+='Z';}
 rect(x,y,w,h){this.moveTo(x,y);this.lineTo(x+w,y);this.lineTo(x+w,y+h);this.lineTo(x,y+h);this.closePath();}
 ellipse(cx,cy,rx,ry,rotation,start,end,ccw=false){if(rotation)throw new Error('该椭圆变换尚未序列化');const full=Math.abs(end-start)>=Math.PI*2-1e-8,at=a=>({x:cx+Math.cos(a)*rx,y:cy+Math.sin(a)*ry}),a=at(start),b=at(full?start+Math.PI:end);if(!this.point)this.moveTo(a.x,a.y);else this.lineTo(a.x,a.y);this.path+=`A${number(rx)} ${number(ry)} 0 ${!full&&Math.abs(end-start)>Math.PI?1:0} ${ccw?0:1} ${number(b.x)} ${number(b.y)}`;if(full)this.path+=`A${number(rx)} ${number(ry)} 0 0 ${ccw?0:1} ${number(a.x)} ${number(a.y)}`;this.point=full?a:b;}
 arc(cx,cy,r,start,end,ccw=false){this.ellipse(cx,cy,r,r,0,start,end,ccw);}
 arcTo(x1,y1,x2,y2,r){if(!this.point){this.moveTo(x1,y1);return;}const a={x:this.point.x-x1,y:this.point.y-y1},b={x:x2-x1,y:y2-y1},la=Math.hypot(a.x,a.y),lb=Math.hypot(b.x,b.y);if(!r||!la||!lb){this.lineTo(x1,y1);return;}a.x/=la;a.y/=la;b.x/=lb;b.y/=lb;const angle=Math.acos(Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y))),t=r/Math.tan(angle/2);if(!Number.isFinite(t)){this.lineTo(x1,y1);return;}this.lineTo(x1+a.x*t,y1+a.y*t);const end={x:x1+b.x*t,y:y1+b.y*t};this.path+=`A${number(r)} ${number(r)} 0 0 ${a.x*b.y-a.y*b.x<0?1:0} ${number(end.x)} ${number(end.y)}`;this.point=end;}
}
const shapes=new Set(['rect','ellipse','circle','roundrect','roundedrectangle','triangle','diamond','pentagon','hexagon','star4','star5','star6','star8','arrow','arrowright','arrowleft','arrowup','arrowdown','plus','line','chevron']);
export function shapePathData(layer){if(!shapes.has(String(layer.shape||'rect').toLowerCase()))throw new Error('没有该形状的精确路径: '+layer.shape);const ctx=new PathWriter();shapePath(ctx,layer,layer.x,layer.y,layer.w,layer.h);return ctx.path;}

class SvgPaint extends PathWriter{
 constructor(shared){super();this.shared=shared;this.items=[];this.font='10px sans-serif';this.fillStyle='#000';this.strokeStyle='#000';this.lineWidth=1;this.textAlign='left';this.globalCompositeOperation='source-over';this.dash=[];this.measure=document.createElement('canvas').getContext('2d');}
 measureText(text){this.measure.font=this.font;return this.measure.measureText(text);}
 setLineDash(value){this.dash=value;}
 createLinearGradient(x1,y1,x2,y2){return this.gradient('linearGradient',{x1,y1,x2,y2});}
 createRadialGradient(fx,fy,r0,cx,cy,r){if(r0!==0)throw new Error('该径向渐变尚无精确 SVG 映射');return this.gradient('radialGradient',{fx,fy,cx,cy,r});}
 gradient(kind,attrs){const id='dc-gradient-'+this.shared.next++,stops=[],gradient={addColorStop:(offset,color)=>stops.push({offset,color}),toString:()=>{if(!gradient.saved){gradient.saved=true;this.shared.defs.push(`<${kind} id="${id}" gradientUnits="userSpaceOnUse" ${Object.entries(attrs).map(([k,v])=>`${k}="${number(v)}"`).join(' ')}>${stops.map(s=>`<stop offset="${number(s.offset)}" stop-color="${xml(s.color)}"/>`).join('')}</${kind}>`);}return `url(#${id})`;}};return gradient;}
 fill(){const path=`<path d="${this.path}" fill="${xml(this.fillStyle)}"/>`;if(this.globalCompositeOperation==='destination-out'){const id='dc-cut-'+this.shared.next++;this.shared.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${this.shared.width}" height="${this.shared.height}"><rect width="100%" height="100%" fill="white"/><path d="${this.path}" fill="black"/></mask>`);this.items=[`<g mask="url(#${id})">${this.items.join('')}</g>`];}else if(this.globalCompositeOperation==='source-over')this.items.push(path);else throw new Error('没有该合成运算的精确 SVG 映射');}
 stroke(){this.items.push(`<path d="${this.path}" fill="none" stroke="${xml(this.strokeStyle)}" stroke-width="${number(this.lineWidth)}"${this.dash.length?` stroke-dasharray="${this.dash.map(number).join(' ')}"`:''}/>`);}
 fillRect(x,y,w,h){this.beginPath();this.rect(x,y,w,h);this.fill();}
 strokeRect(x,y,w,h){this.beginPath();this.rect(x,y,w,h);this.stroke();}
 fillText(text,x,y){this.items.push(`<text x="${number(x)}" y="${number(y)}" style="font:${xml(this.font)};white-space:pre" text-anchor="${this.textAlign==='center'?'middle':this.textAlign==='right'?'end':'start'}" fill="${xml(this.fillStyle)}">${xml(text)}</text>`);}
}
const dataUrl=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(blob);});

export async function serializePageSvg(doc,page,{assetUrl}={}){
 if(!assetUrl)throw new Error('SVG 导出缺少素材作用域');const shared={defs:[],next:1,width:doc.canvas.width,height:doc.canvas.height};
 const color=(value,layer)=>{const ctx=new SvgPaint(shared);return xml(paintToStyle(ctx,value,layer.x,layer.y,layer.w,layer.h,doc.designSystem,1)||'none');};
 const paintAttrs=(fill,stroke,layer)=>`fill="${color(fill,layer)}"${stroke&&stroke!=='none'?` stroke="${color(stroke.color||stroke,layer)}" stroke-width="${number(stroke.width??2)}"${stroke.dash?.length?` stroke-dasharray="${stroke.dash.map(number).join(' ')}"`:''}`:''}`;
 const list=async layers=>{const out=[];for(const layer of layers||[]){if(layer.hidden)continue;
  if(layer.style&&Object.values(layer.style).some(v=>v&&v!=='none'))throw new Error('对象 '+(layer.name||layer.id)+' 的效果尚无精确 SVG 映射');
  let body='',clip='';
  if(layer.type==='native'&&layer.native?.engine==='vectorcraft'){
   const response=await fetch(assetUrl(layer.native.svg));if(!response.ok)throw new Error('原生矢量源无法读取');const raw=await response.text(),parsed=new DOMParser().parseFromString(raw,'image/svg+xml');if(parsed.querySelector('parsererror,script,foreignObject'))throw new Error('原生 SVG 源无效或包含活动内容');
   const prefix='native'+shared.next+++'-';for(const node of parsed.querySelectorAll('[id]'))node.id=prefix+node.id;
   for(const node of parsed.querySelectorAll('*'))for(const attr of [...node.attributes]){if(/^on/i.test(attr.name))throw new Error('原生 SVG 含活动属性');let v=attr.value.replace(/url\(#([^)]*)\)/g,(_,id)=>'url(#'+prefix+id+')');if(/(?:^|:)href$/.test(attr.name)){if(v.startsWith('#'))v='#'+prefix+v.slice(1);else if(!v.startsWith('data:'))throw new Error('原生 SVG 引用了外部素材，未生成不完整文件');}node.setAttribute(attr.name,v);}
   const svg=parsed.documentElement;svg.setAttribute('x',layer.x);svg.setAttribute('y',layer.y);svg.setAttribute('width',layer.w);svg.setAttribute('height',layer.h);svg.setAttribute('preserveAspectRatio','none');body=new XMLSerializer().serializeToString(svg);
  }else if(layer.type==='image'){
   const blob=await exportImagePixels(layer,doc),url=await dataUrl(blob),img=await createImageBitmap(blob),crop=layer.crop||{x:0,y:0,w:img.width,h:img.height};body=`<svg x="${layer.x}" y="${layer.y}" width="${layer.w}" height="${layer.h}" viewBox="${crop.x} ${crop.y} ${crop.w} ${crop.h}" preserveAspectRatio="none" overflow="hidden"><image width="${img.width}" height="${img.height}" href="${url}"/></svg>`;img.close();
  }else if(layer.type==='shape'||layer.type==='text'||layer.type==='table'||layer.type==='chart'){
   const ctx=new SvgPaint(shared);if(layer.type==='shape'){shapePathData(layer);drawShapeLayer(ctx,layer,doc.designSystem);}else if(layer.type==='text')drawTextLayer(ctx,layer,doc.designSystem);else if(layer.type==='table')drawTableLayer(ctx,layer,doc.designSystem);else drawChartLayer(ctx,layer,doc.designSystem);body=ctx.items.join('');
  }else if(layer.type==='vector'){
   const m=vectorMatrix(layer);body=`<g transform="matrix(${m.map(number).join(' ')})">${(layer.paths||[]).map(path=>`<path d="${xml(path.d)}" fill-rule="${path.fillRule==='evenodd'?'evenodd':'nonzero'}" ${paintAttrs(path.fill,path.stroke,layer.geometryBox||layer)}/>`).join('')}</g>`;
  }else if(layer.type==='group')body=await list(layer.children);
  else throw new Error('对象 '+(layer.name||layer.id)+' 尚不支持整页 SVG，未替换成位图');
  if(layer.mask&&layer.mask.kind!=='luminance'){
   const id='dc-clip-'+shared.next++,m=layer.mask;let shape;if(m.kind==='rect')shape=`<rect x="${layer.x+(m.x||0)}" y="${layer.y+(m.y||0)}" width="${m.w??layer.w}" height="${m.h??layer.h}"/>`;else if(m.kind==='ellipse')shape=`<ellipse cx="${layer.x+layer.w/2}" cy="${layer.y+layer.h/2}" rx="${layer.w/2}" ry="${layer.h/2}"/>`;else if(m.kind==='path')shape=`<path d="${xml(m.d)}" clip-rule="${m.fillRule==='evenodd'?'evenodd':'nonzero'}"/>`;else throw new Error('未知蒙版类型');shared.defs.push(`<clipPath id="${id}" clipPathUnits="userSpaceOnUse">${shape}</clipPath>`);clip=` clip-path="url(#${id})"`;
  }else if(layer.mask?.kind==='luminance'&&layer.type!=='image')throw new Error('矢量/组亮度蒙版尚无精确 SVG 映射');
  const rotate=layer.rotation?` transform="rotate(${layer.rotation} ${layer.x+layer.w/2} ${layer.y+layer.h/2})"`:'';
  out.push(`<g data-object-id="${xml(layer.id)}" opacity="${layer.opacity??1}"${rotate}${layer.blend&&layer.blend!=='normal'?` style="mix-blend-mode:${xml(layer.blend)}"`:''}>${clip?`<g${clip}>${body}</g>`:body}</g>`);
 }return out.join('');};
 const background={x:0,y:0,w:doc.canvas.width,h:doc.canvas.height},bg=typeof page.background==='string'?page.background:page.background?.kind==='solid'?page.background.color:page.background;
 const content=`<rect width="100%" height="100%" fill="${color(bg,background)}"/>`+await list(page.layers),svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${doc.canvas.width}" height="${doc.canvas.height}" viewBox="0 0 ${doc.canvas.width} ${doc.canvas.height}" style="isolation:isolate"><defs>${shared.defs.join('')}</defs>${content}</svg>`;
 if(svg.length>64*1024*1024)throw new Error('整页 SVG 超过64MB预算');return svg;
}
