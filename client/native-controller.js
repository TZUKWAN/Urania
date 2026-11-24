import {EditorSurface} from './editor-surface.js?v=168';
import {sameUint64,compareUint64,uint64Parameter} from './native-protocol.js?v=168';
import {EDITOR_CONTEXT_PROTOCOL,validateNativeContext,nativeBase,matchesNativeBase,selectedObjectIds,canvasMaterialTarget,sameNativeDocument} from './native-contract.js?v=168';
import {preparePreview,capturePreview,convertPreview,conversionWarnings,hasSupportedTailwindTag} from './html-sandbox.js?v=168';

const API='/designcraft/api/v2/studio';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const scopeKey=({sessionId,root})=>sessionId+'\0'+root.replace(/[\\/]+$/,'').toLowerCase();
function windowIdentity(){
 const key='designcraft-native-window';let id;
 try{if(performance.getEntriesByType('navigation')[0]?.type==='reload')id=sessionStorage.getItem(key);}catch{/* Storage may be unavailable; a new lease still fails closed. */}
 id||=crypto.randomUUID();try{sessionStorage.setItem(key,id);}catch{/* The editor still works without reload resumption. */}return id;
}
const utf8Base64=value=>{const bytes=new TextEncoder().encode(JSON.stringify(value));let text='';for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
const byteHash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
const bytesBase64=bytes=>{let text='';const value=new Uint8Array(bytes);for(let i=0;i<value.length;i+=32768)text+=String.fromCharCode(...value.subarray(i,i+32768));return btoa(text);};

// Match VectorCraft's bounded native-format sniff before passing a template to
// its extension-sensitive importer. This is not a full file validity check.
async function validateVectorTemplate(bytes){
 const input=new Uint8Array(bytes);let head;
 if(input[0]===0x1f&&input[1]===0x8b){
  if(typeof DecompressionStream!=='function')throw new Error('当前环境无法识别压缩模板');
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader(),parts=[];let count=0;
  try{
   while(count<256){const {value,done}=await reader.read();if(done)break;const part=value.subarray(0,256-count);parts.push(part);count+=part.length;}
  }catch{throw new Error('压缩模板文件头无法读取');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  head=new Uint8Array(count);let offset=0;for(const part of parts){head.set(part,offset);offset+=part.length;}
 }else head=input.subarray(0,256);
 const text=new TextDecoder().decode(head).trimStart();
 if(!text.startsWith('{')||(!text.includes('"vectorcraft"')&&!text.includes('"drawcraft"')))throw new Error('文件不是可识别的 VectorCraft 原生模板');
}

class DraftVault {
 async database(){
  if(!this.ready)this.ready=new Promise((resolve,reject)=>{const req=indexedDB.open('designcraft-native-drafts',1);req.onupgradeneeded=()=>req.result.createObjectStore('sources');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  return this.ready;
 }
 async action(mode,fn){const db=await this.database();return new Promise((resolve,reject)=>{const tx=db.transaction('sources',mode),request=fn(tx.objectStore('sources'));tx.oncomplete=()=>resolve(request?.result);tx.onabort=()=>reject(tx.error||new Error('本地草稿未写入'));tx.onerror=()=>reject(tx.error);});}
 put(key,value){return this.action('readwrite',store=>store.put(value,key));}
 get(key){return this.action('readonly',store=>store.get(key));}
 remove(key){return this.action('readwrite',store=>store.delete(key));}
 async replace(key,expectedToken,value){
  const db=await this.database();return new Promise((resolve,reject)=>{
   const tx=db.transaction('sources','readwrite'),store=tx.objectStore('sources'),read=store.get(key);let result;
   read.onsuccess=()=>{
    const current=read.result;
    if((current?.token||null)!==expectedToken){result={applied:false,current};return;}
    if(value===undefined)store.delete(key);else store.put(value,key);result={applied:true};
   };
   tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||new Error('本地草稿未写入'));tx.onerror=()=>reject(tx.error);
  });
 }
}

export function validateGeneratedSvg(svg){
 if(typeof svg!=='string'||new TextEncoder().encode(svg).length>8*1024*1024)throw new Error('SVG 为空或超过8MiB预算');
 if(/<!DOCTYPE|<!ENTITY/i.test(svg))throw new Error('SVG 不允许文档类型或外部实体');
 const document=new DOMParser().parseFromString(svg,'image/svg+xml');
 if(document.querySelector('parsererror')||document.documentElement.localName!=='svg'||document.documentElement.namespaceURI!=='http://www.w3.org/2000/svg')throw new Error('SVG XML 不完整或命名空间无效');
 let bitmap=false;
 for(const element of document.querySelectorAll('*')){
  if(['script','foreignObject','iframe','object','embed','animate','set'].includes(element.localName))throw new Error('SVG 含不支持的活动内容：'+element.localName);
  if(element.localName==='image')bitmap=true;
  for(const attribute of element.attributes){
   if(/^on/i.test(attribute.localName))throw new Error('SVG 不允许事件处理器');
   if(['href','src'].includes(attribute.localName)&&attribute.value&&!attribute.value.startsWith('#')&&!/^data:image\/(png|jpeg|webp);base64,/i.test(attribute.value))throw new Error('请先将 SVG 外部资源嵌入，未读取外部地址');
   for(const match of attribute.value.matchAll(/url\(\s*['"]?([^)'"\s]+)[^)]*\)/gi))if(!match[1].startsWith('#'))throw new Error('SVG 样式引用了外部资源');
  }
  if(element.localName==='style'){
   if(/@import|@font-face/i.test(element.textContent))throw new Error('SVG 外部样式或字体尚未打包');
   for(const match of element.textContent.matchAll(/url\(\s*['"]?([^)'"\s]+)[^)]*\)/gi))if(!match[1].startsWith('#'))throw new Error('SVG 样式引用了外部资源');
  }
 }
 return {valid:true,containsBitmap:bitmap};
}

export class NativeController {
 constructor({onChange=()=>{},getScope,focusWorkspace}={}){
  this.onChange=onChange;this.getScope=getScope;this.focusWorkspace=focusWorkspace;this.vault=new DraftVault();this.ownedDraftTokens=new Map();this.clientId=windowIdentity();this.version=0;this.busy=false;this.saving=null;
  this.state={advancedEditing:false,aiSelectionTool:'objects',phase:'idle',sources:[],document:null,sourceId:null,sourceRevision:null,error:null,dirty:false,title:null};
  this.portal=document.createElement('div');this.portal.className='dcNativeSurface';
  this.portal.style.cssText='position:fixed;left:-100000px;top:0;width:1000px;height:800px;z-index:2;overflow:hidden;background:#20242c';document.body.append(this.portal);
  this.pollTimer=setInterval(()=>this.poll().catch(error=>this.change({error:error.message})),450);
  this.themeObserver=new MutationObserver(()=>this.syncPresentation().catch(error=>this.change({error:error.message})));
  this.themeObserver.observe(document.body,{attributes:true,attributeFilter:['data-ds-dark-theme']});
 }
 change(patch){
  const changed=Object.keys(patch).some(key=>!Object.is(this.state[key],patch[key]));
  if(changed)this.state={...this.state,...patch};
  const inert=!!(this.parkingInputLock||this.scopeLocked||this.presentationChanging||this.state.pendingDraft||this.state.fileAction||this.state.hostMenuOpen||this.state.phase==='opening');
  if(this.portal&&this.portal.inert!==inert)this.portal.inert=inert;
  if(changed)this.onChange(this.state);
 }
 async api(action,payload={}){
  const response=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...(this.view?{viewId:this.view.id,token:this.view.token}:{}),...payload})});
  const data=await response.json();if(!response.ok||!data.ok)throw Object.assign(new Error(data.error||'设计服务请求失败'),{status:response.status});return data;
 }
 async activate({sessionId,root}){
  const key=scopeKey({sessionId,root});
  if(this.desiredScope?.key!==key)this.desiredScope={sessionId,root,key};
  // Even returning to the currently displayed scope must join the transition:
  // an earlier request may be suspended inside its save/close await.
  if(this.activating)return this.activating;
  this.activating=(async()=>{
   while(!this.disposing){
    const target=this.desiredScope;
    if(this.state.hostMenuOpen)await this.resumeHostMenu({allowEmergency:true});
    if(this.fileRequest&&!this.busy)await this.cancelNativeFile();
    if(this.view&&scopeKey(this.view)===target.key){this.portal.style.visibility='visible';return;}
    const until=Date.now()+80000;
    while((this.busy||this.manualBusy)&&Date.now()<until&&target===this.desiredScope)await wait(30);
    if(target!==this.desiredScope)continue;
    if(this.busy||this.manualBusy)throw new Error('请先结束旧项目的输入或等待设计动作确认，未切换或覆盖作品');
    this.scopeLocked=true;this.portal.inert=true;
    if(this.view){
     if(!this.state.pendingDraft||this.state.dirty)await this.flush();
     if(target!==this.desiredScope)continue;
     this.portal.style.visibility='hidden';await this.api('close');this.surface?.dispose();this.releaseParent();this.surface=null;this.view=null;
    }
    if(target!==this.desiredScope)continue;
    this.change({phase:'connecting',error:null,resourceNotice:null,document:null,sourceId:null,dirty:false,foreignDocument:null,pendingDraft:null,project:null,sourceNavigation:null});
    this.view=await this.api('register',{sessionId:target.sessionId,root:target.root,clientId:this.clientId,editorProtocol:EDITOR_CONTEXT_PROTOCOL});
    if(target!==this.desiredScope)continue;
    this.runtime=await this.api('runtime');
    this.change({phase:'ready',sources:[],sourceRevision:null,epoch:null,title:null});await this.refresh();
    if(target!==this.desiredScope)continue;
    const previous=this.view.sourceId||(await this.vault.get(this.workspaceKey()))?.sourceId;
    if(target!==this.desiredScope)continue;
    if(previous&&this.state.sources.some(source=>source.id===previous&&!source.error)){
     this.rememberedSource=previous;
     // A hidden off-screen WebGL App may not receive animation frames. Restore
     // its source when the design panel is visible rather than deadlocking activation.
     if(this.anchor?.isConnected)await this.load({sourceId:previous});
    }
   }
   throw new Error('设计工作区正在关闭，未开始新的项目');
  })();
  try{return await this.activating;}catch(error){if(this.view)this.portal.style.visibility='visible';this.change({phase:this.state.document?'ready':'error',error:error.message});throw error;}finally{this.activating=null;this.scopeLocked=false;this.portal.inert=!!this.state.pendingDraft;}
 }
 async refresh(){if(!this.view)return;const state=await this.api('state');this.change({sources:state.sources});return state;}
 async planAction(action,payload={}){
  const owner=this.view,epoch=owner?.epoch;if(!owner||!epoch||!['list','history','read','create','save','restore','recoverable','candidate','recover','links','link','unlink','verify-link','recover-link','brief-resolve','brief-create','brief-status','brief-list','brief-recover','migration_preview','migrate_resources'].includes(action))throw new Error('请先打开项目工作区');
  const scope=this.getScope();if(!scope||scopeKey(owner)!==scopeKey(scope))throw new Error('会话正在切换，未读取设计计划');
  const result=await this.api('plan-'+action,{epoch,...payload});
  const latest=this.getScope();if(this.view!==owner||this.view.epoch!==epoch||!latest||scopeKey(owner)!==scopeKey(latest))throw new Error(['create','save','restore','recover','link','unlink','recover-link','brief-create','brief-recover','migrate_resources'].includes(action)?'工作区已切换；计划或关联可能已保存，请回原项目核对':'工作区已切换，未显示其他项目的计划');
  return result;
 }
 async refreshProject(){if(!this.view)return;const {project}=await this.api('project');this.change({project});return project;}
 async refreshBrands(){
  const epoch=this.view?.epoch;if(!epoch)return;
  const brands=await this.api('brand-state',{epoch});
  if(this.view?.epoch===epoch)this.change({brands});
  return brands;
 }
 async htmlAction(action, payload={}, options={}){
  const owner=this.view,epoch=owner?.epoch;
  if(!owner||!epoch)throw new Error('请先打开项目工作区');
  if(options.previewToken!==undefined&&!/^[a-f0-9]{48}$/.test(options.previewToken))throw new Error('网页预览能力无效');
  const response=await fetch(API+'/html',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json',...(options.previewToken?{'x-designcraft-preview':options.previewToken}:{})},body:JSON.stringify({action,epoch,...payload})});
  const result=await response.json();
  if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'网页作品操作失败'),{status:response.status});
  if(this.view!==owner||this.view.epoch!==epoch)throw new Error('工作区已切换，原网页内容仍在原项目中');
  return result;
 }
 async htmlResource(action,payload={},{signal}={}){
  const owner=this.view,epoch=owner?.epoch;if(!epoch)throw new Error('请先打开项目工作区');
  const response=await fetch(API+'/html-resource',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action,epoch,...payload}),signal});
  const result=await response.json();
  if(this.view!==owner||this.view.epoch!==epoch)throw new Error('工作区已切换，资源原稿仍被保留');
  if(!response.ok||!result.ok){const retained=result.fontRegistered===false?'；原文件和来源记录已保留，项目字体登记未完成。':result.materialized&&result.provenanceRecorded===false?'；原件已保留'+(result.asset?.path?'：'+result.asset.path:'')+'，来源记录未建立，请先核对后重试。':action==='stitch-open-html'&&result.id&&result.revision?'；网页已保存在原项目：'+result.id+'，请核对后继续。':'';throw new Error((result.error||'网页资源操作失败')+retained);}
  if(['external-font','font-disable','font-enable','font-recover','font-quarantine'].includes(action))this.change({fontGeneration:(this.state.fontGeneration||0)+1});
  return result;
 }
 async uploadProjectFont(file,{signal}={}){
  const owner=this.view,epoch=owner?.epoch,scope=this.getScope();
  if(!owner||!epoch||!scope||scopeKey(owner)!==scopeKey(scope))throw new Error('请先打开当前项目工作区');
  if(!(file instanceof File)||!file.size||file.size>4*1024*1024||!/\.(?:ttf|otf)$/i.test(file.name))throw new Error('请选择不超过 4 MiB 的 TTF 或 OTF 字体');
  const query=new URLSearchParams({epoch,name:file.name});let response,result;
  try{response=await fetch(API+'/font-upload?'+query,{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream'},body:file,signal});result=await response.json();}
  catch(error){throw new Error((signal?.aborted?'已请求停止':'上传结果未确认')+'；字体可能已保存在原项目，请先查看项目字体列表及 design/assets 后再决定是否重试。');}
  if(this.view!==owner||this.view.epoch!==epoch)throw new Error('工作区已切换；字体可能已保存在原项目，请返回核对');
  if(!response.ok||!result.ok){const retained=result.fontRegistered===false?'；原文件和来源记录已保留，字体登记未完成。':result.materialized&&result.provenanceRecorded===false?'；原件已保留'+(result.asset?.path?'：'+result.asset.path:'')+'，来源记录未建立。':'';throw new Error((result.error||'字体导入失败')+retained);}
  this.change({fontGeneration:(this.state.fontGeneration||0)+1});return result;
 }
 async openOpenDesignResource({id,file,operationId}){
  const owner=this.view,epoch=owner?.epoch,scope=this.getScope();
  if(!owner||!epoch||!scope||scopeKey(owner)!==scopeKey(scope))throw new Error('请先打开当前项目工作区');
  this.change({resourceNotice:null,error:null});
  let received=false;
  try{
   const response=await fetch(API+'/html-resource',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action:'native-import',epoch,id,file,operationId})});
   const result=await response.json();received=true;
   if(!response.ok||!result.ok){
    const detail=result.opened?.persisted?'原生源已保存，来源关联尚需核对。':result.materialized?'资源原件已保留，导入结果请先核对。':'导入结果未确认，请先查看当前作品和资源。';
    throw new Error((result.error||'资源导入未确认')+'；'+detail);
   }
   const latest=this.getScope();if(!this.view||this.view.id!==owner.id||this.view.token!==owner.token||scopeKey(this.view)!==scopeKey(owner)||!latest||scopeKey(owner)!==scopeKey(latest))throw new Error('工作区已切换；资源可能已保存，请回原项目核对作品');
   if(this.view.sourceId!==result.opened?.sourceId)throw new Error('资源已保存，但当前作品已切换；请在项目作品中核对');
   this.change({resourceNotice:'已导入 OpenDesign 原始素材并保存来源。'});return result;
  }catch(error){
   const message=received?(error.message||'资源导入结果未确认'): '响应中断，资源可能已保存或已创建；请先核对项目作品及来源，不要直接重复导入。';
   const latest=this.getScope();if(latest&&scopeKey(owner)===scopeKey(latest))this.change({error:message});
   throw Object.assign(new Error(message),{cause:error});
  }
 }
 async htmlConverter(){
  const response=await fetch(API+'/html-converter?'+new URLSearchParams({epoch:this.view.epoch}),{headers:this.sourceHeaders(),cache:'no-store'});
  if(!response.ok)throw new Error((await response.json()).error||'网页转换模块不可用');
  const bytes=await response.arrayBuffer();
  if(await byteHash(bytes)!==response.headers.get('x-content-sha256'))throw new Error('网页转换模块完整性不匹配');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }
 async stageHtmlConversion(id,revision,bytes,jobId,previewToken){
  if(previewToken!==undefined&&!/^[a-f0-9]{48}$/.test(previewToken))throw new Error('Tailwind 预览能力无效');
  const owner=this.view,epoch=owner?.epoch,query=new URLSearchParams({epoch,id,revision,...(jobId?{jobId}:{})});
  const response=await fetch(API+'/html-conversion?'+query,{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream',...(previewToken?{'x-designcraft-preview':previewToken}:{})},body:new Blob([bytes])});
  const result=await response.json();
  if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'网页演示转换未保存'),{status:response.status});
  if(this.view!==owner||this.view.epoch!==epoch)throw new Error('工作区已切换，转换文件已保留在原网页');
  return result.conversion;
 }
 async convertHtmlJob(job){
  const root=this.view.root,key='html-source\0'+root.replace(/[\\/]+$/,'').toLowerCase()+'\0'+job.payload.id;
  if(this.pendingHtmlDrafts?.has(key))await this.pendingHtmlDrafts.get(key);
  if(await this.vault.get(key))throw new Error('网页存在尚未提交的本地草稿；请先保存或恢复草稿，未转换旧版本');
  const saved=await this.htmlAction('read',{id:job.payload.id,revision:job.payload.revision});
  if(saved.revision!==job.payload.revision)throw new Error('网页版本已变化，请重新读取');
  const source=saved.document,entry=source.files.find(file=>file.path===source.entry);
  if(!entry)throw new Error('网页入口文件缺失');
  const html=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(entry.data),char=>char.charCodeAt(0)));
  if(job.payload.tailwindCompat&&!hasSupportedTailwindTag(html))throw new Error('网页入口缺少唯一受支持的 Tailwind CDN 标签，未下载兼容脚本');
  const preview=await this.htmlAction('preview',{entry:source.entry,files:source.files.map(({path,data})=>({path,data})),...(job.payload.tailwindCompat?{tailwindCompat:true}:{})});
  if(!!preview.tailwindPath!==!!job.payload.tailwindCompat)throw new Error('Tailwind 预览资源状态不一致，未转换网页');
  const prefix=new URL('/designcraft/html-content/'+preview.token+'/',document.baseURI).href,frame=document.createElement('iframe');
  frame.setAttribute('sandbox','allow-scripts');frame.title='网页转换预览';frame.style.cssText='position:fixed;left:-20000px;top:0;width:1600px;height:900px;opacity:.001;pointer-events:none;border:0';document.body.append(frame);
  try{
   const ready=await preparePreview(frame,{html,token:preview.token,resourcePrefix:prefix,entry:source.entry,tailwindPath:preview.tailwindPath,tailwindSha256:preview.tailwindSha256});
   const rawCapture=await capturePreview(frame,ready.nonce),captured=ready.tailwindUsed?{...rawCapture,warnings:[...rawCapture.warnings,'本次使用临时 Tailwind 兼容预览；生成样式、字体和转换外观仍需核对。']}:rawCapture,converter=await this.htmlConverter();
   const converted=await convertPreview({html:captured.html,resourcePrefix:prefix,entry:source.entry,converter,converterOrigin:this.runtime.origin});
   const staged=await this.stageHtmlConversion(source.id,saved.revision,converted.bytes,job.id,ready.tailwindUsed?ready.resourceToken:undefined);
   const title=(source.title||'网页演示').replace(/[<>:"/\\|?*\0]/g,'_'),sourceId='import-'+job.id,epoch=this.view.epoch;
   const query=new URLSearchParams({id:sourceId,name:title+'.pptx'});
   const response=await fetch(API+'/input?'+query,{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream','x-designcraft-epoch':epoch,'x-designcraft-job':job.id},body:new Blob([converted.bytes])});
   const preserved=await response.json();if(!response.ok||!preserved.ok)throw new Error(preserved.error||'网页演示原件未保留');
   await this.load({sourceId,title,name:title+'.pptx',bytes:converted.bytes,engine:'deckcraft',jobId:job.id});
   const link=await this.htmlAction('link-conversion',{id:source.id,revision:saved.revision,sha256:staged.sha256,sourceId:this.view.sourceId,jobId:job.id});
   const summary={...staged.report,source:converted.summary,warnings:[...conversionWarnings(captured,converted.summary,staged.report),...(staged.compatibilityConflict?['相同转换结果已有不同来源回执，本次来源信息未覆盖原记录。']:[])]};
   this.change({htmlConversionReport:summary});return {conversion:link.conversion,report:summary,sourceId:this.view.sourceId,sourceRevision:this.view.sourceRevision};
  }finally{frame.remove();}
 }
 async freezeHtmlTailwindJob(job,beforeSave){
  const root=this.view.root,key='html-source\0'+root.replace(/[\\/]+$/,'').toLowerCase()+'\0'+job.payload.id;
  const assertNoDraft=async()=>{if(this.pendingHtmlDrafts?.has(key))await this.pendingHtmlDrafts.get(key);if(this.htmlEmergencyDrafts?.has(key)||await this.vault.get(key))throw new Error('网页存在尚未提交的本地草稿；请先保存或恢复草稿');};
  await assertNoDraft();
  const saved=await this.htmlAction('read',{id:job.payload.id,revision:job.payload.revision});
  if(saved.revision!==job.payload.revision)throw new Error('网页版本已变化，请重新读取');
  const source=saved.document,entry=source.files.find(file=>file.path===source.entry);if(!entry)throw new Error('网页入口文件缺失');
  const html=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(entry.data),char=>char.charCodeAt(0)));
  if(!hasSupportedTailwindTag(html))throw new Error('网页入口缺少唯一受支持的 Tailwind CDN 标签，未下载兼容脚本');
  const preview=await this.htmlAction('preview',{entry:source.entry,files:source.files.map(({path,data})=>({path,data})),tailwindCompat:true});
  if(!preview.tailwindPath)throw new Error('Tailwind 预览资源状态不一致，未保存样式');
  const prefix=new URL('/designcraft/html-content/'+preview.token+'/',document.baseURI).href,frame=document.createElement('iframe');
  frame.setAttribute('sandbox','allow-scripts');frame.title='网页样式预览';frame.style.cssText='position:fixed;left:-20000px;top:0;width:1600px;height:900px;opacity:.001;pointer-events:none;border:0';document.body.append(frame);
  try{
   const ready=await preparePreview(frame,{html,token:preview.token,resourcePrefix:prefix,entry:source.entry,tailwindPath:preview.tailwindPath,tailwindSha256:preview.tailwindSha256});
   const snapshot=await capturePreview(frame,ready.nonce);if(!ready.tailwindUsed||typeof snapshot.tailwindCss!=='string')throw new Error('预览没有可保存的唯一 Tailwind 样式');
   const cssSha256=await byteHash(new TextEncoder().encode(snapshot.tailwindCss));await assertNoDraft();
   beforeSave();const result=await this.htmlAction('tailwind-freeze',{id:source.id,revision:saved.revision,operationKey:job.payload.operationKey,cssSha256,css:snapshot.tailwindCss,jobId:job.id},{previewToken:ready.resourceToken});
   if(!result.found||result.id!==source.id||result.cssSha256!==cssSha256)throw new Error('静态样式保存回执不一致，请核对操作状态');
   return result;
  }finally{frame.remove();}
 }
 async savedHtmlConversion(id,revision,sha256){
  const owner=this.view,epoch=owner?.epoch,query=new URLSearchParams({epoch,id,revision,sha256});
  const response=await fetch(API+'/html-conversion?'+query,{headers:this.sourceHeaders(),cache:'no-store'});
  if(!response.ok)throw new Error((await response.json()).error||'无法读取已保存的网页演示');
  const bytes=await response.arrayBuffer();
  if(await byteHash(bytes)!==sha256||response.headers.get('x-content-sha256')!==sha256)throw new Error('已保存的演示文件完整性不一致');
  if(this.view!==owner||this.view.epoch!==epoch)throw new Error('工作区已切换，请重新打开转换结果');
  return bytes;
 }
 async htmlArchive(id,revision){
  if(!/^[a-f0-9]{64}$/.test(revision||''))throw new Error('网页导出需要准确的保存版本');
  const owner=this.view,epoch=owner?.epoch,query=new URLSearchParams({epoch,id,revision});
  const response=await fetch(API+'/html-archive?'+query,{headers:this.sourceHeaders(),cache:'no-store'});
  if(!response.ok)throw new Error((await response.json()).error||'网页打包失败');
  const bytes=await response.arrayBuffer(),head=new Uint8Array(bytes,0,Math.min(4,bytes.byteLength)),expected=response.headers.get('x-content-sha256');
  if(bytes.byteLength<22||bytes.byteLength>32*1024*1024||head.length!==4||head[0]!==0x50||head[1]!==0x4b||head[2]!==3||head[3]!==4||!/^([a-f0-9]{64})$/.test(expected||'')||await byteHash(bytes)!==expected||response.headers.get('x-source-revision')!==revision)throw new Error('网页 ZIP 为空、版本不符或字节摘要不一致，未开始下载');
  if(this.view!==owner||this.view.epoch!==epoch)throw new Error('工作区已切换，请重新导出网页');
  return new Blob([bytes],{type:'application/zip'});
 }
 async refreshVersions(){
  const owner=this.surface,epoch=this.view?.epoch;
  const response=await fetch('/designcraft/api/v1/versions',{cache:'no-store'});
  if(!response.ok)throw new Error('无法读取当前版本信息');
  const values=await response.json(),surface=owner?await owner.request('identity'):null;
  if(owner===this.surface&&epoch===this.view?.epoch)this.change({versions:{...values,surface}});
 }
 async exportProjectPackage(){
  if(this.busy||this.saving||this.activating||this.state.pendingDraft||this.projectRequest)throw new Error('请先完成当前操作并保存草稿');
  const owner=this.view,epoch=owner?.epoch;
  this.busy=true;this.change({busy:true});
  try{
   await this.flush();
   const response=await fetch(API+'/project-package?'+new URLSearchParams({epoch}),{headers:this.sourceHeaders(),cache:'no-store'});
   if(!response.ok)throw new Error((await response.json()).error||'项目打包失败');
   const bytes=await response.blob();
   const head=new Uint8Array(await bytes.slice(0,4).arrayBuffer());if(bytes.size<22||head.length!==4||head[0]!==0x50||head[1]!==0x4b||head[2]!==3||head[3]!==4)throw new Error('项目 ZIP 为空或缺少文件头，未开始下载');
   if(owner!==this.view||this.view.epoch!==epoch)throw new Error('工作区已切换，请重新选择项目');
   return new File([bytes],'DesignCraft 可编辑项目.zip',{type:'application/zip'});
  }finally{this.busy=false;this.change({busy:false});}
 }
 async projectAction(action,payload={}){
  if(!['derive','place','open_asset','return_to_design','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg','brand'].includes(action))throw new Error('未支持的素材动作');
  if(this.busy||this.manualBusy||this.projectRequest||this.activating||this.state.pendingDraft)throw new Error('请先完成当前输入、动作或草稿恢复');
  if(action==='apply_linked')payload={...payload,linkId:this.state.sourceNavigation?.linkId,instanceIds:this.state.sourceNavigation?.linkedInstanceIds};
  if(this.state.hostMenuOpen)await this.resumeHostMenu();
  this.projectRequest=true;this.change({projectPending:true});
  try{
   await this.flush();const document=this.surface&&this.state.document?await this.surface.inspect():null;
   if(document){this.acceptDocument(document);await this.report();}else if(!['open_asset','return_to_design'].includes(action))throw new Error('请先打开设计');
   const result=await this.api('project-action',{editorAction:action,operationId:crypto.randomUUID(),sourceId:this.view.sourceId,epoch:this.view.epoch,...(document?{base:nativeBase(document)}:{}),payload});
   await this.refreshProject();return result;
  }finally{this.projectRequest=false;this.change({projectPending:false});}
 }
 async contextCommand(document,command,value){
  if(this.busy||this.saving||this.activating||this.projectRequest||this.state.pendingDraft||this.state.hostMenuOpen)throw new Error('请先完成当前设计动作');
  if(!this.surface||!this.view?.sourceId)throw new Error('请先打开设计');
  const owner=this.view,base=nativeBase(document),current=await this.surface.inspect();
  if(this.view!==owner||!matchesNativeBase(current,base,owner.engine))throw new Error('对象选区已改变，请重新选择');
  this.acceptDocument(current);await this.report(current);this.projectRequest=true;this.change({projectPending:true});
  try{return await this.api('context-command',{sourceId:owner.sourceId,epoch:owner.epoch,base,command,value,operationId:crypto.randomUUID()});}
  finally{this.projectRequest=false;this.change({projectPending:false});}
 }
 async manualViewCommand(document,command,params={}){
  if(!['edit.undo','edit.redo','slide.go','select.set','layer.select','edit.select','view.fitArtboard','view.fitOnScreen','view.fit','view.zoomIn','view.zoomOut'].includes(command))throw new Error('此操作不属于画布控件');
  const owner=this.view,surface=this.surface,base=nativeBase(document);
  if(!owner?.sourceId||!surface)throw new Error('请先打开设计');
  const occupied=()=>this.busy||this.saving||this.manualBusy||this.activating||this.projectRequest||this.state.pendingDraft||this.state.hostMenuOpen||this.state.fileAction;
  const deadline=Date.now()+1200;
  while((this.manualBusy||this.saving||this.activating)&&!this.busy&&this.view===owner&&this.surface===surface&&Date.now()<deadline)await wait(24);
  if(this.view!==owner||this.surface!==surface)throw new Error('画布已经切换');
  if(occupied())throw new Error('请先完成当前设计动作');
  this.busy=true;this.change({busy:true,error:null});
  try{
   const current=await surface.inspect();
   if(this.view!==owner||this.surface!==surface||!matchesNativeBase(current,base,owner.engine))throw new Error('画布已改变，请重新选择');
   const result=await surface.execute(base,command,params);
   if(this.view!==owner||this.surface!==surface)throw new Error('画布已经切换');
   if(result.document)this.acceptDocument(result.document);
   await this.report();
   if(command==='edit.undo'||command==='edit.redo')await this.flush();
  }finally{this.busy=false;this.change({busy:false});if(this.state.dirty)this.scheduleSave();}
 }
 async variantAction(action,payload={}){
  const owner=this.view,epoch=owner?.epoch;if(!owner||!epoch)throw new Error('请先打开作品');
  const response=await fetch(API+'/variants',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action,epoch,...payload})});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'作品方案操作失败');
  if(this.view!==owner||this.view.epoch!==epoch)throw new Error('方案记录已保存，但工作区已切换');
  return result;
 }
 async reconcilePlacement(jobId){const result=await this.api('reconcile-placement',{jobId});if(this.pendingPlacement?.jobId===jobId)this.pendingPlacement=null;await this.refreshProject();return result;}
 async reconcileInstanceUpdate(jobId){const result=await this.api('reconcile-instance-update',{jobId});if(this.pendingInstanceUpdate?.jobId===jobId)this.pendingInstanceUpdate=null;await this.refreshProject();return result;}
 async reconcileSvgConversion(jobId){
  if(this.busy||this.saving||this.manualBusy||!this.view)throw new Error('请先结束当前输入或保存，再核对转换记录');
  const owner=this.view,epoch=owner.epoch,result=await this.api('reconcile-svg-conversion',{epoch,jobId}),receipt=result.conversionReceipt;
  if(this.view!==owner||this.view.epoch!==epoch)throw new Error('转换记录已核对，但设计已切换；未改变当前画布');
  let synced=false,message=result.historical?'已核对保存的 SVG 转换记录；该设计之后已有新版本，当前草稿已保留。':'已核对保存的 SVG 转换记录；当前草稿已保留。';
  if(!result.historical&&receipt?.sourceId===owner.sourceId&&this.surface&&receipt.engineState){
   const live=await this.surface.inspect();
   if(owner.sourceRevision===receipt.sourceRevision||sameUint64(live.uid,receipt.engineState.uid)&&sameUint64(live.revision,receipt.engineState.revision)){
    const snapshot=await this.surface.snapshot();
    if(sameNativeDocument(snapshot.document,live)&&sameUint64(snapshot.document.revision,live.revision)&&await byteHash(snapshot.bytes)===receipt.sourceHash){
     const ack=await this.surface.acknowledgeSaved(snapshot.document,receipt.sourceRevision);
     if(ack.acknowledged&&this.view===owner&&this.view.epoch===epoch){
      const key=this.cacheKey(),draft=await this.vault.get(key);
      if(draft?.instanceUpdate?.jobId===jobId&&draft.bytes&&await byteHash(draft.bytes)===receipt.sourceHash){const removed=await this.vault.replace(key,draft.token,undefined);if(removed.applied){this.ownedDraftTokens.delete(key);if(this.state.pendingDraft?.token===draft.token)this.change({pendingDraft:null});}}
      owner.sourceRevision=receipt.sourceRevision;this.savedEngineRevision=snapshot.document.revision;this.savedInputSequence=this.inputSequence||0;this.acceptDocument(await this.surface.inspect());await this.report();
      this.change({sourceRevision:receipt.sourceRevision,dirty:false,error:null});synced=true;message='已核对保存的 SVG 转换记录，当前设计已同步，未重复转换。';
     }
    }
   }
   if(!synced&&sameUint64(live.uid,receipt.engineState.uid)&&compareUint64(live.revision,receipt.engineState.revision)>0){
    owner.sourceRevision=receipt.sourceRevision;this.savedEngineRevision=receipt.engineState.revision;this.acceptDocument(live);await this.report();this.change({sourceRevision:receipt.sourceRevision,dirty:true,error:null});synced=true;message='已核对转换记录；之后的画布编辑已保留，等待保存。';
   }
  }
  if(synced){if(this.pendingInstanceUpdate?.jobId===jobId)this.pendingInstanceUpdate=null;this.change({svgConversionPending:null});}
  await this.refreshProject();this.change({svgConversionRecovery:{sourceId:this.view.sourceId,message}});if(synced&&this.state.dirty&&!this.state.pendingDraft)this.scheduleSave();return {...result,synced};
 }
 async deriveMaterial(job,format,title){
  const inputSequence=this.inputSequence||0,bundle=await this.surface.bundle(job.base,format);
  if(bundle.format==='svg')validateGeneratedSvg(new TextDecoder().decode(bundle.derivative));
  let preview,previewHeader;
  const sourceHash=await byteHash(bundle.source);
  if(bundle.format==='svg'){
   const paired=await this.surface.bundle(job.base,'png');
   if(paired.format!=='png'||!matchesNativeBase(bundle.document,job.base,this.surface.engine)||!matchesNativeBase(paired.document,job.base,this.surface.engine)||await byteHash(paired.source)!==sourceHash)throw new Error('SVG 与兼容预览之间源或选区发生变化，未登记不一致素材');
   preview=paired.derivative;previewHeader={bytes:preview.byteLength,sha256:await byteHash(preview)};
  }
  await this.flush(job.id,{force:true,captured:{document:bundle.document,bytes:bundle.source,inputSequence}});
  const project=await this.refreshProject(),headers={epoch:this.view.epoch,jobId:job.id,sourceRevision:this.view.sourceRevision,sourceHash,engineState:{uid:bundle.document.uid,revision:bundle.document.revision,...(bundle.document.nativeDocumentId!==undefined?{nativeDocumentId:bundle.document.nativeDocumentId}:{})},format:bundle.format,title:title||this.state.title||'设计素材',graphRevision:project.revision,...(previewHeader?{derivativeBytes:bundle.derivative.byteLength,preview:previewHeader}:{})};
  const response=await fetch(API+'/material',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream','x-designcraft-material':utf8Base64(headers)},body:new Blob(preview?[bundle.derivative,preview]:[bundle.derivative])});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'素材没有保存');return result;
 }
 async attachSourceOrigins(jobId){
  if(!this.surface.capabilities.atomicMaterialOrigins||!this.view.sourceRevision)return false;
  const plan=await this.api('source-origins',{epoch:this.view.epoch,sourceRevision:this.view.sourceRevision});if(!plan.origins.length)return false;
  const previous=await this.surface.inspect();
  this.pendingOriginAssignment={planId:plan.planId,sourceId:this.view.sourceId,epoch:this.view.epoch};
  if(this.surface.engine==='vectorcraft')await this.executeLinkedWorker(this.surface,'image.assignMaterialOrigins',{origins:plan.origins.map(row=>({id:uint64Parameter(row.id),hostMaterial:row.hostMaterial}))});
  else{
   const pages=new Map();
   for(const row of plan.origins){if(row.nativePage?.kind!=='slide')throw new Error('此旧素材所在的原生页面尚未接入来源补入');const id=row.nativePage.id;if(!pages.has(id))pages.set(id,[]);pages.get(id).push({id:Number(row.id),hostMaterial:row.hostMaterial});}
   for(const [id,origins]of pages){await this.executeLinkedWorker(this.surface,'slide.go',{id});await this.executeLinkedWorker(this.surface,'picture.assignMaterialOrigins',{origins});}
  }
  this.acceptDocument(await this.surface.inspect());await this.report();await this.restoreLinkedReturnSelection(previous);await this.flush(jobId,{opening:true,force:true});return true;
 }
 async updateLinkedSources(job){
  const main=this.surface;await main.setActivity(false);let worker,container;
  try{
   const plan=await this.api('prepare-linked-update',{epoch:this.view.epoch,jobId:job.id});
   if(plan.update.status==='succeeded')return plan.update;
   const {bytes:picture,type}=await this.materialBytes(plan.asset.id),format=plan.asset.format;
   let preview,vectorSource;
   if(format==='svg'){
    if(type!=='image/svg+xml')throw new Error('关联 SVG 原文类型无效');validateGeneratedSvg(new TextDecoder().decode(picture));
    const pair=await Promise.all([this.materialBytes(plan.asset.id,{variant:'preview'}),this.materialBytes(plan.asset.id,{variant:'source'})]);
    if(pair[0].type!=='image/png'||pair[1].type!=='application/octet-stream')throw new Error('关联 SVG 的预览或可编辑源类型无效');
    preview=pair[0].bytes;vectorSource=pair[1].bytes;
   }else if(format!=='png'||type!=='image/png')throw new Error('关联素材类型尚未接入');
   // Each source owns a fresh genuine native worker. A hosted surface cannot
   // reopen another document; the previous worker is disposed before the next.
   container=document.createElement('div');container.style.cssText='position:fixed;inset:0;width:1170px;height:900px;opacity:.001;pointer-events:none;z-index:-1';this.portal.append(container);
   let update=plan.update,index=0;
   for(const target of plan.targets){
    this.change({linkedProgress:{index:++index,total:plan.targets.length,title:target.title}});
    const query=new URLSearchParams({jobId:job.id,sourceId:target.sourceId,epoch:this.view.epoch}),response=await fetch(API+'/linked-source?'+query,{headers:this.sourceHeaders()});
    if(!response.ok)throw new Error((await response.json()).error);
    const bytes=await response.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>256*1024*1024||response.headers.get('x-source-revision')!==target.baseRevision||await byteHash(bytes)!==target.sourceHash)throw new Error('关联源的保存版本或字节不一致');
    if(!['deckcraft','vectorcraft'].includes(target.engine))throw new Error('关联源的原生引擎尚未接入');
    worker?.dispose();worker=new EditorSurface(container,{origin:this.runtime.origin,engine:target.engine,runtime:target.engine+'-host'});await worker.ready;
    await this.loadProjectFontsFor(worker,{strict:true});
    const supports=target.engine==='deckcraft'?worker.capabilities.preservePictureReplacement:worker.capabilities.preserveImageReplacement;
    if(!supports)throw new Error('后台原生编辑器未提供保留属性的图片替换');
    await worker.configurePresentation({embedded:true,fileRouting:true,brightness:'light'});
    await worker.open((target.title||'设计').replace(/[<>:"/\\|?*\0]/g,'_')+'.'+worker.sourceFormat,bytes);
    if(format==='svg'&&(!worker.capabilities.atomicMaterialOrigins||(target.engine==='vectorcraft'?!worker.capabilities.preserveSvgSourceReplacement:!worker.capabilities.preserveSvgPictureReplacement)))throw new Error('关联设计的原生编辑器尚未接入安全 SVG 回写，已保存进度可恢复');
    if(target.engine==='vectorcraft')await this.executeLinkedWorker(worker,format==='svg'?'svg.replaceSource':'image.replaceContent',format==='svg'?{sourceBase64:bytesBase64(vectorSource),ids:target.nativeIds.map(uint64Parameter),hostMaterial:{schema:1,projectId:plan.projectId,assetId:plan.asset.id}}:{dataBase64:bytesBase64(picture),ids:target.nativeIds.map(uint64Parameter),...(worker.capabilities.atomicMaterialOrigins?{hostMaterial:{schema:1,projectId:plan.projectId,assetId:plan.asset.id}}:{})});
    else for(const page of target.pages){
     await this.executeLinkedWorker(worker,'slide.go',{id:page.id});
     await this.executeLinkedWorker(worker,format==='svg'?'picture.replaceSvgContent':'picture.replaceContent',{data:bytesBase64(picture),...(format==='svg'?{previewData:bytesBase64(preview)}:{}),name:plan.asset.title+'.'+format,ids:page.ids,...(worker.capabilities.atomicMaterialOrigins?{hostMaterial:{schema:1,projectId:plan.projectId,assetId:plan.asset.id}}:{})});
     for(const id of page.ids)if(target.frames?.[id]?.bounds)await this.executeLinkedWorker(worker,'shape.setBounds',{ids:[id],...target.frames[id].bounds});
    }
    if(target.engine==='vectorcraft')for(const [id,frame] of Object.entries(target.frames||{})){
     await this.executeLinkedWorker(worker,'object.transform',{ids:[uint64Parameter(id)],matrix:frame.matrix,strokes:false,patterns:false});
    }
    const snapshot=await worker.snapshot(worker.sourceFormat),engineState={uid:snapshot.document.uid,revision:snapshot.document.revision};
    const saved=await fetch(API+'/linked-source?'+query,{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream','x-designcraft-epoch':this.view.epoch,'x-designcraft-state':utf8Base64(engineState)},body:new Blob([snapshot.bytes])});
    const result=await saved.json();if(!saved.ok||!result.ok)throw new Error(result.error||'关联源提交未确认，请从已保存进度恢复');update=result.update;
   }
   return update;
  }finally{worker?.dispose();container?.remove();this.change({linkedProgress:null});if(this.surface===main&&!main.disposed)await main.setActivity(true);}
 }
 async executeLinkedWorker(worker,command,params){
  const deadline=Date.now()+5000;
  while(true){
   const document=await worker.inspect();
   try{return await worker.execute(nativeBase(document),command,params);}
   catch(error){
    // editor-frame emits this exact refusal BEFORE host.execute. Callers use a
    // worker or a still-opening/inert return surface, with no human input.
    // Never retry an unknown or native-dispatched result.
    if(error.outcomeUnknown||error.message!=='人工正在编辑，请读取最新状态后重试'||Date.now()>=deadline)throw error;
    await wait(40);
   }
  }
 }
 async runBrandAction(job){
  const start=await this.api('brand-start',{epoch:this.view.epoch,jobId:job.id});
  const active=this.surface,activeId=this.view.sourceId,needsReturn=!!start.targets?.length||!!start.result?.committed?.[activeId];
  const returning=needsReturn?{surface:active,sourceId:activeId,sourceRevision:this.view.sourceRevision,title:this.state.title,
   inputSequence:this.inputSequence,savedInputSequence:this.savedInputSequence,document:await active.inspect()}:null;
  let result=start.result,worker,container;
  try{
   if(start.targets?.length){
    await active.setActivity(false);
    container=document.createElement('div');
    container.style.cssText='position:fixed;inset:0;width:1170px;height:900px;opacity:.001;pointer-events:none;z-index:-1';
    this.portal.append(container);
    for(const [index,target] of start.targets.entries()){
     this.change({linkedProgress:{index:index+1,total:start.targets.length,title:target.title}});
     const query=new URLSearchParams({epoch:this.view.epoch,jobId:job.id,sourceId:target.sourceId});
     const url=API+'/brand-source?'+query;
     const input=await fetch(url,{headers:this.sourceHeaders()});
     if(!input.ok)throw new Error((await input.json()).error);
     const bytes=await input.arrayBuffer();
     if(input.headers.get('x-source-revision')!==target.baseRevision||await byteHash(bytes)!==target.sourceHash)throw new Error('品牌更新源与已保存版本不一致');
     worker=new EditorSurface(container,{origin:this.runtime.origin,engine:target.engine,runtime:target.engine+'-host'});
     await worker.ready;
     await this.loadProjectFontsFor(worker,{strict:true});
     if(start.kind==='font-attach'||start.kind==='font-change'&&target.rows.some(row=>row.token)){
      if(!worker.capabilities.brandFontIdentity)throw new Error('此编辑器版本尚未接入品牌文字身份，请加载当前版本');
     }else if(start.kind!=='font-change'&&!worker.capabilities.brandColorIdentity)throw new Error('此编辑器版本尚未接入品牌色，请加载当前版本');
     await worker.configurePresentation({embedded:true,fileRouting:true,brightness:'light'});
     await worker.open('brand-edit.'+worker.sourceFormat,bytes);
     let pageId;
     for(const row of target.rows){
      if(target.engine==='deckcraft'&&pageId!==row.pageId){await this.executeLinkedWorker(worker,'slide.go',{id:row.pageId});pageId=row.pageId;}
      const id=uint64Parameter(row.nativeId);
      if(start.kind==='font-change'){
       if(target.engine==='deckcraft'){
        if(row.eastAsian&&!worker.capabilities.fontLatinEastAsian)throw new Error('演示编辑器尚未加载中西文字体更新能力；源文件未覆盖，请在更新运行时后继续');
        await this.executeLinkedWorker(worker,'selection.select',{ids:[id]});await this.executeLinkedWorker(worker,row.eastAsian?'format.fontLatinEastAsian':'format.font',{family:start.font});
       }
       else await this.executeLinkedWorker(worker,'text.setStyle',{ids:[id],font:start.font});
      }else if(start.kind==='font-attach'){
       if(target.engine==='deckcraft')await this.executeLinkedWorker(worker,'shape.assignFontOrigins',{origins:[{id,projectId:start.projectId,bindingId:row.bindingId}]});
       else{const marker={schema:1,projectId:start.projectId,bindingId:row.bindingId,instanceId:row.token};await this.executeLinkedWorker(worker,'object.setProps',{ids:[id],data:{'dsh-brand-font-v1':JSON.stringify(marker)}});}
      }else if(start.kind==='recolor'){
       const command=target.engine==='deckcraft'?'shape.fill':'appearance.setItem';
       const params=target.engine==='deckcraft'?{ids:[id],color:start.primary}:{ids:[id],index:row.fillIndex,color:start.primary};
       await this.executeLinkedWorker(worker,command,params);
      }else if(target.engine==='deckcraft'){
       await this.executeLinkedWorker(worker,'shape.assignBrandOrigins',{origins:[{id,projectId:start.projectId,bindingId:row.bindingId}]});
      }else{
       const marker={schema:1,projectId:start.projectId,bindingId:row.bindingId,instanceId:row.token};
       await this.executeLinkedWorker(worker,'object.setProps',{ids:[id],data:{'dsh-brand-color-v1':JSON.stringify(marker)}});
      }
     }
     const snapshot=await worker.snapshot(worker.sourceFormat);
     const identity={uid:snapshot.document.uid,revision:snapshot.document.revision};
     const response=await fetch(url,{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream','x-designcraft-epoch':this.view.epoch,'x-designcraft-state':utf8Base64(identity)},body:new Blob([snapshot.bytes])});
     const saved=await response.json();
     if(!response.ok||!saved.ok)throw new Error(saved.error||'品牌更新尚未确认，请从保存记录继续');
     result=saved.result;
     worker.dispose();worker=null;
    }
   }
   if(result?.committed?.[activeId]){
    const current=(await this.refresh()).sources.find(s=>s.id===activeId);
    if(current?.revision!==this.view.sourceRevision){
     if(!active.active)await active.setActivity(true);
     await this.load({sourceId:activeId,jobId:job.id,resume:returning,restoreReturnSelection:true,expectedReturnRevision:current.revision});
    }
   }
   this.change({brandNotice:result?.status==='cancelled'?(result.note||'未完成的字体更新已停止。'):result?.kind==='recolor'&&result.status==='succeeded'?'已更新品牌主色，保留 '+(result.overrides?.length||0)+' 处手动配色。':result?.kind==='font-change'&&result.status==='succeeded'?'已更新品牌字体，保留 '+(result.overrides?.length||0)+' 处未跟随的文字；字重等样式可能按目标字体适配。':result?.kind==='font-attach'&&result.status==='succeeded'?'已绑定所选文字的品牌字体。':null});
   return result;
  }finally{
   worker?.dispose();container?.remove();this.change({linkedProgress:null});
   if(container&&this.surface===active&&!active.disposed)await active.setActivity(true);
  }
 }
 async materialBytes(assetId,{signal,variant}={}){
  const epoch=this.view.epoch,query=new URLSearchParams({id:assetId,epoch,...(variant?{variant}:{})});
  const response=await fetch(API+'/material?'+query,{headers:this.sourceHeaders(),signal});if(!response.ok)throw new Error((await response.json()).error);
  const bytes=await response.arrayBuffer();if(bytes.byteLength>4*1024*1024||await byteHash(bytes)!==response.headers.get('x-material-sha256'))throw new Error('素材字节与保存版本不一致');
  if(this.view.epoch!==epoch)throw new Error('素材读取期间作品已切换');
  return {bytes,type:response.headers.get('content-type')};
 }
 releaseParent(){if(this.parentContext){this.parentContext.surface.dispose();this.parentContext=null;}this.change({sourceNavigation:null});}
 async editInstance(payload,jobId){
  if(this.parentContext)throw new Error('请先返回原设计，再编辑另一个实例');
  await this.flush();
  const result=await this.api('instance-edit',{epoch:this.view.epoch,jobId});
  const parent={surface:this.surface,sourceId:this.view.sourceId,sourceRevision:this.view.sourceRevision,title:this.state.title,inputSequence:this.inputSequence,savedInputSequence:this.savedInputSequence,editId:result.edit.id};
  this.parentContext=parent;
  try{
   const loaded=await this.load({sourceId:result.edit.sourceId,jobId,keepCurrent:true});
   const project=await this.refreshProject(),instance=project.instances.find(item=>item.id===payload.instanceId),link=project.links?.find(item=>item.id===instance?.linkId),asset=project.assets.find(item=>item.id===result.edit.assetId);
   const legacyGroup=asset?.format==='svg'&&parent.surface.engine==='vectorcraft'&&instance?.nativeObject?.kind==='group';
   const supports=asset?.format==='svg'?(parent.surface.engine==='deckcraft'&&parent.surface.capabilities?.preserveSvgPictureReplacement===true||parent.surface.engine==='vectorcraft'&&(parent.surface.capabilities?.preserveSvgSourceReplacement===true&&instance?.nativeObject?.kind==='placeddocument'||legacyGroup&&parent.surface.capabilities?.legacySvgGroupReplacement===true&&instance?.changedSincePlacement===false)):asset?.format==='png'&&(parent.surface.engine==='deckcraft'?parent.surface.capabilities?.preservePictureReplacement===true:parent.surface.engine==='vectorcraft'&&parent.surface.capabilities?.preserveImageReplacement===true);
   const applyReason=legacyGroup?(supports?'旧版 SVG 需要通过原素材、结构和画面校验才能回写。':'旧版 SVG 组暂不能安全回写；原设计和独立编辑均已保留。'):null;
   this.change({sourceNavigation:{parentTitle:parent.title,editId:result.edit.id,instanceId:payload.instanceId,format:asset?.format,linkId:link?.id,linkedInstanceIds:link?[...link.instanceIds]:[],linkedCount:link?.instanceIds.length||0,canApply:!!supports,canApplyLinked:!!supports&&(asset?.format==='png'||asset?.format==='svg'&&!legacyGroup&&!!asset.preview),applyReason}});
   return {...loaded,edit:result.edit};
  }catch(error){
   try{await this.load({sourceId:parent.sourceId,resume:parent,jobId});this.parentContext=null;this.change({sourceNavigation:null});}catch(restoreError){this.change({error:'独立源已保留，原设计恢复尚未完成：'+restoreError.message});}
   throw error;
  }
 }
 async openAssetSource(assetId,jobId){
  if(this.parentContext)throw new Error('请先返回原设计，再打开另一份来源');
  const project=await this.refreshProject(),asset=project.assets.find(asset=>asset.id===assetId);
  if(!asset)throw new Error('该素材不在当前项目');
  if(asset.sourceId===this.view.sourceId){await this.flush(jobId);return {document:this.state.document,alreadyOpen:true};}
  await this.flush();
  const parent=this.surface&&this.state.document?{surface:this.surface,sourceId:this.view.sourceId,sourceRevision:this.view.sourceRevision,title:this.state.title,inputSequence:this.inputSequence,savedInputSequence:this.savedInputSequence}:null;
  this.parentContext=parent;
  try{
   const result=await this.load({sourceId:asset.sourceId,jobId,keepCurrent:!!parent});
   this.change({sourceNavigation:parent?{parentTitle:parent.title,materialTitle:asset.title}:null});return result;
  }catch(error){
   if(parent){
    try{this.change({phase:this.state.document?'ready':'error'});await this.load({sourceId:parent.sourceId,resume:parent,jobId});this.parentContext=null;this.change({sourceNavigation:null});}
    catch(restoreError){this.change({sourceNavigation:{parentTitle:parent.title,materialTitle:asset.title},error:'来源未打开，原设计仍保留：'+restoreError.message});}
   }
   throw error;
  }
 }
 async returnToDesign(jobId,{restoreSelection=false,expectedRevision}={}){
  const parent=this.parentContext;if(!parent)throw new Error('当前没有待返回的原设计');
  const result=await this.load({sourceId:parent.sourceId,resume:parent,jobId,restoreReturnSelection:restoreSelection,expectedReturnRevision:expectedRevision});
  this.parentContext=null;this.change({sourceNavigation:null,...(!result.resumedSurface?{error:result.resumeReason==='source-updated'?'原设计在其他窗口已有新版本，已打开最新保存版。':'原编辑器已失效，已从保存版打开原设计；临时撤销历史未保留。'}:{})});return result;
 }
 attach(element){
  this.anchor=element;this.parkingVersion=(this.parkingVersion||0)+1;this.parkingInputLock=false;this.parkedCheckpoint=null;
  this.portalInFlow=typeof element.moveBefore==='function';
  if(this.portalInFlow&&this.portal.parentNode!==element)element.moveBefore(this.portal,null);
  this.detachPosition?.();
  const box=this.portal.style;
  if(this.portalInFlow){
   Object.assign(box,{position:'absolute',left:'0',top:'0',width:'100%',height:'100%'});
   this.place=null;
   this.detachPosition=null;
  }else{
   let frame=0;
   const place=()=>{if(!element.isConnected||this.anchor!==element)return;
    const rect=element.getBoundingClientRect();
    Object.assign(box,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
   };
   const schedule=()=>{if(!frame)frame=requestAnimationFrame(()=>{frame=0;place();});};
   const scroll=event=>{if(event.target===document||event.target?.contains?.(element))schedule();};
   const observer=new ResizeObserver(schedule);observer.observe(element);
   addEventListener('resize',schedule);addEventListener('scroll',scroll,true);place();
   this.place=schedule;
   this.detachPosition=()=>{cancelAnimationFrame(frame);observer.disconnect();
    removeEventListener('resize',schedule);removeEventListener('scroll',scroll,true);this.place=null;};
  }
  this.portal.inert=!!this.scopeLocked||!!this.state.pendingDraft||!!this.state.fileAction||!!this.state.hostMenuOpen||this.state.phase==='opening';
  const surface=this.surface,epoch=this.view?.epoch;
  surface?.setActivity(true).then(async()=>{if(this.surface!==surface||this.view?.epoch!==epoch)return;await this.syncPresentation();if(this.state.dirty)this.scheduleSave();}).catch(error=>{if(this.surface===surface&&this.view?.epoch===epoch)this.change({error:error.message});});
 }
 park(){
  if(this.portalInFlow){
   const rect=this.portal.getBoundingClientRect();
   // A state-preserving move keeps the cross-origin App/port alive while React
   // removes its old anchor. insertBefore/appendChild must not be used here.
   document.body.moveBefore(this.portal,null);this.portalInFlow=false;
   this.portal.style.position='fixed';this.portal.style.left=rect.left+'px';this.portal.style.top=rect.top+'px';this.portal.style.width=rect.width+'px';this.portal.style.height=rect.height+'px';
  }
  this.detachPosition?.();this.detachPosition=null;this.anchor=null;
  clearTimeout(this.saveTimer);
  const version=this.parkingVersion=(this.parkingVersion||0)+1;
  if(!this.surface){this.portal.style.left='-100000px';return;}
  const owner=this.view,epoch=owner?.epoch,surface=this.surface;
  this.parkingInputLock=true;this.change({parking:true});
  // A hidden cross-site frame can stop producing animation frames. Its pending
  // native command/snapshot must drain BEFORE moving the portal off screen.
  const task=(async()=>{
   try{
    if(this.state.hostMenuOpen)await this.resumeHostMenu();
    if(this.fileRequest&&!this.busy)await this.cancelNativeFile();
    const deadline=Date.now()+80000;
    while((this.busy||this.activating||this.manualBusy)&&Date.now()<deadline){
     if(this.anchor||this.parkingVersion!==version)return;await wait(30);
    }
    if(this.anchor||this.parkingVersion!==version||this.view!==owner||this.view?.epoch!==epoch)return;
    if(this.busy||this.activating||this.manualBusy)throw new Error('输入或设计动作尚未结束，编辑表面已保留');
    if(!this.state.pendingDraft){
     do{
      await this.flush();
      if(Date.now()>=deadline&&this.state.dirty)throw new Error('当前修改尚未确认保存，编辑表面没有被释放');
     }while(this.state.dirty&&!this.anchor&&this.parkingVersion===version);
    }
    if(this.anchor||this.parkingVersion!==version||this.surface!==surface)return;
    await surface.setActivity(false);
    if(this.anchor||this.parkingVersion!==version)return;
    if(!this.state.dirty&&!this.state.foreignDocument&&this.view?.sourceRevision){
     this.parkedCheckpoint={viewId:owner.id,epoch,uid:this.state.document?.uid,revision:this.state.document?.revision,sourceRevision:this.view.sourceRevision};
    }
    this.portal.style.left='-100000px';
   }catch(error){if(this.parkingVersion===version&&this.view===owner&&this.view?.epoch===epoch)this.change({error:'切换前保存未完成，编辑器和草稿仍保留：'+error.message});}
   finally{
    if(this.parkingVersion===version){this.parkingInputLock=false;this.change({parking:false});}
   }
  })();
  this.parking=task;task.finally(()=>{if(this.parking===task)this.parking=null;});
 }
 async loadProjectFontsFor(surface,{strict=false}={}){
  const owner=this.view,epoch=owner?.epoch;if(!owner||!epoch)throw new Error('工作区不可用，未读取项目字体');
  const snapshot=await this.htmlResource('font-snapshot');
  if(this.view!==owner||this.view.epoch!==epoch||surface.disposed)throw new Error('工作区已切换，未加载其他项目字体');
  if(!Array.isArray(snapshot.items)||snapshot.items.length>16||!Array.isArray(snapshot.skipped)||!Array.isArray(snapshot.pending))throw new Error('项目字体清单无效');
  const failed=[];let loaded=0;
  for(const item of snapshot.items){
   try{
    if(typeof item.data!=='string'||item.data.length>6*1024*1024||!/^[a-f0-9]{64}$/.test(item.sha256||'')||!Number.isSafeInteger(item.bytes)||item.bytes<4||item.bytes>4*1024*1024)throw new Error('字体数据无效');
    const raw=atob(item.data),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
    if(bytes.length!==item.bytes||await byteHash(bytes.buffer)!==item.sha256)throw new Error('字体摘要不一致');
    if(this.view!==owner||this.view.epoch!==epoch||surface.disposed)throw new Error('工作区已切换');
    await surface.addProjectFont(bytes.buffer,item.sha256);loaded++;
   }catch(error){failed.push((typeof item.file==='string'?item.file:'字体')+'：'+String(error.message||error));}
  }
  if(this.view!==owner||this.view.epoch!==epoch||surface.disposed)throw new Error('工作区已切换，未继续加载字体');
  if(snapshot.skipped.length)failed.push(snapshot.skipped.length+' 个字体超过会话加载预算');
  if(snapshot.pending.length)failed.push(snapshot.pending.length+' 个未发布字体登记需要先核对或恢复');
  if(strict&&failed.length)throw new Error('后台编辑未开始，项目字体无法完整加载：'+failed.join('；'));
  return {loaded,failed};
 }
 async loadDeckDisplayFonts(surface){
  if(surface.engine!=='deckcraft'||!surface.capabilities?.deckDisplayFont)return {faces:[],errors:[]};
  const owner=this.view,epoch=owner?.epoch,faces=[],errors=[];
  if(!epoch)return {faces,errors};
  for(const face of ['regular','bold']){
   if(this.view!==owner||surface.disposed)throw new Error('演示工作区已切换');
   const query=new URLSearchParams({epoch,face});
   const response=await fetch(API+'/deck-display-font?'+query,{headers:this.sourceHeaders()});
   if(response.status===204)continue;
   if(!response.ok)throw new Error('无法读取本机演示字体');
   const digest=response.headers.get('x-content-sha256'),size=Number(response.headers.get('content-length'));
   if(!/^[a-f0-9]{64}$/.test(digest||'')||!Number.isSafeInteger(size)||size<16||size>24*1024*1024)throw new Error('本机演示字体身份无效');
   const bytes=await response.arrayBuffer();
   if(bytes.byteLength!==size||this.view!==owner||surface.disposed)throw new Error('演示字体读取期间工作区已切换');
   try{
    const result=await surface.addDeckDisplayFont(bytes,digest);
    if(result.faces||result.alreadyLoaded)faces.push(face);
   }catch(error){errors.push(String(error.message||error));}
  }
  return {faces,errors};
 }
 async refreshProjectFonts(){
  const surface=this.surface;
  // Loading a face can change text metrics without changing the document revision.
  // Do it before opening a native source, never under a live document's caches.
  if(!surface||surface.disposed||!surface.active||this.state.document||this.busy||this.saving||this.manualBusy||this.projectRequest||this.state.pendingDraft)return {deferred:true};
  const result=await this.loadProjectFontsFor(surface);
  if(this.surface===surface&&result.failed.length)this.change({resourceNotice:'项目字体未全部加载：'+result.failed.join('；')});
  return result;
 }
 async ensureSurface(){
  if(this.surface)return this.surface;
  this.manualBusy=false;this.lastInput=0;
  const contract=this.view.engineContract||this.runtime.engines[this.view.engine||this.runtime.defaultEngine||Object.keys(this.runtime.engines)[0]];
  if(!contract||contract.contextProtocol!==EDITOR_CONTEXT_PROTOCOL)throw new Error('该原生引擎缺少已注册的精确上下文协议');
  const surface=this.surface=new EditorSurface(this.portal,{origin:this.runtime.origin,engine:contract.engine,runtime:contract.runtime});surface.ownerEpoch=this.view.epoch;
  const owned=()=>this.surface===surface&&this.view?.epoch===surface.ownerEpoch;
  this.portal.style.visibility='visible';
  surface.addEventListener('state',event=>{
   if(!owned())return;
   this.acceptDocument(event.detail.document);
   this.report(event.detail.document).catch(error=>this.change({error:error.message}));this.scheduleSave();
  });
  surface.addEventListener('manual-input',event=>{
   if(!owned())return;
   this.inputSequence=(this.inputSequence||0)+1;
   this.manualBusy=!!(event.detail.composition||event.detail.pointer||event.detail.nativePending);this.lastInput=Date.now();this.change({manualEditing:this.manualBusy});if(!this.manualBusy)this.scheduleSave();
  });
  surface.addEventListener('error',event=>{if(owned())this.change({error:event.detail.error});});
  surface.addEventListener('canvas-multi-select',event=>{if(owned())this.change({aiMultiSelecting:!!event.detail.active});});
  surface.addEventListener('canvas-selection',event=>{
   if(!owned()||this.busy||this.state.hostMenuOpen||this.state.pendingDraft||this.projectRequest)return;
   this.acceptDocument(event.detail.document);
   this.change({selectionIntent:{id:(this.state.selectionIntent?.id||0)+1,sourceId:this.view.sourceId,epoch:this.view.epoch,anchor:event.detail.anchor,focus:event.detail.focus}});
   this.report().catch(error=>this.change({error:error.message}));
  });
  surface.addEventListener('native-file',event=>{if(owned())this.receiveNativeFile(surface,surface.ownerEpoch,event.detail.request).catch(error=>{if(owned()&&!this.state.error)this.change({error:error.message});});});
  surface.addEventListener('canvas-open-material',async event=>{
   if(!owned()||this.busy||this.manualBusy||this.state.hostMenuOpen||this.parentContext||this.state.pendingDraft||this.projectRequest)return;
   const {base,nativeId}=event.detail;
   try{
    const doc=await surface.inspect();
    if(!matchesNativeBase(doc,base,surface.engine)||canvasMaterialTarget(doc)!==nativeId)return;
    const project=await this.refreshProject();
    if(!owned()||this.busy||this.manualBusy||this.parentContext||this.state.hostMenuOpen||!matchesNativeBase(await surface.inspect(),base,surface.engine))return;
    const use=project.instances.find(i=>i.sourceId===this.view.sourceId&&i.nativeId===nativeId&&i.status==='present'&&!i.nativeObject?.hidden);
    if(!use)return;
    const asset=project.assets.find(a=>a.id===use.assetId);
    if(!asset||!['png','svg'].includes(asset.format))return;
    const pending=project.edits.find(edit=>edit.instanceId===use.id&&edit.phase==='editing');
    await this.projectAction('edit_instance',{instanceId:use.id,gestureNativeId:nativeId,...(pending?{editId:pending.id}:{})});
   }catch(error){if(owned())this.change({error:error.message});}
  });
  surface.addEventListener('native-heartbeat',async()=>{
   if(!owned()||!this.state.unresponsive||this.refreshingHealth)return;
   const epoch=surface.ownerEpoch;
   this.refreshingHealth=true;
   try{
    const current=await surface.inspect();if(this.surface!==surface||this.view?.epoch!==epoch)return;
    this.acceptDocument(current);await this.report();this.change({unresponsive:false,healthWarning:null});
   }catch(error){if(this.surface===surface&&this.view?.epoch===epoch)this.change({error:error.message});}
   finally{this.refreshingHealth=false;}
  });
  await surface.ready;await this.syncPresentation();
  try{const fonts=await this.loadProjectFontsFor(surface);if(owned()&&fonts.failed.length)this.change({resourceNotice:'项目字体未全部加载：'+fonts.failed.join('；')});}
  catch(error){if(owned())this.change({resourceNotice:'项目字体未加载：'+String(error.message||error)});}
  if(surface.engine==='deckcraft'){
   let fonts={faces:[],errors:[]};
   try{fonts=await this.loadDeckDisplayFonts(surface);}catch(error){fonts.errors.push(String(error.message||error));}
   if(owned())this.change({deckDisplayFontFaces:fonts.faces,deckDisplayFontError:fonts.errors.join('；')||null});
  }
  if(!owned())throw new Error('工作区已切换，未打开旧编辑表面');return surface;
 }
 async setAdvancedEditing(advanced){
  if(typeof advanced!=='boolean')throw new Error('编辑模式无效');
  if(this.busy||this.saving||this.manualBusy||this.activating||this.projectRequest||this.state.pendingDraft||this.state.fileAction)throw new Error('请先完成当前输入或设计动作');
  if(this.state.hostMenuOpen)await this.resumeHostMenu();
  const surface=this.surface,owner=this.view;
  if(surface&&!surface.capabilities?.aiCanvasPresentation)throw new Error('当前画布版本不支持简洁模式，请更新插件后重试');
  this.projectRequest=true;this.presentationChanging=true;this.change({projectPending:true});
  try{
  if(surface){
   const brightness=document.body.hasAttribute('data-ds-dark-theme')?'mediumDark':'light';
   const result=await surface.configurePresentation({embedded:true,brightness,aiCanvas:!advanced});
   if(this.surface!==surface||this.view!==owner)throw new Error('设计已切换，请重新选择编辑模式');
   if(result?.aiCanvas!==!advanced)throw new Error('原生画布尚未切换编辑模式');
   this.change({advancedEditing:advanced,presentation:result,...(!advanced?{aiSelectionTool:'objects'}:{})});
   this.acceptDocument(await surface.inspect());await this.report();
  }
  this.change({advancedEditing:advanced,...(!advanced?{aiSelectionTool:'objects'}:{})});
  }finally{this.projectRequest=false;this.presentationChanging=false;this.change({projectPending:false});}
 }
 async setAiSelectionTool(tool){
  if(!['objects','region'].includes(tool))throw new Error('图片选择方式无效');
  if(this.state.advancedEditing||this.view?.engine!=='photocraft'||!this.surface?.capabilities?.aiCanvasPresentation)throw new Error('请先打开图片 AI 画布');
  if(this.busy||this.saving||this.manualBusy||this.activating||this.projectRequest||this.state.pendingDraft||this.state.hostMenuOpen)throw new Error('请先完成当前输入或设计动作');
  const surface=this.surface,owner=this.view;
  this.projectRequest=true;this.presentationChanging=true;this.change({projectPending:true});
  try{
  await surface.configurePresentation({embedded:true,aiCanvas:true,selectionTool:tool,brightness:document.body.hasAttribute('data-ds-dark-theme')?'mediumDark':'light'});
  if(this.surface!==surface||this.view!==owner)throw new Error('设计已切换，未更改新的画布');
  this.change({aiSelectionTool:tool});this.acceptDocument(await surface.inspect());await this.report();
  }finally{this.projectRequest=false;this.presentationChanging=false;this.change({projectPending:false});}
 }
 async syncPresentation(){
  const surface=this.surface;if(!surface)return;
  if(!surface.active||this.parkingInputLock||this.presentationChanging)return {deferred:true};
  const brightness=document.body.hasAttribute('data-ds-dark-theme')?'mediumDark':'light';
  this.portal.style.background=brightness==='light'?'#e1e5eb':'#20242c';
  const result=await surface.configurePresentation({embedded:true,brightness,...(surface.capabilities?.aiCanvasPresentation?{aiCanvas:true}:{}),...(surface.capabilities?.hostFileRouting?{fileRouting:true}:{})});
  if(this.surface===surface)this.change({presentation:result});return result;
 }
 acceptDocument(document){
  validateNativeContext(document,this.view?.engine);
  if(this.state.document&&!sameNativeDocument(this.state.document,document)){this.change({foreignDocument:document,error:'原生编辑器已打开另一份文档，原作品不会被覆盖。请返回原文档，或使用工作区打开入口。'});return;}
  if(this.state.document&&compareUint64(document.contextSequence,this.state.document.contextSequence)<0)return;
  if(this.state.document&&sameUint64(this.state.document.uid,document.uid)&&compareUint64(this.state.document.revision,document.revision)>0)return;
  this.change({document,dirty:!sameUint64(document.revision,this.savedEngineRevision),...(this.state.foreignDocument?{foreignDocument:null,error:null}:{})});
 }
 report(document=this.state.document,{loadedSourceRevision}={}){return this.api('report',{epoch:this.view.epoch,document,sequence:++this.reportSequence,...(loadedSourceRevision?{loadedSourceRevision}:{})});}
 async load({sourceId,title,params={},svg,bytes,name,jobId,engine,keepCurrent=false,resume,restoreReturnSelection=false,expectedReturnRevision}){
  let validation;if(svg!=null)validation=validateGeneratedSvg(svg);
  await this.flush();
  if(keepCurrent&&this.parentContext?.surface===this.surface){this.parentContext.sourceRevision=this.view.sourceRevision;this.parentContext.inputSequence=this.inputSequence;this.parentContext.savedInputSequence=this.savedInputSequence;this.parentContext.document=await this.surface.inspect();}
  this.parkedCheckpoint=null;this.rememberedSource=null;this.change({phase:'opening',error:null,resourceNotice:null});
  const selected=await this.api('select',{sourceId,title,jobId,engine:svg!=null?'vectorcraft':engine||params.engine,preserveNavigation:!!this.parentContext&&!keepCurrent&&!resume});
  if(keepCurrent&&this.surface){await this.surface.setActivity(false);this.surface.frame.style.display='none';}
  else if(this.surface!==resume?.surface)this.surface?.dispose();
  this.surface=null;this.view={...this.view,...selected};this.savedEngineRevision=null;this.reportSequence=0;
  this.change({sourceId,title:selected.title,sourceRevision:selected.sourceRevision,epoch:selected.epoch,document:null,dirty:false,pendingDraft:null,foreignDocument:null,unresponsive:false,healthWarning:null});
  let surface,loaded,resumedSurface=false,resumeReason=resume?(selected.sourceRevision!==resume.sourceRevision?'source-updated':'surface-unavailable'):null;
  if(resume&&selected.sourceRevision===resume.sourceRevision&&!resume.surface.disposed){
   surface=this.surface=resume.surface;surface.ownerEpoch=selected.epoch;surface.frame.style.display='block';
   this.inputSequence=resume.inputSequence;this.savedInputSequence=resume.savedInputSequence;
   try{await surface.setActivity(true);await this.syncPresentation();loaded={document:await surface.inspect()};resumedSurface=true;resumeReason=null;}
   catch{surface.dispose();this.surface=null;surface=await this.ensureSurface();}
  }else{resume?.surface.dispose();surface=await this.ensureSurface();}
  if(!loaded&&selected.exists){
   const headers=this.sourceHeaders(),query=new URLSearchParams({id:sourceId,epoch:this.view.epoch,revision:selected.sourceRevision});
   const response=await fetch(API+'/source?'+query,{headers});if(!response.ok)throw new Error((await response.json()).error);
   const reopenedName=selected.engine==='deckcraft'?(selected.title||'未命名演示').replace(/[<>:"/\\|?*\0]/g,'_'):sourceId;
   loaded=await surface.open(reopenedName+'.'+selected.engineContract.extension,await response.arrayBuffer());
  }else if(!loaded&&bytes){loaded=await surface.open(name,bytes);}
  else if(!loaded&&svg!=null){loaded=await surface.open(sourceId+'.svg',new TextEncoder().encode(svg).buffer);}
  else if(!loaded){const creation={...selected.engineContract.createDefaults,title:selected.title,...params};delete creation.engine;loaded=await surface.create(creation);}
  this.acceptDocument(loaded.document);
  if(!resumedSurface&&!this.state.advancedEditing&&['photocraft','deckcraft'].includes(selected.engine)){
   // Size the native view after the host canvas has its final measured opening bounds.
   await Promise.race([new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))),wait(120)]);
   if(this.surface===surface&&this.view?.epoch===selected.epoch){
    const fit=selected.engine==='photocraft'?'view.fitOnScreen':'view.fit';
    try{await surface.execute(nativeBase(loaded.document),fit,{});}
    catch{/* Retain the native opening view if an input or workspace change superseded the fit. */}
   }
  }
  const loadedStable=selected.exists&&sameNativeDocument(this.state.document,loaded.document)&&sameUint64(this.state.document.revision,loaded.document.revision);
  await this.report(this.state.document,{loadedSourceRevision:loadedStable?selected.sourceRevision:undefined});
  if(loadedStable){this.savedEngineRevision=loaded.document.revision;this.change({dirty:false});}
  else if(selected.exists)this.change({dirty:true,error:'打开期间编辑内容发生变化；当前修改会作为新版本保存。'});
  const cached=await this.vault.get(this.cacheKey());
  if(cached){this.change({error:'发现未提交的本地草稿，请先恢复或保留草稿再继续',pendingDraft:cached});}
  const assigned=selected.exists&&!cached?await this.attachSourceOrigins(jobId):false;
  if(!cached&&restoreReturnSelection&&!resumedSurface&&resume?.document&&selected.sourceRevision===expectedReturnRevision){
   await this.restoreLinkedReturnSelection(resume.document);
  }
  if((!selected.exists||jobId)&&!cached&&!assigned)await this.flush(jobId,{opening:true});
  this.change({phase:'ready',validation,importWarnings:loaded.warnings||[]});await this.vault.put(this.workspaceKey(),{sourceId});await this.refresh();return {validation,document:this.state.document,resumedSurface,resumeReason};
 }
 async restoreLinkedReturnSelection(previous){
  // Only called for our exact committed linked-source revision while the new
  // surface is still opening/inert. Every command uses its real fresh context.
  const ids=selectedObjectIds(previous);
  if(this.surface.engine==='deckcraft'){
   const page=previous.page?.nativePage;if(page?.kind!=='slide'||!Number.isSafeInteger(page.id))return;
   await this.executeLinkedWorker(this.surface,'slide.go',{id:page.id});
   const selected=await this.executeLinkedWorker(this.surface,'edit.select',{ids:ids.map(Number)});if(selected.document)this.acceptDocument(selected.document);
  }else if(this.surface.engine==='vectorcraft'){
   const selected=await this.executeLinkedWorker(this.surface,'select.set',{ids:ids.map(uint64Parameter)});if(selected.document)this.acceptDocument(selected.document);
  }else return;
  this.acceptDocument(await this.surface.inspect());await this.report();
  const actual=selectedObjectIds(this.state.document).map(String).sort();if(JSON.stringify(actual)!==JSON.stringify(ids.map(String).sort()))throw new Error('关联图片已保存，原选区已有变化，请重新选择');
 }
 sourceHeaders(){return {'x-designcraft-view':this.view.id,'x-designcraft-capability':this.view.token};}
 cacheKey(){return this.view.root+'\0'+this.view.sourceId;}
 workspaceKey(){return 'workspace\0'+scopeKey(this.view);}
 scheduleSave(){clearTimeout(this.saveTimer);if(this.state.pendingDraft||this.fileRequest||this.state.hostMenuOpen||this.state.phase==='opening'||this.activating||this.parkingInputLock||this.parking||!this.anchor?.isConnected)return;this.saveTimer=setTimeout(()=>{if(!this.busy&&!this.manualBusy&&!this.parking&&!this.fileRequest&&!this.state.hostMenuOpen)this.flush().catch(error=>this.change({error:error.message}));},550);}
 async flush(jobId,{opening=false,force=false,captured}={}){
  if(this.saving){
   const completed=await this.saving;
   // Concurrent readers of the same completed edit share its real checkpoint.
   // A later input or engine revision still requires a fresh native snapshot.
   if(!captured&&!force&&!jobId&&!this.manualBusy&&!this.state.dirty&&sameUint64(this.savedEngineRevision,this.state.document?.revision)&&this.savedInputSequence===(this.inputSequence||0))return completed;
   return this.flush(jobId,{opening,force,captured});
  }
  if(this.state.phase==='opening'&&!opening)throw new Error('文档尚未完成打开与草稿检查，未保存中间状态');
  if(this.state.pendingDraft)throw new Error('已有未恢复的本地草稿；请先恢复，未覆盖草稿或磁盘源');
  if(this.state.unresponsive)throw new Error('编辑器暂未响应，请等待或恢复最近已保存版本');
  const parked=this.parkedCheckpoint;
  if(!jobId&&parked&&!this.state.dirty&&parked.viewId===this.view?.id&&parked.epoch===this.view?.epoch&&sameUint64(parked.uid,this.state.document?.uid)&&sameUint64(parked.revision,this.state.document?.revision)&&parked.sourceRevision===this.view?.sourceRevision)return {revision:parked.sourceRevision};
  if(!this.surface||!this.view?.sourceId||!this.state.document)return;
  if(this.state.foreignDocument)throw new Error('编辑器当前显示另一份文档，未覆盖原作品');
  if(this.manualBusy)throw new Error('请完成当前输入或拖动后保存');
  this.saving=(async()=>{
   const latest=await this.surface.inspect();this.acceptDocument(latest);if(this.state.foreignDocument)throw new Error('编辑器文档身份改变，未保存到原作品');
   if(!force&&!jobId&&sameUint64(this.savedEngineRevision,latest.revision)){await this.report(this.state.document);return {revision:this.view.sourceRevision};}
   this.change({saving:true,error:null});
   const inputBefore=captured?captured.inputSequence:this.inputSequence||0;
   const snapshot=captured||await this.surface.snapshot(),epoch=this.view.epoch,key=this.cacheKey(),token=crypto.randomUUID();
   validateNativeContext(snapshot.document,this.view.engine);
   if(!(snapshot.bytes instanceof ArrayBuffer)||!snapshot.bytes.byteLength||snapshot.bytes.byteLength>256*1024*1024||!sameNativeDocument(latest,snapshot.document))throw new Error('捕获的源不属于当前原生文档或超过预算，未保存');
   const stableInput=inputBefore===(this.inputSequence||0)?inputBefore:null;
   const placement=this.pendingPlacement?.epoch===epoch&&this.pendingPlacement.sourceId===this.view.sourceId?this.pendingPlacement:null;
   const instanceUpdate=this.pendingInstanceUpdate?.epoch===epoch&&this.pendingInstanceUpdate.sourceId===this.view.sourceId?this.pendingInstanceUpdate:null;
   const originAssignment=this.pendingOriginAssignment?.epoch===epoch&&this.pendingOriginAssignment.sourceId===this.view.sourceId?this.pendingOriginAssignment:null;
   const imageAdoption=this.pendingImageAdoption?.epoch===epoch&&this.pendingImageAdoption.sourceId===this.view.sourceId?this.pendingImageAdoption:null;
   const draft={token,bytes:snapshot.bytes,baseRevision:this.view.sourceRevision,title:this.state.title,document:snapshot.document,at:Date.now(),...(placement?{placement}:{}),...(instanceUpdate?{instanceUpdate}:{}),...(originAssignment?{originAssignment}:{}),...(imageAdoption?{imageAdoption}:{})};
   const staged=await this.vault.replace(key,this.ownedDraftTokens.get(key)||null,draft);
   if(!staged.applied){this.change({pendingDraft:staged.current});throw new Error('发现另一份未提交的本地草稿，已保留并停止覆盖');}
   this.ownedDraftTokens.set(key,token);
   const current=this.state.document;
   await this.report(current&&sameUint64(current.uid,snapshot.document.uid)&&compareUint64(current.revision,snapshot.document.revision)>=0?current:snapshot.document);
   const identity={uid:snapshot.document.uid,revision:snapshot.document.revision,...(snapshot.document.nativeDocumentId!==undefined?{nativeDocumentId:snapshot.document.nativeDocumentId}:{})};
   const response=await fetch(API+'/source',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream','x-designcraft-epoch':epoch,'x-source-revision':this.view.sourceRevision||'','x-designcraft-state':utf8Base64(identity),...(jobId?{'x-designcraft-job':jobId}:{}),...(placement?{'x-designcraft-placement':utf8Base64(placement)}:{}),...(instanceUpdate?{'x-designcraft-instance-update':utf8Base64(instanceUpdate)}:{}),...(originAssignment?{'x-designcraft-origin-plan':originAssignment.planId}:{}),...(imageAdoption?{'x-designcraft-image-adoption':utf8Base64({planId:imageAdoption.id})}:{})},body:new Blob([snapshot.bytes])});
   const saved=await response.json();if(!response.ok||!saved.ok){
    if(saved.feedbackRejected){const quarantined={...draft,feedbackRejected:true,feedbackReason:saved.error};this.change({pendingDraft:quarantined});const retained=await this.vault.replace(key,token,quarantined);if(!retained.applied)this.change({pendingDraft:{...quarantined,feedbackPreservationError:'候选备份发生冲突，请保持窗口并核对已有草稿'}});}
    throw Object.assign(new Error(saved.error||'源文件未保存'),{status:response.status,feedbackRejected:!!saved.feedbackRejected});
   }
   if(this.view.epoch!==epoch)throw new Error('保存时专业源已切换，本地草稿已保留');
   this.view.sourceRevision=saved.revision;this.savedEngineRevision=snapshot.document.revision;this.savedInputSequence=stableInput;
   const acknowledgement=await this.surface.acknowledgeSaved(snapshot.document,saved.revision);
   if(acknowledgement.acknowledged){this.acceptDocument(await this.surface.inspect());await this.report();}
   this.change({sourceRevision:saved.revision,dirty:!sameUint64(this.state.document.revision,this.savedEngineRevision),error:null});
   await this.vault.replace(key,token,undefined);if(this.ownedDraftTokens.get(key)===token)this.ownedDraftTokens.delete(key);
   if(originAssignment)this.pendingOriginAssignment=null;
   if(imageAdoption)this.pendingImageAdoption=null;
   if(saved.originSync?.pending)this.change({error:'原生文件已保存，图片来源关系尚未确认，请在素材中重试核对。'});
   else if(saved.originSync?.changed)await this.refreshProject();
   return saved;
  })();
  try{return await this.saving;}finally{this.saving=null;this.change({saving:false});}
 }
 async run(action,payload={},job){
  if(job&&job.epoch!==this.view?.epoch)throw new Error('设计表面已切换，未执行旧指令');
  if(this.busy)throw new Error('当前设计动作尚未结束');this.busy=true;this.change({busy:true,error:null});let applied=false;
  try{
   let result,conversionSummary;
   if(this.state.unresponsive)throw new Error('编辑器暂未响应，未执行修改；请等待或恢复最近已保存版本');
   if(this.state.pendingDraft&&!['commands','inspect_node','recover_feedback'].includes(action))throw new Error('请先恢复待处理草稿，未执行修改或覆盖源');
   if(job){
    if(!this.runtime.operationAdmission)throw new Error('后端缺少执行前停止检查，请保存后重新加载设计插件');
    await this.api('begin',{jobId:job.id,epoch:job.epoch});
   }
   if(action==='recover_feedback'){
    if(!job||!this.state.pendingDraft?.feedbackRejected||payload.recoverySourceId!==this.state.sourceId)throw new Error('当前没有匹配的已隔离意见候选');
    await this.recoverDraft({independent:true,independentSourceId:payload.recoveryCandidateId,internal:true,jobId:job.id});applied=true;
    const candidateId=this.state.sourceId;await this.load({sourceId:payload.recoverySourceId,jobId:job.id});result={recoveredCandidateId:candidateId,returnedToOriginal:true};
   }
   else if(action==='html_convert'){if(!job)throw new Error('网页转换需要当前对话动作许可');applied=true;result=await this.convertHtmlJob(job);}
   else if(action==='html_freeze_tailwind'){if(!job)throw new Error('静态样式保存需要当前对话动作许可');result=await this.freezeHtmlTailwindJob(job,()=>{applied=true;});}
   else if(action==='resource_image'){
    if(!job)throw new Error('资源图片导入需要当前对话动作许可');
    if(this.parentContext)throw new Error('请先返回原设计，再打开独立资源图片；原件已保留');
    const query=new URLSearchParams({root:this.view.root,name:payload.assetName,download:'1'}),response=await fetch('/designcraft/api/v1/asset?'+query,{cache:'no-store'});
    if(!response.ok)throw new Error('固定资源图片读取失败，原件已保留');
    const bytes=await response.arrayBuffer();if(await byteHash(bytes)!==payload.sourceHash)throw new Error('资源图片摘要不一致，未导入');
    applied=true;result=await this.load({sourceId:'import-'+job.id,title:payload.title,name:payload.assetName,bytes,engine:'photocraft',jobId:job.id});
   }
   else if(action==='resource_deck'){
    if(!job)throw new Error('外部演示导入需要当前对话动作许可');
    if(this.parentContext)throw new Error('请先返回原设计，再打开独立演示；原件已保留');
    const query=new URLSearchParams({epoch:job.epoch,id:payload.resourceReceiptId}),response=await fetch(API+'/html-external-file?'+query,{headers:this.sourceHeaders(),cache:'no-store'});
    if(!response.ok)throw new Error('外部演示原件读取失败，原件已保留');
    const declared=Number(response.headers.get('content-length'));if(!Number.isSafeInteger(declared)||declared<1||declared>16*1024*1024||response.headers.get('x-source-id')!==payload.resourceReceiptId||response.headers.get('x-content-sha256')!==payload.sourceHash)throw new Error('外部演示原件回执无效，未导入');
    const bytes=await response.arrayBuffer();if(bytes.byteLength!==declared||await byteHash(bytes)!==payload.sourceHash||this.view.epoch!==job.epoch)throw new Error('外部演示字节或工作区身份已变化，未导入');
    applied=true;result=await this.load({sourceId:'import-'+job.id,title:payload.title,name:payload.assetName,bytes,engine:'deckcraft',jobId:job.id});
   }
   else if(action==='image_adopt'){
    if(!job)throw new Error('图片候选采用需要当前对话动作许可');applied=true;
    const epoch=this.view.epoch,list=await fetch(API+'/image',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action:'list',epoch})}),data=await list.json();
    if(!list.ok||!data.ok)throw new Error(data.error||'图片候选读取失败');
    const imageJob=data.jobs.find(item=>item.id===payload.id),candidate=imageJob?.candidates.find(item=>item.id===payload.candidateId);
    if(!candidate)throw new Error('图片候选不存在或尚未返回');
    const query=new URLSearchParams({epoch,id:imageJob.id,candidateId:candidate.id,variant:'source'}),response=await fetch(API+'/image-file?'+query,{headers:this.sourceHeaders()});
    if(!response.ok)throw new Error((await response.json()).error||'图片候选源读取失败');
    const bytes=await response.arrayBuffer();if(await byteHash(bytes)!==candidate.sourceHash||response.headers.get('x-content-sha256')!==candidate.sourceHash)throw new Error('图片候选源摘要不一致');
    result=await this.adoptImageCandidate({bytes,job:imageJob,candidate,operationJobId:job.id,internal:true});
   }
   else if(action==='image_undo'){if(!job)throw new Error('图片候选撤销需要当前对话动作许可');applied=true;result=await this.undoImageCandidate({operationJobId:job.id,internal:true});}
   else if(action==='open'&&this.parentContext?.sourceId===(job?.sourceId||payload.sourceId))result=await this.returnToDesign(job?.id);
   else if(['new','create_svg','open'].includes(action))result=await this.load({sourceId:action==='open'?(job?.sourceId||payload.sourceId):'work-'+crypto.randomUUID(),title:payload.title,params:payload,svg:action==='create_svg'?payload.svg:undefined,jobId:job?.id});
   else if(action==='open_asset')result=await this.openAssetSource(payload.assetId,job?.id);
   else if(action==='edit_instance')result=await this.editInstance(payload,job?.id);
   else if(action==='return_to_design')result=await this.returnToDesign(job?.id);
   else if(action==='commands'){const surface=await this.ensureSurface();result=await surface.commands(payload.query);}
   else if(action==='inspect_node')result=await this.surface.node(nativeBase(this.state.document),payload.id);
   else if(['execute','undo'].includes(action)){
    result=await this.surface.execute(job.base,payload.command,payload.params||{});applied=true;
    if(result.document)this.acceptDocument(result.document);await this.flush(job.id);
   }else if(action==='brand'){
    if(!job)throw new Error('品牌操作需要当前工作区许可');
    result=await this.runBrandAction(job);
   }else if(action==='convert_svg'){
    if(!job||this.view.engine!=='deckcraft'||!this.surface.capabilities.convertSimpleSvgToShapes)throw new Error('当前演示编辑器尚未接入 SVG 可编辑对象转换');
    const plan=await this.api('prepare-svg-conversion',{epoch:this.view.epoch,jobId:job.id}),id=Number(plan.instance.nativeId);
    const inspection=await this.surface.execute(job.base,'picture.inspectSvgConversion',{ids:[id]});
    if(!inspection.value?.conversionAvailable)throw new Error('此 SVG 的内容或图片属性超出当前转换范围，原 SVG 已保留。'+(inspection.value?.reason||''));
    if(!matchesNativeBase(inspection.document,job.base,'deckcraft'))throw new Error('检查期间演示内容或选区已改变，没有执行转换');
    this.pendingInstanceUpdate={jobId:job.id,sourceId:this.view.sourceId,epoch:this.view.epoch,conversion:true};this.change({svgConversionPending:{jobId:job.id,sourceId:this.view.sourceId}});
    const converted=await this.surface.execute(nativeBase(inspection.document),'picture.convertSvgToShapes',{ids:[id]});applied=true;
    const recorded=await this.api('record-svg-conversion',{epoch:this.view.epoch,jobId:job.id,result:converted.value});
    if(converted.document)this.acceptDocument(converted.document);await this.flush(job.id);
    const {nativeShapes,...summary}=converted.value;result={...converted,value:summary};
    conversionSummary={sourceId:this.view.sourceId,sourceRevision:this.view.sourceRevision,shapeCount:recorded.shapeCount,textCount:recorded.textCount};
   }else if(action==='derive'){
    if(!job)throw new Error('素材保存必须经过当前工作区动作许可');
    result=await this.deriveMaterial(job,payload.format||(this.view.engine==='photocraft'?'png':'svg'),payload.title);
   }else if(action==='apply_instance'){
    if(!job||!this.parentContext||!this.state.sourceNavigation?.canApply)throw new Error('当前原编辑器未接入保留布局的图片回写');
    const format=this.state.sourceNavigation.format||'png',material=await this.deriveMaterial(job,format,this.state.title);
    await this.returnToDesign(job.id);
    const engine=this.surface.engine,supports=format==='svg'?(engine==='deckcraft'&&this.surface.capabilities.preserveSvgPictureReplacement||engine==='vectorcraft'&&this.surface.capabilities.preserveSvgSourceReplacement):engine==='deckcraft'?this.surface.capabilities.preservePictureReplacement:engine==='vectorcraft'&&this.surface.capabilities.preserveImageReplacement;
    if(!supports)throw new Error('原编辑器没有保留图片属性的回写能力，编辑源已保存');
    const document=await this.surface.inspect();this.acceptDocument(document);await this.report();
    const plan=await this.api('prepare-instance-apply',{epoch:this.view.epoch,jobId:job.id});
    const embeddedSvg=format==='svg'&&engine==='vectorcraft',{bytes}=await this.materialBytes(material.asset.id,embeddedSvg?{variant:'source'}:{});
    this.pendingInstanceUpdate={jobId:job.id,sourceId:this.view.sourceId,epoch:this.view.epoch};
    const command=embeddedSvg?(plan.legacyGroup?'svg.replaceLegacyGroup':'svg.replaceSource'):format==='svg'?'picture.replaceSvgContent':engine==='deckcraft'?'picture.replaceContent':'image.replaceContent';
    const params=embeddedSvg?(plan.legacyGroup?{sourceBase64:bytesBase64(bytes),id:uint64Parameter(plan.instance.nativeId)}:{sourceBase64:bytesBase64(bytes),ids:[uint64Parameter(plan.instance.nativeId)]}):engine==='deckcraft'?{data:bytesBase64(bytes),name:material.asset.title+'.'+format,ids:[Number(plan.instance.nativeId)]}:{dataBase64:bytesBase64(bytes),ids:[uint64Parameter(plan.instance.nativeId)]};
    if(plan.legacyGroup){const [svg,original]=await Promise.all([this.materialBytes(plan.instance.assetId),this.materialBytes(plan.instance.assetId,{variant:'source'})]);if(svg.type!=='image/svg+xml'||original.type!=='application/octet-stream')throw new Error('旧 SVG 原素材或可编辑源类型无效');validateGeneratedSvg(new TextDecoder().decode(svg.bytes));params.originalSvgBase64=bytesBase64(svg.bytes);params.originalSourceBase64=bytesBase64(original.bytes);}
    if(format==='svg'&&engine==='deckcraft'){const preview=await this.materialBytes(material.asset.id,{variant:'preview'});if(preview.type!=='image/png')throw new Error('SVG 兼容预览类型无效');params.previewData=bytesBase64(preview.bytes);}
    if(this.surface.capabilities.atomicMaterialOrigins)params.hostMaterial={schema:1,projectId:(await this.refreshProject()).id,assetId:material.asset.id};
    result=await this.surface.execute(nativeBase(document),command,params);applied=true;
    if(plan.legacyGroup)await this.api('record-legacy-native-kind',{epoch:this.view.epoch,jobId:job.id,nativeKind:result.value?.nativeKind});
    if(result.document)this.acceptDocument(result.document);await this.flush(job.id);
   }else if(['link_instances','unlink_instance'].includes(action)){
    result=await this.api('instance-links',{epoch:this.view.epoch,jobId:job.id});
   }else if(['apply_linked','resume_linked'].includes(action)){
    if(!job)throw new Error('关联更新需要工作区动作许可');
    if(action==='apply_linked'&&(!this.state.sourceNavigation?.canApply||this.state.sourceNavigation?.canApplyLinked===false))throw new Error('当前来源的关联回写尚未接入，独立源已保留');
    if(action==='apply_linked')await this.deriveMaterial(job,this.state.sourceNavigation?.format==='svg'?'svg':'png',this.state.title);
    const returning=this.parentContext?null:{surface:this.surface,sourceId:this.view.sourceId,sourceRevision:this.view.sourceRevision,title:this.state.title,inputSequence:this.inputSequence,savedInputSequence:this.savedInputSequence,document:await this.surface.inspect()};
    result=await this.updateLinkedSources(job);applied=true;
    if(this.parentContext)await this.returnToDesign(job.id,{restoreSelection:true,expectedRevision:result.committed[this.parentContext.sourceId]});
    else if(result.sources?.[this.view.sourceId])await this.load({sourceId:this.view.sourceId,jobId:job.id,resume:returning,restoreReturnSelection:true,expectedReturnRevision:result.committed[this.view.sourceId]});
    this.change({error:null});
   }else if(action==='place'){
    if(!job)throw new Error('素材放入必须经过当前工作区动作许可');
    const {bytes,type}=await this.materialBytes(payload.assetId);
    const format=type==='image/svg+xml'?'svg':type==='image/png'?'png':null;
    if(!format)throw new Error('素材格式不支持');if(format==='svg')validateGeneratedSvg(new TextDecoder().decode(bytes));
    const hostMaterial=(format==='png'||format==='svg'&&(this.view.engine==='deckcraft'||this.surface.capabilities.embeddedSvgSource))&&this.surface.capabilities.atomicMaterialOrigins?{schema:1,projectId:(await this.refreshProject()).id,assetId:payload.assetId}:null;
    if(this.view.engine==='deckcraft'){
     if(format==='svg'&&!this.surface.capabilities.preparedSvgPictures)throw new Error('当前演示构建尚未接入保留 SVG 原文的图片');
     const preview=format==='svg'?await this.materialBytes(payload.assetId,{variant:'preview'}):null,layoutBytes=preview?preview.bytes:bytes;
     if(preview&&preview.type!=='image/png'||layoutBytes.byteLength<24)throw new Error('图片兼容预览头无效');
     const header=new DataView(layoutBytes),width=header.getUint32(16),height=header.getUint32(20);
     if(!width||!height||width>16384||height>16384||width*height>24000000)throw new Error('图片素材像素超过布局预算');
     const page=this.state.document.page,ratio=width/height,w=Math.min(width*.75,page.width*.8,page.height*.8*ratio),h=w/ratio;
     const at=payload.at||[page.width/2,page.height/2];
     if(at.some(value=>!Number.isFinite(value)))throw new Error('演示放入位置无效');
     result=await this.surface.execute(job.base,format==='svg'?'insert.svgPicture':'insert.picture',{name:payload.assetId+'.'+format,data:bytesBase64(bytes),...(preview?{previewData:bytesBase64(preview.bytes)}:{}),rect:[at[0]-w/2,at[1]-h/2,w,h],...(hostMaterial?{hostMaterial}:{})});applied=true;
     const id=result.value?.id;if(!Number.isSafeInteger(id)||id<0||id>0xffffffff)throw new Error('原生演示未返回实际唯一图片身份，请核对当前源而不要重新放入');
     result={...result,value:{...result.value,ids:[id]}};
    }else if(format==='svg'){
    if(!this.surface.capabilities.embeddedSvgSource)throw new Error('当前海报构建尚未接入可回写的矢量源');
    const source=await this.materialBytes(payload.assetId,{variant:'source'});if(source.type!=='application/octet-stream')throw new Error('矢量源类型无效');
    const view=payload.at?null:(await this.surface.request('ui')).view,at=payload.at||[view?.center?.x,view?.center?.y];if(at.some(value=>!Number.isFinite(value)))throw new Error('无法读取实际画布位置，未放入素材');
    result=await this.surface.execute(job.base,'svg.placeSource',{sourceBase64:bytesBase64(source.bytes),at,...(hostMaterial?{hostMaterial}:{})});applied=true;
    }else{
    const params={name:payload.assetId+'.'+format,dataBase64:bytesBase64(bytes),link:false,...(hostMaterial?{hostMaterial}:{})};
    const info=(await this.surface.execute(job.base,'file.place.info',params)).value;
    if(!Number.isFinite(info?.width)||!Number.isFinite(info?.height)||info.width<=0||info.height<=0||info.width>1000000||info.height>1000000)throw new Error('素材的实际原生尺寸无效或超过布局预算');
    const view=payload.at?null:(await this.surface.request('ui')).view,at=payload.at||[view?.center?.x,view?.center?.y];
    if(at.some(value=>!Number.isFinite(value)))throw new Error('无法读取实际画布位置，未放入素材');
    // The native SVG Place command otherwise aligns artboards, even when `at`
    // is supplied. Its actual measured rectangle makes the requested centre exact.
    params.rect=[at[0]-info.width/2,at[1]-info.height/2,info.width,info.height];
    result=await this.surface.execute(job.base,'file.place',params);applied=true;
    }
    if(result.value?.ids?.length!==1)throw new Error('素材放入结果没有唯一原生对象；请先核对当前设计');
    this.pendingPlacement={jobId:job.id,assetId:payload.assetId,nativeId:result.value.ids[0],sourceId:this.view.sourceId,epoch:this.view.epoch};
    if(result.document)this.acceptDocument(result.document);await this.flush(job.id);
   }else if(action==='save'){await this.flush(job?.id);result={saved:true};}
   else throw new Error('未知设计动作');
   if(job){const completed=await this.api('finish',{jobId:job.id,epoch:this.view.epoch,ok:true,result});if(action==='place'&&completed.status==='succeeded')this.pendingPlacement=null;if(['apply_instance','convert_svg'].includes(action)&&completed.status==='succeeded')this.pendingInstanceUpdate=null;if(action==='convert_svg'&&completed.status==='succeeded'&&conversionSummary)this.change({svgConversionReport:conversionSummary,svgConversionPending:null});}
   if(['derive','place','open_asset','return_to_design','edit_instance','apply_instance','apply_linked','resume_linked','link_instances','unlink_instance','convert_svg'].includes(action))await this.refreshProject();return result;
  }catch(error){
   if(['apply_instance','convert_svg'].includes(action)&&!applied&&!error.outcomeUnknown){this.pendingInstanceUpdate=null;if(action==='convert_svg')this.change({svgConversionPending:null});}
   if(job)await this.api('finish',{jobId:job.id,epoch:this.view.epoch,ok:false,error:error.message,uncertain:error.feedbackRejected?false:applied||!!error.outcomeUnknown}).catch(()=>{});
   this.change({phase:this.state.document?'ready':'error',error:error.feedbackRejected?'AI 候选未通过目标与人工修改核对，已保留草稿，原稿未覆盖。':error.message});throw error;
  }finally{if(['image_adopt','image_undo'].includes(action))this.scopeLocked=false;this.busy=false;this.change({busy:false});if(this.state.dirty&&!this.state.pendingDraft)this.scheduleSave();}
 }
 async poll(){
  if(this.parking)return;
  if(this.polling)return;this.polling=true;
  try{
  if(!this.busy&&!this.saving&&!this.activating&&!this.disposing){
   const scope=this.getScope?.();if(scope&&(!this.view||scopeKey(this.view)!==scopeKey(scope)))await this.activate(scope);
  }
  if(!this.view||this.busy||this.saving||this.activating||this.disposing)return;
  if(this.fileRequest){if(Date.now()-(this.fileHeartbeat||0)>5000){await this.api('heartbeat');this.fileHeartbeat=Date.now();}return;}
  if(!this.state.hostMenuOpen&&this.surface&&this.state.document&&this.anchor?.isConnected&&this.state.phase==='ready'&&!this.manualBusy&&Date.now()-(this.surface.lastNativeReply||Date.now())>12000){
   if(!this.state.unresponsive){
    this.change({unresponsive:true,healthWarning:'编辑器暂未响应。可以继续等待，或恢复最近已保存版本；未保存的内容不保证恢复。'});
    await this.api('report',{epoch:this.view.epoch,document:this.state.document,sequence:++this.reportSequence,responsive:false});
   }
   return;
  }
  if(this.state.unresponsive)return;
  const owner=this.view,epoch=owner.epoch;const {job}=await this.api('poll');if(job){
   if(this.state.hostMenuOpen&&this.view===owner&&!this.activating){
    try{await this.resumeHostMenu();}catch(error){await this.api('finish',{viewId:owner.id,token:owner.token,epoch,jobId:job.id,ok:false,error:'编辑器未恢复，未执行设计动作：'+error.message}).catch(()=>{});throw error;}
   }
   if(this.view!==owner||this.view.epoch!==epoch||this.activating){await this.api('finish',{viewId:owner.id,token:owner.token,epoch,jobId:job.id,ok:false,error:'对话或设计已切换，未执行旧指令'}).catch(()=>{});return;}
   if(this.rememberedSource&&['execute','undo','inspect_node','save'].includes(job.action)){
    await this.api('finish',{jobId:job.id,epoch,ok:false,error:'原生编辑器正在恢复，请等恢复后重新读取当前源与选区'});return;
   }
   if(!this.anchor?.isConnected){this.focusWorkspace?.();const until=Date.now()+10000;while(!this.anchor?.isConnected&&Date.now()<until)await wait(30);}
   if(!this.anchor?.isConnected){await this.api('finish',{jobId:job.id,epoch,ok:false,error:'设计面板没有完成显示，未开始执行'});return;}
   await this.run(job.action,job.payload,job);
  }else if(this.rememberedSource&&this.anchor?.isConnected&&!this.busy&&!this.state.hostMenuOpen){await this.run('open',{sourceId:this.rememberedSource});}
  }finally{this.polling=false;}
 }
 async export(format){
  if(this.busy||this.activating||this.disposing)throw new Error('请先等待当前设计动作完成');
  const formats=this.view?.engineContract?.exportFormats||[];
  if(!formats.includes(format))throw new Error('当前原生引擎尚未接入此导出格式');
  const owner=this.view,surface=this.surface,epoch=owner?.epoch,title=this.state.title,uid=this.state.document?.uid;
  if(!surface||uid==null)throw new Error('请先打开设计');
  this.busy=true;this.change({busy:true});
  try{
   await this.flush();
   if(this.view!==owner||this.view.epoch!==epoch||this.surface!==surface)throw new Error('导出前作品已切换，没有导出其他作品');
   const exportRevision=owner.sourceRevision,exportEngineRevision=this.savedEngineRevision;
   const exchange=['psd','webp','tiff'].includes(format)||format==='pdf'&&surface.engine==='deckcraft';
   let snapshot;
   if(exchange){
    const revision=owner.sourceRevision,q=new URLSearchParams({id:owner.sourceId,epoch,revision,format});
    const response=await fetch(API+'/export?'+q,{headers:this.sourceHeaders(),cache:'no-store'});
    if(!response.ok)throw new Error((await response.json()).error||'原生文件导出失败');
    if(response.headers.get('x-source-revision')!==revision)throw new Error('下载结果对应其他源版本');
    const encoded=response.headers.get('x-export-warnings');let warnings=[];
    if(encoded){const padded=encoded.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(encoded.length/4)*4,'=');warnings=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded),char=>char.charCodeAt(0))));}
    snapshot={bytes:await response.arrayBuffer(),document:await surface.inspect(),warnings};
    if(!sameUint64(snapshot.document.revision,this.savedEngineRevision))throw new Error('导出期间作品已修改，请重新导出');
   }else if(format==='jpg'){
    snapshot=await surface.snapshot('png');
    const bitmap=await createImageBitmap(new Blob([snapshot.bytes],{type:'image/png'}));
    try{
     if(bitmap.width*bitmap.height>24000000)throw new Error('JPEG 超过 24 MP 导出预算');
     const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
     const context=canvas.getContext('2d');context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0);
     const jpeg=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92));
     if(jpeg?.type!=='image/jpeg')throw new Error('无法编码 JPEG');
     snapshot.bytes=await jpeg.arrayBuffer();
    }finally{bitmap.close();}
   }else snapshot=await surface.snapshot(format);
   if(!(snapshot.bytes instanceof ArrayBuffer)||!snapshot.bytes.byteLength)throw new Error('原生编辑器未返回可下载的非空字节');
   if(!sameUint64(snapshot.document.uid,uid)||this.view!==owner||this.view.epoch!==epoch)throw new Error('导出时文档身份已改变，没有下载其他作品');
   if(!sameUint64(snapshot.document.revision,exportEngineRevision)||owner.sourceRevision!==exportRevision)throw new Error('导出期间设计已有新修改，请保存后重新导出');
   const file=new File([snapshot.bytes],(title||'设计').replace(/[<>:"/\\|?*]/g,'_')+'.'+format,{type:({svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',webp:'image/webp',tiff:'image/tiff',pdf:'application/pdf',psd:'image/vnd.adobe.photoshop',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'})[format]||'application/octet-stream'});
   Object.defineProperty(file,'designcraftWarnings',{value:snapshot.warnings||[]});
   if(format==='pptx'){
    const operationId='export-'+crypto.randomUUID(),query=new URLSearchParams({epoch,id:owner.sourceId,revision:exportRevision,operationId});
    const encoded=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(snapshot.warnings||[])))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    const response=await fetch(API+'/export-receipt?'+query,{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream','x-export-warnings':encoded},body:snapshot.bytes});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'导出文件已生成，但固定版本回执尚未保存，请重试导出');
    if(this.view!==owner||owner.epoch!==epoch||owner.sourceRevision!==exportRevision)throw new Error('导出回执属于先前版本，已保留文件，请重新选择当前版本导出');
    Object.defineProperty(file,'designcraftReceipt',{value:result.receipt});this.change({lastExportReceipt:result.receipt});
   }
   return file;
  }finally{this.busy=false;this.change({busy:false});if(this.state.dirty)this.scheduleSave();}
 }
 async suspendHostMenu(){
  if(this.state.hostMenuOpen)return this.hostMenuPreparation;
  if(this.busy||this.activating||this.disposing||this.fileRequest)throw new Error('请先等待当前设计动作完成');
  const surface=this.surface;this.hostMenuCheckpoint=null;this.change({hostMenuOpen:true,hostMenuReady:false});
  const task=(async()=>{
   if(surface){
    if(!this.state.pendingDraft)await this.flush(undefined,{force:surface.engine==='photocraft'&&!!this.state.document?.nativeSelection?.data?.rasterSelection});
    await surface.setActivity(false);this.portal.style.display='none';
    this.hostMenuCheckpoint={view:this.view,epoch:this.view?.epoch,surface,uid:this.state.document?.uid,revision:this.state.document?.revision,sourceRevision:this.view?.sourceRevision,inputSequence:this.inputSequence||0};
   }
   // The browser must commit the old cross-origin hit region before a menu is
   // advertised as ready; a DOM style change alone can still lose the first click.
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   this.change({hostMenuReady:true});
  })();
  this.hostMenuPreparation=task;
  try{await task;}catch(error){
   this.portal.style.display='block';if(surface)await surface.setActivity(true).catch(()=>{});
   this.change({hostMenuOpen:false,hostMenuReady:false,error:error.message});throw error;
  }finally{if(this.hostMenuPreparation===task)this.hostMenuPreparation=null;}
 }
 async checkpointHostPanel(){
  if(this.hostMenuPreparation)await this.hostMenuPreparation;
  if(!this.state.hostMenuOpen)return this.flush(undefined,{force:true});
  // Opening a host panel already saves and freezes the native surface. Read
  // that exact checkpoint without reactivating it and unmounting the panel.
  const saved=this.hostMenuCheckpoint;
  if(!this.state.hostMenuReady||!saved||saved.view!==this.view||saved.epoch!==this.view?.epoch||saved.surface!==this.surface||this.surface?.active||!this.view?.sourceId||!saved.sourceRevision||saved.sourceRevision!==this.view.sourceRevision||!sameUint64(saved.uid,this.state.document?.uid)||!sameUint64(saved.revision,this.state.document?.revision)||!sameUint64(saved.revision,this.savedEngineRevision)||saved.inputSequence!==(this.inputSequence||0)||this.state.dirty||this.state.pendingDraft||this.state.foreignDocument||this.state.unresponsive||this.manualBusy)throw new Error('面板的已保存检查点已变化，请返回设计后重新打开面板');
  return {revision:saved.sourceRevision};
 }
 async resumeHostMenu({allowEmergency=false}={}){
  if(this.hostMenuPreparation)await this.hostMenuPreparation;
  if(!this.state.hostMenuOpen)return;
  if(this.pendingHtmlDrafts?.size)try{await Promise.all(this.pendingHtmlDrafts.values());}catch(error){if(!allowEmergency||!this.htmlEmergencyDrafts?.size)throw error;}
  if(this.state.htmlDraftError&&!allowEmergency)throw new Error('网页草稿尚未写入本地存储，请保留当前窗口并重试：'+this.state.htmlDraftError);
  // Exclusive panels hide the stage with display:none. A native Web App in
  // that stage cannot service its activation request until it is paintable.
  // Reveal it while it remains inert, then publish the resumed menu state.
  const stage=this.anchor?.closest('.dcNativeStage'),hidden=stage?.style.display==='none';
  if(hidden)stage.style.display='';
  this.portal.style.display='block';
  try{
   if(this.surface){
    await Promise.race([new Promise(resolve=>requestAnimationFrame(resolve)),new Promise(resolve=>setTimeout(resolve,120))]);
    await this.surface.setActivity(true);await this.syncPresentation();
   }
   this.hostMenuCheckpoint=null;this.change({hostMenuOpen:false,hostMenuReady:false,...(allowEmergency?{htmlDraftError:null}:{})});if(this.state.dirty)this.scheduleSave();
  }catch(error){if(hidden&&stage?.isConnected)stage.style.display='none';throw error;}
 }
 async requestHostFile(action){
  if(!['save_as','save_copy','close'].includes(action))throw new Error('未支持的宿主文件操作');
  const surface=this.surface,epoch=this.view?.epoch,document=this.state.document;
  if(!surface||!epoch||!document||!this.view?.sourceId)throw new Error('请先打开设计');
  return this.receiveNativeFile(surface,epoch,{id:'host-'+crypto.randomUUID(),action,uid:document.uid,revision:document.revision,params:{}},{hostInitiated:true});
 }
 async receiveNativeFile(surface,epoch,request,{hostInitiated=false}={}){
  if(this.state.hostMenuOpen)await this.resumeHostMenu();
  if(this.surface!==surface||this.view?.epoch!==epoch)return;
  if(typeof request.action==='string'&&request.action.startsWith('local_')&&request.action!=='local_ink_text'){
   if(hostInitiated)throw new Error('该本地采集功能已移除');
   await surface.completeFileRequest(request.id,{ok:false,error:'该本地采集功能已移除'});return;
  }
  if(this.fileRequest?.request.id===request.id&&this.fileRequest.surface===surface)return;
  if(this.busy||this.activating||this.disposing||this.state.pendingDraft||this.state.foreignDocument||this.fileRequest){
   if(hostInitiated)throw new Error('请先完成当前设计动作或草稿恢复');
   await surface.completeFileRequest(request.id,{ok:false,error:'请先完成当前设计动作或草稿恢复'});return;
  }
  if(request.uid!=null&&!sameUint64(request.uid,this.state.document?.uid)){if(hostInitiated)throw new Error('文件操作的设计身份已改变');await surface.completeFileRequest(request.id,{ok:false,error:'文件操作的设计身份已改变'});return;}
  this.fileRequest={surface,epoch,request,hostInitiated};this.change({fileAction:request,fileDialogReady:false,deckLocalApplied:false,error:null});
  if(['save','new','close'].includes(request.action))await this.completeNativeFile();
  else{
   const pending=this.fileRequest;
   const preparation=(async()=>{
    // A real checkpoint and activity barrier precede hiding the OOPIF. Merely
    // disabling pointer-events leaves stale compositor hit regions in Chromium.
    await this.flush(undefined,{force:true});
    if(this.fileRequest!==pending||this.surface!==surface)throw new Error('文件操作准备期间作品已切换');
    await surface.setActivity(false);
    this.portal.style.display='none';this.change({fileDialogReady:true});
   })();
   this.fileDialogPreparation=preparation;
   try{await preparation;}catch(error){
    // A failed checkpoint must leave the editable App and its staged draft alive,
    // rather than trapping the person in an unusable file dialog.
    this.portal.style.display='block';
    try{await surface.setActivity(true);if(!hostInitiated)await surface.completeFileRequest(request.id,{ok:false,error:error.message});}
    catch(receiptError){this.change({error:'文件操作未完成，原设计与草稿仍保留：'+error.message+'；'+receiptError.message});}
    if(this.fileRequest===pending){this.fileRequest=null;this.change({fileAction:null,fileDialogReady:false,error:'文件操作前保存失败，原设计与草稿仍保留：'+error.message});}
    throw error;
   }finally{if(this.fileDialogPreparation===preparation)this.fileDialogPreparation=null;}
  }
 }
 async resumeFileDialog(){
  if(this.fileDialogPreparation)await this.fileDialogPreparation;
  this.portal.style.display='block';
  if(this.surface?.active===false){await this.surface.setActivity(true);await this.syncPresentation();}
 }
 async cancelNativeFile(){
  const pending=this.fileRequest;if(!pending)return;
  if(this.busy)throw new Error('文件操作已经开始，请等待真实结果');
  await this.resumeFileDialog();
  if(!pending.hostInitiated&&pending.surface===this.surface&&!pending.surface.disposed)await pending.surface.completeFileRequest(pending.request.id,{ok:false,cancelled:true});
  if(this.fileRequest===pending){this.fileRequest=null;this.change({fileAction:null,fileDialogReady:false});if(this.state.dirty)this.scheduleSave();}
 }
 async inspectDeckInk(){
  const pending=this.fileRequest,owner=this.view;if(!pending||pending.request.action!=='local_ink_text'||owner.engine!=='deckcraft')throw new Error('没有当前笔迹文字识别操作');
  await this.resumeFileDialog();const document=await this.surface.inspect();
  if(this.fileRequest!==pending||this.view!==owner||owner.epoch!==pending.epoch)throw new Error('识别前幻灯片已切换');
  const result=await this.surface.execute(nativeBase(document),'draw.inspectInk',{});if(result.document)this.acceptDocument(result.document);await this.report(result.document||document);
  return {base:nativeBase(result.document||document),value:result.value};
 }
 async completeDeckLocal(command,params,base){
  const pending=this.fileRequest,owner=this.view,surface=this.surface;if(!pending||pending.request.action!=='local_ink_text'||owner.engine!=='deckcraft'||this.busy)throw new Error('当前文字识别操作不可提交');
  await this.resumeFileDialog();this.busy=true;this.change({busy:true,error:null});
  try{
   if(this.fileRequest!==pending||this.view!==owner||this.surface!==surface||owner.epoch!==pending.epoch)throw new Error('原幻灯片已切换，未写入其他作品');
   const current=await surface.inspect();
   if(pending.localApplied){if(!matchesNativeBase(current,nativeBase(pending.localApplied.document),owner.engine))throw new Error('应用后作品已有修改，请先在画布核对并保存');}
   else{
    if(command!=='draw.inkToText'||!matchesNativeBase(current,base,owner.engine))throw new Error('幻灯片或选区在识别期间改变，未插入旧结果');
    const result=await surface.execute(base,command,params||{});pending.localApplied=result;this.acceptDocument(result.document);this.change({deckLocalApplied:true});
   }
   await this.flush(undefined,{force:true});
   if(this.fileRequest!==pending||this.view!==owner||this.surface!==surface)throw new Error('结果已保存，但工作区已改变，请核对原作品');
   await surface.completeFileRequest(pending.request.id,{ok:true});const warning=pending.localApplied?.value?.warning;
   this.fileRequest=null;this.change({fileAction:null,fileDialogReady:false,deckLocalApplied:false,imageNotice:warning||'已插入实际识别文字并保存当前原生源。'});
   return pending.localApplied;
  }catch(error){const message=(pending.localApplied?'结果已在原生源应用，保存尚未确认；请重试保存，系统不会重复插入。':'')+error.message;this.change({error:message});throw new Error(message,{cause:error});}
  finally{this.busy=false;this.change({busy:false});}
 }
 async completeNativeFile(options={}){
  const pending=this.fileRequest;if(!pending)throw new Error('没有待处理的文件操作');
  const {surface,epoch,request}=pending;
  if(this.busy||this.view?.epoch!==epoch||this.surface!==surface)throw new Error('当前作品已改变或已有操作，未执行旧文件操作');
  await this.resumeFileDialog();
  let ok=false;
  try{
   if(request.action==='new')await this.run('new',{...this.view.engineContract.createDefaults,...request.params,engine:this.view.engine,title:request.params?.name||(this.view.engine==='photocraft'?'未命名图片':'未命名设计')});
   else if(request.action==='open'){
    if(!options.file)throw new Error('请选择真实设计文件');
    await this.importFile(options.file);
   }else if(request.action==='works'){
    if(!options.sourceId)throw new Error('请选择要打开的作品');
    if(options.sourceId!==this.state.sourceId)await this.run('open',{sourceId:options.sourceId});
   }else if(request.action==='revert')await this.restoreSaved({checkpointOnly:true});
   else{
    this.busy=true;this.change({busy:true});
    const until=Date.now()+3000;while(this.manualBusy&&Date.now()<until)await wait(20);
    await this.flush(undefined,{force:true});
    if(this.surface!==surface||this.view?.epoch!==epoch)throw new Error('文件操作期间作品已改变，未改变其他作品');
    if(request.action==='save_as'||request.action==='save_copy'){
     const copied=await this.api('copy',{epoch,sourceRevision:this.view.sourceRevision,title:options.title});
     await this.refresh();
     if(request.action==='save_as')await this.load({sourceId:copied.sourceId});
    }else if(request.action==='close'){
     const cleared=await this.api('unselect',{epoch});
     this.surface.dispose();this.surface=null;this.view={...this.view,...cleared};this.savedEngineRevision=null;this.rememberedSource=null;this.parkedCheckpoint=null;this.reportSequence=0;
     this.change({document:null,sourceId:null,title:null,sourceRevision:null,epoch:cleared.epoch,dirty:false,foreignDocument:null});
     await this.vault.remove(this.workspaceKey());await this.refresh();
    }else if(request.action!=='save')throw new Error('尚未接入此原生文件操作');
   }
   ok=true;
  }catch(error){this.change({error:error.message});throw error;}
  finally{
   this.busy=false;this.change({busy:false});
   if(!pending.hostInitiated&&surface===this.surface&&!surface.disposed)await surface.completeFileRequest(request.id,{ok,error:ok?undefined:this.state.error}).catch(error=>this.change({error:'文件操作回执未确认：'+error.message}));
   if(this.fileRequest===pending){this.fileRequest=null;this.change({fileAction:null,fileDialogReady:false});}
   if(this.state.dirty)this.scheduleSave();
  }
 }
 async importFile(file){
  if(this.busy||this.activating||this.disposing)throw new Error('请先等待当前设计动作完成');
  if(!file||!file.size||file.size>256*1024*1024||!(/\.(svg|vectorcraft|drawcraft|vctemplate|pcraft|png|jpe?g|psd|psb|webp|tiff?|deckcraft|slidecraft|pptx|potx|ppsx)$/i.test(file.name)))throw new Error('请选择不超过256MiB的已支持专业源、模板、图片或演示文稿');
  const engine=/\.(deckcraft|slidecraft|pptx|potx|ppsx)$/i.test(file.name)?'deckcraft':/\.(pcraft|png|jpe?g|psd|psb|webp|tiff?)$/i.test(file.name)?'photocraft':'vectorcraft';
  if(!this.runtime?.engines?.[engine])throw new Error('该文件的持续编辑桥尚未开启，当前设计未改变');
  this.busy=true;this.change({busy:true,error:null});const previous=this.state.sourceId;let preserved,sourceId,originalConfirmed=false;
  try{
   await this.flush();
   sourceId='import-'+crypto.randomUUID();const bytes=await file.arrayBuffer();
   const query=new URLSearchParams({id:sourceId,name:file.name});
   const response=await fetch(API+'/input?'+query,{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/octet-stream','x-designcraft-epoch':this.view.epoch},body:new Blob([bytes])});
   preserved=await response.json();if(!response.ok||!preserved.ok)throw new Error(preserved.error||'未能保留原始导入文件，未切换作品');
   if(preserved.sourceId!==sourceId||preserved.original?.name!==file.name||preserved.original?.bytes!==bytes.byteLength||!/^[a-f0-9]{64}$/.test(preserved.original?.sha256||'')||await byteHash(bytes)!==preserved.original.sha256)throw new Error('保存回执与选择的文件不一致，未打开新作品');
   originalConfirmed=true;
   this.change({lastImport:preserved});
   if(/\.svg$/i.test(file.name))validateGeneratedSvg(new TextDecoder().decode(bytes));
   if(/\.vctemplate$/i.test(file.name))await validateVectorTemplate(bytes);
   let inputBytes=bytes,inputName=file.name,warnings=[];
   if(/\.(psd|psb|webp|tiff?)$/i.test(file.name)){
    const owner=this.view,epoch=owner.epoch,response=await fetch(API+'/photo-import',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({epoch,sourceId,sha256:preserved.original.sha256})});
    if(!response.ok)throw new Error((await response.json()).error||'原生图片导入失败');
    inputBytes=await response.arrayBuffer();if(await byteHash(inputBytes)!==response.headers.get('x-source-sha256'))throw new Error('图片转换源摘要不一致');
    if(this.view!==owner||this.view.epoch!==epoch)throw new Error('图片转换期间工作区已切换');
    const encoded=response.headers.get('x-import-warnings');if(encoded){const padded=encoded.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(encoded.length/4)*4,'=');warnings=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded),c=>c.charCodeAt(0))));}
    inputName=sourceId+'.pcraft';
   }
   const result=await this.load({sourceId,title:file.name.replace(/\.(svg|vectorcraft|drawcraft|vctemplate|pcraft|png|jpe?g|psd|psb|webp|tiff?|deckcraft|slidecraft|pptx|potx|ppsx)$/i,''),name:inputName,bytes:inputBytes,engine});
   if(warnings.length)this.change({importWarnings:[...warnings,...(this.state.importWarnings||[])]});return result;
  }catch(error){
   // A rejected open has no editable document. The old source was already durably
   // saved, and the exact incoming file was preserved before asking WASM to open it.
   if(preserved?.ok&&previous&&!this.state.document){
    this.change({phase:'error'});
    try{await this.load({sourceId:previous});}catch{/* Report the import failure and keep the saved sources listed. */}
   }
   const suffix=originalConfirmed?'；原始导入文件已保留，未覆盖原作品':preserved?.ok?'；服务报告已保存，预期记录 '+sourceId+' 的字节身份未确认，未覆盖原作品':'';
   const failure=Object.assign(new Error(error.message+suffix,{cause:error}),{status:error.status});
   this.change({phase:this.state.document?'ready':'error',error:failure.message});throw failure;
  }finally{this.busy=false;this.change({busy:false});}
 }
 context(){
  if(!this.view||!this.state.sourceId||!this.state.document)return null;
  return {schema:2,editorProtocol:EDITOR_CONTEXT_PROTOCOL,sessionId:this.view.sessionId,root:this.view.root,sourceId:this.state.sourceId,title:this.state.title,epoch:this.view.epoch,sourceRevision:this.state.sourceRevision,
   engine:this.view.engine,engineUid:this.state.document.uid,engineRevision:this.state.document.revision,objectIds:selectedObjectIds(this.state.document),nativeSelection:this.state.document.nativeSelection,selectionStamp:this.state.document.selectionStamp,
   page:this.state.document.page,coordinateSpace:this.state.document.coordinateSpace,selectionBounds:this.state.document.selectionBounds};
 }
 requestAiInput(){
  if(!this.state.document)return;
  this.change({selectionIntent:{id:(this.state.selectionIntent?.id||0)+1,sourceId:this.view.sourceId,epoch:this.view.epoch,focus:true}});
 }
 async referenceContext(){
  if(this.manualBusy)throw new Error('请完成当前输入或拖动后引用');
  if(this.surface&&!this.surface.active){
   const saved=this.parkedCheckpoint;
   if(!saved||saved.viewId!==this.view?.id||saved.epoch!==this.view?.epoch||!sameUint64(saved.uid,this.state.document?.uid)||!sameUint64(saved.revision,this.state.document?.revision)||saved.sourceRevision!==this.view?.sourceRevision)throw new Error('编辑器已暂挂且检查点不匹配，请返回设计后重新引用');
   return this.context();
  }
  if(this.surface){this.acceptDocument(await this.surface.inspect());await this.report();}
  return this.context();
 }
 async restoreSaved({checkpointOnly=false}={}){
  if(this.busy||this.saving||this.manualBusy)throw new Error('请先结束输入或等待当前动作结果');
  const sourceId=this.state.sourceId;if(!sourceId)throw new Error('没有可恢复的专业源');
  if(checkpointOnly&&!this.view.sourceRevision)throw new Error('此作品尚无已保存版本，现有草稿没有被删除');
  if(this.state.pendingDraft)throw new Error('待恢复草稿已经保留，请先选择草稿恢复方式');
  if(this.state.foreignDocument)throw new Error('请先保留编辑器另开的文档，原作品没有被覆盖');
  if(checkpointOnly&&this.parentContext){
   if(this.parentContext.sourceId===sourceId)this.releaseParent();
   else{this.parentContext.surface.dispose();this.parentContext.invalidated=true;}
  }
  this.busy=true;this.change({busy:true});
  try{
   if(this.state.dirty&&!checkpointOnly){
    try{await this.flush();}catch(error){
     const cached=await this.vault.get(this.cacheKey()),current=this.state.document;
     if(!cached||!sameUint64(cached.document?.uid,current?.uid)||!sameUint64(cached.document?.revision,current?.revision))throw new Error('最新修改尚未完整保留，编辑器没有被关闭：'+error.message);
    }
   }
   this.surface?.dispose();this.surface=null;this.change({document:null,foreignDocument:null,dirty:false,error:null,unresponsive:false,healthWarning:null});
  }finally{this.busy=false;this.change({busy:false});}
  return this.run('open',{sourceId});
 }
 async adoptImageCandidate({bytes,job,candidate,operationJobId,internal=false}){
  if(this.busy&&!internal||this.saving||this.activating||this.disposing||this.state.pendingDraft||this.manualBusy)throw new Error('请先完成当前输入或草稿恢复');
  if(!(bytes instanceof ArrayBuffer)||!bytes.byteLength||await byteHash(bytes)!==candidate.sourceHash)throw new Error('图片候选源摘要不一致');
  const owner=this.view,epoch=owner?.epoch,baseline=job.studio?.source;
  if(!owner||owner.engine!=='photocraft'||!baseline||baseline.sourceId!==owner.sourceId)throw new Error('图片在生成后已有变化；候选已保留，未覆盖后续修改');
  this.scopeLocked=true;this.busy=true;this.change({busy:true});let committed=false;
  try{
   const response=await fetch(API+'/image',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action:'prepare-inplace',epoch,id:job.id,candidateId:candidate.id,...(operationJobId?{operationJobId}:{})})});
   const prepared=await response.json();if(!response.ok||!prepared.ok)throw new Error(prepared.error||'图片候选未获原位许可');
   if(this.view!==owner||this.view.epoch!==epoch)throw new Error('图片工作区已切换，未覆盖其他作品');
   const key=this.cacheKey(),token=crypto.randomUUID(),draft={token,bytes,baseRevision:owner.sourceRevision,title:this.state.title,document:this.state.document,at:Date.now(),imageAdoption:prepared.plan};
   const staged=await this.vault.replace(key,this.ownedDraftTokens.get(key)||null,draft);if(!staged.applied){this.change({pendingDraft:staged.current});throw new Error('已有其他草稿，图片候选未覆盖');}
   this.ownedDraftTokens.set(key,token);this.change({pendingDraft:draft});
   await this.resumeHostMenu();await this.recoverDraft({imagePlan:prepared.plan,internal:true,jobId:operationJobId});committed=true;
   const link=await fetch(API+'/image',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action:'link',epoch:this.view.epoch,id:job.id,candidateId:candidate.id,sourceId:this.view.sourceId,...(operationJobId?{operationJobId}:{})})});
   const linked=await link.json();if(!link.ok||!linked.ok)throw new Error('图片已保存到原位，但候选关系尚未确认；请从候选列表核对，不要重复采用');
   this.change({imageNotice:'图片候选已保存到当前图片源，原版和其他候选仍保留。'});return linked;
  }catch(error){if(committed)this.change({imageNotice:'图片已保存到原位；候选关系需要重新核对。'});throw error;}
  finally{if(!internal){this.scopeLocked=false;this.busy=false;}this.change({busy:this.busy});}
 }
 async undoImageCandidate({operationJobId,internal=false}={}){
  if(this.busy&&!internal||this.saving||this.activating||this.disposing||this.state.pendingDraft||this.manualBusy)throw new Error('请先完成当前输入或草稿恢复');
  const active=this.surface;
  if(!internal)await this.suspendHostMenu();
  this.scopeLocked=true;this.busy=true;this.change({busy:true});
  try{
   if(internal&&active)await active.setActivity(false);
   const owner=this.view,epoch=owner.epoch,response=await fetch(API+'/image',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action:'prepare-undo',epoch,...(operationJobId?{operationJobId}:{})})});
   const prepared=await response.json();if(!response.ok||!prepared.ok)throw new Error(prepared.error||'图片候选无法撤销');
   const plan=prepared.plan,q=new URLSearchParams({epoch,planId:plan.id}),input=await fetch(API+'/image-undo-source?'+q,{headers:this.sourceHeaders()});
   if(!input.ok)throw new Error((await input.json()).error||'原图片版本读取失败');
   const bytes=await input.arrayBuffer();if(await byteHash(bytes)!==plan.sourceHash||input.headers.get('x-source-sha256')!==plan.sourceHash)throw new Error('原图片版本摘要不一致，未撤销');
   if(this.view!==owner||this.view.epoch!==epoch)throw new Error('图片工作区已切换，未撤销其他作品');
   const key=this.cacheKey(),token=crypto.randomUUID(),draft={token,bytes,baseRevision:owner.sourceRevision,title:this.state.title,document:this.state.document,at:Date.now(),imageAdoption:plan};
   const staged=await this.vault.replace(key,this.ownedDraftTokens.get(key)||null,draft);if(!staged.applied){this.change({pendingDraft:staged.current});throw new Error('已有其他草稿，未撤销图片');}
   this.ownedDraftTokens.set(key,token);this.change({pendingDraft:draft});await this.resumeHostMenu();await this.recoverDraft({imagePlan:plan,internal:true,jobId:operationJobId});
   this.change({imageNotice:'已恢复采用候选前的图片版本；候选和被替换版本仍保留。'});return {sourceId:this.view.sourceId,sourceRevision:this.view.sourceRevision,restoredRevision:plan.restoreRevision};
  }finally{
   if(this.state.hostMenuOpen)await this.resumeHostMenu().catch(()=>{});
   if(internal&&this.surface===active&&!active?.disposed&&!active?.active)await active.setActivity(true).catch(()=>{});
   if(!internal){this.scopeLocked=false;this.busy=false;}this.change({busy:this.busy});
  }
 }
 async reconcileImageCandidate(){
  const draft=this.state.pendingDraft,plan=draft?.imageAdoption;if(!plan||this.busy||this.saving||!this.view)throw new Error('没有可核对的图片候选草稿');
  const owner=this.view,epoch=owner.epoch,key=this.cacheKey();this.scopeLocked=true;this.busy=true;this.change({busy:true});
  try{
   const response=await fetch(API+'/image',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action:'reconcile-inplace',epoch,id:plan.imageJobId,candidateId:plan.candidateId,planId:plan.id,sourceId:plan.sourceId,baseRevision:plan.baseRevision,type:plan.type,restoreRevision:plan.restoreRevision})});
   const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'图片候选回执尚未确认');
   if(this.view!==owner||this.view.epoch!==epoch)throw new Error('工作区已切换，未清除候选草稿');
   const removed=await this.vault.replace(key,draft.token,undefined);if(!removed.applied)throw new Error('另一份草稿已变化，未清除');
   this.ownedDraftTokens.delete(key);this.pendingImageAdoption=null;this.surface?.dispose();this.surface=null;
   this.change({document:null,pendingDraft:null,dirty:false,error:null,phase:'ready'});
   await this.load({sourceId:plan.sourceId});
   if(plan.type!=='undo'){
    const link=await fetch(API+'/image',{method:'POST',headers:{...this.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action:'link',epoch:this.view.epoch,id:plan.imageJobId,candidateId:plan.candidateId,sourceId:plan.sourceId})});
    const linked=await link.json();if(!link.ok||!linked.ok)throw new Error('图片已保存，候选关系尚未确认；请稍后核对');
   }
   this.change({imageNotice:plan.type==='undo'?'已核对图片候选撤销，未重复执行。':'已核对并恢复已保存的图片候选，未重复执行。'});return result;
  }finally{this.scopeLocked=false;this.busy=false;this.change({busy:false});}
 }
 async recoverDraft({independent=false,independentSourceId,imagePlan=null,internal=false,jobId}={}){
  const draft=this.state.pendingDraft;if(!draft)throw new Error('没有待恢复的草稿');
  if(draft.feedbackRejected&&!independent)throw new Error('这份 AI 候选未通过人工保护核对，只能独立保留，不能覆盖原稿');
  if((draft.instanceUpdate||draft.originAssignment)&&!independent)throw new Error('此草稿来自未确认的图片或来源回写。请先核对项目回执，或恢复为独立作品保留内容');
  if(draft.imageAdoption&&!independent&&(!imagePlan||imagePlan.id!==draft.imageAdoption.id))throw new Error('图片候选的原位许可已失效；请核对候选回执，或恢复为独立作品');
  if(!independent&&draft.baseRevision!==this.view.sourceRevision)throw new Error('磁盘版本已有更新，请将草稿恢复为独立作品');
  if(this.busy&&!internal||this.saving)throw new Error('请先等待当前动作结束');this.busy=true;this.change({busy:true});
  const oldKey=this.cacheKey();
  try{
   if(!independent)this.ownedDraftTokens.set(oldKey,draft.token);
   const sourceId=independent?independentSourceId||'recovered-'+crypto.randomUUID():this.state.sourceId;
   const selected=await this.api('select',{sourceId,title:draft.title+' · 恢复',engine:draft.document?.engine||this.view.engine,preserveNavigation:!!this.parentContext&&!independent,...(imagePlan&&!independent?{imagePlanId:imagePlan.id}:{}),...(jobId?{jobId}:{})});
   if(independent&&this.parentContext){this.releaseParent();this.change({sourceNavigation:null});}
   this.surface?.dispose();this.surface=null;this.view={...this.view,...selected};this.reportSequence=0;this.savedEngineRevision=null;
   this.pendingImageAdoption=imagePlan&&!independent?{...imagePlan,epoch:selected.epoch,sourceId}:null;
   this.change({phase:'opening',sourceId,epoch:selected.epoch,title:selected.title,sourceRevision:selected.sourceRevision,document:null,foreignDocument:null,pendingDraft:null,dirty:false,error:null,unresponsive:false,healthWarning:null});
   const surface=await this.ensureSurface();const loaded=await surface.open(sourceId+'.'+selected.engineContract.extension,draft.bytes.slice(0));this.acceptDocument(loaded.document);await this.report();await this.flush(jobId,{opening:true});
   if(oldKey!==this.cacheKey()){
    const removed=await this.vault.replace(oldKey,draft.token,undefined);
    if(!removed.applied)throw new Error('候选已独立保存，原位置的草稿已被另一窗口更新；已保留新草稿，请先核对');
    if(this.ownedDraftTokens.get(oldKey)===draft.token)this.ownedDraftTokens.delete(oldKey);
   }
   await this.refresh();this.change({phase:'ready'});
  }catch(error){const retained=await this.vault.get(oldKey).catch(()=>null);this.change({phase:this.state.document?'ready':'error',error:error.message,...(retained?{pendingDraft:retained}:{})});throw error;}finally{if(!internal)this.busy=false;this.change({busy:this.busy});}
 }
 async keepRejectedFeedbackAndRestore(){const draft=this.state.pendingDraft,sourceId=this.state.sourceId;if(!draft?.feedbackRejected)throw new Error('没有需要隔离保留的 AI 候选');await this.recoverDraft({independent:true});return this.run('open',{sourceId});}
 async dispose(){
  if(this.disposing)return;
  if(this.busy||this.activating||this.manualBusy)throw new Error('当前输入或设计动作尚未结束，编辑器没有被关闭');
  if(this.state.hostMenuOpen)await this.resumeHostMenu();
  if(this.fileRequest)await this.cancelNativeFile();
  this.disposing=true;clearInterval(this.pollTimer);clearTimeout(this.saveTimer);
  try{
   if(!this.state.pendingDraft||this.state.dirty)await this.flush();
   if(this.view)await this.api('close');
  }catch(error){
   // A failed save must not destroy the only still-live editable copy.
   this.disposing=false;this.pollTimer=setInterval(()=>this.poll().catch(error=>this.change({error:error.message})),450);
   this.change({error:'关闭前保存未完成，编辑器和草稿已保留：'+error.message});throw error;
  }
  this.detachPosition?.();this.detachPosition=null;
  this.themeObserver?.disconnect();
  this.surface?.dispose();this.releaseParent();this.portal.remove();
 }
}
