import {isActiveDesignSession} from './design-session.js?v=168';
import {selectionIdentity,validateSelectionReference} from './selection.js';
export function designBrief(state,request){
 const doc=state.doc;if(!doc||!state.root)throw new Error('请先打开设计作品');
 return ['使用 designcraft 技能和 designcraft_workspace 工具处理当前统一设计作品。',
  '用户任务：'+request.trim(),
  '工作区：'+state.root,'作品 ID：'+doc.id,'当前版本：'+state.revision,
  '页面 ID：'+(state.ui.pageId||doc.pages[0]?.id),'选中对象 ID：'+(state.ui.selectedId||'未选中'),
  doc.designSystem?.upstream?'设计资源：OpenDesign / '+doc.designSystem.upstream.id+' @ '+doc.designSystem.upstream.revision+'；渲染以 design-tokens.json 为准。':'沿用当前作品设计系统。',
  '先读取最新版本与对象；图片、矢量、设计和 PPT 复用当前素材与对象。通过带版本的命令或原生操作修改，不直接覆写 .dc.json。分步执行、检查真实结果，并说明未完成或不支持的部分。'
 ].join('\n');
}
export function insertDesignBrief(services,text){
 const assistant=services?.designAssistant,binding=assistant?.state?.binding?.getSnapshot?.(),actions=binding?.props?.inputActions;
 if(!isActiveDesignSession(services,binding?.key))throw new Error('项目设计对话尚未就绪');
 if(!binding?.key||!actions?.captureInsertion||!actions?.insertText)throw new Error('当前 DSH 输入框尚未就绪');
 const span=actions.captureInsertion();
 // Collapse at selection end: never replace a selected draft or discard file-reference chips.
 if(!actions.insertText('\n\n'+text,{...span,start:span.end}))throw new Error('DSH 输入框正在变化，设计任务未插入，请稍后重试');
 actions.persistDraft?.();return {sessionId:binding.key};
}

const OPEN='<designcraft-context>',CLOSE='</designcraft-context>';
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
const ownedPreview=new WeakMap();
const cleanPath=value=>{
 const raw=String(value||'').replace(/\\/g,'/').toLowerCase(),parts=[];
 for(const part of raw.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length||/^[a-z]:$/.test(parts.at(-1)))return '';parts.pop();}else parts.push(part);}
 return (raw.startsWith('//')?'//':raw.startsWith('/')?'/':'')+parts.join('/');
};
export function isDesignRootInSession(root,cwd){
 const target=cleanPath(root),base=cleanPath(cwd);
 return !!target&&!!base&&(target===base||target.startsWith(base+'/'));
}
function findLayer(layers,id){for(const layer of layers||[]){if(layer.id===id)return layer;const child=findLayer(layer.children,id);if(child)return child;}return null;}
function nativeLabel(layer,ids){return (layer.native?.nodes||layer.native?.layers||[]).filter(n=>ids.includes(Number(n.id))).map(n=>n.name||n.text||String(n.id)).slice(0,3).join('、');}
export function designChatContext(state,{wholePage=false}={}){
 const doc=state.doc,page=doc?.pages?.find(item=>item.id===state.ui?.pageId)||doc?.pages?.[0];
 const layer=wholePage?null:findLayer(page?.layers,state.ui?.selectedId);
 return {schema:2,root:state.root,docId:doc?.id||null,title:doc?.title||'新设计',pageId:page?.id||null,pageName:page?.name||null,layerId:layer?.id||null,layerName:(state.ui?.nativeSelection&&layer&&state.ui.nativeSelection.layerId===layer.id?nativeLabel(layer,state.ui.nativeSelection.ids):null)||layer?.name||layer?.text?.slice(0,48)||layer?.type||null,revision:state.revision||null,source:layer?.native?.source||null,selection:wholePage?{layerIds:[],native:null,region:null}:selectionIdentity(state)};
}
export function designChatPrompt(context,request){
 const text=String(request||'').trim();
 if(text.length>64000)throw new Error('单条设计消息过长，请分段发送');
 const workflow=context.motion
  ?'使用 designcraft-motion 技能，通过 designcraft_motion 编辑当前动画工程。先 open 和 read_source，再用 write_sources 处理选中的组件或时段。保护其他源码和素材。预览会加载新版本，用户可以播放和核对。用户确认后 render 导出真实 MP4。'
  :'使用 designcraft 技能，通过 designcraft_workspace 先读取当前作品的最新版本；没有作品时在当前项目创建。引用对象是本次任务的上下文，保持其他对象，使用版本化命令和真实原生操作，结果回到当前画布。不要直接覆写 .dc.json，不把未执行或失败的步骤报告为完成。';
 const metadata=JSON.stringify({...context,workflow}).replace(/</g,'\\u003c');
 return (text?text+'\n\n':'')+OPEN+metadata+CLOSE;
}
export const designContextTextRule={
 id:'designcraft.context',order:20,
 match(text,from){
  const start=text.indexOf(OPEN,from);if(start<0)return;
  const close=text.indexOf(CLOSE,start+OPEN.length);if(close<0||close-start>32000)return;
  let data;try{data=JSON.parse(text.slice(start+OPEN.length,close));}catch{return;}
  if(![1,2].includes(data?.schema)||typeof data.root!=='string')return;
  const end=close+CLOSE.length;
  return {id:'text',start,end,data:{text:text.slice(start,end),display:'引用：'+String(data.title||'设计作品')+(data.pageName?' · '+data.pageName:'')+(data.layerName?' · '+data.layerName:'')}};
 }
};

export function designSession(services,sessionId){
 const owner=services?.sessions?.binding?.(sessionId);
 const session=owner?.session,row=services?.sessions?.list?.getSnapshot?.()?.byId?.[sessionId];
 if(!session||!row?.cwd||session.sessionId!==sessionId)throw new Error('请先选择当前 DSH 项目和对话');
 if(session.getSnapshot?.().removed)throw new Error('当前 DSH 对话已不可用');
 return {owner,session,cwd:row.cwd};
}

export function withoutDesignReferences(draft){
 const references=[...(draft.references||[])].sort((a,b)=>a.offset-b.offset),parts=[],kept=[];let cursor=0,removed=0;
 for(const reference of references){
  if(reference.offset<cursor||reference.length!==reference.clipboardText.length||draft.text.slice(reference.offset,reference.offset+reference.length)!==reference.clipboardText)throw new Error('DSH 草稿引用结构不一致，未修改草稿');
  parts.push(draft.text.slice(cursor,reference.offset));
  if(reference.source==='designcraft')removed+=reference.length;
  else{parts.push(reference.clipboardText);kept.push({...reference,offset:reference.offset-removed});}
  cursor=reference.offset+reference.length;
 }
 parts.push(draft.text.slice(cursor));return {...draft,text:parts.join(''),references:kept};
}
export function withDesignReference(draft,context){
 const clean=withoutDesignReferences(draft),tagged=designChatPrompt(context,'')+' ';
 const separator=clean.text&&!/\s$/.test(clean.text)?' ':'';
 const offset=clean.text.length+separator.length;
 return {...clean,text:clean.text+separator+tagged,references:[...clean.references,{source:'designcraft',ref:JSON.stringify(context),offset,length:tagged.length,label:(context.layerName||context.pageName||context.title||'当前设计').slice(0,64),appearance:'file',clipboardText:tagged}]};
}

/** Quote the real canvas into the existing DSH composer, preserving its text, file chips and send pipeline. */
export async function attachDesignReference({store,sync,services,sessionId,auto=false,preview,prepareRegion,isCurrent=()=>true}){
 const {owner,cwd}=designSession(services,sessionId),conversation=services?.conversation;
 // 动画工作台：附 motion 工程上下文（设计画布检查全跳过，对话即界面）。
 const early=store.get();
 if(early.workspaceMode==='motion'&&early.motion?.projectId){
  const m=early.motion;
  const motionInput=conversation?.input?.for?.(owner.ctx);
  if(!motionInput?.draftSnapshot||!motionInput?.actions?.setDraft)throw new Error('DSH 原生输入框尚未就绪');
  if(!isCurrent())return {attached:false};
  if(m.scope?.sessionId!==sessionId||!isDesignRootInSession(m.scope?.root,cwd)||!isDesignRootInSession(cwd,m.scope.root))return {attached:false};
  const ids=Array.isArray(m.selection?.ids)?m.selection.ids.filter(id=>typeof id==='string'&&id.length>0&&id.length<=256).slice(0,128):[];
  const range=m.selection?.timeRange,validRange=Number.isSafeInteger(range?.startFrame)&&Number.isSafeInteger(range?.endFrame)&&range.startFrame>=0&&range.endFrame>=range.startFrame&&range.endFrame<m.durationFrames;
  const material=m.materialReference;
  const context={schema:2,root:m.scope.root,sessionId,docId:null,title:m.title||'动画',
   motion:{projectId:m.projectId,revision:m.revision,title:m.title,entryFile:m.entryFile,fps:m.fps,durationFrames:m.durationFrames,currentFrame:m.currentFrame,
    selectedIds:ids,timeRange:validRange?range:null,...(material?.nativeSource&&typeof material.path==='string'?{projectMaterial:{path:material.path,source:material.nativeSource}}:{})}};
  const phase=motionInput.state?.getSnapshot?.()?.phase;
  if(phase&&phase!=='plain')throw new Error('DSH 正在处理输入或指令，引用未插入，请稍后重试');
  const nativeDraft=motionInput.draftSnapshot,clean=withoutDesignReferences(nativeDraft);
  if(auto&&(clean.text.trim()||clean.references.length||motionInput.state?.getSnapshot?.()?.attachmentIds?.length))return {attached:false};
  motionInput.actions.setDraft(withDesignReference(nativeDraft,context));motionInput.actions.persistDraft?.();
  return {attached:true,context,preview:false};
 }
 const input=conversation?.input?.for?.(owner.ctx);
 if(!input?.draftSnapshot||!input?.actions?.setDraft)throw new Error('DSH 原生输入框尚未就绪');
 if(!store.get().root||!store.get().doc){if(auto)return {attached:false};throw new Error('请先打开或创建一个设计作品');}
 const before=store.get(),identity={root:before.root,id:before.doc.id,pageId:before.ui?.pageId,layerId:before.ui?.selectedId,selection:JSON.stringify(selectionIdentity(before))};
 if(!isDesignRootInSession(identity.root,cwd))throw new Error('画布与当前 DSH 对话不属于同一项目，请先切换到此作品所在的 DSH 项目');
 const current=()=>{
  const state=store.get();
  if(!isCurrent()||services.sessions.binding(sessionId)!==owner||state.root!==identity.root||state.doc?.id!==identity.id||state.ui?.pageId!==identity.pageId||state.ui?.selectedId!==identity.layerId||JSON.stringify(selectionIdentity(state))!==identity.selection)throw new Error('引用准备期间作品、对象或对话已切换，未改动输入框');
  return state;
 };
 await sync.flush();current();if(!auto&&prepareRegion){await prepareRegion();identity.selection=JSON.stringify(selectionIdentity(store.get()));}const saved=current();
 if(saved.nativeBusy)throw new Error('原生处理尚未完成，请完成后引用');
 if(saved.dirty||saved.conflict||saved.remoteDeleted||saved.saveError)throw new Error('画布尚未保存或存在冲突，请先处理后再引用');
 const context={...designChatContext(saved),sessionId};validateSelectionReference(context,saved.doc);const snapshot=copy({doc:saved.doc,ui:saved.ui,root:saved.root,revision:saved.revision});
 const file=preview?await preview(snapshot):null;
 if(preview&&(!file||!file.size||file.size>8*1024*1024))throw new Error('画板预览生成失败或超过8MB，引用未插入');
 if(file)context.previewRevision=saved.revision;
 const latest=current();if(latest.dirty||latest.revision!==saved.revision)throw new Error('画布在准备预览期间发生变化，请再次引用');
 const phase=input.state?.getSnapshot?.()?.phase;
 if(phase&&phase!=='plain')throw new Error('DSH 正在处理输入或指令，引用未插入，请稍后重试');
 const nativeDraft=input.draftSnapshot,clean=withoutDesignReferences(nativeDraft);
 if(auto&&(clean.text.trim()||clean.references.length||input.state?.getSnapshot?.()?.attachmentIds?.length))return {attached:false};
 const attachments=file?conversation.createDrafts(sessionId,[file]):[];
 try{
  if(attachments.length&&!input.addAttachments(attachments.map(item=>item.id)))throw new Error('DSH 输入框正在变化，预览未添加');
  input.actions.setDraft(withDesignReference(nativeDraft,context));input.actions.persistDraft?.();
  const prior=ownedPreview.get(input);
  if(prior&&input.state?.getSnapshot?.()?.attachmentIds?.includes(prior)){input.removeAttachment(prior);conversation.releaseDraftAttachment(prior);}
  if(attachments.length)ownedPreview.set(input,attachments[0].id);else ownedPreview.delete(input);
  return {attached:true,context,preview:!!file};
 }catch(error){for(const attachment of attachments){input.removeAttachment?.(attachment.id);conversation.releaseDraftAttachment?.(attachment.id);}throw error;}
}

/** Official DSH reference-source contract: a chip must have a real serializer before it can be sent. */
export function createDesignReferenceSource({store,sync,openDesign=()=>{},onError=()=>{}}){
 const parse=ref=>{
  if(typeof ref!=='string'||ref.length>32000)throw new Error('设计引用无效或过大');
  let data;try{data=JSON.parse(ref);}catch{throw new Error('设计引用格式不可用，请重新选择对象');}
  if(![1,2].includes(data?.schema)||typeof data.root!=='string'||typeof data.sessionId!=='string'||typeof data.docId!=='string')throw new Error('设计引用缺少作品或所属对话，请重新引用');
  const {cwd}=designSession(store.get().services,data.sessionId);
  if(!isDesignRootInSession(data.root,cwd))throw new Error('此设计引用不属于当前对话项目');
  return data;
 };
 const insertion=context=>({source:'designcraft',ref:JSON.stringify(context),label:(context.layerName||context.pageName||context.title).slice(0,64),appearance:'file',clipboardText:designChatPrompt(context,'')+' '});
 return {
  trigger:'@',name:'designcraft',order:1,showGroupTitle:true,
  candidates(session,{query='',signal}){
   if(store.get().workspaceMode!=='legacy')return Promise.resolve([]);
   if(signal?.aborted)return Promise.resolve([]);
   const state=store.get();if(!state.doc||!state.root)return Promise.resolve([]);
   let scope;try{scope=designSession(state.services,session.sessionId);}catch{return Promise.resolve([]);}
   if(!isDesignRootInSession(state.root,scope.cwd))return Promise.resolve([]);
   const rows=[];let visited=0;
   for(const page of state.doc.pages||[]){
    if(visited>=2000||rows.length>=200)break;
    const add=(layer,node)=>{if(rows.length>=200||++visited>2000)return;const nativeSelection=node?{pageId:page.id,layerId:layer.id,source:layer.native.source,engine:layer.native.engine,ids:[Number(node.id)]}:null;const item=designChatContext({...state,wandMask:null,uiSelection:null,ui:{...state.ui,pageId:page.id,selectedId:layer?.id||null,selectedIds:layer?[layer.id]:[],nativeSelection,nativeTargets:{}}});const context={...item,sessionId:session.sessionId};const name=layer?(item.layerName||layer.type):(page.name||'画板');if(!query||name.toLowerCase().includes(query.toLowerCase()))rows.push({name,description:state.doc.title+' · '+(page.name||'画板'),icon:'file',section:'当前设计',value:JSON.stringify(context)});};
    add(null);const walk=layers=>{for(const layer of layers||[]){if(rows.length>=200||visited>=2000)break;add(layer);for(const node of layer.native?.nodes||layer.native?.layers||[]){if(rows.length>=200||visited>=2000)break;if(!node.container)add(layer,node);}walk(layer.children);}};walk(page.layers);
   }
   return Promise.resolve(rows.slice(0,30));
  },
  onPick({candidate}){return {insert:insertion(parse(candidate.value))};},
  openReference(session,{ref}){
   const context=parse(ref);if(context.sessionId!==session.sessionId)return false;
   Promise.resolve().then(async()=>{
    await sync.flush();
    const currentSession=store.get().services?.designAssistant?.scope?.()?.sessionId;
    if(currentSession&&currentSession!==session.sessionId)throw new Error('当前对话已切换，未打开旧引用');
    if(store.get().root!==context.root)await sync.setRoot(context.root);
    if(store.get().doc?.id!==context.docId)await sync.openDoc(context.docId);
    const page=store.get().doc?.pages?.find(item=>item.id===context.pageId);
    validateSelectionReference(context,store.get().doc);
    const native=context.selection?.native;
    store.set({uiSelection:context.selection?.region||null,ui:{...store.get().ui,pageId:context.pageId,selectedId:context.layerId,selectedIds:context.selection?.layerIds||[context.layerId].filter(Boolean),nativeSelection:native?{...native,pageId:context.pageId,layerId:context.layerId}:null,chatOpen:true}});openDesign();
   }).catch(onError);return true;
  },
  codec:{
   clipboardText:ref=>designChatPrompt(parse(ref),'')+' ',
   async serialize(ref,signal){
    signal?.throwIfAborted();let context=parse(ref);const state=store.get();
    if(state.root===context.root&&state.doc?.id===context.docId){
     await sync.flush();signal?.throwIfAborted();const saved=store.get();parse(ref);
     if(saved.root!==context.root||saved.doc?.id!==context.docId)throw new Error('发送期间作品已切换，请确认引用后重试');
     if(saved.dirty||saved.conflict||saved.saveError||saved.remoteDeleted)throw new Error('画布尚未保存或存在冲突，消息未发送');
     if(context.selection?.region&&context.revision!==saved.revision)throw new Error('圈选后作品已改变，请重新引用区域');
     if(context.previewRevision&&context.previewRevision!==saved.revision)throw new Error('画布在附上预览后已修改，请重新引用以更新预览，再发送消息');
     const page=saved.doc.pages.find(item=>item.id===context.pageId);
     validateSelectionReference(context,saved.doc);
     context={...context,revision:saved.revision};
    }
    if(context.selection?.native&&(store.get().root!==context.root||store.get().doc?.id!==context.docId))throw new Error('请先打开原生引用所属作品，核对源对象后发送');
    return designChatPrompt(context,'');
   }
  }
 };
}

/** The installed DSH right preview is available in its native conversation surface. */
export async function openNativeChatReference({store,sync,sessionId,reference}){
 const services=store.get().services,{owner}=designSession(services,sessionId),ctx=services.uiWorkspace?.ctx,layout=ctx?.get?.('layout');
 if(!layout)throw new Error('DSH 文件预览暂不可用');
 const root=store.get().root,id=store.get().doc?.id;
 await sync.flush();
 if(services.sessions.binding(sessionId)!==owner||store.get().root!==root||store.get().doc?.id!==id||!isActiveDesignSession(services,sessionId))throw new Error('作品或对话已切换，未打开旧引用');
 layout.selectPanel(null);
 await new Promise(resolve=>{const timer=setTimeout(resolve,100);globalThis.requestAnimationFrame?.(()=>{clearTimeout(timer);resolve();});if(!globalThis.requestAnimationFrame){clearTimeout(timer);resolve();}});
 const controller=ctx.get('inputTriggers')?.sessionOf?.(owner.ctx);
 if(!controller?.openReference(reference.source,{ref:reference.ref,...(reference.appearance?{appearance:reference.appearance}:{})}))throw new Error('引用暂时无法打开，请在原对话中重试');
 return {opened:true,sessionId};
}
