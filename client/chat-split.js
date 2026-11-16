const STORAGE='designcraft-chat-width:v1';
export function chatWidthLimits(total){const min=Math.min(260,Math.max(180,total-208)),max=Math.max(min,total-328);return {min,max};}
export function clampChatWidth(width,total){const {min,max}=chatWidthLimits(total);return Math.round(Math.max(min,Math.min(max,Number.isFinite(width)?width:360)));}
export function createChatSplit(React){
 const h=React.createElement;
 return function ChatSplit({children}){
  const column=React.useRef(null),drag=React.useRef(null),[total,setTotal]=React.useState(innerWidth),[width,setWidth]=React.useState(()=>{try{return Number(localStorage.getItem(STORAGE))||360;}catch{return 360;}}),[moving,setMoving]=React.useState(false);
  const value=clampChatWidth(width,total),limits=chatWidthLimits(total);
  const remember=next=>{setWidth(next);try{localStorage.setItem(STORAGE,String(next));}catch{}};
  React.useLayoutEffect(()=>{const parent=column.current?.parentElement;if(!parent)return;const update=()=>setTotal(parent.getBoundingClientRect().width),observer=new ResizeObserver(update);observer.observe(parent);update();return()=>observer.disconnect();},[]);
  React.useEffect(()=>()=>document.body.classList.remove('dcChatResizing'),[]);
  const finish=event=>{if(!drag.current||event.pointerId!==drag.current.id)return;const next=clampChatWidth(drag.current.width+event.clientX-drag.current.x,total);drag.current=null;setMoving(false);document.body.classList.remove('dcChatResizing');remember(next);if(event.currentTarget.hasPointerCapture?.(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);};
  return h(React.Fragment,null,
   h('div',{ref:column,className:'dcChatColumn',style:{width:value,flexBasis:value,'--dc-chat-width':value+'px'}},children),
   h('div',{className:'dcChatSplit',role:'separator',tabIndex:0,'aria-label':'调整对话与画布宽度','aria-orientation':'vertical','aria-valuemin':Math.round(limits.min),'aria-valuemax':Math.round(limits.max),'aria-valuenow':value,title:'拖动调整对话与画布宽度；方向键微调',onPointerDown:event=>{if(event.button!==0)return;event.preventDefault();drag.current={id:event.pointerId,x:event.clientX,width:value};event.currentTarget.setPointerCapture(event.pointerId);setMoving(true);document.body.classList.add('dcChatResizing');},onPointerMove:event=>{if(drag.current?.id===event.pointerId)setWidth(clampChatWidth(drag.current.width+event.clientX-drag.current.x,total));},onPointerUp:finish,onPointerCancel:finish,onLostPointerCapture:()=>{if(drag.current){drag.current=null;setMoving(false);document.body.classList.remove('dcChatResizing');}},onKeyDown:event=>{const next=event.key==='ArrowLeft'?value-16:event.key==='ArrowRight'?value+16:event.key==='Home'?limits.min:event.key==='End'?limits.max:null;if(next!==null){event.preventDefault();remember(clampChatWidth(next,total));}}},h('span',{'aria-hidden':true})),
   moving?h('div',{className:'dcChatResizeShield','aria-hidden':true}):null);
 };
}
