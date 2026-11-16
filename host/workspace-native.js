import {captureNativeSelection} from './photo-mask.js';
import {shapePathData} from '../client/svg-export.js';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openNativeSession,nativeRuntimeCatalog} from './native.js';
import * as store from './docstore.js';
import {assertSafeJson,assertPortableName,assertImageSize,SafetyError,workspacePath} from './safety.js';
import {transformPathData,vectorMatrix,pathBounds} from '../client/path.js';
import {exportNativeDeck,buildDeckPackage} from './deck-native.js';
import {importDeckSource,editDeckSource,styleDeckSource,captureDeckSource,nativeDeckPackage,nativeSlideIndex} from './deck-source.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const flatten=layers=>(layers||[]).flatMap(layer=>layer.type==='group'?flatten(layer.children):[layer]);
const assetPath=(root,name)=>{assertPortableName(name);return workspacePath(root,join('design','assets',name));};
function locate(doc,pageId,layerId){
  const page=doc.pages.find(page=>page.id===pageId);if(!page)throw new SafetyError('页面不存在',404);
  const walk=layers=>{for(const layer of layers){if(layer.id===layerId)return {layer,layers};if(layer.type==='group'){const result=walk(layer.children||[]);if(result)return result;}}};
  return {page,...walk(page.layers||[])};
}
async function outputAsset(root,file,name){
  const info=await stat(file);if(!info.isFile()||info.size>64*1024*1024)throw new SafetyError('专业引擎输出超过64MB素材预算',413);
  return store.saveAsset(root,name,await readFile(file));
}
const engineVersion=engine=>nativeRuntimeCatalog().find(item=>item.id===engine)?.version;
const sourceMetadata=(engine,source,asset)=>({engine,version:engineVersion(engine),source:source.name,renderedAsset:asset?.name});

function color(value,system){
  if(typeof value!=='string')throw new SafetyError('该颜色需要通过专业源对象编辑，未进行近似转换',422);
  const token=value.match(/^var\(--color-([\w-]+)\)$/);if(token){const resolved=system?.colors?.[token[1]];if(!resolved)throw new SafetyError('未定义设计颜色: '+value,422);return color(resolved,system);}
  if(!/^#[0-9a-f]{6}$/i.test(value))throw new SafetyError('该颜色格式尚未接入专业引擎: '+value,422);
  return value;
}
function nativeColor(value){
  if(value?.model!=='rgb')throw new SafetyError('原生色彩模型需要保留专业源文件，未转换为近似 RGB',422);
  return '#'+[value.r,value.g,value.b].map(c=>Math.round(Math.min(1,Math.max(0,c))*255).toString(16).padStart(2,'0')).join('');
}
function nativePaths(object){
  if(object.kind?.type!=='path')throw new SafetyError('结果含复杂原生对象，未扁平化为普通路径',422);
  const items=object.appearance?.items||[];
  if(items.some(item=>!['fill','stroke'].includes(item.kind))||items.filter(i=>i.kind==='fill').length>1||items.filter(i=>i.kind==='stroke').length>1)throw new SafetyError('结果含多重外观，需要保留专业源对象',422);
  const fill=items.find(item=>item.kind==='fill'&&item.paint?.type!=='none'),stroke=items.find(item=>item.kind==='stroke'&&item.paint?.type!=='none');
  if([fill,stroke].filter(Boolean).some(item=>item.paint?.type!=='solid'))throw new SafetyError('结果含复杂填充，需要保留专业源对象',422);
  const d=(object.kind.path.subpaths||[]).map(sub=>{
    const anchors=sub.anchors||[];if(!anchors.length)return '';
    let data='M '+anchors[0].p.join(' ');
    const segment=(previous,next)=>previous.out||next.in?' C '+(previous.out||previous.p).join(' ')+' '+(next.in||next.p).join(' ')+' '+next.p.join(' '):' L '+next.p.join(' ');
    for(let i=1;i<anchors.length;i++)data+=segment(anchors[i-1],anchors[i]);
    if(sub.closed)data+=segment(anchors.at(-1),anchors[0])+' Z';return data;
  }).join(' ');
  return [{d,fill:fill?nativeColor(fill.paint.color):null,stroke:stroke?{color:nativeColor(stroke.paint.color),width:stroke.width}:null,fillRule:object.kind.path.fill_rule==='even_odd'?'evenodd':'nonzero'}];
}
function pathForShape(layer){return shapePathData(layer);}
async function addVectorObject(session,layer,system,{exporting=false}={}){
  if(layer.mask||layer.style&&Object.values(layer.style).some(value=>value&&value!=='none')||!exporting&&layer.opacity!=null&&layer.opacity!==1||layer.blend&&layer.blend!=='normal')throw new SafetyError('当前操作需要普通路径；蒙版、效果和混合未被静默丢弃',422);
  if(!['shape','vector'].includes(layer.type))throw new SafetyError('请选择形状或矢量图层',422);
  let paths=layer.type==='vector'?layer.paths:[{d:pathForShape(layer),fill:layer.fill,stroke:layer.stroke}];
  const matrix=layer.type==='vector'?vectorMatrix(layer):[1,0,0,1,0,0];
  const angle=(layer.rotation||0)*Math.PI/180,cx=layer.x+layer.w/2,cy=layer.y+layer.h/2;
  const rotation=[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),cx-cx*Math.cos(angle)+cy*Math.sin(angle),cy-cx*Math.sin(angle)-cy*Math.cos(angle)];
  const ids=[];
  for(const path of paths){
    if(!exporting&&path.stroke&&path.stroke!=='none'&&path.stroke.width!==0)throw new SafetyError('带描边的布尔运算需要先在专业引擎扩展描边，未近似处理',422);
    const created=await session.call('command_run',{id:'path.create',params:{d:transformPathData(transformPathData(path.d,matrix),rotation)}});ids.push(created.data.id);
    const fill=path.fill;
    if(fill&&typeof fill==='object'&&fill.kind==='linear'){
      const box=layer.type==='vector'?(layer.geometryBox||layer):layer,angle=(fill.angle||0)*Math.PI/180,cx=box.x+box.w/2,cy=box.y+box.h/2;
      const project=(x,y)=>[rotation[0]*(matrix[0]*x+matrix[4])+rotation[2]*(matrix[3]*y+matrix[5])+rotation[4],rotation[1]*(matrix[0]*x+matrix[4])+rotation[3]*(matrix[3]*y+matrix[5])+rotation[5]];
      const gradient={kind:'linear',method:'classic',stops:fill.stops.map(([offset,value])=>({offset,color:color(value,system)})),start:project(cx-Math.cos(angle)*box.w/2,cy-Math.sin(angle)*box.h/2),end:project(cx+Math.cos(angle)*box.w/2,cy+Math.sin(angle)*box.h/2)};
      await session.call('command_run',{id:'paint.setFill',params:{id:created.data.id,gradient}});
    }else{
      if(fill&&typeof fill==='object'&&fill.opacity!=null&&fill.opacity!==1)throw new SafetyError('填充独立透明度请在原生外观中编辑，未忽略此属性',422);
      await session.call('command_run',{id:'paint.setFill',params:fill&&fill!=='none'?{id:created.data.id,color:color(typeof fill==='object'?fill.color:fill,system)}:{id:created.data.id,none:true}});
    }
    if(exporting&&path.stroke&&path.stroke!=='none'&&path.stroke.width!==0){
      const [sx,,,sy]=matrix;if(Math.abs(sx-sy)>1e-6)throw new SafetyError('非等比缩放的描边需先在原生源中扩展，未输出近似描边',422);
      const stroke=typeof path.stroke==='string'?{color:path.stroke,width:1}:path.stroke;
      await session.call('command_run',{id:'paint.setStroke',params:{id:created.data.id,color:color(stroke.color,system)}});
      await session.call('command_run',{id:'stroke.set',params:{id:created.data.id,weight:(stroke.width??1)*sx,...(stroke.dash?{dash:stroke.dash}:{})}});
    }else await session.call('command_run',{id:'paint.setStroke',params:{id:created.data.id,none:true}});
    if(path.fillRule==='evenodd')await session.call('command_run',{id:'path.setFillRule',params:{id:created.data.id,rule:'evenOdd'}});
    if(exporting&&layer.opacity!=null&&layer.opacity!==1)await session.call('command_run',{id:'transparency.set',params:{id:created.data.id,opacity:layer.opacity*100,item:null}});

  }
  return ids;
}

export class WorkspaceNative {
  constructor({onChange=()=>{}}={}){this.active=new Map();this.records=new Map();this.onChange=onChange;this.disposed=false;}
  list(root){return [...this.records.values()].filter(job=>job.root===root).map(({root,...job})=>job);}
  emit(job){try{this.onChange({...job});}catch{}}
  catalog(){return {engines:nativeRuntimeCatalog(),operations:['photo.apply','photo.create','photo.import','photo.attach','photo.export','photo.selection','vector.boolean','vector.import','vector.apply','vector.export','native.inspect','deck.import','deck.promote','deck.design','deck.apply','deck.clone','deck.delete','deck.export','deck.pdf']};}
  async run(input,{signal}={}){
    assertSafeJson(input);const root=store.validateRoot(input.root);
    if(this.disposed)throw new SafetyError('专业引擎服务已停止',503);
    if(this.active.size>=2)throw new SafetyError('已有两个专业操作在运行，请等待完成',429);
    if(!['photo.apply','photo.create','photo.import','photo.attach','photo.export','photo.selection','vector.boolean','vector.import','vector.apply','vector.export','native.inspect','deck.import','deck.promote','deck.design','deck.apply','deck.clone','deck.delete','deck.export','deck.pdf'].includes(input.operation))throw new SafetyError('不支持的专业操作',422);
    const current=store.readDoc(root,input.id);
    if(!input.baseRevision)throw new SafetyError('专业操作需要当前文档版本',428);
    if(current.revision!==input.baseRevision){const error=new SafetyError('作品已更新，请刷新后重试',409);error.current=current;throw error;}
    if(input.expectedSource&&locate(current.doc,input.pageId,input.layerId).layer?.native?.source!==input.expectedSource)throw new SafetyError('原生源版本已改变，编辑未提交',409);
    const doc=copy(current.doc),engine=input.operation==='native.inspect'?(locate(doc,input.pageId,input.layerId).layer?.native?.engine||'photocraft'):input.operation.startsWith('photo.')?'photocraft':input.operation.startsWith('deck.')?'deckcraft':'vectorcraft';
    if(!['photocraft','vectorcraft','deckcraft'].includes(engine))throw new SafetyError('未知专业源类型',422);
    const job={id:'native-'+randomUUID(),root,kind:input.operation,status:'running',createdAt:new Date().toISOString(),startedAt:new Date().toISOString()};
    const running={job,session:null,aborted:false,controller:new AbortController()};this.active.set(job.id,running);this.records.set(job.id,job);this.emit(job);
    const abort=()=>{running.aborted=true;running.controller.abort();running.session?.close();};signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{running.timedOut=true;abort();},60000);
    try{
      if(signal?.aborted)abort();if(running.aborted)throw new SafetyError('专业操作已取消',499);
      running.session=await openNativeSession(engine,root,{signal:running.controller.signal,onQueue:()=>{job.status='queued';this.emit(job);},onAcquire:()=>{job.status='running';this.emit(job);}});if(running.aborted)throw new SafetyError('专业操作已取消',499);
      const candidate=input.operation==='native.inspect'?await this.inspectSource(running.session,doc,input):input.operation==='photo.selection'?await this.photoSelection(running.session,doc,input):input.operation==='photo.export'?await this.exportPhoto(running.session,doc,input):input.operation==='deck.promote'?await this.promoteDeck(running.session,doc,input):input.operation.startsWith('photo.')?await this.photo(running.session,doc,input):input.operation==='deck.design'?await styleDeckSource(running.session,root,doc,input):input.operation==='deck.import'?await importDeckSource(running.session,root,doc,input):['deck.apply','deck.clone','deck.delete'].includes(input.operation)?await editDeckSource(running.session,root,doc,input):['deck.export','deck.pdf'].includes(input.operation)?await exportNativeDeck(running.session,root,doc,input):input.operation==='vector.import'?await this.importVector(running.session,doc,input):input.operation==='vector.apply'?await this.editVector(running.session,doc,input):input.operation==='vector.export'?await this.exportVector(running.session,doc,input):await this.vector(running.session,doc,input);
      if(running.session.projectFontCount&&candidate&&typeof candidate==='object'){
        const warning='本机操作已提供项目字体，但系统同名字体可能优先；文字外观需核对。';
        candidate.warnings=[...(Array.isArray(candidate.warnings)?candidate.warnings:[]),warning];job.warnings=candidate.warnings;
      }
      if(running.aborted)throw new SafetyError('专业操作已取消，结果未写入作品',499);
      try{
        const saved=candidate.readOnly?{}:store.writeDoc(root,input.id,doc,'native:'+engine,{baseRevision:input.baseRevision,returnDocument:true});
        job.status='completed';job.finishedAt=new Date().toISOString();this.emit(job);
        return {ok:true,...saved,candidate,jobId:job.id};
      }catch(error){error.candidate=candidate;throw error;}
    }catch(error){
      if(running.timedOut)error=new SafetyError('专业操作超时，作品未由此操作提交',504);
      job.status=running.aborted?'cancelled':'failed';job.error=error.message;job.finishedAt=new Date().toISOString();this.emit(job);throw error;
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);await running.session?.close();this.active.delete(job.id);if(this.records.size>100)for(const [key,value]of this.records){if(!this.active.has(key))this.records.delete(key);if(this.records.size<=80)break;}}
  }
  async photoSelection(session,doc,input){const {layer}=locate(doc,input.pageId,input.layerId);if(layer?.native?.engine!=='photocraft')throw new SafetyError('请选择有原生选区的图片',422);return {readOnly:true,...await captureNativeSelection(input.root,layer.native.source,{session})};}
  async exportPhoto(session,doc,input){
    const {layer}=locate(doc,input.pageId,input.layerId);if(layer?.native?.engine!=='photocraft')throw new SafetyError('请选择已进入图片引擎的源对象',422);
    const format=String(input.format||'psd').toLowerCase();if(!['psd','png','jpg','webp','tiff'].includes(format))throw new SafetyError('未开放的图片源导出格式',422);
    const asset=typeof layer.asset==='string'?layer.asset:layer.asset?.src;if(layer.native.renderedAsset!==asset)throw new SafetyError('图片预览已被替换，请先重新导入源文件',409);
    await session.call('doc_open',{path:assetPath(input.root,layer.native.source)});const path=join(session.directory,'edited.'+format);
    await session.call(format==='psd'?'doc_save':'doc_export',{path,format,...(input.quality!=null?{quality:Math.max(0,Math.min(12,Number(input.quality)))}:{})});
    if((await stat(path)).size>128*1024*1024)throw new SafetyError('导出超过128MB预算',413);
    const file=store.saveExport(input.root,input.out||'edited-photo.'+format,await readFile(path));return {readOnly:true,file:file.name,size:file.size,format,source:layer.native.source,scope:'native-photo-source',canvasCropAndOverlaysIncluded:false};
  }
  async promoteDeck(session,doc,input){
    if(doc.native?.deck?.mode==='source')throw new SafetyError('作品已经使用原生演示底稿',422);
    const built=buildDeckPackage({...doc,__root:input.root},input.preparedAssets||{}),file=join(session.directory,'promoted.deckcraft');await writeFile(file,built.buffer);await session.call('open_presentation',{path:file});
    for(let index=0;index<doc.pages.length;index++){const page=doc.pages[index];page.layers=[];page.native={engine:'deckcraft',slideId:built.model.presentation.slides[index].id,index};}
    const result=await captureDeckSource(session,input.root,doc);doc.native.deck.commonObjectMap=built.map;return {...result,promoted:true,commonObjectMap:built.map};
  }

  async photo(session,doc,input){
    const imported=input.operation==='photo.import',created=input.operation==='photo.create',attached=input.operation==='photo.attach';
    const target=locate(doc,input.pageId,input.layerId);
    let layer=target.layer;
    if(!imported&&!created&&layer?.type!=='image')throw new SafetyError('请选中图片图层',422);
    const commands=input.commands||[],pending=layer?.pendingNativePaint?.strokes||[];
    if((!imported&&!created&&!attached&&!commands.length&&!pending.length)||commands.length+pending.length>32)throw new SafetyError('每次图片编辑需要1至32个命令',422);
    for(const command of commands)if(!/^(image\.adjustments\.|filter\.|select\.|paint\.|layer\.|edit\.(?:fill|clear|transform)$|type\.(?:edit|setStyle)$)/.test(command.id||''))throw new SafetyError('该命令不在图片对象编辑范围内: '+command.id,422);
    let opened,source;
    if(created){assertImageSize(doc.canvas.width,doc.canvas.height);await session.call('doc_new',{width:doc.canvas.width,height:doc.canvas.height,background:input.background||'transparent',name:doc.title||'图片作品'});}
    else{
      const asset=typeof layer?.asset==='string'?layer.asset:layer?.asset?.src;
      source=imported?input.asset:layer.native?.engine==='photocraft'&&layer.native.renderedAsset===asset?layer.native.source:asset;
      if(!source)throw new SafetyError('图片源文件缺失',422);
      opened=await session.call('doc_open',{path:assetPath(input.root,source)});
    }
    let info=(await session.call('doc_inspect',{})).data;assertImageSize(info.width,info.height);
    const sourceLayers=layers=>(layers||[]).flatMap(layer=>[layer,...sourceLayers(layer.children)]);
    if(pending.length){
      if(layer.pendingNativePaint.source!==source||layer.pendingNativePaint.asset!==(typeof layer.asset==='string'?layer.asset:layer.asset?.src))throw new SafetyError('待处理笔画与当前源文件版本不一致，未覆盖任何图层',409);
      for(const stroke of pending){
        await session.call('command_run',{id:'layer.select',params:{layer:stroke.layerId}});
        await session.call('command_run',{id:'paint.stroke',params:stroke.params,wait:true});
      }
    }
    if(input.nativeLayerId!=null){
      if(!sourceLayers(info.layers).some(layer=>layer.id===Number(input.nativeLayerId)))throw new SafetyError('源文件图层已变化，请重新选择',409);
      await session.call('command_run',{id:'layer.select',params:{layer:Number(input.nativeLayerId)}});
    }
    const catalog=commands.length?(await session.call('command_list',{})).data:[];
    for(let index=0;index<commands.length;index++){
      const command=commands[index],entry=catalog.find(item=>item.id===command.id);if(!entry)throw new SafetyError('PhotoCraft 不支持命令: '+command.id,422);
      await session.call('command_run',{id:command.id,params:command.params||{},wait:true});
      const running=[...this.active.values()].find(item=>item.session===session);if(running){running.job.progress={index,total:commands.length,operation:command.id};this.emit(running.job);}
    }
    info=(await session.call('doc_inspect',{})).data;assertImageSize(info.width,info.height);
    if(imported||created){
      if(input.fitCanvas){if(doc.pages.length!==1||target.page.layers.length)throw new SafetyError('自动匹配尺寸只适用于空白作品，现有页面未被重排',422);doc.canvas={width:info.width,height:info.height};if(doc.type!=='deck')doc.type='photo';}
      const scale=input.fitCanvas||created?1:Math.min(1,doc.canvas.width*.8/info.width,doc.canvas.height*.8/info.height);
      layer={id:'img-'+randomUUID(),type:'image',name:input.asset||'图片',x:input.fitCanvas||created?0:(input.at?.x??doc.canvas.width/2)-info.width*scale/2,y:input.fitCanvas||created?0:(input.at?.y??doc.canvas.height/2)-info.height*scale/2,w:info.width*scale,h:info.height*scale,opacity:1,blend:'normal'};target.page.layers.push(layer);
    }
    const nativeFile=join(session.directory,'result.pcraft'),imageFile=join(session.directory,'result.png');
    await session.call('doc_save',{path:nativeFile});await session.call('doc_export',{path:imageFile});
    const savedSource=await outputAsset(input.root,nativeFile,'source-'+layer.id+'.pcraft'),savedImage=await outputAsset(input.root,imageFile,'photo-'+layer.id+'.png');
    const original=imported||layer.native?.renderedAsset&&layer.native.renderedAsset!==(typeof layer.asset==='string'?layer.asset:layer.asset?.src)?source:layer.native?.original||(layer.native?.engine==='photocraft'?null:source)||null;
    layer.asset=savedImage.name;layer.native={...sourceMetadata('photocraft',savedSource,savedImage),original,depth:info.depth,mode:info.mode,warnings:opened?.data?.warnings||[],hasSelection:!!info.hasSelection,selectionBounds:info.selectionBounds||null,layers:sourceLayers(info.layers).map(item=>({id:item.id,name:item.name,kind:item.kind,bounds:item.bounds,text:item.text?.text?.slice(0,4096),textTruncated:item.text?.text?.length>4096,visible:item.visible,locked:item.locked,container:!!item.children?.length})),activeLayer:info.activeLayer};layer.naturalWidth=info.width;layer.naturalHeight=info.height;delete layer.pendingNativePaint;
    return {engine:'photocraft',layerId:layer.id,source:savedSource.name,asset:savedImage.name,inspect:info};
  }

  async inspectSource(session,doc,input){
    const {layer}=locate(doc,input.pageId,input.layerId);if(!layer)throw new SafetyError('对象不存在',404);
    const asset=typeof layer.asset==='string'?layer.asset:layer.asset?.src;
    const source=layer.native?.renderedAsset===asset?layer.native?.source:asset;
    if(!source)throw new SafetyError('对象没有专业源文件',422);
    if(session.engine==='deckcraft'){
      const packageBytes=store.readAsset(input.root,doc.native?.deck?.source||source);if(!packageBytes)throw new SafetyError('原生演示源缺失',422);
      const {model}=nativeDeckPackage(packageBytes),{index}=nativeSlideIndex(doc,model,input.pageId);
      await session.call('open_presentation',{path:assetPath(input.root,doc.native?.deck?.source||source)});await session.call('go_to_slide',{index});
      return {readOnly:true,engine:'deckcraft',inspect:(await session.call('inspect_slide',{index})).data,commands:(await session.call('list_commands',input.filter?{filter:input.filter}:{})).data};
    }
    await session.call(session.engine==='photocraft'?'doc_open':'open_file',{path:assetPath(input.root,source)});
    const info=(await session.call('doc_inspect',session.engine==='vectorcraft'?{depth:32,childLimit:5000,limit:5000}:{})).data;
    const commands=(await session.call('command_list',input.filter?{filter:input.filter}:{})).data;
    return {readOnly:true,engine:session.engine,inspect:info,commands};
  }
  async captureVector(session,root,tag,artboard=0){
    const info=(await session.call('doc_inspect',{depth:32,childLimit:5000,limit:5000})).data;
    const board=info.artboards?.[artboard];if(!board||!Number.isFinite(board.width)||!Number.isFinite(board.height)||board.width<=0||board.height<=0)throw new SafetyError('原生画板尺寸无效',422);
    assertImageSize(Math.ceil(board.width),Math.ceil(board.height));
    const path=join(session.directory,'result.vectorcraft'),svgPath=join(session.directory,'result.svg');
    await session.call('save_file',{path,compress:false});await session.call('export',{path:svgPath,format:'svg',artboard});
    const source=await outputAsset(root,path,'source-'+tag+'.vectorcraft'),svg=await outputAsset(root,svgPath,'vector-'+tag+'.svg');
    const preview=(await session.call('render_preview',{max_side:2048,artboard})).content.find(block=>block.type==='image');
    if(!preview||preview.mimeType!=='image/png')throw new SafetyError('专业引擎没有返回有效预览',502);
    const image=store.saveAsset(root,'preview-'+tag+'.png',Buffer.from(preview.data,'base64'));
    let model=null;if((await stat(path)).size<=16*1024*1024){try{model=JSON.parse(await readFile(path,'utf8'));assertSafeJson(model);}catch{model=null;}}
    const nodes=[];const visit=(list,parentId=null)=>{for(const node of list||[]){if(nodes.length>=5000)throw new SafetyError('原生对象超过5000个直接编辑预算',413);nodes.push({id:node.id,parentId,name:node.name,kind:node.kind,bounds:node.bounds,text:node.text,rotation:node.rotation||0,visible:node.visible,locked:node.locked,container:node.kind==='Layer'});visit(node.children,node.id);}};visit(info.layers);
    const previewBytes=Buffer.from(preview.data,'base64');
    return {info,board,model,source,svg,image,native:{...sourceMetadata('vectorcraft',source,image),svg:svg.name,artboard,artboards:info.artboards,nodes,nodesLimited:false,width:board.width,height:board.height,previewWidth:previewBytes.readUInt32BE(16),previewHeight:previewBytes.readUInt32BE(20)}};
  }
  async importVector(session,doc,input){
    const {page}=locate(doc,input.pageId,input.layerId);
    const opened=await session.call('open_file',{path:assetPath(input.root,input.asset)}),tag='vec-'+randomUUID(),captured=await this.captureVector(session,input.root,tag,input.artboard||0);
    const {board}=captured;
    if(input.fitCanvas){if(doc.pages.length!==1||page.layers.length)throw new SafetyError('匹配画板尺寸只适用于空白作品',422);doc.canvas={width:Math.ceil(board.width),height:Math.ceil(board.height)};if(doc.type!=='deck')doc.type='vector';}
    const scale=input.fitCanvas?1:Math.min(1,doc.canvas.width*.8/board.width,doc.canvas.height*.8/board.height);
    const x=input.fitCanvas?0:(input.at?.x??doc.canvas.width/2)-board.width*scale/2,y=input.fitCanvas?0:(input.at?.y??doc.canvas.height/2)-board.height*scale/2;
    let common=[],reason;
    try{
      if(!captured.model||captured.info.artboards.length!==1)throw new Error('包含多个画板或复杂原生数据');
      for(const layer of captured.model.document.layers||[]){
        if(layer.kind?.type!=='layer')throw new Error('包含特殊原生图层');
        for(const object of layer.kind.children||[]){
          if(Object.keys(object).some(key=>!['id','name','kind','appearance','visible','locked'].includes(key)))throw new Error('包含专业对象属性');
          for(const item of object.appearance?.items||[])if(Object.keys(item).some(key=>!['kind','paint','width'].includes(key)))throw new Error('包含多重外观属性');
          const paths=nativePaths(object),b=pathBounds(paths.map(path=>path.d).join(' '));
          common.push({id:'vec-'+randomUUID(),type:'vector',name:object.name||input.asset,x:x+(b.x-board.x)*scale,y:y+(b.y-board.y)*scale,w:b.w*scale,h:b.h*scale,geometryBox:b,paths,opacity:1,blend:'normal',hidden:object.visible===false,locked:object.locked===true,native:{engine:'vectorcraft',version:engineVersion('vectorcraft'),source:captured.source.name,original:input.asset,objectId:object.id,commonGeometry:true}});
        }
      }
      if(!common.length)throw new Error('原生源文件没有普通路径');
    }catch(error){reason=error.message;common=[];}
    if(!common.length)common=[{id:tag,type:'native',name:input.asset,x,y,w:board.width*scale,h:board.height*scale,opacity:1,blend:'normal',asset:captured.image.name,native:{...captured.native,original:input.asset,adapterReason:reason,warnings:opened.data?.warnings||[]}}];
    page.layers.push(...common);
    return {engine:'vectorcraft',source:captured.source.name,svg:captured.svg.name,asset:captured.image.name,layerIds:common.map(layer=>layer.id),commonGeometry:!reason,adapterReason:reason,boardSize:{width:board.width,height:board.height}};
  }
  async editVector(session,doc,input){
    const {layer}=locate(doc,input.pageId,input.layerId);
    if(layer?.type!=='native'||layer.native?.engine!=='vectorcraft')throw new SafetyError('普通路径请使用节点或填充工具；专业命令用于保留完整原生数据的对象',422);
    await session.call('open_file',{path:assetPath(input.root,layer.native.source)});
    if(input.nativeObjectId!=null)await session.call('command_run',{id:'select.set',params:{ids:[Number(input.nativeObjectId)]}});
    if(!Array.isArray(input.commands)||!input.commands.length||input.commands.length>32)throw new SafetyError('每次原生编辑需要1至32个命令',422);
    for(const command of input.commands){if(!/^(path\.|paint\.|object\.|select\.|text\.)/.test(command.id||''))throw new SafetyError('该命令超出矢量对象编辑范围',422);await session.call('command_run',{id:command.id,params:command.params||{}});}
    const captured=await this.captureVector(session,input.root,layer.id,input.artboard??layer.native.artboard??0);
    layer.asset=captured.image.name;layer.native={...captured.native,original:layer.native.original};
    return {engine:'vectorcraft',layerId:layer.id,source:captured.source.name,asset:captured.image.name,svg:captured.svg.name};
  }
  async exportVector(session,doc,input){
    const {layer}=locate(doc,input.pageId,input.layerId);if(!layer)throw new SafetyError('请选中矢量或形状对象',422);
    const out=input.out||layer.name+'.svg';
    if(layer.type==='native'&&layer.native?.engine==='vectorcraft'&&layer.native.svg){const bytes=store.readAsset(input.root,layer.native.svg);if(!bytes)throw new SafetyError('原生 SVG 源缺失',422);const saved=store.saveExport(input.root,out,bytes);return {readOnly:true,engine:'vectorcraft',file:saved.name,scope:'native-source'};}
    if(!['shape','vector'].includes(layer.type)||layer.text)throw new SafetyError('请选择普通矢量路径或无内文形状；该对象未被转成近似 SVG',422);
    await session.call('command_run',{id:'file.new',params:{width:doc.canvas.width,height:doc.canvas.height,units:'Pixels',backgroundContents:'transparent'}});
    const ids=await addVectorObject(session,layer,doc.designSystem,{exporting:true});await session.call('command_run',{id:'select.set',params:{ids}});
    const file=join(session.directory,'selection.svg');await session.call('export',{path:file,format:'svg',selection:true});
    const info=await stat(file);if(info.size>64*1024*1024)throw new SafetyError('SVG 超过64MB输出预算',413);
    const saved=store.saveExport(input.root,out,await readFile(file));return {readOnly:true,engine:'vectorcraft',file:saved.name,scope:'current-geometry'};
  }
  async vector(session,doc,input){
    if(!['unite','subtract','intersect','exclude','divide'].includes(input.mode))throw new SafetyError('未知布尔运算',422);
    if(!Array.isArray(input.layerIds)||input.layerIds.length<2||input.layerIds.length>32)throw new SafetyError('请选择2至32个路径图层',422);
    const selected=input.layerIds.map(id=>locate(doc,input.pageId,id));if(selected.some(item=>!item.layer))throw new SafetyError('路径图层不存在',404);
    if(new Set(input.layerIds).size!==selected.length)throw new SafetyError('路径图层重复',422);
    await session.call('command_run',{id:'file.new',params:{width:doc.canvas.width,height:doc.canvas.height,units:'Pixels',backgroundContents:'transparent'}});
    const ids=[];for(const item of selected)ids.push(...await addVectorObject(session,item.layer,doc.designSystem));
    await session.call('pathfinder',{operation:input.mode,ids});
    const nativeFile=join(session.directory,'result.vectorcraft');await session.call('save_file',{path:nativeFile,compress:false});
    const source=await outputAsset(input.root,nativeFile,'source-'+input.id+'.vectorcraft');
    const model=JSON.parse(await readFile(nativeFile,'utf8'));
    const objects=[];const visit=list=>{for(const object of list||[]){if(['layer','group'].includes(object.kind?.type))visit(object.kind.children);else objects.push(object);}};visit(model.document.layers);
    const created=objects.map(object=>{const paths=nativePaths(object),b=pathBounds(paths.map(p=>p.d).join(' '));return {id:'vec-'+randomUUID(),type:'vector',name:'布尔 '+input.mode,x:b.x,y:b.y,w:b.w,h:b.h,geometryBox:b,paths,opacity:1,blend:'normal',native:{...sourceMetadata('vectorcraft',source),objectId:object.id}};});
    // Mutation happens only after a full real engine result has been converted successfully.
    const page=selected[0].page;for(const item of selected)item.layers.splice(item.layers.indexOf(item.layer),1);page.layers.push(...created);
    return {engine:'vectorcraft',source:source.name,layerIds:created.map(layer=>layer.id),objects:created.length};
  }
  cancel(id){const entry=this.active.get(id);if(!entry)return false;entry.aborted=true;entry.controller?.abort();entry.session?.close();return true;}
  dispose(){this.disposed=true;for(const id of this.active.keys())this.cancel(id);}
}
