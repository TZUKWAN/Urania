/** Professional editor transport. This module runs beside the real WASM App, not in DSH's UI. */
import {encodeNativeJson,decodeNativeJson,nativeCallParameters,uint64Parameter} from './native-protocol.js?v=168';
import {validateNativeContext,nativeBase,matchesNativeBase,canvasMaterialTarget,SOURCE_FORMATS} from './native-contract.js?v=168';
const options=new URLSearchParams(location.hash.slice(1));
const parentOrigin=options.get('parentOrigin'),nonce=options.get('nonce');
const engineName=options.get('engine')||'vectorcraft';
let port,disposed=false,manualUntil=0,composition=false,pointer=false,sequence=0;
let openPending=false;
let active=true,polling=false,readyRuntime=null,nativePending=false;
let deferredSave=null;
let gestureSequence=0;
const realmId=crypto.randomUUID();
let hostFileRouting=false,lastFileRequest=0;
const loadedProjectFonts=new Set();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function api(){
 if(readyRuntime)return readyRuntime;
 const until=Date.now()+60000;
 while(!disposed&&Date.now()<until){
  const native=Object.hasOwn(SOURCE_FORMATS,engineName)?window[engineName]:null;
  if(native?.requestJson){try{
   const request=async(method,payload={})=>decodeNativeJson(await native.requestJson(method,encodeNativeJson(nativeCallParameters(method,payload))));
   await request('ui.inspect');
   readyRuntime={request,inspect:()=>request('ui.inspect'),commands:()=>request('engine.commands'),openFile:(...args)=>native.openFile(...args),captureDownloads:on=>native.captureDownloads(on),addProjectFont:typeof native.addProjectFont==='function'?bytes=>native.addProjectFont(bytes):null,addDisplayFont:typeof native.addDisplayFont==='function'?bytes=>native.addDisplayFont(bytes):null};
   return readyRuntime;
  }catch{/* App is still starting. */}}
  await wait(100);
 }
 throw new Error('专业编辑器未完成启动或缺少无损 JSON 接口；没有执行操作');
}
const send=(data,transfer=[])=>{if(!disposed)port?.postMessage(data,transfer);};
async function inspectDocument(runtime){
 const document=validateNativeContext(await runtime.request('host.context',{depth:2,childLimit:50}),engineName),pending=!!document.pendingInteraction;
 if(pending!==nativePending){nativePending=pending;send({event:'manual-input',kind:'native-interaction',composition,pointer,nativePending});}
 return document;
}
function summary(document){
 let limited=false;
 const walk=(nodes,depth=0)=>{if(nodes.length>50)limited=true;return nodes.slice(0,50).map(node=>{
  const item={...node};if(node.childCount>(node.children?.length||0))limited=true;if(node.children){if(depth>=2){item.childCount=node.children.length;delete item.children;limited||=node.children.length>0;}else item.children=walk(node.children,depth+1);}return item;
 });};
 const state={...document,layers:walk(document.layers||[]),history:(document.history||[]).slice(-20),redo:(document.redo||[]).slice(-20)};
 state.summaryLimited=!!document.summaryLimited||limited||document.history?.length>20||document.redo?.length>20;return state;
}
function manual(event){
 if(event.type==='pointerdown'||event.type==='keydown')gestureSequence++;
 if(event.type==='compositionstart')composition=true;
 if(event.type==='compositionend')composition=false;
 if(event.type==='pointerdown')pointer=true;
 if(['pointerup','pointercancel','blur'].includes(event.type))pointer=false;
 // Leaving the canvas for a host toolbar is not a new edit. Keep any guard
 // already established by the preceding pointer/key event, but do not extend
 // it solely because the canvas lost focus to the user's next control.
 if(event.type!=='blur')manualUntil=Date.now()+150;
 send({event:'manual-input',kind:event.type,composition,pointer,nativePending});
}
for(const event of ['pointerdown','pointerup','pointercancel','keydown','beforeinput','compositionstart','compositionend','blur'])addEventListener(event,manual,true);

// Publish a genuine, settled canvas selection to the host's AI input overlay.
// The capability channel already authenticates the owning App/epoch.
async function selectionIntent(event){
 if(!active||disposed||openPending||event.target?.tagName!=='CANVAS')return;
 const gesture=gestureSequence,x=event.clientX,y=event.clientY,focus=!event.shiftKey;
 await wait(170);
 if(gesture!==gestureSequence||pointer||composition||!active||disposed)return;
 try{const runtime=await api(),document=await inspectDocument(runtime);if(document.pendingInteraction||gesture!==gestureSequence||pointer||!active)return;send({event:'canvas-selection',document:summary(document),anchor:{x:Number.isFinite(x)?x:innerWidth/2,y:Number.isFinite(y)?y:innerHeight/2},focus});}catch{/* Poll/error channels retain actual native failures. */}
}
addEventListener('pointerup',selectionIntent,true);
addEventListener('keydown',event=>{if(event.key==='Shift')send({event:'canvas-multi-select',active:true});},true);
addEventListener('keyup',event=>{if(event.key==='Shift'){send({event:'canvas-multi-select',active:false});selectionIntent(event);}},true);
addEventListener('pointerdown',event=>send({event:'canvas-multi-select',active:!!event.shiftKey}),true);

// Resolve a deliberate canvas double-click only after the native renderer has
// consumed both clicks. The parent rechecks selection and project provenance.
addEventListener('dblclick',async event=>{
 if(!event.isTrusted||event.button!==0||event.target?.tagName!=='CANVAS'||!active||openPending||engineName==='photocraft')return;
 const sequenceAtClick=gestureSequence,screenX=event.clientX,screenY=event.clientY;
 try{
  await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
  if(sequenceAtClick!==gestureSequence||!active||disposed||composition||pointer)return;
  const runtime=await api(),ui=await runtime.inspect();
  const rect=engineName==='deckcraft'?ui.slideRect:ui.canvasRect;
  const inRect=r=>Array.isArray(r)&&r.length===4&&screenX>=r[0]&&screenX<=r[0]+r[2]&&screenY>=r[1]&&screenY<=r[1]+r[3];
  if(!inRect(rect)||ui.dialog||ui.fileDialog||ui.backstage||inRect(ui.taskBar?.rect)||inRect(ui.freeTransformWidget?.rect))return;
  if(engineName==='vectorcraft'&&!['selection','directSelection','direct'].includes(ui.tool)||engineName==='deckcraft'&&ui.tool?.kind!=='select')return;
  const doc=await inspectDocument(runtime),nativeId=canvasMaterialTarget(doc);
  if(nativeId===null||doc.pendingInteraction||sequenceAtClick!==gestureSequence||!active)return;
  send({event:'canvas-open-material',base:nativeBase(doc),nativeId});
 }catch{/* A stale pointer gesture must not open another source. */}
},true);

async function perform(method,payload){
 if(method==='identity'){
  const prefix='/designcraft/editor/'+engineName+'-host/';
  const loaded=performance.getEntriesByType('resource').map(entry=>new URL(entry.name,location.href)).filter(url=>url.origin===location.origin&&url.pathname.startsWith(prefix)).map(url=>url.pathname.slice(prefix.length));
  const wasm=[...new Set(loaded.filter(name=>new RegExp('^'+engineName+'-web-[a-f0-9]+_bg\\.wasm$').test(name)))];
  return {realmId,active,engine:engineName,wasmFile:wasm.length===1?wasm[0]:null};
 }
 if(method==='activity'){
  if(typeof payload.active!=='boolean')throw new Error('缺少编辑器活动状态');
  active=payload.active;
  if(!active){
   const until=Date.now()+55000;
   while((sequence>1||polling)&&Date.now()<until&&!disposed&&!active)await wait(10);
   if(active)return {active:true,cancelled:true};
   if(sequence>1||polling)throw new Error('编辑操作尚未排空，不能隐藏编辑器');
  }else if(deferredSave){
   const saved=deferredSave;deferredSave=null;
   const saveAcknowledgement=await (await api()).request('host.saved',saved);
   return {active,saveAcknowledgement};
  }
  return {active};
 }
 if(!active){
  if(method==='saved'){deferredSave=payload;return {acknowledged:false,deferred:true};}
  throw new Error('编辑器已暂挂，请返回设计工作区后再操作');
 }
 const runtime=await api();
 if(method==='hello'){
  // Native export dialogs must produce a real browser download, not an in-page cache.
  runtime.captureDownloads(false);
  const protocol=await runtime.request('host.protocol');hostFileRouting=!!protocol.hostFileRouting;
  if(protocol.nativeContext!==2||!protocol.contextOrdering||!protocol.losslessJson||protocol.engine!==engineName)throw new Error('原生引擎缺少匹配的精确上下文与顺序协议，请使用同一构建的编辑器');
  return {protocol:{...protocol,activityControl:true,nativeInspection:true,projectFontSession:!!runtime.addProjectFont,deckDisplayFont:!!runtime.addDisplayFont},ui:await runtime.inspect(),realmId};
 }
 if(method==='project-font'||method==='deck-display-font'){
  const display=method==='deck-display-font';
  if(display&&engineName!=='deckcraft')throw new Error('此字体仅用于演示预览');
  const loadFont=display?runtime.addDisplayFont:runtime.addProjectFont;
  if(!loadFont)throw new Error('当前原生构建没有会话字体入口');
  if(composition||pointer||nativePending||Date.now()<manualUntil)throw new Error('正在手工编辑，项目字体尚未加载');
  if(!(payload.bytes instanceof ArrayBuffer)||payload.bytes.byteLength<4||payload.bytes.byteLength>(display?24:4)*1024*1024||!/^[a-f0-9]{64}$/.test(payload.sha256||''))throw new Error('项目字体数据无效或超过预算');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',payload.bytes)),actual=Array.from(digest,value=>value.toString(16).padStart(2,'0')).join('');
  if(actual!==payload.sha256)throw new Error('项目字体字节与来源摘要不一致');
  if(!active||disposed||composition||pointer||nativePending||Date.now()<manualUntil)throw new Error('编辑状态已改变，项目字体尚未加载');
  if(loadedProjectFonts.has(actual))return {alreadyLoaded:true};
  const faces=loadFont(new Uint8Array(payload.bytes));
  if(!Number.isSafeInteger(faces)||faces<1)throw new Error('原生引擎未确认注册字体');
  loadedProjectFonts.add(actual);return {faces};
 }
 if(method==='inspect'){const result=summary(await inspectDocument(runtime));send({event:'native-heartbeat'});return result;}
 if(method==='ui'){const result=await runtime.inspect();send({event:'native-heartbeat'});return result;}
 if(method==='docking'){const result=await runtime.request('ui.docking');send({event:'native-heartbeat'});return result;}
 if(method==='focus')return {tag:document.activeElement?.tagName,id:document.activeElement?.id,focused:document.hasFocus(),realmId};
 if(method==='presentation')return runtime.request('host.configure',payload);
 if(method==='file-receipt')return runtime.request('host.file.finish',payload);
 if(method==='saved')return runtime.request('host.saved',payload);
 if(method==='commands'){
  const commands=await runtime.commands(),query=String(payload.query||'').toLowerCase();
  const exact=commands.filter(item=>item.id===payload.query),matches=exact.length?exact:commands.filter(item=>!query||[item.id,item.label].join(' ').toLowerCase().includes(query));
  return {commands:matches.slice(0,24),total:matches.length,truncated:matches.length>24};
 }
 if(method==='node'){
  if(engineName==='photocraft'||engineName==='deckcraft')return runtime.request('host.node',{base:payload.base,id:uint64Parameter(payload.id)});
  const result=await runtime.request('host.execute',{contextProtocol:2,base:payload.base,command:'document.node',params:{id:uint64Parameter(payload.id),summary:true,depth:2,childLimit:50}});
  return result.value;
 }
 if(method==='create'){
  if(openPending)throw new Error('专业源尚在打开');openPending=true;
  try{
   if((await runtime.inspect()).activeDocument!=null)throw new Error('当前表面已有专业源');
   const width=Number(payload.width),height=Number(payload.height);
   if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1||width>16384||height>16384)throw new Error('画板尺寸无效');
   const params={...payload,name:payload.name||payload.title||'新设计',width,height};delete params.title;
   if(hostFileRouting)await runtime.request('host.create',params);
   else await runtime.execute('file.new',params);
   return {document:summary(await inspectDocument(runtime))};
  }finally{openPending=false;}
 }
 if(method==='execute'){
  if(openPending)throw new Error('专业源尚在打开，没有执行修改');
  if(composition||pointer||nativePending||Date.now()<manualUntil)throw new Error('人工正在编辑，请读取最新状态后重试');
  const result=await runtime.request('host.execute',{...payload,contextProtocol:2});if(result.document)result.document=summary(validateNativeContext(result.document,engineName));return result;
 }
 if(method==='snapshot'){
  if(openPending)throw new Error('专业源尚在打开，没有保存中间状态');
  if(composition||pointer||nativePending)throw new Error('人工编辑尚未提交，暂不保存中间状态');
  let snapshot;
  if(engineName==='vectorcraft'&&payload.format==='svg'){
   const base=nativeBase(await inspectDocument(runtime));
   if(composition||pointer||nativePending||Date.now()<manualUntil)throw new Error('人工编辑尚未结束，暂不导出 SVG');
   const result=await runtime.request('host.execute',{contextProtocol:2,base,command:'document.serialize',params:{format:'svg',svg:{decimals:7}}});
   if(composition||pointer||nativePending||Date.now()<manualUntil||result.document?.pendingInteraction||!matchesNativeBase(result.document,base,engineName))throw new Error('SVG 导出期间设计已改变，没有导出不一致的内容');
   snapshot={document:result.document,encoded:result.value,format:'svg'};
  }else snapshot=await runtime.request('host.snapshot',{...payload,contextProtocol:2});
  const encoded=snapshot.encoded;
  let data;
  if(typeof encoded.dataBase64==='string')data=Uint8Array.from(atob(encoded.dataBase64),c=>c.charCodeAt(0));
  else if(typeof encoded.text==='string')data=new TextEncoder().encode(encoded.text);
  else throw new Error('编辑器没有返回真实源字节');
  return {result:{document:summary(validateNativeContext(snapshot.document,engineName)),format:snapshot.format,warnings:encoded.warnings||[],bytes:data.buffer},transfer:[data.buffer]};
 }
 if(method==='bundle'){
  if(openPending||composition||pointer||nativePending||Date.now()<manualUntil)throw new Error('请结束当前输入后再保存素材');
  const bundle=await runtime.request('host.bundle',payload);
  if(engineName==='vectorcraft'&&bundle.format==='svg'){
   if(composition||pointer||nativePending||Date.now()<manualUntil||!matchesNativeBase(bundle.document,payload.base,engineName))throw new Error('人工编辑尚未结束，未保存 SVG 素材');
   const precise=await runtime.request('host.execute',{contextProtocol:2,base:payload.base,command:'document.serialize',params:{format:'svg',svg:{decimals:7}}});
   if(composition||pointer||nativePending||Date.now()<manualUntil||precise.document?.pendingInteraction||!matchesNativeBase(precise.document,payload.base,engineName))throw new Error('SVG 素材导出期间设计已改变，未登记不一致内容');
   bundle.derivative=precise.value;
  }
  const decode=encoded=>{
   if(typeof encoded.dataBase64==='string')return Uint8Array.from(atob(encoded.dataBase64),c=>c.charCodeAt(0));
   if(typeof encoded.text==='string')return new TextEncoder().encode(encoded.text);
   throw new Error('原生引擎没有返回实际素材字节');
  };
  const source=decode(bundle.source),derivative=decode(bundle.derivative);
  if(source.byteLength>256*1024*1024||derivative.byteLength>4*1024*1024)throw new Error('素材源超过256MiB或派生物超过4MiB预算');
  return {result:{document:summary(validateNativeContext(bundle.document,engineName)),format:bundle.format,source:source.buffer,derivative:derivative.buffer,warnings:bundle.derivative.warnings||[]},transfer:[source.buffer,derivative.buffer]};
 }
 if(method==='open'){
  if(!payload?.name||!(payload.bytes instanceof ArrayBuffer)||payload.bytes.byteLength>256*1024*1024)throw new Error('无效或过大的源文件');
  if(openPending)throw new Error('已有文件正在打开，未排入第二次打开');
  openPending=true;
  try{
  const before=await runtime.inspect();
  if(before.activeDocument!=null)throw new Error('该编辑表面已有文档，请保留当前源并在新的表面打开');
  const queued=runtime.openFile(payload.name,new Uint8Array(payload.bytes));
  if(!queued)throw new Error('文件未进入编辑器');
  const until=Date.now()+60000;
  while(Date.now()<until&&!disposed){
   const ui=await runtime.inspect();
   if(ui.openingError)throw new Error(ui.openingError);
   if(ui.activeDocument!=null){const document=await inspectDocument(runtime);
    // Native files retain their internal title, which may differ from the chosen file name.
    // A surface owns one document; a real active document after its sole queued open is completion.
    if(document.uid!=null&&ui.opening.length===0)return {document:summary(document),warnings:document.openWarnings||[]};
   }
   await wait(50);
  }
  throw new Error('文件尚未确认打开；请检查编辑器提示，没有标记成功');
  }finally{openPending=false;}
 }
 throw new Error('未支持的编辑表面操作');
}

addEventListener('message',event=>{
 if(disposed||port||!parentOrigin||!nonce||event.source!==parent||event.origin!==parentOrigin||event.data?.type!=='designcraft:connect'||event.data?.nonce!==nonce||event.ports.length!==1)return;
 port=event.ports[0];
 port.onmessage=async event=>{
  const request=event.data;
  if(!request||!Number.isSafeInteger(request.id)||typeof request.method!=='string')return;
  if(sequence>=16){send({id:request.id,ok:false,error:'编辑器请求队列已满'});return;}
  sequence++;
  try{
   const response=await perform(request.method,request.payload||{});
   if(response?.transfer)send({id:request.id,ok:true,result:response.result},response.transfer);
   else send({id:request.id,ok:true,result:response});
  }catch(error){send({id:request.id,ok:false,error:String(error.message||error)});}
  finally{sequence--;}
 };
 port.start();
});

let stamp='';
const poll=setInterval(async()=>{
 if(!port||disposed||!active||sequence||polling)return;
 polling=true;
 try{
  const runtime=await api();if(!active||disposed)return;
  const ui=await runtime.inspect();if(!active||disposed)return;
  if(hostFileRouting){
   const {request}=await runtime.request('host.file.pending');
   if(request&&request.id!==lastFileRequest){lastFileRequest=request.id;send({event:'native-file',request});}
  }
  if(ui.activeDocument==null){send({event:'native-heartbeat'});return;}
  const state=summary(await inspectDocument(runtime));
  if(!active||disposed)return;
  send({event:'native-heartbeat'});
  const next=JSON.stringify([state.uid,state.revision,state.selection,state.selectionStamp,!!state.pendingInteraction]);
  if(next!==stamp){stamp=next;send({event:'state',document:state});}
 }catch(error){if(active)send({event:'error',error:String(error.message||error)});}finally{polling=false;}
},400);
addEventListener('pagehide',()=>{disposed=true;clearInterval(poll);port?.close();});
