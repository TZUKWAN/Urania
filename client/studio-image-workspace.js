import {createImageApiSettings} from './image-api-settings.js?v=169';
import {createStockPanel,openStockImage} from './stock-panel.js?v=169';
import {imageBaselineMatches} from './image-adoption.js?v=169';
import {createPixelbinWorkspace} from './pixelbin-workspace.js?v=169';
import {createEcommercePanel} from './ecommerce-panel.js?v=169';
import {createWorkflowImagePanel} from './workflow-image-panel.js?v=169';
import {createFalRealtimePanel} from './fal-realtime-panel.js?v=169';
import {createFalWorkflowPanel} from './fal-workflow-panel.js?v=169';
import {createStudioComponents,userFacingError} from './studio-system.js?v=169';
const API='/designcraft/api/v2/studio/image';

async function checksum(bytes){
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('');
}

export function createStudioImageWorkspace(React){
 const h=React.createElement;
 const {Icon,Button}=createStudioComponents(React);
 const ImageApiSettings=createImageApiSettings(React);
 const StockPanel=createStockPanel(React);
 const PixelbinWorkspace=createPixelbinWorkspace(React);
 const EcommercePanel=createEcommercePanel(React);
 const WorkflowImagePanel=createWorkflowImagePanel(React);
 const FalRealtimePanel=createFalRealtimePanel(React);
 const FalWorkflowPanel=createFalWorkflowPanel(React);
 function Preview({controller,job,candidate,epoch,variant='preview'}){
  const [url,setUrl]=React.useState(''),[error,setError]=React.useState(false);
  React.useEffect(()=>{
   const abort=new AbortController();let created;setUrl('');setError(false);
   const q=new URLSearchParams({epoch,id:job.id,candidateId:candidate.id,variant});
   fetch(API+'-file?'+q,{headers:controller.sourceHeaders(),signal:abort.signal}).then(async response=>{
    if(!response.ok)throw new Error('图片预览不可用');
    const bytes=await response.arrayBuffer();if(await checksum(bytes)!==response.headers.get('x-content-sha256'))throw new Error('图片预览摘要不一致');
    if(!abort.signal.aborted){created=URL.createObjectURL(new Blob([bytes],{type:response.headers.get('content-type')||'application/octet-stream'}));setUrl(created);}
   }).catch(()=>{if(!abort.signal.aborted)setError(true);});
   return()=>{abort.abort();if(created)URL.revokeObjectURL(created);};
  },[job.id,candidate.id,epoch,variant]);
  return url?h('img',{src:url,alt:variant==='returned'?'服务返回的原图':'方案 '+(candidate.index+1),className:'dcStudioImagePreview'}):
   h('div',{className:'dcStudioImagePreview dcStudioImagePlaceholder',role:'status'},error?'预览暂不可用':'正在读取预览…');
 }
 function BaselinePreview({controller,epoch,baseline}){
  const [result,show]=React.useState(null);
  React.useEffect(()=>{
   const abort=new AbortController();let url;
   const query=new URLSearchParams({epoch,id:baseline.sourceId,revision:baseline.sourceRevision});
   fetch('/designcraft/api/v2/studio/overview-preview?'+query,{headers:controller.sourceHeaders(),signal:abort.signal}).then(async response=>{
    if(!response.ok||response.headers.get('x-source-revision')!==baseline.sourceRevision)throw new Error('原图版本未能读取');
    const blob=await response.blob();
    if(!abort.signal.aborted){url=URL.createObjectURL(blob);show({url});}
   }).catch(()=>{if(!abort.signal.aborted)show({error:true});});
   return()=>{abort.abort();if(url)URL.revokeObjectURL(url);};
  },[controller,epoch,baseline.sourceId,baseline.sourceRevision]);
  return result?.url?h('img',{className:'dcStudioImagePreview',src:result.url,alt:'重绘前已保存原图'}):
   h('div',{className:'dcStudioImagePreview dcStudioImagePlaceholder',role:'status'},result?.error?'无法读取原图版本':'正在读取原图…');
 }
 function Compare({controller,epoch,job,candidate,onClose,onApply,disabled}){
  const dialog=React.useRef(null);
  const alternatives=job.candidates.filter(value=>value.id!==candidate.id);
  const baseline=job.mode==='edit'?job.studio?.source:null;
  const [other,setOther]=React.useState(alternatives[0]?.id||'');
  const alternative=alternatives.find(value=>value.id===other);
  React.useLayoutEffect(()=>{
   const element=dialog.current;element?.showModal();
   return()=>{if(element?.open)element.close();};
  },[]);
  return h('dialog',{ref:dialog,className:'dcStudioImageCompare','aria-label':'比较图片方案',onCancel:event=>{event.preventDefault();onClose();}},
   h('header',{className:'dcStudioDialogHeading'},h(Icon,{name:'photo'}),h('strong',null,'比较图片方案'),h(Button,{icon:'close',label:'关闭图片比较',onClick:onClose})),
   !baseline&&alternatives.length>1?h('select',{className:'dcSelect','aria-label':'比较其他方案',value:other,onChange:event=>setOther(event.target.value)},
    ...alternatives.map(value=>h('option',{key:value.id,value:value.id},'方案 '+(value.index+1)))):null,
   h('div',{className:'dcStudioImageCompareGrid'},
    baseline||alternative?h('figure',null,h('figcaption',null,baseline?'修改前':'方案 '+(alternative.index+1)),
      baseline?h(BaselinePreview,{controller,epoch,baseline}):h(Preview,{controller,epoch,job,candidate:alternative})):null,
    h('figure',null,h('figcaption',null,baseline?'候选结果':'方案 '+(candidate.index+1)),h(Preview,{controller,epoch,job,candidate}))),
   h('footer',{className:'dcNativeConfirmActions'},h(Button,{onClick:onClose},'关闭预览'),
    onApply?h(Button,{icon:'check',className:'dcPrimary',disabled,onClick:onApply},'采用候选'):null));
 }
 return function StudioImageWorkspace({controller,onClose}){
  const root=React.useRef(controller.view.root),epoch=React.useRef(controller.view.epoch);
  const [catalog,setCatalog]=React.useState({providers:[],models:[]}),[provider,setProvider]=React.useState(''),[model,setModel]=React.useState('');
  const [stockOpen,setStockOpen]=React.useState(false),[apiSettingsOpen,setApiSettingsOpen]=React.useState(false),[catalogRevision,setCatalogRevision]=React.useState(0),[moreServicesOpen,setMoreServicesOpen]=React.useState(false);
  const [pixelbinOpen,setPixelbinOpen]=React.useState(false),[ecommerceOpen,setEcommerceOpen]=React.useState(false),[workflowImageOpen,setWorkflowImageOpen]=React.useState(false),[falRealtimeOpen,setFalRealtimeOpen]=React.useState(false),[falWorkflowOpen,setFalWorkflowOpen]=React.useState(false);
  const [plans,setPlans]=React.useState([]),[selectedPlan,setSelectedPlan]=React.useState('');
  const [jobs,setJobs]=React.useState([]),[mode,setMode]=React.useState(controller.view.engine==='photocraft'&&controller.state.document?.nativeSelection?.data?.rasterSelection?'edit':'generate');
  const [comparison,setComparison]=React.useState(null);
  const [prompt,setPrompt]=React.useState(''),[count,setCount]=React.useState(1),[resolution,setResolution]=React.useState(''),[ratio,setRatio]=React.useState(''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[choices,setChoices]=React.useState(null);
  const [transparentBackground,setTransparentBackground]=React.useState(false),[quality,setQuality]=React.useState('');
  const [transformCatalog,setTransformCatalog]=React.useState({providers:[]}),[transformProvider,setTransformProvider]=React.useState(''),[upscaleFactor,setUpscaleFactor]=React.useState(2),[upscaleCreativity,setUpscaleCreativity]=React.useState('0.01'),[transformNotice,setTransformNotice]=React.useState('');
  const isTransform=mode==='venice_upscale'||mode==='venice_remove_background';
  const [references,setReferences]=React.useState([]),referenceInput=React.useRef(null),[styleReferences,setStyleReferences]=React.useState([]),styleReferenceInput=React.useRef(null),[styleStrength,setStyleStrength]=React.useState(''),[styleNotice,setStyleNotice]=React.useState('');
  const pendingKey='designcraft-image-submit:'+root.current;
  const [pending,setPending]=React.useState(()=>{const raw=sessionStorage.getItem(pendingKey);if(!raw)return null;try{return JSON.parse(raw);}catch{return {id:raw,payload:null};}}),[pendingNotFound,setPendingNotFound]=React.useState(false);
  const alive=React.useRef(true),actionLock=React.useRef(false);
  const call=async(action,body={})=>{
   if(controller.view?.root!==root.current||controller.view?.epoch!==epoch.current)throw new Error('设计工作区已切换，先重新打开图片面板');
   const response=await fetch(API,{method:'POST',headers:{...controller.sourceHeaders(),'content-type':'application/json'},body:JSON.stringify({action,epoch:epoch.current,...body})});
   const result=await response.json();if(controller.view?.root!==root.current||controller.view?.epoch!==epoch.current)throw new Error('设计工作区已切换，请重新打开图片面板核对结果');if(!response.ok||!result.ok)throw Object.assign(new Error(result.error||'图片工作区请求失败'),{knownRejection:true,status:response.status});return result;
  };
  React.useEffect(()=>{let active=true;call('plans').then(data=>{if(active)setPlans(data.plans.filter(row=>!row.error&&!row.pending&&row.revision));}).catch(e=>active&&setError(e.message));return()=>{active=false;};},[]);
  const refresh=async()=>{const result=await call('list');if(alive.current)setJobs(result.jobs);};
  const run=fn=>async()=>{if(actionLock.current)return;actionLock.current=true;setBusy(true);setError('');try{await fn();}catch(e){if(alive.current)setError(e.message||String(e));}finally{actionLock.current=false;if(alive.current)setBusy(false);}};
  React.useEffect(()=>{alive.current=true;refresh().catch(e=>alive.current&&setError(e.message));const timer=setInterval(()=>refresh().catch(()=>{}),3000);return()=>{alive.current=false;clearInterval(timer);};},[]);
  React.useEffect(()=>{
   if(isTransform||apiSettingsOpen)return;
   let active=true;call('catalog',{provider:provider||undefined}).then(result=>{
    if(!active)return;setCatalog(result);const usable=result.models.filter(item=>mode!=='edit'||item.inputImage&&(!Number.isSafeInteger(item.maxInputImages)||item.maxInputImages>=2));setModel(current=>usable.some(item=>item.id===current)?current:(usable[0]?.id||''));
   }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
  },[provider,mode,apiSettingsOpen,catalogRevision]);
  React.useEffect(()=>{
   if(!isTransform||apiSettingsOpen)return;let active=true;call('transform-catalog').then(result=>{if(!active)return;setTransformCatalog(result);setTransformProvider(value=>result.providers.some(item=>item.id===value)?value:(result.providers[0]?.id||''));}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
  },[mode,apiSettingsOpen,catalogRevision]);
  const selected=catalog.models.find(item=>item.id===model),canEdit=controller.view.engine==='photocraft'&&!!controller.state.document?.nativeSelection?.data?.rasterSelection;
  const canStyle=mode==='generate'&&!references.length&&Number.isSafeInteger(selected?.styleReferenceMax)&&selected.styleReferenceMax>0;
  const transparentKnown=typeof selected?.transparentGenerate==='boolean'||typeof selected?.transparentEdit==='boolean',supportsTransparent=mode==='generate'&&(references.length?selected?.transparentEdit:selected?.transparentGenerate)===true;
  React.useEffect(()=>{if(!supportsTransparent)setTransparentBackground(false);},[supportsTransparent]);
  const qualityValues=(!isTransform&&(mode==='edit'||references.length?selected?.qualityEdit:selected?.qualityGenerate)||[]).filter(value=>['low','medium','high','xhigh','max'].includes(value));
  React.useEffect(()=>{if(quality&&!qualityValues.includes(quality))setQuality('');},[mode,model,provider,qualityValues.join(',')]);
  const values=spec=>Array.isArray(spec?.values)?spec.values.filter(value=>typeof value==='string').slice(0,32):[];
  const useEditSizing=mode==='edit'||references.length>0,veniceSizing=selected?.veniceSizing===true;
  const resolutions=selected?.openAiSizing&&mode==='edit'?[]:veniceSizing?values({values:useEditSizing?selected?.resolutionsEdit:selected?.resolutionsGenerate}):values(selected?.parameters?.resolution),ratios=veniceSizing&&(mode==='edit'||mode==='generate'&&references.length===1&&selected?.singleImageAspectRatio===false)?[]:veniceSizing?values({values:useEditSizing?selected?.aspectsEdit:selected?.aspectsGenerate}):values(selected?.parameters?.aspect_ratio);
  React.useEffect(()=>{setResolution('');setRatio('');},[provider,model]);
  React.useEffect(()=>{if(resolution&&!resolutions.includes(resolution))setResolution('');if(ratio&&!ratios.includes(ratio))setRatio('');},[mode,references.length,resolutions.join(','),ratios.join(',')]);
  const addReferences=async files=>{
   if(styleReferences.length)throw new Error('请先移除风格参考图，再添加普通参考图');
   if(!files.length)return;if(references.length+files.length>(isTransform?1:4)||files.some(file=>!file.size||file.size>8*1024*1024)||references.reduce((sum,item)=>sum+item.bytes,0)+files.reduce((sum,file)=>sum+file.size,0)>16*1024*1024)throw new Error(isTransform?'图片处理需要一张不超过 8 MiB 的图片':'参考图最多4张，单张8MiB，合计16MiB');
   if(!isTransform&&Number.isSafeInteger(selected?.maxInputImages)&&references.length+files.length+(mode==='edit'?2:0)>selected.maxInputImages)throw new Error('所选文件数量超过当前模型参考图上限');
   const collected=[];
   for(const file of files){
    const response=await fetch(API+'-reference?'+new URLSearchParams({epoch:epoch.current}),{method:'POST',headers:{...controller.sourceHeaders(),'content-type':'application/octet-stream'},body:file});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'参考图未保存');
    if(await checksum(await file.arrayBuffer())!==result.sha256)throw new Error('参考图保存摘要不一致');
    collected.push({...result,label:file.name});
   }
   setReferences(old=>[...old,...collected]);setTransformNotice('');
  };
  const addStyleReferences=async files=>{
   if(!files.length)return;if(!canStyle||styleReferences.length+files.length>selected.styleReferenceMax||files.some(file=>!file.size||file.size>=8000000)||styleReferences.reduce((sum,item)=>sum+item.bytes,0)+files.reduce((sum,file)=>sum+file.size,0)>16*1024*1024)throw new Error('风格参考图数量或大小超过当前模型及工作区限制');
   const collected=[];for(const file of files){const response=await fetch(API+'-reference?'+new URLSearchParams({epoch:epoch.current}),{method:'POST',headers:{...controller.sourceHeaders(),'content-type':'application/octet-stream'},body:file}),result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'风格参考图未保存');if(await checksum(await file.arrayBuffer())!==result.sha256)throw new Error('风格参考图保存摘要不一致');collected.push({...result,label:file.name});}
   setStyleReferences(old=>[...old,...collected]);setStyleNotice('');
  };
  const useCurrentStyle=async()=>{if(!canStyle||controller.view.engine!=='photocraft'||!controller.state.document)throw new Error('请先打开可用的原生图片');const file=await controller.export('png');await addStyleReferences([file]);setStyleNotice('已保存当前图片的合成快照作为风格参考，原图片源保留。'+(file.designcraftWarnings?.length?' '+file.designcraftWarnings.join('；'):''));};
  const useCurrentPhoto=async()=>{
   if(!isTransform||controller.view.engine!=='photocraft'||!controller.state.document)throw new Error('请先打开当前原生图片');
   const file=await controller.export('png');await addReferences([file]);
   setTransformNotice('已保存当前图片的合成快照作为输入，原图片源保留。'+(file.designcraftWarnings?.length?' '+file.designcraftWarnings.join('；'):''));
  };
  const start=async()=>{
   if(pending)throw new Error('上一图片请求的接收状态尚未确认，请先核对任务列表');
   if(mode==='edit'&&!canEdit)throw new Error('请返回图片画布并创建原生选区');
   if(mode==='edit'&&references.length>2)throw new Error('局部重绘最多另加两张参考图');
   if(styleReferences.length&&(!canStyle||styleReferences.length>selected.styleReferenceMax))throw new Error('当前模式或模型不支持已选风格参考图，请移除后重试');
   if(styleStrength.trim()&&(!styleReferences.length||selected?.styleReferenceStrength!==true||!Number.isFinite(Number(styleStrength))||Number(styleStrength)<0.1||Number(styleStrength)>1))throw new Error('风格强度仅在模型支持时可填 0.1 至 1');
   if(transparentBackground&&!supportsTransparent)throw new Error('当前模型未声明此端点支持透明背景');
   if(!isTransform&&(provider||catalog.provider)!==catalog.provider)throw new Error('图片服务目录正在切换，请等待后再提交');
   if(!isTransform&&quality&&!qualityValues.includes(quality))throw new Error('当前模型没有可核对的所选画质');
   if(!isTransform&&(resolution&&!resolutions.includes(resolution)||ratio&&!ratios.includes(ratio)))throw new Error('当前模型没有可核对的所选尺寸或比例');
   if(isTransform&&(!transformProvider||references.length!==1))throw new Error('请选择已配置的 Venice 服务和一张原图');
   if(mode==='venice_upscale'&&(![2,4].includes(Number(upscaleFactor))||upscaleCreativity.trim()===''||!Number.isFinite(Number(upscaleCreativity))||Number(upscaleCreativity)<0||Number(upscaleCreativity)>0.02))throw new Error('放大倍数须为 2 或 4，创意强度须为 0 至 0.02');
   const document=controller.state.document;
   const pinDocumentedSizing=(veniceSizing||selected?.openAiSizing===true)&&!!(resolution||ratio),operationId=crypto.randomUUID(),payload=isTransform?{operationId,mode,provider:transformProvider,referenceAssets:references.map(item=>item.name),referenceHashes:references.map(item=>item.sha256),...(mode==='venice_upscale'?{scale:Number(upscaleFactor),creativity:Number(upscaleCreativity)}:{})}:{operationId,mode,...(selectedPlan?{planId:selectedPlan.split('|')[0],planRevision:selectedPlan.split('|')[1]}:{}),provider:provider||catalog.provider,...(catalog.connectionFingerprint?{connectionFingerprint:catalog.connectionFingerprint}:{}),model,prompt,count:Number(count),...(resolution?{resolution}:{}),...(ratio?{aspectRatio:ratio}:{}),...(transparentBackground?{transparentBackground:true}:{}),...(quality?{quality}:{}),...(mode==='generate'&&(transparentBackground||quality||pinDocumentedSizing)?{referenceHashes:references.map(item=>item.sha256)}:{}),...(mode==='edit'&&(quality||pinDocumentedSizing)?{editReferenceHashes:references.map(item=>item.sha256)}:{}),...(styleReferences.length?{styleReferenceAssets:styleReferences.map(item=>item.name),styleReferenceHashes:styleReferences.map(item=>item.sha256),...(styleStrength.trim()?{styleReferenceStrength:Number(styleStrength)}:{})}:{}),referenceAssets:references.map(item=>item.name),sourceId:controller.view.sourceId,sourceRevision:controller.view.sourceRevision,selectionStamp:document?.selectionStamp},record={id:operationId,payload};
   sessionStorage.setItem(pendingKey,JSON.stringify(record));setPending(record);setPendingNotFound(false);
   try{await call('start',payload);sessionStorage.removeItem(pendingKey);setPending(null);}
   catch(failure){if(failure.knownRejection&&[400,403,413,422].includes(failure.status)){sessionStorage.removeItem(pendingKey);setPending(null);}throw failure;}
   await refresh();
  };
  const checkPending=async()=>{const result=await call('list'),found=result.jobs.some(job=>job.id==='image-'+pending.id);setJobs(result.jobs);if(!found){setPendingNotFound(true);throw new Error('暂未找到上次请求的接收记录；请稍后核对，系统不会自动重发');}sessionStorage.removeItem(pendingKey);setPending(null);setPendingNotFound(false);};
  const resumePending=async()=>{if(!pending?.payload)throw new Error('缺少上次请求参数，请先核对任务状态');await call('start',pending.payload);sessionStorage.removeItem(pendingKey);setPending(null);setPendingNotFound(false);await refresh();};
  const adopt=async(job,candidate,chosen)=>{
   const options=await call('matches',{id:job.id,candidateId:candidate.id});
   if(!chosen&&options.sources.length>1){setChoices({job,candidate,sources:options.sources});return;}
   const match=chosen?options.sources.find(item=>item.sourceId===chosen):options.sources[0];
   if(chosen&&!match)throw new Error('候选来源已变化，请重新选择');
   let bytes;
   if(!match){
    const q=new URLSearchParams({epoch:epoch.current,id:job.id,candidateId:candidate.id,variant:'source'}),response=await fetch(API+'-file?'+q,{headers:controller.sourceHeaders()});
    if(!response.ok)throw new Error((await response.json()).error||'候选源读取失败');
    bytes=await response.arrayBuffer();if(await checksum(bytes)!==response.headers.get('x-content-sha256')||await checksum(bytes)!==candidate.sourceHash)throw new Error('候选源摘要不一致，未打开');
   }
   const initialRoot=root.current;await controller.resumeHostMenu();
   if(match)await controller.run('open',{sourceId:match.sourceId});
   else await controller.importFile(new File([bytes],'AI-候选-'+(candidate.index+1)+'.pcraft',{type:'application/octet-stream'}));
   if(controller.view.root!==initialRoot)throw new Error('工作区已切换，候选原件仍保留');
   epoch.current=controller.view.epoch;
   await call('link',{id:job.id,candidateId:candidate.id,sourceId:controller.view.sourceId});
   controller.change({imageNotice:'已打开独立的可编辑图片方案，原作品及其他候选仍保留。'});onClose();
  };
  const applyCurrent=async(job,candidate)=>{
   const q=new URLSearchParams({epoch:epoch.current,id:job.id,candidateId:candidate.id,variant:'source'}),response=await fetch(API+'-file?'+q,{headers:controller.sourceHeaders()});
   if(!response.ok)throw new Error((await response.json()).error||'候选源读取失败');
   const bytes=await response.arrayBuffer();if(await checksum(bytes)!==candidate.sourceHash||response.headers.get('x-content-sha256')!==candidate.sourceHash)throw new Error('候选源摘要不一致，未覆盖原图');
   await controller.adoptImageCandidate({bytes,job,candidate});onClose();
  };
  const openWorkflowImage=async imageId=>{
   await controller.resumeHostMenu();const root=controller.view.root,currentEpoch=controller.view.epoch,headers=controller.sourceHeaders();onClose();await new Promise(resolve=>requestAnimationFrame(resolve));
   try{const response=await fetch('/designcraft/api/v2/studio/workflow-images',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'open',epoch:currentEpoch,imageId})}),data=await response.json();if(controller.view.root!==root)throw new Error('工作区已切换，请回原项目核对图片导入');if(!response.ok||!data.ok)throw new Error((data.error||'图片导入未确认')+(data.openId?'；导入预约 '+data.openId+' 已保留，请先核对。':''));controller.change({imageNotice:data.note||'已核对工作流图片来源。'});}catch(error){controller.change({imageNotice:String(error.message||error)});}
  };
  const openFalRealtimeImage=async imageId=>{
   await controller.resumeHostMenu();const root=controller.view.root,currentEpoch=controller.view.epoch,headers=controller.sourceHeaders();onClose();await new Promise(resolve=>requestAnimationFrame(resolve));
   try{const response=await fetch('/designcraft/api/v2/studio/fal-realtime',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'open-image',epoch:currentEpoch,imageId})}),data=await response.json();if(controller.view.root!==root)throw new Error('工作区已切换，请回原项目核对图片导入');if(!response.ok||!data.ok)throw new Error((data.error||'实时图片导入未确认')+(data.openId?'；导入预约 '+data.openId+' 已保留，请先核对。':''));controller.change({imageNotice:data.note||'已核对 fal 实时图片来源。'});}catch(error){controller.change({imageNotice:String(error.message||error)});}
  };
  if(apiSettingsOpen)return h(ImageApiSettings,{call,onClose,onBack:()=>setApiSettingsOpen(false),onSaved:()=>{setProvider('');setModel('');setCatalog({providers:[],models:[]});setMode('generate');setCatalogRevision(value=>value+1);setError('');}});
  if(stockOpen)return h(StockPanel,{controller,onBack:()=>setStockOpen(false),onClose,onOpenImage:imageId=>openStockImage(controller,onClose,imageId)});
  if(pixelbinOpen)return h(PixelbinWorkspace,{controller,references,onBack:()=>setPixelbinOpen(false),onClose});
  if(ecommerceOpen)return h(EcommercePanel,{controller,references,provider:provider||catalog.provider,model,resolution,onBack:()=>setEcommerceOpen(false),onClose});
  if(workflowImageOpen)return h(WorkflowImagePanel,{controller,onBack:()=>setWorkflowImageOpen(false),onClose,onOpenImage:openWorkflowImage});
  if(falRealtimeOpen)return h(FalRealtimePanel,{controller,onBack:()=>setFalRealtimeOpen(false),onClose,onOpenImage:openFalRealtimeImage});
  if(falWorkflowOpen)return h(FalWorkflowPanel,{controller,onBack:()=>setFalWorkflowOpen(false),onClose});
  return h('div',{className:'dcStudioImageWorkspace',role:'region','aria-label':'图片生成与处理'},
   h('div',{className:'dcStudioImageHeader'},h(Icon,{name:'photo'}),h('strong',null,'图片生成与处理'),
    h('button',{className:'dcBtn',disabled:busy,onClick:()=>setStockOpen(true)},'在线找图'),
    h('button',{className:'dcBtn',disabled:busy,onClick:()=>setApiSettingsOpen(true)},'生图 API 设置'),
    h('details',{open:moreServicesOpen,onToggle:event=>setMoreServicesOpen(event.currentTarget.open),style:{position:'relative'}},h('summary',{className:'dcBtn','aria-label':'更多图片服务'},'更多服务'),
     h('div',{className:'dcStudioImageForm',style:{position:'absolute',right:0,top:'100%',width:'min(440px,80vw)',zIndex:12,border:'1px solid var(--dc-line)',borderRadius:8}},
      h('small',null,'按需使用的额外服务，部分需要单独账号或连接。'),
      h('button',{className:'dcBtn',disabled:busy,onClick:()=>setEcommerceOpen(true)},'电商产品图'),
      h('button',{className:'dcBtn',disabled:busy,onClick:()=>setWorkflowImageOpen(true)},'外部工作流图片'),
      h('button',{className:'dcBtn',disabled:busy,onClick:()=>setPixelbinOpen(true)},'PixelBin 服务'),
      h('button',{className:'dcBtn',disabled:busy,onClick:()=>setFalWorkflowOpen(true)},'fal 工作流'),
      h('button',{className:'dcBtn',disabled:busy,onClick:()=>setFalRealtimeOpen(true)},'fal 实时图片'),
      h('button',{className:'dcBtn',disabled:busy,onClick:()=>{setMode('venice_upscale');setMoreServicesOpen(false);}},'Venice 图片放大'),
      h('button',{className:'dcBtn',disabled:busy,onClick:()=>{setMode('venice_remove_background');setMoreServicesOpen(false);}},'Venice 移除背景'))),
    h('button',{className:'dcBtn',disabled:busy,onClick:onClose},'返回设计')),
   jobs.some(job=>job.designPlan)?h('div',{className:'dcNativeNotice'},...jobs.filter(job=>job.designPlan).map(job=>h('small',{key:job.id,style:{display:'block'}},'任务 '+job.id.slice(0,14)+' → 计划 '+job.designPlan.title+' / '+job.designPlan.planRevision.slice(0,12)))):null,
   error?h('div',{className:'dcNativeNotice',role:'alert'},error):null,
   !isTransform&&!catalog.providers.length?h('div',{className:'dcNativeNotice',role:'status'},'尚未载入图片模型。请打开“生图 API 设置”配置独立服务，或复用 DSH 已有连接。'):null,
   transformNotice&&isTransform?h('div',{className:'dcNativeNotice',role:'status'},transformNotice):null,
   styleNotice&&styleReferences.length?h('div',{className:'dcNativeNotice',role:'status'},styleNotice):null,
   pending?h('div',{className:'dcNativeNotice',role:'status'},h('span',null,'上次图片请求的接收状态尚未确认。'),h('button',{className:'dcBtn',disabled:busy,onClick:run(checkPending)},'核对任务状态'),pendingNotFound&&pending.payload?h('button',{className:'dcBtn',disabled:busy,onClick:run(resumePending)},'恢复同一请求'):null,pendingNotFound?h('button',{className:'dcBtn',disabled:busy,title:'此前请求仍可能在途中，新请求可能产生费用',onClick:()=>{sessionStorage.removeItem(pendingKey);setPending(null);setPendingNotFound(false);}},'不再等待上次请求'):null):null,
   h('div',{className:'dcStudioImageForm'},
    !isTransform?h('label',null,'设计计划',h('select',{value:selectedPlan,disabled:busy,onChange:e=>setSelectedPlan(e.target.value)},h('option',{value:''},'不关联计划'),...plans.map(item=>h('option',{key:item.id,value:item.id+'|'+item.revision},item.title+' · '+item.revision.slice(0,8))))):null,
    h('label',null,'操作',h('select',{value:mode,disabled:busy,onChange:e=>setMode(e.target.value)},h('option',{value:'generate'},'生成新图'),h('option',{value:'edit',disabled:!canEdit},'重绘当前选区'),isTransform?h('option',{value:'venice_upscale'},'Venice 图片放大'):null,isTransform?h('option',{value:'venice_remove_background'},'Venice 移除背景'):null)),
    isTransform?h('label',null,'Venice 服务',h('select',{value:transformProvider,disabled:busy,onChange:e=>setTransformProvider(e.target.value)},h('option',{value:''},'选择已配置服务'),...transformCatalog.providers.map(item=>h('option',{key:item.id,value:item.id},item.name)))):h('label',null,'服务',h('select',{value:provider||catalog.provider||'',disabled:busy,onChange:e=>setProvider(e.target.value)},...catalog.providers.map(item=>h('option',{key:item.id,value:item.id},item.name)))),
    !isTransform?h('label',null,'模型',h('select',{value:model,disabled:busy,onChange:e=>setModel(e.target.value)},...catalog.models.filter(item=>mode!=='edit'||item.inputImage&&(!Number.isSafeInteger(item.maxInputImages)||item.maxInputImages>=2)).map(item=>h('option',{key:item.id,value:item.id},item.name+(item.requiresInputImage?' · 需要参考图':''))))):null,
    !isTransform&&catalog.warnings?.length?h('small',{role:'status'},catalog.warnings.join('；')):null,
    isTransform?h('small',{role:'status'},transformCatalog.note||'请选择已配置的 Venice 服务；实际权限和费用以服务为准。'):null,
    !isTransform&&selected?.inputImage&&selected.referenceLimitSource==='model_catalogue'&&Number.isSafeInteger(selected.maxInputImages)?h('small',null,'服务目录参考图上限 '+selected.maxInputImages+' 张'+(selected.minReferenceImages>1?'，使用参考图时至少 '+selected.minReferenceImages+' 张':'')+'；工作区最多 4 张，选区重绘会占用 2 张。'):null,
    veniceSizing&&mode==='generate'&&references.length===1&&selected?.singleImageAspectRatio===false?h('small',null,'该模型声明单图编辑保持源图比例。'):null,
    veniceSizing&&mode==='edit'?h('small',null,'选区重绘需要保持原图比例；若服务返回的比例不同，结果不会覆盖原图。'):null,
    mode==='generate'&&transparentKnown?h('label',null,h('input',{type:'checkbox',checked:transparentBackground,disabled:busy||!supportsTransparent,onChange:event=>setTransparentBackground(event.target.checked)}),'请求透明背景',h('small',null,supportsTransparent?(selected?.transparentCapabilitySource==='official_model_docs'?'能力来自官方文档，账户权限和实际透明度需检查。'+(selected?.transparentPreview?' 该型号处于预览。':''):'服务目录声明当前端点支持；实际透明度需检查。'):'当前端点未声明支持。')):null,
    qualityValues.length?h('label',null,'画质',h('select',{value:quality,disabled:busy,onChange:event=>setQuality(event.target.value)},h('option',{value:''},'服务默认'),...qualityValues.map(value=>h('option',{key:value,value},({low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'})[value]))),h('small',null,(selected?.optionsCapabilitySource==='official_model_docs'?'选项来自官方文档；':'')+'画质会影响费用，默认档位和价格以服务为准。')):null,
    !isTransform&&resolutions.length?h('label',null,'请求分辨率',h('select',{value:resolution,disabled:busy,onChange:e=>setResolution(e.target.value)},h('option',{value:''},'模型默认'),...resolutions.map(value=>h('option',{key:value,value},value)))):null,
    !isTransform&&(veniceSizing||selected?.openAiSizing)&&resolutions.length?h('small',null,'分辨率可能影响费用，实际价格以服务为准。'):null,
    !isTransform&&ratios.length?h('label',null,'请求画面比例',h('select',{value:ratio,disabled:busy,onChange:e=>setRatio(e.target.value)},h('option',{value:''},'模型默认'),...ratios.map(value=>h('option',{key:value,value},value)))):null,
    !isTransform?h('label',null,'方案数',h('select',{value:count,disabled:busy,onChange:e=>setCount(Number(e.target.value))},...[1,2,3,4].map(value=>h('option',{key:value,value},value)))):null,
    !isTransform?h('textarea',{className:'dcInput',value:prompt,disabled:busy,placeholder:mode==='edit'?'描述选区内需要修改的内容':'描述需要生成的图片','aria-label':'图片提示词',onChange:e=>setPrompt(e.target.value)}):null,
    mode==='venice_upscale'?h('label',null,'放大倍数',h('select',{value:upscaleFactor,disabled:busy,onChange:e=>setUpscaleFactor(Number(e.target.value))},h('option',{value:2},'2 倍'),h('option',{value:4},'4 倍'))):null,
    mode==='venice_upscale'?h('label',null,'创意强度',h('input',{className:'dcInput',type:'number',min:0,max:0.02,step:0.001,value:upscaleCreativity,disabled:busy,onChange:e=>setUpscaleCreativity(e.target.value)})):null,
    h('input',{ref:referenceInput,type:'file',accept:'image/png,image/jpeg',multiple:!isTransform,style:{display:'none'},onChange:event=>{const files=[...event.target.files];event.target.value='';run(()=>addReferences(files))();}}),
    h('input',{ref:styleReferenceInput,type:'file',accept:'image/png,image/jpeg',multiple:true,style:{display:'none'},onChange:event=>{const files=[...event.target.files];event.target.value='';run(()=>addStyleReferences(files))();}}),
    h('button',{className:'dcBtn',disabled:busy||!!styleReferences.length||(isTransform?references.length>=1:!selected?.inputImage||references.length>=4||Number.isSafeInteger(selected?.maxInputImages)&&references.length+(mode==='edit'?2:0)>=selected.maxInputImages),onClick:()=>referenceInput.current?.click()},isTransform?'选择原图':'添加参考图'),
    mode==='generate'&&Number.isSafeInteger(selected?.styleReferenceMax)&&selected.styleReferenceMax>0?h('button',{className:'dcBtn',disabled:busy||!canStyle||styleReferences.length>=selected.styleReferenceMax,onClick:()=>styleReferenceInput.current?.click()},'添加风格参考图'):null,
    canStyle&&controller.view.engine==='photocraft'&&controller.state.document?h('button',{className:'dcBtn',disabled:busy||styleReferences.length>=selected.styleReferenceMax,onClick:run(useCurrentStyle)},'使用当前图片风格快照'):null,
    isTransform&&controller.view.engine==='photocraft'&&controller.state.document?h('button',{className:'dcBtn',disabled:busy||references.length>=1||!!styleReferences.length,onClick:run(useCurrentPhoto)},'使用当前图片快照'):null,
    ...references.map(item=>h('span',{key:item.name,className:'dcStudioImageReference'},item.label,h('button',{type:'button',className:'dcBtn','aria-label':'移除参考图 '+item.label,disabled:busy,onClick:()=>{setReferences(rows=>rows.filter(row=>row.name!==item.name));setTransformNotice('');}},'移除'))),
    ...styleReferences.map(item=>h('span',{key:item.name,className:'dcStudioImageReference'},'风格：'+item.label,h('button',{type:'button',className:'dcBtn','aria-label':'移除风格参考图 '+item.label,disabled:busy,onClick:()=>{setStyleReferences(rows=>rows.filter(row=>row.name!==item.name));setStyleNotice('');if(styleReferences.length===1)setStyleStrength('');}},'移除'))),
    styleReferences.length&&selected?.styleReferenceStrength===true&&canStyle?h('label',null,'风格强度（可留空）',h('input',{className:'dcInput',type:'number',min:0.1,max:1,step:0.1,value:styleStrength,disabled:busy,onChange:e=>setStyleStrength(e.target.value)})):null,
    styleReferences.length&&styleStrength.trim()&&(!canStyle||selected?.styleReferenceStrength!==true)?h('button',{className:'dcBtn',disabled:busy,onClick:()=>setStyleStrength('')},'清除当前风格强度'):null,
    styleReferences.length?h('small',null,'风格图将发送至 Venice，可能按图片另行收费；不与普通参考图或选区重绘混用。'):null,
    h('button',{className:'dcBtn dcPrimary',disabled:busy||!!pending||!!styleReferences.length&&(!canStyle||styleReferences.length>selected?.styleReferenceMax)||(isTransform?!transformProvider||references.length!==1:!prompt.trim()||!selected||!!references.length&&!selected.inputImage||mode==='generate'&&selected?.requiresInputImage&&!references.length||Number.isSafeInteger(selected?.minInputImages)&&references.length+(mode==='edit'?2:0)<selected.minInputImages||references.length+(mode==='edit'?2:0)>0&&Number.isSafeInteger(selected?.minReferenceImages)&&references.length+(mode==='edit'?2:0)<selected.minReferenceImages||Number.isSafeInteger(selected?.maxInputImages)&&references.length+(mode==='edit'?2:0)>selected.maxInputImages||(mode==='edit'&&(!canEdit||!selected.inputImage||references.length>2))),onClick:run(start)},isTransform?(mode==='venice_upscale'?'提交图片放大':'提交背景移除'):(mode==='edit'?'提交选区重绘':'生成图片')),
    h('small',null,isTransform?'将选定原图发送至 Venice，可能产生费用；输出为独立方案，原图保留。中断后不会自动重发。':(mode==='edit'?'以当前保存的完整选区 alpha 合成结果；原图层保留。':'请求会使用所选服务，任务中断不会自动重复提交。')+(selected?.capabilitySource==='model_name_inferred'?' 该模型的部分图片能力依据官方资料或名称推断，最终以服务返回为准。':'')+(resolution||ratio?' 实际尺寸和比例以返回的图片为准。':''))),
   choices?h('div',{className:'dcNativeNotice'},h('span',null,'该候选已有多份导入，请选择要继续编辑的作品。'),...choices.sources.map(item=>h('button',{key:item.sourceId,className:'dcBtn',onClick:run(()=>adopt(choices.job,choices.candidate,item.sourceId))},item.title||item.sourceId)),h('button',{className:'dcBtn',onClick:()=>setChoices(null)},'取消')):null,
   comparison?h(Compare,{controller,epoch:epoch.current,...comparison,onClose:()=>setComparison(null),disabled:busy,
    onApply:comparison.job.mode==='edit'&&imageBaselineMatches(controller.state.sources.find(source=>source.id===controller.view.sourceId&&source.revision===controller.view.sourceRevision),comparison.job)?
     run(async()=>{await applyCurrent(comparison.job,comparison.candidate);setComparison(null);}):null}):null,
   h('div',{className:'dcStudioImageJobs'},!jobs.length?h('div',{className:'dcNativeMenuEmpty'},h(Icon,{name:'photo',size:24}),h('p',null,'生成或重绘后，候选图片会出现在这里。')):null,...jobs.map(job=>h('section',{key:job.id,className:'dcStudioImageJob'},
    h('div',null,h('strong',null,({edit:'选区重绘',generate:'图片生成',venice_upscale:'Venice 图片放大',venice_remove_background:'Venice 背景移除'})[job.mode]||'图片任务'),' · '+({queued:'排队中',running:'进行中',ready:'已返回候选',failed:'失败',cancelled:'已取消',interrupted:'已中断',adopted:'已采用'})[job.status],job.error?h('p',{role:'status'},job.error):null,
     job.remoteDispatch?.protocol==='fal'&&job.remoteDispatch.requestId?h('small',null,'fal 任务 '+job.remoteDispatch.requestId+(job.remoteDispatch.serverStatus?' · '+job.remoteDispatch.serverStatus:'')):null,
     job.remoteCancel?.detail?h('p',{role:'status'},job.remoteCancel.detail):null,
     job.returnedConversion?.error?h('p',{role:'status'},job.returnedConversion.error):null,
     ['queued','running'].includes(job.status)?h('button',{className:'dcBtn',disabled:busy,onClick:run(async()=>{await call('cancel',{id:job.id});await refresh();})},'停止本地等待'):null,
     !['queued','running'].includes(job.status)&&job.remoteDispatch?.protocol==='fal'&&job.remoteDispatch.requestId&&!job.candidates.some(item=>item.index===job.remoteDispatch.index)&&job.remoteCancel?.state!=='removed_from_queue'?h('button',{className:'dcBtn',disabled:busy,onClick:run(async()=>{await call('recover-fal',{id:job.id});await refresh();})},'取回已有 fal 任务'):null,
     !['queued','running'].includes(job.status)&&job.remoteDispatch?.protocol==='fal'&&job.remoteDispatch.requestId&&!job.candidates.some(item=>item.index===job.remoteDispatch.index)&&job.remoteCancel?.state!=='removed_from_queue'?h('button',{className:'dcBtn',disabled:busy,title:'运行中的远端任务可能仍会完成或计费',onClick:run(async()=>{await call('cancel-remote-fal',{id:job.id});await refresh();})},'请求远端取消'):null),
    h('div',{className:'dcStudioImageCandidates'},...(job.candidates||[]).map(candidate=>h('article',{key:candidate.id},h(Preview,{controller,job,candidate,epoch:epoch.current}),
     h('p',null,'方案 '+(candidate.index+1)+(candidate.returnedOrdinal!=null?' · 返回图 '+(candidate.returnedOrdinal+1):'')+' · '+candidate.width+' × '+candidate.height),
     h(Button,{icon:'focus',onClick:()=>setComparison({job,candidate})},job.mode==='edit'||job.candidates.length>1?'比较方案':'查看大图'),
     candidate.warnings?.length?h('p',{role:'status'},candidate.warnings.join('；')):null,
     job.editMethod?h('small',null,'参考图生成 + 本地选区合成'):null,
     job.mode==='edit'&&imageBaselineMatches(controller.state.sources.find(source=>source.id===controller.view.sourceId&&source.revision===controller.view.sourceRevision),job)?h('button',{className:'dcBtn dcPrimary',disabled:busy||['queued','running'].includes(job.status),onClick:run(()=>applyCurrent(job,candidate))},'应用到当前图片'):null,
     h('button',{className:'dcBtn',disabled:busy||['queued','running'].includes(job.status)||!!controller.state.sourceNavigation,title:controller.state.sourceNavigation?'请先返回原设计再打开独立方案':undefined,onClick:run(()=>adopt(job,candidate))},'打开独立方案'))),
     ...(job.returnedImages||[]).filter(output=>!(job.candidates||[]).some(candidate=>candidate.returnedImageId===output.id)).map(output=>h('article',{key:output.id},h(Preview,{controller,job,candidate:output,epoch:epoch.current,variant:'returned'}),h('p',null,'请求 '+(output.index+1)+' 的返回原图 '+(output.ordinal+1)+' · 尚未转为可编辑候选'),h('button',{className:'dcBtn',disabled:busy||['queued','running'].includes(job.status),onClick:run(async()=>{await call('convert-returned',{id:job.id,outputId:output.id});await refresh();})},'转换已保存原图'))))))));
 };
}
