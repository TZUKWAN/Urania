import {isActiveDesignSession} from './design-session.js?v=168';
import {designSession,isDesignRootInSession} from './dsh-context.js';
import {quoteNative,nativeInputAdmissionLocked,withDesignRequestReference} from './native-reference.js?v=168';
const preparing=new WeakSet();
export function currentNativeInput(services,sessionId){if(!isActiveDesignSession(services,sessionId))throw new Error('项目设计对话尚未就绪');const {owner,cwd}=designSession(services,sessionId),input=services.conversation?.input?.for?.(owner.ctx);if(!input?.actions?.setDraft||!input.actions.submit)throw new Error('当前 DSH 对话输入接口尚未就绪');return {input,cwd};}
export async function submitNativePrompt({controller,services,sessionId,text,isCurrent=()=>true}){
 const {input,cwd}=currentNativeInput(services,sessionId);
 if(preparing.has(input)||nativeInputAdmissionLocked(input))throw new Error('消息正在提交，请稍候');
 if(controller.view?.sessionId!==sessionId||!isDesignRootInSession(controller.view.root,cwd)||!isCurrent())throw new Error('设计或对话已切换，要求尚未发送');
 const extra=text===undefined?null:String(text).trim();if(extra!==null&&!extra)throw new Error('请先输入修改要求');
 preparing.add(input);
 try{
  const old=input.draftSnapshot,hasHumanDraft=draft=>!!(draft.text.replace(/\[DesignCraftEditor\][\s\S]*?\[\/DesignCraftEditor\]/g,'').trim()||(draft.references||[]).some(ref=>ref.source!=='designcraft-editor')||(draft.quotes||[]).length||input.state.getSnapshot().attachmentIds?.length);
  // Select only at the user's Send action. Selection changes never rewrite an
  // editable or in-flight draft, so both installed SDK send lifecycles are safe.
  const context=await quoteNative({controller,services,sessionId,isCurrent});
  if(!context||!isCurrent()||!isActiveDesignSession(services,sessionId))throw new Error('发送前设计或对话已切换，原草稿已保留');
  if(nativeInputAdmissionLocked(input))throw new Error('消息正在提交，修改要求已留在草稿');
  const stageExisting=extra!==null&&(hasHumanDraft(old)||hasHumanDraft(input.draftSnapshot));
  if(extra!==null){const latest=input.draftSnapshot;input.actions.setDraft({...latest,text:latest.text+(latest.text&&!/\s$/.test(latest.text)?' ':'')+extra});input.actions.persistDraft?.();}
  if(stageExisting)return {staged:true,context};
  input.actions.submit();controller.change?.({aiInputNotice:null});return {submitted:true,context};
 }finally{preparing.delete(input);}
}
/** A persisted batch may span pages; do not replace it with the current selection. */
export async function submitDesignFeedbackPrompt({services,sessionId,text,submissionId,label='设计意见',isCurrent=()=>true}){
 const {input}=currentNativeInput(services,sessionId);
 if(preparing.has(input)||nativeInputAdmissionLocked(input)||!isCurrent())throw Object.assign(new Error('消息正在提交或设计对话已切换，意见已保留'),{beforeInput:true});
 preparing.add(input);
 try{
  const latest=input.draftSnapshot;
  if(latest.text.includes(submissionId))return {staged:true};
  const occupied=!!(latest.text.trim()||(latest.references||[]).length||(latest.quotes||[]).length||input.state.getSnapshot().attachmentIds?.length);
  input.actions.setDraft(withDesignRequestReference(latest,{sessionId,id:submissionId,label,prompt:text}));input.actions.persistDraft?.();
  if(occupied)return {staged:true};
  if(!isCurrent()||!isActiveDesignSession(services,sessionId))throw new Error('设计对话已切换，意见已留在草稿');
  input.actions.submit();return {submitted:true};
 }finally{preparing.delete(input);}
}
