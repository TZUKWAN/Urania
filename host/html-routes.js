import {workflowContext} from './od-workflow-context.js';
import {readFile} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {HtmlArtifacts, previewFiles} from './html-artifacts.js';
import {inspectHtmlDependencyHints} from './html-dependency-hints.js';
import {tailwindPreviewBytes,tailwindPreviewEvidence,TAILWIND_PREVIEW_SHA256} from './tailwind-preview.js';
import {freezeTailwindHtml,tailwindFreezeStatus} from './html-tailwind-freeze.js';
import {attachHtmlProjectFont,htmlProjectFontStatus} from './html-project-font.js';
import {SafetyError} from './safety.js';
import {materializeHtmlResource} from './html-tools.js';
import {resourceHtmlStatus} from './opendesign-html-import.js';
import {listHtmlProjectAssets,applyHtmlProjectAsset,inspectHtmlAssetOp,listHtmlAssetOps,recoverHtmlAssetOp} from './html-project-asset.js';
import {importExternalHtml,externalHtmlStatus} from './external-html-import.js';
import {listStitchImageImports,recoverStitchImageOpen,openStitchImage,reconcileStitchImage} from './stitch-image-import.js';
import {readOpenDesignStyle} from './open-design-style.js';
import {readExternalTheme} from './external-theme.js';
import {colorContrast,convertColor} from './color-contrast.js';
import {auditSavedNativeColors} from './native-color-source.js';
import {materializeOpenDesignPackage,loadSavedOpenDesignPackage} from './open-design-package.js';
import {CreativeDirectorResource} from './creative-director-resource.js';
import {materialize,openMaterializedNative,reconcileOpenDesignNative,listExternalNativeOpens,pendingExternalNativeOpens,recoverExternalNativeOpen,openExternalNative,reconcileExternalNative} from './open-design-tools.js';
import {discoverExternalSkills,readExternalSkillCandidate,inspectExternalSkill,saveExternalSkill,listExternalSkills,readExternalSkill,readMaterializedExternalFile,materializeExternalSkillFile,materializeExternalLfsFile,materializeExternalFontFile} from './external-skill-bundles.js';
import {saveUserFont,registerProjectFont,disableProjectFont,enableProjectFont,listProjectFonts,disabledProjectFonts,pendingProjectFonts,pendingUserFonts,recoverAnyProjectFont,quarantineProjectFont,projectFontSnapshot} from './project-fonts.js';

const ROOT = '/designcraft/api/v2/studio';
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendor = join(packageRoot, 'resources', 'open-design', 'dom-to-pptx');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let cachedConverter;

async function converterBytes() {
 if (cachedConverter) return cachedConverter;
 const lock = JSON.parse(await readFile(join(vendor, 'source-lock.json'), 'utf8'));
 const entry = lock.files?.find(file => file.name === 'dom-to-pptx.bundle.js.gz');
 if (lock.repository !== 'atharva9167j/dom-to-pptx' || lock.revision !== 'c0447adc47d3bc734d017050834edf0941adc189' || lock.localBuild !== 'urania.codec1' || !entry) throw new SafetyError('网页转换器来源记录不可用', 503);
 const compressed = await readFile(join(vendor, entry.name));
 if (compressed.length !== entry.bytes || digest(compressed) !== entry.sha256) throw new SafetyError('网页转换器文件与固定版本不一致', 503);
 const result = gunzipSync(compressed, {maxOutputLength:12 * 1024 * 1024});
 if (result.length !== entry.expandedBytes || digest(result) !== entry.expandedSha256) throw new SafetyError('网页转换器解压内容不一致', 503);
 cachedConverter = result;
 return result;
}

async function readStream(request, maximum) {
 const chunks = [];
 let length = 0;
 for await (const chunk of request) {
  length += chunk.length;
  if (length > maximum) throw new SafetyError('转换文件超过大小预算', 413);
  chunks.push(chunk);
 }
 return Buffer.concat(chunks, length);
}

export function htmlRoutes(manager, {guard, readJsonBody, sendJson, library, stitch}) {
 const previews = new Map();
 const previewLifetime = 10 * 60 * 1000;
 const discardExpired = () => {
  const now = Date.now();
  for (const [key, preview] of previews) if (preview.expires <= now) previews.delete(key);
 };
 const viewFor = request => manager.getView(request.headers['x-designcraft-view'], request.headers['x-designcraft-capability']);
 const session = (request, epoch) => {
  const view = viewFor(request);
  if (!epoch || view.epoch !== epoch) throw new SafetyError('工作区已经切换，请重新打开网页作品', 409);
  return {view, store:new HtmlArtifacts(manager.scope(view.sessionId, view.root))};
 };
 const admission=(view,epoch,jobId)=>{
  if(!jobId)return manager.fileActionIdle(view,epoch);
  const job=manager.jobs.get(jobId);
  if(epoch!==view.epoch||!job||job.viewId!==view.id||job.epoch!==epoch||!['html_convert','html_freeze_tailwind'].includes(job.action)||job.status!=='running'||!job.executionStartedAt||job.cancelRequested||view.saving||view.switching)throw new SafetyError('网页动作没有有效许可',409);
 };
 const tailwindEvidence=async(view,token,id,revision,store)=>{
  if(typeof token!=='string'||!/^[a-f0-9]{48}$/.test(token))throw new SafetyError('Tailwind 预览能力无效',422);
  discardExpired();const preview=previews.get(token);
  if(!preview||preview.viewId!==view.id||preview.epoch!==view.epoch||!preview.tailwindPath||preview.tailwindRequested!==true)throw new SafetyError('Tailwind 预览已过期或脚本未被请求，请重新预览',409);
  const saved=await store.read(id,revision),originals=[...preview.files.values()].filter(file=>file.path!==preview.tailwindPath),byPath=new Map(originals.map(file=>[file.path,file]));
  if(preview.entry!==saved.document.entry||originals.length!==saved.document.files.length||saved.document.files.some(file=>{const item=byPath.get(file.path);return !item||item.sha256!==file.sha256||item.bytes!==file.bytes||item.mime!==file.mime;}))throw new SafetyError('兼容预览与已保存网页版本不一致',409);
  const script=preview.files.get(preview.tailwindPath);if(!script||script.sha256!==TAILWIND_PREVIEW_SHA256)throw new SafetyError('Tailwind 预览资源身份不一致',409);
  return tailwindPreviewEvidence();
 };
 const sendRetained=(response,error,view,epoch,root,timedOut=false)=>{
  if(!error?.retained)return false;
  try{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==epoch||manager.scope(view.sessionId)!==root)return false;}catch{return false;}
  const status=timedOut?504:Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:500;
  sendJson(response,status,{ok:false,error:timedOut?'外部资源读取超时':String(error.message||error),...error.retained,readStateBeforeRetry:true});
  return true;
 };
 return [
  {kind:'exact',path:ROOT+'/font-upload',handler:guard(async(request,response)=>{
   if(request.method!=='POST')throw new SafetyError('POST required',405);
   const query=new URL(request.url,'http://localhost').searchParams,epoch=query.get('epoch'),{view}=session(request,epoch),root=manager.scope(view.sessionId,view.root);
   if(!/^application\/octet-stream(?:\s*;|$)/i.test(String(request.headers['content-type']||'')))throw new SafetyError('请选择字体文件',422);
   manager.fileActionIdle(view,epoch);
   const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);let saved;
   const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，未向其他项目导入字体',409);manager.fileActionIdle(view,epoch);};
   try{
    const bytes=await readStream(request,4*1024*1024);controller.signal.throwIfAborted();current();
    saved=await saveUserFont(root,query.get('name'),bytes,current,controller.signal);
    let result;try{result={...saved,...await registerProjectFont(root,saved.file,current,controller.signal)};}
    catch(error){error.retained={...saved,provenanceRecorded:true,fontRegistered:false};throw error;}
    try{current();}catch{throw new SafetyError('工作区已切换；字体可能已保存在原项目，请返回核对',409);}
    sendJson(response,200,{ok:true,...result});
   }catch(error){if(sendRetained(response,error,view,epoch,root))return;throw error;}
   finally{response.off('close',abort);}
  })},
  {kind:'exact',path:ROOT+'/html-resource',handler:guard(async(request,response)=>{
   if(request.method!=='POST')throw new SafetyError('POST required',405);
   const body=await readJsonBody(request,128*1024),{view,store}=session(request,body.epoch);let result;
   if(body.action==='search')result=library.search({query:body.query||'',kind:body.kind||'design-system',offset:body.offset||0,limit:20});
   else if(body.action==='workflow-context'){
     const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
     try{result=await workflowContext(library,view.root,body,controller.signal);if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==view.root)throw new SafetyError('工作区已切换，未返回旧项目规则',409);}finally{response.off('close',abort);}
    }
    else if(body.action==='color-contrast')result=colorContrast(body.foreground,body.background);
    else if(body.action==='color-convert')result=convertColor(body.foreground,body.space||'oklch');
    else if(body.action==='color-audit')result=await auditSavedNativeColors(view,{background:body.background});
   else if(body.action==='package')result=library.package(body.id,{offset:body.offset||0,limit:50});
   else if(body.action==='style'){
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    try{const saved=await loadSavedOpenDesignPackage(library,view.root,'design-systems/'+body.id);result=await readOpenDesignStyle(library,body.id,controller.signal,{sourceFiles:saved?.files});}
    finally{response.off('close',abort);}
   }
   else if(body.action==='retain-package'){
    manager.fileActionIdle(view,body.epoch);
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    try{result=await materializeOpenDesignPackage(library,view.root,body.id,controller.signal,()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch)throw new SafetyError('工作区已切换，资源包未发布；已写入的原件会保留',409);manager.fileActionIdle(view,body.epoch);});}
    finally{response.off('close',abort);}
   }
   else if(body.action==='director-use'){
    manager.fileActionIdle(view,body.epoch);
    result=new CreativeDirectorResource().markUsed(view.root);
   }
   else if(['stitch-catalog','stitch-read','stitch-snapshot','stitch-candidates','stitch-capture','stitch-assets','stitch-recover-asset','stitch-open-html','stitch-image-imports','stitch-open-image','stitch-reconcile-image','stitch-recover-image-open','stitch-start','stitch-jobs','stitch-job','stitch-result','stitch-recover-saved','stitch-stop'].includes(body.action)){
    if(!stitch)throw new SafetyError('Stitch 服务不可用',503);
    const root=manager.scope(view.sessionId,view.root),write=['stitch-capture','stitch-recover-asset','stitch-open-html','stitch-open-image','stitch-reconcile-image','stitch-recover-image-open','stitch-start','stitch-recover-saved'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    try{
     const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对 Stitch 记录',409);if(write)manager.fileActionIdle(view,body.epoch);};
     if(body.action==='stitch-catalog')result=await stitch.catalog(controller.signal);
     else if(body.action==='stitch-read')result=await stitch.read(root,{tool:body.tool,args:body.args,schemaSha256:body.schemaSha256},controller.signal);
     else if(body.action==='stitch-snapshot')result=stitch.readSnapshot(root,body.snapshotId,{offset:body.offset??0,limit:12000});
     else if(body.action==='stitch-candidates')result=stitch.candidates(root,body.snapshotId);
     else if(body.action==='stitch-capture')result=await stitch.capture(root,body.snapshotId,body.candidateId,controller.signal,current);
     else if(body.action==='stitch-assets')result=await stitch.assets(root);
     else if(body.action==='stitch-recover-asset')result=await stitch.recoverAsset(root,body.candidate,controller.signal,current);
     else if(body.action==='stitch-image-imports')result=await listStitchImageImports(root);
     else if(body.action==='stitch-reconcile-image')result=await reconcileStitchImage(manager,root,body.id,controller.signal,current);
     else if(body.action==='stitch-recover-image-open')result=await recoverStitchImageOpen(root,body.candidate,controller.signal,current);
     else if(body.action==='stitch-open-image')result=await openStitchImage(manager,root,view.sessionId,body.assetId,'ui-open-'+String(body.assetId||''),controller.signal);
     else if(body.action==='stitch-jobs')result={jobs:stitch.list(root)};
     else if(body.action==='stitch-job')result={job:stitch.get(root,body.id)};
     else if(body.action==='stitch-result')result=stitch.readResult(root,body.id,{offset:body.offset??0,limit:12000});
     else if(body.action==='stitch-recover-saved')result=stitch.recoverSaved(root,body.id,current);
     else if(body.action==='stitch-stop')result={stopped:stitch.stop(root,body.id)};
     else if(body.action==='stitch-start'){
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('Stitch 操作身份无效',422);
      const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await stitch.start(root,{tool:body.tool,args:body.args,schemaSha256:body.schemaSha256,operationId},controller.signal,current);
     }else{
      const operationId=createHash('sha256').update(view.sessionId+'\0ui-open-'+String(body.assetId||'')).digest('hex');result=await stitch.openHtml(root,body.assetId,operationId,body.title,controller.signal,current);
     }
     if(body.action==='stitch-open-image'){if(manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对截图导入',409);}else current();
    }catch(error){if(sendRetained(response,error,view,body.epoch,root))return;throw error;}
    finally{response.off('close',abort);}
   }
   else if(['external-html-import','external-html-status'].includes(body.action)){
    const root=manager.scope(view.sessionId,view.root),write=body.action==='external-html-import';if(write)manager.fileActionIdle(view,body.epoch);if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('外部网页操作身份无效',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex'),controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);const timer=setTimeout(()=>controller.abort(),240000),current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对外部网页',409);if(write)manager.fileActionIdle(view,body.epoch);};
    try{result=write?await importExternalHtml({library,root,bundleId:body.bundleId,entry:body.entry,scope:body.scope||'bundle',includeLfs:body.includeLfs===true,title:body.title,operationId,signal:controller.signal,assertCurrent:current}):await externalHtmlStatus(root,operationId,{bundleId:body.bundleId,entry:body.entry,scope:body.scope||'bundle',includeLfs:body.includeLfs===true});current();}
    catch(error){if(sendRetained(response,error,view,body.epoch,root))return;throw error;}finally{clearTimeout(timer);response.off('close',abort);}
   }
   else if(['external-native-list','external-native-open','external-native-reconcile','external-native-recover'].includes(body.action)){
    const root=manager.scope(view.sessionId,view.root),write=body.action!=='external-native-list';if(write)manager.fileActionIdle(view,body.epoch);const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对外部导入',409);if(write)manager.fileActionIdle(view,body.epoch);};
    try{
     if(body.action==='external-native-list')result={items:await listExternalNativeOpens(root),pending:await pendingExternalNativeOpens(root),note:'预约不代表导入已完成，请核对实际原生源。'};
     else if(body.action==='external-native-reconcile')result=await reconcileExternalNative(manager,library,root,view.sessionId,body.id,controller.signal,current);
     else if(body.action==='external-native-recover')result=await recoverExternalNativeOpen(manager,library,root,body.candidate,controller.signal,current);
     else{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('外部原生导入操作身份无效',422);result=await openExternalNative(manager,library,root,view.sessionId,body.id,body.kind,body.operationKey,controller.signal,current,'manual');}
     if(body.action==='external-native-open'){if(manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对外部导入',409);}else current();
    }catch(error){if(sendRetained(response,error,view,body.epoch,root))return;throw error;}finally{response.off('close',abort);}
   }
   else if(['external-discover','external-candidate','external-inspect','external-fetch'].includes(body.action)){
    const root=manager.scope(view.sessionId,view.root),write=body.action==='external-fetch';
    if(write){manager.fileActionIdle(view,body.epoch);if(!/^[a-f0-9]{40}$/.test(body.revision||''))throw new SafetyError('请先查看精确的外部资源版本',422);}
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},write?240000:150000);
    try{
     const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，外部资源未发布；已写入的原件会保留',409);if(write)manager.fileActionIdle(view,body.epoch);};
     if(body.action==='external-discover')result=await discoverExternalSkills(library,root,body.id,controller.signal,{revision:body.revision,offset:body.offset||0,limit:50});
     else if(body.action==='external-candidate')result=await readExternalSkillCandidate(library,root,body.id,controller.signal,{revision:body.revision,subdir:body.subdir,offset:body.offset||0,limit:12000});
     else if(body.action==='external-inspect')result=await inspectExternalSkill(library,root,body.id,controller.signal,{revision:body.revision,subdir:body.subdir});
     else result=await saveExternalSkill(library,root,body.id,body.revision,materialize,controller.signal,current,{subdir:body.subdir});
    }catch(error){if(sendRetained(response,error,view,body.epoch,root,timedOut))return;if(timedOut)throw new SafetyError('外部资源读取超时；已保存原件保留，请先核对项目',504);throw error;}
    finally{clearTimeout(timer);response.off('close',abort);}
   }
   else if(body.action==='external-files'||body.action==='external-theme'||body.action==='external-materialize'||body.action==='external-lfs'||body.action==='external-font'){
    const root=manager.scope(view.sessionId,view.root),write=!['external-files','external-theme'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    try{
     const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，外部文件来源未发布；已写入的原件会保留',409);if(write)manager.fileActionIdle(view,body.epoch);};
     if(body.action==='external-theme'){result=await readExternalTheme(library,root,body.bundleId,body.file,controller.signal);current();}
     else if(!write)result=await readExternalSkill(library,root,body.bundleId,{offset:body.offset||0,limit:100,signal:controller.signal});
     else{
      const saved=await (body.action==='external-lfs'?materializeExternalLfsFile:body.action==='external-font'?materializeExternalFontFile:materializeExternalSkillFile)(library,root,body.bundleId,body.file,controller.signal,current);
      if(body.action==='external-font'){
       try{result={...saved,...await registerProjectFont(root,saved.file,current,controller.signal)};}
       catch(error){error.retained={...saved,provenanceRecorded:true,fontRegistered:false};throw error;}
      }else result=saved;
     }
    }catch(error){if(sendRetained(response,error,view,body.epoch,root))return;throw error;}
    finally{response.off('close',abort);}
   }
   else if(body.action==='external-list'){
    const root=manager.scope(view.sessionId,view.root),items=await listExternalSkills(root);
    result={items:items.filter(item=>item.odId===body.id||item.error),note:'仅列出项目记录，查看文件时才核对原包。'};
   }
   else if(body.action==='font-snapshot'){
    const root=manager.scope(view.sessionId,view.root),controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},30000);
    try{
     result=await projectFontSnapshot(library,root,controller.signal);
     if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，未返回其他项目的字体',409);
    }catch(error){if(timedOut)throw new SafetyError('项目字体读取超时，源文件已保留',504);throw error;}
    finally{clearTimeout(timer);response.off('close',abort);}
   }
   else if(body.action==='font-list'||body.action==='font-disable'||body.action==='font-recover'||body.action==='font-enable'||body.action==='font-quarantine'){
    const root=manager.scope(view.sessionId,view.root),write=body.action!=='font-list';if(write)manager.fileActionIdle(view,body.epoch);
    const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，未更改其他项目的字体',409);if(write)manager.fileActionIdle(view,body.epoch);};
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    try{
     result=body.action==='font-disable'?await disableProjectFont(root,body.fontId,current,controller.signal):body.action==='font-recover'?await recoverAnyProjectFont(library,root,body.name,controller.signal,current):body.action==='font-enable'?await enableProjectFont(library,root,body.name,controller.signal,current):body.action==='font-quarantine'?await quarantineProjectFont(root,body.name,controller.signal,current):{items:(await listProjectFonts(root)).map(item=>item.record),pending:[...await pendingProjectFonts(root),...await pendingUserFonts(root)],disabled:await disabledProjectFonts(root)};
     try{current();}catch(error){if(write)throw new SafetyError('字体登记可能已在原项目改变，请返回项目字体列表核对',409);throw error;}
    }catch(error){if(sendRetained(response,error,view,body.epoch,root))return;throw error;}
    finally{response.off('close',abort);}
   }
   else if(body.action==='native-reconcile'){
    const stillCurrent=()=>{if(body.epoch!==view.epoch||view.saving||view.switching||manager.active.get(view.sessionId)!==view.id)throw new SafetyError('工作区正在切换或保存，请稍后核对',409);};stillCurrent();
    const kind=typeof body.file==='string'&&/\.svg$/i.test(body.file)?'svg':typeof body.file==='string'&&/\.(?:png|jpe?g)$/i.test(body.file)?'image':null;
    if(!kind)throw new SafetyError('请选择 SVG、PNG 或 JPEG 原文件',422);
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    try{
     const root=manager.scope(view.sessionId,view.root),saved=await materialize(library,root,body.id,body.file,controller.signal);
     result={resource:saved.receipt,...await reconcileOpenDesignNative(manager,root,saved.receipt,kind,controller.signal,()=>{stillCurrent();if(manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，停止核对',409);},view,{sourceId:body.sourceId})};
    }finally{response.off('close',abort);}
   }
   else if(body.action==='native-import'){
    manager.fileActionIdle(view,body.epoch);
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationId||'')||typeof body.file!=='string')throw new SafetyError('资源导入身份无效',422);
    const kind=/\.svg$/i.test(body.file)?'svg':/\.(?:png|jpe?g)$/i.test(body.file)?'image':null;
    if(!kind)throw new SafetyError('请选择 SVG、PNG 或 JPEG 原文件',422);
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);let saved;
    try{
     const root=manager.scope(view.sessionId,view.root);saved=await materialize(library,root,body.id,body.file,controller.signal);
     const opened=await openMaterializedNative(manager,root,view.sessionId,saved,{file:body.file,title:body.title,kind,operationId:body.operationId,signal:controller.signal,initiator:'manual',assertCurrent:()=>{if(manager.active.get(view.sessionId)!==view.id||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，原件已保留但未导入',409);manager.fileActionIdle(view,body.epoch);}});
     result={resource:saved.receipt,asset:{name:saved.asset.name,path:saved.asset.path,bytes:saved.asset.size},...opened};
    }catch(error){
     if(!response.destroyed&&!response.writableEnded)sendJson(response,error.status||500,{ok:false,error:String(error.message||error),...(saved?{resource:saved.receipt,asset:{name:saved.asset.name,path:saved.asset.path,bytes:saved.asset.size},materialized:true}:error.retained||{}),...(error.opened?{opened:error.opened}:{}),readStateBeforeRetry:true});
     return;
    }finally{response.off('close',abort);}
   }
   else if(['project-assets','project-asset-apply','project-asset-status','project-asset-ops','project-asset-recover'].includes(body.action)){
    const root=manager.scope(view.sessionId,view.root),write=['project-asset-apply','project-asset-recover'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对网页素材',409);if(write)manager.fileActionIdle(view,body.epoch);},controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    try{if(body.action==='project-assets')result=await listHtmlProjectAssets(root,{query:body.query||'',offset:body.offset??0,limit:30});else if(body.action==='project-asset-status')result=await inspectHtmlAssetOp(root,body.id);else if(body.action==='project-asset-ops')result=await listHtmlAssetOps(root,{offset:body.offset??0,limit:30});else if(body.action==='project-asset-recover')result=await recoverHtmlAssetOp(root,body.candidate,controller.signal,current);else{if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('网页素材加入需要稳定操作身份',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await applyHtmlProjectAsset(root,{htmlId:body.htmlId,baseRevision:body.revision,assetId:body.assetId,operationId},controller.signal,current);}current();}
    catch(error){if(sendRetained(response,error,view,body.epoch,root))return;throw error;}finally{response.off('close',abort);}
   }
   else if(body.action==='resource-html-status'){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('固定网页导入操作身份无效',422);const root=manager.scope(view.sessionId,view.root),operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await resourceHtmlStatus({library,store,operationId,resourceId:body.id,entry:body.entry});if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对固定网页',409);
   }else if(body.action==='import'){
    manager.fileActionIdle(view,body.epoch);
    if(body.operationKey!==undefined&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey))throw new SafetyError('固定网页导入操作身份无效',422);const root=manager.scope(view.sessionId,view.root),operationId=body.operationKey?createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex'):undefined,current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对固定网页',409);manager.fileActionIdle(view,body.epoch);};
    const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
    try{result=await materializeHtmlResource({library,store,resourceId:body.id,entry:body.entry,title:body.title,signal:controller.signal,operationId,assertCurrent:current});}
    catch(error){if(sendRetained(response,error,view,body.epoch,root))return;throw error;}
    finally{response.off('close',abort);}
   }else throw new SafetyError('未知网页资源操作',422);
   sendJson(response,200,{ok:true,...result});
  })},
  {kind:'exact', path:ROOT + '/html', handler:guard(async (request, response) => {
   if (request.method !== 'POST') throw new SafetyError('POST required', 405);
   const body = await readJsonBody(request, 36 * 1024 * 1024);
   const {view, store} = session(request, body.epoch);
   let result;
   if (body.action === 'list') result = {items:await store.list()};
   else if (body.action === 'read') result = await store.read(body.id, body.revision);
   else if (body.action === 'dependencies') {const saved=await store.read(body.id,body.revision);result={id:body.id,revision:saved.revision,...inspectHtmlDependencyHints(saved.document.files)};}
   else if(body.action==='project-font-attach'||body.action==='project-font-status'){
    if(typeof body.operationKey!=='string'||!body.operationKey||body.operationKey.length>250||/[\x00-\x1f]/.test(body.operationKey)||!/^[a-f0-9]{64}$/.test(body.revision||''))throw new SafetyError('网页字体操作身份或基础版本无效',422);
    const root=manager.scope(view.sessionId,view.root),write=body.action==='project-font-attach',operationId=digest(Buffer.from(JSON.stringify([view.sessionId,body.operationKey,body.id,body.revision]))),expected={baseRevision:body.revision,fontId:body.fontId,family:body.family,weight:body.weight,style:body.style};
    const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对网页字体',409);if(write)manager.fileActionIdle(view,body.epoch);};current();
    if(!write)result=await htmlProjectFontStatus(store,body.id,operationId,expected);
    else{
     const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
     try{result=await attachHtmlProjectFont(library,root,{id:body.id,operationId,...expected},controller.signal,current);}
     finally{response.off('close',abort);}
     if(result.found)manager.onChange(root,{kind:'html-source',id:body.id,revision:result.revision});
    }
    current();
   }
   else if (body.action === 'tailwind-freeze-status' || body.action === 'tailwind-freeze') {
    if(typeof body.operationKey!=='string'||!body.operationKey||body.operationKey.length>250||/[\x00-\x1f]/.test(body.operationKey)||!/^[a-f0-9]{64}$/.test(body.revision||'')||!/^[a-f0-9]{64}$/.test(body.cssSha256||''))throw new SafetyError('Tailwind 保存身份或基线无效',422);
    const root=manager.scope(view.sessionId,view.root),operationId=digest(Buffer.from(JSON.stringify([view.sessionId,body.operationKey,body.id,body.revision]))),current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对 Tailwind 保存',409);};
    current();
    if(body.action==='tailwind-freeze-status')result=await tailwindFreezeStatus(store,body.id,operationId,{baseRevision:body.revision,cssSha256:body.cssSha256});
    else{
     admission(view,body.epoch,body.jobId);
     if(typeof body.css!=='string'||!body.css||Buffer.byteLength(body.css)>2*1024*1024||digest(Buffer.from(body.css,'utf8'))!==body.cssSha256)throw new SafetyError('预览样式内容或摘要无效',422);
     const prior=await tailwindFreezeStatus(store,body.id,operationId,{baseRevision:body.revision,cssSha256:body.cssSha256});
     if(prior.found)result={...prior,reused:true};
     else{
      await tailwindEvidence(view,request.headers['x-designcraft-preview'],body.id,body.revision,store);current();admission(view,body.epoch,body.jobId);
      const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
      try{result=await freezeTailwindHtml(root,{id:body.id,baseRevision:body.revision,operationId,css:body.css},controller.signal,()=>{current();admission(view,body.epoch,body.jobId);});}
      finally{response.off('close',abort);}
     }
     if(result.found){if(body.jobId){const job=manager.jobs.get(body.jobId);if(!job||job.viewId!==view.id||job.epoch!==body.epoch||job.action!=='html_freeze_tailwind')throw new SafetyError('网页已保存，但动作回执未确认，请先核对保存状态',409);job.projectMutation={kind:'tailwind-freeze',htmlId:body.id,revision:result.revision,operationId};}manager.onChange(root,{kind:'html-source',id:body.id,revision:result.revision});}
    }
    current();
   }
   else if (body.action === 'conversions') result = {items:await store.conversions(body.id)};
   else if (body.action === 'conversion-candidates') result = {items:await store.conversionCandidates(body)};
   else if (body.action === 'preview') {
    const files = previewFiles(body.files, body.entry);
    if(body.tailwindCompat!==undefined&&typeof body.tailwindCompat!=='boolean')throw new SafetyError('Tailwind 预览选项无效',422);
    let tailwindPath;
    if(body.tailwindCompat===true){
     const root=manager.scope(view.sessionId,view.root),controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
     let script;try{script=await tailwindPreviewBytes(controller.signal);}finally{response.off('close',abort);}
     if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，未创建兼容预览',409);
     tailwindPath='__dc-tailwind-'+randomBytes(12).toString('hex')+'.js';
     if(files.some(file=>file.path.toLowerCase()===tailwindPath.toLowerCase()))throw new SafetyError('预览临时资源路径冲突，请重试',409);
     files.push({path:tailwindPath,mime:'text/javascript',bytes:script.length,sha256:TAILWIND_PREVIEW_SHA256,data:script.toString('base64')});
    }
    discardExpired();
    for (const [key, preview] of previews) if (preview.viewId === view.id) previews.delete(key);
    const held = [...previews.values()].reduce((sum, preview) => sum + preview.bytes, 0);
    const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
    if (previews.size >= 16 || held + bytes > 96 * 1024 * 1024) throw new SafetyError('网页预览资源超过内存预算，请先关闭其他预览', 429);
    const token = randomBytes(24).toString('hex');
    const scheme=request.socket?.encrypted?'https':'http';
    const origin=new URL(request.headers.origin || scheme+'://'+request.headers.host).origin;
    previews.set(token, {viewId:view.id, epoch:view.epoch, origin, entry:body.entry, files:new Map(files.map(file => [file.path, file])), bytes, expires:Date.now() + previewLifetime,...(tailwindPath?{tailwindPath,tailwindRequested:false}:{})});
    result = {token, entry:body.entry, expiresInMs:previewLifetime,...(tailwindPath?{tailwindPath,tailwindSha256:TAILWIND_PREVIEW_SHA256}:{})};
   } else if (body.action === 'create' || body.action === 'save') {
    manager.fileActionIdle(view, body.epoch);
    result = body.action === 'create' ? await store.create(body) : await store.save(body);
    manager.onChange(view.root, {kind:'html-source', id:result.id, revision:result.revision});
   } else if (body.action === 'link-conversion') {
    admission(view,body.epoch,body.jobId);
    result = {conversion:await store.linkConversion(body)};
   } else throw new SafetyError('未知网页作品操作', 422);
   sendJson(response, 200, {ok:true, ...result});
  })},
  // The conversion document has its own origin, distinct from DSH. Its sanitized
  // DOM can use same-origin about:blank clones needed by html2canvas, while the
  // untrusted source preview remains opaque and cannot access either host.
  {kind:'exact', path:'/designcraft/html-converter-shell', handler:async (request, response) => {
   const fail = status => { if (!response.headersSent) response.writeHead(status, {'cache-control':'no-store'}); response.end(); };
   try {
    if (request.method !== 'GET') return fail(405);
    discardExpired();
    const query=new URL(request.url,'http://localhost').searchParams, preview=previews.get(query.get('preview'));
    const nonce=query.get('nonce'), entry=query.get('entry');
    if (!preview || !/^[a-f0-9-]{36}$/.test(nonce || '') || !preview.files.has(entry) || preview.files.get(entry).mime !== 'text/html') return fail(404);
    if (!manager.views.has(preview.viewId) || manager.views.get(preview.viewId).epoch !== preview.epoch) return fail(404);
    const scheme=request.socket?.encrypted?'https':'http', shellOrigin=new URL(scheme+'://'+request.headers.host).origin;
    if (shellOrigin === preview.origin) return fail(403);
    const prefix=preview.origin+'/designcraft/html-content/'+query.get('preview')+'/', directory=entry.includes('/')?entry.slice(0,entry.lastIndexOf('/')+1):'';
    const base=prefix+directory.split('/').map(encodeURIComponent).join('/');
    const policy="default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' data:; style-src 'unsafe-inline' "+prefix+
     "; img-src data: blob: "+prefix+"; font-src data: "+prefix+"; connect-src data: blob: "+prefix+"; frame-src about:; child-src about:; object-src 'none'; form-action 'none'; base-uri "+prefix;
    const escape=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    const boot=JSON.stringify({token:nonce,parentOrigin:preview.origin,resourcePrefix:prefix}).replace(/</g,'\\u003c');
    const moduleUrl=JSON.stringify(shellOrigin+'/designcraft/html-converter-module?preview='+query.get('preview')).replace(/</g,'\\u003c');
    const body='<!doctype html><html><head><meta charset="utf-8"><base href="'+escape(base)+'"><script type="module">import {bootConverterShell} from '+moduleUrl+';bootConverterShell('+boot+');<\/script></head><body></body></html>';
    response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':policy,'referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
    response.end(body);
   } catch { fail(404); }
  }},
  // The isolated origin has no DSH login cookie. This static module is served
  // only under the same short-lived, view-scoped preview capability.
  {kind:'exact', path:'/designcraft/html-converter-module', handler:async (request, response) => {
   const fail = status => { if (!response.headersSent) response.writeHead(status, {'cache-control':'no-store'}); response.end(); };
   try {
    if (request.method !== 'GET') return fail(405);
    discardExpired();const token=new URL(request.url,'http://localhost').searchParams.get('preview'),preview=previews.get(token);
    if (!preview || !manager.views.has(preview.viewId) || manager.views.get(preview.viewId).epoch !== preview.epoch) return fail(404);
    const bytes=await readFile(join(packageRoot,'client','html-sandbox.js'));
    response.writeHead(200,{'content-type':'text/javascript; charset=utf-8','content-length':bytes.length,'cache-control':'no-store','cross-origin-resource-policy':'same-origin','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});
    response.end(bytes);
   } catch { fail(404); }
  }},
  // Only this unguessable, short-lived capability is exposed to the sandboxed
  // opaque-origin frame. Its scope is the explicit files in one preview.
  {kind:'prefix', path:'/designcraft/html-content', handler:async (request, response) => {
   const fail = status => { if (!response.headersSent) response.writeHead(status, {'cache-control':'no-store'}); response.end(); };
   try {
    if (!['GET','HEAD'].includes(request.method)) return fail(405);
    discardExpired();
    const path = new URL(request.url, 'http://localhost').pathname;
    const match = /^\/designcraft\/html-content\/([a-f0-9]{48})\/(.+)$/.exec(path);
    if (!match) return fail(404);
    const preview = previews.get(match[1]);
    if (!preview || !manager.views.has(preview.viewId) || manager.views.get(preview.viewId).epoch !== preview.epoch) return fail(404);
    let name;
    try { name = decodeURIComponent(match[2]); } catch { return fail(400); }
    const file = preview.files.get(name);
    if (!file) return fail(404);
    if(request.method==='GET'&&name===preview.tailwindPath)preview.tailwindRequested=true;
    const bytes = Buffer.from(file.data, 'base64');
    response.writeHead(200, {
     'content-type':file.mime + (/^(?:text\/|application\/json)/.test(file.mime) ? '; charset=utf-8' : ''),
     'content-length':bytes.length,
     'cache-control':'no-store',
     'access-control-allow-origin':'*',
     'cross-origin-resource-policy':'cross-origin',
     'x-content-type-options':'nosniff',
     'referrer-policy':'no-referrer',
     'content-security-policy':"sandbox; default-src 'none'; base-uri 'none'; form-action 'none'"
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
   } catch { fail(404); }
  }},
  {kind:'exact', path:ROOT + '/html-external-file', handler:guard(async (request, response) => {
   if(request.method!=='GET')throw new SafetyError('GET required',405);
   const query=new URL(request.url,'http://localhost').searchParams,epoch=query.get('epoch'),{view}=session(request,epoch),root=manager.scope(view.sessionId,view.root);
   const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
   let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},30000);timer.unref?.();
   try{
    const saved=await readMaterializedExternalFile(library,root,query.get('id'),controller.signal);
    if(manager.active.get(view.sessionId)!==view.id||view.epoch!==epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，未返回其他项目的文件',409);
    if(!saved.bytes.length||saved.bytes.length>16*1024*1024||digest(saved.bytes)!==saved.file.sha256)throw new SafetyError('外部原文件字节或摘要无效',409);
    controller.signal.throwIfAborted();
    response.writeHead(200,{'content-type':'application/octet-stream','content-length':saved.bytes.length,'content-disposition':'attachment; filename="designcraft-resource.bin"','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'; base-uri 'none'; form-action 'none'",'referrer-policy':'no-referrer','x-content-sha256':saved.file.sha256,'x-source-id':saved.file.id});
    response.end(saved.bytes);
   }catch(error){if(timedOut)throw new SafetyError('外部原文件核对超时，原件仍保留',504);throw error;}
   finally{clearTimeout(timer);response.off('close',abort);}
  })},
  {kind:'exact', path:ROOT + '/html-archive', handler:guard(async (request, response) => {
   if (request.method !== 'GET') throw new SafetyError('GET required', 405);
   const query = new URL(request.url, 'http://localhost').searchParams;
   const {store} = session(request, query.get('epoch'));
   const id=query.get('id'),saved=await store.read(id,query.get('revision')||undefined);
   const bytes = await store.archive(id,saved.revision);
   response.writeHead(200, {'content-type':'application/zip', 'content-length':bytes.length, 'cache-control':'no-store', 'x-content-type-options':'nosniff','x-source-revision':saved.revision,'x-content-sha256':digest(bytes)});
   response.end(bytes);
  })},
  {kind:'exact', path:ROOT + '/html-converter', handler:guard(async (request, response) => {
   if (request.method !== 'GET') throw new SafetyError('GET required', 405);
   const query = new URL(request.url, 'http://localhost').searchParams;
   session(request, query.get('epoch'));
   const bytes = await converterBytes();
   response.writeHead(200, {'content-type':'text/javascript; charset=utf-8', 'content-length':bytes.length, 'cache-control':'no-store', 'x-content-type-options':'nosniff', 'x-content-sha256':digest(bytes)});
   response.end(bytes);
  })},
  {kind:'exact', path:ROOT + '/html-conversion', handler:guard(async (request, response) => {
   const query = new URL(request.url, 'http://localhost').searchParams;
   const {view, store} = session(request, query.get('epoch'));
   if (request.method === 'GET') {
    const result = await store.conversion(query.get('id'), query.get('revision'), query.get('sha256'));
    response.writeHead(200, {'content-type':'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'content-length':result.bytes.length, 'x-content-sha256':result.metadata.sha256, 'cache-control':'no-store', 'x-content-type-options':'nosniff'});
    response.end(result.bytes);return;
   }
   if (request.method !== 'POST') throw new SafetyError('GET or POST required', 405);
   admission(view,query.get('epoch'),query.get('jobId'));
   let compatibility;const previewToken=request.headers['x-designcraft-preview'];
   if(previewToken!==undefined)compatibility=await tailwindEvidence(view,previewToken,query.get('id'),query.get('revision'),store);
   const bytes = await readStream(request, 64 * 1024 * 1024);
   admission(view,query.get('epoch'),query.get('jobId'));
   const conversion = await store.stageConversion({id:query.get('id'), revision:query.get('revision'), bytes, compatibility});
   if (view.epoch !== query.get('epoch')) throw new SafetyError('工作区已切换，转换结果已保留在原网页中', 409);
   sendJson(response, 200, {ok:true, conversion});
  })}
 ];
}
