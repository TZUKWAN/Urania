import {pinImagePlan,verifyImagePlan,saveImagePlanTrace} from './image-plan-binding.js';
import {captureNativeSelection} from './photo-mask.js';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,statSync,lstatSync,unlinkSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import * as store from './docstore.js';
import {openNativeSession,nativeProjectFonts} from './native.js';
import {SafetyError,workspacePath,assertPortableName,assertSafeJson,assertImageSize} from './safety.js';
import {NativeSourceStore} from './native-source-store.js';
import {atomicCreate} from './persistence.js';
import {previewImageSize} from './image-header.js';
import {imageConnectionFingerprint} from './image-provider.js';
import {VENICE_IMAGE_MODES,veniceTransformSignature,validateVeniceTransformRecord} from './venice-image-transform.js';

const pixelSignature=layer=>hash({asset:layer.asset,source:layer.native?.source,adjust:layer.adjust,filters:layer.filters,mask:layer.mask,transform:layer.transform,crop:layer.crop,naturalWidth:layer.naturalWidth,naturalHeight:layer.naturalHeight});
const hash=x=>createHash('sha256').update(typeof x==='string'?x:JSON.stringify(x)).digest('hex');
function checkImageModel(model,mode,referenceCount){
 if(!model)throw new SafetyError('请选择当前目录或手动配置中的图片模型',422);
 const transmitted=referenceCount+(mode==='edit'?2:0);
 if(transmitted&&!model.inputImage)throw new SafetyError('所选模型未声明支持图片参考或编辑',422);
 if(mode==='generate'&&!referenceCount&&model.requiresInputImage)throw new SafetyError('所选编辑模型需要至少一张参考图',422);
 if(Number.isSafeInteger(model.minInputImages)&&transmitted<model.minInputImages)throw new SafetyError('所选模型至少需要 '+model.minInputImages+' 张输入图',422);
 if(transmitted>0&&Number.isSafeInteger(model.minReferenceImages)&&transmitted<model.minReferenceImages)throw new SafetyError('所选模型使用参考图时至少需要 '+model.minReferenceImages+' 张输入图',422);
 if(Number.isSafeInteger(model.maxInputImages)&&transmitted>model.maxInputImages)throw new SafetyError('所选模型最多接受 '+model.maxInputImages+' 张输入图；选区重绘需要原图与选区参考图',422);
}
const locate=(doc,pageId,layerId)=>{const page=doc.pages.find(p=>p.id===pageId);const find=list=>{for(const l of list||[]){if(l.id===layerId)return l;const child=find(l.children);if(child)return child;}};return {page,layer:find(page?.layers)};};
function directory(root){const p=workspacePath(root,'design/.designcraft/image-jobs');mkdirSync(p,{recursive:true});return p;}
function save(record){const path=join(directory(record.root),record.id+'.json'),temp=path+'.'+randomUUID()+'.tmp';const {root,...data}=record;writeFileSync(temp,JSON.stringify(data,null,2),{flag:'wx'});renameSync(temp,path);}
function publicRecord(record){const {root,sourceSignature,ownerPid,...data}=record;return data;}
function ownerAlive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}
// Each contender publishes a unique marker before inspecting other live contenders.
// A crashed owner's marker is left inert; only this invocation's unchanged marker is removed.
function acquireRecovery(root,id){
 if(!/^image-[a-f0-9-]{36}$/.test(id||''))throw new SafetyError('图片任务 ID 无效',422);
 const dir=directory(root),token=randomUUID(),prefix='recover-'+id+'-',name=prefix+token+'.json',path=join(dir,name),body=JSON.stringify({pid:process.pid,token,id});
 if(!atomicCreate(path,body))throw new SafetyError('图片恢复记录冲突',409);
 const release=()=>{try{const info=lstatSync(path);if(info.isFile()&&!info.isSymbolicLink()&&info.size<=4096&&readFileSync(path,'utf8')===body)unlinkSync(path);}catch{}};
 try{
  const peers=readdirSync(dir).filter(item=>item.startsWith(prefix)&&item.endsWith('.json'));if(peers.length>200)throw new SafetyError('图片恢复记录超过预算',413);
  for(const peer of peers){if(peer===name)continue;const file=join(dir,peer),info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)throw new SafetyError('图片恢复记录需要人工核对',409);const value=JSON.parse(readFileSync(file,'utf8'));if(value.id!==id||!Number.isSafeInteger(value.pid)||typeof value.token!=='string')throw new SafetyError('图片恢复记录无效',409);if(ownerAlive(value.pid))throw new SafetyError('此图片任务正在另一恢复流程中',423);}
  return release;
 }catch(error){release();throw error;}
}
export async function prepareImageCandidate(root,bytes,name,signal,{baseSource,overlayAsset}={}){
 if(!baseSource&&(!bytes.length||bytes.length>64*1024*1024))throw new SafetyError('图像文件超过64MB预算',413);
 const isPng=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),isJpeg=bytes[0]===255&&bytes[1]===216,isWebp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!baseSource&&!isPng&&!isJpeg&&!isWebp)throw new SafetyError('生图服务必须返回 PNG/JPEG/WebP 位图；未把其他内容冒充图片',422);
 const original=baseSource?{name:baseSource}:store.saveAsset(root,name+(isPng?'.png':isJpeg?'.jpg':'.webp'),bytes),session=await openNativeSession('photocraft',root,{signal}),abort=()=>session.close();signal?.addEventListener('abort',abort,{once:true});
 try{
  assertPortableName(original.name);if(signal?.aborted)throw new SafetyError('图片任务已取消',499);await session.call('doc_open',{path:workspacePath(root,join('design','assets',original.name),{mustExist:true})});let info=(await session.call('doc_inspect',{})).data;assertImageSize(info.width,info.height);
  if(overlayAsset){assertPortableName(overlayAsset);const top=info.layers[0]?.id;if(top!=null)await session.call('command_run',{id:'layer.select',params:{layer:top},wait:true});if(info.hasSelection)await session.call('command_run',{id:'select.deselect',params:{},wait:true});await session.call('doc_place',{path:workspacePath(root,join('design','assets',overlayAsset),{mustExist:true}),fit:false,scale:100,center:[info.width/2,info.height/2]});const placedInfo=(await session.call('doc_inspect',{})).data,placed=placedInfo.activeLayer;if(placedInfo.layers.some(n=>n.id===placed&&/smart/i.test(n.kind)))await session.call('command_run',{id:'layer.rasterize.smartObject',params:{layer:placed},wait:true});if(top!=null&&placed!==top)await session.call('command_run',{id:'layer.moveTo',params:{layer:placed,target:top,position:'above'},wait:true});await session.call('command_run',{id:'layer.setProps',params:{layer:placed,name:'AI 局部重绘'},wait:true});info=(await session.call('doc_inspect',{})).data;}
  const sourcePath=join(session.directory,'generated.pcraft'),previewPath=join(session.directory,'generated.png');await session.call('doc_save',{path:sourcePath});await session.call('doc_export',{path:previewPath});
  const source=store.saveAsset(root,name+'.pcraft',await readFile(sourcePath)),asset=store.saveAsset(root,name+'-preview.png',await readFile(previewPath));
  const nodes=[];const visit=(list,parentId=null)=>{for(const n of list||[]){if(nodes.length>=5000)throw new SafetyError('图片源对象超过预算',413);nodes.push({id:n.id,parentId,name:n.name,kind:n.kind,bounds:n.bounds,text:n.text?.text?.slice(0,4096),textTruncated:n.text?.text?.length>4096,visible:n.visible,locked:n.locked,container:!!n.children?.length});visit(n.children,n.id);}};visit(info.layers);
  return {asset:asset.name,original:original.name,width:info.width,height:info.height,fontFingerprint:session.projectFontFingerprint,warnings:session.projectFontCount?['本机合成已提供项目字体，但系统同名字体可能优先；文字外观及选区外画面需核对。']:[],native:{engine:'photocraft',version:session.identity.version,source:source.name,renderedAsset:asset.name,original:original.name,layers:nodes,depth:info.depth,mode:info.mode,hasSelection:!!info.hasSelection,selectionBounds:info.selectionBounds||null,activeLayer:info.activeLayer}};
 }finally{signal?.removeEventListener('abort',abort);await session.close();}
}
export class ImageJobs{
 constructor({providers,native,compute,onChange=()=>{}}){this.providers=providers;this.native=native;this.compute=compute;this.onChange=onChange;this.records=new Map();this.running=new Map();this.closed=false;}
 emit(record){save(record);saveImagePlanTrace(record);try{this.onChange({...publicRecord(record),root:record.root});}catch{}}
 load(root,id){assertPortableName(id);if(!/^image-[a-f0-9-]{36}$/.test(id))throw new SafetyError('图片任务 ID 无效',422);const known=this.records.get(root+'|'+id);if(known&&(!known.ownerPid||known.ownerPid===process.pid))return known;const path=join(directory(root),id+'.json');if(!existsSync(path))throw new SafetyError('图片任务不存在',404);if(statSync(path).size>256*1024)throw new SafetyError('图片任务记录超过预算',413);const data=JSON.parse(readFileSync(path,'utf8'));assertSafeJson(data);const record={...data,root};if(record.designPlan)verifyImagePlan(root,record.designPlan);if(record.id!==id)throw new SafetyError('图片任务记录无效',422);if(['running','queued','adopting'].includes(record.status)&&!ownerAlive(record.ownerPid)){record.status='interrupted';record.error='上次运行被中断，未自动重复付费请求；已有候选仍可采用';save(record);}if(!record.ownerPid||record.ownerPid===process.pid)this.records.set(root+'|'+id,record);return record;}
 list(root){root=store.validateRoot(root);const files=readdirSync(directory(root)).filter(n=>/^image-[a-f0-9-]{36}\.json$/.test(n)).sort((a,b)=>statSync(join(directory(root),b)).mtimeMs-statSync(join(directory(root),a)).mtimeMs).slice(0,200);return files.map(n=>publicRecord(this.load(root,n.slice(0,-5)))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 get(root,id){return publicRecord(this.load(store.validateRoot(root),id));}
 linkStudio(root,id,candidateId,sourceId,sourceRevision){
  root=store.validateRoot(root);const record=this.load(root,id),candidate=record.candidates.find(item=>item.id===candidateId);
  if(!record.studio||!candidate)throw new SafetyError('图片候选不存在',404);
  if(['running','queued'].includes(record.status))throw new SafetyError('图片任务仍在运行，请完成或取消后采用',409);
  if(!/^candidate-[a-f0-9-]{36}$/.test(candidateId||'')||!/^[A-Za-z0-9][\w-]{0,80}$/.test(sourceId||'')||!/^[a-f0-9]{64}$/.test(sourceRevision||''))throw new SafetyError('候选采用身份无效',422);
  const dir=workspacePath(root,'design/.designcraft/image-adoptions');mkdirSync(dir,{recursive:true});
  const path=workspacePath(root,join(dir,'adoption-'+hash([id,candidateId,sourceId,sourceRevision])+'.json'));
  const receipt={schema:1,jobId:id,candidateId,sourceId,sourceRevision,sourceHash:candidate.sourceHash,at:new Date().toISOString()};
  if(!atomicCreate(path,JSON.stringify(receipt,null,2))){const existing=JSON.parse(readFileSync(path,'utf8'));if(existing.jobId!==id||existing.candidateId!==candidateId||existing.sourceId!==sourceId||existing.sourceRevision!==sourceRevision||existing.sourceHash!==candidate.sourceHash)throw new SafetyError('候选采用记录身份不一致',409);return {...publicRecord(record),latestAdoption:existing};}
  return {...publicRecord(record),latestAdoption:receipt};
 }
 async startVeniceTransform(input,{signal,assertCurrent}={}){
  assertSafeJson(input);if(this.closed)throw new SafetyError('图片服务已停止',503);
  const root=store.validateRoot(input.root),mode=input.mode,operationId=input.operationId||randomUUID();
  if(!VENICE_IMAGE_MODES.includes(mode)||!/^[a-f0-9-]{36}$/.test(operationId)||!Array.isArray(input.referenceAssets)||input.referenceAssets.length!==1||input.count!==undefined&&input.count!==1||input.model!=null||input.prompt!=null&&input.prompt!=='')throw new SafetyError('图片处理需要一种操作、一张原图和稳定请求身份',422);
  if(mode==='venice_remove_background'&&(input.scale!=null||input.creativity!=null))throw new SafetyError('背景移除不接受放大参数',422);
  const scale=mode==='venice_upscale'?(input.scale??2):null,creativity=mode==='venice_upscale'?(input.creativity??0.01):null,asset=input.referenceAssets[0];assertPortableName(asset);
  const bytes=store.readAsset(root,asset);if(!bytes||!bytes.length||bytes.length>8*1024*1024)throw new SafetyError('原图不存在或超过 8 MiB',422);
  const size=previewImageSize(bytes),sourceHash=createHash('sha256').update(bytes).digest('hex');
  if(input.referenceHashes!==undefined&&(!Array.isArray(input.referenceHashes)||input.referenceHashes.length!==1||input.referenceHashes[0]!==sourceHash))throw new SafetyError('原图与选定摘要不一致，未提交处理',409);
  const signature=veniceTransformSignature({mode,provider:input.provider,asset,sha256:sourceHash,scale,creativity}),id='image-'+operationId;
  if(mode==='venice_upscale'&&(size.width<256||size.height<256||size.width*size.height>=16777216))throw new SafetyError('放大原图须至少 256×256 且少于 16777216 像素',422);
  const existing=()=>{if(!existsSync(join(directory(root),id+'.json')))return null;const prior=this.load(root,id);if(!prior.studio||prior.requestSignature!==signature)throw new SafetyError('图片请求身份已用于其他内容，未重复提交',409);validateVeniceTransformRecord(prior);return {accepted:true,reused:true,job:publicRecord(prior)};};
  let prior=existing();if(prior)return prior;if(this.running.size)throw new SafetyError('已有图片任务运行中，请等待或停止',429);
  const route=await this.providers.route(input.provider);if(route.protocol!=='venice')throw new SafetyError('请选择已配置的 Venice 图片服务连接',422);
  const fingerprint=imageConnectionFingerprint(route),latest=store.readAsset(root,asset);if(!latest||createHash('sha256').update(latest).digest('hex')!==sourceHash)throw new SafetyError('原图在准备期间已改变，未发送请求',409);
  signal?.throwIfAborted();assertCurrent?.();prior=existing();if(prior)return prior;if(this.running.size)throw new SafetyError('已有图片任务运行中，请等待或停止',429);
  const record={id,requestSignature:signature,root,ownerPid:process.pid,kind:'image.'+mode,studio:{source:null,sessionId:input.sessionId||null},mode,provider:route.id,model:null,prompt:'',count:1,scale,creativity,referenceAssets:[asset],referenceHashes:[sourceHash],connectionFingerprint:fingerprint,status:'queued',createdAt:new Date().toISOString(),candidates:[],progress:{index:0,total:1},autoApply:false};validateVeniceTransformRecord(record);
  const {root:ignoredRoot,...reservation}=record;if(!atomicCreate(join(directory(root),id+'.json'),JSON.stringify(reservation,null,2))){prior=existing();if(!prior)throw new SafetyError('图片请求身份未确认，请先核对状态',409);return prior;}
  const controller=new AbortController();this.records.set(root+'|'+id,record);this.running.set(id,controller);
  try{this.emit(record);}catch(error){this.records.delete(root+'|'+id);this.running.delete(id);throw error;}
  queueMicrotask(()=>this.execute(record,controller).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async startStudio(input,{signal,assertCurrent}={}){
  assertSafeJson(input);if(this.closed)throw new SafetyError('图片服务已停止',503);
  const root=store.validateRoot(input.root),mode=input.mode||'generate',prompt=String(input.prompt||'').trim(),count=input.count??1;
  if(!['generate','edit'].includes(mode)||!prompt||prompt.length>16000||!Number.isInteger(count)||count<1||count>4)throw new SafetyError('请输入提示词；一次生成1至4个方案',422);
  if(input.transparentBackground!==undefined&&typeof input.transparentBackground!=='boolean'||input.transparentBackground===true&&mode!=='generate')throw new SafetyError('透明背景只支持独立生成方案，不能用于精确选区重绘',422);
  if(input.transparentBackground===true&&(typeof input.provider!=='string'||!input.provider.trim()||input.sourceId!=null||input.sourceRevision!=null))throw new SafetyError('透明背景生成需要明确服务，并作为独立方案保存',422);
  if(input.quality!==undefined&&(typeof input.quality!=='string'||input.quality!==''&&!['low','medium','high','xhigh','max'].includes(input.quality)))throw new SafetyError('图片画质选项无效',422);
  if(input.quality&&(typeof input.provider!=='string'||!input.provider.trim()))throw new SafetyError('指定画质需要明确的图片服务',422);
  if(input.quality&&mode==='generate'&&(input.sourceId!=null||input.sourceRevision!=null))throw new SafetyError('指定画质的独立生成不能附带原生源身份',422);
  if(input.styleReferenceAssets!==undefined&&(!Array.isArray(input.styleReferenceAssets)||input.styleReferenceAssets.length>4||new Set(input.styleReferenceAssets).size!==input.styleReferenceAssets.length))throw new SafetyError('风格参考图列表无效',422);
  const styleNames=(input.styleReferenceAssets||[]).slice();
  if(styleNames.length&&(mode!=='generate'||!Array.isArray(input.referenceAssets||[])||(input.referenceAssets||[]).length||typeof input.provider!=='string'||!input.provider.trim()||input.sourceId!=null||input.sourceRevision!=null))throw new SafetyError('风格参考只支持明确 Venice 服务的独立文生图，不能混用普通参考或选区',422);
  if(input.styleReferenceStrength!==undefined&&(!styleNames.length||typeof input.styleReferenceStrength!=='number'||!Number.isFinite(input.styleReferenceStrength)||input.styleReferenceStrength<0.1||input.styleReferenceStrength>1))throw new SafetyError('风格参考强度须为 0.1 至 1',422);
  if(input.styleReferenceHashes!==undefined&&(!Array.isArray(input.styleReferenceHashes)||input.styleReferenceHashes.length!==styleNames.length||input.styleReferenceHashes.some(value=>!/^[a-f0-9]{64}$/.test(value||''))))throw new SafetyError('风格参考图摘要列表无效',422);
  const designPlan=pinImagePlan(root,input.planId,input.planRevision);
  const operationId=input.operationId||randomUUID();if(!/^[a-f0-9-]{36}$/.test(operationId))throw new SafetyError('图片请求身份无效',422);
  if(input.connectionFingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(input.connectionFingerprint||''))throw new SafetyError('图片服务连接身份无效',422);
  if(input.referenceHashes!==undefined&&(!Array.isArray(input.referenceAssets)||!Array.isArray(input.referenceHashes)||input.referenceHashes.length!==input.referenceAssets.length||input.referenceHashes.some(value=>!/^[a-f0-9]{64}$/.test(value||''))||mode!=='generate'))throw new SafetyError('参考图摘要列表无效',422);
  if(input.editReferenceHashes!==undefined&&(mode!=='edit'||!Array.isArray(input.referenceAssets)||!Array.isArray(input.editReferenceHashes)||input.editReferenceHashes.length!==input.referenceAssets.length||input.editReferenceHashes.some(value=>!/^[a-f0-9]{64}$/.test(value||''))))throw new SafetyError('编辑参考图摘要列表无效',422);
  let effectiveFingerprint=input.connectionFingerprint,effectiveHashes=input.referenceHashes,effectiveEditHashes,styleHashes,bindOptions=input.transparentBackground===true||!!input.quality||styleNames.length>0,veniceSizingRequested=false,openAiSizingRequested=false;
  const dedicatedId=input.provider||this.providers.imageSettings?.route()?.id;
  if(dedicatedId==='designcraft-image-api'){
   const currentFingerprint=imageConnectionFingerprint(await this.providers.route(dedicatedId));
   if(effectiveFingerprint&&effectiveFingerprint!==currentFingerprint)throw new SafetyError('独立生图 API 已改变，请重新载入模型后提交；未发送请求',409);
   effectiveFingerprint=currentFingerprint;signal?.throwIfAborted();assertCurrent?.();
  }
  const hasSizing=!!(input.resolution||input.aspectRatio);
  if(bindOptions||input.provider&&hasSizing){const route=await this.providers.route(input.provider);if((input.quality||input.transparentBackground===true)&&!['venice','openai'].includes(route.protocol)||styleNames.length&&route.protocol!=='venice')throw new SafetyError('所选服务不支持此透明背景、画质或风格参考选项',422);if(route.protocol==='venice'||route.protocol==='openai'&&(input.transparentBackground===true||input.quality||hasSizing)){bindOptions=true;veniceSizingRequested=route.protocol==='venice'&&hasSizing;openAiSizingRequested=route.protocol==='openai'&&hasSizing;const currentFingerprint=imageConnectionFingerprint(route);if(effectiveFingerprint&&effectiveFingerprint!==currentFingerprint)throw new SafetyError('图片服务连接已改变，未提交任务',409);effectiveFingerprint=currentFingerprint;}signal?.throwIfAborted();assertCurrent?.();}
  if(input.editReferenceHashes!==undefined&&!bindOptions)throw new SafetyError('此图片任务不支持编辑参考图摘要',422);
  if(bindOptions&&mode==='generate'&&hasSizing&&(input.sourceId!=null||input.sourceRevision!=null))throw new SafetyError('独立图片生成不能附带原生源身份',422);
  if(mode==='generate'&&bindOptions){
   if(!Array.isArray(input.referenceAssets||[])||(input.referenceAssets||[]).length>4)throw new SafetyError('图片参考图数量无效',422);
   let total=0;effectiveHashes=(input.referenceAssets||[]).map(name=>{assertPortableName(name);const bytes=store.readAsset(root,name);if(!bytes||!bytes.length||(total+=bytes.length)>16*1024*1024)throw new SafetyError('图片参考图不存在或超过传输预算',422);previewImageSize(bytes);return createHash('sha256').update(bytes).digest('hex');});
   if(input.referenceHashes&&input.referenceHashes.some((value,index)=>value!==effectiveHashes[index]))throw new SafetyError('参考图已改变，未提交图片请求',409);
  }
  if(mode==='edit'&&bindOptions){
   if(!Array.isArray(input.referenceAssets||[])||(input.referenceAssets||[]).length>2)throw new SafetyError('编辑参考图数量无效',422);
   let total=0;effectiveEditHashes=(input.referenceAssets||[]).map(name=>{assertPortableName(name);const bytes=store.readAsset(root,name);if(!bytes||!bytes.length||(total+=bytes.length)>16*1024*1024)throw new SafetyError('编辑参考图不存在或超过传输预算',422);previewImageSize(bytes);return createHash('sha256').update(bytes).digest('hex');});
   if(input.editReferenceHashes&&input.editReferenceHashes.some((value,index)=>value!==effectiveEditHashes[index]))throw new SafetyError('编辑参考图已改变，未提交请求',409);
  }
  if(styleNames.length){let total=0;styleHashes=styleNames.map(name=>{assertPortableName(name);const bytes=store.readAsset(root,name);if(!bytes||!bytes.length||bytes.length>=8000000||(total+=bytes.length)>16*1024*1024)throw new SafetyError('风格参考图不存在或超过预算',422);previewImageSize(bytes);return createHash('sha256').update(bytes).digest('hex');});if(input.styleReferenceHashes&&input.styleReferenceHashes.some((value,index)=>value!==styleHashes[index]))throw new SafetyError('风格参考图已改变，未提交请求',409);}
  const id='image-'+operationId,signature=hash({mode,...(designPlan?{designPlan}:{}),sourceId:input.sourceId||null,sourceRevision:input.sourceRevision||null,provider:input.provider||null,model:input.model,prompt,count,resolution:input.resolution||null,aspectRatio:input.aspectRatio||null,referenceAssets:input.referenceAssets||[],...(effectiveHashes?{referenceHashes:effectiveHashes}:{}),...(effectiveEditHashes?{editReferenceHashes:effectiveEditHashes}:{}),...(effectiveFingerprint?{connectionFingerprint:effectiveFingerprint}:{}),...(input.quality?{quality:input.quality}:{}),...(input.transparentBackground?{transparentBackground:true}:{}),...(styleNames.length?{styleReferenceAssets:styleNames,styleReferenceHashes:styleHashes,...(input.styleReferenceStrength!==undefined?{styleReferenceStrength:input.styleReferenceStrength}:{})}:{})});
  if(existsSync(join(directory(root),id+'.json'))){const prior=this.load(root,id);if(!prior.studio||prior.requestSignature!==signature)throw new SafetyError('图片请求身份已用于其他内容，未重复提交',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  if(this.running.size)throw new SafetyError('已有图片生成任务运行中，请等待或取消',429);
  const catalogue=await this.providers.catalogue(input.provider),model=catalogue.models.find(item=>item.id===input.model);signal?.throwIfAborted();assertCurrent?.();
  if(!model)throw new SafetyError('请选择当前目录或手动配置中的图片模型',422);
  if(!Array.isArray(input.referenceAssets||[])||(input.referenceAssets||[]).length>(mode==='edit'?2:4))throw new SafetyError('参考图数量超过限制',422);
  const references=(input.referenceAssets||[]).slice();checkImageModel(model,mode,references.length);for(const name of references){assertPortableName(name);if(!store.readAsset(root,name))throw new SafetyError('参考图不存在',404);}
  if(input.transparentBackground===true&&(references.length?model.transparentEdit:model.transparentGenerate)!==true)throw new SafetyError('当前模型无可核对的透明背景能力，未提交任务',422);
  if(input.quality&&(mode==='edit'||references.length?model.qualityEdit:model.qualityGenerate)?.includes(input.quality)!==true)throw new SafetyError('当前模型没有可核对的所选画质，未提交任务',422);
  if(styleNames.length&&(!Number.isSafeInteger(model.styleReferenceMax)||styleNames.length>model.styleReferenceMax||input.styleReferenceStrength!==undefined&&model.styleReferenceStrength!==true))throw new SafetyError('模型目录未声明支持所选风格参考或强度，未提交任务',422);
  if(model.veniceSizing&&hasSizing&&(!bindOptions||input.resolution&&(mode==='edit'||references.length?model.resolutionsEdit:model.resolutionsGenerate)?.includes(input.resolution)!==true||input.aspectRatio&&(mode==='edit'||references.length?model.aspectsEdit:model.aspectsGenerate)?.includes(input.aspectRatio)!==true))throw new SafetyError('Venice 尺寸需明确服务，且必须由当前端点目录声明支持',422);
  if((model.openAiSizing||openAiSizingRequested)&&hasSizing&&(!bindOptions||!model.openAiSizing||!!input.aspectRatio||input.resolution&&model.parameters?.resolution?.values?.includes(input.resolution)!==true||mode==='edit'&&!!input.resolution))throw new SafetyError('OpenAI 尺寸需明确服务和官方列明的常用尺寸；精确选区重绘不接受尺寸参数',422);
  if(model.veniceSizing&&input.aspectRatio&&mode==='edit')throw new SafetyError('精确选区重绘必须保持原图比例，不接受额外画面比例参数',422);
  if(model.veniceSizing&&input.aspectRatio&&mode==='generate'&&references.length===1&&model.singleImageAspectRatio===false)throw new SafetyError('该 Venice 模型声明单图编辑会忽略画面比例，请使用源图比例',422);
  let source=null;
  if(mode==='edit'){
   const stored=await new NativeSourceStore(root).source(input.sourceId,input.sourceRevision);
   if(stored.meta.engine!=='photocraft')throw new SafetyError('局部重绘需要当前原生图片源',422);
   source={sourceId:input.sourceId,sourceRevision:stored.revision,sourceHash:stored.meta.sourceHash};
  }
  if(existsSync(join(directory(root),id+'.json'))){const prior=this.load(root,id);if(!prior.studio||prior.requestSignature!==signature)throw new SafetyError('图片请求身份已用于其他内容，未重复提交',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  if(this.running.size)throw new SafetyError('已有图片生成任务运行中，请等待或取消',429);
  signal?.throwIfAborted();assertCurrent?.();const record={id,requestSignature:signature,...(designPlan?{designPlan}:{}),root,ownerPid:process.pid,kind:'image.'+mode,studio:{source,sessionId:input.sessionId||null},mode,provider:catalogue.provider,model:input.model,prompt,count,resolution:input.resolution||null,aspectRatio:input.aspectRatio||null,referenceAssets:references,...(effectiveHashes?{referenceHashes:[...effectiveHashes]}:{}),...(effectiveEditHashes?{editReferenceHashes:[...effectiveEditHashes]}:{}),...(effectiveFingerprint?{connectionFingerprint:effectiveFingerprint}:{}),...(veniceSizingRequested?{veniceSizing:true}:{}),...(openAiSizingRequested?{openAiSizing:true}:{}),...(input.quality?{quality:input.quality}:{}),...(input.transparentBackground?{transparentBackground:true}:{}),...(styleNames.length?{veniceStyleReferences:true,styleReferenceAssets:[...styleNames],styleReferenceHashes:[...styleHashes],...(input.styleReferenceStrength!==undefined?{styleReferenceStrength:input.styleReferenceStrength}:{})}:{}),status:'queued',createdAt:new Date().toISOString(),candidates:[],progress:{index:0,total:count},autoApply:false};
  const {root:ignoredRoot,...reservation}=record;
  if(!atomicCreate(join(directory(root),id+'.json'),JSON.stringify(reservation,null,2))){const prior=this.load(root,id);if(!prior.studio||prior.requestSignature!==signature)throw new SafetyError('图片请求身份已用于其他内容，未重复提交',409);return {accepted:true,reused:true,job:publicRecord(prior)};}
  const controller=new AbortController();this.records.set(root+'|'+record.id,record);this.running.set(record.id,controller);
  try{this.emit(record);}catch(error){this.records.delete(root+'|'+record.id);this.running.delete(record.id);throw error;}
  queueMicrotask(()=>this.execute(record,controller).catch(()=>{}));
  return {accepted:true,job:publicRecord(record)};
 }
 async start(input){
  assertSafeJson(input);if(this.closed)throw new SafetyError('图片服务已停止',503);if(this.running.size>=1)throw new SafetyError('已有图片生成任务运行中，请等待或取消',429);
  if(input.transparentBackground!==undefined||input.quality!==undefined||input.styleReferenceAssets!==undefined||input.styleReferenceHashes!==undefined||input.styleReferenceStrength!==undefined)throw new SafetyError('旧画布图片任务不支持透明背景、画质或风格参考选项，请使用专业图片工作区',422);
  const root=store.validateRoot(input.root);let current=store.readDoc(root,input.docId);if(current.revision!==input.baseRevision)throw new SafetyError('作品已变化，请保存后重新开始',409);if(!current.doc.pages.some(p=>p.id===input.pageId))throw new SafetyError('目标画板不存在',404);
  const mode=input.mode||'generate';if(!['generate','edit'].includes(mode))throw new SafetyError('未知图片操作',422);const prompt=String(input.prompt||'').trim(),count=input.count??1;if(!prompt||prompt.length>16000||!Number.isInteger(count)||count<1||count>4)throw new SafetyError('请输入提示词；一次生成1至4个方案',422);
  const catalogue=await this.providers.catalogue(input.provider),model=catalogue.models.find(m=>m.id===input.model);if(!model)throw new SafetyError('请选择当前目录或手动配置中的图片模型',422);
  if((model.veniceSizing||model.openAiSizing)&&(input.resolution||input.aspectRatio))throw new SafetyError('旧画布不支持该服务的尺寸选项，请使用专业图片工作区',422);
  if(!Array.isArray(input.referenceAssets||[]))throw new SafetyError('参考图列表无效',422);const references=(input.referenceAssets||[]).slice();if(references.length>4)throw new SafetyError('最多使用4张参考图',422);checkImageModel(model,mode,references.length);for(const name of references){assertPortableName(name);if(!store.readAsset(root,name))throw new SafetyError('参考图不存在',404);}
  let source=null;
  if(mode==='edit'){
   let selected=locate(current.doc,input.pageId,input.layerId).layer;if(!selected||selected.type!=='image')throw new SafetyError('局部重绘需要选择一张图片',422);
   if(Object.values(selected.adjust||{}).some(Boolean)||selected.filters?.length||selected.transform?.flipH||selected.transform?.flipV||selected.mask?.kind==='luminance')throw new SafetyError('请先将画布外观调整合入原生图片源，再做精确局部重绘',422);
   if(selected.native?.engine!=='photocraft'){await this.native.run({root,id:input.docId,pageId:input.pageId,layerId:selected.id,operation:'photo.attach',baseRevision:current.revision});current=store.readDoc(root,input.docId);selected=locate(current.doc,input.pageId,input.layerId).layer;}
   if(!catalogue.models.find(m=>m.id===input.model)?.inputImage)throw new SafetyError('所选模型未声明支持图片编辑',422);
   if(selected.naturalWidth*selected.naturalHeight>8_000_000)throw new SafetyError('局部重绘目前最多8MP',413);
   let region=input.region;if(!region&&selected.native?.hasSelection)region={kind:'native-selection',source:selected.native.source};
   if(!region||region.pageId&&region.pageId!==input.pageId||region.layerId&&region.layerId!==selected.id)throw new SafetyError('请圈选当前图片需要重绘的区域',422);
   if(region.sourceAsset&&region.sourceAsset!==selected.asset||region.kind==='native-selection'&&region.source!==selected.native.source)throw new SafetyError('选区源已变化，请重新圈选',409);
   if(references.length>2)throw new SafetyError('局部重绘最多另加2张参考图',422);
   source={asset:selected.asset,nativeSource:selected.native.source,signature:pixelSignature(selected),region,layer:{id:selected.id,x:selected.x,y:selected.y,w:selected.w,h:selected.h,rotation:selected.rotation||0,crop:selected.crop,naturalWidth:selected.naturalWidth,naturalHeight:selected.naturalHeight,native:{engine:'photocraft'}}};
  }
  if(this.running.size>=1)throw new SafetyError('已有图片任务运行，请等待或取消',429);
  const designPlan=pinImagePlan(root,input.planId,input.planRevision);
  const connectionFingerprint=catalogue.provider==='designcraft-image-api'?imageConnectionFingerprint(await this.providers.route(catalogue.provider)):null;
  const record={id:'image-'+randomUUID(),...(designPlan?{designPlan}:{}),...(connectionFingerprint?{connectionFingerprint}:{}),root,docId:input.docId,pageId:input.pageId,baseRevision:current.revision,mode,layerId:input.layerId||null,source,kind:'image.'+mode,provider:catalogue.provider,model:input.model,prompt,count,resolution:input.resolution||null,aspectRatio:input.aspectRatio||null,referenceAssets:references,status:'queued',createdAt:new Date().toISOString(),candidates:[],progress:{index:0,total:count},autoApply:input.autoApply===true&&count===1};
  const controller=new AbortController();this.records.set(root+'|'+record.id,record);this.running.set(record.id,controller);this.emit(record);queueMicrotask(()=>this.execute(record,controller).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async execute(record,controller){
  try{
   record.status='running';this.emit(record);
   if(record.studio&&record.mode==='edit'){
    const baseline=record.studio.source,stored=await new NativeSourceStore(record.root).source(baseline.sourceId,baseline.sourceRevision);
    if(stored.meta.sourceHash!==baseline.sourceHash||stored.meta.engine!=='photocraft')throw new SafetyError('原生图片基线已改变，未发送重绘请求',409);
    const sourceBytes=await readFile(stored.path);if(sourceBytes.length>64*1024*1024)throw new SafetyError('精确重绘的原生图片源超过64MiB预算',413);
    const saved=store.saveAsset(record.root,record.id+'-baseline.pcraft',sourceBytes);
    const current=await prepareImageCandidate(record.root,Buffer.alloc(0),record.id+'-baseline',controller.signal,{baseSource:saved.name});
    if(!current.native.hasSelection)throw new SafetyError('保存的原生图片没有活动选区，未发送重绘请求',422);
    if(current.width*current.height>8_000_000)throw new SafetyError('精确局部重绘目前最多8MP',413);
    record.source={asset:current.asset,nativeSource:saved.name,fontFingerprint:current.fontFingerprint,region:{kind:'native-selection',source:saved.name},layer:{id:'native-image',x:0,y:0,w:current.width,h:current.height,rotation:0,naturalWidth:current.width,naturalHeight:current.height,native:{engine:'photocraft'}}};
    this.emit(record);
   }
   let editing=null;if(record.mode==='edit'){
    let region=record.source.region;if(region.kind==='native-selection'){const captured=await captureNativeSelection(record.root,record.source.nativeSource,{signal:controller.signal});region={kind:'mask',...captured,encoding:'alpha'};}
    const prepared=await this.compute('image-mask',{root:record.root,sourceAsset:record.source.asset,layer:record.source.layer,region,name:record.id});editing=prepared;record.editMask=prepared;record.editMethod='image-reference generation with exact native masked composition';this.emit(record);
   }
   const referenceNames=editing?[record.source.asset,editing.guideAsset,...record.referenceAssets]:record.referenceAssets;
   let transmittedBytes=0;const references=referenceNames.map((name,index)=>{const bytes=store.readAsset(record.root,name);if(!bytes)throw new SafetyError('参考图原件不存在',409);if(record.referenceHashes&&(!Array.isArray(record.referenceHashes)||record.referenceHashes.length!==referenceNames.length||!record.referenceHashes[index]||createHash('sha256').update(bytes).digest('hex')!==record.referenceHashes[index]))throw new SafetyError('参考图原件已改变，未发送图片请求',409);if(record.editReferenceHashes&&(!editing||!Array.isArray(record.editReferenceHashes)||record.editReferenceHashes.length!==record.referenceAssets.length||index>=2&&createHash('sha256').update(bytes).digest('hex')!==record.editReferenceHashes[index-2]))throw new SafetyError('编辑参考图已改变，未发送图片请求',409);transmittedBytes+=bytes.length;if(transmittedBytes>16*1024*1024)throw new SafetyError('参考图合计超过16MB传输预算',413);const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':null;if(!mime)throw new SafetyError('参考图需为 PNG 或 JPEG',422);return 'data:'+mime+';base64,'+bytes.toString('base64');});
   const styleNames=record.styleReferenceAssets||[];if(!Array.isArray(styleNames)||styleNames.length>4||styleNames.length&&(!Array.isArray(record.styleReferenceHashes)||record.styleReferenceHashes.length!==styleNames.length))throw new SafetyError('风格参考图记录无效',409);
   const styleReferences=styleNames.map((name,index)=>{const bytes=store.readAsset(record.root,name);if(!bytes||!bytes.length||bytes.length>=8000000||createHash('sha256').update(bytes).digest('hex')!==record.styleReferenceHashes[index]||(transmittedBytes+=bytes.length)>16*1024*1024)throw new SafetyError('风格参考图已改变或超过预算，未发送请求',409);const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':null;if(!mime)throw new SafetyError('风格参考图需为 PNG 或 JPEG',422);return 'data:'+mime+';base64,'+bytes.toString('base64');});
   for(let index=0;index<record.count;index++){
    if(controller.signal.aborted)throw new SafetyError('图片任务已取消',499);
    if(editing&&record.source.fontFingerprint&&(await nativeProjectFonts(record.root,controller.signal)).fingerprint!==record.source.fontFingerprint)throw new SafetyError('项目字体在重绘期间已改变，未发送不一致的图片请求',409);
    const prompt=(editing?'The first image is the original. The second image is the edit-area mask: white may change, black must remain. Return the complete updated image with identical dimensions and framing. Apply this requested change within the white area: ':'')+record.prompt+(record.count>1?'\nCreate a distinct visual proposal ('+(index+1)+' of '+record.count+'); preserve the requested content.':'');
    const transform=VENICE_IMAGE_MODES.includes(record.mode),onDispatch=()=>{if(record.designPlan)verifyImagePlan(record.root,record.designPlan);record.remoteDispatch={index,provider:record.provider,model:record.model,...(transform?{protocol:'venice',operation:record.mode}:{}),state:'submitted_or_uncertain',at:new Date().toISOString()};this.emit(record);};
    const onRemoteAccepted=details=>{record.remoteDispatch={...record.remoteDispatch,...details,protocol:'fal',state:'accepted',acceptedAt:new Date().toISOString()};this.emit(record);};
    const onRemoteStatus=status=>{record.remoteDispatch={...record.remoteDispatch,serverStatus:status};this.emit(record);};
    const result=transform?await this.providers.transformVenice({...record,image:references[0],onDispatch},controller.signal):await this.providers.generate({...record,prompt,references,styleReferences,onDispatch,onRemoteAccepted,onRemoteStatus},controller.signal);
    const retainOriginal=transform||record.transparentBackground===true||!!record.quality||record.veniceSizing===true||record.openAiSizing===true||record.veniceStyleReferences===true;
    if(retainOriginal){const returned=this.retainReturnedImages(record,[result,...(result.additional||[])],index);result.returnedImageId=returned[0].id;}
    if(record.remoteDispatch?.index===index){record.remoteDispatch={...record.remoteDispatch,state:'response_received',requestId:result.requestId||null};this.emit(record);}
    if(!retainOriginal&&Array.isArray(result.additional)&&result.additional.length){
     const returned=this.retainReturnedImages(record,[result,...result.additional],index);
     result.returnedImageId=returned[0].id;
    }
    await this.appendCandidate(record,result,index,editing,controller.signal);
   }
   record.status='ready';record.finishedAt=new Date().toISOString();this.emit(record);
   if(record.autoApply&&store.readDoc(record.root,record.docId).revision===record.baseRevision){try{await this.adopt({root:record.root,id:record.id,candidateId:record.candidates[0].id,baseRevision:record.baseRevision});}catch(error){record.status='ready';record.error='已生成，自动采用未完成：'+error.message;this.emit(record);}}
  }catch(error){record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted&&['submitted_or_uncertain','accepted'].includes(record.remoteDispatch?.state)?'本地已停止等待；服务端可能仍在处理或计费，请核对任务记录，不自动重发。':String(error.message).slice(0,1000)+((VENICE_IMAGE_MODES.includes(record.mode)||record.transparentBackground===true||record.quality||record.veniceSizing===true||record.openAiSizing===true||record.veniceStyleReferences===true)&&record.remoteDispatch?.state==='submitted_or_uncertain'?'；请求结果未确认，服务可能已处理或计费，不自动重发。':'');record.finishedAt=new Date().toISOString();this.emit(record);}
  finally{this.running.delete(record.id);}
 }
 retainReturnedImages(record,images,index){
  if(!Array.isArray(images)||images.length<1||images.length>128||record.returnedImages?.some(item=>item.index===index))throw new SafetyError('图片服务返回记录无效或重复',409);
  record.returnedImages ||= [];const saved=[];
  for(let ordinal=0;ordinal<images.length;ordinal++){
   const bytes=images[ordinal]?.bytes;if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>64*1024*1024)throw new SafetyError('返回的原始图片无效或超过预算',413);
   const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216,webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
   if(!png&&!jpeg&&!webp)throw new SafetyError('服务返回的内容不是支持的图片，已保存原图仍保留',422);
   const mime=png?'image/png':jpeg?'image/jpeg':'image/webp',digest=createHash('sha256').update(bytes).digest('hex'),id='imageoutput-'+hash([record.id,index,ordinal,digest]);
   const asset=store.saveAsset(record.root,record.id+'-returned-'+(index+1)+'-'+(ordinal+1)+(png?'.png':jpeg?'.jpg':'.webp'),bytes);
   const warnings=(VENICE_IMAGE_MODES.includes(record.mode)||record.transparentBackground===true||record.quality||record.veniceSizing===true||record.openAiSizing===true||record.veniceStyleReferences===true)&&Array.isArray(images[ordinal]?.warnings)?images[ordinal].warnings.filter(value=>typeof value==='string').slice(0,10).map(value=>value.slice(0,500)):undefined;
   const item={id,index,ordinal,asset:asset.name,sha256:digest,bytes:bytes.length,mime,...(warnings?.length?{warnings}:{})};record.returnedImages.push(item);saved.push(item);this.emit(record);
  }
  return saved;
 }
 async appendCandidate(record,result,index,editing,signal){
  if(record.candidates.some(item=>item.index===index&&(!result.returnedImageId||item.returnedImageId===result.returnedImageId)))throw new SafetyError('该图片方案已保存，未重复追加',409);
  const returned=result.returnedImageId&&record.returnedImages?.find(item=>item.id===result.returnedImageId);if(result.returnedImageId&&(!returned||returned.index!==index))throw new SafetyError('图片方案与服务原图记录不一致',409);
  if(returned&&(result.bytes.length!==returned.bytes||createHash('sha256').update(result.bytes).digest('hex')!==returned.sha256))throw new SafetyError('图片方案字节与服务原图不一致',409);
  const name=record.id+'-'+(index+1)+(returned?.ordinal?'-returned-'+(returned.ordinal+1):'');
  let candidate=await prepareImageCandidate(record.root,result.bytes,name,signal);
  if(editing){
   if(!record.source?.asset||!record.source?.nativeSource||!editing.maskAsset)throw new SafetyError('局部重绘基线或选区素材缺失，原结果已保留',409);
   const vendor=candidate,overlay=await this.compute('image-overlay',{root:record.root,sourceAsset:record.source.asset,resultAsset:vendor.asset,maskAsset:editing.maskAsset,name});
   candidate=await prepareImageCandidate(record.root,Buffer.alloc(0),name+'-edited',signal,{baseSource:record.source.nativeSource,overlayAsset:overlay.overlayAsset});
   if(record.source.fontFingerprint&&candidate.fontFingerprint!==record.source.fontFingerprint)throw new SafetyError('项目字体在合成期间已改变，候选原件已保留但未采用',409);
   const verification=await this.compute('image-verify',{root:record.root,sourceAsset:record.source.asset,resultAsset:candidate.asset,maskAsset:editing.maskAsset});candidate={...candidate,vendorOriginal:vendor.original,overlayAsset:overlay.overlayAsset,verification};
  }
  if(signal?.aborted)throw new SafetyError('图片任务已取消',499);
  candidate.warnings=[...new Set([...(Array.isArray(candidate.warnings)?candidate.warnings:[]),...(Array.isArray(result.warnings)?result.warnings:[])])];
  record.candidates.push({...candidate,...(record.designPlan?{designPlan:record.designPlan}:{}),id:'candidate-'+randomUUID(),index,...(returned?{returnedImageId:returned.id,returnedOrdinal:returned.ordinal}:{}),providerRequestId:result.requestId,usage:result.usage,imageHash:hash(result.bytes.toString('base64')),...(record.studio?{sourceHash:createHash('sha256').update(store.readAsset(record.root,candidate.native.source)).digest('hex')}: {})});record.progress.index=Math.max(record.progress.index,index+1);this.emit(record);
 }
 convertReturned(root,id,outputId){
  root=store.validateRoot(root);if(this.closed)throw new SafetyError('图片服务已停止',503);if(this.running.size)throw new SafetyError('已有图片任务运行，请等待或停止',429);
  if(!/^image-[a-f0-9-]{36}$/.test(id||'')||!/^imageoutput-[a-f0-9]{64}$/.test(outputId||''))throw new SafetyError('服务原图身份无效',422);
  const release=acquireRecovery(root,id);let record,controller;
  try{
   this.records.delete(root+'|'+id);record=this.load(root,id);
   if(['running','queued'].includes(record.status)&&ownerAlive(record.ownerPid))throw new SafetyError('图片任务仍在其他进程运行',423);
   const output=Array.isArray(record.returnedImages)?record.returnedImages.find(item=>item.id===outputId):null;
   if(!output||!Number.isSafeInteger(output.index)||output.index<0||output.index>=record.count||!Number.isSafeInteger(output.ordinal)||output.ordinal<0||output.ordinal>=128||!/^[a-f0-9]{64}$/.test(output.sha256||'')||output.id!=='imageoutput-'+hash([id,output.index,output.ordinal,output.sha256]))throw new SafetyError('服务原图来源记录无效',409);
   const prior=record.candidates.find(item=>item.returnedImageId===output.id);if(prior){release();return {accepted:true,alreadyConverted:true,job:publicRecord(record)};}
   const bytes=store.readAsset(root,output.asset);if(!bytes||bytes.length!==output.bytes||createHash('sha256').update(bytes).digest('hex')!==output.sha256)throw new SafetyError('服务原图缺失或摘要不一致',409);
   if(record.mode==='edit'&&(!record.source?.asset||!record.source?.nativeSource||!record.editMask?.maskAsset))throw new SafetyError('原图片或选区记录缺失，无法转换重绘结果',409);
   const previousStatus=record.status;record.ownerPid=process.pid;record.status='running';record.returnedConversion={outputId,state:'running',previousStatus,startedAt:new Date().toISOString()};
   controller=new AbortController();this.records.set(root+'|'+id,record);this.running.set(id,controller);this.emit(record);
   queueMicrotask(()=>this.finishReturned(record,output,bytes,previousStatus,controller,release).catch(()=>{}));
   return {accepted:true,job:publicRecord(record)};
  }catch(error){if(controller)this.running.delete(id);release();throw error;}
 }
 async finishReturned(record,output,bytes,previousStatus,controller,release){
  try{
   await this.appendCandidate(record,{bytes,returnedImageId:output.id,requestId:record.remoteDispatch?.index===output.index?record.remoteDispatch.requestId:null,usage:{},warnings:['由已保存的同一次服务返回原图转换，没有重新调用图片服务。',...(Array.isArray(output.warnings)?output.warnings:[])]},output.index,record.mode==='edit'?record.editMask:null,controller.signal);
   record.returnedConversion={...record.returnedConversion,state:'complete',finishedAt:new Date().toISOString()};
  }catch(error){record.returnedConversion={...record.returnedConversion,state:controller.signal.aborted?'cancelled':'failed',error:controller.signal.aborted?'已停止转换，原图保留。':String(error.message||error).slice(0,500),finishedAt:new Date().toISOString()};}
  finally{record.status=previousStatus;try{this.emit(record);}finally{this.running.delete(record.id);release();}}
 }
 recoverFal(root,id){
  root=store.validateRoot(root);if(this.closed)throw new SafetyError('图片服务已停止',503);if(this.running.size)throw new SafetyError('已有图片任务运行，请等待或停止',429);
  if(!/^image-[a-f0-9-]{36}$/.test(id||''))throw new SafetyError('图片任务 ID 无效',422);
  const release=acquireRecovery(root,id);let record,controller;
  try{
   this.records.delete(root+'|'+id);record=this.load(root,id);const dispatch=record.remoteDispatch;
   if(['running','queued'].includes(record.status)&&ownerAlive(record.ownerPid))throw new SafetyError('图片任务仍在其他进程运行',423);
   if(!dispatch||dispatch.protocol!=='fal'||dispatch.provider!==record.provider||dispatch.model!==record.model||!['accepted','response_received'].includes(dispatch.state)||typeof dispatch.connection!=='string'||!['image','images'].includes(dispatch.output)||!Number.isSafeInteger(dispatch.index)||dispatch.index<0||dispatch.index>=record.count||!dispatch.requestId||record.remoteCancel?.state==='removed_from_queue')throw new SafetyError('此任务没有可安全恢复的 fal 请求记录',409);
   if(record.candidates.some(item=>item.index===dispatch.index))throw new SafetyError('该 fal 结果已有候选，未重复取回',409);
   if(record.mode==='edit'&&(!record.source?.asset||!record.source?.nativeSource||!record.editMask?.maskAsset))throw new SafetyError('局部重绘的原图或选区记录缺失，无法安全恢复',409);
   record.ownerPid=process.pid;record.status='running';delete record.error;controller=new AbortController();this.records.set(root+'|'+id,record);this.running.set(id,controller);this.emit(record);
  }catch(error){if(controller)this.running.delete(id);release();throw error;}
  queueMicrotask(()=>this.executeFalRecovery(record,controller,release).catch(()=>{}));return {accepted:true,job:publicRecord(record)};
 }
 async executeFalRecovery(record,controller,release){
  try{
   const dispatch=record.remoteDispatch,onStatus=status=>{record.remoteDispatch={...record.remoteDispatch,serverStatus:status};this.emit(record);};
   const result=await this.providers.retrieveFal(record.provider,dispatch,controller.signal,onStatus);
   record.remoteDispatch={...record.remoteDispatch,state:'response_received'};this.emit(record);
   await this.appendCandidate(record,result,dispatch.index,record.mode==='edit'?record.editMask:null,controller.signal);
   record.status='ready';record.finishedAt=new Date().toISOString();if(record.candidates.length<record.count)record.error='已取回当前 fal 请求；其余未提交方案不会自动重新发送。';else delete record.error;this.emit(record);
  }catch(error){record.status=controller.signal.aborted?'cancelled':'failed';record.error=controller.signal.aborted?'本地已停止等待；fal 任务可能仍在处理或计费。':String(error.message||error).slice(0,1000);record.finishedAt=new Date().toISOString();this.emit(record);}
  finally{this.running.delete(record.id);release();}
 }
 async cancelRemoteFal(root,id,signal){
  root=store.validateRoot(root);if(this.running.has(id))throw new SafetyError('请先停止本地等待，再请求远端取消',409);
  const release=acquireRecovery(root,id);
  try{
   this.records.delete(root+'|'+id);const record=this.load(root,id),dispatch=record.remoteDispatch;
   if(['running','queued'].includes(record.status)&&ownerAlive(record.ownerPid))throw new SafetyError('图片任务仍在其他进程运行',423);
   if(!dispatch||dispatch.protocol!=='fal'||dispatch.provider!==record.provider||dispatch.model!==record.model||!['accepted','response_received'].includes(dispatch.state)||typeof dispatch.connection!=='string'||!dispatch.requestId)throw new SafetyError('此任务没有可取消的 fal 请求记录',409);
   const result=await this.providers.cancelFal(record.provider,dispatch,signal);record.remoteCancel={...result,at:new Date().toISOString(),requestId:dispatch.requestId};this.emit(record);return {remoteCancel:record.remoteCancel,job:publicRecord(record)};
  }finally{release();}
 }
 async adopt(input){
  const root=store.validateRoot(input.root),record=this.load(root,input.id),candidate=record.candidates.find(c=>c.id===input.candidateId);if(!candidate)throw new SafetyError('候选图片不存在',404);
  if(this.running.has(record.id)&&record.status!=='ready')throw new SafetyError('图片任务仍在运行，请完成或取消后采用',409);
  const current=store.readDoc(root,record.docId);if(current.revision!==input.baseRevision)throw new SafetyError('作品已更新，请核对最新版本后采用',409);const {page,layer:prior}=locate(current.doc,record.pageId,record.mode==='edit'?record.layerId:record.adoptedLayerId);if(!page)throw new SafetyError('目标画板已删除，候选图片仍已保留',409);
  const priorCandidate=prior?.native?.aiJob?.jobId===record.id?record.candidates.find(c=>c.id===prior.native.aiJob.candidateId&&c.asset===prior.asset&&c.native.source===prior.native.source):null;
  if(priorCandidate?.id===candidate.id)return {ok:true,...current,job:publicRecord(record),alreadyAdopted:true};
  if(record.mode==='edit'&&!input.asNew&&(!prior||pixelSignature(prior)!==record.source.signature&&!priorCandidate))throw new SafetyError('图片源在重绘期间已改变，候选已保留；可作为新图层采用',409);
  if(record.mode==='generate'&&prior&&!input.asNew&&!priorCandidate)throw new SafetyError('已采用图片被继续编辑，请选择作为新图层采用',409);
  const scale=Math.min(1,current.doc.canvas.width*.85/candidate.width,current.doc.canvas.height*.85/candidate.height),layer=prior&&!input.asNew?prior:{id:'generated-'+randomUUID(),type:'image',name:'AI 图片',x:(current.doc.canvas.width-candidate.width*scale)/2,y:(current.doc.canvas.height-candidate.height*scale)/2,w:candidate.width*scale,h:candidate.height*scale,opacity:1,blend:'normal'};
  if(layer!==prior)page.layers.push(layer);layer.asset=candidate.asset;layer.naturalWidth=candidate.width;layer.naturalHeight=candidate.height;layer.native={...candidate.native,aiJob:{jobId:record.id,candidateId:candidate.id}};
  const saved=store.writeDoc(root,record.docId,current.doc,'image-adopt',{baseRevision:input.baseRevision,returnDocument:true});record.status='adopted';record.adoptedLayerId=layer.id;record.adoptedSource=layer.native.source;record.adoptedCandidateId=candidate.id;record.adoptedAt=new Date().toISOString();delete record.error;this.emit(record);return {ok:true,...saved,job:publicRecord(record)};
 }
 cancel(root,id){root=store.validateRoot(root);const record=this.load(root,id),controller=this.running.get(id);if(controller&&record.root===root&&['running','queued'].includes(record.status)){controller.abort();return true;}return false;}
 dispose(){this.closed=true;for(const controller of this.running.values())controller.abort();}
}
