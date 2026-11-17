import {nativeBase} from './native-contract.js?v=165';
export const isDeckLocalAction=action=>action==='local_ink_text';
export function createDeckLocalTools(React){
 const h=React.createElement;
 return function DeckLocalTools({controller,request,ready}){
  const dialog=React.useRef(null),live=React.useRef(true),lock=React.useRef(false),cancelled=React.useRef(false),abort=React.useRef(null);
  const origin=React.useRef({id:controller.view.id,epoch:controller.view.epoch,root:controller.view.root,sourceId:controller.view.sourceId,base:nativeBase(controller.state.document)});
  const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[candidate,setCandidate]=React.useState(null);
  const current=()=>{const v=controller.view,o=origin.current;if(cancelled.current||!live.current||v?.id!==o.id||v?.epoch!==o.epoch||v?.root!==o.root||v?.sourceId!==o.sourceId)throw new Error('操作已取消或设计已切换，结果未写入其他作品');};
  React.useEffect(()=>{live.current=true;dialog.current?.showModal();const leave=()=>abort.current?.abort();window.addEventListener('pagehide',leave);return()=>{live.current=false;leave();window.removeEventListener('pagehide',leave);};},[]);
  const run=fn=>async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{current();await fn();}catch(error){if(live.current)setError(error.message||String(error));}finally{lock.current=false;if(live.current)setBusy(false);}};
  const recognize=async()=>{
   const selected=await controller.inspectDeckInk();current();abort.current=new AbortController();
   const response=await fetch('/designcraft/api/v2/studio/deck-local',{method:'POST',headers:{...controller.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action:'recognize',epoch:origin.current.epoch,base:selected.base,mode:'text',strokes:selected.value.strokes}),signal:abort.current.signal});
   const result=await response.json();current();if(!response.ok||!result.ok||result.mode!=='text')throw new Error(result.error||'本地文字识别失败，原笔迹保留');
   setCandidate({text:result.text,ids:selected.value.ids,base:selected.base,engine:result.engine});
  };
  const apply=async()=>{
   if(controller.state.deckLocalApplied){await controller.completeDeckLocal();return;}
   if(!candidate)throw new Error('请先识别当前笔迹');current();
   await controller.completeDeckLocal('draw.inkToText',{ids:candidate.ids,text:candidate.text,hideOriginal:true},candidate.base);
  };
  const cancel=async()=>{if(controller.state.busy||controller.state.deckLocalApplied)return;cancelled.current=true;abort.current?.abort();try{await controller.cancelNativeFile();}catch(e){if(live.current)setError(e.message);}};
  if(!isDeckLocalAction(request.action))return null;
  return h('dialog',{ref:dialog,className:'dcNativeFileDialog',style:{width:'min(720px,calc(100vw - 32px))'},'aria-label':'墨迹转文字',onCancel:event=>{event.preventDefault();cancel();}},
   h('div',{className:'dcNativeConfirmCard',style:{width:'100%',boxSizing:'border-box',maxHeight:'85vh',overflow:'auto'}},
    h('h3',null,'墨迹转文字'),!ready?h('p',{role:'status'},'正在保存当前作品检查点…'):null,error?h('p',{role:'alert'},error):null,
    h('p',null,'使用 Windows 本地文字识别组件，原笔迹保留。'),h('button',{className:'dcBtn',disabled:busy||!ready,onClick:run(recognize)},'识别当前笔迹'),
    candidate?h('label',null,'实际识别结果（可校正）',h('textarea',{className:'dcInput','aria-label':'实际识别结果（可校正）',style:{display:'block',width:'100%',boxSizing:'border-box'},disabled:busy,value:candidate.text,maxLength:40000,onChange:e=>setCandidate({...candidate,text:e.target.value})})):null,
    candidate?.engine?h('small',null,'识别来源：'+candidate.engine):null,
    h('p',null,'确认后将文字插入当前幻灯片，原笔迹保留。'),
    h('div',{style:{display:'flex',flexWrap:'wrap',gap:10,marginTop:14}},h('button',{className:'dcBtn dcPrimary',disabled:busy||!candidate&&!controller.state.deckLocalApplied,onClick:run(apply)},controller.state.deckLocalApplied?'重试保存已应用结果':'确认插入并保存'),h('button',{className:'dcBtn',disabled:!!controller.state.deckLocalApplied||!!controller.state.busy,onClick:cancel},busy?'停止并取消':'取消，保留原作品'))
   ));
 };
}
