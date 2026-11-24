import {preparePreview, capturePreview, convertPreview, conversionWarnings, hasSupportedTailwindTag} from './html-sandbox.js?v=169';
import {createFigmaMcpPanel} from './figma-mcp-panel.js?v=169';

const TEXT = /^(?:text\/|application\/json|image\/svg\+xml)/;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 24 * 1024 * 1024;
const BLANK = '<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8">\n<title>新网页设计</title>\n<style>body{margin:0;font-family:system-ui,sans-serif}</style>\n</head>\n<body>\n<main></main>\n</body>\n</html>\n';

function toBase64(bytes) {
 let result = '';
 const data = new Uint8Array(bytes);
 for (let offset=0; offset<data.length; offset+=32768) result += String.fromCharCode(...data.subarray(offset, offset+32768));
 return btoa(result);
}
const shaBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
const shaText=text=>shaBytes(new TextEncoder().encode(text));
function asText(file) {
 const binary = atob(file.data), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
 return new TextDecoder('utf-8', {fatal:true}).decode(bytes);
}
function textFile(file) { return TEXT.test(file.mime || '') || /\.(?:html?|css|m?js|json|svg|txt)$/i.test(file.path); }
function fileRecords(files) { return files.map(({path,data}) => ({path,data})); }

export function createHtmlWorkspace(React) {
 const h = React.createElement;
 const FigmaMcpPanel=createFigmaMcpPanel(React);
 return function HtmlWorkspace({controller, onClose}) {
  const [items,setItems] = React.useState([]);
  const [doc,setDoc] = React.useState(null);
  const [file,setFile] = React.useState(null);
  const [text,setText] = React.useState('');
  const [dirty,setDirtyState] = React.useState(false),dirtyRef=React.useRef(false);
  const [pending,setPendingState] = React.useState(null),pendingRef=React.useRef(null);
  const setDirty=value=>{dirtyRef.current=value;setDirtyState(value);};
  const setPending=value=>{pendingRef.current=value;setPendingState(value);};
  const [working,setWorking] = React.useState(false),workingRef=React.useRef(false);
  const [error,setError] = React.useState(null);
  const [notice,setNotice] = React.useState(null);
  const [preview,setPreview] = React.useState(null),[dependencyHints,setDependencyHints]=React.useState(null),[tailwindCompat,setTailwindCompat]=React.useState(false);
  const [previewStale,setPreviewStale] = React.useState(false);
  const [report,setReport] = React.useState(null);
  const [conversions,setConversions] = React.useState([]);
  const [candidates,setCandidates] = React.useState(null);
  const [figmaMcpOpen,setFigmaMcpOpen]=React.useState(false),[externalNative,setExternalNative]=React.useState(null),[externalHtmlScope,setExternalHtmlScope]=React.useState('bundle'),[externalHtmlIncludeLfs,setExternalHtmlIncludeLfs]=React.useState(false),[externalHtmlOmitted,setExternalHtmlOmitted]=React.useState(null);
  const externalHtmlPendingKey='designcraft-external-html:'+controller.view.sessionId+'\0'+controller.view.root;
  const [externalHtmlPending,setExternalHtmlPending]=React.useState(()=>{try{const raw=sessionStorage.getItem(externalHtmlPendingKey);return raw?JSON.parse(raw):null;}catch{return null;}});
  const resourceHtmlPendingKey='designcraft-resource-html:'+controller.view.sessionId+'\0'+controller.view.root;
  const [resourceHtmlPending,setResourceHtmlPending]=React.useState(()=>{try{const raw=sessionStorage.getItem(resourceHtmlPendingKey);return raw?JSON.parse(raw):null;}catch{return null;}});
  const tailwindFreezePendingKey='designcraft-tailwind-freeze:'+controller.view.sessionId+'\0'+controller.view.root;
  const [tailwindFreezePending,setTailwindFreezePending]=React.useState(()=>{try{const raw=sessionStorage.getItem(tailwindFreezePendingKey);return raw?JSON.parse(raw):null;}catch{return null;}});
  const htmlFontPendingKey='designcraft-html-font:'+controller.view.sessionId+'\0'+controller.view.root;
  const [htmlFontPending,setHtmlFontPending]=React.useState(()=>{try{const raw=sessionStorage.getItem(htmlFontPendingKey);return raw?JSON.parse(raw):null;}catch{return null;}});
  const [htmlFontChoice,setHtmlFontChoice]=React.useState(''),[htmlFontFamily,setHtmlFontFamily]=React.useState(''),[htmlFontWeight,setHtmlFontWeight]=React.useState('400'),[htmlFontStyle,setHtmlFontStyle]=React.useState('normal');
  const projectAssetPendingKey='designcraft-html-project-asset:'+controller.view.sessionId+'\0'+controller.view.root;
  const [projectAssetPending,setProjectAssetPending]=React.useState(()=>{try{const raw=sessionStorage.getItem(projectAssetPendingKey);return raw?JSON.parse(raw):null;}catch{return null;}});
  const projectAssetOwner=React.useRef({root:controller.view.root,sessionId:controller.view.sessionId,epoch:controller.view.epoch});
  const [projectAssetOpen,setProjectAssetOpen]=React.useState(false),[projectAssetQuery,setProjectAssetQuery]=React.useState(''),[projectAssets,setProjectAssets]=React.useState(null),[projectAssetChoice,setProjectAssetChoice]=React.useState(''),[projectAssetOps,setProjectAssetOps]=React.useState(null);
  const externalNativePendingKey='designcraft-external-native:'+controller.view.sessionId+'\0'+controller.view.root;
  const [externalNativePending,setExternalNativePending]=React.useState(()=>{try{const raw=sessionStorage.getItem(externalNativePendingKey);return raw?JSON.parse(raw):null;}catch{return null;}});
  const [workflowContext,setWorkflowContext]=React.useState(null);
  const [resourceOpen,setResourceOpen]=React.useState(false),[resourceKind,setResourceKind]=React.useState('design-system'),[resourceQuery,setResourceQuery]=React.useState(''),[resourceResults,setResourceResults]=React.useState(null),[resourcePackage,setResourcePackage]=React.useState(null),[resourceEntry,setResourceEntry]=React.useState(''),[resourceAsset,setResourceAsset]=React.useState(''),[resourceSource,setResourceSource]=React.useState('');
  const [externalInfo,setExternalInfo]=React.useState(null),[externalDiscovery,setExternalDiscovery]=React.useState(null),[externalChoice,setExternalChoice]=React.useState(''),[externalCandidate,setExternalCandidate]=React.useState(null),[externalSaved,setExternalSaved]=React.useState(null),[externalBundle,setExternalBundle]=React.useState(null),[externalFiles,setExternalFiles]=React.useState(null),[externalFile,setExternalFile]=React.useState(''),[externalBusy,setExternalBusy]=React.useState(false),[projectFonts,setProjectFonts]=React.useState(null),[fontPending,setFontPending]=React.useState([]),[fontDisabled,setFontDisabled]=React.useState([]);
  const [externalTheme,setExternalTheme]=React.useState(null);
  const [stitchOpen,setStitchOpen]=React.useState(false),[stitchCatalog,setStitchCatalog]=React.useState(null),[stitchTool,setStitchTool]=React.useState(''),[stitchArgs,setStitchArgs]=React.useState('{}'),[stitchSnapshot,setStitchSnapshot]=React.useState(null),[stitchContent,setStitchContent]=React.useState(null),[stitchCandidates,setStitchCandidates]=React.useState([]),[stitchAssets,setStitchAssets]=React.useState(null),[stitchImageImports,setStitchImageImports]=React.useState(null),[stitchJobs,setStitchJobs]=React.useState(null),[stitchResult,setStitchResult]=React.useState(null),[stitchBusy,setStitchBusy]=React.useState(false);
  const stitchPendingKey='designcraft-stitch-pending:'+controller.view.sessionId+'\0'+controller.view.root;
  const [stitchPending,setStitchPending]=React.useState(()=>{try{const raw=sessionStorage.getItem(stitchPendingKey);return raw?JSON.parse(raw):null;}catch{return null;}});
  const frame = React.useRef(null), imports = React.useRef(null), folder = React.useRef(null), current = React.useRef(null),externalAbort=React.useRef(null),fontInput=React.useRef(null),fontAbort=React.useRef(null),stitchAbort=React.useRef(null);
  const [fontBusy,setFontBusy]=React.useState(false);
  const queue = React.useRef(Promise.resolve()), tokens = React.useRef(new Map()), alive = React.useRef(true);

  const draftKey = id => 'html-source\0' + controller.view.root.replace(/[\\/]+$/, '').toLowerCase() + '\0' + id;
  const setCurrent = value => { current.current = value;setDoc(value); };
  const selectedFile = (value, path) => value?.files.find(item => item.path === path);
  const select = (value, path) => {
   const item = selectedFile(value, path);
   setFile(path);
   if (!item || !textFile(item)) { setText('');return; }
   try { setText(asText(item)); } catch { setText('');setError('此文件不是有效的 UTF-8 文本，可以原样保留或替换。'); }
  };
  const refreshList = async () => { const value=await controller.htmlAction('list');if(alive.current)setItems(value.items); };
  const persist = value => {
   if (!value?.id) return Promise.resolve();
   const key=draftKey(value.id), snapshot={id:value.id,revision:value.revision,title:value.title,entry:value.entry,files:fileRecords(value.files),at:Date.now()};
   const emergency={...snapshot,emergency:true,token:'memory-'+crypto.randomUUID()};controller.htmlEmergencyDrafts||=new Map();controller.htmlEmergencyDrafts.set(key,emergency);
   queue.current=queue.current.catch(()=>{}).then(async()=>{
    const token=crypto.randomUUID(), result=await controller.vault.replace(key,tokens.current.get(key)||null,{...snapshot,token});
    if(!result.applied){if(alive.current){setPending(result.current);setError('发现另一份网页草稿，请先恢复或另存。');}throw new Error('另一份网页草稿已保留');}
    tokens.current.set(key,token);
   });
   const pendingWrite=queue.current;controller.pendingHtmlDrafts||=new Map();controller.pendingHtmlDrafts.set(key,pendingWrite);
   controller.change({htmlDraftPending:true,htmlEmergency:true});
   pendingWrite.then(()=>{if(controller.htmlEmergencyDrafts?.get(key)===emergency)controller.htmlEmergencyDrafts.delete(key);controller.change({htmlDraftError:null,htmlEmergency:!!controller.htmlEmergencyDrafts?.size});},failure=>controller.change({htmlDraftError:failure.message||String(failure)})).finally(()=>{if(controller.pendingHtmlDrafts?.get(key)===pendingWrite)controller.pendingHtmlDrafts.delete(key);controller.change({htmlDraftPending:!!controller.pendingHtmlDrafts?.size});}).catch(()=>{});
   return queue.current;
  };
  const clearDraft = async id => {
   const key=draftKey(id),token=tokens.current.get(key);
   if (!token) return;
   const removed=await controller.vault.replace(key,token,undefined);
   if (removed.applied) tokens.current.delete(key);
  };
  const open = async (id,assertUnchanged) => {
   await queue.current;
   assertUnchanged?.();
   const result=await controller.htmlAction('read',{id});
   assertUnchanged?.();
   const value={...result.document,revision:result.revision};
   setCurrent(value);select(value,value.entry);setDirty(false);setPreview(null);setPreviewStale(false);setReport(null);setCandidates(null);
   setConversions((await controller.htmlAction('conversions',{id})).items);
   const draft=controller.htmlEmergencyDrafts?.get(draftKey(id))||await controller.vault.get(draftKey(id));
   setPending(draft||null);
  };
  const newDocument = async () => {
   await queue.current;
   const result=await controller.htmlAction('create',{title:'未命名网页',entry:'index.html',files:[{path:'index.html',data:toBase64(new TextEncoder().encode(BLANK))}]});
   await refreshList();await open(result.id);
  };
  const nativeAsset=item=>item.fetchable&&(/\.svg$/i.test(item.path)&&item.bytes<=8*1024*1024||/\.(?:png|jpe?g)$/i.test(item.path)&&!!controller.runtime?.engines?.photocraft);
  const searchResources=async(offset=0)=>{const result=await controller.htmlResource('search',{query:resourceQuery,kind:resourceKind,offset});setResourceResults({...result,offset});setResourcePackage(null);setWorkflowContext(null);setResourceEntry('');setResourceAsset('');setExternalInfo(null);setExternalDiscovery(null);setExternalChoice('');setExternalCandidate(null);setExternalSaved(null);setExternalBundle(null);setExternalFiles(null);};
  const openResource=async(id,offset=0)=>{const result=await controller.htmlResource('package',{id,offset});setResourcePackage({...result,offset});setWorkflowContext(null);setResourceEntry(result.files.find(item=>/\.html?$/i.test(item.path)&&item.fetchable)?.path||'');setResourceAsset(result.files.find(nativeAsset)?.path||'');setExternalInfo(null);setExternalDiscovery(null);setExternalChoice('');setExternalCandidate(null);setExternalSaved(null);setExternalBundle(null);setExternalFiles(null);};
  const completeResourceImport=async record=>{const result=await controller.htmlResource('import',record);sessionStorage.removeItem(resourceHtmlPendingKey);setResourceHtmlPending(null);await refreshList();await open(result.id);setResourceOpen(false);setNotice(result.warning+(result.omittedCount?' 未纳入 '+result.omittedCount+' 个文件。':''));};
  const importResource=async()=>{if(resourceHtmlPending)throw new Error('上次固定网页导入尚未确认，请先核对');if(!resourcePackage||!resourceEntry)throw new Error('请选择资源包中的 HTML 文件');const record={id:resourcePackage.id,entry:resourceEntry,operationKey:crypto.randomUUID()};sessionStorage.setItem(resourceHtmlPendingKey,JSON.stringify(record));setResourceHtmlPending(record);await completeResourceImport(record);};
  const checkResourceHtmlPending=async()=>{const result=await controller.htmlResource('resource-html-status',resourceHtmlPending);if(result.found){sessionStorage.removeItem(resourceHtmlPendingKey);setResourceHtmlPending(null);await refreshList();await open(result.id);setResourceOpen(false);}setNotice(result.warning||result.note);};
  const assetScope=()=>{const owner=projectAssetOwner.current;if(controller.view?.root!==owner.root||controller.view?.sessionId!==owner.sessionId||controller.view?.epoch!==owner.epoch)throw new Error('工作区已切换，请回原项目核对网页素材');};
  const searchProjectAssets=async(offset=0)=>{assetScope();const value=await controller.htmlResource('project-assets',{query:projectAssetQuery,offset});assetScope();setProjectAssets(value);setProjectAssetChoice(value.items[0]?.id||'');setNotice(value.note);};
  const listProjectAssetOps=async(offset=0)=>{assetScope();const value=await controller.htmlResource('project-asset-ops',{offset});assetScope();setProjectAssetOps(value);};
  const finishProjectAsset=async(record,value)=>{assetScope();let kept=false;if(value.status==='confirmed'){sessionStorage.removeItem(projectAssetPendingKey);setProjectAssetPending(null);await refreshList();const unchanged=()=>{assetScope();const item=current.current;if(!item||item.id!==record.htmlId||item.revision!==record.revision||(item.editSequence||0)!==record.editSequence||dirtyRef.current||pendingRef.current)throw new Error('当前网页或草稿已改变');};try{unchanged();await open(record.htmlId,unchanged);}catch{kept=true;}}setNotice(value.note+(value.path?' 文件：'+value.path:'')+(kept?' 如界面未更新，请先核对草稿后重新打开网页。':''));};
  const completeProjectAsset=async record=>{assetScope();const value=current.current;if(!value||value.id!==record.htmlId||value.revision!==record.revision||(value.editSequence||0)!==record.editSequence||dirtyRef.current||pendingRef.current)throw new Error('当前网页或草稿已改变，请先核对原操作');const result=await controller.htmlResource('project-asset-apply',record);assetScope();await finishProjectAsset(record,result);};
  const applyProjectAsset=async()=>{assetScope();if(projectAssetPending)throw new Error('上次素材加入尚未确认，请先核对');if(!current.current||!projectAssetChoice)throw new Error('请选择网页和项目素材');await queue.current;assetScope();if(pendingRef.current)throw new Error('请先处理网页草稿');const before=current.current;if(dirtyRef.current){const saved=await save();if(!saved||saved.editSequence!==undefined&&saved.editSequence!==before.editSequence||dirtyRef.current)throw new Error('网页在保存期间改变，请再次保存后加入素材');}assetScope();const value=current.current,operationKey=crypto.randomUUID(),bytes=new TextEncoder().encode(controller.view.sessionId+'\0'+operationKey),digest=await crypto.subtle.digest('SHA-256',bytes);assetScope();const record={id:'htmlassetop-'+[...new Uint8Array(digest)].map(item=>item.toString(16).padStart(2,'0')).join(''),operationKey,htmlId:value.id,revision:value.revision,assetId:projectAssetChoice,editSequence:value.editSequence||0};sessionStorage.setItem(projectAssetPendingKey,JSON.stringify(record));setProjectAssetPending(record);await completeProjectAsset(record);};
  const checkProjectAsset=async id=>{assetScope();const value=await controller.htmlResource('project-asset-status',{id});assetScope();if(projectAssetPending?.id===id)await finishProjectAsset(projectAssetPending,value);else setNotice(value.note+(value.path?' 文件：'+value.path:''));};
  const recoverProjectAsset=async candidate=>{assetScope();const value=await controller.htmlResource('project-asset-recover',{candidate});assetScope();setNotice(value.note||'已核对本地素材预约。');await listProjectAssetOps();};
  const readWorkflow=async(file,offset=0,bundleId)=>{if(!resourcePackage)return;const value=await controller.htmlResource('workflow-context',{id:resourcePackage.id,...(file?{file}:{}),...(bundleId?{bundleId}:{}),offset});setWorkflowContext(value);};
  const retainResource=async()=>{if(!resourcePackage)throw new Error('请选择资源包');const result=await controller.htmlResource('retain-package',{id:resourcePackage.id});setNotice('已保存 '+result.fileCount+' 个原文件至 '+result.asset.path+'。'+result.warning);};
  const useDirector=async()=>{const result=await controller.htmlResource('director-use');setNotice('已将创意指导原包关联到项目。作者：'+result.attribution+'；'+result.note);};
  const stitchCall=async(action,payload={})=>{
   const abort=new AbortController();stitchAbort.current=abort;setStitchBusy(true);
   try{return await controller.htmlResource(action,payload,{signal:abort.signal});}
   catch(error){if(abort.signal.aborted)throw new Error('已停止本地等待；如果已提交远端任务，请先核对任务列表。');throw error;}
   finally{if(stitchAbort.current===abort)stitchAbort.current=null;if(alive.current)setStitchBusy(false);}
  };
  const stitchSelected=stitchCatalog?.items.find(item=>item.name===stitchTool);
  const stitchParameters=()=>{let value;try{value=JSON.parse(stitchArgs);}catch{throw new Error('Stitch 参数需要有效 JSON 对象');}if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Stitch 参数需要 JSON 对象');return value;};
  const stitchCatalogue=async()=>{const result=await stitchCall('stitch-catalog');setStitchCatalog(result);setStitchTool(result.items[0]?.name||'');setStitchArgs('{}');setNotice(result.note);};
  const stitchReadPage=async(id,offset=0)=>{const result=await stitchCall('stitch-snapshot',{snapshotId:id,offset});setStitchContent({...result,offset});};
  const stitchRead=async()=>{
   if(!stitchSelected||stitchSelected.kind!=='read')throw new Error('请选择只读 Stitch 工具');
   setStitchSnapshot(null);setStitchContent(null);setStitchCandidates([]);const result=await stitchCall('stitch-read',{tool:stitchSelected.name,args:stitchParameters(),schemaSha256:stitchSelected.schemaSha256});setStitchSnapshot(result);await stitchReadPage(result.snapshotId);const found=await stitchCall('stitch-candidates',{snapshotId:result.snapshotId});setStitchCandidates(found.items);setNotice(result.note);
  };
  const stitchRefreshAssets=async()=>{const result=await stitchCall('stitch-assets');setStitchAssets(result);setStitchImageImports(await stitchCall('stitch-image-imports'));};
  const stitchCapture=async candidateId=>{if(!stitchSnapshot)throw new Error('请先读取 Stitch 页面');const result=await stitchCall('stitch-capture',{snapshotId:stitchSnapshot.snapshotId,candidateId});setNotice(result.note);await stitchRefreshAssets();};
  const stitchRecoverAsset=async candidate=>{const result=await stitchCall('stitch-recover-asset',{candidate});setNotice(result.note);await stitchRefreshAssets();};
  const stitchOpenHtml=async assetId=>{
   await queue.current;if(pending)throw new Error('请先处理网页草稿');if(dirty){const saved=await save();if(!saved||saved.editSequence!==current.current?.editSequence)throw new Error('网页在保存期间发生修改，请再次保存');}
   const result=await stitchCall('stitch-open-html',{assetId});await refreshList();await open(result.id);setNotice(result.note);
  };
  const stitchReconcileImage=async id=>{const result=await stitchCall('stitch-reconcile-image',{id});setNotice(result.note);setStitchImageImports(await stitchCall('stitch-image-imports'));};
  const stitchRecoverImageOpen=async candidate=>{const result=await stitchCall('stitch-recover-image-open',{candidate});setNotice(result.note);setStitchImageImports(await stitchCall('stitch-image-imports'));};
  const stitchOpenImage=async assetId=>{
   await queue.current;if(pending)throw new Error('请先处理网页草稿');if(dirty){const saved=await save();if(!saved||saved.editSequence!==current.current?.editSequence)throw new Error('网页在保存期间发生修改，请再次保存');}
   await controller.resumeHostMenu();const root=controller.view.root,epoch=controller.view.epoch,headers=controller.sourceHeaders();onClose();await new Promise(resolve=>requestAnimationFrame(resolve));
   try{const response=await fetch('/designcraft/api/v2/studio/html-resource',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'stitch-open-image',epoch,assetId})}),data=await response.json();if(controller.view.root!==root)throw new Error('工作区已切换，请回原项目核对截图导入');if(!response.ok||!data.ok)throw new Error((data.error||'截图导入未确认')+(data.openId?'；导入预约 '+data.openId+' 已保留，请先核对。':'；请在 Stitch 原件列表核对。'));controller.change({imageNotice:data.note||'已核对 Stitch 截图来源。'});}catch(error){controller.change({imageNotice:String(error.message||error)});}
  };
  const stitchRefreshJobs=async()=>{const result=await stitchCall('stitch-jobs');setStitchJobs(result.jobs);};
  const stitchStart=async()=>{
   if(stitchPending)throw new Error('上一 Stitch 请求状态未确认，请先核对');if(!stitchSelected||stitchSelected.kind!=='remote_write')throw new Error('请选择 Stitch 远端设计操作');
   const args=stitchParameters(),operationKey=crypto.randomUUID(),bytes=new TextEncoder().encode(controller.view.sessionId+'\0'+operationKey),digest=await crypto.subtle.digest('SHA-256',bytes),id='stitchjob-'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join(''),saved={id,operationKey};
   sessionStorage.setItem(stitchPendingKey,JSON.stringify(saved));setStitchPending(saved);
   const result=await stitchCall('stitch-start',{tool:stitchSelected.name,args,schemaSha256:stitchSelected.schemaSha256,operationKey});sessionStorage.removeItem(stitchPendingKey);setStitchPending(null);setNotice(result.note||'已核对同一任务，请查看真实状态。');await stitchRefreshJobs();
  };
  const stitchCheckPending=async()=>{const result=await stitchCall('stitch-job',{id:stitchPending.id});sessionStorage.removeItem(stitchPendingKey);setStitchPending(null);setNotice('已找到上次本地任务：'+result.job.status+'。');await stitchRefreshJobs();};
  const stitchReadResult=async(id,offset=0)=>{const result=await stitchCall('stitch-result',{id,offset});setStitchResult({...result,offset});};
  const stitchJobSnapshot=async id=>{setStitchContent(null);setStitchCandidates([]);setStitchSnapshot({snapshotId:id});await stitchReadPage(id);const found=await stitchCall('stitch-candidates',{snapshotId:id});setStitchCandidates(found.items);};
  const stitchRecoverResult=async id=>{const result=await stitchCall('stitch-recover-saved',{id});setNotice(result.note||'已核对保存的结果。');await stitchRefreshJobs();};
  const stitchStopJob=async id=>{const result=await stitchCall('stitch-stop',{id});setNotice(result.stopped?'已请求停止本地等待，远端可能仍在处理。':'此任务当前没有可停止的本地等待。');await stitchRefreshJobs();};
  const importNativeResource=async()=>{
   if(!resourcePackage||!resourceAsset)throw new Error('请选择资源包中的 SVG 或图片');
   const chosen={id:resourcePackage.id,file:resourceAsset,operationId:crypto.randomUUID()};
   await queue.current;if(pending)throw new Error('请先处理网页草稿');
   if(dirty){const saved=await save();if(!saved||saved.editSequence!==current.current?.editSequence)throw new Error('网页在保存期间发生修改，请再次保存');}
   await controller.resumeHostMenu();onClose();
   await controller.openOpenDesignResource(chosen);
  };
  const openFigmaMcpImage=async assetId=>{
   await queue.current;if(pending)throw new Error('请先处理网页草稿');if(dirty){const saved=await save();if(!saved||saved.editSequence!==current.current?.editSequence)throw new Error('网页在保存期间发生修改，请再次保存');}
   await controller.resumeHostMenu();const root=controller.view.root,epoch=controller.view.epoch,headers=controller.sourceHeaders();onClose();await new Promise(resolve=>requestAnimationFrame(resolve));
   try{const response=await fetch('/designcraft/api/v2/studio/figma-mcp',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'open',epoch,assetId})}),data=await response.json();if(controller.view.root!==root)throw new Error('工作区已切换，请回原项目核对导入');if(!response.ok||!data.ok)throw new Error((data.error||'图片导入未确认')+(data.openId?'；导入预约 '+data.openId+' 已保留，请先核对。':''));controller.change({imageNotice:data.note||'已核对 Figma MCP 图片来源。'});}catch(error){controller.change({imageNotice:String(error.message||error)});}
  };
  const openFigmaMcpFile=async assetId=>{
   await queue.current;if(pending)throw new Error('请先处理网页草稿');if(dirty){const saved=await save();if(!saved||saved.editSequence!==current.current?.editSequence)throw new Error('网页在保存期间发生修改，请再次保存');}
   await controller.resumeHostMenu();const root=controller.view.root,epoch=controller.view.epoch,headers=controller.sourceHeaders();onClose();await new Promise(resolve=>requestAnimationFrame(resolve));
   try{const response=await fetch('/designcraft/api/v2/studio/figma-mcp',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'file-native-open',epoch,assetId})}),data=await response.json();if(controller.view.root!==root)throw new Error('工作区已切换，请回原项目核对素材导入');if(!response.ok||!data.ok)throw new Error((data.error||'素材导入未确认')+(data.openId?'；导入预约 '+data.openId+' 已保留，请先核对。':'；请在 Figma 素材列表核对。'));controller.change({imageNotice:data.note||'已核对 Figma 素材来源。'});}catch(error){controller.change({imageNotice:String(error.message||error)});}
  };
  const reconcileNativeResource=async()=>{
   if(!resourcePackage||!resourceAsset)throw new Error('请选择要核对的 SVG 或图片');
   const result=await controller.htmlResource('native-reconcile',{id:resourcePackage.id,file:resourceAsset,...(resourceSource?{sourceId:resourceSource}:{})});
   setNotice(result.scope==='saved-source'?'已核对选中作品，找到 '+result.links.length+' 条已保存来源；未检查旧操作日志。':'已核对 '+result.links.length+' 条已保存来源；'+result.pending.length+' 条仍需确认。'+(result.pending.some(item=>item.status==='source_unproven')?'部分旧记录缺少精确来源身份，未自动关联。':''));
  };
  const externalAction=async(action,{offset=0}={})=>{
   if(!resourcePackage)throw new Error('请选择技能目录项');
   const controllerAbort=new AbortController();externalAbort.current=controllerAbort;setExternalBusy(true);
   try{
    const chosen=externalChoice?JSON.parse(externalChoice):undefined;
    if(action==='external-candidate'&&(!externalDiscovery||chosen===undefined))throw new Error('请先选择真实技能目录');
    if(action==='external-inspect'&&externalDiscovery&&chosen===undefined)throw new Error('请先选择真实技能目录');
    const payload={id:resourcePackage.id,...(action==='external-fetch'?{revision:externalInfo?.revision,subdir:externalInfo?.subdir}:{}),...(action==='external-discover'?{offset,...(offset&&externalDiscovery?{revision:externalDiscovery.revision}:{})}:{}),...(['external-candidate','external-inspect'].includes(action)&&externalDiscovery&&chosen!==undefined?{revision:externalDiscovery.revision,subdir:chosen,offset}:{})};
    const result=await controller.htmlResource(action,payload,{signal:controllerAbort.signal});
    if(action==='external-discover'){
     const first=result.items.find(item=>item.declaredByCatalogue)||(result.items.length===1?result.items[0]:null);
     setExternalDiscovery({...result,offset});setExternalChoice(first?JSON.stringify(first.subdir):'');setExternalCandidate(null);setExternalInfo(null);setExternalBundle(null);setExternalFiles(null);
    }
    else if(action==='external-candidate')setExternalCandidate({...result,offset});
    else if(action==='external-inspect'){setExternalInfo(result);setExternalBundle(null);setExternalFiles(null);}
    else{setExternalBundle(result.bundle);setExternalFiles(null);setNotice('已保存外部原包 '+result.fileCount+' 个文件。'+result.warning);}
   }catch(error){if(controllerAbort.signal.aborted)throw new Error(action==='external-fetch'?'已请求停止；若原包已经保存，请先在项目中核对，不要重复获取。':'已停止读取外部资料，未采用不完整内容。');throw error;}
   finally{if(externalAbort.current===controllerAbort)externalAbort.current=null;if(alive.current)setExternalBusy(false);}
  };
  const listExternalFiles=async offset=>{
   if(!externalBundle)throw new Error('请先保存外部原包');
   const result=await controller.htmlResource('external-files',{bundleId:externalBundle.id,offset});
   setExternalFiles({...result,offset});setExternalFile(result.items[0]?.path||'');
  };
  const listSavedExternal=async()=>{if(!resourcePackage)throw new Error('请选择技能目录项');const result=await controller.htmlResource('external-list',{id:resourcePackage.id});setExternalSaved(result.items);};
  const openSavedExternal=async bundleId=>{const result=await controller.htmlResource('external-files',{bundleId,offset:0});setExternalBundle(result.bundle);setExternalFiles({...result,offset:0});setExternalFile(result.items[0]?.path||'');};
  const inspectExternalTheme=async()=>{
   if(externalBundle?.odId!=='skills/theme-factory'||!externalFile)throw new Error('请先选择 theme-factory 原包中的主题文件');
   const result=await controller.htmlResource('external-theme',{bundleId:externalBundle.id,file:externalFile});
   if(result.bundleId!==externalBundle.id||result.file!==externalFile||!Array.isArray(result.colors)||!result.colors.length||result.colors.some(item=>!/^#[a-f0-9]{6}$/i.test(item.hex||''))||typeof result.fonts?.heading!=='string'||typeof result.fonts?.body!=='string')throw new Error('主题来源或配色结果无效，请读取原文');
   if(alive.current)setExternalTheme(result);
  };
  const retainExternalFile=async()=>{
   if(!externalBundle||!externalFile)throw new Error('请选择外部原包文件');
   const selected=externalFiles?.items.find(item=>item.path===externalFile);if(!selected)throw new Error('所选文件不在当前原包列表中，请重新选择');
   const result=await controller.htmlResource(selected.lfs?'external-lfs':'external-materialize',{bundleId:externalBundle.id,file:externalFile});
   if(!result.file||result.file.bundleId!==externalBundle.id||result.file.file!==externalFile||!/^(?:externalfile|externallfs)-[a-f0-9]{64}$/.test(result.file.id||'')||!/^[a-f0-9]{64}$/.test(result.file.sha256||'')||!Number.isSafeInteger(result.file.bytes)||result.file.bytes<1||result.file.bytes>16*1024*1024)throw new Error('外部原件来源回执未确认，请先核对项目记录');
   if(alive.current)setNotice('已保存原文件至 '+result.asset.path+'。'+result.note);return result;
  };
  const downloadExternalFile=async()=>{
   const owner=controller.view,epoch=owner?.epoch,filename=externalFile;if(!owner||!epoch)throw new Error('请先打开项目工作区');
   const currentScope=()=>{const scope=controller.getScope?.(),normal=value=>String(value||'').replace(/[\\/]+$/,'').toLowerCase();if(!alive.current||controller.view!==owner||controller.view.epoch!==epoch||scope?.sessionId!==owner.sessionId||normal(scope?.root)!==normal(owner.root))throw new Error('工作区已切换，未下载其他项目的文件');};
   const saved=await retainExternalFile();currentScope();const abort=new AbortController();externalAbort.current=abort;
   try{
    const query=new URLSearchParams({epoch,id:saved.file.id}),response=await fetch('/designcraft/api/v2/studio/html-external-file?'+query,{headers:controller.sourceHeaders(),signal:abort.signal});
    if(!response.ok){let message='外部原文件读取失败';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}
    if(response.headers.get('x-source-id')!==saved.file.id||response.headers.get('x-content-sha256')!==saved.file.sha256||Number(response.headers.get('content-length'))!==saved.file.bytes)throw new Error('下载回执与已保存原件不一致');
    const bytes=await response.arrayBuffer();if(bytes.byteLength!==saved.file.bytes||await shaBytes(bytes)!==saved.file.sha256)throw new Error('下载字节与已保存原件摘要不一致');
    currentScope();let name=filename.split('/').at(-1).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,180)||'external-file';if(/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    setNotice('已请求浏览器下载原文件；实际落盘需在浏览器中确认。单独分享请保留适用许可与署名。');
   }finally{if(externalAbort.current===abort)externalAbort.current=null;}
  };
  const importExternalHtml=async()=>{
   if(externalHtmlPending)throw new Error('上次外部网页导入尚未确认，请先核对');if(!externalBundle||!externalFile||!/\.html?$/i.test(externalFile))throw new Error('请选择外部原包中的 HTML 文件');await queue.current;if(pending)throw new Error('请先处理网页草稿');if(dirty){const value=await save();if(!value||value.editSequence!==current.current?.editSequence)throw new Error('网页在保存期间发生修改，请再次保存');}
   const record={operationKey:crypto.randomUUID(),bundleId:externalBundle.id,entry:externalFile,scope:externalHtmlScope,includeLfs:externalHtmlIncludeLfs};sessionStorage.setItem(externalHtmlPendingKey,JSON.stringify(record));setExternalHtmlPending(record);const result=await controller.htmlResource('external-html-import',record);sessionStorage.removeItem(externalHtmlPendingKey);setExternalHtmlPending(null);setExternalHtmlOmitted({items:result.omitted||[],count:result.omittedCount});await refreshList();await open(result.id);setNotice(result.note+' 未纳入文件 '+result.omittedCount+' 个。');
  };
  const checkExternalHtmlPending=async()=>{const result=await controller.htmlResource('external-html-status',externalHtmlPending);if(result.found){sessionStorage.removeItem(externalHtmlPendingKey);setExternalHtmlPending(null);setExternalHtmlOmitted({items:result.omitted||[],count:result.omittedCount});await refreshList();await open(result.id);}setNotice(result.note);};
  const listExternalNative=async()=>{const result=await controller.htmlResource('external-native-list');setExternalNative(result);setNotice(result.note);};
  const reconcileExternalNative=async id=>{const result=await controller.htmlResource('external-native-reconcile',{id});setNotice(result.note||'已核对外部导入记录。');await listExternalNative();};
  const recoverExternalNative=async candidate=>{const result=await controller.htmlResource('external-native-recover',{candidate});setNotice(result.note);await listExternalNative();};
  const checkExternalNativePending=async()=>{const result=await controller.htmlResource('external-native-reconcile',{id:externalNativePending.id});setNotice(result.note);if(result.status==='confirmed'){sessionStorage.removeItem(externalNativePendingKey);setExternalNativePending(null);}await listExternalNative();};
  const openExternalNative=async()=>{
   if(externalNativePending)throw new Error('上次外部导入尚未确认，请先核对');if(!externalBundle||!externalFile)throw new Error('请选择外部原包文件');const kind=/\.svg$/i.test(externalFile)?'svg':/\.(?:png|jpe?g)$/i.test(externalFile)?'image':/\.(?:pptx|potx|ppsx)$/i.test(externalFile)?'deck':null;if(!kind)throw new Error('仅支持 SVG、PNG/JPEG 或 PPTX/POTX/PPSX 原件');if(kind==='deck'&&!controller.runtime?.engines?.deckcraft)throw new Error('演示持续编辑桥尚未开启，原件仍可保留');await queue.current;if(pending)throw new Error('请先处理网页草稿');if(dirty){const value=await save();if(!value||value.editSequence!==current.current?.editSequence)throw new Error('网页在保存期间发生修改，请再次保存');}
   const selected=externalFiles?.items.find(item=>item.path===externalFile),saved=await controller.htmlResource(selected?.lfs?'external-lfs':'external-materialize',{bundleId:externalBundle.id,file:externalFile});if(!saved.file?.id)throw new Error('外部文件来源尚未确认，请先核对');await controller.resumeHostMenu();const root=controller.view.root,epoch=controller.view.epoch,headers=controller.sourceHeaders(),operationKey=crypto.randomUUID(),hashText=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(value=>value.toString(16).padStart(2,'0')).join(''),operationId='external-native-'+await hashText(controller.view.sessionId+'\0'+operationKey),openId='externalopen-'+await hashText(JSON.stringify([saved.file.id,operationId,kind])),pendingRecord={id:openId,resourceId:saved.file.id,kind,operationKey};sessionStorage.setItem(externalNativePendingKey,JSON.stringify(pendingRecord));setExternalNativePending(pendingRecord);onClose();await new Promise(resolve=>requestAnimationFrame(resolve));
   try{const response=await fetch('/designcraft/api/v2/studio/html-resource',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'external-native-open',epoch,id:saved.file.id,kind,operationKey})}),data=await response.json();if(controller.view.root!==root)throw new Error('工作区已切换，请回原项目核对外部导入');if(!response.ok||!data.ok)throw new Error((data.error||'外部导入结果未确认')+(data.openId?'；预约 '+data.openId+' 已保留，请先核对。':'；可在外部导入记录中核对。'));if(data.status==='confirmed')sessionStorage.removeItem(externalNativePendingKey);controller.change({imageNotice:data.note||'已核对外部原件及原生关联。'});}catch(error){controller.change({imageNotice:String(error.message||error)});}
  };
  const useExternalFont=async()=>{
   if(!externalBundle||!/\.(?:ttf|otf)$/i.test(externalFile))throw new Error('请选择原包中的 TTF 或 OTF 字体');
   const result=await controller.htmlResource('external-font',{bundleId:externalBundle.id,file:externalFile});
   try{
    const applied=await controller.refreshProjectFonts();
    setNotice('已登记项目字体。'+(applied.deferred?'编辑器空闲并重新打开时加载。':applied.failed.length?'部分字体未加载：'+applied.failed.join('；'):'当前编辑器已处理 '+applied.loaded+' 个项目字体。')+result.note);
   }catch(error){setNotice('项目字体已登记，当前编辑器尚未确认加载：'+String(error.message||error)+'。'+result.note);}
   if(projectFonts)try{await listProjectFonts();}catch{setProjectFonts(null);}
  };
  const listProjectFonts=async()=>{const result=await controller.htmlResource('font-list');if(!Array.isArray(result.items)||!Array.isArray(result.pending)||!Array.isArray(result.disabled))throw new Error('项目字体列表不完整');setProjectFonts(result.items);setHtmlFontChoice(value=>result.items.some(item=>item.id===value)?value:(result.items[0]?.id||''));setFontPending(result.pending);setFontDisabled(result.disabled);};
  const disableProjectFont=async fontId=>{const result=await controller.htmlResource('font-disable',{fontId});try{await listProjectFonts();}catch{setProjectFonts(null);setNotice(result.note+' 字体列表未刷新，请重新查看。');return;}setNotice(result.note);};
  const recoverProjectFont=async name=>{const result=await controller.htmlResource('font-recover',{name});try{await listProjectFonts();}catch{setProjectFonts(null);setNotice(result.note+' 字体列表未刷新，请重新查看。');return;}setNotice(result.note);};
  const enableProjectFont=async name=>{const result=await controller.htmlResource('font-enable',{name});try{await listProjectFonts();}catch{setProjectFonts(null);setNotice(result.note+' 字体列表未刷新，请重新查看。');return;}setNotice(result.note);};
  const quarantineFont=async name=>{const result=await controller.htmlResource('font-quarantine',{name});try{await listProjectFonts();}catch{setProjectFonts(null);setNotice(result.note+' 字体列表未刷新，请重新查看。');return;}setNotice(result.note);};
  const importUserFont=async event=>{
   const input=event.target,chosen=input.files?.[0];input.value='';if(!chosen)return;
   const abort=new AbortController();fontAbort.current=abort;setFontBusy(true);
   try{
    const result=await controller.uploadProjectFont(chosen,{signal:abort.signal});
    try{const applied=await controller.refreshProjectFonts();setNotice('已登记用户提供的项目字体。'+(applied.deferred?'重新打开编辑器后加载。':applied.failed.length?'部分字体未加载：'+applied.failed.join('；'):'当前编辑器已处理 '+applied.loaded+' 个项目字体。')+result.note);}
    catch(error){setNotice('用户字体已登记，当前编辑器尚未确认加载：'+String(error.message||error)+'。'+result.note);}
    if(projectFonts)try{await listProjectFonts();}catch{setProjectFonts(null);}
   }finally{if(fontAbort.current===abort)fontAbort.current=null;if(alive.current)setFontBusy(false);}
  };
  const restore = async asCopy => {
   if (!pending) return;
   const saved=current.current;
   if (asCopy) {
    const result=await controller.htmlAction('create',{title:pending.title+' · 草稿副本',entry:pending.entry,files:pending.files,provenance:{source:'recovered-html-draft',fromId:pending.id,baseRevision:pending.revision}});
    const key=draftKey(pending.id);if(pending.emergency)controller.htmlEmergencyDrafts?.delete(key);else await controller.vault.replace(key,pending.token,undefined);tokens.current.delete(key);controller.change({htmlEmergency:!!controller.htmlEmergencyDrafts?.size,htmlDraftError:null});
    setPending(null);await refreshList();await open(result.id);return;
   }
   if (!saved || pending.revision!==saved.revision) throw new Error('网页已保存了新版本，请把草稿另存为独立网页。');
   if(!pending.emergency)tokens.current.set(draftKey(saved.id),pending.token);
   const value={...saved,title:pending.title,entry:pending.entry,files:pending.files};
   setCurrent(value);select(value,value.entry);setDirty(true);setPreviewStale(true);if(pending.emergency)await persist(value);setPending(null);
  };
  const change = (nextText) => {
   if (!current.current || !file) return;
   const value={...current.current,files:current.current.files.map(item=>item.path===file?{...item,data:toBase64(new TextEncoder().encode(nextText))}:item),editSequence:(current.current.editSequence||0)+1};
   setText(nextText);setCurrent(value);setDirty(true);setPreviewStale(true);persist(value).catch(err=>alive.current&&setError(err.message));
  };
  const save = async () => {
   await queue.current;
   const value=current.current;
   if (!value) throw new Error('请先选择网页作品');
   if (!dirtyRef.current) return value;
   const saved=await controller.htmlAction('save',{id:value.id,baseRevision:value.revision,title:value.title,entry:value.entry,files:fileRecords(value.files)});
   const latest=current.current;
   if(latest.editSequence!==value.editSequence){
    const revised={...latest,revision:saved.revision};setCurrent(revised);setDirty(true);await persist(revised);
   }else{
    await clearDraft(value.id);const revised={...saved.document,revision:saved.revision};setCurrent(revised);setDirty(false);
   }
   await refreshList();return current.current;
  };
  const run = fn => async (...args) => {
   if (workingRef.current) return;
   workingRef.current=true;setWorking(true);setError(null);
   try { await fn(...args); }
   catch (failure) { if(alive.current)setError(failure.message || String(failure)); }
   finally { workingRef.current=false;if(alive.current)setWorking(false); }
  };
  const inspectDependencies=async()=>{const value=current.current;if(!value?.id||!value.revision)throw new Error('请先选择已保存网页');const result=await controller.htmlAction('dependencies',{id:value.id,revision:value.revision});if(!alive.current||current.current?.id!==value.id||current.current?.revision!==value.revision)throw new Error('网页版本已切换，请重新检查');setDependencyHints(result);};
  const makePreview = async value => {
   const entry=selectedFile(value,value.entry);
   if(!entry)throw new Error('网页入口文件不存在');
   const html=asText(entry);if(tailwindCompat&&!hasSupportedTailwindTag(html))throw new Error('网页入口缺少唯一受支持的 Tailwind CDN 标签，未下载兼容脚本');
   const result=await controller.htmlAction('preview',{entry:value.entry,files:fileRecords(value.files),...(tailwindCompat?{tailwindCompat:true}:{})});
   if(!!result.tailwindPath!==tailwindCompat)throw new Error('Tailwind 预览资源状态不一致，未打开预览');
   const prefix=new URL('/designcraft/html-content/'+result.token+'/',document.baseURI).href;
   const ready=await preparePreview(frame.current,{html,token:result.token,resourcePrefix:prefix,entry:value.entry,tailwindPath:result.tailwindPath,tailwindSha256:result.tailwindSha256});
   const next={...ready,resourcePrefix:prefix,entry:value.entry,revision:value.revision,editSequence:value.editSequence||0,expiresAt:Date.now()+result.expiresInMs};
   setPreview(next);setPreviewStale(false);if(ready.tailwindUsed)setNotice('已请求固定版本的 Tailwind 兼容预览；样式、字体和视觉效果仍需核对。');return next;
  };
  const freezeCurrent=record=>{assetScope();const value=current.current;if(!value||value.id!==record.id||value.revision!==record.revision||(value.editSequence||0)!==record.editSequence||dirtyRef.current||pendingRef.current)throw new Error('网页或草稿已改变，请先核对原操作');return value;};
  const finishTailwindFreeze=async(record,result)=>{
   assetScope();if(!result.found){setNotice(result.note);return;}if(result.id!==record.id||result.cssSha256!==record.cssSha256)throw new Error('已保存样式与待核对操作不一致');
   sessionStorage.removeItem(tailwindFreezePendingKey);setTailwindFreezePending(null);let kept=false;await refreshList();
   try{const unchanged=()=>freezeCurrent(record);unchanged();await open(record.id,unchanged);}catch{kept=true;}
   setNotice(result.note+' 样式文件：'+result.cssPath+(kept?'；当前编辑内容已保留，请核对后重新打开网页。':''));
  };
  const completeTailwindFreeze=async(record,captured,active)=>{
   let value=freezeCurrent(record),ready=active,snapshot=captured;
   if(!ready||!ready.tailwindUsed||ready.revision!==record.revision||(!active&&previewStale)||ready.expiresAt<=Date.now()+5000){if(!tailwindCompat)throw new Error('请先启用 Tailwind 兼容预览');ready=await makePreview(value);snapshot=undefined;freezeCurrent(record);}
   snapshot ||= await capturePreview(frame.current,ready.nonce);if(typeof snapshot.tailwindCss!=='string')throw new Error('预览没有可保存的唯一 Tailwind 样式');
   if(await shaText(snapshot.tailwindCss)!==record.cssSha256)throw new Error('预览样式已改变，不能用原操作身份保存');freezeCurrent(record);
   const result=await controller.htmlAction('tailwind-freeze',{id:record.id,revision:record.revision,operationKey:record.operationKey,cssSha256:record.cssSha256,css:snapshot.tailwindCss},{previewToken:ready.resourceToken});
   await finishTailwindFreeze(record,result);
  };
  const freezeTailwind=async()=>{
   if(tailwindFreezePending)throw new Error('上次样式保存尚未核对');if(!tailwindCompat)throw new Error('请先启用 Tailwind 兼容预览');assetScope();await queue.current;if(pendingRef.current)throw new Error('请先处理网页草稿');
   const saved=await save();assetScope();if(!saved||dirtyRef.current||(saved.editSequence||0)!==(current.current?.editSequence||0))throw new Error('网页在保存期间改变，请再次保存');
   let ready=preview;if(!ready||!ready.tailwindUsed||previewStale||ready.revision!==saved.revision||ready.expiresAt<=Date.now()+5000)ready=await makePreview(saved);
   const snapshot=await capturePreview(frame.current,ready.nonce);if(typeof snapshot.tailwindCss!=='string')throw new Error('预览没有可保存的唯一 Tailwind 样式');
   const value=current.current,record={id:saved.id,revision:saved.revision,editSequence:value.editSequence||0,cssSha256:await shaText(snapshot.tailwindCss),operationKey:crypto.randomUUID()};freezeCurrent(record);
   sessionStorage.setItem(tailwindFreezePendingKey,JSON.stringify(record));setTailwindFreezePending(record);await completeTailwindFreeze(record,snapshot,ready);
  };
  const checkTailwindFreeze=async()=>{const record=tailwindFreezePending;if(!record)throw new Error('没有待核对的样式保存');const result=await controller.htmlAction('tailwind-freeze-status',{id:record.id,revision:record.revision,cssSha256:record.cssSha256,operationKey:record.operationKey});await finishTailwindFreeze(record,result);};
  const htmlFontCurrent=record=>{assetScope();const value=current.current;if(!value||value.id!==record.id||value.revision!==record.revision||(value.editSequence||0)!==record.editSequence||dirtyRef.current||pendingRef.current)throw new Error('网页或草稿已改变，请先核对原操作');return value;};
  const finishHtmlFont=async(record,result)=>{
   assetScope();if(!result.found){setNotice(result.note);return;}if(result.id!==record.id||result.fontId!==record.fontId||result.family!==record.family||result.weight!==record.weight||result.style!==record.style)throw new Error('已保存字体与待核对操作不一致');
   sessionStorage.removeItem(htmlFontPendingKey);setHtmlFontPending(null);let kept=false;await refreshList();
   try{const unchanged=()=>htmlFontCurrent(record);unchanged();await open(record.id,unchanged);}catch{kept=true;}
   setNotice(result.note+' 样式文件：'+result.cssPath+(result.link?' 可在入口中加入：'+result.link:'')+(kept?'；当前编辑内容已保留，请核对后重新打开网页。':''));
  };
  const completeHtmlFont=async record=>{htmlFontCurrent(record);const {id,revision,operationKey,fontId,family,weight,style}=record;const result=await controller.htmlAction('project-font-attach',{id,revision,operationKey,fontId,family,weight,style});await finishHtmlFont(record,result);};
  const attachHtmlFont=async()=>{
   if(htmlFontPending)throw new Error('上次网页字体加入尚未核对');if(!htmlFontChoice||!htmlFontFamily.trim())throw new Error('请选择项目字体并填写 CSS 字体族名称');
   const weight=Number(htmlFontWeight);if(!Number.isInteger(weight)||weight<1||weight>1000)throw new Error('字体字重应为 1 至 1000 的整数');
   assetScope();await queue.current;if(pendingRef.current)throw new Error('请先处理网页草稿');const saved=await save();assetScope();if(!saved||dirtyRef.current||(saved.editSequence||0)!==(current.current?.editSequence||0))throw new Error('网页在保存期间改变，请再次保存');
   const record={id:saved.id,revision:saved.revision,editSequence:current.current.editSequence||0,operationKey:crypto.randomUUID(),fontId:htmlFontChoice,family:htmlFontFamily.trim(),weight,style:htmlFontStyle};htmlFontCurrent(record);
   sessionStorage.setItem(htmlFontPendingKey,JSON.stringify(record));setHtmlFontPending(record);await completeHtmlFont(record);
  };
  const checkHtmlFont=async()=>{const record=htmlFontPending;if(!record)throw new Error('没有待核对的网页字体');const {id,revision,operationKey,fontId,family,weight,style}=record;const result=await controller.htmlAction('project-font-status',{id,revision,operationKey,fontId,family,weight,style});await finishHtmlFont(record,result);};
  const importFiles = async event => {
   const selected=[...event.target.files];event.target.value='';
   if(!selected.length)return;
   if(selected.length>256||selected.some(item=>item.size>MAX_FILE)||selected.reduce((sum,item)=>sum+item.size,0)>MAX_TOTAL)throw new Error('网页文件超过 256 个、单个 8 MiB 或总计 24 MiB');
   const common=selected.every(item=>item.webkitRelativePath&&item.webkitRelativePath.includes('/'))?selected[0].webkitRelativePath.split('/')[0]+'/':'';
   const incoming=[];
   for(const item of selected){const path=item.webkitRelativePath?.startsWith(common)?item.webkitRelativePath.slice(common.length):item.name;incoming.push({path,data:toBase64(await item.arrayBuffer())});}
   const entry=incoming.find(item=>/\.html?$/i.test(item.path));
   if(!entry&&!current.current)throw new Error('请选择一个 HTML 文件作为入口');
   if(!current.current){
    const created=await controller.htmlAction('create',{title:entry.path.split('/').pop().replace(/\.html?$/i,''),entry:entry.path,files:incoming,provenance:{source:'user-import'}});
    await refreshList();await open(created.id);return;
   }
   const changed=new Map(incoming.map(item=>[item.path,item]));
   const value={...current.current,files:[...current.current.files.filter(item=>!changed.has(item.path)),...incoming],editSequence:(current.current.editSequence||0)+1};
   setCurrent(value);setDirty(true);setPreviewStale(true);await persist(value);
   if(file&&changed.has(file))select(value,file);
  };
  const setEntry = async () => {
   const value=current.current;
   if(!value||!file||!value.files.some(item=>item.path===file)||!/\.html?$/i.test(file))throw new Error('请选择网页中的 HTML 文件');
   if(file===value.entry)return;
   const next={...value,entry:file,editSequence:(value.editSequence||0)+1};
   setCurrent(next);setDirty(true);setPreviewStale(true);await persist(next);
  };
  const exportHtml = async () => {
   const saved=await save(),blob=await controller.htmlArchive(saved.id,saved.revision);
   const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=(saved.title||'网页设计')+'.zip';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
  };
  const convert = async () => {
   const saved=await save();
   if(!saved||saved.editSequence!==current.current?.editSequence)throw new Error('网页在保存期间发生修改，请再次保存');
   let active=preview;
   if(!active||previewStale||active.revision!==saved.revision||active.expiresAt<=Date.now()+5000)active=await makePreview(saved);
   const captured=await capturePreview(frame.current,active.nonce),snapshot=active.tailwindUsed?{...captured,warnings:[...captured.warnings,'本次使用临时 Tailwind 兼容预览；生成样式、字体和转换外观仍需核对。']}:captured,converter=await controller.htmlConverter();
   const result=await convertPreview({html:snapshot.html,resourcePrefix:active.resourcePrefix,entry:saved.entry,converter,converterOrigin:controller.runtime.origin});
   const staged=await controller.stageHtmlConversion(saved.id,saved.revision,result.bytes,undefined,active.tailwindUsed?active.resourceToken:undefined);
   setConversions((await controller.htmlAction('conversions',{id:saved.id})).items);
   const originalRoot=controller.view.root;
   await controller.resumeHostMenu();
   const title=(saved.title||'网页演示').replace(/[<>:"/\\|?*\0]/g,'_');
   await controller.importFile(new File([result.bytes],title+'.pptx',{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}));
   if(controller.view.root!==originalRoot)throw new Error('工作区已切换，转换文件保留在原网页');
   const link=await controller.htmlAction('link-conversion',{id:saved.id,revision:saved.revision,sha256:staged.sha256,sourceId:controller.view.sourceId});
   const summary={...staged.report,source:result.summary,warnings:[...conversionWarnings(snapshot,result.summary,staged.report),...(staged.compatibilityConflict?['相同转换结果已有不同来源回执，本次来源信息未覆盖原记录。']:[])]};
   controller.change({htmlConversionReport:summary});setReport(summary);setNotice('已打开独立的可编辑演示；原网页保留在项目中。');
   onClose();return link;
  };
  const reopenConversion = async (item, selected) => {
   const root=controller.view.root;
   const found=selected?[selected]:(await controller.htmlAction('conversion-candidates',{id:doc.id,revision:item.sourceRevision,sha256:item.sha256})).items;
   if(found.length>1&&!selected){setCandidates({item,items:found});return;}
   let bytes;
   if(!found.length)bytes=await controller.savedHtmlConversion(doc.id,item.sourceRevision,item.sha256);
   await controller.resumeHostMenu();
   if(found.length)await controller.run('open',{sourceId:found[0].sourceId});
   else await controller.importFile(new File([bytes],(doc.title||'网页演示')+'.pptx',{type:'application/vnd.openxmlformats-officedocument.presentationml.presentation'}));
   if(controller.view.root!==root)throw new Error('工作区已切换，原网页转换结果仍已保留');
   await controller.htmlAction('link-conversion',{id:doc.id,revision:item.sourceRevision,sha256:item.sha256,sourceId:controller.view.sourceId});
   controller.change({htmlConversionReport:item.report});onClose();
  };

  React.useEffect(()=>{folder.current?.setAttribute('webkitdirectory','');},[]);
  React.useEffect(()=>{alive.current=true;refreshList().catch(err=>alive.current&&setError(err.message));return()=>{alive.current=false;externalAbort.current?.abort();fontAbort.current?.abort();stitchAbort.current?.abort();};},[controller.view?.root]);
  React.useEffect(()=>{if(!stitchOpen||!stitchJobs?.some(job=>['queued','running'].includes(job.status)))return;let active=true;const timer=setInterval(()=>controller.htmlResource('stitch-jobs').then(result=>{if(active&&alive.current)setStitchJobs(result.jobs);}).catch(()=>{}),5000);return()=>{active=false;clearInterval(timer);};},[stitchOpen,!!stitchJobs?.some(job=>['queued','running'].includes(job.status))]);
  React.useEffect(()=>{controller.change({htmlDirty:dirty});return()=>{controller.change({htmlDirty:false});};},[dirty]);
  React.useEffect(()=>{if(doc&&!pending&&frame.current)makePreview(doc).catch(err=>alive.current&&setError(err.message));},[doc?.id, pending?.token]);
  const documentFile=selectedFile(doc,file);
  const stitchPanel=!stitchOpen?null:h('div',{className:'dcHtmlResource'},
   h('div',{className:'dcBrandControls'},h('strong',null,'Google Stitch'),
    h('button',{className:'dcBtn',disabled:working,onClick:run(stitchCatalogue)},'读取实际工具目录'),
    h('button',{className:'dcBtn',disabled:working,onClick:run(stitchRefreshAssets)},'查看已保存原件'),
    h('button',{className:'dcBtn',disabled:working,onClick:run(stitchRefreshJobs)},'查看 Stitch 任务'),
    stitchBusy?h('button',{className:'dcBtn',onClick:()=>stitchAbort.current?.abort()},'停止本地等待'):null),
   stitchPending?h('div',{className:'dcNativeNotice',role:'status'},h('span',null,'上次 Stitch 请求状态尚未确认，请先核对。'),h('button',{className:'dcBtn',disabled:working,onClick:run(stitchCheckPending)},'核对上次任务'),h('button',{className:'dcBtn',disabled:working,title:'远端可能仍在处理，再次提交可能产生费用',onClick:()=>{sessionStorage.removeItem(stitchPendingKey);setStitchPending(null);setNotice('已停止等待上次请求；远端可能仍在处理，请先核对。');}},'不再等待')):null,
   stitchCatalog?h('div',{className:'dcBrandControls'},
    h('select',{'aria-label':'Stitch 工具',disabled:working,value:stitchTool,onChange:event=>{setStitchTool(event.target.value);setStitchArgs('{}');setStitchSnapshot(null);setStitchContent(null);setStitchCandidates([]);}},...stitchCatalog.items.map(item=>h('option',{key:item.name,value:item.name},item.name+(item.kind==='read'?' · 只读':' · 远端操作')))),
    stitchSelected?h('details',null,h('summary',null,'查看参数说明'+(stitchSelected.redacted?'（已脱敏）':'')),h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:180,overflow:'auto'}},JSON.stringify(stitchSelected.inputSchema,null,2).slice(0,20000)),JSON.stringify(stitchSelected.inputSchema).length>20000?h('small',null,'参数说明较长，此处仅显示前 20000 个字符。'):null):null,
    h('textarea',{className:'dcInput','aria-label':'Stitch 参数 JSON',value:stitchArgs,disabled:working,onChange:event=>setStitchArgs(event.target.value)}),
    stitchSelected?.kind==='read'?h('button',{className:'dcBtn',disabled:working,onClick:run(stitchRead)},'读取 Stitch 数据'):null,
    stitchSelected?.kind==='remote_write'?h('button',{className:'dcBtn dcPrimary',disabled:working||!!stitchPending,onClick:run(stitchStart)},'提交远端设计操作'):null,
    stitchSelected?.kind==='remote_write'?h('small',null,'此操作会修改远端项目，服务可能计费；中断后不会自动重发。'):null):null,
   stitchContent?h('div',null,h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}},stitchContent.content),stitchContent.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchReadPage(stitchContent.snapshotId,stitchContent.nextOffset))},'继续读取快照'):null):null,
   stitchCandidates.length?h('div',{className:'dcBrandControls'},...stitchCandidates.map(item=>h('button',{className:'dcBtn',key:item.candidateId,disabled:working,onClick:run(()=>stitchCapture(item.candidateId))},'保存 '+(item.kind==='html'?'网页原件':'截图原件')+' · '+item.path.join('/')))):null,
   stitchAssets?h('div',{className:'dcBrandControls'},...(stitchAssets.items.length?stitchAssets.items.map(item=>h('span',{key:item.id},item.format+' · '+item.assetName,item.format==='html'?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchOpenHtml(item.id))},'作为网页打开'):null,['png','jpg'].includes(item.format)?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchOpenImage(item.id))},'作为图片打开'):null)):['项目中没有已保存的 Stitch 原件。']),...(stitchAssets.pending||[]).map(item=>h('span',{key:item.candidate},item.recoverable?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchRecoverAsset(item.candidate))},'恢复原件来源'):('原件临时记录未完成：'+item.error))),...(stitchImageImports?.items||[]).filter(item=>!item.linkRecorded).map(item=>h('button',{className:'dcBtn',key:item.openId,disabled:working,onClick:run(()=>stitchReconcileImage(item.openId))},'核对未确认截图导入')),...(stitchImageImports?.pending||[]).map(item=>item.structureComplete&&item.kind==='stitch-image-open'?h('button',{className:'dcBtn',key:item.candidate,disabled:working,onClick:run(()=>stitchRecoverImageOpen(item.candidate))},'恢复截图导入预约'):h('span',{key:item.candidate},item.structureComplete?'截图关联临时记录保留；可核对对应预约。':'截图导入临时记录不完整，已保留。'))):null,
   stitchJobs?h('div',{className:'dcBrandControls'},...(stitchJobs.length?stitchJobs.map(job=>h('div',{key:job.id},h('span',null,job.tool+' · '+(job.status==='responded'?'服务已返回，需查看结果':job.status)+(job.error?' · '+job.error:'')),job.resultAsset?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchReadResult(job.id))},'读取已保存结果'):null,job.snapshotId?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchJobSnapshot(job.snapshotId))},'查看临时快照'):null,!['queued','running','responded'].includes(job.status)?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchRecoverResult(job.id))},'核对已保存结果'):null,['queued','running'].includes(job.status)?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchStopJob(job.id))},'停止本地等待'):null)):[h('span',{key:'empty'},'项目中没有 Stitch 任务。')])):null,
   stitchResult?h('div',null,h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}},stitchResult.content),stitchResult.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>stitchReadResult(stitchResult.id,stitchResult.nextOffset))},'继续读取结果'):null):null);
  return h('section',{className:'dcHtmlWorkspace',role:'region','aria-label':'网页设计'},
   h('header',{className:'dcHtmlHeader'},h('strong',null,'网页设计'),
    h('select',{'aria-label':'网页作品',value:doc?.id||'',disabled:working,onChange:run(event=>open(event.target.value))},
     h('option',{value:'',disabled:true},'选择网页作品'),...items.map(item=>h('option',{key:item.id,value:item.id,disabled:!!item.error},item.title||item.id))),
    h('button',{className:'dcBtn',disabled:working,onClick:run(newDocument)},'新建网页'),
    h('button',{className:'dcBtn',disabled:working,onClick:()=>imports.current?.click()},doc?'添加文件':'导入网页文件'),
    h('button',{className:'dcBtn',disabled:working,onClick:()=>folder.current?.click()},'导入网页文件夹'),
    h('button',{className:'dcBtn',disabled:working,onClick:()=>setProjectAssetOpen(!projectAssetOpen)},'项目素材'),
    h('button',{className:'dcBtn',disabled:working,onClick:()=>{setResourceOpen(!resourceOpen);setResourcePackage(null);}},'OpenDesign 资源'),
    h('details',{style:{position:'relative'}},h('summary',{className:'dcBtn','aria-label':'更多网页服务'},'更多服务'),
     h('div',{className:'dcBrandControls',style:{position:'absolute',right:0,top:'100%',width:260,zIndex:12,padding:10,background:'var(--dc-surface)',border:'1px solid var(--dc-line)',borderRadius:8}},
      h('button',{className:'dcBtn',disabled:working,onClick:()=>setStitchOpen(!stitchOpen)},'Stitch 设计'),
      h('button',{className:'dcBtn',disabled:working,onClick:()=>setFigmaMcpOpen(!figmaMcpOpen)},'Figma MCP'))),
    h('input',{ref:imports,type:'file',multiple:true,style:{display:'none'},onChange:run(importFiles)}),
    h('input',{ref:folder,type:'file',multiple:true,style:{display:'none'},onChange:run(importFiles)}),
    h('button',{className:'dcBtn dcPrimary',disabled:working||!doc||!dirty||!!pending,onClick:run(save)},dirty?'保存网页':'已保存'),
    h('button',{className:'dcBtn',disabled:working||!doc||!!pending,onClick:run(exportHtml)},'导出网页 ZIP'),
    h('button',{className:'dcBtn',disabled:working||!doc||!!pending,onClick:run(convert)},'转为可编辑演示'),
    h('button',{className:'dcBtn',disabled:working,onClick:run(async()=>{await queue.current;onClose();})},'返回设计')),
   error?h('div',{className:'dcNativeNotice',role:'alert'},error):null,
   controller.state.htmlDraftError&&doc?h('div',{className:'dcNativeNotice',role:'alert'},h('span',null,'网页草稿未能写入本地存储，请保留此窗口。'),h('button',{className:'dcBtn',disabled:working,onClick:run(()=>persist(current.current))},'重试保存草稿')):null,
   notice?h('div',{className:'dcNativeNotice',role:'status'},notice):null,
   tailwindFreezePending?h('div',{className:'dcNativeNotice'},h('span',null,'上次静态样式保存尚未确认。'),h('button',{className:'dcBtn',disabled:working,onClick:run(checkTailwindFreeze)},'核对样式保存'),h('button',{className:'dcBtn',disabled:working,onClick:run(()=>completeTailwindFreeze(tailwindFreezePending))},'继续同一操作'),h('button',{className:'dcBtn',disabled:working,onClick:()=>{sessionStorage.removeItem(tailwindFreezePendingKey);setTailwindFreezePending(null);setNotice('已停止等待；网页版本可能已保存，请先核对。');}},'不再等待')):null,
   htmlFontPending?h('div',{className:'dcNativeNotice'},h('span',null,'上次网页字体加入尚未确认。'),h('button',{className:'dcBtn',disabled:working,onClick:run(checkHtmlFont)},'核对字体加入'),h('button',{className:'dcBtn',disabled:working,onClick:run(()=>completeHtmlFont(htmlFontPending))},'继续同一操作'),h('button',{className:'dcBtn',disabled:working,onClick:()=>{sessionStorage.removeItem(htmlFontPendingKey);setHtmlFontPending(null);setNotice('已停止等待；网页版本可能已保存，请先核对。');}},'不再等待')):null,
   projectAssetPending?h('div',{className:'dcNativeNotice'},h('span',null,'上次网页素材加入尚未确认。'),h('button',{className:'dcBtn',disabled:working,onClick:run(()=>checkProjectAsset(projectAssetPending.id))},'核对素材加入'),h('button',{className:'dcBtn',disabled:working,onClick:run(()=>completeProjectAsset(projectAssetPending))},'继续同一操作'),h('button',{className:'dcBtn',disabled:working,onClick:()=>{sessionStorage.removeItem(projectAssetPendingKey);setProjectAssetPending(null);setNotice('已停止等待，请先查看素材操作记录。');}},'不再等待')):null,
   projectAssetOpen?h('div',{className:'dcHtmlResource'},h('div',{className:'dcBrandControls'},h('strong',null,'当前项目素材'),h('input',{className:'dcInput','aria-label':'搜索项目素材',placeholder:'搜索项目素材',value:projectAssetQuery,disabled:working,onChange:event=>{setProjectAssetQuery(event.target.value);setProjectAssets(null);setProjectAssetChoice('');}}),h('button',{className:'dcBtn',disabled:working,onClick:run(()=>searchProjectAssets())},'搜索'),h('button',{className:'dcBtn',disabled:working,onClick:run(()=>listProjectAssetOps())},'查看加入记录'),h('small',null,'仅使用当前项目的 PNG/SVG 派生物；加入文件不会自动修改网页正文。')),
    projectAssets?h('div',{className:'dcBrandControls'},h('select',{'aria-label':'选择项目素材',value:projectAssetChoice,disabled:working,onChange:event=>setProjectAssetChoice(event.target.value)},h('option',{value:''},'选择素材'),...projectAssets.items.map(item=>h('option',{key:item.id,value:item.id},(item.title||item.id)+' · '+item.format+' · '+item.bytes+' 字节'))),projectAssets.offset>0?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>searchProjectAssets(Math.max(0,projectAssets.offset-30)))},'上一组'):null,projectAssets.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>searchProjectAssets(projectAssets.nextOffset))},'下一组'):null,h('button',{className:'dcBtn dcPrimary',disabled:working||!doc||!projectAssetChoice||!!projectAssetPending,onClick:run(applyProjectAsset)},'加入当前网页')):null,
    projectAssetOps?h('div',{className:'dcBrandControls'},...(projectAssetOps.items.length?projectAssetOps.items.map(item=>h('button',{className:'dcBtn',key:item.reservation.id,disabled:working,onClick:run(()=>checkProjectAsset(item.reservation.id))},'核对 '+item.reservation.id.slice(-12))):[h('span',{key:'none'},'没有素材加入记录。')]),projectAssetOps.offset>0?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>listProjectAssetOps(Math.max(0,projectAssetOps.offset-30)))},'上一组记录'):null,projectAssetOps.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>listProjectAssetOps(projectAssetOps.nextOffset))},'下一组记录'):null,...(projectAssetOps.pending||[]).map(candidate=>h('button',{className:'dcBtn',key:candidate,disabled:working,onClick:run(()=>recoverProjectAsset(candidate))},'核对素材候选'))):null):null,
   stitchPanel,
   figmaMcpOpen?h(FigmaMcpPanel,{controller,onOpenImage:openFigmaMcpImage,onOpenFile:openFigmaMcpFile,htmlSource:doc&&!dirty&&!pending?{id:doc.id,revision:doc.revision}:null}):null,
   resourceOpen?h('div',{className:'dcHtmlResource'},h('div',{className:'dcBrandControls'},
    h('select',{'aria-label':'资源类型',value:resourceKind,disabled:working,onChange:e=>setResourceKind(e.target.value)},h('option',{value:'design-system'},'设计系统'),h('option',{value:'design-template'},'设计模板'),h('option',{value:'skill'},'技能'),h('option',{value:'official-plugin'},'官方资源包'),h('option',{value:'community-plugin'},'社区资源包'),h('option',{value:'prompt-collection'},'提示词集合'),h('option',{value:'support-resource'},'辅助资源')),
    h('input',{className:'dcInput',style:{width:180},placeholder:'搜索资源','aria-label':'搜索 OpenDesign 资源',value:resourceQuery,disabled:working,onChange:e=>setResourceQuery(e.target.value)}),
    h('button',{className:'dcBtn',disabled:working,onClick:run(()=>searchResources(0))},'搜索'),
    h('button',{className:'dcBtn',disabled:working,onClick:run(listProjectFonts)},'查看项目字体'),
    h('input',{ref:fontInput,type:'file',accept:'.ttf,.otf',style:{display:'none'},onChange:run(importUserFont)}),
    h('button',{className:'dcBtn',disabled:working,onClick:()=>fontInput.current?.click()},'导入自己的字体'),
    fontBusy?h('button',{className:'dcBtn',onClick:()=>fontAbort.current?.abort()},'停止字体导入'):null),
    projectFonts?h('div',{className:'dcBrandControls'},projectFonts.length?projectFonts.map(item=>h('button',{className:'dcBtn',key:item.id,disabled:working,onClick:run(()=>disableProjectFont(item.id)),title:'保留源文件；重新打开编辑器后停用'},'停用 '+item.file.split('/').pop())):h('span',null,'项目中没有已登记字体。')):null,
    projectFonts?.length?h('div',{className:'dcBrandControls'},
     h('select',{'aria-label':'加入网页的项目字体',value:htmlFontChoice,disabled:working,onChange:event=>setHtmlFontChoice(event.target.value)},...projectFonts.map(item=>h('option',{key:item.id,value:item.id},item.file.split('/').pop()))),
     h('input',{className:'dcInput','aria-label':'CSS 字体族名称',placeholder:'CSS 字体族名称',value:htmlFontFamily,disabled:working,onChange:event=>setHtmlFontFamily(event.target.value)}),
     h('input',{className:'dcInput',type:'number',min:1,max:1000,style:{width:78},'aria-label':'字体字重',value:htmlFontWeight,disabled:working,onChange:event=>setHtmlFontWeight(event.target.value)}),
     h('select',{'aria-label':'字体样式',value:htmlFontStyle,disabled:working,onChange:event=>setHtmlFontStyle(event.target.value)},h('option',{value:'normal'},'常规'),h('option',{value:'italic'},'斜体'),h('option',{value:'oblique'},'倾斜')),
     h('button',{className:'dcBtn',disabled:working||!doc||!!pending||!!htmlFontPending,onClick:run(attachHtmlFont)},'加入当前网页'),h('small',null,'生成字体文件和 CSS；需在网页中引用。许可及显示效果需核对。')):null,
    projectFonts&&fontDisabled.length?h('div',{className:'dcBrandControls'},...fontDisabled.map(item=>h('button',{className:'dcBtn',key:item.fontId,disabled:working,onClick:run(()=>enableProjectFont(item.name)),title:'保留停用记录；重新打开编辑器后加载'},'重新启用 '+item.file.split('/').pop()))):null,
    projectFonts&&fontPending.length?h('div',{className:'dcBrandControls'},...fontPending.map(item=>item.recoverable?h('button',{className:'dcBtn',key:item.name,disabled:working,onClick:run(()=>recoverProjectFont(item.name))},(item.redundant?'归档字体临时记录 ':'恢复未发布字体 ')+item.file.split('/').pop()):h('span',{key:item.name},'字体临时记录 '+item.name+' 不完整，已保留：'+item.error,item.name.includes('.tmp-')?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>quarantineFont(item.name))},'保留并移出待恢复'):null))):null,
    resourceHtmlPending?h('div',{className:'dcNativeNotice'},h('span',null,'上次固定网页导入状态尚未确认。'),h('button',{className:'dcBtn',disabled:working,onClick:run(checkResourceHtmlPending)},'核对上次网页'),h('button',{className:'dcBtn',disabled:working,onClick:run(()=>completeResourceImport(resourceHtmlPending))},'继续同一导入'),h('button',{className:'dcBtn',disabled:working,title:'网页可能已经保存，请先核对再创建其他副本',onClick:()=>{sessionStorage.removeItem(resourceHtmlPendingKey);setResourceHtmlPending(null);setNotice('已停止等待；请先查看网页列表。');}},'不再等待')):null,
    resourceResults?h('div',{className:'dcNativeWorksList'},...resourceResults.items.map(item=>h('button',{className:'dcNativeMenuItem',key:item.id,disabled:working,onClick:run(()=>openResource(item.id))},item.name))):null,
    resourceResults?h('div',{className:'dcBrandControls'},h('span',null,'共 '+resourceResults.total+' 项'),resourceResults.offset>0?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>searchResources(Math.max(0,resourceResults.offset-20)))},'上一页'):null,resourceResults.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>searchResources(resourceResults.nextOffset))},'下一页'):null):null,
    resourcePackage?h('div',{className:'dcBrandControls'},h('strong',null,resourcePackage.name),h('select',{'aria-label':'HTML 入口文件',value:resourceEntry,disabled:working,onChange:e=>setResourceEntry(e.target.value)},h('option',{value:''},'选择 HTML 文件'),...resourcePackage.files.filter(item=>/\.html?$/i.test(item.path)&&item.fetchable).map(item=>h('option',{key:item.path,value:item.path},item.path))),
     resourcePackage.offset>0?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>openResource(resourcePackage.id,Math.max(0,resourcePackage.offset-50)))},'上一组文件'):null,
     resourcePackage.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>openResource(resourcePackage.id,resourcePackage.nextOffset))},'下一组文件'):null,
     h('button',{className:'dcBtn dcPrimary',disabled:working||!resourceEntry||!!resourceHtmlPending,onClick:run(importResource)},'导入为网页源'),
     h('select',{'aria-label':'原生素材文件',value:resourceAsset,disabled:working,onChange:e=>setResourceAsset(e.target.value)},h('option',{value:''},'选择 SVG 或图片'),...resourcePackage.files.filter(nativeAsset).map(item=>h('option',{key:item.path,value:item.path},item.path))),
     h('button',{className:'dcBtn',disabled:working||!resourceAsset,onClick:run(importNativeResource)},'导入原生编辑器'),
     h('select',{'aria-label':'资源核对范围',value:resourceSource,disabled:working,onChange:e=>setResourceSource(e.target.value)},h('option',{value:''},'核对整个项目'),...(controller.state.sources||[]).filter(item=>!item.error).map(item=>h('option',{key:item.id,value:item.id},item.title||item.id))),
     h('button',{className:'dcBtn',disabled:working||!resourceAsset,onClick:run(reconcileNativeResource)},'核对已保存导入'),
     h('button',{className:'dcBtn',disabled:working,onClick:run(retainResource)},'保存 OpenDesign 原包'),
     resourcePackage.id==='skills/creative-director'?h('button',{className:'dcBtn',disabled:working,onClick:run(useDirector)},'关联创意指导上游完整包'):null,
     resourcePackage.kind==='skill'?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>readWorkflow())},'读取工作流规则与依赖'):null,
     resourcePackage.kind==='skill'&&externalBundle?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>readWorkflow(undefined,0,externalBundle.id))},'读取已保存原包规则'):null,
     resourcePackage.kind==='skill'?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>externalAction('external-discover'))},'查找外部技能目录'):null,
     externalDiscovery?h('span',null,'固定提交 '+externalDiscovery.revision.slice(0,12)+' · 真实入口 '+externalDiscovery.total+' 个。'+externalDiscovery.note):null,
     externalDiscovery?h('select',{'aria-label':'外部技能目录',value:externalChoice,disabled:working,onChange:e=>{setExternalChoice(e.target.value);setExternalCandidate(null);setExternalInfo(null);}},h('option',{value:''},'选择技能目录'),...externalDiscovery.items.map(item=>h('option',{key:item.file,value:JSON.stringify(item.subdir)},(item.subdir||'仓库根目录')+(item.declaredByCatalogue?' · 目录项指定':item.exactDirectoryName?' · 名称相同':'')))):null,
     externalDiscovery&&externalDiscovery.offset>0?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>externalAction('external-discover',{offset:Math.max(0,externalDiscovery.offset-50)}))},'上一组技能目录'):null,
     externalDiscovery?.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>externalAction('external-discover',{offset:externalDiscovery.nextOffset}))},'下一组技能目录'):null,
     externalDiscovery?h('button',{className:'dcBtn',disabled:working||!externalChoice,onClick:run(()=>externalAction('external-candidate'))},'读取所选原规则'):null,
     externalCandidate?h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:180,overflow:'auto',width:'100%'}},externalCandidate.content):null,
     externalCandidate?.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>externalAction('external-candidate',{offset:externalCandidate.nextOffset}))},'继续读取原规则'):null,
     resourcePackage.kind==='skill'?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>externalAction('external-inspect'))},'检查外部原包'):null,
     resourcePackage.kind==='skill'?h('button',{className:'dcBtn',disabled:working,onClick:run(listSavedExternal)},'查看项目已保存原包'):null,
     externalSaved?externalSaved.length?externalSaved.map(item=>h('button',{className:'dcBtn',key:item.id,disabled:working||!!item.error,onClick:run(()=>openSavedExternal(item.id))},item.error?'原包记录不可用':(item.repository+(item.resolvedRepository?' → '+item.resolvedRepository:'')+' · '+item.revision.slice(0,12)+' · 待核对'))):h('span',null,'项目中没有该技能的已保存原包。'):null,
     externalInfo?h('span',null,externalInfo.repository+' · '+externalInfo.revision.slice(0,12)+' · 识别到 '+externalInfo.license+' 许可文件 · '+externalInfo.fileCount+' 个文件。'+externalInfo.note):null,
     externalInfo?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>externalAction('external-fetch'))},'保存该版本外部原包'):null,
     externalBundle?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>listExternalFiles(0))},'查看原包文件'):null,
     externalFiles?h('select',{'aria-label':'外部原包文件',value:externalFile,disabled:working,onChange:e=>setExternalFile(e.target.value)},...externalFiles.items.map(item=>h('option',{key:item.path,value:item.path},item.path+(item.lfs?' · LFS 指针，实际文件 '+item.lfs.size+' 字节':'')))):null,
     externalFiles&&externalFiles.offset>0?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>listExternalFiles(Math.max(0,externalFiles.offset-100)))},'上一组外部文件'):null,
     externalFiles?.nextOffset!=null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>listExternalFiles(externalFiles.nextOffset))},'下一组外部文件'):null,
     externalFiles?h('button',{className:'dcBtn',disabled:working||!externalFile,onClick:run(retainExternalFile)},externalFiles.items.find(item=>item.path===externalFile)?.lfs?'获取并校验 LFS 实际文件':'保存所选原文件'):null,
     externalFiles?h('button',{className:'dcBtn',disabled:working||!externalFile,onClick:run(downloadExternalFile),title:'下载前核对原包、文件身份与摘要；LFS 实际文件可能需要联网'},'下载所选原文件'):null,
     externalBundle?.odId==='skills/theme-factory'&&/^skills\/theme-factory\/themes\/[a-z0-9][a-z0-9-]{0,79}\.md$/.test(externalFile)?h('button',{className:'dcBtn',disabled:working,onClick:run(inspectExternalTheme)},'读取主题配色与字体'):null,
     externalTheme&&externalTheme.bundleId===externalBundle?.id&&externalTheme.file===externalFile?h('div',{className:'dcBrandCard'},h('strong',null,externalTheme.title),h('div',{className:'dcBrandControls'},...externalTheme.colors.map(item=>h('span',{key:item.name},h('i',{style:{display:'inline-block',width:12,height:12,marginRight:4,background:item.hex},'aria-hidden':'true'}),item.name+' · '+item.hex+' · '+item.description))),h('small',null,'标题字体：'+externalTheme.fonts.heading+'；正文字体：'+externalTheme.fonts.body+'。'+externalTheme.note)):null,
     externalFiles&&/\.(?:svg|png|jpe?g|pptx|potx|ppsx)$/i.test(externalFile)?h('button',{className:'dcBtn',disabled:working||!!externalNativePending,onClick:run(openExternalNative)},/\.(?:pptx|potx|ppsx)$/i.test(externalFile)?'打开为原生演示':'打开为原生设计'):null,
     externalFiles&&/\.html?$/i.test(externalFile)?h('select',{'aria-label':'外部网页导入范围',value:externalHtmlScope,disabled:working,onChange:event=>setExternalHtmlScope(event.target.value)},h('option',{value:'bundle'},'整个已保存原包'),h('option',{value:'entry-directory'},'仅入口所在目录')):null,
     externalFiles&&/\.html?$/i.test(externalFile)?h('label',null,h('input',{type:'checkbox',checked:externalHtmlIncludeLfs,disabled:working,onChange:event=>setExternalHtmlIncludeLfs(event.target.checked)}),'获取范围内 LFS 实际文件（可能联网）'):null,
     externalFiles&&/\.html?$/i.test(externalFile)?h('button',{className:'dcBtn',disabled:working||!!externalHtmlPending,onClick:run(importExternalHtml)},'作为网页设计打开'):null,
     externalHtmlOmitted?.count?h('details',null,h('summary',null,'查看未纳入文件（'+externalHtmlOmitted.count+'）'),h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:180,overflow:'auto'}},externalHtmlOmitted.items.map(item=>item.path+' · '+({outside_scope:'不在所选范围',lfs_pointer:'LFS 实际文件未纳入',lfs_empty:'LFS 实际文件为空或无效',nonportable:'文件名不受支持',unsupported_mode:'文件类型不支持',file_budget:'单文件过大',duplicate_path:'路径冲突'}[item.reason]||item.reason)).join('\n')+(externalHtmlOmitted.items.length<externalHtmlOmitted.count?'\n仅显示部分记录。':''))):null,
     externalHtmlPending?h('div',{className:'dcNativeNotice'},h('span',null,'上次外部网页导入状态尚未确认。'),h('button',{className:'dcBtn',disabled:working,onClick:run(checkExternalHtmlPending)},'核对上次网页'),h('button',{className:'dcBtn',disabled:working,title:'网页可能已经保存，重复导入会创建副本',onClick:()=>{sessionStorage.removeItem(externalHtmlPendingKey);setExternalHtmlPending(null);setNotice('已停止等待；请先查看网页列表，避免重复导入。');}},'不再等待')):null,
     externalNativePending?h('div',{className:'dcNativeNotice'},h('span',null,'上次外部导入状态尚未确认。'),h('button',{className:'dcBtn',disabled:working,onClick:run(checkExternalNativePending)},'核对上次导入'),h('button',{className:'dcBtn',disabled:working,title:'原生导入可能已经完成，再次打开可能创建副本',onClick:()=>{sessionStorage.removeItem(externalNativePendingKey);setExternalNativePending(null);setNotice('已停止等待；请先查看已有作品，避免重复导入。');}},'不再等待')):null,
     resourcePackage.kind==='skill'?h('button',{className:'dcBtn',disabled:working,onClick:run(listExternalNative)},'查看外部导入记录'):null,
     externalNative?h('div',{className:'dcBrandControls'},...(externalNative.items||[]).map(item=>h('button',{className:'dcBtn',key:item.id,disabled:working,onClick:run(()=>reconcileExternalNative(item.id))},'核对 '+(item.mediaKind==='deck'?'演示':item.mediaKind==='svg'?'矢量':'图片')+' · '+item.id.slice(-8))),...(externalNative.pending||[]).map(item=>item.structureComplete?h('button',{className:'dcBtn',key:item.candidate,disabled:working,onClick:run(()=>recoverExternalNative(item.candidate))},'核对并恢复导入记录'):h('span',{key:item.candidate},'临时记录未完成：'+item.error))):null,
     externalFiles?/\.(?:ttf|otf)$/i.test(externalFile)?h('button',{className:'dcBtn',disabled:working,onClick:run(useExternalFont),title:'加入当前项目的编辑会话，不安装到操作系统'},'加入项目字体'):null:null,
     externalBusy?h('button',{className:'dcBtn',onClick:()=>externalAbort.current?.abort()},'停止读取'):null):null):null,
   resourceOpen&&workflowContext?h('section',{className:'dcHtmlResource','aria-label':'工作流规则'},h('strong',null,workflowContext.id+' / '+workflowContext.source.file),h('p',null,workflowContext.catalogueOnly?'这是目录介绍，须读取完整上游原包才能使用原版规则。':'已读取经过摘要核对的规则；尚未执行工作流。'),h('pre',{style:{maxHeight:280,overflow:'auto',whiteSpace:'pre-wrap',fontSize:12}},workflowContext.content),workflowContext.nextOffset!==null?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>readWorkflow(workflowContext.source.file,workflowContext.nextOffset,workflowContext.externalBundle?.id))},'继续读取规则'):null,...workflowContext.referencedFiles.map(row=>h('button',{key:row.path,className:'dcBtn',disabled:working,onClick:run(()=>readWorkflow(row.path,0,workflowContext.externalBundle?.id))},row.path)),h('p',null,workflowContext.referenceScope),h('p',null,'当前列出 '+workflowContext.scripts.length+' 个脚本条目、'+workflowContext.licenseFiles.length+' 个许可文件条目。'+workflowContext.executionRoute.note),h('button',{className:'dcBtn',onClick:()=>setWorkflowContext(null)},'关闭规则')):null,
   pending?h('div',{className:'dcNativeNotice','data-kind':'draft'},
    h('span',null,pending.revision===doc?.revision?'发现尚未保存的网页草稿。':'网页已有新版本，草稿可以另存为独立网页。'),
    pending.revision===doc?.revision?h('button',{className:'dcBtn',disabled:working,onClick:run(()=>restore(false))},'恢复草稿'):null,
    h('button',{className:'dcBtn',disabled:working,onClick:run(()=>restore(true))},'草稿另存为新网页')):null,
   doc&&conversions.length?h('div',{className:'dcHtmlFileBar'},h('span',null,'已保存的网页转换'),
    ...conversions.slice(0,3).map(item=>h('button',{className:'dcBtn',key:item.sha256+item.sourceRevision,disabled:working||!!pending,onClick:run(()=>reopenConversion(item))},
     '打开 '+item.report.slides+' 页演示'+(item.compatibility?' · Tailwind 来源声明':'')+(item.sourceRevision===doc.revision?'':' · 历史版本')))):null,
   candidates?h('div',{className:'dcNativeNotice'},h('span',null,'同一转换文件已导入多次，请选择要打开的演示。'),
    ...candidates.items.map(item=>h('button',{className:'dcBtn',key:item.sourceId,disabled:working,onClick:run(()=>reopenConversion(candidates.item,item))},item.title||item.sourceId))):null,
   doc?h('div',{className:'dcHtmlBody'},
    h('div',{className:'dcHtmlEditor'},h('div',{className:'dcHtmlFileBar'},
     h('select',{'aria-label':'网页文件',value:file||'',disabled:working||!!pending,onChange:event=>select(current.current,event.target.value)},...doc.files.map(item=>h('option',{value:item.path,key:item.path},item.path))),
     h('span',null,file===doc.entry?'网页入口':''),
     file!==doc.entry&&/\.html?$/i.test(file||'')?h('button',{className:'dcBtn',disabled:working||!!pending,onClick:run(setEntry)},'设为网页入口'):null),
     documentFile&&textFile(documentFile)?h('textarea',{'aria-label':'网页源代码',value:text,spellCheck:false,disabled:working||!!pending,onChange:event=>change(event.target.value)}):h('p',null,'此资源按原字节保存。')),
    h('div',{className:'dcHtmlPreview'},h('div',{className:'dcHtmlFileBar'},h('span',null,previewStale?'预览待刷新':'网页预览'),h('label',null,h('input',{type:'checkbox',checked:tailwindCompat,disabled:working||!!pending,onChange:event=>{setTailwindCompat(event.target.checked);setPreviewStale(true);}}),'Tailwind 兼容预览'),
     h('button',{className:'dcBtn',disabled:working||!!pending,onClick:run(inspectDependencies)},'检查已保存版本的外部依赖'),
     h('button',{className:'dcBtn',disabled:working||!!pending||!!tailwindFreezePending||!tailwindCompat,onClick:run(freezeTailwind)},'保存当前静态样式'),
     h('button',{className:'dcBtn',disabled:working||!!pending,onClick:run(()=>makePreview(current.current))},'刷新预览')),
     dependencyHints&&dependencyHints.id===doc.id&&dependencyHints.revision===doc.revision?h('details',{style:{maxHeight:180,overflow:'auto'}},h('summary',null,'外部依赖候选 · '+dependencyHints.items.length+' 项'),h('p',null,dependencyHints.note+' 未保存草稿不在本次检查中。'+(dependencyHints.skippedFiles?' 有 '+dependencyHints.skippedFiles+' 个非 UTF-8 文件未检查。':'')+(dependencyHints.truncated?' 结果已按预算截断。':'')),dependencyHints.items.length?h('ul',null,...dependencyHints.items.map(item=>h('li',{key:item.kind+'|'+item.origin},item.kind+' · '+item.origin+' · '+item.count))):h('p',null,'未从常见静态写法中识别到外链候选。')):null,
     h('iframe',{ref:frame,title:'网页设计预览',sandbox:'allow-scripts',referrerPolicy:'no-referrer'}),
     h('small',null,tailwindCompat?'兼容模式会获取固定摘要的官方 Tailwind 脚本，仅用于隔离预览，不发送网页内容；外部字体仍需处理。':'预览使用隔离沙箱，仅加载当前网页附带的文件。'))):h('div',{className:'dcNativeEmpty'},'新建或导入网页，编辑源代码并预览。'),
   report?h('div',{className:'dcNativeNotice',role:'status'},report.note):null);
 };
}
