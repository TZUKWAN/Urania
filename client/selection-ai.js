import {aiCanvasTarget} from './ai-canvas.js?v=168';
import {selectedObjectIds} from './native-contract.js?v=168';
import {nativeFeedbackTarget,feedbackTargetKey} from './feedback-contract.js?v=168';
import {createStudioComponents,userFacingError} from './studio-system.js?v=168';
export function createSelectionAi(React){
 const h=React.createElement;
 const {Icon,Button}=createStudioComponents(React);
 return function SelectionAi({controller,native,feedback,onShowChat}){
  const [dismissed,setDismissed]=React.useState(null),[sending,setSending]=React.useState(false),[error,setError]=React.useState(null),[geometry,setGeometry]=React.useState({left:0,top:0,width:330}),input=React.useRef(null),edited=React.useRef(null),popup=React.useRef(null);
  const saved=React.useSyncExternalStore(feedback.subscribe,feedback.get,feedback.get);
  const document=native.document,intent=native.selectionIntent;
  let target=null;try{target=nativeFeedbackTarget(controller.context(),{region:intent?.region});}catch{}
  const text=target?feedback.draft(target):'';
  const targetKey=target?feedbackTargetKey(target):null;
  React.useLayoutEffect(()=>{
   const active=edited.current;if(!active||!target||targetKey===feedbackTargetKey(active.target))return;
   if(active.generation===feedback.generation&&active.epoch===native.epoch&&feedback.carryExpandedDraft(active.target,target))edited.current={target,generation:feedback.generation,epoch:native.epoch};
   else edited.current=null;
  },[targetKey,feedback.generation,native.epoch]);
  const selected=selectedObjectIds(document).length||document?.nativeSelection?.data?.rasterSelection||document?.nativeSelection?.data?.selection?.slides?.length>1;
  const visible=!!((selected||intent?.focus||intent?.region)&&intent?.sourceId===native.sourceId&&intent.epoch===native.epoch&&intent.id!==dismissed&&!native.hostMenuOpen&&!native.fileAction&&!native.pendingDraft&&!native.busy&&native.phase==='ready');
  React.useEffect(()=>{const down=event=>{if(event.key==='Shift')controller.change({aiMultiSelecting:true});},up=event=>{if(event.key==='Shift')controller.change({aiMultiSelecting:false});},pointer=event=>controller.change({aiMultiSelecting:!!event.shiftKey});addEventListener('keydown',down,true);addEventListener('keyup',up,true);addEventListener('pointerdown',pointer,true);return()=>{removeEventListener('keydown',down,true);removeEventListener('keyup',up,true);removeEventListener('pointerdown',pointer,true);};},[controller]);
  React.useLayoutEffect(()=>{
   if(!visible)return;const frame=controller.surface?.frame;if(!frame)return;
   const place=()=>{
    const rect=frame.getBoundingClientRect(),left=Math.max(8,rect.left+8),right=Math.min(innerWidth-8,rect.right-8);
    const width=Math.min(338,Math.max(1,right-left)),height=popup.current?.offsetHeight||178;
    const x=rect.left+(intent.anchor?.x??rect.width/2),y=rect.top+(intent.anchor?.y??rect.height/2);
    const bottom=Math.min(innerHeight-8,rect.bottom-8),floor=Math.max(8,rect.top+8);
    const next={width,left:Math.max(left,Math.min(x+13,right-width)),top:Math.max(floor,Math.min(y+15<=bottom-height?y+15:y-height-12,bottom-height))};
    setGeometry(current=>current.left===next.left&&current.top===next.top&&current.width===next.width?current:next);
   };
   const observer=new ResizeObserver(place);observer.observe(frame);if(popup.current)observer.observe(popup.current);addEventListener('resize',place);place();return()=>{observer.disconnect();removeEventListener('resize',place);};
  },[visible,intent?.id,controller.surface]);
  React.useEffect(()=>{setError(null);if(visible&&intent.focus){const handle=requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(handle);}},[visible,intent?.id]);
  if(!visible)return null;
  const submit=async(event,defer=false)=>{event.preventDefault();if(sending||!text.trim())return;setSending(true);setError(null);try{const result=await feedback.selection(text,{defer,region:intent?.region});edited.current=null;setDismissed(intent.id);controller.change({aiInputNotice:defer?'意见已保存，可到“设计意见”一起提交。':result.staged?'意见已放入左侧对话，原草稿和附件已保留，请核对后发送。':'意见已保存并提交，AI 收到后会在“设计意见”显示回执。'});if(result.staged)onShowChat?.();}catch(cause){setError(userFacingError(cause));}finally{setSending(false);}};
  const close=()=>{edited.current=null;setDismissed(intent.id);};
  return h('form',{ref:popup,className:'dcSelectionAi','data-multiselect':!!native.aiMultiSelecting,style:{...geometry,pointerEvents:native.aiMultiSelecting?'none':'auto'},onSubmit:submit,role:'dialog','aria-label':'修改所选内容',onPointerDown:event=>event.stopPropagation(),onKeyDown:event=>{if(event.key==='Escape'&&!event.isComposing&&!event.nativeEvent?.isComposing){event.preventDefault();close();}}},
   h('div',{className:'dcSelectionAiHead'},h('span',{className:'dcStudioAiBadge'},h(Icon,{name:'ai',size:14})),h('strong',null,aiCanvasTarget(document)),h(Button,{icon:'close',label:'关闭选区 AI 输入',onClick:close})),
   h('textarea',{ref:input,value:text,disabled:!target||saved.loading,placeholder:'想怎样修改？例如：改成深蓝色，保持其他内容',rows:3,'aria-label':'选区修改要求',onChange:event=>{try{feedback.setDraft(target,event.target.value);edited.current={target,generation:feedback.generation,epoch:native.epoch};}catch(error){setError(error.message);}},onKeyDown:event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent?.isComposing&&!event.isComposing){event.preventDefault();event.currentTarget.form.requestSubmit();}}}),
   error?h('div',{className:'dcChatError',role:'alert'},error):null,
   h('div',{className:'dcSelectionAiFoot'},h('small',null,'Enter 发送 · Shift+Enter 换行'),h('button',{className:'dcBtn',type:'button',disabled:sending||!text.trim(),onClick:event=>submit(event,true)},'暂存意见'),h('button',{className:'dcBtn dcPrimary',type:'submit',disabled:sending||!text.trim()||native.projectPending||native.manualEditing},sending?'正在提交…':'发送给 AI')));
 };
}
