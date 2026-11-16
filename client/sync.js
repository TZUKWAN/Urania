import {findLayer as findSelectedLayer,nativeNodes} from './selection.js';
import { mergeDocuments, documentsEqual } from './merge.js';
import { recoveryKey, saveDraft, readDraft, clearDraft } from './recovery.js';
import { configureAssets } from './engine.js';

export const SYNC_VERSION = 10;
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
export function createStore(initial) {
  let state=initial;const listeners=new Set();
  return {get:()=>state,set(patch){state={...state,...patch};for(const fn of listeners)fn();},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
}
export function api(path) {const u=new URL(String(path).replace(/^\/+/,''),document.baseURI);return u.pathname+u.search;}
class ApiError extends Error {constructor(message,status,body){super(message);this.status=status;this.body=body;}}
async function request(path,body,options={}) {
  const response=await fetch(api(path),body===undefined?{cache:'no-store',...options}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),...options});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw new ApiError(result?.error||'请求失败 '+response.status,response.status,result);
  if(result?.ok===false&&!Array.isArray(result.results))throw new ApiError(result.error||'操作失败',response.status,result);
  return result;
}

export function createSync(store) {
  const writer='ui:'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2));
  let disposed=false,rootGeneration=0,documentGeneration=0,stateRequest=0,editVersion=0;
  let baseGeneration=0;
  let baseDoc=clone(store.get().doc),baseRevision=store.get().revision||null;
  let sse=null,pollTimer=null,reconnectTimer=null,saveTimer=null,recoveryTimer=null,inFlight=null,polling=false;
  let protocolCheck=null,pixelHooks=null;
  const setPixelHooks=hooks=>{pixelHooks=hooks;};
  async function ensureProtocol() {
    if(store.get().backendProtocol>=2)return;
    if(!protocolCheck)protocolCheck=request('/designcraft/api/v1/health').then(body=>{
      store.set({backendProtocol:body.protocolVersion||1});
      if(body.protocolVersion<2||!body.capabilities?.revisionedWrites)throw new Error('插件后端尚未更新，已阻止无版本保护的保存。');
    }).catch(error=>{protocolCheck=null;throw error;});
    await protocolCheck;
  }
  const context=()=>({root:store.get().root,id:store.get().activeId||store.get().doc?.id,generation:documentGeneration,rootGeneration});
  const valid=c=>!disposed&&c.root===store.get().root&&c.id===(store.get().activeId||store.get().doc?.id)&&c.generation===documentGeneration&&c.rootGeneration===rootGeneration;
  const query=(root,id)=>'?root='+encodeURIComponent(root)+(id?'&id='+encodeURIComponent(id):'');
  async function rememberDraft() {
    const c=context();const pixels=pixelHooks?await pixelHooks.draft():[];if(!valid(c))return;
    const s=store.get();if(!s.dirty||!s.root||!s.doc)return Promise.resolve();
    const record={doc:clone(s.doc),baseDoc:clone(baseDoc),baseRevision,pixels,writer,editVersion};
    return saveDraft(recoveryKey(s.root,s.doc.id),record).catch(error=>{if(!disposed)store.set({recoveryError:String(error?.message||error)});});
  }
  function markLocalEdit() {
    editVersion++;store.set({dirty:true});clearTimeout(recoveryTimer);
    recoveryTimer=setTimeout(()=>{rememberDraft().catch(error=>store.set({recoveryError:String(error?.message||error)}));},100);
  }
  function scheduleSave() {
    if(disposed||store.get().conflict)return;
    clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;pushDoc().catch(()=>{});},350);
  }
  function uiFor(doc) {
    const ui=store.get().ui||{},pages=doc?.pages||[];
    const page=pages.find(p=>p.id===ui.pageId)||pages[0];
    const contains=(layers,id)=>(layers||[]).some(l=>l.id===id||(l.type==='group'&&contains(l.children,id)));
    const ids=page&&page.id===ui.pageId?[...new Set(ui.selectedIds?.length?ui.selectedIds:[ui.selectedId].filter(Boolean))].filter(id=>contains(page.layers,id)):[];const selectedId=ids.includes(ui.selectedId)?ui.selectedId:ids.at(-1)||null,nativeSelection=ui.nativeSelection&&page?.id===ui.nativeSelection.pageId&&contains(page.layers,ui.nativeSelection.layerId)?ui.nativeSelection:null;return {...ui,pageId:page?.id||null,selectedId,selectedIds:ids,nativeSelection,nativeDraft:page?.id===ui.pageId?ui.nativeDraft:null,nativeTextEditor:page?.id===ui.pageId?ui.nativeTextEditor:null};
  }
  function rebaseHistory(history,oldBase,remote) {
    return (history||[]).flatMap(entry=>{
      const merged=mergeDocuments(oldBase,entry.doc,remote);
      return merged.conflicts.length?[]:[{...entry,doc:merged.doc}];
    });
  }
  function applyExternal(doc,revision) {
    if(pixelHooks?.hasPending()){const c=context(),expected=baseRevision;return pixelHooks.flush().then(async()=>{
      if(!valid(c))return;
      if(expected!==baseRevision){const latest=await request('/designcraft/api/v1/doc'+query(c.root,c.id));if(valid(c))applyExternalReady(latest.doc,latest.revision);}
      else applyExternalReady(doc,revision);
    });}
    return applyExternalReady(doc,revision);
  }
  function nativeWand(doc,id){
    const find=layers=>{for(const layer of layers||[]){if(layer.id===id)return layer;const nested=find(layer.children);if(nested)return nested;}};
    for(const page of doc.pages||[]){const layer=find(page.layers);if(layer?.native?.engine==='photocraft'&&layer.native.hasSelection)return {native:true,layerId:layer.id,bounds:layer.native.selectionBounds};}
    return null;
  }
  function applyExternalReady(doc,revision) {
    if(!doc)return;
    const state=store.get();
    if(doc.id!==state.doc?.id)return;
    if(revision===baseRevision)return;
    const oldBase=baseDoc;
    const merged=state.dirty?mergeDocuments(baseDoc,state.doc,doc):{doc:clone(doc),conflicts:[]};
    if(merged.conflicts.length) {
      store.set({pendingRemote:{doc:clone(doc),revision},conflict:{paths:merged.conflicts,remoteDoc:clone(doc),remoteRevision:revision},saveError:'内容同时被修改，请处理冲突；本地修改仍保留。'});
      rememberDraft().catch(error=>store.set({recoveryError:String(error?.message||error)}));return;
    }
    const dirty=!documentsEqual(merged.doc,doc);
    if(dirty)editVersion++;
    baseDoc=clone(doc);baseRevision=revision;baseGeneration++;
    store.set({doc:merged.doc,revision,dirty,pendingRemote:null,conflict:null,saveError:null,ui:uiFor(merged.doc),wandMask:nativeWand(merged.doc,state.ui?.selectedId)||(state.wandMask?.native?null:state.wandMask),undoStack:rebaseHistory(state.undoStack,oldBase,doc),redoStack:rebaseHistory(state.redoStack,oldBase,doc)});
    if(dirty)scheduleSave();
  }
  async function pushDoc({pixels=true}={}) {
    if(pixels&&pixelHooks)await pixelHooks.flush();
    if(inFlight)return inFlight;
    const state=store.get();if(!state.doc||!state.root||!state.dirty)return;
    if(state.conflict)throw new Error('请先处理编辑冲突；文档未被覆盖。');
    const c=context(),sent=clone(state.doc),sentVersion=editVersion,expected=baseRevision;
    store.set({saving:true,saveError:null});
    const task=(async()=>{
      try {
        await ensureProtocol();
        const result=await request('/designcraft/api/v1/doc',{root:c.root,id:c.id,doc:sent,baseRevision:expected,writer});
        if(!valid(c))return result;
        if(baseRevision!==expected&&baseRevision!==result.revision){store.set({saving:false});return result;}
        baseDoc=sent;baseRevision=result.revision;baseGeneration++;
        const dirty=editVersion!==sentVersion||!!store.get().conflict;
        store.set({revision:baseRevision,dirty,saving:false,saveError:store.get().conflict?store.get().saveError:null});
        if(!dirty)clearDraft(recoveryKey(c.root,c.id),{writer,version:sentVersion}).catch(()=>{});
        return result;
      } catch(error) {
        if(valid(c)) {
          store.set({saving:false,saveError:String(error?.message||error),dirty:true});
          if(error.status===409) {
            const current=error.body?.current;
            if(current?.doc)await applyExternal(current.doc,current.revision);
            else store.set({conflict:{paths:['/'],remoteDoc:null,remoteRevision:null},saveError:'远端文档已删除，本地修改仍保留，可另存。'});
          }
          await rememberDraft();
        }
        throw error;
      }
    })();
    inFlight=task;
    try{return await task;}finally {
      if(inFlight===task)inFlight=null;
      if(valid(c)&&store.get().dirty&&!store.get().conflict&&!store.get().saveError)scheduleSave();
    }
  }
  async function flush({pixels=true}={}) {
    if(pixels&&pixelHooks)await pixelHooks.flush();
    clearTimeout(saveTimer);saveTimer=null;
    for(let attempt=0;attempt<4;attempt++) {
      if(inFlight) {try{await inFlight;}catch(error){if(store.get().conflict||error.status!==409)throw error;}}
      if(!store.get().dirty)return;
      if(store.get().conflict)throw new Error('存在编辑冲突；请先另存本地版本或采用远端版本。');
      try{await pushDoc({pixels});}catch(error){if(store.get().conflict||error.status!==409)throw error;}
    }
    if(store.get().dirty)throw new Error('文档持续变化，尚未保存完成。');
  }
  async function refreshState({autoOpen=true}={}) {
    const root=store.get().root,generation=rootGeneration,ticket=++stateRequest;if(!root)return;
    try {
      const body=await request('/designcraft/api/v1/state'+query(root));
      if(disposed||generation!==rootGeneration||root!==store.get().root||ticket!==stateRequest)return;
      store.set({docs:body.docs||[],assets:body.assets||[],templates:body.templates||[],designSystems:body.designSystems||[],designResources:body.designResources||[],dshToolReady:body.dshToolReady===true,tasks:body.tasks||[],jobs:body.jobs||store.get().jobs||[],stateError:null});
      configureAssets(root,store.get().doc?.id,body.assets||[]);
      const current=store.get();
      if(autoOpen&&!current.doc&&body.docs?.length)await openDoc(body.docs[0].id,{onlyIfEmpty:true,expectedGeneration:documentGeneration,expectedRootGeneration:rootGeneration});
      return body;
    } catch(error) {if(!disposed&&generation===rootGeneration)store.set({stateError:String(error?.message||error)});}
  }
  async function openDoc(id,{onlyIfEmpty=false,expectedGeneration,expectedRootGeneration}={}) {
    await flush();
    if(onlyIfEmpty&&(store.get().doc||documentGeneration!==expectedGeneration||rootGeneration!==expectedRootGeneration))return;
    const root=store.get().root,generation=rootGeneration,ticket=++documentGeneration;
    try {
      const body=await request('/designcraft/api/v1/doc'+query(root,id));
      if(disposed||generation!==rootGeneration||ticket!==documentGeneration)return;
      baseDoc=clone(body.doc);baseRevision=body.revision;baseGeneration++;editVersion=0;
      configureAssets(root,body.doc.id,store.get().assets||[]);
      store.set({doc:body.doc,activeId:id,revision:body.revision,dirty:false,nativeBusy:false,nativeError:null,nativeWarning:null,nativeCandidate:null,renderError:null,saving:false,saveError:null,stateError:null,conflict:null,pendingRemote:null,remoteDeleted:false,undoStack:[],redoStack:[],wandMask:null,uiSelection:null,ui:{...store.get().ui,selectedIds:[],nativeSelection:null,nativeWholeId:null,nativeDraft:null,nativeTextEditor:null,pageId:body.doc.pages?.[0]?.id||null,selectedId:null,editingTextId:null,nativeTargets:{},marquee:null,cropRect:null}});
      try {
        const draft=await readDraft(recoveryKey(root,id));
        if(!draft||disposed||generation!==rootGeneration||ticket!==documentGeneration){if(!disposed&&generation===rootGeneration&&ticket===documentGeneration&&pixelHooks?.hasNativePending()){store.set({recoveryNotice:'正在恢复待处理的原生笔画。'});await pixelHooks.flush();}return body;}
        if(pixelHooks&&draft.pixels?.length)await pixelHooks.restoreDraft(draft.doc,draft.pixels);
        const merged=mergeDocuments(draft.baseDoc,draft.doc,body.doc);
        if(!documentsEqual(merged.doc,body.doc)||merged.conflicts.length) {
          editVersion++;
          store.set({doc:merged.doc,dirty:true,ui:uiFor(merged.doc),recoveryNotice:'已恢复未保存的本地修改。',conflict:merged.conflicts.length?{paths:merged.conflicts,remoteDoc:body.doc,remoteRevision:body.revision}:null});
          if(!merged.conflicts.length)scheduleSave();
        } else clearDraft(recoveryKey(root,id),{at:draft.at}).catch(()=>{});
      } catch(error) {store.set({recoveryError:String(error?.message||error)});}
      if(pixelHooks?.hasNativePending())await pixelHooks.flush();
      return body;
    } catch(error) {if(!disposed&&ticket===documentGeneration)store.set({stateError:'打开文档失败: '+String(error?.message||error)});throw error;}
  }
  async function createDoc(doc) {
    const intended=context();await flush();if(!valid(intended))throw new Error('作品已切换，创建操作未提交');const root=store.get().root,generation=rootGeneration,ticket=documentGeneration;
    const result=await request('/designcraft/api/v1/doc/create',{root,doc});
    if(!disposed&&generation===rootGeneration){await refreshState({autoOpen:false});if(ticket===documentGeneration)await openDoc(result.id);}
    return result;
  }
  async function deleteDoc(id) {
    await flush();const root=store.get().root,generation=rootGeneration;
    const c=context(),version=editVersion;
    const expected=id===c.id?baseRevision:store.get().docs?.find(d=>d.id===id)?.revision;
    const revision=expected||(await request('/designcraft/api/v1/doc'+query(root,id))).revision;
    if(generation!==rootGeneration||version!==editVersion)throw new Error('文档正在变化，已取消删除。');
    await request('/designcraft/api/v1/doc/delete',{root,id,baseRevision:revision});
    if(disposed||generation!==rootGeneration)return;
    if(store.get().activeId===id){documentGeneration++;baseDoc=null;baseRevision=null;baseGeneration++;store.set({doc:null,activeId:null,dirty:false,conflict:null,undoStack:[],redoStack:[]});}
    await refreshState();
  }
  async function readExternal(c){
    const generation=baseGeneration;
    const body=await request('/designcraft/api/v1/doc'+query(c.root,c.id));
    if(valid(c)&&generation===baseGeneration)return applyExternal(body.doc,body.revision);
  }
  async function pollOnce() {
    if(disposed||polling||!store.get().root)return;polling=true;
    const c=context();
    try {
      const body=await refreshState({autoOpen:!c.id});if(!body||!valid(c))return;
      const row=body.docs?.find(d=>d.id===c.id);
      if(row&&row.revision!==baseRevision) {
        await readExternal(c);
      }
      if(!row&&c.id&&store.get().doc)store.set({remoteDeleted:true});
      if(valid(c)&&store.get().sseStatus!=='live')store.set({sseStatus:'polling'});
    }catch(error){if(valid(c))store.set({pollError:String(error?.message||error)});}finally{polling=false;}
  }
  function handleRemoteEvent(payload,root,generation) {
    if(disposed||root!==store.get().root||generation!==rootGeneration)return;
    if(payload.kind==='job') {
      const jobs=(store.get().jobs||[]).filter(job=>job.id!==payload.job.id);
      store.set({jobs:[...jobs,payload.job].slice(-100)});return;
    }
    if(payload.kind==='watcher-error'){store.set({syncWarning:'文件监听异常，已自动使用轮询。'});return;}
    refreshState().catch(()=>{});
    const c=context();
    if(payload.kind==='doc'&&payload.name===c.id&&payload.writer!==writer&&!payload.deleted) {
      readExternal(c).catch(error=>{if(valid(c))store.set({stateError:String(error?.message||error)});});
    }
    if(payload.deleted&&payload.name===c.id)store.set({remoteDeleted:true});
  }
  function connectSse() {
    try{sse?.close();}catch{}clearTimeout(reconnectTimer);clearInterval(pollTimer);
    const root=store.get().root,generation=rootGeneration;if(disposed||!root)return;
    store.set({sseStatus:'connecting'});
    try {
      const connection=new EventSource(api('/designcraft/api/v1/events'+query(root)));sse=connection;
      const current=()=>!disposed&&sse===connection&&root===store.get().root&&generation===rootGeneration;
      connection.addEventListener('open',()=>{if(current())store.set({sseStatus:'live'});});
      connection.addEventListener('event',event=>{if(current()){try{handleRemoteEvent(JSON.parse(event.data),root,generation);}catch{}}});
      connection.addEventListener('error',()=>{if(!current())return;store.set({sseStatus:'offline'});connection.close();reconnectTimer=setTimeout(()=>{if(!disposed&&generation===rootGeneration)connectSse();},5000);});
    }catch{store.set({sseStatus:'polling'});}
    pollTimer=setInterval(()=>pollOnce(),2500);
  }
  async function setRoot(root) {
    await flush();await ensureProtocol();rootGeneration++;documentGeneration++;stateRequest++;
    try{sse?.close();}catch{}clearInterval(pollTimer);clearTimeout(reconnectTimer);
    baseDoc=null;baseRevision=null;baseGeneration++;editVersion=0;
    configureAssets(root,null,[]);
    store.set({root,docs:null,doc:null,activeId:null,revision:null,dirty:false,clipboard:null,nativeBusy:false,nativeError:null,nativeWarning:null,nativeCandidate:null,renderError:null,conflict:null,saveError:null,pendingRemote:null,remoteDeleted:false,undoStack:[],redoStack:[],wandMask:null,uiSelection:null,ui:{...store.get().ui,selectedIds:[],nativeSelection:null,nativeWholeId:null,nativeDraft:null,nativeTextEditor:null,pageId:null,selectedId:null,editingTextId:null,nativeTargets:{}}});
    connectSse();await refreshState();
  }
  async function runCommands(commands,opts={}) {
    const c=context();await flush();if(!valid(c))throw new Error('作品已切换，命令未提交');if(!c.root)throw new Error('未选择工作区');
    const result=await request('/designcraft/api/v1/command',{root:c.root,commands,stopOnError:opts.stopOnError!==false,baseRevisions:c.id?{[c.id]:baseRevision}:{}});
    if(result.ok===false)throw new Error(result.results?.find(r=>!r.ok)?.error||'命令未完成');
    if(valid(c)) {
      await refreshState({autoOpen:false});
      if(c.id)await readExternal(c);
    }
    return result;
  }
  async function nativeOperation(operation,{skipPixels=false,historyBefore}={}){
    const c=context();await flush({pixels:!skipPixels});if(!valid(c))throw new Error('作品已切换，原生操作未提交');const before=clone(historyBefore||store.get().doc),ui={...store.get().ui};
    store.set({nativeBusy:true,nativeError:null,nativeWarning:null,nativeCandidate:null});
    try{
      const result=await request('/designcraft/api/v1/native/operation',{...operation,root:c.root,id:c.id,pageId:operation.pageId||ui.pageId,baseRevision});
      if(valid(c)&&Array.isArray(result.candidate?.warnings)&&result.candidate.warnings.length)store.set({nativeWarning:result.candidate.warnings.join('；')});
      const remote=await request('/designcraft/api/v1/doc'+query(c.root,c.id));
      if(valid(c)){
        const history=store.get().undoStack||[],snapshot=result.doc||remote.doc;
        if(skipPixels)applyExternalReady(remote.doc,remote.revision);else await applyExternal(remote.doc,remote.revision);
        if(ui.nativeSelection&&store.get().ui.nativeSelection===ui.nativeSelection&&!result.candidate.readOnly&&!store.get().conflict){
          const oldLayer=findSelectedLayer(before.pages.find(p=>p.id===ui.pageId)?.layers,ui.nativeSelection.layerId),newLayer=findSelectedLayer(store.get().doc.pages.find(p=>p.id===ui.pageId)?.layers,ui.nativeSelection.layerId),published=findSelectedLayer(snapshot.pages.find(p=>p.id===ui.pageId)?.layers,ui.nativeSelection.layerId);
          if(oldLayer?.native?.source===ui.nativeSelection.source&&newLayer?.native?.source===published?.native?.source){const ids=ui.nativeSelection.ids.filter(id=>nativeNodes(newLayer).some(n=>Number(n.id)===id));store.set({ui:{...store.get().ui,nativeSelection:ids.length?{...ui.nativeSelection,ids,source:newLayer.native.source}:null}});}
        }
        const inverse=mergeDocuments(snapshot,before,store.get().doc);
        if(!result.candidate.readOnly&&operation.operation!=='deck.export'&&!inverse.conflicts.length&&!store.get().conflict)store.set({undoStack:[...rebaseHistory(history,snapshot,remote.doc),{doc:inverse.doc,pageId:ui.pageId,selectedId:ui.selectedId,pixels:[]}].slice(-60),redoStack:[]});

        await refreshState({autoOpen:false});
      }
      return result;
    }catch(error){if(valid(c)){store.set({nativeError:String(error?.message||error),nativeCandidate:error.body?.candidate||null});if(error.body?.current?.doc){if(skipPixels)applyExternalReady(error.body.current.doc,error.body.current.revision);else await applyExternal(error.body.current.doc,error.body.current.revision);}}throw error;}
    finally{if(valid(c))store.set({nativeBusy:false});}
  }
  async function applyDesignResource(resourceId){
    const c=context();await flush();if(!valid(c))throw new Error('作品已切换，样式未提交');
    const before=clone(store.get().doc),ui={...store.get().ui};
    try{
      const result=await request('/designcraft/api/v1/resources/apply',{root:c.root,id:c.id,resourceId,baseRevision});
      const remote=await request('/designcraft/api/v1/doc'+query(c.root,c.id));
      if(valid(c)){
        const history=store.get().undoStack||[],snapshot=result.doc||remote.doc;await applyExternal(remote.doc,remote.revision);const inverse=mergeDocuments(snapshot,before,store.get().doc);
        if(!inverse.conflicts.length&&!store.get().conflict)store.set({undoStack:[...rebaseHistory(history,snapshot,remote.doc),{doc:inverse.doc,pageId:ui.pageId,selectedId:ui.selectedId,pixels:[]}].slice(-60),redoStack:[]});
      }
      return result;
    }catch(error){if(valid(c)){store.set({nativeError:error.message,nativeCandidate:error.body?.candidate||null});if(error.body?.current?.doc)await applyExternal(error.body.current.doc,error.body.current.revision);}throw error;}
  }

  const readDesignResource=(id,file='DESIGN.md')=>request('/designcraft/api/v1/resources/read?id='+encodeURIComponent(id)+'&file='+encodeURIComponent(file));
  async function uploadAsset(file,opts={}) {
    const c=context();
    if(file.size>64*1024*1024)throw new Error('素材超过64MB上传预算');
    const result=await request('/designcraft/api/v1/asset/upload'+query(c.root)+'&name='+encodeURIComponent(file.name||'asset.png'),undefined,{method:'POST',headers:{'content-type':'application/octet-stream'},body:file});
    if(!valid(c))throw new Error('工作区已切换；素材已保存在原工作区。');
    await refreshState({autoOpen:false});return result;
  }
  async function exportClientPdf(pages,out,source={}) {const s=store.get();return request('/designcraft/api/v1/export/client-pdf',{root:source.root||s.root,id:source.id||s.activeId,pages,out});}
  async function useRemoteVersion() {
    const s=store.get(),conflict=s.conflict;if(!conflict)return;
    const c=context(),version=editVersion;
    await saveLocalCopy({open:false});
    if(!valid(c)||version!==editVersion)throw new Error('保存副本期间又发生编辑，当前修改仍保留。');
    clearDraft(recoveryKey(s.root,s.doc.id)).catch(()=>{});
    if(conflict.remoteDoc){baseDoc=clone(conflict.remoteDoc);baseRevision=conflict.remoteRevision;baseGeneration++;store.set({doc:clone(baseDoc),revision:baseRevision,dirty:false,conflict:null,pendingRemote:null,saveError:null,ui:uiFor(baseDoc),undoStack:[],redoStack:[]});}
    else {documentGeneration++;baseDoc=null;baseRevision=null;baseGeneration++;store.set({doc:null,activeId:null,dirty:false,conflict:null,pendingRemote:null,saveError:null});}
  }
  async function saveLocalCopy({open=true}={}) {
    if(pixelHooks)await pixelHooks.flush();
    const s=store.get();if(!s.doc)return;
    const c=context(),version=editVersion;
    const copied={...clone(s.doc),id:'recovered-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),title:(s.doc.title||'作品')+'（本地恢复副本）'};
    const result=await request('/designcraft/api/v1/doc/create',{root:s.root,doc:copied});
    if(open&&valid(c)&&version===editVersion){store.set({dirty:false,conflict:null,pendingRemote:null});await refreshState({autoOpen:false});await openDoc(result.id);}
    else if(open&&valid(c))store.set({recoveryNotice:'副本已保存；保存期间的新修改仍保留在当前作品中。'});
    return result;
  }
  const downloadUrl=(name,root=store.get().root)=>api('/designcraft/api/v1/download'+query(root)+'&name='+encodeURIComponent(name));
  const assetUrl=name=>api('/designcraft/api/v1/asset'+query(store.get().root)+'&name='+encodeURIComponent(String(name).split('/').pop())+'&download=1');
  async function history() {const s=store.get();return request('/designcraft/api/v1/history'+query(s.root,s.activeId));}
  async function restore(revision) {await flush();const s=store.get(),c=context();await request('/designcraft/api/v1/history/restore',{root:s.root,id:s.activeId,revision,baseRevision});const current=await request('/designcraft/api/v1/doc'+query(s.root,s.activeId));if(valid(c))await applyExternal(current.doc,current.revision);}
  function dispose() {
    rememberDraft().catch(()=>{});disposed=true;rootGeneration++;documentGeneration++;
    try{sse?.close();}catch{}for(const timer of [saveTimer,reconnectTimer,recoveryTimer])clearTimeout(timer);clearInterval(pollTimer);
  }
  async function openLinkedMedia(nativeObjectId){const c=context(),pageId=store.get().ui.pageId;await flush();if(!valid(c)||store.get().ui.pageId!==pageId)throw new Error('作品已切换');const ticket={root:c.root,docId:c.id};store.set({mediaBusy:ticket});try{const result=await request('/designcraft/api/v1/media/open',{root:c.root,docId:c.id,pageId,nativeObjectId,baseRevision});if(valid(c)){await openDoc(result.id);store.set({ui:{...store.get().ui,drawer:null}});}await refreshState({autoOpen:false});return result;}finally{if(store.get().mediaBusy===ticket)store.set({mediaBusy:null});}}
  async function commitLinkedMedia(asset,childRevision){const c=context();await flush();if(!valid(c)||baseRevision!==childRevision)throw new Error('源图已修改，请重新应用');const ticket={root:c.root,docId:c.id};store.set({mediaBusy:ticket});try{const result=await request('/designcraft/api/v1/media/commit',{root:c.root,childDocId:c.id,childRevision,asset});if(valid(c)){await openDoc(result.id);store.set({ui:{...store.get().ui,drawer:null}});}await refreshState({autoOpen:false});return result;}finally{if(store.get().mediaBusy===ticket)store.set({mediaBusy:null});}}
  const variantGroups=()=>request('/designcraft/api/v1/variants'+query(store.get().root,store.get().doc?.id));
  const previewUrl=(id,revision)=>api('/designcraft/api/v1/preview'+query(store.get().root,id)+'&v='+encodeURIComponent(revision||''));
  async function forkVariant(label,groupId){const c=context();await flush();if(!valid(c))throw new Error('作品已切换');const result=await request('/designcraft/api/v1/variants/fork',{root:c.root,docId:c.id,baseRevision,groupId,label});await refreshState({autoOpen:false});if(valid(c))await openDoc(result.id);return result;}
  async function adoptVariant(groupId,variantDocId){const c=context();await flush();if(!valid(c))throw new Error('作品已切换');const before=clone(store.get().doc),beforeRevision=baseRevision,ui={...store.get().ui},result=await request('/designcraft/api/v1/variants/adopt',{root:c.root,groupId,variantDocId});if(valid(c)){if(result.id===c.id){await applyExternal(result.doc,result.revision);if(result.previousRevision===beforeRevision){const inverse=mergeDocuments(result.doc,before,store.get().doc);if(!inverse.conflicts.length&&!store.get().conflict)store.set({undoStack:[...(store.get().undoStack||[]),{doc:inverse.doc,pageId:ui.pageId,selectedId:ui.selectedId,selectedIds:ui.selectedIds,nativeSelection:ui.nativeSelection,pixels:[]}].slice(-60),redoStack:[]});}}else await openDoc(result.id);}await refreshState({autoOpen:false});return result;}
  const imageCatalogue=provider=>request('/designcraft/api/v1/image/catalog'+(provider?'?provider='+encodeURIComponent(provider):''));
  const imageTasks=()=>request('/designcraft/api/v1/image/jobs?root='+encodeURIComponent(store.get().root));
  const recoverFalImage=id=>request('/designcraft/api/v1/image/recover-fal',{root:store.get().root,id});
  const convertReturnedImage=(id,outputId)=>request('/designcraft/api/v1/image/convert-returned',{root:store.get().root,id,outputId});
  const cancelRemoteFalImage=id=>request('/designcraft/api/v1/image/cancel-remote-fal',{root:store.get().root,id});
  async function startImage(payload){const c=context(),pageId=store.get().ui.pageId;await flush();if(!valid(c)||store.get().ui.pageId!==pageId)throw new Error('准备图片任务期间作品或画板已切换');const s=store.get();return request('/designcraft/api/v1/image/start',{...payload,root:s.root,docId:s.doc.id,pageId:s.ui.pageId,baseRevision:s.revision});}
  async function adoptImage(id,candidateId,asNew=false){const c=context();await flush();if(!valid(c))throw new Error('采用图片期间作品已切换');const before=clone(store.get().doc),ui={...store.get().ui},result=await request('/designcraft/api/v1/image/adopt',{root:c.root,id,candidateId,asNew,baseRevision});if(!valid(c))return result;await applyExternal(result.doc,result.revision);if(store.get().ui.selectedId===ui.selectedId)store.set({wandMask:null,uiSelection:null,ui:{...store.get().ui,selectedId:result.job.adoptedLayerId,selectedIds:[result.job.adoptedLayerId],nativeSelection:null}});const inverse=mergeDocuments(result.doc,before,store.get().doc);if(!inverse.conflicts.length&&!store.get().conflict)store.set({undoStack:[...(store.get().undoStack||[]),{doc:inverse.doc,pageId:ui.pageId,selectedId:ui.selectedId,selectedIds:ui.selectedIds,nativeSelection:ui.nativeSelection,pixels:[]}].slice(-60),redoStack:[]});await refreshState({autoOpen:false});return result;}
  const cancelJob=id=>request('/designcraft/api/v1/jobs/cancel',{root:store.get().root,id});
  return {openLinkedMedia,commitLinkedMedia,variantGroups,previewUrl,forkVariant,adoptVariant,imageCatalogue,imageTasks,startImage,adoptImage,recoverFalImage,convertReturnedImage,cancelRemoteFalImage,applyDesignResource,readDesignResource,nativeOperation,setPixelHooks,markLocalEdit,scheduleSave,pushDoc,flush,refreshState,openDoc,createDoc,deleteDoc,applyExternal,connectSse,setRoot,runCommands,uploadAsset,exportClientPdf,downloadUrl,assetUrl,useRemoteVersion,saveLocalCopy,history,restore,cancelJob,dispose};
}
