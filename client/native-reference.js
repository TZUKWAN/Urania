import {isActiveDesignSession} from './design-session.js?v=165';
import {designSession,isDesignRootInSession} from './dsh-context.js';
import {sameUint64} from './native-protocol.js?v=165';
import {aiCanvasTarget} from './ai-canvas.js?v=165';
import {sameObjectIds} from './native-contract.js?v=165';

const NAME='designcraft-editor',OPEN='[DesignCraftEditor]',CLOSE='[/DesignCraftEditor]';
const label=context=>context.title+' · '+aiCanvasTarget(context);
const samePage=(left,right)=>JSON.stringify(left??null)===JSON.stringify(right??null);
const prompt=context=>OPEN+JSON.stringify({...context,workflow:'Read designcraft_editor state before editing and copy its CURRENT view.base including engine and selectionStamp. objectIds belong to sourceId; nativeSelection preserves the real engine selection. Use the declared native coordinateSpace and selection transforms, not preview pixels or assumed Vector coordinates. Large uint64 IDs are decimal strings; use {$u64:"decimal-id"} in command params, never Number(id). Re-read after page/source/revision/selection context changes. Limit requested edits to the selected objectIds, real pixel coverage, or current page unless the user explicitly asks for a broader scope. Preserve all other objects, manual positions, styles and notes. Keep manual changes; do not modify files or dcDoc behind the live App. Completion needs the actual native checkpoint.'})+CLOSE;
const textFor=context=>prompt(context)+' ';

function removeOwn(draft){
 const refs=[...(draft.references||[])].sort((a,b)=>a.offset-b.offset),kept=[],parts=[];let cursor=0,removed=0;
 for(const ref of refs){
  if(ref.offset<cursor||draft.text.slice(ref.offset,ref.offset+ref.length)!==ref.clipboardText)throw new Error('DSH 引用结构已改变，未修改草稿');
  parts.push(draft.text.slice(cursor,ref.offset));
  if(ref.source===NAME)removed+=ref.length;else{parts.push(ref.clipboardText);kept.push({...ref,offset:ref.offset-removed});}
  cursor=ref.offset+ref.length;
 }
 parts.push(draft.text.slice(cursor));
 const removedRanges=refs.filter(ref=>ref.source===NAME),quotes=draft.quotes?.map(quote=>{
  if(!Number.isSafeInteger(quote.offset)||!Number.isSafeInteger(quote.length)||quote.offset<0||quote.length<0||quote.offset+quote.length>draft.text.length||removedRanges.some(ref=>quote.offset<ref.offset+ref.length&&ref.offset<quote.offset+quote.length))throw new Error('DSH 引用结构已改变，未修改草稿');
  return {...quote,offset:quote.offset-removedRanges.filter(ref=>ref.offset+ref.length<=quote.offset).reduce((sum,ref)=>sum+ref.length,0)};
 });
 return {...draft,text:parts.join(''),references:kept,...(quotes?{quotes}:{})};
}

export function nativeInputAdmissionLocked(input){
 const state=input?.state?.getSnapshot?.();
 if(!state)throw new Error('DSH 输入框尚未就绪');
 // Public phase contract in both actual SDK builds. Never require private
 // detached/attachment Maps: the installed desktop uses phase="sending".
 return !!input.disposed||['adjudicating','submitting','sending'].includes(state.phase);
}

export async function quoteNative({controller,services,sessionId,auto=false,liveSelection=false,isCurrent=()=>true}){
 if(!isCurrent()||(auto&&controller.parking))return;
 // Live selection is displayed beside the canvas. Attach its exact reference
 // only on an intentional Send, never by rewriting an editable/in-flight draft.
 if(auto)return controller.context();
 const {owner,cwd}=designSession(services,sessionId),input=services.conversation?.input?.for?.(owner.ctx);
 if(!input?.actions?.setDraft)throw new Error('DSH 输入框尚未就绪');
 const locked=()=>nativeInputAdmissionLocked(input);
 if(locked()){if(auto)return;throw new Error('消息正在发送，请稍后修改引用');}
 if(controller.view?.sessionId!==sessionId||!isDesignRootInSession(controller.view.root,cwd))throw new Error('当前设计不属于此 DSH 对话');
 const clean=removeOwn(input.draftSnapshot);
 if(auto&&!liveSelection&&(clean.text.trim()||clean.references.length||input.state.getSnapshot().attachmentIds.length))return;
 if(controller.busy)throw new Error('设计动作尚未结束，请完成后引用');
 // Automatic chips identify live objects; serialization at Send still validates
 // and checkpoints them. Selection updates must not each start another save.
 const intended=auto?controller.context():await controller.referenceContext();
 if(!auto){if(controller.state.hostMenuOpen)await controller.resumeHostMenu();await controller.flush();await controller.referenceContext();}
 if(!isCurrent())return;
 const context=controller.context();if(!context)return;
 if(intended&&(intended.sourceId!==context.sourceId||intended.epoch!==context.epoch||!sameUint64(intended.engineUid,context.engineUid)||JSON.stringify(intended.objectIds)!==JSON.stringify(context.objectIds)||intended.selectionStamp!==context.selectionStamp||!samePage(intended.page,context.page)))throw new Error('准备引用时作品、画板或原生选区已改变，请重新引用');
 if(!isActiveDesignSession(services,sessionId))throw new Error('准备引用时对话已切换');
 const latest=removeOwn(input.draftSnapshot);
 if(locked()){if(auto)return;throw new Error('消息正在发送，请稍后修改引用');}
 if(!isCurrent())return;
 if(auto&&!liveSelection&&(latest.text.trim()||latest.references.length))return;
 // A checkpoint-only source revision update is serialized at Send; do not
 // reset the caret on each autosave or rerender.
 const previous=input.draftSnapshot.references?.filter(ref=>ref.source===NAME);
 if(auto&&previous?.length===1){try{const old=JSON.parse(previous[0].ref),{sourceRevision:oldRevision,...oldScope}=old,{sourceRevision:newRevision,...newScope}=context;if(JSON.stringify(oldScope)===JSON.stringify(newScope))return context;}catch{}}
 const tagged=textFor(context),separator=latest.text&&!/\s$/.test(latest.text)?' ':'';
 const text=latest.text+separator+tagged;
 input.actions.setDraft({...latest,text,references:[...latest.references,{source:NAME,ref:JSON.stringify(context),offset:latest.text.length+separator.length,length:tagged.length,label:label(context),appearance:'file',clipboardText:tagged}]});
 input.actions.persistDraft?.();return context;
}

export function nativeReferenceSource({controller,store}){
 const parse=ref=>{const context=JSON.parse(ref);if(![1,2].includes(context.schema)||typeof context.sourceId!=='string')throw new Error('原生设计引用无效');return context;};
 return {trigger:'@',name:NAME,order:0,showGroupTitle:true,
  async candidates(session,{query=''}){const context=controller.context();if(!context||context.sessionId!==session.sessionId||!context.title.toLowerCase().includes(query.toLowerCase()))return [];return [{name:context.title,description:'当前专业设计',icon:'file',section:'设计工作区',value:JSON.stringify(context)}];},
  onPick({candidate}){const context=parse(candidate.value);return {insert:{source:NAME,ref:candidate.value,label:label(context),appearance:'file',clipboardText:textFor(context)}};},
  codec:{clipboardText:ref=>textFor(parse(ref)),async serialize(ref,signal){
   signal?.throwIfAborted();const context=parse(ref);designSession(store.get().services,context.sessionId);
   if(controller.parking)await controller.parking;
   if(controller.state.hostMenuOpen)await controller.resumeHostMenu();signal?.throwIfAborted();
   await controller.flush();const current=await controller.referenceContext();signal?.throwIfAborted();
   if(!current||context.editorProtocol!==current.editorProtocol||context.sessionId!==current.sessionId||context.sourceId!==current.sourceId||context.epoch!==current.epoch||context.engine!==current.engine||!sameUint64(context.engineUid,current.engineUid)||!sameUint64(context.engineRevision,current.engineRevision)||!sameObjectIds(context.objectIds,current.objectIds)||context.selectionStamp!==current.selectionStamp||!samePage(context.page,current.page))throw new Error('设计已变化（协议、作品、画板或原生选区），请重新引用后发送，未发送旧对象或旧预览');
   return prompt({...context,sourceRevision:current.sourceRevision});
  }}
 };
}

export const nativeContextTextRule={id:NAME,order:19,match(text,from){const start=text.indexOf(OPEN,from);if(start<0)return;const close=text.indexOf(CLOSE,start+OPEN.length);if(close<0||close-start>32000)return;try{const context=JSON.parse(text.slice(start+OPEN.length,close));const end=close+CLOSE.length;return {id:'text',start,end,data:{text:text.slice(start,end),display:'引用：'+context.title+(context.objectIds?.length?' · 选中对象':'')}};}catch{return;}}};

// The SDK reference chip keeps the machine contract out of the editable human
// draft while its public codec still serializes the complete original request.
const REQUEST_SOURCE='designcraft-request';
function parseDesignRequest(ref){
 const request=typeof ref==='string'?JSON.parse(ref):ref;
 if(!request||request.schema!==1||typeof request.sessionId!=='string'||!request.sessionId||
  !/^(submission|diagnostic)-[a-f0-9-]{36}$/.test(request.id||'')||
  typeof request.label!=='string'||!request.label.trim()||request.label.length>80||
  typeof request.prompt!=='string'||!request.prompt||request.prompt.length>512000)throw new Error('设计请求引用无效，原意见仍保存在项目中');
 return request;
}
export function withDesignRequestReference(draft,{sessionId,id,label,prompt}){
 const request=parseDesignRequest({schema:1,sessionId,id,label,prompt}),separator=draft.text?'\n\n':'',offset=draft.text.length+separator.length;
 return {...draft,text:draft.text+separator+prompt,references:[...(draft.references||[]),{source:REQUEST_SOURCE,ref:JSON.stringify(request),offset,length:prompt.length,label,appearance:'file',clipboardText:prompt}]};
}
export function designRequestReferenceSource({store}){
 return {trigger:'@',name:REQUEST_SOURCE,order:1,showGroupTitle:false,async candidates(){return [];},
  codec:{clipboardText:ref=>parseDesignRequest(ref).prompt,async serialize(ref,signal){
   signal?.throwIfAborted();const request=parseDesignRequest(ref),services=store.get().services;
   if(!isActiveDesignSession(services,request.sessionId))throw new Error('设计对话已切换，意见仍保留，未发送到其他对话');
   designSession(services,request.sessionId);return request.prompt;
  }}
 };
}
export const designRequestTextRule={id:REQUEST_SOURCE,order:18,match(text,from){
 const variants=[['[UraniaFeedback]','[/UraniaFeedback]','设计意见'],['[UraniaDiagnostic]','[/UraniaDiagnostic]','设计诊断']];
 const matches=variants.map(([open,close,label])=>({open,close,label,start:text.indexOf(open,from)})).filter(m=>m.start>=0).sort((a,b)=>a.start-b.start);
 for(const {open,close,label,start} of matches){const end=text.indexOf(close,start+open.length);if(end<0||end-start>512000)continue;try{const data=JSON.parse(text.slice(start+open.length,end));return {id:'text',start,end:end+close.length,data:{text:text.slice(start,end+close.length),display:label+(Array.isArray(data.items)?' · '+data.items.length+' 条':'')}};}catch{}}
}};
