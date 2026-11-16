// Converts the common workspace model to DeckCraft's documented native model.
// DeckCraft itself reads, validates and exports the package; no hand-written chart/PPTX surrogate.
import {writeFile,readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createZip} from './zip.js';
import {SafetyError,assertImageSize} from './safety.js';
import * as store from './docstore.js';
import {transformPathData,vectorMatrix} from '../client/path.js';
import {nativeDeckPackage,combineDeckSource} from './deck-source.js';
const pt=value=>value*.75;
const fail=(layer,message)=>{throw new SafetyError((layer?.name||layer?.id||'作品')+'：'+message,422);};
function resolveColor(value,system){
  if(typeof value==='string'&&value.startsWith('var(')){const token=value.match(/^var\(--color-([\w-]+)\)$/);value=token&&system?.colors?.[token[1]];}
  const source=String(value||'');let rgba;
  if(/^#[\da-f]{3}$/i.test(source))rgba=source.slice(1).split('').map(v=>parseInt(v+v,16));
  else if(/^#[\da-f]{6}([\da-f]{2})?$/i.test(source))rgba=source.slice(1).match(/../g).map(v=>parseInt(v,16));
  else {const match=source.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)(?:[, /]+([\d.]+))?\s*\)$/);if(match)rgba=[+match[1],+match[2],+match[3],Math.round((match[4]==null?1:+match[4])*255)];}
  if(!rgba)throw new SafetyError('未转换的颜色: '+source,422);
  return {base:{kind:'rgb',rgb:{r:rgba[0],g:rgba[1],b:rgba[2],a:rgba[3]??255}}};
}
function fill(value,system,opacity=1){
  if(value==null||value==='none')return {kind:'none'};
  if(typeof value==='object'&&['linear','radial'].includes(value.kind))return {kind:'gradient',stops:(value.stops||[]).map(([pos,color])=>({pos,color:withAlpha(resolveColor(color,system),opacity)})),shape:value.kind==='radial'?{kind:'path',path:'circle',focus:[.5,.5,.5,.5]}:{kind:'linear',angle:value.angle||0,scaled:true}};
  return {kind:'solid',color:withAlpha(resolveColor(typeof value==='object'?value.color:value,system),opacity*(value?.opacity??1))};
}
function withAlpha(color,opacity){if(opacity!==1)color.mods=[{op:'alpha',val:Math.round(opacity*100000)}];return color;}
function textBody(value,layer,system){
  let family=layer.fontFamily||system?.fonts?.body||'Microsoft YaHei';if(family.startsWith('var('))family=system?.fonts?.body||'Microsoft YaHei';family=family.split(',')[0].replace(/["']/g,'').trim();
  const props={font:family,fontEa:family,size:pt(layer.fontSize||24),bold:!!layer.bold,italic:!!layer.italic,fill:fill(layer.color||'#202936',system,layer.opacity??1),spacing:pt(layer.letterSpacing||0)};
  return {body:{insetL:0,insetR:0,insetT:0,insetB:0,anchor:layer.vAlign||'top',autofit:{kind:'none'},wrap:true},paragraphs:String(value??'').split(/\r?\n/).map(text=>({level:0,props:{align:layer.align||'left',lineSpacing:{kind:'pct',v:layer.lineHeight||1.4},bullet:layer.bullets?{kind:'char',char:'•'}:{kind:'none'}},runs:[{text,props}],endProps:props}))};
}
function dimensions(buffer){
  if(buffer.length>=24&&buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)};
  if(buffer[0]===255&&buffer[1]===216)for(let pos=2;pos+4<=buffer.length;){if(buffer[pos]!==255)break;let marker=buffer[pos+1];pos+=2;if(marker===217||marker===218)break;if(marker===216||marker===1)continue;const length=buffer.readUInt16BE(pos);if(length<2||pos+length>buffer.length)break;if([192,193,194].includes(marker)&&length>=7)return {width:buffer.readUInt16BE(pos+5),height:buffer.readUInt16BE(pos+3)};pos+=length;}
  throw new SafetyError('PPT 图片源需为有效 PNG/JPEG，其他格式请先用图片引擎导出',422);
}
function line(stroke,system,opacity){
  if(!stroke||stroke==='none'||stroke.width===0)return {fill:{kind:'none'}};
  if(stroke.dash?.length)throw new SafetyError('任意数值虚线尚无无损 PPT 映射',422);
  return {fill:fill(typeof stroke==='string'?stroke:stroke.color,system,opacity),width:pt(stroke.width??1)};
}

export function buildDeckPackage(doc,preparedAssets={},options={}){
  let id=options.idStart||100;const media=[],entries=[],map={};let mediaBytes=0;
  const system=doc.designSystem;
  function mediaFor(name,sizeOverride,contentType){
    const existing=media.find(item=>item.name===name);if(existing)return {id:existing.id,size:existing.size};
    const buffer=store.readAsset(doc.__root,name);if(!buffer)throw new SafetyError('图片源缺失: '+name,422);
    const size=sizeOverride||dimensions(buffer);assertImageSize(Math.ceil(size.width),Math.ceil(size.height));mediaBytes+=buffer.length;if(mediaBytes>128*1024*1024)throw new SafetyError('PPT 素材总量超过128MB预算',413);
    const item={id:id++,name,contentType:contentType||(/\.jpe?g$/i.test(name)?'image/jpeg':'image/png'),size};media.push(item);entries.push({name:'media/'+item.id,data:buffer});return {id:item.id,size};
  }
  function shapes(layers){return (layers||[]).flatMap(layer=>{
    if(layer.hidden)return [];
    if(layer.blend&&layer.blend!=='normal'||layer.mask&&!(layer.type==='image'&&layer.mask.kind==='luminance'&&preparedAssets[layer.id])||layer.style&&Object.values(layer.style).some(Boolean))fail(layer,'混合、蒙版或图层效果尚未获得无损原生映射，请保留源作品或导出渲染 PDF');
    const alpha=layer.opacity??1;
    if(layer.type==='group'){
      if(alpha!==1||layer.rotation)fail(layer,'组整体透明度或旋转尚无无损原生映射');
      const children=shapes(layer.children),groupId=id++;map[layer.id]=[groupId];return [{id:groupId,name:layer.name||'组',xfrm:{x:0,y:0,w:pt(doc.canvas.width),h:pt(doc.canvas.height)},kind:{type:'group',children,child:{x:0,y:0,w:pt(doc.canvas.width),h:pt(doc.canvas.height)}},style:null}];
    }
    const shape={id:id++,name:layer.name||layer.type,kind:{type:'shape'},xfrm:{x:pt(layer.x||0),y:pt(layer.y||0),w:pt(layer.w||1),h:pt(layer.h||1),rot:layer.rotation||0,flipH:!!layer.transform?.flipH,flipV:!!layer.transform?.flipV},style:null,fill:{kind:'none'},line:{fill:{kind:'none'}},geom:{kind:'preset',name:'rect'},textBox:false,hidden:false,locked:!!layer.locked,tags:[['DesignCraftObject',layer.id]]};
    map[layer.id]=[shape.id];
    if(layer.type==='text'){shape.textBox=true;shape.text=textBody(layer.text,layer,system);}
    else if(layer.type==='shape'){
      shape.geom={kind:'preset',name:({arrowRight:'rightArrow',arrowLeft:'leftArrow',arrowUp:'upArrow',arrowDown:'downArrow',roundrect:'roundRect'})[layer.shape]||layer.shape||'rect'};
      if(layer.shape==='roundRect')shape.geom.adj=[(layer.radius??.15)*100000];
      shape.fill=fill(layer.fill,system,alpha);shape.line=line(layer.stroke,system,alpha);if(layer.text)shape.text=textBody(layer.text,layer,system);
    }else if(layer.type==='image'||layer.type==='native'&&layer.native?.engine==='vectorcraft'&&layer.native.svg){
      const prepared=preparedAssets[layer.id];if((layer.adjust&&Object.keys(layer.adjust).length||layer.filters?.length)&&!prepared)fail(layer,'请从当前编辑视图导出，以包含尚未固化的图片调整');
      const isVector=layer.type==='native',name=isVector?layer.native.svg:prepared?.name||(typeof layer.asset==='string'?layer.asset:layer.asset?.src),image=isVector?mediaFor(name,{width:layer.native.previewWidth||layer.native.width,height:layer.native.previewHeight||layer.native.height},'image/svg+xml'):mediaFor(name),crop=layer.crop;
      const fractions=crop?[crop.x/image.size.width,crop.y/image.size.height,1-(crop.x+crop.w)/image.size.width,1-(crop.y+crop.h)/image.size.height]:[0,0,0,0];
      shape.kind={type:'picture',fill:{media:image.id,crop:fractions,alpha,mode:{kind:'stretch'}}};
      if(prepared?.flipsBaked){shape.xfrm.flipH=false;shape.xfrm.flipV=false;}
    }else if(layer.type==='vector'){
      const matrix=vectorMatrix(layer),result=[];
      for(const path of layer.paths||[]){
        if(path.fillRule==='evenodd')fail(layer,'偶奇填充规则尚无无损原生映射');
        const item={...shape,id:result.length?id++:shape.id,fill:fill(path.fill,system,alpha),line:line(path.stroke,system,alpha)};
        const absolute=transformPathData(path.d,matrix),local=transformPathData(absolute,[.75,0,0,.75,-pt(layer.x),-pt(layer.y)]);
        item.geom={kind:'custom',paths:[{w:pt(layer.w),h:pt(layer.h),d:local,fill:path.fill?'norm':'none',stroke:!!path.stroke}]};result.push(item);
      }
      map[layer.id]=result.map(item=>item.id);return result;
    }else if(layer.type==='chart'){
      if(alpha!==1)fail(layer,'图表整体透明度尚无无损原生映射');
      shape.kind={type:'chart',kind:({bar:'column',donut:'doughnut'})[layer.chartKind]||layer.chartKind||'column',title:layer.title||null,categories:layer.data?.labels||[],series:(layer.data?.series||[]).map((series,index)=>({name:series.name||'',values:series.values,fill:fill(layer.colors?.[index%layer.colors.length]||'#287D6C',system)}))};
    }else if(layer.type==='table'){
      if(alpha!==1)fail(layer,'表格整体透明度尚无无损原生映射');
      const cols=Math.max(1,...(layer.rows||[]).map(row=>row.length));
      shape.kind={type:'table',cols:Array(cols).fill(pt(layer.w/cols)),firstRow:layer.header!==false,style:'',rows:(layer.rows||[]).map((row,index)=>({height:pt(layer.rowHeight||40),cells:Array.from({length:cols},(_,column)=>({gridSpan:1,rowSpan:1,text:textBody(typeof row[column]==='object'?row[column]?.text:row[column],{...layer,fontSize:layer.fontSize||16,opacity:1,color:index===0&&layer.header!==false?'#FFFFFF':'#202936'},system),fill:fill(index===0&&layer.header!==false?layer.headerFill||'#287D6C':index%2?layer.stripeFill||'#F5F6F8':'#FFFFFF',system)}))}))};
    }else fail(layer,'该对象类型尚未接入原生 PPT，未生成近似替代');
    return [shape];
  });}
  const slides=doc.pages.map(page=>{
    if(page.background?.kind&&!['solid','linear','radial'].includes(page.background.kind))throw new SafetyError('该页面背景尚未获得无损原生映射',422);
    return {id:id++,name:page.name||'页面',layout:0,background:{kind:'fill',fill:fill(typeof page.background==='string'?page.background:page.background?.kind==='solid'?page.background.color:page.background||'#FFFFFF',system)},shapes:shapes(page.layers),notes:textBody(page.notes||'',{fontSize:16},system),hidden:!!page.hidden,transition:page.transition?.kind&&page.transition.kind!=='none'?{kind:page.transition.kind,durationMs:page.transition.duration||400}:null};
  });
  const model={format:'deckcraft',version:1,generator:'DesignCraft native adapter',presentation:{slideSize:{width:pt(doc.canvas.width),height:pt(doc.canvas.height)},slides,media:media.map(({size,...item})=>item),nextId:id,props:{title:doc.title||''}}};
  entries.unshift({name:'mimetype',data:'application/vnd.storyteller.deckcraft+zip',store:true},{name:'presentation.json',data:JSON.stringify(model)});
  return {buffer:createZip(entries),map,model,entries};
}
export async function exportNativeDeck(session,root,doc,input){
  const pdf=input.operation==='deck.pdf',sourceMode=doc.native?.deck?.mode==='source';let built;
  if(sourceMode){
    const source=store.readAsset(root,doc.native.deck.source);if(!source)throw new SafetyError('原生演示底稿缺失',422);
    const original=nativeDeckPackage(source),overlayDoc={...doc,__root:root,pages:doc.pages.map(page=>({...page,layers:page.layers.filter(layer=>!(layer.type==='native'&&layer.native?.engine==='deckcraft'&&layer.native.role==='page'))}))};
    const overlay=buildDeckPackage(overlayDoc,input.preparedAssets||{},{idStart:original.model.presentation.nextId});built=combineDeckSource(doc,original,overlay);
  }else built=buildDeckPackage({...doc,__root:root},input.preparedAssets||{});
  const file=join(session.directory,'input.deckcraft');await writeFile(file,built.buffer);
  await session.call('open_presentation',{path:file});
  if(sourceMode)for(let index=0;index<doc.pages.length;index++){
    const page=doc.pages[index];if(page.native?.engine==='deckcraft'&&page.notes!==page.native.originalNotes)await session.call('run_command',{command:'slide.notes',params:{index,text:page.notes||''}});
  }
  const inspect=(await session.call('inspect_document',{})).data;
  const sourceFile=join(session.directory,'result.deckcraft'),pptxFile=join(session.directory,pdf?'result.pdf':'result.pptx');
  await session.call('save_presentation',{path:sourceFile});if(pdf)await session.call('export',{path:pptxFile,format:'pdf',textLayer:true,dpi:144});else await session.call('save_presentation',{path:pptxFile});
  for(const output of [sourceFile,pptxFile])if((await stat(output)).size>128*1024*1024)throw new SafetyError('演示文件超过128MB预算',413);
  const source=store.saveAsset(root,'presentation-'+doc.id+'.deckcraft',await readFile(sourceFile));
  const output=store.saveExport(root,input.out||doc.id+(pdf?'.pdf':'.pptx'),await readFile(pptxFile));
  doc.native={...doc.native,deck:{...doc.native?.deck,engine:'deckcraft',version:'0.13.1',mode:sourceMode?'source':'generated',source:sourceMode?doc.native.deck.source:source.name,exportSource:source.name,objects:built.map,contentSignature:createHash('sha256').update(built.buffer).digest('hex')}};
  return {engine:'deckcraft',source:source.name,file:output.name,size:output.size,inspect,...(pdf?{readOnly:true}:{})};
}
