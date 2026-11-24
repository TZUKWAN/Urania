import {storeView} from './store-view.js?v=168';
import {createLocalWorkflowPanel} from './local-workflow-panel.js?v=168';
import {currentDesignScope,isActiveDesignSession} from './design-session.js?v=168';
import {insertDesignBrief} from './dsh-context.js?v=168';
import {createDeckLocalTools,isDeckLocalAction} from './deck-local-tools.js?v=168';
import {createStockPanel,openStockImage} from './stock-panel.js?v=168';
import {NativeController} from './native-controller.js?v=168';
import {quoteNative} from './native-reference.js?v=168';
import {createBrandPanel} from './brand-panel.js?v=168';
import {createHtmlWorkspace} from './html-workspace.js?v=168';
import {createStudioImageWorkspace} from './studio-image-workspace.js?v=168';
import {createLegacyMigrationWorkspace} from './legacy-migration-workspace.js?v=168';
import {createNativeContextTools} from './native-context-tools.js?v=168';
import {createAiCanvasTools} from './ai-canvas.js?v=168';
import {createSelectionAi} from './selection-ai.js?v=168';
import {DesignFeedbackClient,createFeedbackPanel} from './design-feedback.js?v=168';
import {createDesignDiagnostics} from './design-diagnostics.js?v=168';
import {createBriefDimensionControls,updateBriefDimension} from './brief-dimensions.js?v=168';
import {createStudioComponents,studioEngines,userFacingError} from './studio-system.js?v=168';
import {createStudioPanels} from './studio-panels.js?v=168';
const CSS=`
.dcNativeWorkspace{position:relative;flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;background:var(--dc-bg)}
.dcNativeHeader{order:0;flex:none;display:flex;align-items:center;border-bottom:1px solid var(--dc-line)}
.dcNativeTitle{display:flex;flex-direction:column;line-height:1.3}
.dcNativeTitle strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dcNativeStage{order:3;position:relative;flex:1;min-width:0;min-height:0}
.dcNativeAnchor{position:absolute;inset:0;min-height:0}
.dcNativeEmpty{position:absolute;inset:0;display:flex}
.dcNativeNotice{order:1;position:relative;z-index:4;display:flex;align-items:center;flex-wrap:wrap;gap:8px;border-bottom:1px solid var(--dc-line)}
.dcNativeNotice>span{flex:1;min-width:0}
.dcNativeMenuItem{display:flex;align-items:center;gap:9px;width:100%;min-height:32px;padding:7px 9px;border:0;border-radius:7px;background:transparent;color:var(--dc-ink);text-align:left;font:inherit;cursor:pointer}
.dcNativeMenuItem:hover:not(:disabled){background:var(--dc-soft)}
.dcNativeMenuItem:disabled{opacity:.45;cursor:default}
.dcNativeMenuItem[data-current=true]{background:var(--dc-tint);color:var(--dc-accent)}
.dcNativeMenuItem>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dcNativeMenuItem small{display:block;font-size:11px;color:var(--dc-muted)}
.dcNativeMenuTitle{display:flex;gap:8px;align-items:center;padding:6px 8px;font-weight:620}
.dcNativeMenuTitle small{color:var(--dc-muted);font-weight:400}
.dcNativeSearch{padding:0 8px 8px}
.dcNativeMenuEmpty{padding:20px 12px;text-align:center;color:var(--dc-muted)}
.dcNativeConfirm{display:flex;align-items:center;justify-content:center}
.dcNativeConfirmCard{width:min(470px,100%)}
.dcNativeConfirmCard h3{margin:0 0 12px;font-size:16px}
.dcNativeConfirmCard ul{padding-left:20px;font-size:12px;line-height:1.7}
.dcNativeConfirmActions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
`;

export function createNativeWorkspace({React,store}){
 const h=React.createElement;
 const BrandPanel=createBrandPanel(React);
 const DeckLocalTools=createDeckLocalTools(React);
 const LocalWorkflowPanel=createLocalWorkflowPanel(React);
 const HtmlWorkspace=createHtmlWorkspace(React);
 const StudioImageWorkspace=createStudioImageWorkspace(React);
 const StockPanel=createStockPanel(React);
 const LegacyMigrationWorkspace=createLegacyMigrationWorkspace(React);
 const NativeContextTools=createNativeContextTools(React);
 const AiCanvasTools=createAiCanvasTools(React);
 const SelectionAi=createSelectionAi(React);
 const DesignDiagnostics=createDesignDiagnostics(React);
 const BriefDimensionControls=createBriefDimensionControls(React);
 const {Icon:StudioIcon,Button:StudioButton,Status:StudioStatus}=createStudioComponents(React);
 const {Home,PanelHeading,Inspector,CanvasViewControls}=createStudioPanels(React);
 let style=document.querySelector('style[data-designcraft-native]');
 if(!style){style=document.createElement('style');style.dataset.designcraftNative='true';document.head.append(style);}
 style.textContent=CSS+'.dcNativeFileDialog{position:fixed;inset:0;width:min(480px,calc(100% - 32px));max-height:calc(100% - 48px);margin:auto;padding:0;border:1px solid var(--dc-line);border-radius:14px;background:var(--dc-surface);color:var(--dc-ink);box-shadow:0 24px 80px #0003}.dcNativeFileDialog::backdrop{background:rgba(15,23,35,.28)}.dcNativeFileDialog .dcNativeConfirmCard{width:100%;padding:24px;border:0;border-radius:0}.dcNativeFileDialog p{font-size:12px;line-height:1.7;color:var(--dc-muted)}.dcNativeFileDialog .dcNativeWorksList{display:block;margin-top:10px;max-height:280px;overflow:auto}.dcNativeFileDialog .dcNativeWorksList .dcNativeMenuItem{width:100%;margin-top:6px}';
 style.textContent+=' .dcNativePopover[data-menu=assets]{left:14px;width:min(430px,calc(100% - 28px));max-height:calc(100% - 80px);overflow:auto}.dcNativeAsset{margin:6px;padding:12px;border:1px solid var(--dc-line);border-radius:10px}.dcNativeAssetTop{display:flex;gap:12px;align-items:center}.dcNativeAssetPreview{width:64px;height:64px;flex:none;border-radius:6px;object-fit:contain;background:var(--dc-soft);font-size:10px;display:flex;align-items:center;justify-content:center;text-align:center}.dcNativeAssetInfo{flex:1;min-width:0}.dcNativeAssetInfo strong{font-size:12px;display:block;overflow:hidden;text-overflow:ellipsis}.dcNativeAssetInfo small{font-size:10px;display:block;color:var(--dc-muted);line-height:1.8}.dcNativeAssetActions{display:flex;gap:8px;margin-top:10px}.dcNativeAssetUses{font-size:11px;color:var(--dc-muted);margin-top:8px;line-height:1.8}';
 style.textContent+=' .dcAiCanvasTools{order:2;display:flex;align-items:center;gap:10px;flex:none;padding:9px 14px;border-bottom:1px solid var(--dc-line);background:var(--dc-surface)}.dcAiCanvasTarget{flex:1;min-width:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.dcAiCanvasTarget strong{font-size:12px;font-weight:600}.dcAiCanvasTarget small{font-size:11px;color:var(--dc-muted)}.dcAiSelectModes{display:flex;gap:3px}.dcAiSelectModes [aria-pressed=true]{color:var(--dc-accent);border-color:var(--dc-accent)}.dcAiCanvasTools .dcBtn{height:30px;white-space:nowrap}@media(max-width:1150px){.dcAiCanvasTarget small{display:none}}';
 style.textContent+=`.dcChatColumn{display:flex;flex:none;min-width:0;min-height:0}.dcChatColumn>.dcChat{flex:1;resize:none}.dcChatSplit{position:relative;cursor:col-resize;touch-action:none}.dcChatSplit span{position:absolute}.dcChatResizeShield{position:fixed;inset:0;z-index:2147480000;cursor:col-resize}.dcChatResizing{cursor:col-resize;user-select:none}.dcSelectionAi{position:fixed;z-index:140;border:1px solid var(--dc-line);color:var(--dc-ink)}.dcSelectionAiHead,.dcSelectionAiFoot{display:flex;align-items:center;gap:8px}.dcSelectionAiHead strong{flex:1}.dcSelectionAi textarea{width:100%;max-height:180px;resize:vertical;margin:8px 0;padding:9px;border:1px solid var(--dc-line);color:var(--dc-ink)}.dcSelectionAiFoot{justify-content:space-between}.dcSelectionAiFoot small{color:var(--dc-muted)}`;
 const controller=new NativeController({onChange:native=>store.set({native}),getScope:()=>{
  return currentDesignScope(store.get().services);
 },focusWorkspace:()=>{store.set({workspaceMode:'native'});store.get().services.uiWorkspace?.ctx?.get?.('layout')?.selectPanel('designcraft');}});
 style.textContent+=' .dcNativeWorkspace>.dcBrandPanel{display:block;max-height:55%;overflow:auto}.dcBrandControls{display:flex;flex-wrap:wrap;align-items:center;gap:10px}.dcBrandControls label{display:inline-flex;align-items:center;gap:6px}.dcBrandCard{max-width:760px;margin:10px 0;padding:12px;border:1px solid var(--dc-line);border-radius:8px}.dcBrandChip{width:18px;height:18px;border-radius:50%}.dcBrandCard li{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:5px 0}.dcBrandCard ul{padding:0;list-style:none}.dcBrandCard p,.dcBrandCard li,.dcBrandControls label{font-size:12px}';
 style.textContent+=' .dcHtmlWorkspace{order:2;position:relative;z-index:7;display:flex;flex:1;min-height:0;flex-direction:column;background:var(--dc-bg)}.dcHtmlHeader,.dcHtmlFileBar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line)}.dcHtmlHeader{flex-wrap:wrap}.dcHtmlHeader select,.dcHtmlFileBar select{max-width:240px}.dcHtmlBody{display:flex;flex:1;min-height:0;gap:1px}.dcHtmlEditor,.dcHtmlPreview{display:flex;flex:1;min-width:0;flex-direction:column}.dcHtmlEditor textarea{flex:1;min-height:0;resize:none;border:0;padding:14px;outline:0;background:var(--dc-surface);color:var(--dc-ink);font:13px/1.55 ui-monospace,monospace;tab-size:2}.dcHtmlPreview iframe{flex:1;min-height:0;border:0;background:white}.dcHtmlPreview small{padding:6px 12px;color:var(--dc-muted)}.dcHtmlWorkspace>.dcNativeEmpty{position:relative;inset:auto;z-index:auto;flex:1}';
 style.textContent+=' .dcHtmlResource{padding:10px 14px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line);max-height:220px;overflow:auto}.dcHtmlResource .dcNativeWorksList{margin:8px 0}';
 style.textContent+=' .dcStudioImageWorkspace{order:2;z-index:7;display:flex;flex:1;min-height:0;flex-direction:column;background:var(--dc-bg)}.dcStudioImageHeader,.dcStudioImageForm{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 14px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line)}.dcStudioImageHeader span{flex:1;color:var(--dc-muted);font-size:12px}.dcStudioImageForm label{display:flex;gap:6px;align-items:center;font-size:12px}.dcStudioImageForm textarea{flex:1;min-width:240px;min-height:56px}.dcStudioImageForm small{width:100%;color:var(--dc-muted)}.dcStudioImageJobs{overflow:auto;padding:14px}.dcStudioImageJob{padding:12px;margin-bottom:12px;background:var(--dc-surface);border:1px solid var(--dc-line);border-radius:10px}.dcStudioImageCandidates{display:flex;gap:12px;overflow:auto}.dcStudioImageCandidates article{min-width:190px;max-width:220px;font-size:12px}.dcStudioImagePreview{width:190px;height:145px;object-fit:contain;background:var(--dc-soft)}';
 style.textContent+=' .dcLegacyWorkspace{order:2;z-index:7;display:flex;flex:1;min-height:0;flex-direction:column;background:var(--dc-bg)}.dcLegacyBody{display:grid;grid-template-columns:minmax(240px,1fr) minmax(300px,1fr);gap:12px;overflow:auto;padding:14px}.dcLegacyBody section{padding:16px;background:var(--dc-surface);border:1px solid var(--dc-line);border-radius:10px}.dcLegacyBody h3{font-size:14px}.dcLegacyBody p{font-size:12px;line-height:1.6}.dcLegacyRow{display:flex;align-items:center;gap:8px;margin:8px 0;font-size:12px}.dcLegacyRow span{flex:1}';
 style.textContent+=' .dcNativeContextTools{order:2;display:flex;align-items:center;gap:6px;overflow:auto;flex:none;padding:6px 14px;border-bottom:1px solid var(--dc-line);background:var(--dc-surface)}.dcNativeContextTools strong,.dcNativeContextTools label{font-size:12px;white-space:nowrap}.dcNativeContextTools label{display:flex;align-items:center;gap:4px}.dcNativeContextTools input[type=number]{width:55px}';
 style.textContent+=' .dcNativeWorkThumb{width:72px;height:54px;flex:none;object-fit:contain;background:var(--dc-soft);border-radius:5px}.dcNativeWorkPages{display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--dc-muted)}';
 style.textContent+=' .dcNativeThumbWrap{position:relative;width:72px;height:54px;flex:none}.dcNativeThumbWrap small{position:absolute;right:1px;bottom:1px;background:var(--dc-surface);color:var(--dc-danger);font-size:9px;padding:1px 3px;border-radius:3px}';
 const feedback=controller.feedback=new DesignFeedbackClient(controller,()=>store.get().services);
 const FeedbackPanel=createFeedbackPanel(React,feedback);
 style.textContent+='.dcFeedbackPanel{order:2;flex:none;padding:5px 14px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line);font-size:12px;max-height:245px;overflow:auto}.dcFeedbackPanel summary{cursor:pointer;color:var(--dc-muted);padding:3px 0}.dcFeedbackPanel input:not([type=checkbox]){max-width:520px;width:65%;padding:6px;border:1px solid var(--dc-line);border-radius:5px;background:var(--dc-bg);color:var(--dc-ink)}.dcFeedbackRow{display:flex;gap:12px;align-items:center;margin:8px 0}.dcFeedbackRow>span{flex:1;min-width:0}.dcFeedbackRow p,.dcFeedbackReceipt p{margin:2px 0;white-space:pre-wrap}.dcFeedbackPanel small{color:var(--dc-muted)}.dcFeedbackReceipt{border-top:1px solid var(--dc-line);padding:8px 0}.dcFeedbackReceipt code{display:block;font-size:10px}.dcFeedbackPanel [role=alert]{color:var(--dc-danger,#b44846)}.dcFeedbackPanel pre{white-space:pre-wrap}.dcSelectionAiFoot{flex-wrap:wrap}';
 function MaterialPreview({asset}){
  const [image,setImage]=React.useState(null),[error,setError]=React.useState(null);
  React.useEffect(()=>{
   const abort=new AbortController();let url,closed=false;setImage(null);setError(null);
   controller.materialBytes(asset.id,{signal:abort.signal}).then(({bytes,type})=>{
    if(closed)return;url=URL.createObjectURL(new Blob([bytes],{type}));setImage(url);
   }).catch(error=>{if(!closed)setError(error.message);});
   return()=>{closed=true;abort.abort();if(url)URL.revokeObjectURL(url);};
  },[asset.id,asset.sha256,controller.view?.epoch]);
  return image?h('img',{className:'dcNativeAssetPreview',src:image,alt:asset.title+' 素材预览'}):h('span',{className:'dcNativeAssetPreview',title:error||undefined},error?'预览不可用':'读取预览中');
 }
 function WorkPreview({source}){
  const [url,setUrl]=React.useState(null),[error,setError]=React.useState(false),[fontWarning,setFontWarning]=React.useState(false);
  React.useEffect(()=>{
   const abort=new AbortController(),epoch=controller.view?.epoch;let created;
   setUrl(null);setError(false);setFontWarning(false);
   if(!epoch||!source.revision)return;
   const query=new URLSearchParams({epoch,id:source.id,revision:source.revision});
   if(source.slideId)query.set('slideId',source.slideId);
   fetch('/designcraft/api/v2/studio/overview-preview?'+query,{headers:controller.sourceHeaders(),signal:abort.signal}).then(async response=>{
    if(!response.ok||response.headers.get('x-source-revision')!==source.revision)throw new Error('作品预览不可用');
    if(source.slideId&&response.headers.get('x-source-slide-id')!==source.slideId)throw new Error('幻灯片预览身份不一致');
    const blob=await response.blob();if(blob.type!=='image/png')throw new Error('作品预览格式无效');
    if(!abort.signal.aborted){created=URL.createObjectURL(blob);setUrl(created);setFontWarning(Number(response.headers.get('x-project-font-count'))>0);}
   }).catch(()=>{if(!abort.signal.aborted)setError(true);});
   return()=>{abort.abort();if(created)URL.revokeObjectURL(created);};
  },[source.id,source.revision,source.slideId,controller.view?.epoch,controller.state.fontGeneration]);
  return url?h('span',{className:'dcNativeThumbWrap',title:fontWarning?'本机预览已提供项目字体；若有系统同名字体，外观可能不同。':undefined},h('img',{className:'dcNativeWorkThumb',src:url,alt:source.title+' 的预览'}),fontWarning?h('small',null,'字体需核对'):null):h('span',{className:'dcNativeWorkThumb'},error?'预览不可用':'读取预览');
 }
 const readWorkspace=storeView(store,s=>({native:s.native,services:s.services,designAssistant:s.designAssistant,uiBuild:s.uiBuild}));
 function Workspace({onFocusChat}){
  const state=React.useSyncExternalStore(store.subscribe,readWorkspace,readWorkspace),native=state.native||controller.state;
  const scope=currentDesignScope(state.services),sessionId=scope?.sessionId,root=scope?.root;
  React.useEffect(()=>{if(root&&sessionId)void feedback.bind({root,sessionId}).catch(error=>feedback.change({error:error.message}));return()=>feedback.suspend();},[root,sessionId]);
  const anchor=React.useRef(null),input=React.useRef(null),workspace=React.useRef(null),fileDialog=React.useRef(null),modalInput=React.useRef(null);
  const [error,setError]=React.useState(null),[menu,setMenu]=React.useState(null),[query,setQuery]=React.useState(''),[pendingDownload,setPendingDownload]=React.useState(null),[fileTitle,setFileTitle]=React.useState(''),[assetPage,setAssetPage]=React.useState(0);
  const [linkSelection,setLinkSelection]=React.useState([]);
  const [workPage,setWorkPage]=React.useState(0);
  const [workKind,setWorkKind]=React.useState('');
  const [inspector,setInspector]=React.useState(false);
  const [history,setHistory]=React.useState(null);
  const [historySelection,selectHistory]=React.useState(null);
  const [historyBusy,setHistoryBusy]=React.useState(false);
  const [review,setReview]=React.useState(null);
  const historyIntent=React.useRef(0),historyCopies=React.useRef(new Map()),menuAnchor=React.useRef(null),menuIntent=React.useRef(0);
  const [newEngine,setNewEngine]=React.useState('vectorcraft'),[newTitle,setNewTitle]=React.useState(''),[newWidth,setNewWidth]=React.useState('1280'),[newHeight,setNewHeight]=React.useState('720');
  const [variantState,setVariantState]=React.useState(null),[variantLabel,setVariantLabel]=React.useState(''),[variantBusy,setVariantBusy]=React.useState(false);
  const [planRows,setPlanRows]=React.useState(null),[selectedPlan,setSelectedPlan]=React.useState(null),[planHistory,setPlanHistory]=React.useState([]),[planCandidates,setPlanCandidates]=React.useState(null),[planBusy,setPlanBusy]=React.useState(false),[planScope,setPlanScope]=React.useState(null);
  const [planLinks,setPlanLinks]=React.useState(null),[planLinkPending,setPlanLinkPending]=React.useState(null),[planLinkNotice,setPlanLinkNotice]=React.useState('');
  const [planForm,setPlanForm]=React.useState(null),[planSavedDraft,setPlanSavedDraft]=React.useState(null),[planConflictDraft,setPlanConflictDraft]=React.useState(null),[planDraftReady,setPlanDraftReady]=React.useState(false);
  const [briefResolution,setBriefResolution]=React.useState(null),[briefPending,setBriefPending]=React.useState(null),[briefJobs,setBriefJobs]=React.useState(null);
  const planFormRef=React.useRef(null),planDraftTokens=React.useRef(new Map()),planDraftQueues=React.useRef(new Map()),planDraftTimers=React.useRef(new Map()),planScopeRef=React.useRef(''),planActionLock=React.useRef(false);
  const currentPlanScope=(sessionId||'')+'\0'+(root||'');
  planScopeRef.current=currentPlanScope;const planDraftKey=scope=>'designcraft-plan-draft\0'+scope;
  const planLinkPendingKey='designcraft-plan-source-link:'+currentPlanScope;
  const briefPendingKey='designcraft-od-brief:'+currentPlanScope;
  React.useEffect(()=>{let active=true;setPlanMigration(null);setPlanRows(null);setSelectedPlan(null);setPlanHistory([]);setPlanCandidates(null);setPlanLinks(null);setPlanLinkNotice('');setBriefResolution(null);setBriefJobs(null);setPlanScope(null);setPlanForm(null);planFormRef.current=null;setPlanSavedDraft(null);setPlanConflictDraft(null);setPlanDraftReady(false);try{const raw=sessionStorage.getItem(planLinkPendingKey);setPlanLinkPending(raw?JSON.parse(raw):null);}catch{setPlanLinkPending(null);}try{const raw=sessionStorage.getItem(briefPendingKey);setBriefPending(raw?JSON.parse(raw):null);}catch{setBriefPending(null);}const key=planDraftKey(currentPlanScope),emergency=controller.planEmergencyDrafts?.get(key);Promise.resolve(emergency||controller.vault.get(key)).then(draft=>{if(active){setPlanSavedDraft(draft||null);setPlanDraftReady(true);}}).catch(error=>{if(active){setError('设计计划草稿读取失败：'+error.message);setPlanDraftReady(false);}});return()=>{active=false;};},[sessionId,root]);
  const [layoutPolicy,setLayoutPolicy]=React.useState('fixed');
  React.useEffect(()=>setLayoutPolicy('fixed'),[native.sourceNavigation?.editId]);
  const materialItems=(native.project?.assets||[]).filter(asset=>!query||asset.title.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.at.localeCompare(a.at));
  React.useEffect(()=>setAssetPage(0),[query,menu,native.project?.revision]);
  React.useEffect(()=>setWorkPage(0),[query,menu]);
  React.useEffect(()=>{setWorkPage(0);},[workKind]);
  React.useEffect(()=>{setHistory(null);selectHistory(null);historyIntent.current++;historyCopies.current.clear();setInspector(false);},[sessionId,root]);
  const source=native.document,blocked=!!(native.busy||native.saving||native.unresponsive||native.pendingDraft||native.fileAction||native.projectPending||['html','image','stock','migration','workflows'].includes(menu));
  const imageUndoAvailable=native.sources.some(item=>item.id===native.sourceId&&item.revision===native.sourceRevision&&item.operation?.action==='image-adopt');
  const photoEnabled=!!controller.runtime?.engines?.photocraft,deckEnabled=!!controller.runtime?.engines?.deckcraft,contract=controller.view?.engineContract;
  const accept='.svg,.vectorcraft,.drawcraft,.vctemplate,image/svg+xml'+(photoEnabled?',.pcraft,.png,.jpg,.jpeg,.psd,.psb,.webp,.tif,.tiff,image/png,image/jpeg':'')+(deckEnabled?',.deckcraft,.slidecraft,.pptx,.potx,.ppsx':'');
  const kindLabel=engine=>engine==='photocraft'?'图片编辑':engine==='deckcraft'?'演示文稿':'矢量设计';
  const exports=contract?.exportFormats||[],sourceFormat=contract?.sourceFormat||'vectorcraft',canPlace=['vectorcraft','deckcraft'].includes(controller.view?.engine);
  React.useEffect(()=>{setFileTitle((native.title||'未命名设计')+' 副本');if(native.fileAction){setError(null);setMenu(null);setQuery('');}},[native.fileAction?.id]);
  const run=fn=>async()=>{setError(null);try{if(controller.state.hostMenuOpen){setMenu(null);await controller.resumeHostMenu();}await fn();}catch(error){setError(error.message);}};
  React.useEffect(()=>{if(!native.hostMenuOpen)setMenu(null);},[native.hostMenuOpen]);
  React.useEffect(()=>{if(!sessionId||!root)return;controller.activate({sessionId,root}).catch(error=>setError(error.message));},[sessionId,root]);
  React.useLayoutEffect(()=>{if(anchor.current)controller.attach(anchor.current);return()=>controller.park();},[]);
  React.useLayoutEffect(()=>{
   const dialog=fileDialog.current;if(!dialog)return;
   if(!dialog.open)dialog.showModal();
   return()=>{if(dialog.open)dialog.close();};
  },[native.fileAction?.id,native.fileAction?.action]);
  React.useLayoutEffect(()=>{
   // Menus and file forms belong to the host UI. Temporarily remove the native
   // hit-test region while operating them; the same App remains attached.
   controller.portal.style.pointerEvents=menu||pendingDownload||native.fileAction?'none':'auto';
   controller.place?.();
   return()=>{controller.portal.style.pointerEvents='auto';};
  },[menu,pendingDownload,native.fileAction]);
  React.useEffect(()=>{
   if(!menu)return;
   const dismiss=restoreFocus=>{menuIntent.current++;setMenu(null);controller.resumeHostMenu().catch(error=>setError(error.message));if(restoreFocus)requestAnimationFrame(()=>menuAnchor.current?.focus());};
   const close=event=>{
    if(['html','image','stock','migration','workflows','diagnostics'].includes(menu))return;
    if(event.type==='keydown'){
     if(event.key==='Escape'&&!event.isComposing){event.stopPropagation();dismiss(true);}
     return;
    }
    if(!event.target.closest('.dcNativePopover,.dcNativeHeader,.dcStudioHome'))dismiss(false);
   };
   document.addEventListener('pointerdown',close);document.addEventListener('keydown',close,true);
   return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close,true);};
  },[menu]);
  const toggle=name=>{
   const intent=++menuIntent.current;
   if(!menu&&document.activeElement instanceof HTMLElement)menuAnchor.current=document.activeElement;
   setError(null);setQuery('');
   if(menu===name){
    setMenu(null);controller.resumeHostMenu().catch(error=>setError(error.message));
    requestAnimationFrame(()=>menuAnchor.current?.focus());return;
   }
   if(name==='brands')controller.change({brands:null});
   if(name==='versions')controller.change({versions:null});
   if(name==='variants')setVariantState(null);
   if(name==='works'){setWorkKind('');setHistory(null);selectHistory(null);}
   if(name==='plans'){setPlanMigration(null);setPlanRows(null);setSelectedPlan(null);setPlanCandidates(null);setPlanScope(currentPlanScope);}
   const exclusive=['html','image','stock','migration'].includes(name);
   if(!exclusive)setMenu(name);
   controller.suspendHostMenu().then(async()=>{
    if(intent!==menuIntent.current)return;
    if(name==='assets')await controller.refreshProject();
    else if(name==='brands')await controller.refreshBrands();
    else if(name==='versions')await controller.refreshVersions();
    else if(name==='works'||name==='image')await controller.refresh();
    else if(name==='variants')setVariantState(await controller.variantAction('list'));
    else if(name==='plans')setPlanRows((await controller.planAction('list')).items);
    if(intent===menuIntent.current&&exclusive)setMenu(name);
   }).catch(error=>{if(intent===menuIntent.current){setMenu(null);setError(error.message);}});
  };
  React.useEffect(()=>{
   if(!menu||!native.hostMenuReady||!['works','assets','new','export','more','review'].includes(menu))return;
   const popup=workspace.current?.querySelector('.dcNativePopover[data-menu="'+menu+'"]');
   const frame=requestAnimationFrame(()=>popup?.querySelector('input:not(:disabled),button:not(:disabled)')?.focus({preventScroll:true}));
   return()=>cancelAnimationFrame(frame);
  },[menu,native.hostMenuReady]);
  const loadWorkHistory=async (work,offset=0)=>{
   const intent=++historyIntent.current,epoch=controller.view?.epoch;
   setHistoryBusy(true);if(offset===0){setHistory({work,items:[]});selectHistory(null);}
   try{
    const result=await controller.api('source-history',{epoch,sourceId:work.id,offset});
    if(intent!==historyIntent.current||controller.view?.epoch!==epoch)return;
    setHistory(current=>({work,items:offset?[...current.items,...result.items]:result.items,nextOffset:result.nextOffset}));
    if(offset===0)selectHistory(result.items[0]||null);
   }catch(cause){if(intent===historyIntent.current)setError(cause.message);}
   finally{if(intent===historyIntent.current)setHistoryBusy(false);}
  };
  const restoreHistoryCopy=async version=>{
   const key=version.id+'/'+version.revision;
   if(!historyCopies.current.has(key))historyCopies.current.set(key,crypto.randomUUID());
   const copy=await controller.api('source-history-copy',{epoch:controller.view.epoch,sourceId:version.id,revision:version.revision,operationId:historyCopies.current.get(key)});
   await controller.run('open',{sourceId:copy.sourceId});
   historyCopies.current.delete(key);
  };
  const reviewFeedback=submission=>{
   const targets=new Map();
   for(const {target} of submission.items){
    if(target.kind!=='native')continue;
    const key=target.sourceId+'/'+(target.engine==='deckcraft'&&target.page?.kind==='slide'?target.page.id:'');
    if(!targets.has(key))targets.set(key,target);
   }
   const works=[];
   for(const [key,target] of targets){
    const id=target.sourceId,result=[...submission.results].reverse().find(row=>row.sourceId===id);
    const slideId=target.engine==='deckcraft'&&target.page?.kind==='slide'?target.page.id:null;
    const label=target.title+(slideId&&Number.isSafeInteger(target.page.index)?' · 第 '+(target.page.index+1)+' 页':'');
    const decision=submission.reviews?.find(item=>item.sourceId===id&&item.revision===result?.revision)?.decision;
    if(result)works.push({key,id,title:label,slideId,engine:target.engine,before:target.revision,after:result.revision,decision});
   }
   if(!works.length)return;
   const pageId=native.document?.page?.nativePage?.id;
   const selected=works.findIndex(work=>work.id===native.sourceId&&(!work.slideId||work.slideId===String(pageId)));
   setReview({epoch:controller.view.epoch,submissionId:submission.id,works,index:Math.max(0,selected)});
   toggle('review');
  };
  const reviewDecision=async decision=>{
   const work=review.works[review.index];
   if(decision==='declined')await restoreHistoryCopy({id:work.id,revision:work.before});
   await feedback.api({action:'review',submissionId:review.submissionId,sourceId:work.id,revision:work.after,decision});
   await feedback.refresh();
   controller.change({aiInputNotice:decision==='accepted'?'已确认这次 AI 修改结果。':'已打开修改前的独立副本，可以继续调整。'});
  };
  const planRead=async(id,revision)=>{setPlanBusy(true);setError(null);try{const plan=await controller.planAction('read',{id,...(revision?{revision}:{})}),history=await controller.planAction('history',{id});if(!history.items.some(row=>row.revision===plan.revision))throw new Error('设计计划历史已变化，请刷新');setSelectedPlan(plan);setPlanHistory(history.items);setPlanCandidates(null);setPlanLinks(null);setPlanLinkNotice('');setPlanScope(currentPlanScope);}catch(error){setError(error.message);}finally{setPlanBusy(false);}};
  const planRefresh=async()=>{setPlanBusy(true);setError(null);try{setPlanRows((await controller.planAction('list')).items);setSelectedPlan(null);setPlanHistory([]);setPlanCandidates(null);setPlanScope(currentPlanScope);}catch(error){setError(error.message);}finally{setPlanBusy(false);}};
  const [planMigration,setPlanMigration]=React.useState(null);
  const planMigrationPreview=async()=>{if(!selectedPlan)return;setPlanBusy(true);setError(null);try{setPlanMigration(await controller.planAction('migration_preview',{id:selectedPlan.id,baseRevision:selectedPlan.revision}));}catch(e){setError(e.message);}finally{setPlanBusy(false);}};
  const planMigrate=async()=>{if(!planMigration)return;setPlanBusy(true);setError(null);try{const result=await controller.planAction('migrate_resources',{id:planMigration.id,baseRevision:planMigration.baseRevision,migrations:planMigration.items.filter(item=>item.available).map(item=>({resourceId:item.resourceId,file:item.file,expectedTargetSha256:item.targetSha256}))});setSelectedPlan(result);setPlanMigration(null);setPlanHistory((await controller.planAction('history',{id:result.id})).items);}catch(e){setError(e.message);}finally{setPlanBusy(false);}};
  const planRestore=async()=>{if(!selectedPlan||!planHistory[0])return;setPlanBusy(true);setError(null);try{const saved=await controller.planAction('restore',{id:selectedPlan.id,revision:selectedPlan.revision,baseRevision:planHistory[0].revision}),history=await controller.planAction('history',{id:selectedPlan.id}),list=await controller.planAction('list');setSelectedPlan(saved);setPlanHistory(history.items);setPlanRows(list.items);setPlanScope(currentPlanScope);}catch(error){setError(error.message);}finally{setPlanBusy(false);}};
  const planCheck=async id=>{setPlanBusy(true);setError(null);try{setPlanCandidates(await controller.planAction('recoverable',{id}));setSelectedPlan(null);setPlanHistory([]);setPlanScope(currentPlanScope);}catch(error){setError(error.message);}finally{setPlanBusy(false);}};
  const planCandidate=async(id,revision)=>{setPlanBusy(true);setError(null);try{setSelectedPlan(await controller.planAction('candidate',{id,revision}));setPlanScope(currentPlanScope);}catch(error){setError(error.message);}finally{setPlanBusy(false);}};
  const planRecover=async(id,revision,baseRevision)=>{setPlanBusy(true);setError(null);try{const saved=await controller.planAction('recover',{id,revision,baseRevision}),history=await controller.planAction('history',{id}),list=await controller.planAction('list');setSelectedPlan(saved);setPlanHistory(history.items);setPlanRows(list.items);setPlanCandidates(null);setPlanScope(currentPlanScope);}catch(error){setError(error.message);}finally{setPlanBusy(false);}};
  const persistPlanDraft=form=>{
   const key=planDraftKey(form.scope),token=crypto.randomUUID(),snapshot={...form,token},emergency={...form,token:'memory-'+crypto.randomUUID()};controller.planEmergencyDrafts||=new Map();controller.planEmergencyDrafts.set(key,emergency);
   const prior=planDraftQueues.current.get(key)||Promise.resolve(),pending=prior.catch(()=>{}).then(async()=>{const result=await controller.vault.replace(key,planDraftTokens.current.get(key)||null,snapshot);if(!result.applied){if(planScopeRef.current===form.scope){setPlanConflictDraft(result.current||null);setError('发现另一份计划草稿，未覆盖；当前内容仍保留在内存。');}throw new Error('计划草稿发生冲突，未覆盖');}planDraftTokens.current.set(key,token);if(controller.planEmergencyDrafts?.get(key)===emergency)controller.planEmergencyDrafts.delete(key);});
   planDraftQueues.current.set(key,pending);pending.finally(()=>{if(planDraftQueues.current.get(key)===pending)planDraftQueues.current.delete(key);}).catch(()=>{});return pending;
  };
  const stopPlanDraftTimer=key=>{const timer=planDraftTimers.current.get(key);if(timer)clearTimeout(timer);planDraftTimers.current.delete(key);};
  const schedulePlanDraft=form=>{const key=planDraftKey(form.scope);controller.planEmergencyDrafts||=new Map();controller.planEmergencyDrafts.set(key,{...form,token:'memory-'+crypto.randomUUID()});stopPlanDraftTimer(key);const timer=setTimeout(()=>{planDraftTimers.current.delete(key);persistPlanDraft(form).catch(error=>{if(planScopeRef.current===form.scope)setError(error.message);});},200);planDraftTimers.current.set(key,timer);};
  const beginPlanForm=async mode=>{if(!sessionId||!root||!controller.view?.epoch||!planDraftReady)throw new Error('请先打开项目并等待本地草稿读取');if(planFormRef.current)throw new Error('请先处理当前计划草稿');const key=planDraftKey(currentPlanScope),existing=controller.planEmergencyDrafts?.get(key)||await controller.vault.get(key);if(planScopeRef.current!==currentPlanScope)throw new Error('工作区已切换，未开始编辑计划');if(planFormRef.current)throw new Error('已有计划草稿正在编辑');if(existing){setPlanSavedDraft(existing);setPlanLinkNotice('已有本地计划草稿，请先恢复或明确放弃。');return;}if(mode==='edit'&&(!selectedPlan||selectedPlan.unpublished))throw new Error('请选择已发布的计划版本');const form=mode==='create'?{scope:currentPlanScope,mode,operationKey:crypto.randomUUID(),title:'',brief:'',content:'',sequence:0}:{scope:currentPlanScope,mode,id:selectedPlan.id,baseRevision:selectedPlan.revision,title:selectedPlan.plan.title,brief:selectedPlan.plan.brief,content:selectedPlan.plan.content,sequence:0};planFormRef.current=form;setPlanForm(form);setBriefResolution(null);setPlanSavedDraft(null);await persistPlanDraft(form);};
  const changePlanForm=(field,value)=>{const old=planFormRef.current;if(!old)return;const next={...old,[field]:value,sequence:old.sequence+1};planFormRef.current=next;setPlanForm(next);setBriefResolution(null);schedulePlanDraft(next);};
  const changeBriefDimension=(key,change)=>{try{const form=planFormRef.current;if(!form||form.mode!=='create'||form.scope!==currentPlanScope)throw new Error('当前计划草稿已切换');const next=updateBriefDimension(form.briefDimensions,key,change);changePlanForm('briefDimensions',next);setError(null);}catch(error){setError(error.message);}};
  const restorePlanDraft=async()=>{const draft=planSavedDraft;if(!draft||draft.scope!==currentPlanScope||!['create','edit'].includes(draft.mode)||typeof draft.token!=='string'||typeof draft.title!=='string'||typeof draft.brief!=='string'||typeof draft.content!=='string'||draft.title.length>200||draft.brief.length>40000||draft.content.length>80000||!Number.isSafeInteger(draft.sequence)||draft.sequence<0||draft.mode==='create'&&!/^[a-f0-9-]{36}$/.test(draft.operationKey||'')||draft.mode==='edit'&&(!/^plan-[a-f0-9]{32}$/.test(draft.id||'')||!/^[a-f0-9]{64}$/.test(draft.baseRevision||'')))throw new Error('本地计划草稿不完整或属于其他项目');const key=planDraftKey(draft.scope);stopPlanDraftTimer(key);await (planDraftQueues.current.get(key)||Promise.resolve()).catch(()=>{});const disk=await controller.vault.get(key);if(planScopeRef.current!==draft.scope)throw new Error('工作区已切换，未恢复计划草稿');if(draft.token.startsWith('memory-')&&disk&&planDraftTokens.current.get(key)!==disk.token)throw new Error('还有另一份本地计划草稿，未覆盖；请先核对原窗口');if(disk&&!draft.token.startsWith('memory-')&&disk.token!==draft.token)throw new Error('计划草稿已变化，未覆盖');if(disk)planDraftTokens.current.set(key,disk.token);const {token,...form}=draft;planFormRef.current=form;setPlanForm(form);setBriefResolution(null);setPlanSavedDraft(null);await persistPlanDraft(form);};
  const discardPlanDraft=async()=>{const draft=planSavedDraft;if(!draft||draft.scope!==currentPlanScope)throw new Error('没有当前项目的待处理草稿');const key=planDraftKey(draft.scope);stopPlanDraftTimer(key);await (planDraftQueues.current.get(key)||Promise.resolve()).catch(()=>{});const disk=await controller.vault.get(key),owned=planDraftTokens.current.get(key);if(planScopeRef.current!==draft.scope)throw new Error('工作区已切换，未删除计划草稿');if(disk&&(disk.token===draft.token||disk.token===owned)){const removed=await controller.vault.replace(key,disk.token,undefined);if(!removed.applied)throw new Error('计划草稿已变化，未删除');planDraftTokens.current.delete(key);}else if(disk){setPlanConflictDraft(disk);throw new Error('另一份计划草稿仍保留，请先核对');}controller.planEmergencyDrafts?.delete(key);setPlanSavedDraft(null);setPlanLinkNotice('已放弃所选本地草稿，已保存计划未改变。');};
  const savePlanForm=async()=>{
   const form=planFormRef.current;if(!form||form.scope!==currentPlanScope)throw new Error('计划草稿不属于当前项目');if(!form.title.trim()||!form.brief.trim()||!form.content.trim())throw new Error('请填写计划名称、实际简报和计划内容');const key=planDraftKey(form.scope);stopPlanDraftTimer(key);await persistPlanDraft(form);if(planScopeRef.current!==form.scope)throw new Error('工作区已切换；原项目草稿保留，未提交计划');
   const payload={title:form.title,brief:form.brief,content:form.content,...(form.mode==='create'?{operationKey:form.operationKey}:{id:form.id,baseRevision:form.baseRevision})},saved=await controller.planAction(form.mode==='create'?'create':'save',payload);
   if(saved.plan.title!==form.title.trim()||saved.plan.brief!==form.brief||saved.plan.content!==form.content)throw new Error('计划已保存但最新内容已变化，本地草稿仍保留，请先核对');
   if(planScopeRef.current!==form.scope)throw new Error('工作区已切换；计划可能已保存，原项目草稿仍保留');const latest=planFormRef.current;
   if(!latest||latest.sequence!==form.sequence){if(latest){stopPlanDraftTimer(key);const next={...latest,mode:'edit',id:saved.id,baseRevision:saved.revision,sequence:latest.sequence+1};delete next.operationKey;planFormRef.current=next;setPlanForm(next);await persistPlanDraft(next);}if(planScopeRef.current===form.scope)setPlanLinkNotice(latest?'已保存较早内容；较新的编辑仍在本地草稿中。':'计划已保存，本地草稿仍保留，请先核对。');}
   else{const removed=await controller.vault.replace(key,planDraftTokens.current.get(key)||null,undefined);if(!removed.applied){setPlanConflictDraft(removed.current||null);throw new Error('计划已保存，但另一份本地草稿已变化，未清除');}planDraftTokens.current.delete(key);const after=planScopeRef.current===form.scope?planFormRef.current:null,emergency=controller.planEmergencyDrafts?.get(key);if(after&&after.sequence!==form.sequence){stopPlanDraftTimer(key);const next={...after,mode:'edit',id:saved.id,baseRevision:saved.revision,sequence:after.sequence+1};delete next.operationKey;planFormRef.current=next;setPlanForm(next);await persistPlanDraft(next);setPlanLinkNotice('已保存较早内容；较新的编辑仍在本地草稿中。');}else if(emergency&&emergency.sequence!==form.sequence){if(planScopeRef.current===form.scope)setPlanLinkNotice('计划已保存；较新的内存草稿仍保留，请核对。');}else{if(emergency)controller.planEmergencyDrafts.delete(key);if(planScopeRef.current!==form.scope)return;planFormRef.current=null;setPlanForm(null);setPlanSavedDraft(null);setPlanConflictDraft(null);setPlanLinkNotice('设计计划已保存；此前来源按原版本保留。');}}
   if(planScopeRef.current!==form.scope)return;const history=await controller.planAction('history',{id:saved.id}),list=await controller.planAction('list');setSelectedPlan(saved);setPlanHistory(history.items);setPlanRows(list.items);setPlanScope(currentPlanScope);
  };
  const forkPlanDraft=async()=>{const old=planFormRef.current;if(!old)throw new Error('没有待另存的计划草稿');stopPlanDraftTimer(planDraftKey(old.scope));const next={...old,mode:'create',operationKey:crypto.randomUUID(),sequence:old.sequence+1};delete next.id;delete next.baseRevision;planFormRef.current=next;setPlanForm(next);setBriefResolution(null);await persistPlanDraft(next);if(planScopeRef.current===next.scope)setPlanLinkNotice('已准备独立计划；原计划保留，新计划不会自动复制来源引用。');};
  const closePlanForm=async()=>{const form=planFormRef.current;if(!form)return;const key=planDraftKey(form.scope);stopPlanDraftTimer(key);await persistPlanDraft(form).catch(()=>{});const draft=controller.planEmergencyDrafts?.get(key)||await controller.vault.get(key);if(planScopeRef.current!==form.scope)throw new Error('工作区已切换；原计划草稿仍保留');if(!draft)throw new Error('本地草稿未确认，继续保留当前编辑内容');planFormRef.current=null;setPlanForm(null);setBriefResolution(null);setPlanSavedDraft(draft);setPlanLinkNotice(typeof draft.token==='string'&&draft.token.startsWith('memory-')?'草稿仅保留在当前窗口内存，关闭程序可能丢失；请尽快恢复并保存。':'已关闭编辑，计划草稿保留在本地。');};
  const briefInput=form=>{if(!form||form.mode!=='create'||form.scope!==currentPlanScope)throw new Error('请先打开当前项目的新计划草稿');if(form.briefDimensions!==undefined&&(typeof form.briefDimensions!=='string'||form.briefDimensions.length>16000))throw new Error('简报维度超出预算');let dimensions;try{dimensions=JSON.parse(form.briefDimensions||'{}');}catch{throw new Error('简报维度需要有效 JSON 对象');}if(!dimensions||typeof dimensions!=='object'||Array.isArray(dimensions))throw new Error('简报维度需要 JSON 对象');return {title:form.title,brief:form.brief,mode:form.briefMode||'natural',dimensions};};
  const resolveBrief=async()=>{const form=planFormRef.current,payload=briefInput(form),value=await controller.planAction('brief-resolve',payload);if(planScopeRef.current!==form.scope||planFormRef.current?.sequence!==form.sequence)throw new Error('简报在解析期间改变，请重新解析');setBriefResolution({...value,sequence:form.sequence});setPlanLinkNotice(value.note);};
  const completeBrief=async record=>{const form=planFormRef.current,payload=briefInput(form),key=planDraftKey(form.scope);stopPlanDraftTimer(key);await persistPlanDraft(form);if(planScopeRef.current!==form.scope)throw new Error('工作区已切换；草稿保留，未继续简报');const value=await controller.planAction('brief-create',{...payload,operationKey:record.operationKey});if(value.job.id!==record.id)throw new Error('设计简报任务身份不一致，请先核对');if(value.savedArtifactsComplete){sessionStorage.removeItem(briefPendingKey);setBriefPending(null);}setPlanLinkNotice(value.note+(value.plan?' 计划 '+value.plan.id+'。':'')+(value.preview?' 预览 '+value.preview.id+'。':'')+' 当前草稿仍保留。');setPlanRows((await controller.planAction('list')).items);};
  const createBrief=async()=>{const form=planFormRef.current;if(briefPending)throw new Error('上次设计简报尚未核对');if(!briefResolution||briefResolution.sequence!==form?.sequence)throw new Error('请先解析并核对当前简报及默认项');const operationKey=crypto.randomUUID(),bytes=new TextEncoder().encode(controller.view.sessionId+'\0'+operationKey),digest=await crypto.subtle.digest('SHA-256',bytes),record={id:'odbriefjob-'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join(''),operationKey};sessionStorage.setItem(briefPendingKey,JSON.stringify(record));setBriefPending(record);await completeBrief(record);};
  const checkBrief=async id=>{const value=await controller.planAction('brief-status',{id});if(briefPending?.id===id&&value.savedArtifactsComplete){sessionStorage.removeItem(briefPendingKey);setBriefPending(null);}setPlanLinkNotice(value.note+(value.plan?' 计划 '+value.plan.id+'。':'')+(value.preview?' 预览 '+value.preview.id+'。':''));setPlanRows((await controller.planAction('list')).items);};
  const listBriefs=async(offset=0)=>{setBriefJobs(await controller.planAction('brief-list',{offset}));};
  const recoverBrief=async candidate=>{const value=await controller.planAction('brief-recover',{candidate});setPlanLinkNotice(value.note);await listBriefs();};
  const loadPlanLinks=async(id,offset=0)=>{const value=await controller.planAction('links',{id,offset});setPlanLinks({...value,planId:id});return value;};
  const planLinkRun=fn=>async()=>{if(planBusy||planActionLock.current)return;planActionLock.current=true;setPlanBusy(true);setError(null);try{await fn();}catch(error){setError(error.message);}finally{planActionLock.current=false;setPlanBusy(false);}};
  const completePlanLink=async record=>{const value=await controller.planAction('link',{id:record.planId,revision:record.planRevision,sourceId:record.sourceId,sourceRevision:record.sourceRevision,operationKey:record.operationKey});sessionStorage.removeItem(planLinkPendingKey);setPlanLinkPending(null);setPlanLinkNotice(value.note);await loadPlanLinks(record.planId);};
  const addPlanLink=async()=>{if(planLinkPending)throw new Error('上次关联尚未核对');if(!selectedPlan||selectedPlan.unpublished||!controller.view?.sourceId||!controller.view?.sourceRevision)throw new Error('请选择已发布计划和已保存作品');const operationKey=crypto.randomUUID(),bytes=new TextEncoder().encode(controller.view.sessionId+'\0'+operationKey),digest=await crypto.subtle.digest('SHA-256',bytes),id='planlink-'+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join(''),record={id,operationKey,planId:selectedPlan.id,planRevision:selectedPlan.revision,sourceId:controller.view.sourceId,sourceRevision:controller.view.sourceRevision};sessionStorage.setItem(planLinkPendingKey,JSON.stringify(record));setPlanLinkPending(record);await completePlanLink(record);};
  const checkPlanLink=async()=>{const value=await controller.planAction('verify-link',{id:planLinkPending.id}),link=value.link;if(link.planId!==planLinkPending.planId||link.planRevision!==planLinkPending.planRevision||link.sourceId!==planLinkPending.sourceId||link.sourceRevision!==planLinkPending.sourceRevision||link.actor!=='manual')throw new Error('已保存关联与待核对操作不一致');sessionStorage.removeItem(planLinkPendingKey);setPlanLinkPending(null);setPlanLinkNotice(value.note);await loadPlanLinks(link.planId);};
  const disablePlanLink=async id=>{const value=await controller.planAction('unlink',{id});setPlanLinkNotice(value.note);if(selectedPlan)await loadPlanLinks(selectedPlan.id);};
  const verifyPlanLink=async id=>{const value=await controller.planAction('verify-link',{id});setPlanLinkNotice(value.note);};
  const recoverPlanLink=async candidate=>{const value=await controller.planAction('recover-link',{candidate});setPlanLinkNotice(value.note);if(selectedPlan)await loadPlanLinks(selectedPlan.id);};
  const variantRun=fn=>async()=>{if(variantBusy)return;setVariantBusy(true);setError(null);try{await fn();setVariantState(await controller.variantAction('list'));await controller.refresh();}catch(error){setError(error.message);}finally{setVariantBusy(false);}};
  const saveFile=file=>{const url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);};
  const download=async format=>{setMenu(null);const file=await controller.export(format);if(file.designcraftWarnings?.length)setPendingDownload(file);else saveFile(file);};
  const defaultTitle=engine=>engine==='photocraft'?'未命名图片':engine==='deckcraft'?'未命名演示':'未命名设计';
  const chooseNewEngine=engine=>{const defaults=controller.runtime.engines[engine].createDefaults;setNewEngine(engine);setNewTitle(defaultTitle(engine));setNewWidth(String(defaults.width));setNewHeight(String(defaults.height));};
  const create=async(engine=controller.view?.engine||'vectorcraft',options={})=>{setMenu(null);const defaults=controller.runtime.engines[engine].createDefaults;await controller.run('new',{...defaults,...options,engine,title:options.title||defaultTitle(engine)});};
  const beginCreate=engine=>{
   if(engine==='motion'){store.set({workspaceMode:'motion'});return;}
   chooseNewEngine(engine||controller.view?.engine||'vectorcraft');
   toggle('new');
  };
  const createCustom=event=>{event.preventDefault();const width=Number(newWidth),height=Number(newHeight);if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>16384||height>16384||width*height>24000000){setError('宽高须为正整数，单边不超过 16384、总面积不超过 2400 万');return;}run(()=>create(newEngine,{title:newTitle.trim(),width,height}))();};
  const completeFile=async options=>{fileDialog.current?.close();await controller.completeNativeFile(options);};
  const cancelFile=async()=>{fileDialog.current?.close();await controller.cancelNativeFile();};
  const importSelection=async event=>{const element=event.target,file=element.files?.[0];if(!file)return;await run(async()=>native.fileAction?.action==='open'?completeFile({file}):controller.importFile(file))();element.value='';};
  const quote=async()=>{controller.requestAiInput();if(!source||!(source.objectIds?.length||source.selection?.length||source.nativeSelection?.data?.selectedLayers?.length||source.nativeSelection?.data?.rasterSelection))onFocusChat?.();};
  const item=(label,action,extra={})=>h('button',{className:'dcNativeMenuItem',onClick:run(action),...extra,disabled:!!extra.disabled||!!menu&&!native.hostMenuReady},label);
  const status=native.phase==='opening'?'正在打开':native.busy?'正在处理':native.manualEditing?'操作中':native.saving?'正在保存':native.dirty?'尚未保存':'已保存';
  const visible=native.sources.filter(work=>(!workKind||work.engine===workKind)&&(work.title||'未命名作品').toLowerCase().includes(query.trim().toLowerCase()));
  const title=native.title||'设计工作区';
  const currentEngine=studioEngines.find(engine=>engine.id===controller.view?.engine);
  const compact=text=>h('span',{className:'dcStudioCompactText'},text);
  const canUseMenus=!!controller.view&&!blocked;
  const disabledMenu=!!(native.busy||native.saving||native.fileAction)||['html','image','stock','migration','workflows'].includes(menu);
  const changeHistory=command=>()=>controller.manualViewCommand(source,command).catch(cause=>setError(cause.message));
  const date=value=>Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat('zh-CN',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'';
  return h('section',{ref:workspace,className:'dcNativeWorkspace',inert:!scope||controller.view?.sessionId!==sessionId,'aria-label':'设计工作区'},
   h('header',{className:'dcNativeHeader'},
    native.sourceNavigation?h('button',{className:'dcBtn',disabled:blocked,'aria-label':'返回原设计',title:'返回 '+native.sourceNavigation.parentTitle,onClick:run(()=>controller.projectAction('return_to_design'))},'返回原设计'):null,
    native.sourceNavigation?.editId?h('button',{className:'dcBtn dcPrimary',disabled:blocked||!native.sourceNavigation.canApply,'aria-label':'应用到原位置',onClick:run(()=>controller.projectAction('apply_instance',{editId:native.sourceNavigation.editId}))},'应用到原位置'):null,
    native.sourceNavigation?.linkedCount>1?h('select',{'aria-label':'源比例变化时',title:'源比例变化时使用每个对象的本地锚点',value:layoutPolicy,disabled:blocked,onChange:e=>setLayoutPolicy(e.target.value)},
     h('option',{value:'fixed'},'保持原边框'),...['左上','上中','右上','左中','中心','右中','左下','下中','右下'].map((label,i)=>h('option',{key:i,value:'fit-'+i},'等比适配 · '+label))):null,
    native.sourceNavigation?.linkedCount>1?h('button',{className:'dcBtn',disabled:blocked||!native.sourceNavigation.canApply||native.sourceNavigation.canApplyLinked===false,'aria-label':'更新全部关联使用处',onClick:run(()=>controller.projectAction('apply_linked',{editId:native.sourceNavigation.editId,layoutPolicy}))},'更新关联 '+native.sourceNavigation.linkedCount+' 处'):null,
    h(StudioButton,{icon:'folder',label:'历史作品',className:'dcStudioHistoryButton',disabled:disabledMenu,'aria-expanded':menu==='works',onClick:()=>toggle('works')},compact('历史作品')),
    h('div',{className:'dcNativeTitle'},h('strong',{title},title),h('small',null,source?kindLabel(controller.view?.engine):'当前项目')),
    h('div',{className:'dcStudioFileActions'},
     source?h('span',{'data-save-indicator':''},h(StudioStatus,{kind:native.dirty?'warning':native.saving||native.busy||native.phase==='opening'?'busy':'success'},status)):null,
     source?h(React.Fragment,null,h('span',{'data-separator':'','aria-hidden':true}),
      h(StudioButton,{icon:'undo',label:'撤销',disabled:blocked||!!menu||!source.history?.length,'data-secondary-action':'',onClick:changeHistory('edit.undo')}),
      h(StudioButton,{icon:'redo',label:'重做',disabled:blocked||!!menu||!source.redo?.length,'data-secondary-action':'',onClick:changeHistory('edit.redo')}),
      h(StudioButton,{icon:'settings',label:'对象属性','aria-expanded':inspector,disabled:blocked||!!menu,onClick:()=>setInspector(value=>!value)})):null,
     h(StudioButton,{icon:'assets',label:'项目素材',disabled:disabledMenu,'aria-expanded':menu==='assets',onClick:()=>toggle('assets')}),
     h(StudioButton,{icon:'plus',label:'新建设计',disabled:!canUseMenus,'aria-expanded':menu==='new',onClick:()=>beginCreate()},compact('新建')),
     h(StudioButton,{icon:'upload',label:'导入',disabled:blocked,onClick:()=>input.current?.click()}),
     h('input',{ref:input,type:'file',accept,disabled:blocked,hidden:true,onChange:importSelection}),
     h(StudioButton,{icon:'download',label:'导出',className:source?'dcPrimary':'',disabled:!canUseMenus,'aria-expanded':menu==='export',onClick:()=>toggle('export')},compact('导出')),
     h(StudioButton,{icon:'more',label:'更多操作',disabled:disabledMenu,'aria-expanded':menu==='more',onClick:()=>toggle('more')}))),
   native.sourceNavigation?h('div',{className:'dcNativeNotice'},h('span',null,native.sourceNavigation.applyReason||(native.sourceNavigation.editId?'正在独立编辑此使用处。应用后保留原图位置、裁剪和效果。':'素材保留保存时版本。来源设计的修改不会自动替换已有素材。'))):null,
   source&&!menu?h(SelectionAi,{controller,native,services:store.get().services,sessionId,feedback,onShowChat:onFocusChat}):null,
   menu==='diagnostics'?h(DesignDiagnostics,{controller,services:store.get().services,sessionId,onClose:async()=>{setMenu(null);try{await controller.resumeHostMenu();}catch(error){setError(error.message);}}}):null,
   native.lastExportReceipt?.source.id===native.sourceId?h('details',{className:'dcNativeNotice'},h('summary',null,(native.lastExportReceipt.source.revision===native.sourceRevision?'本版本':'先前版本')+' PPTX 已导出 · '+native.lastExportReceipt.inspection.slideCount+' 页 · 未执行渲染复核'),h('span',null,'源版本 '+native.lastExportReceipt.source.revision.slice(0,12)+' · 文件 SHA256 '+native.lastExportReceipt.artifact.sha256),h('button',{className:'dcBtn',onClick:()=>saveFile(new File([JSON.stringify(native.lastExportReceipt,null,2)],'PPTX导出回执.json',{type:'application/json'}))},'保存回执')):null,
   native.aiInputNotice?h('div',{className:'dcNativeNotice',role:'status'},h('span',null,native.aiInputNotice),h('button',{className:'dcBtn',onClick:()=>controller.change({aiInputNotice:null})},'知道了')):null,
   native.svgConversionReport?.sourceId===native.sourceId&&native.svgConversionReport.sourceRevision===native.sourceRevision&&!native.dirty?h('div',{className:'dcNativeNotice',role:'status'},'已生成 '+native.svgConversionReport.shapeCount+' 个可编辑对象，原 SVG 已隐藏保留。'+(native.svgConversionReport.textCount?'文字的字体或基线可能不同，请检查版式。':'')):null,
   native.svgConversionRecovery?.sourceId===native.sourceId?h('div',{className:'dcNativeNotice',role:'status'},native.svgConversionRecovery.message):null,
   native.svgConversionPending?.sourceId===native.sourceId&&!native.busy?h('div',{className:'dcNativeNotice'},h('span',null,'SVG 转换结果尚未确认，先核对保存记录。'),h('button',{className:'dcBtn',disabled:!!native.saving,onClick:run(()=>controller.reconcileSvgConversion(native.svgConversionPending.jobId))},'核对 SVG 转换')):null,
   native.brandNotice?h('div',{className:'dcNativeNotice',role:'status'},native.brandNotice):null,
   native.linkedNotice?h('div',{className:'dcNativeNotice',role:'status'},native.linkedNotice):null,
   native.htmlConversionReport?h('div',{className:'dcNativeNotice',role:'status'},'网页已转换为 '+native.htmlConversionReport.slides+' 页演示，含 '+native.htmlConversionReport.nativeShapes+' 个原生形状、'+native.htmlConversionReport.textRuns+' 处文字、'+(native.htmlConversionReport.svgPictures||0)+' 个 SVG 图片和 '+(native.htmlConversionReport.rasterPictures||0)+' 个位图对象。'+(native.htmlConversionReport.note||'')+(native.htmlConversionReport.warnings||[]).join(' ')):null,
   native.imageNotice||imageUndoAvailable?h('div',{className:'dcNativeNotice',role:'status'},h('span',null,native.imageNotice||'当前图片包含已采用的 AI 候选。'),imageUndoAvailable?h('button',{className:'dcBtn',disabled:blocked,onClick:run(()=>controller.undoImageCandidate())},'撤销候选采用'):null):null,
   native.migrationNotice?h('div',{className:'dcNativeNotice',role:'status'},native.migrationNotice):null,
   native.resourceNotice?h('div',{className:'dcNativeNotice',role:'status'},h('span',null,native.resourceNotice),h('button',{className:'dcBtn',onClick:()=>controller.change({resourceNotice:null})},'关闭')):null,
   native.importWarnings?.length?h('div',{className:'dcNativeNotice'},h('span',null,'导入提示：'+native.importWarnings.join('；'))):null,
   native.linkedProgress?h('div',{className:'dcNativeNotice',role:'status'},'正在更新关联 '+native.linkedProgress.index+'/'+native.linkedProgress.total+' · '+native.linkedProgress.title):null,
   (error||native.error||native.healthWarning)?h('div',{className:'dcNativeNotice',role:'alert'},h(StudioIcon,{name:'warning',size:16}),h('span',null,userFacingError(error||native.error||native.healthWarning)),
    native.sourceId?h('button',{className:'dcBtn',disabled:!!native.busy,onClick:run(()=>controller.restoreSaved({checkpointOnly:!!native.unresponsive}))},native.unresponsive?'恢复最近已保存版本':'从已保存版本恢复编辑器'):null):null,
   native.pendingDraft?h('div',{className:'dcNativeNotice','data-kind':'draft'},h('span',null,native.pendingDraft.feedbackRejected?'AI 候选未通过修改范围或人工保护核对，原稿没有被覆盖。': '发现尚未提交的本地草稿，选择恢复后继续。'),
    native.pendingDraft.instanceUpdate?.conversion?h('button',{className:'dcBtn',disabled:!!(native.busy||native.saving),onClick:run(()=>controller.reconcileSvgConversion(native.pendingDraft.instanceUpdate.jobId))},'核对 SVG 转换'):null,
    native.pendingDraft.feedbackRejected?h('button',{className:'dcBtn dcPrimary',disabled:!!(native.busy||native.saving),onClick:run(()=>controller.keepRejectedFeedbackAndRestore())},'保留候选并返回原稿'):native.pendingDraft.imageAdoption?h('button',{className:'dcBtn dcPrimary',disabled:!!(native.busy||native.saving),onClick:run(()=>controller.reconcileImageCandidate())},'核对图片候选'):h('button',{className:'dcBtn dcPrimary',onClick:run(()=>controller.recoverDraft())},'恢复草稿'),
    h('button',{className:'dcBtn',onClick:run(()=>controller.recoverDraft({independent:true}))},'恢复为独立设计')):null,
   menu==='workflows'?h(LocalWorkflowPanel,{controller,onClose:()=>toggle('workflows'),onContinue:workflow=>{const services=store.get().services;if(!isActiveDesignSession(services,sessionId))throw new Error('当前设计对话已切换');insertDesignBrief(services,'继续本项目 OpenDesign 本地工作流 '+workflow.id+'。先用 designcraft_resources workflow_status 和 workflow_read 读取当前真实状态及全部规则；计划 '+workflow.planId+' / '+workflow.planRevision+'。用当前DSH原生/HTML/已配置图片工具生成实际产物，再 workflow_attach 与 workflow_complete；不接已放弃平台、不执行上游脚本、不把关联当视觉验证。');document.querySelector('.dcChat [contenteditable=true]')?.focus();}}):null,
   native.fileAction&&isDeckLocalAction(native.fileAction.action)?h(DeckLocalTools,{key:native.fileAction.id,controller,request:native.fileAction,ready:native.fileDialogReady}):null,
   native.fileAction&&['open','save_as','save_copy','revert','works'].includes(native.fileAction.action)?h('dialog',{ref:fileDialog,className:'dcNativeFileDialog','aria-label':'设计文件操作',onCancel:event=>{event.preventDefault();if(!native.busy)run(cancelFile)();}},h('form',{className:'dcNativeConfirmCard',onSubmit:event=>{event.preventDefault();run(()=>completeFile({title:fileTitle}))();}},
    h('h3',null,({open:'打开设计',save_as:'另存为独立设计',save_copy:'保存一份副本',revert:'恢复最近已保存版本',works:'打开项目作品'})[native.fileAction.action]),
    !native.fileDialogReady?h('p',{role:'status'},'正在准备文件操作…'):null,
    ['save_as','save_copy'].includes(native.fileAction.action)?h('input',{className:'dcInput','aria-label':'设计名称',value:fileTitle,maxLength:200,required:true,disabled:!native.fileDialogReady,onChange:event=>setFileTitle(event.target.value)}):null,
    native.fileAction.action==='open'?h('p',null,photoEnabled?'选择图片、SVG、矢量模板或可编辑源。当前作品会先保存。':'选择 SVG、矢量模板或可编辑的 VectorCraft 源文件。当前作品会先保存。'):null,
    native.fileAction.action==='open'?h('input',{ref:modalInput,type:'file',accept,style:{display:'none'},onChange:importSelection}):null,
    native.fileAction.action==='revert'?h('p',null,'将重新打开最近一次已保存的版本，当前尚未保存的改动不会被采用。'):null,
    native.fileAction.action==='works'?h('p',null,'从项目作品列表选择要继续编辑的设计。'):null,
    native.fileAction.action==='works'?h('div',null,h('input',{className:'dcInput',placeholder:'查找作品','aria-label':'查找作品',value:query,disabled:!native.fileDialogReady,onChange:event=>setQuery(event.target.value)}),h('div',{className:'dcNativeWorksList'},...visible.map(source=>item(source.title||'未命名作品',()=>completeFile({sourceId:source.id}),{key:source.id,disabled:!native.fileDialogReady||!!source.error||!!native.busy,'aria-label':'打开 '+(source.title||'未命名作品')})))):null,
    h('div',{className:'dcNativeConfirmActions'},h('button',{type:'button',className:'dcBtn',disabled:!native.fileDialogReady||!!native.busy,onClick:run(async()=>{await cancelFile();setMenu(null);})},'取消'),
     native.fileAction.action==='open'?h('button',{type:'button',className:'dcBtn dcPrimary',disabled:!native.fileDialogReady||!!(native.busy||native.saving),onClick:()=>modalInput.current?.click()},'选择文件'):null,
     ['save_as','save_copy','revert'].includes(native.fileAction.action)?h('button',{type:'submit',className:'dcBtn dcPrimary',disabled:!native.fileDialogReady||!!native.busy},native.fileAction.action==='revert'?'恢复已保存版本':'保存设计'):null))):null,
   menu==='html'?h(HtmlWorkspace,{key:sessionId+'|'+root,controller,onClose:()=>{setMenu(null);controller.resumeHostMenu().catch(error=>setError(error.message));}}):null,
   menu==='image'&&native.hostMenuReady?h(StudioImageWorkspace,{key:sessionId+'|'+root,controller,onClose:()=>{setMenu(null);controller.resumeHostMenu().catch(error=>setError(error.message));}}):null,
   menu==='stock'&&native.hostMenuReady?h(StockPanel,{key:sessionId+'|'+root,controller,onClose:()=>{setMenu(null);controller.resumeHostMenu().catch(error=>setError(error.message));},onOpenImage:imageId=>openStockImage(controller,()=>setMenu(null),imageId)}):null,
   menu==='migration'&&native.hostMenuReady?h(LegacyMigrationWorkspace,{key:sessionId+'|'+root,controller,onClose:()=>{setMenu(null);controller.resumeHostMenu().catch(error=>setError(error.message));}}):null,
   h('div',{className:'dcNativeStage','data-engine':currentEngine?.id,'data-canvas':source&&!native.advancedEditing?'simple':source?'professional':undefined,hidden:['html','image','stock','migration','workflows'].includes(menu)},
    h('div',{ref:anchor,className:'dcNativeAnchor'}),
    !menu&&source?h(AiCanvasTools,{controller,document:source,disabled:blocked,onError:setError,onQuote:run(quote),onAdvanced:()=>controller.setAdvancedEditing(!native.advancedEditing).catch(error=>setError(error.message)),onPhoto:()=>toggle('image')}):null,
    source&&!menu?h(FeedbackPanel,{native:source,onReview:reviewFeedback}):null,

    native.phase==='opening'?h('div',{className:'dcStudioNativeLoading',role:'status'},h('span',{className:'dcStudioSkeleton','aria-hidden':true}),'正在打开作品…'):null,
    !source&&native.phase!=='opening'?h(Home,{engines:controller.runtime?.engines,disabled:!canUseMenus,onEngine:beginCreate,onImport:()=>input.current?.click(),onWorks:()=>toggle('works'),onFocusChat}):null,
    inspector&&source&&!menu?h(Inspector,{document:source,controller,disabled:blocked,onClose:()=>setInspector(false),onError:cause=>setError(cause.message),ContextTools:NativeContextTools,onQuote:run(quote),onImage:()=>toggle('image')}):null,
    source&&!menu&&!native.advancedEditing?h(CanvasViewControls,{document:source,controller,disabled:blocked,onError:cause=>setError(cause.message)}):null),
   menu==='review'&&review?.epoch===controller.view?.epoch?h('div',{className:'dcNativePopover','data-menu':'review',role:'dialog','aria-label':'AI 修改结果'},
    h(PanelHeading,{title:'AI 修改结果',icon:'ai',onClose:()=>toggle('review')}),
    review.works.length>1?h('select',{className:'dcSelect','aria-label':'选择待核对作品或幻灯片',value:review.index,onChange:event=>setReview({...review,index:Number(event.target.value)})},
     ...review.works.map((work,index)=>h('option',{value:index,key:work.key},work.title))):null,
    h('p',{className:'dcHint'},review.works[review.index].title+(review.works[review.index].decision==='accepted'?' · 已接受':review.works[review.index].decision==='declined'?' · 已拒绝':' · 结果已保存')),
    h('div',{className:'dcStudioReviewPair'},...['before','after'].map(key=>h('figure',{key},h('figcaption',null,key==='before'?'提出意见时':'AI 修改后'),
     h(WorkPreview,{source:{...review.works[review.index],revision:review.works[review.index][key]}})))),
    h('div',{className:'dcNativeConfirmActions'},
     h(StudioButton,{icon:'history',disabled:!native.hostMenuReady,onClick:run(()=>reviewDecision('declined'))},'拒绝并打开修改前副本'),
     h(StudioButton,{icon:'check',className:'dcPrimary',disabled:!native.hostMenuReady,onClick:run(()=>reviewDecision('accepted'))},'接受此结果'))):null,
   menu==='works'?h('div',{className:'dcNativePopover','data-menu':'works',role:'dialog','aria-label':'历史作品'},
    h(PanelHeading,{title:'历史作品',detail:native.sources.length+' 份作品',icon:'folder',onClose:()=>toggle('works')}),
    history?h('section',{className:'dcStudioWorkHistory','aria-label':'作品版本记录'},
     h(StudioButton,{icon:'history',onClick:()=>{historyIntent.current++;setHistory(null);selectHistory(null);setHistoryBusy(false);}},'返回作品'),
     h('h3',null,history.work.title||'未命名作品'),
     historySelection?h(WorkPreview,{source:historySelection}):null,
     historyBusy?h('p',{role:'status'},'正在读取版本…'):null,
     h('div',{className:'dcStudioVersionRows'},...history.items.map((version,index)=>h('button',{
      type:'button',key:version.revision,className:'dcNativeMenuItem','data-current':version.revision===historySelection?.revision,onClick:()=>selectHistory(version),
     },h(StudioIcon,{name:'clock',size:15}),h('span',null,index===0?'最新版本':date(version.at),' · ',version.actor==='agent'?'AI 修改':'已保存')))),
     history.nextOffset!=null?h(StudioButton,{disabled:historyBusy,onClick:()=>loadWorkHistory(history.work,history.nextOffset)},'更多版本'):null,
     historySelection?h(StudioButton,{icon:'plus',className:'dcPrimary',disabled:historyBusy||!native.hostMenuReady,onClick:run(()=>restoreHistoryCopy(historySelection))},'打开为独立副本'):null):
    h(React.Fragment,null,
     h('div',{className:'dcNativeSearch dcStudioWorksFilter'},h('input',{className:'dcInput',placeholder:'查找作品','aria-label':'查找作品',value:query,onChange:event=>setQuery(event.target.value)}),
      h('select',{className:'dcSelect','aria-label':'按作品类型筛选',value:workKind,onChange:event=>setWorkKind(event.target.value)},h('option',{value:''},'全部类型'),...studioEngines.filter(engine=>engine.id!=='motion').map(engine=>h('option',{key:engine.id,value:engine.id},engine.title)))),
     native.hostMenuReady?h('div',{className:'dcNativeWorksList'},visible.length?visible.slice(workPage*9,(workPage+1)*9).map(work=>h('article',{className:'dcStudioWorkCard',key:work.id},
      item(h(React.Fragment,null,h(WorkPreview,{source:work}),h('span',{title:work.title},work.title||'未命名作品',h('small',null,work.error?'文件暂不可用':kindLabel(work.engine)+(work.at?' · '+date(work.at):'')))),
       async()=>{setMenu(null);if(work.id!==native.sourceId)await controller.run('open',{sourceId:work.id});},{disabled:!!work.error||blocked,'data-current':work.id===native.sourceId,'aria-label':'打开 '+(work.title||'未命名作品')}),
      h(StudioButton,{icon:'history',label:'查看 '+(work.title||'未命名作品')+' 的版本',disabled:!!work.error,onClick:()=>loadWorkHistory(work)}))):h('div',{className:'dcNativeMenuEmpty'},query||workKind?'没有匹配的作品':'新建或导入后，作品会出现在这里。')):h('p',{role:'status'},'正在读取项目作品…'),
     visible.length>9?h('div',{className:'dcNativeWorkPages'},h('button',{className:'dcBtn',disabled:workPage===0,onClick:()=>setWorkPage(page=>page-1)},'上一页'),h('span',null,(workPage+1)+' / '+Math.ceil(visible.length/9)),h('button',{className:'dcBtn',disabled:(workPage+1)*9>=visible.length,onClick:()=>setWorkPage(page=>page+1)},'下一页')):null)):null,
   menu==='new'?h('div',{className:'dcNativePopover','data-menu':'new',role:'dialog','aria-label':'自定义新建设计'},
    h(PanelHeading,{title:'新建设计',icon:'plus',onClose:()=>toggle('new')}),
    h('form',{className:'dcStudioCreateForm',onSubmit:createCustom},
     h('div',{className:'dcStudioCreateChoices dcStudioWide','aria-label':'设计类型'},...studioEngines.filter(engine=>engine.id!=='motion'&&controller.runtime?.engines?.[engine.id]).map(engine=>
      h(StudioButton,{key:engine.id,icon:engine.icon,'aria-pressed':newEngine===engine.id,disabled:!native.hostMenuReady,onClick:()=>chooseNewEngine(engine.id)},engine.title))),
     h('label',{className:'dcStudioWide'},'名称',h('input',{className:'dcInput','aria-label':'新设计名称',value:newTitle,maxLength:200,required:true,disabled:!native.hostMenuReady,onChange:e=>setNewTitle(e.target.value)})),
     h('label',null,'宽',h('input',{className:'dcInput',type:'number','aria-label':'设计宽度',value:newWidth,min:1,max:16384,step:1,required:true,disabled:!native.hostMenuReady,onChange:e=>setNewWidth(e.target.value)})),
     h('label',null,'高',h('input',{className:'dcInput',type:'number','aria-label':'设计高度',value:newHeight,min:1,max:16384,step:1,required:true,disabled:!native.hostMenuReady,onChange:e=>setNewHeight(e.target.value)})),
     error?h('div',{className:'dcStudioWide dcChatError',role:'alert'},userFacingError(error)):null,
     h('div',{className:'dcStudioWide dcNativeConfirmActions'},h(StudioButton,{onClick:()=>toggle('new')},'取消'),
      h('button',{type:'submit',className:'dcBtn dcPrimary',disabled:!native.hostMenuReady||!newTitle.trim()},'创建设计')))):null,
   menu==='assets'?h('div',{className:'dcNativePopover','data-menu':'assets',role:'dialog','aria-label':'项目素材'},
    h(PanelHeading,{title:'项目素材',detail:native.project?native.project.assets.length+' 份':'正在读取',icon:'assets',onClose:()=>toggle('assets')}),
    h('div',{className:'dcStudioUtilityRow'},
     h(StudioButton,{disabled:!native.hostMenuReady||!source||!!native.sourceNavigation,onClick:()=>toggle('brands')},'项目品牌色'),
     h(StudioButton,{disabled:!native.hostMenuReady||!!native.sourceNavigation,onClick:()=>toggle('plans')},'设计计划'),
     h(StudioButton,{disabled:!native.hostMenuReady,onClick:()=>toggle('workflows')},'本地工作流')),
    h('div',{className:'dcNativeSearch'},h('input',{className:'dcInput',placeholder:'查找素材','aria-label':'查找素材',value:query,onChange:event=>setQuery(event.target.value)})),
    exports.includes('svg')?item('保存当前设计为矢量素材',async()=>{setMenu(null);await controller.projectAction('derive',{format:'svg',title:native.title});},{disabled:!source||blocked}):null,
    item('保存当前设计为图片素材',async()=>{setMenu(null);await controller.projectAction('derive',{format:'png',title:native.title});},{disabled:!source||blocked}),
    item('建立所选关联（'+linkSelection.length+'处）',async()=>{setMenu(null);await controller.projectAction('link_instances',{instanceIds:linkSelection});setLinkSelection([]);},{disabled:blocked||linkSelection.length<2}),
    native.project?.recoverablePlacements?.map(pending=>item('修复已放入素材的关联',async()=>{await controller.reconcilePlacement(pending.jobId);},{key:pending.jobId,disabled:blocked})),
    native.project?.recoverableInstanceUpdates?.map(pending=>item('确认已保存的原位回写',async()=>{await controller.reconcileInstanceUpdate(pending.operationId);},{key:pending.operationId,disabled:blocked})),
    native.project?.recoverableConversions?.map(pending=>item('核对已保存的 SVG 转换',async()=>{setMenu(null);await controller.reconcileSvgConversion(pending.operationId);},{key:pending.operationId,disabled:blocked,'aria-label':'核对 SVG 转换 '+pending.operationId})),
    native.project?.updates?.filter(update=>update.status!=='succeeded').map(update=>item('继续未完成的关联更新',async()=>{setMenu(null);await controller.projectAction('resume_linked',{updateId:update.id});},{key:update.id,disabled:blocked,'aria-label':'继续关联更新 '+update.id})),
    native.project?.updates?.filter(update=>update.status==='succeeded').slice(-1).map(update=>item('核对最近的关联更新',async()=>{
     const receipt=await controller.api('confirm-linked',{epoch:controller.view.epoch,updateId:update.id});
     controller.change({error:null,linkedNotice:'已核对 '+receipt.checked+' 处已保存更新。'+(receipt.newerSources.length?'有作品在此后继续编辑。':'')});
    },{key:'confirmed-'+update.id,disabled:blocked,'aria-label':'核对关联更新 '+update.id})),
    native.project?.recoveryErrors?.length?h('p',{className:'dcNativeMenuEmpty',role:'alert'},'有操作记录无法读取，请保留当前设计并核对素材使用处。'):null,
    materialItems.slice(assetPage*12,(assetPage+1)*12).map(asset=>{
     const uses=native.project.instances.filter(instance=>instance.assetId===asset.id),present=uses.filter(instance=>instance.status==='present');
     const original=native.project.sources.find(source=>source.id===asset.sourceId);
     const svgReady=asset.format==='svg'&&(controller.view?.engine==='deckcraft'?!!asset.preview&&controller.surface?.capabilities?.preparedSvgPictures===true:controller.view?.engine==='vectorcraft'&&controller.surface?.capabilities?.embeddedSvgSource===true);
     const canPlaceAsset=canPlace&&(asset.format==='png'||svgReady);
     return h('div',{className:'dcNativeAsset',key:asset.id,'data-asset-id':asset.id},
      h('div',{className:'dcNativeAssetTop'},h(MaterialPreview,{asset}),h('div',{className:'dcNativeAssetInfo'},h('strong',null,asset.title),h('small',null,asset.format.toUpperCase()+' · 来源：'+(original?.title||'原生设计')),h('small',null,'固定源版本 · 使用于 '+present.length+' 处'))),
      h('div',{className:'dcNativeAssetActions'},h('button',{className:'dcBtn',disabled:!source||blocked||!canPlaceAsset,title:canPlaceAsset?undefined:'此素材或当前编辑器尚不支持安全置入','aria-label':'放入 '+asset.title,onClick:run(async()=>{setMenu(null);await controller.projectAction('place',{assetId:asset.id});})},'放入当前设计'),h('button',{className:'dcBtn',disabled:blocked||!!native.sourceNavigation||native.sourceId===asset.sourceId,'aria-label':'打开来源 '+asset.title,onClick:run(async()=>{setMenu(null);await controller.projectAction('open_asset',{assetId:asset.id});})},native.sourceId===asset.sourceId?'当前为来源设计':'打开来源设计')),
      ['png','svg'].includes(asset.format)?h(StudioButton,{icon:'motion',disabled:blocked||!native.hostMenuReady,onClick:run(async()=>{
       store.set({motionAssetTransfer:{assetId:asset.id,title:asset.title,format:asset.format,sourceTitle:original?.title||'原生设计',sessionId,root,operationKey:'ui-mat-'+crypto.randomUUID()},workspaceMode:'motion'});
      })},'加入动画素材'):null,
      uses.length?h('div',{className:'dcNativeAssetUses'},...uses.map(use=>{
       const pending=native.project.edits?.find(edit=>edit.instanceId===use.id&&edit.phase==='editing');
       const hidden=!!use.nativeObject?.hidden,canConvert=asset.format==='svg'&&!!asset.preview&&controller.view?.engine==='deckcraft'&&controller.surface?.capabilities?.convertSimpleSvgToShapes===true&&use.sourceId===native.sourceId&&use.status==='present'&&use.nativeObject?.kind==='picture'&&!hidden;
       const currentPage=native.document?.page?.nativePage,targetPage=use.nativeObject?.page,sameSlide=currentPage?.kind==='slide'&&targetPage?.kind==='slide'&&String(targetPage.id)===String(currentPage.id);
       return h('div',{key:use.id,'data-instance-id':use.id},(native.project.sources.find(source=>source.id===use.sourceId)?.title||'设计')+' · '+(use.status==='present'?(hidden?'原 SVG 已隐藏保留':'对象仍在'):use.status==='missing'?'对象已删除':'暂不可核对'),
        use.linkId?h('span',null,' · 已关联'):h('label',null,h('input',{type:'checkbox','aria-label':'选择关联使用处 '+use.id,checked:linkSelection.includes(use.id),disabled:blocked||use.status!=='present'||hidden,onChange:event=>setLinkSelection(ids=>event.target.checked?[...ids,use.id]:ids.filter(id=>id!==use.id))}),'参与关联'),
        use.linkId?h('button',{className:'dcBtn',disabled:blocked,onClick:run(()=>controller.projectAction('unlink_instance',{instanceId:use.id})),'aria-label':'解除关联 '+use.id},'解除关联'):null,
        use.sourceId===native.sourceId&&use.status==='present'?h('button',{className:'dcBtn',disabled:blocked||!!native.sourceNavigation||hidden,'aria-label':(pending?'继续编辑实例 ':'独立编辑实例 ')+use.nativeId,onClick:run(async()=>{setMenu(null);await controller.projectAction('edit_instance',{instanceId:use.id,...(pending?{editId:pending.id}:{})});})},pending?'继续独立编辑':'独立编辑此处'):null,
        canConvert?h('button',{className:'dcBtn',disabled:blocked||!!native.sourceNavigation||!!use.linkId||!sameSlide,title:use.linkId?'请先解除关联':!sameSlide?'请先切换到所在幻灯片':'原 SVG 将隐藏保留；文字字体或基线可能不同','aria-label':'转可编辑形状 '+use.nativeId,onClick:run(async()=>{setMenu(null);await controller.projectAction('convert_svg',{instanceId:use.id});})},'转为可编辑形状'):null,
        canConvert?h('small',null,'原 SVG 将隐藏保留；文字版式可能变化。'):null);
      })):null);
    }),
    native.project&&!materialItems.length?h('div',{className:'dcNativeMenuEmpty'},query?'没有匹配的素材':'保存一份素材，再放入其他设计。素材保留对应的可编辑源版本。'):null,
    materialItems.length>12?h('div',{className:'dcNativeAssetActions'},h('button',{className:'dcBtn',disabled:assetPage===0,'aria-label':'上一页素材',onClick:()=>setAssetPage(page=>page-1)},'上一页'),h('span',null,(assetPage+1)+' / '+Math.ceil(materialItems.length/12)),h('button',{className:'dcBtn',disabled:(assetPage+1)*12>=materialItems.length,'aria-label':'下一页素材',onClick:()=>setAssetPage(page=>page+1)},'下一页')):null):null,
   menu==='variants'?h('div',{className:'dcNativePopover','data-menu':'works',role:'region','aria-label':'作品方案'},
    h('div',{className:'dcNativeMenuTitle'},'作品方案',h('small',null,'每个方案都是独立原生源')),
    h('div',{className:'dcBrandControls'},h('input',{className:'dcInput',style:{width:180},placeholder:'方案名称','aria-label':'方案名称',value:variantLabel,onChange:event=>setVariantLabel(event.target.value)}),
     h('button',{className:'dcBtn dcPrimary',disabled:variantBusy||!native.hostMenuReady||!source||!variantLabel.trim(),onClick:variantRun(async()=>{await controller.variantAction('fork',{sourceRevision:controller.view.sourceRevision,label:variantLabel,operationId:crypto.randomUUID()});setVariantLabel('');})},'从当前作品建立方案')),
    !variantState?h('p',null,'正在读取方案…'):null,
    ...(variantState?.groups||[]).filter(group=>group.originalSourceId===native.sourceId||group.branches.some(branch=>branch.sourceId===native.sourceId)).map(group=>h('section',{key:group.id,className:'dcBrandCard'},
     h('strong',null,group.title),h('p',null,'原作基线 '+group.baseRevision.slice(0,12)+(!group.canAdopt?' · 原作已有新版本':'')),
     h('div',{className:'dcNativeWorksList'},...[{id:group.originalSourceId,title:'原作',revision:group.originalRevision},...group.branches.map(branch=>({id:branch.sourceId,title:branch.label,revision:branch.revision}))].filter(item=>item.revision).map(item=>h('div',{key:item.id,className:'dcNativeMenuItem'},h(WorkPreview,{source:item}),h('span',null,item.title,h('small',null,item.id===native.sourceId?'当前打开':'可编辑源')),h('button',{className:'dcBtn',disabled:variantBusy||item.id===native.sourceId,onClick:run(()=>controller.run('open',{sourceId:item.id}))},'打开')))),
     h('div',{className:'dcBrandControls'},h('button',{className:'dcBtn',disabled:variantBusy||!variantLabel.trim(),onClick:variantRun(async()=>{await controller.variantAction('fork',{sourceRevision:controller.view.sourceRevision,groupId:group.id,label:variantLabel,operationId:crypto.randomUUID()});setVariantLabel('');})},'基于原作新增方案'),
      h('button',{className:'dcBtn dcPrimary',disabled:variantBusy||!group.branches.some(branch=>branch.sourceId===native.sourceId&&branch.modified)||!group.canAdopt,onClick:variantRun(()=>controller.variantAction('adopt',{groupId:group.id,sourceId:native.sourceId,operationId:crypto.randomUUID()}))},'采用当前方案'),
      group.adoption?h('button',{className:'dcBtn',disabled:variantBusy||!group.branches.some(branch=>branch.sourceId===native.sourceId),onClick:variantRun(()=>controller.variantAction('undo',{groupId:group.id,operationId:crypto.randomUUID()}))},'撤销采用'):null),
     !group.canAdopt&&!group.adoption?h('p',null,'原作已变化；不会自动覆盖，请打开双方逐项比较。'):null))):null,
   menu==='export'?h('div',{className:'dcNativePopover','data-menu':'export',role:'menu','aria-label':'导出设计'},
    h('div',{className:'dcNativeMenuTitle'},h(StudioIcon,{name:'download',size:15}),'导出文件'),
    item('可编辑项目包 · ZIP',async()=>saveFile(await controller.exportProjectPackage()),{role:'menuitem',title:'包含项目中已保存的作品、素材、版本和关联关系'}),
    source?item((sourceFormat==='pcraft'?'可编辑图片源 · .':sourceFormat==='deckcraft'?'可编辑演示源 · .':'可编辑设计源 · .')+sourceFormat,()=>download(sourceFormat),{role:'menuitem'}):null,
    source&&exports.includes('svg')?item('SVG 文件',()=>download('svg'),{role:'menuitem',title:'保留原生可导出的矢量路径与文字，嵌入的位图保持位图'}):null,
    source&&exports.includes('pptx')?item('PowerPoint 文件 · .pptx',()=>download('pptx'),{role:'menuitem',title:'幻灯片、文字、形状和内嵌媒体，品牌跨作品更新在 DesignCraft 项目中继续'}):null,
    source&&exports.includes('pdf')?item(sourceFormat==='deckcraft'?'PDF · 全部幻灯片与文字层':'PDF · 矢量画板',()=>download('pdf'),{role:'menuitem',title:sourceFormat==='deckcraft'?'每页为渲染图，并附可搜索、选择和复制的文字层；保留原生形状请使用 PPTX。':'矢量和文字按原生导出器支持的范围保留，图片和部分效果为栅格内容'}):null,
    source&&exports.includes('psd')?item('PSD · 可交换图层',()=>download('psd'),{role:'menuitem',title:'保留受支持的图层与蒙版。完整 Photo 专业源请保存为 .pcraft'}):null,
    source&&exports.includes('webp')?item('WebP 图片',()=>download('webp'),{role:'menuitem',title:'导出合成位图；分层源仍为 .pcraft'}):null,
    source&&exports.includes('tiff')?item('TIFF 图片',()=>download('tiff'),{role:'menuitem',title:'导出合成位图；分层源仍为 .pcraft'}):null,
    source&&exports.includes('jpg')?item(sourceFormat==='deckcraft'?'当前幻灯片 JPEG · 白底':'JPEG 图片 · 白底',()=>download('jpg'),{role:'menuitem',title:'以白底合成透明区域，有损图像'}):null,
    source?item(sourceFormat==='deckcraft'?'当前幻灯片 PNG':'PNG 图片',()=>download('png'),{role:'menuitem'}):null):null,
   menu==='plans'?h('section',{className:'dcNativePopover dcBrandPanel',role:'dialog','aria-label':'设计计划'},
    h('div',{className:'dcBrandControls'},h('strong',null,'设计计划'),h('button',{className:'dcBtn',disabled:planBusy||!native.hostMenuReady,onClick:planRefresh},'刷新'),h('button',{className:'dcBtn',disabled:planBusy||!native.hostMenuReady||!planDraftReady||!!planForm||!!planSavedDraft,onClick:planLinkRun(()=>beginPlanForm('create'))},'新建计划'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>listBriefs())},'查看简报任务')),
    briefPending?h('div',{className:'dcNativeNotice'},h('span',null,'上次设计简报任务尚未确认。'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>checkBrief(briefPending.id))},'核对任务'),h('button',{className:'dcBtn',disabled:planBusy||!planForm,onClick:planLinkRun(()=>completeBrief(briefPending))},'用相同草稿继续'),h('button',{className:'dcBtn',disabled:planBusy,onClick:()=>{sessionStorage.removeItem(briefPendingKey);setBriefPending(null);setPlanLinkNotice('已停止等待；计划和预览可能已保存，请先查看简报任务。');}},'不再等待')):null,
    briefJobs?h('div',{className:'dcBrandControls'},...(briefJobs.items.length?briefJobs.items.map(item=>h('span',{key:item.job.id},item.job.id.slice(-12)+' · '+(item.savedArtifactsComplete?'计划和预览已保存':'部分产物待续'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>checkBrief(item.job.id))},'核对'))):[h('span',{key:'none'},'没有已保存的简报任务。')]),briefJobs.offset>0?h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>listBriefs(Math.max(0,briefJobs.offset-30)))},'上一组'):null,briefJobs.nextOffset!=null?h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>listBriefs(briefJobs.nextOffset))},'下一组'):null,...(briefJobs.pending||[]).map(candidate=>h('button',{key:candidate,className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>recoverBrief(candidate))},'核对简报候选'))):null,
    planSavedDraft&&!planForm?h('div',{className:'dcNativeNotice'},h('span',null,typeof planSavedDraft.token==='string'&&planSavedDraft.token.startsWith('memory-')?'发现仅保留在当前窗口内存的计划草稿。':'发现当前项目的本地计划草稿。'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(restorePlanDraft)},'恢复草稿'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(discardPlanDraft)},'放弃此本地草稿'),h('details',null,h('summary',null,'查看草稿内容'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},String(planSavedDraft.title||'')+'\n'+String(planSavedDraft.brief||'')+'\n'+String(planSavedDraft.content||'')))):null,
    planConflictDraft?h('details',{className:'dcNativeNotice'},h('summary',null,'另一份本地草稿（未覆盖）'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},String(planConflictDraft.title||'')+'\n'+String(planConflictDraft.brief||'')+'\n'+String(planConflictDraft.content||''))):null,
    planForm?h('section',{className:'dcBrandCard','aria-label':'编辑设计计划'},h('strong',null,planForm.mode==='create'?'新建设计计划':'编辑 '+planForm.id+' · 基础 '+planForm.baseRevision.slice(0,12)),h('label',{style:{display:'block',margin:'8px 0'}},'名称',h('input',{className:'dcInput','aria-label':'计划名称',maxLength:200,value:planForm.title,disabled:planBusy,onChange:event=>changePlanForm('title',event.target.value)})),h('label',{style:{display:'block',margin:'8px 0'}},'实际简报',h('textarea',{className:'dcInput','aria-label':'计划简报',style:{display:'block',width:'100%',minHeight:80,boxSizing:'border-box'},maxLength:40000,value:planForm.brief,disabled:planBusy,onChange:event=>changePlanForm('brief',event.target.value)})),planForm.mode==='create'?h('div',{className:'dcBrandControls'},h('strong',null,'OpenDesign 简报规则'),h('select',{'aria-label':'简报输入模式',value:planForm.briefMode||'natural',disabled:planBusy,onChange:event=>changePlanForm('briefMode',event.target.value)},h('option',{value:'natural'},'自然语言（有限关键词）'),h('option',{value:'ilang'},'I-Lang 结构化')),h(BriefDimensionControls,{raw:planForm.briefDimensions,onChange:changeBriefDimension,disabled:planBusy}),h('details',null,h('summary',null,'高级：编辑明确维度 JSON'),h('textarea',{className:'dcInput','aria-label':'明确简报维度 JSON',placeholder:'明确维度 JSON，未填写项会显示默认规则',maxLength:16000,value:planForm.briefDimensions||'{}',disabled:planBusy,onChange:event=>changePlanForm('briefDimensions',event.target.value)})),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(resolveBrief)},'解析并查看默认项'),h('button',{className:'dcBtn',disabled:planBusy||!!briefPending||!briefResolution||briefResolution.sequence!==planForm.sequence,onClick:planLinkRun(createBrief)},'保存规范与网页预览'),h('small',null,'自然语言支持中英文关键词、否定和冲突提示；复杂需求可用上方选项明确指定。未指定项按规则补全，请核对解析结果。')):null,planForm.mode==='create'&&briefResolution?h('details',{open:true},h('summary',null,'查看解析结果和默认项'),h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}},JSON.stringify({dimensions:briefResolution.spec.dimensions,provenance:briefResolution.spec.provenance,defaults:briefResolution.spec.defaults,extra:briefResolution.spec.extra,warnings:briefResolution.spec.warnings},null,2)),h('pre',{style:{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}},briefResolution.design)):null,h('label',{style:{display:'block',margin:'8px 0'}},'设计计划',h('textarea',{className:'dcInput','aria-label':'计划内容',style:{display:'block',width:'100%',minHeight:120,boxSizing:'border-box'},maxLength:80000,value:planForm.content,disabled:planBusy,onChange:event=>changePlanForm('content',event.target.value)})),h('small',null,planForm.mode==='edit'?'保存会保留所选基础版本的来源；如有冲突，草稿不会覆盖已有版本。':'新计划不会自动引用其他计划的来源。'),h('div',{className:'dcBrandControls'},h('button',{className:'dcBtn dcPrimary',disabled:planBusy,onClick:planLinkRun(savePlanForm)},'保存计划'),planForm.mode==='edit'?h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(forkPlanDraft)},'另存为新计划'):null,h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(closePlanForm)},'关闭并保留草稿'))):null,
    planLinkPending?h('div',{className:'dcNativeNotice'},h('span',null,'上次计划关联尚未确认。'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(checkPlanLink)},'核对关联'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>completePlanLink(planLinkPending))},'继续同一关联'),h('button',{className:'dcBtn',disabled:planBusy,onClick:()=>{sessionStorage.removeItem(planLinkPendingKey);setPlanLinkPending(null);setPlanLinkNotice('已停止等待，请查看关联记录。');}},'不再等待')):null,
    planLinkNotice?h('p',{role:'status'},planLinkNotice):null,
    planScope!==currentPlanScope||planRows===null?h('p',null,'正在读取计划…'):planRows.length?h('div',{className:'dcNativeWorksList'},...planRows.map(plan=>h('button',{className:'dcNativeMenuItem',key:plan.id,disabled:planBusy||!!plan.error,onClick:()=>plan.pending?planCheck(plan.id):planRead(plan.id)},(plan.title||plan.id)+(plan.pending?' · 未发布':'')))):h('p',null,'当前项目尚无设计计划，可在对话中创建。'),
    planScope===currentPlanScope&&planCandidates?h('div',{className:'dcBrandCard'},h('strong',null,'未发布版本'),planCandidates.items.length?planCandidates.items.map(candidate=>h('div',{className:'dcBrandControls',key:candidate.revision},h('span',null,candidate.title+' · '+candidate.revision.slice(0,12)+(candidate.temporary?' · 完整临时文件':'')),h('button',{className:'dcBtn',disabled:planBusy,onClick:()=>planCandidate(planCandidates.id,candidate.revision)},'查看'),candidate.canRecover?h('button',{className:'dcBtn',disabled:planBusy,onClick:()=>planRecover(planCandidates.id,candidate.revision,planCandidates.head)},'恢复'):h('small',null,'基础已变化，可在对话中另存'))):h('p',null,'没有可完整恢复的候选。'),planCandidates.invalidTemporary?h('p',null,'至少有 '+planCandidates.invalidTemporary+' 个不完整临时文件，已保留且不会自动恢复。'):null):null,
    planScope===currentPlanScope&&selectedPlan?h('article',{className:'dcBrandCard'},h('strong',null,selectedPlan.plan.title),selectedPlan.unpublished?h('small',null,' · 未发布版本'):h('label',null,'版本 ',h('select',{'aria-label':'设计计划版本',value:selectedPlan.revision,disabled:planBusy,onChange:event=>planRead(selectedPlan.id,event.target.value)},...planHistory.map((row,index)=>h('option',{key:row.revision,value:row.revision},(index===0?'最新 · ':'历史 · ')+row.at+' · '+row.revision.slice(0,12))))),!selectedPlan.unpublished&&planHistory[0]?.revision!==selectedPlan.revision?h('button',{className:'dcBtn',disabled:planBusy,onClick:planRestore},'恢复此版本'):null,!selectedPlan.unpublished?h('button',{className:'dcBtn',disabled:planBusy||planHistory[0]?.revision!==selectedPlan.revision,onClick:planMigrationPreview},'资源版本迁移'):null,planMigration?.id===selectedPlan.id&&planMigration.baseRevision===selectedPlan.revision?h('div',{className:'dcNativeNotice'},h('p',null,planMigration.note),...planMigration.items.map(item=>h('p',{key:item.resourceId+'|'+item.file},item.file+' · '+item.fromSha256.slice(0,10)+' → '+(item.targetSha256?.slice(0,10)||'新版无同名文件')+(item.contentChanged?' · 规则内容有变化':''))),h('button',{className:'dcBtn',disabled:planBusy||!planMigration.items.some(item=>item.available),onClick:planMigrate},'按预览迁移可用引用'),h('button',{className:'dcBtn',disabled:planBusy,onClick:()=>setPlanMigration(null)},'取消迁移')):null,!selectedPlan.unpublished?h('button',{className:'dcBtn',disabled:planBusy,onClick:()=>planCheck(selectedPlan.id)},'检查未发布内容'):null,!selectedPlan.unpublished?h('button',{className:'dcBtn',disabled:planBusy||!planDraftReady||!!planForm||!!planSavedDraft,onClick:planLinkRun(()=>beginPlanForm('edit'))},'编辑此版本'):null,!selectedPlan.unpublished?h('div',{className:'dcBrandControls'},h('button',{className:'dcBtn',disabled:planBusy||!!planLinkPending||!controller.view?.sourceId||!controller.view?.sourceRevision,onClick:planLinkRun(addPlanLink)},'关联当前已保存作品'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>loadPlanLinks(selectedPlan.id))},'查看关联作品'),h('small',null,'关联是明确声明，指向保存版本，不证明生成过程或视觉效果。')):null,!selectedPlan.unpublished&&planLinks?.planId===selectedPlan.id?h('div',{className:'dcBrandControls'},...(planLinks.items.length?planLinks.items.map(item=>h('span',{key:item.link.id},item.link.engine+' · '+item.link.sourceId+' · 作品 '+item.link.sourceRevision.slice(0,12)+' · 计划 '+item.link.planRevision.slice(0,12)+(item.link.planRevision===selectedPlan.revision?'（当前）':'（其他版本）')+' · '+(item.active?'声明中':'已停用'),h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>verifyPlanLink(item.link.id))},'核对版本'),item.active?h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>disablePlanLink(item.link.id))},'停用关联'):null)):[h('span',{key:'none'},'没有已保存关联。')]),planLinks.offset>0?h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>loadPlanLinks(selectedPlan.id,Math.max(0,planLinks.offset-30)))},'上一组'):null,planLinks.nextOffset!=null?h('button',{className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>loadPlanLinks(selectedPlan.id,planLinks.nextOffset))},'下一组'):null,...(planLinks.pending||[]).map(candidate=>h('button',{key:candidate,className:'dcBtn',disabled:planBusy,onClick:planLinkRun(()=>recoverPlanLink(candidate))},'核对关联候选'))):null,h('p',null,'简报'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},selectedPlan.plan.brief),h('p',null,'设计计划'),h('pre',{style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}},selectedPlan.plan.content),h('small',null,(selectedPlan.unpublished?'这是未发布内容。':planHistory[0]?.revision===selectedPlan.revision?'这是读取时的最新版本。':'这是历史版本。')+'引用 '+selectedPlan.plan.sources.length+' 个来源。'),selectedPlan.plan.sources.length?h('details',null,h('summary',null,'查看引用来源'),h('ul',null,...selectedPlan.plan.sources.map(source=>h('li',{key:source.resourceId+':'+(source.file||'')},source.fileKey?'Figma '+source.fileKey+' / '+source.nodeId+' · 版本 '+source.version+' · '+source.sha256.slice(0,12):source.resourceId.startsWith('external-')?'创意指导 / '+source.file+' · '+source.gitSha1.slice(0,12):(source.packageId||'外部原包 '+source.bundleId.slice(0,26))+'/'+source.file+' · '+source.gitSha1.slice(0,12))))):null):null):null,
   menu==='brands'?h(BrandPanel,{snapshot:native.brands,sources:native.sources,working:blocked||!native.hostMenuReady,canBind:!!controller.surface?.capabilities?.brandColorIdentity,canBindFont:!!controller.surface?.capabilities?.brandFontIdentity,submit:payload=>run(()=>controller.projectAction('brand',payload))(),searchStyles:(query,offset)=>controller.htmlResource('search',{query,offset,kind:'design-system'}),loadStyle:id=>controller.htmlResource('style',{id}),retainPackage:id=>controller.htmlResource('retain-package',{id}),listThemes:()=>controller.htmlResource('external-list',{id:'skills/theme-factory'}),listThemeFiles:(bundleId,offset)=>controller.htmlResource('external-files',{bundleId,offset}),loadTheme:(bundleId,file)=>controller.htmlResource('external-theme',{bundleId,file}),checkContrast:(foreground,background)=>controller.htmlResource('color-contrast',{foreground,background}),auditColors:async()=>{await controller.checkpointHostPanel();return controller.htmlResource('color-audit');},convertColor:foreground=>controller.htmlResource('color-convert',{foreground,space:'oklch'})}):null,
   menu==='versions'?h('section',{className:'dcNativePopover dcBrandPanel',role:'dialog','aria-label':'版本信息'},
    native.versions?h(React.Fragment,null,h('p',null,'磁盘 '+native.versions.disk.version+' · UI'+native.versions.disk.uiBuild),
     h('p',null,'当前后台 '+native.versions.host.version+' · UI'+native.versions.host.uiBuild+'　当前界面 UI'+state.uiBuild),
     state.uiBuild!==native.versions.disk.uiBuild||native.versions.host.version!==native.versions.disk.version?h('p',{role:'status'},'磁盘与加载版本不同。保存作品后，可在方便时重新打开 DSH。'):null,
     ...Object.entries(native.versions.disk.engines).map(([id,item])=>{
      const live=native.versions.surface?.engine===id?native.versions.surface:null;
      const observed=!live?'未在当前画布打开':!live.wasmFile?'当前加载文件尚未确认':live.wasmFile===item.wasmFile?'当前画布已加载此构建':'当前画布加载了其他构建';
      return h('p',{key:id},kindLabel(id)+' · '+item.version+' · '+(item.valid?observed:'安装文件待核对'));
     })):h('span',null,'正在读取版本信息…')):null,
   menu==='more'?h('div',{className:'dcNativePopover','data-menu':'more',role:'menu','aria-label':'更多操作'},
    h('button',{className:'dcNativeMenuItem',disabled:!native.hostMenuReady,onClick:()=>toggle('diagnostics')},'设计诊断与帮助'),
    h('button',{className:'dcNativeMenuItem',disabled:!native.hostMenuReady,onClick:()=>toggle('assets')},'项目素材'),
    h('button',{className:'dcNativeMenuItem',disabled:!native.hostMenuReady||!!native.sourceNavigation,onClick:()=>toggle('html')},'网页设计'),
    h('button',{className:'dcNativeMenuItem',disabled:!native.hostMenuReady||!photoEnabled,onClick:()=>toggle('image')},'图片生成与局部重绘'),
    h('button',{className:'dcNativeMenuItem',disabled:!native.hostMenuReady||!!native.sourceNavigation,onClick:()=>toggle('stock')},'在线找图'),
    h('button',{className:'dcNativeMenuItem',disabled:!native.hostMenuReady||!!native.sourceNavigation,onClick:()=>toggle('migration')},'迁移旧作品'),
    h('button',{className:'dcNativeMenuItem',disabled:!native.hostMenuReady,onClick:()=>toggle('versions')},'版本信息'),
    controller.view?.engine&&controller.view.engine!=='vectorcraft'?item('新建画板',async()=>{setMenu(null);await create('vectorcraft');},{role:'menuitem',disabled:blocked}):null,
    photoEnabled?item('新建图片',async()=>{setMenu(null);await create('photocraft');},{role:'menuitem',disabled:blocked}):null,
    deckEnabled?item('新建演示文稿',async()=>{setMenu(null);await create('deckcraft');},{role:'menuitem',disabled:blocked}):null,
    item('保存设计',async()=>{setMenu(null);await controller.flush();},{role:'menuitem',disabled:!source||blocked}),
    item('另存为独立设计',async()=>{setMenu(null);await controller.requestHostFile('save_as');},{role:'menuitem',disabled:!source||blocked||!!native.sourceNavigation}),
    item('保存一份副本',async()=>{setMenu(null);await controller.requestHostFile('save_copy');},{role:'menuitem',disabled:!source||blocked||!!native.sourceNavigation}),
    item('关闭当前设计',async()=>{setMenu(null);await controller.requestHostFile('close');},{role:'menuitem',disabled:!source||blocked||!!native.sourceNavigation}),
    item('引用当前设计',async()=>{setMenu(null);await quote();},{role:'menuitem',disabled:!source||blocked}),
    item('重新打开已保存版本',async()=>{setMenu(null);await controller.restoreSaved();},{role:'menuitem',disabled:!source||blocked}),
    h('div',{className:'dcNativeMenuDivider'}),
    item(h('span',null,'旧作品',h('small',null,'查看旧版作品与迁移入口')),()=>{setMenu(null);store.set({workspaceMode:'legacy'});},{role:'menuitem',disabled:!!native.busy,'aria-label':'旧作品'})):null,
   pendingDownload?h('div',{className:'dcNativeConfirm'},h('div',{className:'dcNativeConfirmCard',role:'dialog','aria-label':'导出变化说明'},h('h3',null,'导出包含以下变化'),
    h('ul',null,...pendingDownload.designcraftWarnings.map((text,index)=>h('li',{key:index},String(text)))),
    h('div',{className:'dcNativeConfirmActions'},h('button',{className:'dcBtn',onClick:()=>setPendingDownload(null)},'取消'),
     h('button',{className:'dcBtn dcPrimary',onClick:()=>{saveFile(pendingDownload);setPendingDownload(null);}},'继续下载')))):null);
 }
 return {Workspace,controller};
}
