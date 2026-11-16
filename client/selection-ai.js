import {aiCanvasTarget} from './ai-canvas.js?v=163';
import {selectedObjectIds} from './native-contract.js?v=163';
import {submitNativePrompt} from './native-ai-input.js?v=163';
export function createSelectionAi(React){
 const h=React.createElement;
 return function SelectionAi({controller,native,services,sessionId}){
  const [drafts,setDrafts]=React.useState({}),[dismissed,setDismissed]=React.useState(null),[sending,setSending]=React.useState(false),[error,setError]=React.useState(null),[geometry,setGeometry]=React.useState({left:0,top:0,width:330}),input=React.useRef(null);
  const document=native.document,intent=native.selectionIntent,scope=sessionId+'|'+native.sourceId,text=drafts[scope]||'';
  const selected=selectedObjectIds(document).length||document?.nativeSelection?.data?.rasterSelection||document?.nativeSelection?.data?.selection?.slides?.length>1;
  const visible=!!(selected&&intent?.sourceId===native.sourceId&&intent.epoch===native.epoch&&intent.id!==dismissed&&!native.hostMenuOpen&&!native.fileAction&&!native.pendingDraft&&!native.busy&&native.phase==='ready');
  React.useEffect(()=>{const down=event=>{if(event.key==='Shift')controller.change({aiMultiSelecting:true});},up=event=>{if(event.key==='Shift')controller.change({aiMultiSelecting:false});},pointer=event=>controller.change({aiMultiSelecting:!!event.shiftKey});addEventListener('keydown',down,true);addEventListener('keyup',up,true);addEventListener('pointerdown',pointer,true);return()=>{removeEventListener('keydown',down,true);removeEventListener('keyup',up,true);removeEventListener('pointerdown',pointer,true);};},[controller]);
  React.useLayoutEffect(()=>{
   if(!visible)return;const frame=controller.surface?.frame;if(!frame)return;
   const place=()=>{const r=frame.getBoundingClientRect(),width=Math.min(340,Math.max(240,r.width-24)),height=196,x=r.left+(intent.anchor?.x??r.width/2),y=r.top+(intent.anchor?.y??r.height/2);setGeometry({width,left:Math.max(r.left+8,Math.min(x+14,r.right-width-8)),top:Math.max(r.top+8,Math.min(y+18,r.bottom-height-8))});};
   const observer=new ResizeObserver(place);observer.observe(frame);addEventListener('resize',place);place();return()=>{observer.disconnect();removeEventListener('resize',place);};
  },[visible,intent?.id,controller.surface]);
  React.useEffect(()=>{setError(null);if(visible&&intent.focus){const handle=requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(handle);}},[visible,intent?.id]);
  if(!visible)return null;
  const submit=async event=>{event.preventDefault();if(sending||!text.trim())return;setSending(true);setError(null);try{const result=await submitNativePrompt({controller,services,sessionId,text,isCurrent:()=>controller.view?.sessionId===sessionId&&controller.state.sourceId===native.sourceId});setDrafts(all=>({...all,[scope]:''}));setDismissed(intent.id);controller.change({aiInputNotice:result.staged?'已放入左侧对话，原草稿和附件已保留，请核对后发送。':null});if(result.staged)documentQueryComposer()?.focus();}catch(cause){setError(cause.message);}finally{setSending(false);}};
  return h('form',{className:'dcSelectionAi',style:{...geometry,pointerEvents:native.aiMultiSelecting?'none':'auto',opacity:native.aiMultiSelecting?0.45:1},onSubmit:submit,role:'dialog','aria-label':'修改所选内容',onPointerDown:event=>event.stopPropagation(),onKeyDown:event=>{if(event.key==='Escape'){event.preventDefault();setDismissed(intent.id);}}},
   h('div',{className:'dcSelectionAiHead'},h('strong',null,aiCanvasTarget(document)),h('button',{className:'dcSelectionAiClose',type:'button','aria-label':'关闭选区 AI 输入',onClick:()=>setDismissed(intent.id)},'×')),
   h('textarea',{ref:input,value:text,placeholder:'想怎样修改？例如：改成深蓝色，保持其他内容',rows:3,'aria-label':'选区修改要求',onChange:event=>setDrafts(all=>({...all,[scope]:event.target.value})),onKeyDown:event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent?.isComposing&&!event.isComposing){event.preventDefault();event.currentTarget.form.requestSubmit();}}}),
   error?h('div',{className:'dcChatError',role:'alert'},error):null,
   h('div',{className:'dcSelectionAiFoot'},h('small',null,'Enter 发送 · Shift+Enter 换行'),h('button',{className:'dcBtn dcPrimary',type:'submit',disabled:sending||!text.trim()||native.projectPending||native.manualEditing},sending?'正在提交…':'发送给 AI')));
 };
}
function documentQueryComposer(){return document.querySelector('.dcChat [contenteditable=true]');}
