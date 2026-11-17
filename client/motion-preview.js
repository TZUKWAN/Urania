/** Read-only messages between DSH and its independent, opaque-source preview. */
export function previewEventAllowed(event,frame,descriptor){
 const d=event?.data;
 return !!frame&&event.source===frame.contentWindow&&event.origin===descriptor.origin&&d?.protocol==='urania-motion/1'&&d.nonce===descriptor.nonce&&d.epoch===descriptor.epoch;
}

export class MotionPreviewBridge{
 constructor(target=globalThis.window){this.target=target;this.frame=null;this.listener=null;this.timer=null;this.ready=false;this.pending=[];}
 bind(frame,descriptor,{render,onReady=()=>{},onTime=()=>{},onSelection=()=>{},onError=()=>{},isCurrent=()=>true}={}){
  this.dispose();
  const url=new URL(descriptor.url),parent=new URL(this.target.location.href);
  if(url.origin!==descriptor.origin||url.hostname===parent.hostname||!/^127\.0\.0\.[23]$/.test(url.hostname)||!/^http:$/.test(url.protocol)||!/^\d+$/.test(url.port)||!/^[a-f0-9]{48}$/.test(descriptor.nonce||''))throw new Error('预览来源或凭据无效');
  this.frame=frame;this.descriptor=descriptor;this.render=render;this.ready=false;
  this.listener=event=>{
   if(!isCurrent()||!previewEventAllowed(event,frame,descriptor))return;
   const d=event.data;
   if(d.type==='error'){onError(String(d.message||'预览失败').slice(0,500));return;}
   if(d.type==='ready'){
    if(this.ready)return;this.ready=true;clearTimeout(this.timer);this.timer=null;onReady();
    for(const command of this.pending)this.post(command);this.pending=[];return;
   }
   if(!this.ready)return;
   if(d.type==='time'&&Number.isFinite(d.timeMs)&&d.timeMs>=0&&d.timeMs<=render.durationFrames*1000*render.fps.den/render.fps.num){
    onTime({frame:Math.max(0,Math.min(render.durationFrames-1,Math.round(d.timeMs*render.fps.num/(1000*render.fps.den)))),playing:d.playing===true});
   }
   if(d.type==='selection'&&Array.isArray(d.ids)&&d.ids.length<=128&&d.ids.every(id=>typeof id==='string'&&id.length<=256)&&Number.isSafeInteger(d.frame)&&d.frame>=0&&d.frame<render.durationFrames){
    if(d.rect&&['x','y','width','height'].some(k=>!Number.isFinite(d.rect[k])||d.rect[k]<0||d.rect[k]>1))return;
    onSelection({ids:[...new Set(d.ids)],frame:d.frame,rect:d.rect||null,text:String(d.text||'').slice(0,300)});
   }
  };
  this.target.addEventListener('message',this.listener);
  this.timer=setTimeout(()=>{if(isCurrent()&&!this.ready)onError('预览未能就绪，请检查本地素材和动画脚本');},30000);
  this.timer.unref?.();this.hello();
  return()=>{if(this.frame===frame)this.dispose();};
 }
 post(command){
  if(!this.frame||!this.descriptor)return;
  this.frame.contentWindow?.postMessage({...command,protocol:'urania-motion/1',nonce:this.descriptor.nonce,epoch:this.descriptor.epoch},this.descriptor.origin);
 }
 hello(){this.post({type:'hello'});}
 command(type,payload={}){
  if(!['play','pause','seek','selection-mode','clear-selection'].includes(type))throw new Error('未知预览命令');
  if(type==='seek'&&(!Number.isSafeInteger(payload.frame)||payload.frame<0||payload.frame>=this.render.durationFrames))throw new Error('预览帧超出范围');
  const command={type,...payload};if(this.ready)this.post(command);else{if(this.pending.length>=8)this.pending.shift();this.pending.push(command);}
 }
 dispose(){
  if(this.listener)this.target?.removeEventListener('message',this.listener);clearTimeout(this.timer);
  this.frame=null;this.descriptor=null;this.listener=null;this.timer=null;this.pending=[];this.ready=false;
 }
}
