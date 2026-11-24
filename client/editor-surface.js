/** One professional editing surface; strict origin + capability channel, bounded requests. */
import {SOURCE_FORMATS} from './native-contract.js?v=169';
export class EditorSurface extends EventTarget {
 constructor(container,{origin,engine='vectorcraft',runtime='vectorcraft-host',timeout=60000}={}){
  if(!Object.hasOwn(SOURCE_FORMATS,engine)||!/^[a-z][a-z0-9-]*$/.test(runtime))throw new Error('原生引擎或运行时标识无效');
  super();this.pending=new Map();this.counter=0;this.timeout=timeout;this.disposed=false;this.active=true;
  this.engine=engine;this.sourceFormat=SOURCE_FORMATS[engine];const url=new URL('/designcraft/editor/'+runtime+'/host.html',origin);
  url.searchParams.set('webgl',''); // supported fallback; WebGPU is a separate measured capability
  const nonce=crypto.randomUUID();url.hash=new URLSearchParams({parentOrigin:location.origin,nonce,engine}).toString();
  this.frame=document.createElement('iframe');this.frame.title='设计内容编辑';this.frame.src=url.href;
  this.frame.style.cssText='border:0;width:100%;height:100%;display:block';
  this.frame.allow=engine==='deckcraft'?'clipboard-read; clipboard-write; autoplay':'clipboard-read; clipboard-write';
  this.channel=new MessageChannel();this.port=this.channel.port1;
  this.port.onmessage=event=>{
   const message=event.data;
   if(message?.event==='native-heartbeat')this.lastNativeReply=Date.now();
   if(message?.event){this.dispatchEvent(new CustomEvent(message.event,{detail:message}));return;}
   const request=this.pending.get(message?.id);if(!request)return;
   clearTimeout(request.timer);this.pending.delete(message.id);
   message.ok?request.resolve(message.result):request.reject(new Error(message.error||'专业操作失败'));
  };
  this.port.start();
  this.ready=new Promise((resolve,reject)=>{
   this.rejectReady=reject;
   const timer=this.readyTimer=setTimeout(()=>reject(new Error('编辑表面启动超时')),timeout);
   this.frame.addEventListener('load',async()=>{
    if(this.disposed)return;
    try{
     this.frame.contentWindow.postMessage({type:'designcraft:connect',nonce},url.origin,[this.channel.port2]);
     const result=await this.request('hello');
     if(result.protocol?.protocol!==1||result.protocol.nativeContext!==2||!result.protocol.contextOrdering||!result.protocol.losslessJson||result.protocol.engine!==engine||!result.protocol.guardedExecute||!result.protocol.atomicSnapshot||!result.protocol.hostFileRouting)throw new Error('编辑器缺少精确上下文顺序、安全保存或宿主文件协议，请使用匹配的原生构建');
     this.capabilities=result.protocol;this.lastNativeReply=Date.now();clearTimeout(timer);resolve(result);
    }catch(error){clearTimeout(timer);reject(error);}
   },{once:true});
  });
  container.append(this.frame);
 }
 request(method,payload={},transfer=[]){
  if(this.disposed)return Promise.reject(new Error('编辑表面已关闭'));
  if(this.pending.size>=16)return Promise.reject(new Error('编辑器请求过多，请等待当前操作'));
  const id=++this.counter;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(Object.assign(new Error('操作结果尚未确认；可能仍在执行，必须先读取当前状态再决定后续操作'),{outcomeUnknown:true}));},this.timeout);
   this.pending.set(id,{resolve,reject,timer});
   try{this.port.postMessage({id,method,payload},transfer);}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}
  });
 }
 async open(name,bytes){await this.ready;return this.request('open',{name,bytes},[bytes]);}
 async inspect(){await this.ready;return this.request('inspect');}
 async execute(base,command,params={}){await this.ready;return this.request('execute',{base,command,params});}
 async snapshot(format=this.sourceFormat){await this.ready;return this.request('snapshot',{format});}
 async bundle(base,format='svg'){await this.ready;if(!this.capabilities.atomicBundle)throw new Error('当前原生构建尚未接入素材原子快照');return this.request('bundle',{base,format});}
 async create(params){await this.ready;return this.request('create',params);}
 async addProjectFont(bytes,sha256){await this.ready;if(!this.capabilities.projectFontSession)throw new Error('当前原生构建没有项目字体入口');return this.request('project-font',{bytes,sha256},[bytes]);}
 async addDeckDisplayFont(bytes,sha256){await this.ready;return this.request('deck-display-font',{bytes,sha256},[bytes]);}
 async commands(query=''){await this.ready;return this.request('commands',{query});}
 async node(base,id){await this.ready;return this.request('node',{base,id});}
 async configurePresentation(options){await this.ready;if(!this.capabilities.hostPresentation)return {unsupported:true};return this.request('presentation',options);}
 async completeFileRequest(id,result){await this.ready;return this.request('file-receipt',{id,...result});}
 async setActivity(active){await this.ready;if(!this.capabilities.activityControl)return {unsupported:true};const result=await this.request('activity',{active});if(typeof result.active==='boolean')this.active=result.active;return result;}
 async acknowledgeSaved(document,checkpoint){await this.ready;if(!this.capabilities.saveAcknowledgement)return {acknowledged:false,unsupported:true};return this.request('saved',{uid:document.uid,revision:document.revision,checkpoint,...(document.nativeDocumentId!==undefined?{nativeDocumentId:document.nativeDocumentId}:{})});}
 dispose(){
  this.disposed=true;
  clearTimeout(this.readyTimer);this.rejectReady?.(new Error('编辑表面已关闭'));
  for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('编辑表面已关闭；已持久化检查点不受影响'));}
  this.pending.clear();this.port.close();this.frame.remove();
 }
}
