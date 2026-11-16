/** Read-only whole-document source inspection with explicit coverage gaps. */
import {createHash} from 'node:crypto';
import {colorContrast,opaqueColor,convertColor} from './color-contrast.js';
import {SafetyError,assertSafeJson} from './safety.js';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function color(value,engine){
 if(typeof value==='string')return opaqueColor(value);
 if(value&&typeof value==='object'){
  if(value.mods?.length)return null;
  if(value.base)return value.base.kind==='rgb'?color(value.base.rgb,engine):null;
  if(value.color&&typeof value.color==='object')return color(value.color,engine);
  if(engine==='photocraft'&&value.alpha===1&&String(value.mode).toLowerCase()==='rgb'&&Array.isArray(value.c)&&value.c.length===4)return color(value.c.slice(0,3),engine);
  if(engine==='deckcraft'&&['r','g','b','a'].every(key=>Number.isInteger(value[key])&&value[key]>=0&&value[key]<=255))return value.a===255?'#'+['r','g','b'].map(key=>value[key].toString(16).padStart(2,'0')).join('').toUpperCase():null;
  if(value.a!==undefined&&value.a!==1||value.alpha!==undefined&&value.alpha!==1)return null;
  for(const key of ['color','solid','rgba','hex','value'])if(typeof value[key]==='string'){const v=opaqueColor(value[key]);if(v)return v;}
  const rgb=Array.isArray(value)?value:value.r!==undefined?[value.r,value.g,value.b]:null;
  if(rgb&&rgb.length>=3&&rgb.slice(0,3).every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1)&&(rgb.length<4||rgb[3]===1))return '#'+rgb.slice(0,3).map(n=>Math.round(n*255).toString(16).padStart(2,'0')).join('').toUpperCase();
 }
 return null;
}
const textOf=node=>typeof node.text==='string'?node.text:typeof node.text?.text==='string'?node.text.text:typeof node.content==='string'&&/text|paragraph|span|run|heading/i.test(node.kind||node.type||'')?node.content:null;
export function auditDocumentColors(document,{background,sourceId=null,sourceRevision=null,engine='unknown'}={}){
 if(!document||typeof document!=='object')throw new SafetyError('当前没有可检查的真实文档快照',409);assertSafeJson(document);
 const defaultBackground=background?opaqueColor(background):null;if(background&&!defaultBackground)throw new SafetyError('画布背景须为不透明sRGB颜色',422);
 const findings=[],unknown=[],palette=new Map(),unmeasured=[];let nodes=0,textNodes=0;
 const readColor=value=>color(value,engine);
 const noteColor=(value,path)=>{const parsed=readColor(value);if(!parsed)return;const record=palette.get(parsed)||{hex:parsed,count:0,firstPath:path,oklch:convertColor(parsed,'oklch')};record.count++;palette.set(parsed,record);};
 const seen=new WeakSet();
 const walk=(value,path,inherited,inheritedProps={})=>{
  if(!value||typeof value!=='object')return;if(seen.has(value))return;seen.add(value);if(++nodes>30000||path.split('.').length>40)throw new SafetyError('整稿颜色检查超过节点或层级预算',413);
  if(Array.isArray(value)){value.forEach((item,index)=>walk(item,path+'.'+index,inherited,inheritedProps));return;}
  const explicitBackground=value.background??value.backgroundColor??value.style?.backgroundColor,ownBg=readColor(explicitBackground),transparent=typeof value.opacity==='number'&&value.opacity<1||typeof value.fill_opacity==='number'&&value.fill_opacity<1;
  let bg=transparent?null:explicitBackground!==undefined?(ownBg||null):inherited;
  const props={...inheritedProps,...value.defProps,...value.def_props,...value.style,...value.props};
  if(value.text&&typeof value.text==='object'&&value.fill!==undefined)bg=readColor(value.fill)||null;
  if(/raster|picture|image|video/i.test(String(value.kind||value.type||'')))unmeasured.push({path,reason:'pixel_content_or_occlusion_not_measured'});
  for(const key of ['fill','color','foreground','stroke','background','backgroundColor'])noteColor(value[key],path+'.'+key);
  const text=textOf(value);
  if(text?.trim()){
   textNodes++;const fg=readColor(value.color??value.foreground??value.text?.color??props.color??props.fill??value.fill),size=value.fontSize??value.font_size??value.text?.fontSize??props.fontSize??props.size_pt??props.size,weight=value.fontWeight??value.font_weight??value.text?.fontWeight??props.fontWeight??props.weight??(props.bold===true?700:undefined);
   const id=String(value.id??value.nativeId??path),common={id,path,text:text.slice(0,200),textTruncated:text.length>200};
   if(!fg||!bg)unknown.push({...common,reason:!fg?'text_color_unresolved_or_transparent':'background_unresolved_or_complex'});
   else{
    const result=colorContrast(fg,bg),pt=typeof size==='number'&&Number.isFinite(size)?size:null,bold=typeof weight==='number'?weight>=700:/bold/i.test(String(weight||'')),large=pt!==null&&(pt>=18||bold&&pt>=14),sizeKnown=pt!==null;
    findings.push({...common,foreground:fg,background:bg,fontSize:pt,fontSizeUnit:'source_units_require_engine_confirmation',fontWeight:weight??null,wcagRatio:result.ratio,wcagAA:{normalText:result.thresholds.aaNormalText,largeText:result.thresholds.aaLargeText,classification:sizeKnown?(large?'large_by_source_size':'normal_by_source_size'):'font_size_unknown'},apca:result.apca});
   }
  }
  for(const [key,child]of Object.entries(value))if(child&&typeof child==='object')walk(child,path+'.'+key,bg,props);
 };
 walk(document,'document',defaultBackground);
 return {schema:1,kind:'document-color-audit',source:{sourceId,sourceRevision,engine,snapshotSha256:sha(document)},coverage:{nodesVisited:nodes,textNodes,measured:findings.length,unresolved:unknown.length,allTextColorsResolved:unknown.length===0&&textNodes>0},palette:[...palette.values()].sort((a,b)=>b.count-a.count),findings,unresolved:unknown,unmeasured,summary:{normalTextAABelow:findings.filter(f=>!f.wcagAA.normalText).length,largeTextAABelow:findings.filter(f=>!f.wcagAA.largeText).length},scope:'Source inspection of the entire saved native model. Gradients, images, transparency, inherited theme values, rendered overlap and unknown engine text metrics remain explicit unresolved cases; not a pixel-level accessibility certification.',conformanceCertified:false};
}
