import {multiplyMatrix} from '../client/selection.js';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readZip,createZip} from './zip.js';
import {SafetyError,workspacePath,assertPortableName} from './safety.js';
import * as store from './docstore.js';
import {systemFor,applyResourceToDocument} from './design-resources.js';

export function nativeDeckPackage(bytes){
 const entries=readZip(bytes),manifest=entries.find(entry=>entry.name==='presentation.json');
 if(!manifest||manifest.data.length>16*1024*1024)throw new SafetyError('演示原生清单缺失或超过16MB预算',413);
 const model=JSON.parse(manifest.data.toString('utf8'));
 if(model.format!=='deckcraft'||!Array.isArray(model.presentation?.slides))throw new SafetyError('原生演示清单无效',422);
 return {model,entries};
}
export const notesText=body=>(body?.paragraphs||[]).map(p=>(p.runs||[]).map(run=>run.text||'').join('')).join('\n');
export function nativeSlideIndex(doc,model,pageId){
 const page=doc.pages.find(page=>page.id===pageId),index=model.presentation.slides.findIndex(slide=>slide.id===page?.native?.slideId);
 if(!page||index<0)throw new SafetyError('原生源页面不存在',404);return {page,index};
}
async function sourceBytes(session,file){if((await stat(file)).size>64*1024*1024)throw new SafetyError('原生演示源超过64MB素材预算',413);return readFile(file);}
function groupMatrix(shape){const f=shape.xfrm||{},child=shape.kind.child||{x:0,y:0,w:f.w,h:f.h},a=(f.rot||0)*Math.PI/180,c=Math.cos(a),s=Math.sin(a),sx=(f.flipH?-1:1)*(f.w/(child.w||1)),sy=(f.flipV?-1:1)*(f.h/(child.h||1)),cx=f.x+f.w/2,cy=f.y+f.h/2;return [c*sx,s*sx,-s*sy,c*sy,cx-c*sx*(child.x+child.w/2)+s*sy*(child.y+child.h/2),cy-s*sx*(child.x+child.w/2)-c*sy*(child.y+child.h/2)];}
export function deckObjectNodes(inspected,shapes){const model=new Map();const collect=list=>{for(const n of list||[]){model.set(n.id,n);collect(n.kind?.children);}};collect(shapes);const out=[],identity=[1,0,0,1,0,0];
 const visit=(list,parentId=null,parentMatrix=identity,hidden=false,locked=false)=>{for(const n of list||[]){if(out.length>=5000)throw new SafetyError('原生页面超过5000个直接编辑预算',413);const shape=model.get(n.id),hide=hidden||shape?.hidden,lock=locked||shape?.locked;out.push({id:n.id,parentId,parentMatrix,name:n.name,kind:n.kind,box:n.box,rotation:n.rotation,text:n.text?.slice(0,4096),textTruncated:n.text?.length>4096,visible:!hide,locked:!!lock});const next=shape?.kind?.type==='group'?multiplyMatrix(parentMatrix,groupMatrix(shape)):parentMatrix;visit(n.children||n.shapes,n.id,next,hide,lock);}};visit(inspected.shapes);return out;
}
export async function captureDeckSource(session,root,doc,{imported=false,original,clonePageId,replaceNotes=false}={}){
 const file=join(session.directory,'source.deckcraft');await session.call('save_presentation',{path:file});
 const bytes=await sourceBytes(session,file),{model}=nativeDeckPackage(bytes),presentation=model.presentation;
 if(presentation.slides.length>100)throw new SafetyError('原生演示超过100页导入/编辑预算，原始文件仍保留',413);
 const canvas={width:presentation.slideSize.width/.75,height:presentation.slideSize.height/.75};if(canvas.width*canvas.height>24_000_000||canvas.width<=0||canvas.height<=0)throw new SafetyError('演示画板超过预览预算',413);
 const source=store.saveAsset(root,'deck-source-'+doc.id+'.deckcraft',bytes),existing=new Map(doc.pages.filter(p=>p.native?.engine==='deckcraft').map(p=>[p.native.slideId,p]));
 const nativePages=[],oldIds=new Set(existing.keys()),cloneFrom=doc.pages.find(p=>p.id===clonePageId);
 const reid=layers=>(layers||[]).map(layer=>({...JSON.parse(JSON.stringify(layer)),id:'layer-'+randomUUID(),...(layer.type==='group'?{children:reid(layer.children)}:{})}));
 for(let index=0;index<presentation.slides.length;index++){
  const slide=presentation.slides[index],previous=existing.get(slide.id),page=previous||{id:'page-'+randomUUID(),name:slide.name||'页面 '+(index+1),notes:notesText(slide.notes),hidden:!!slide.hidden,background:{kind:'solid',color:'#FFFFFF'},layers:[]};
  const inspected=(await session.call('inspect_slide',{index})).data,scale=Math.min(4/3,2048/Math.max(presentation.slideSize.width,presentation.slideSize.height));
  const preview=(await session.call('render_slide',{slide:index,scale})).content.find(block=>block.type==='image');if(!preview||preview.mimeType!=='image/png')throw new SafetyError('原生演示预览缺失',502);
  const asset=store.saveAsset(root,'deck-preview-'+doc.id+'-'+slide.id+'.png',Buffer.from(preview.data,'base64'));
  const nodes=deckObjectNodes(inspected,slide.shapes);
  let overlays=(previous?.layers||[]).filter(layer=>!(layer.type==='native'&&layer.native?.engine==='deckcraft'&&layer.native.role==='page'));
  if(!previous&&cloneFrom){overlays=reid(cloneFrom.layers.filter(layer=>!(layer.type==='native'&&layer.native?.engine==='deckcraft'&&layer.native.role==='page')));page.name=(cloneFrom.name||'页面')+' 副本';page.notes=cloneFrom.notes;page.hidden=cloneFrom.hidden;}
  const oldProxy=previous?.layers?.find(layer=>layer.type==='native'&&layer.native?.engine==='deckcraft'&&layer.native.role==='page');
  const proxy={id:oldProxy?.id||'native-slide-'+randomUUID(),type:'native',name:'原生底稿 · '+(slide.name||index+1),x:0,y:0,w:canvas.width,h:canvas.height,opacity:1,blend:'normal',locked:true,asset:asset.name,native:{engine:'deckcraft',version:'0.13.1',role:'page',source:source.name,renderedAsset:asset.name,slideId:slide.id,index,nodes,nodesLimited:false}};
  page.layers=[proxy,...overlays];if(replaceNotes||!previous&&!cloneFrom)page.notes=notesText(slide.notes);
  page.native={engine:'deckcraft',slideId:slide.id,index,source:source.name,originalNotes:notesText(slide.notes)};nativePages.push(page);
 }
 if(imported)doc.pages=nativePages;
 else{
  const valid=new Map(nativePages.map(p=>[p.native.slideId,p])),pages=doc.pages.filter(p=>!p.native?.engine||p.native.engine!=='deckcraft'||valid.has(p.native.slideId)).map(p=>p.native?.engine==='deckcraft'?valid.get(p.native.slideId):p);
  const added=nativePages.filter(p=>!oldIds.has(p.native.slideId));let anchor=cloneFrom?pages.findIndex(p=>p.id===cloneFrom.id)+1:pages.length;pages.splice(anchor,0,...added);doc.pages=pages;
 }
 doc.canvas=canvas;doc.type='deck';doc.native={...doc.native,deck:{...doc.native?.deck,engine:'deckcraft',version:'0.13.1',mode:'source',source:source.name,original:original||doc.native?.deck?.original,slideSize:presentation.slideSize}};
 return {engine:'deckcraft',source:source.name,pages:doc.pages.length,nativePages:nativePages.length};
}
export async function importDeckSource(session,root,doc,input){
 if(doc.pages.length!==1||doc.pages[0].layers?.length||doc.pages[0].notes)throw new SafetyError('请在空白作品中导入，现有页面未被覆盖',422);
 assertPortableName(input.asset);const opened=await session.call('open_presentation',{path:workspacePath(root,join('design','assets',input.asset),{mustExist:true})});
 const result=await captureDeckSource(session,root,doc,{imported:true,original:input.asset});doc.title=input.title||input.asset.replace(/\.(pptx|deckcraft)$/i,'');doc.native.deck.warnings=opened.data?.warnings||[];return {...result,warnings:doc.native.deck.warnings};
}
export async function editDeckSource(session,root,doc,input){
 if(doc.native?.deck?.mode!=='source')throw new SafetyError('当前作品没有导入的原生演示底稿',422);
 const source=store.readAsset(root,doc.native.deck.source);if(!source)throw new SafetyError('演示底稿缺失',422);
 const {model}=nativeDeckPackage(source),{page,index}=nativeSlideIndex(doc,model,input.pageId);
 await session.call('open_presentation',{path:workspacePath(root,join('design','assets',doc.native.deck.source),{mustExist:true})});await session.call('go_to_slide',{index});
 if(input.operation==='deck.clone'){await session.call('run_command',{command:'slide.duplicate',params:{index}});return captureDeckSource(session,root,doc,{clonePageId:page.id});}
 if(input.operation==='deck.delete'){if(doc.pages.length<=1)throw new SafetyError('作品至少保留一页',422);await session.call('run_command',{command:'slide.delete',params:{index}});return captureDeckSource(session,root,doc);}
 if(input.nativeObjectId!=null)await session.call('select',{ids:[Number(input.nativeObjectId)]});
 if(!Array.isArray(input.commands)||!input.commands.length||input.commands.length>32)throw new SafetyError('原生演示编辑需要1至32个命令',422);
 for(const command of input.commands){
  if(!/^(shape\.|text\.|format\.|table\.|chart\.|insert\.|animation\.|transition\.|slide\.notes$|design\.(?:background|colors|fonts|theme|effects|variant)$|edit\.delete$)/.test(command.id||''))throw new SafetyError('该命令不在原生对象编辑范围内',422);
  const params={...command.params};if(command.id==='slide.notes'||command.id.startsWith('transition.')||command.id==='design.background'&&!params.all)params.index=index;
  await session.call('run_command',{command:command.id,params});
 }
 return captureDeckSource(session,root,doc,{replaceNotes:input.commands.some(command=>command.id==='slide.notes')});
}
export async function styleDeckSource(session,root,doc,input){
 if(doc.native?.deck?.mode!=='source')throw new SafetyError('没有可修改主题的原生底稿',422);
 const bytes=store.readAsset(root,doc.native.deck.source),{model}=nativeDeckPackage(bytes),system=systemFor(input.resourceId),colors=system.colors;
 await session.call('open_presentation',{path:workspacePath(root,join('design','assets',doc.native.deck.source),{mustExist:true})});
 const slots={dk1:colors.ink,lt1:colors.bg,dk2:colors.muted||colors.ink,lt2:colors.surface,accent1:colors.primary,accent2:colors.accent,accent3:colors.success,accent4:colors.warning,accent5:colors.danger,accent6:colors.muted,hlink:colors.primary,folHlink:colors.accent};
 const palette=Object.fromEntries(Object.entries(slots).filter(([,value])=>value).map(([key,value])=>[key,value.length===4?'#'+value.slice(1).split('').map(c=>c+c).join(''):value]));
 const family=value=>String(value||'Microsoft YaHei').split(',')[0].replace(/["']/g,'').trim();
 for(let index=0;index<model.presentation.slides.length;index++){
  await session.call('go_to_slide',{index});await session.call('run_command',{command:'design.colors',params:{colors:palette}});
  await session.call('run_command',{command:'design.fonts',params:{major:family(system.fonts.heading),minor:family(system.fonts.body)}});
  const background=model.presentation.slides[index].background;
  if(!background||background.kind==='ref'||background.fill?.kind==='solid')await session.call('run_command',{command:'design.background',params:{index,color:colors.bg}});
 }
 applyResourceToDocument(doc,input.resourceId);return captureDeckSource(session,root,doc);
}
export function combineDeckSource(doc,sourcePackage,overlay){
 const original=sourcePackage.model,presentation=original.presentation;
 if(Math.abs(presentation.slideSize.width-doc.canvas.width*.75)>1e-6||Math.abs(presentation.slideSize.height-doc.canvas.height*.75)>1e-6)throw new SafetyError('普通画板尺寸与原生演示不一致，未重排或拉伸原始内容',422);
 const byId=new Map(presentation.slides.map(slide=>[slide.id,slide])),next=overlay.model.presentation;
 let blankLayout;
 if(doc.pages.some(page=>page.native?.engine!=='deckcraft')){const master=presentation.masters?.[0];if(!master)throw new SafetyError('原生母版缺失',422);blankLayout=next.nextId++;master.layouts.push({id:blankLayout,name:'DesignCraft Blank',kind:'blank',shapes:[],background:null,showMasterShapes:false,preserve:true});}
 const slides=doc.pages.map((page,index)=>{
  const base=page.native?.engine==='deckcraft'?byId.get(page.native.slideId):null,added=next.slides[index];
  if(page.native?.engine==='deckcraft'&&!base)throw new SafetyError('原生源页引用失效',422);
  return base?{...base,name:page.name,hidden:!!page.hidden,shapes:[...base.shapes,...added.shapes]}:{...added,layout:blankLayout,showMasterShapes:false};
 });
 const model={...original,presentation:{...presentation,slides,media:[...presentation.media,...next.media],nextId:next.nextId,props:{...presentation.props,title:doc.title}}};
 const entries=sourcePackage.entries.filter(entry=>entry.name!=='presentation.json');entries.push({name:'presentation.json',data:JSON.stringify(model)});
 entries.push(...overlay.entries.filter(entry=>entry.name.startsWith('media/')));return {buffer:createZip(entries),map:overlay.map,model};
}
