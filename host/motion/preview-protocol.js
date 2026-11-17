/** Unprivileged preview relay. Generated source never runs with the DSH origin. */
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');

function shellRuntime(config){
 const frame=document.getElementById('composition');let ready=false,disposed=false;
 const valid=data=>data&&data.protocol==='urania-motion/1'&&data.nonce===config.nonce&&data.epoch===config.epoch;
 const send=data=>{if(!disposed)parent.postMessage({...data,protocol:'urania-motion/1',nonce:config.nonce,epoch:config.epoch},config.parentOrigin);};
 function initialize(){frame.contentWindow?.postMessage({protocol:'urania-motion/1',nonce:config.nonce,epoch:config.epoch,type:'initialize',render:config.render},'*');}
 frame.addEventListener('load',()=>{ready=false;initialize();});
 addEventListener('message',event=>{
  const data=event.data;
  if(event.source===frame.contentWindow&&event.origin==='null'&&data?.source==='hf-preview'&&Number.isFinite(data.t)){
   frame.contentWindow.postMessage({protocol:'urania-motion/1',nonce:config.nonce,epoch:config.epoch,type:'clock-update',timeMs:Math.max(0,Math.min(config.durationMs,data.t))},'*');return;
  }
  if(!valid(data))return;
  if(event.source===parent&&event.origin===config.parentOrigin){
   if(data.type==='hello'){initialize();if(ready)send({type:'ready'});return;}
   if(!['play','pause','seek','selection-mode','clear-selection'].includes(data.type))return;
   if(data.type==='seek'&&(!Number.isSafeInteger(data.frame)||data.frame<0||data.frame>=config.render.durationFrames))return;
   frame.contentWindow?.postMessage(data,'*');return;
  }
  if(event.source!==frame.contentWindow||event.origin!=='null')return;
  if(data.type==='ready'){ready=true;send({type:'ready'});return;}
  if(data.type==='time'&&Number.isFinite(data.timeMs))send({type:'time',timeMs:Math.max(0,Math.min(config.durationMs,data.timeMs)),playing:data.playing===true});
  if(data.type==='selection'&&Array.isArray(data.ids)&&data.ids.length<=128&&data.ids.every(x=>typeof x==='string'&&x.length<=256)){
   const rect=data.rect;
   if(rect&&['x','y','width','height'].some(k=>!Number.isFinite(rect[k])||rect[k]<0||rect[k]>1))return;
   send({type:'selection',ids:data.ids,rect:rect||null,text:typeof data.text==='string'?data.text.slice(0,300):'',frame:Number.isSafeInteger(data.frame)?data.frame:0});
  }
  if(data.type==='error')send({type:'error',message:String(data.message||'预览失败').slice(0,500)});
 });
 addEventListener('pagehide',()=>{disposed=true;});
}

function compositionRuntime(config){
 let connected=false,lastTime=0,playing=false,selectMode=true,selected=[],resourceFailed=false;
 const send=data=>{if(connected)parent.postMessage({...data,protocol:'urania-motion/1',nonce:config.nonce,epoch:config.epoch},config.origin);};
 const pause=()=>{playing=false;window.__hfPause?.();};
 function report(){send({type:'time',timeMs:lastTime,playing});}
 addEventListener('message',event=>{
  const data=event.data;
  // Runtime clock messages are not authority; only this frame may report time.
  if(event.source===window&&data?.source==='hf-preview')return;
  if(event.source!==parent||event.origin!==config.origin||!data||data.protocol!=='urania-motion/1'||data.nonce!==config.nonce||data.epoch!==config.epoch)return;
  if(data.type==='initialize'){connected=true;ready();return;}
  if(data.type==='clock-update'&&Number.isFinite(data.timeMs)){lastTime=data.timeMs;return;}
  if(data.type==='play'){playing=true;window.__hfPlay?.();report();}
  if(data.type==='pause'){pause();report();}
  if(data.type==='seek'&&Number.isSafeInteger(data.frame)&&data.frame>=0&&data.frame<config.render.durationFrames){
   pause();lastTime=data.frame*1000*config.render.fps.den/config.render.fps.num;window.__hfSeek?.(lastTime);report();
  }
  if(data.type==='selection-mode')selectMode=data.enabled!==false;
  if(data.type==='clear-selection')selected=[];
 });
 // The trusted relay intercepts clock messages before forwarding. The source can
 // only affect its own preview; no message can write a source or submit a chat.
 let lastReport=0;
 function pulse(now){
  if(connected&&now-lastReport>90){lastReport=now;report();}
  requestAnimationFrame(pulse);
 }
 function ready(){
  if(document.readyState==='loading')return;
  Promise.resolve(document.fonts?.ready).then(()=>{
   const images=Array.from(document.images);return Promise.all(images.map(image=>image.complete?(image.naturalWidth?Promise.resolve():Promise.reject(new Error('预览图片未能解码'))):new Promise((resolve,reject)=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',()=>reject(new Error('预览图片未能加载')),{once:true});})));
  }).then(()=>{
   if(resourceFailed||Array.from(document.fonts||[]).some(font=>font.status==='error'))throw new Error('预览素材、字体或脚本未能加载');
   if(typeof window.__hfSeek!=='function')throw new Error('动画运行时尚未就绪');
   if(!window.__uraniaClockObserved){
    window.__uraniaClockObserved=true;
    for(const [name,state] of [['__hfPlay',true],['__hfPause',false],['__hfSeek',false]]){
     const original=window[name];if(typeof original!=='function')continue;
     window[name]=function(...args){playing=state;if(name==='__hfSeek'&&Number.isFinite(args[0]))lastTime=args[0];const result=original.apply(this,args);report();return result;};
    }
   }
   send({type:'ready'});
  }).catch(error=>send({type:'error',message:error.message}));
 }
 addEventListener('error',event=>{resourceFailed=true;send({type:'error',message:event.message||'资源加载失败'});},true);
 addEventListener('unhandledrejection',event=>send({type:'error',message:String(event.reason?.message||event.reason||'动画脚本失败')}));
 addEventListener('DOMContentLoaded',ready,{once:true});
 addEventListener('click',event=>{
  if(!selectMode||!(event.target instanceof Element))return;
  const target=event.target.closest('[data-hf-id]');if(!target)return;
  const id=target.getAttribute('data-hf-id');if(!id||id.length>256)return;
  event.preventDefault();event.stopImmediatePropagation();pause();
  selected=event.shiftKey?selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]:[id];
  const r=target.getBoundingClientRect();
  send({type:'selection',ids:selected,rect:{x:Math.max(0,Math.min(1,r.left/innerWidth)),y:Math.max(0,Math.min(1,r.top/innerHeight)),width:Math.max(0,Math.min(1,r.width/innerWidth)),height:Math.max(0,Math.min(1,r.height/innerHeight))},
   text:(target.textContent||'').trim().slice(0,300),frame:Math.max(0,Math.min(config.render.durationFrames-1,Math.round(lastTime*config.render.fps.num/(1000*config.render.fps.den))))});
 },true);
 // frame-runtime's existing clock report goes to this parent, so it is received
 // by the relay and authenticated there with this composition's Window identity.
 // Observe documented clock hooks only; never patch a parent Window API.
 function sample(){
  try{const state=window.__hfState?.();if(state&&Number.isFinite(state.timeMs)){lastTime=state.timeMs;playing=state.playing===true;}}
  catch{}
  requestAnimationFrame(sample);
 }
 requestAnimationFrame(sample);requestAnimationFrame(pulse);
}

export function previewShell({entry,nonce,epoch,parentOrigin,origin,render}){
 const config={nonce,epoch,parentOrigin,origin,render,durationMs:render.durationFrames*1000*render.fps.den/render.fps.num};
 const src=String(entry).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
 return '<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;width:100%;height:100%;background:#000}iframe{width:100%;height:100%;border:0}</style></head><body><iframe id="composition" title="动画画面" sandbox="allow-scripts" allow="autoplay" src="'+src+'"></iframe><script>('+shellRuntime.toString()+')('+json(config)+');</script></body></html>';
}

export function previewComposition(html,config){
 const script='<script data-urania-preview-bridge="1">('+compositionRuntime.toString()+')('+json(config)+');</script>';
 const match=/<head(?:\s[^>]*)?>/i.exec(html);
 return match?html.slice(0,match.index+match[0].length)+script+html.slice(match.index+match[0].length):script+html;
}
