const STORAGE = 'designcraft-chat-width:v1';

export function chatWidthLimits(total) {
  const min = Math.min(260, Math.max(180, total - 208));
  return { min, max:Math.max(min, total - 328) };
}

export function clampChatWidth(width, total) {
  const { min, max } = chatWidthLimits(total);
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(width) ? width : 324)));
}

function storedWidth() {
  try { return Number(localStorage.getItem(STORAGE)) || 324; }
  catch { return 324; }
}

export function createChatSplit(React) {
  const h = React.createElement;
  return function ChatSplit({ children, open = true }) {
    const column = React.useRef(null);
    const splitter = React.useRef(null);
    const drag = React.useRef(null);
    const frame = React.useRef(0);
    const [total,setTotal] = React.useState(innerWidth);
    const [stored,setStored] = React.useState(storedWidth);
    const [visible,setVisible] = React.useState(open);
    const [moving,setMoving] = React.useState(false);
    const width = clampChatWidth(stored,total);
    const limits = chatWidthLimits(total);

    React.useLayoutEffect(() => {
      const parent = column.current?.parentElement;
      if (!parent) return;
      const measure = () => setTotal(parent.getBoundingClientRect().width);
      const observer = new ResizeObserver(measure);
      observer.observe(parent);
      measure();
      return () => observer.disconnect();
    }, []);

    React.useLayoutEffect(() => {
      const element = column.current;
      if (!element) return;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (open) setVisible(true);
      if (reduced || !element.animate) {
        setVisible(open);
        return;
      }
      if (!open && !visible) return;
      const start = {opacity:0,transform:'translateX(-12px)'};
      const end = {opacity:1,transform:'translateX(0)'};
      const animation = element.animate(open?[start,end]:[end,start], {
        duration:open?245:150, easing:'cubic-bezier(.2,.8,.2,1)',fill:'backwards',
      });
      if (!open) animation.finished.then(() => setVisible(false), () => {});
      return () => animation.cancel();
    }, [open]);

    React.useEffect(() => () => {
      cancelAnimationFrame(frame.current);
      document.body.classList.remove('dcChatResizing');
    }, []);

    const paint = next => {
      if (!column.current) return;
      column.current.style.setProperty('--dc-chat-width',next+'px');
      splitter.current?.setAttribute('aria-valuenow',String(next));
    };
    const remember = next => {
      paint(next);
      setStored(next);
      try { localStorage.setItem(STORAGE,String(next)); } catch {}
    };
    const stop = (event, apply) => {
      if (drag.current?.id!==event.pointerId) return;
      const start = drag.current;
      drag.current = null;
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      if (apply) remember(clampChatWidth(start.width+event.clientX-start.x,total));
      else paint(width);
      setMoving(false);
      document.body.classList.remove('dcChatResizing');
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };

    return h(React.Fragment,null,
      h('div',{
        ref:column,className:'dcChatColumn',hidden:!visible,inert:!open,
        style:{width:'var(--dc-chat-width)',flexBasis:'var(--dc-chat-width)','--dc-chat-width':width+'px'},
      },children),
      h('div',{
        ref:splitter,className:'dcChatSplit',hidden:!visible,inert:!open,role:'separator',tabIndex:open?0:-1,
        'data-dragging':moving,'aria-label':'调整对话与画布宽度','aria-orientation':'vertical',
        'aria-valuemin':Math.round(limits.min),'aria-valuemax':Math.round(limits.max),'aria-valuenow':width,
        title:'拖动调整宽度，方向键微调',onPointerDown:event=>{
          if (event.button!==0 || drag.current) return;
          event.preventDefault();
          drag.current={id:event.pointerId,x:event.clientX,width};
          event.currentTarget.setPointerCapture(event.pointerId);
          setMoving(true);
          document.body.classList.add('dcChatResizing');
        },onPointerMove:event=>{
          if (drag.current?.id!==event.pointerId) return;
          drag.current.next=clampChatWidth(drag.current.width+event.clientX-drag.current.x,total);
          if (!frame.current) frame.current=requestAnimationFrame(()=>{
            frame.current=0;
            if (drag.current) paint(drag.current.next);
          });
        },onPointerUp:event=>stop(event,true),onPointerCancel:event=>stop(event,false),onLostPointerCapture:event=>stop(event,false),
        onKeyDown:event=>{
          const next=({ArrowLeft:width-16,ArrowRight:width+16,Home:limits.min,End:limits.max})[event.key];
          if (next===undefined) return;
          event.preventDefault();
          remember(clampChatWidth(next,total));
        },
      },h('span',{'aria-hidden':true})),
      moving?h('div',{className:'dcChatResizeShield','aria-hidden':true}):null);
  };
}
