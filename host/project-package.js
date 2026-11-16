import {localWorkflowExport} from './local-design-workflows.js';
import {imagePlanTraces} from './image-plan-binding.js';
import {createHash} from 'node:crypto';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProjectGraph} from './project-graph.js';
import {HtmlArtifacts} from './html-artifacts.js';
import {LegacyMigration} from './legacy-migration.js';
import {assertPhotoCandidateOnly} from './photo-candidate-proof.js';
import * as legacyStore from './docstore.js';
import {nativeVectorHeader} from './native-vector-header.js';
import {nativeDeckDocument} from './native-deck-header.js';
import {SafetyError,workspacePath,assertSafeJson} from './safety.js';
import {createZip,readZip} from './zip.js';
import {OpenDesignLibrary} from './open-design-library.js';
import {verifyResourceHtml,loadResourceHtmlIndex} from './opendesign-html-import.js';
import {verifyOpenDesignPackage} from './open-design-package.js';
import {CreativeDirectorResource,openCreativeDirector} from './creative-director-resource.js';
import {DesignPlans} from './design-plans.js';
import {validatePlanSourceLink,validatePlanSourceUnlink,verifyPlanSourceLink} from './design-plan-links.js';
import {validateBriefJob,verifyBriefArtifacts} from './opendesign-brief-job.js';
import {validateHtmlAssetReservation,verifyHtmlAssetReservation} from './html-project-asset.js';
import {verifyTailwindFreezeTransition} from './html-tailwind-freeze.js';
import {verifyHtmlFontTransition} from './html-project-font.js';
import {VENICE_IMAGE_MODES,validateVeniceTransformRecord} from './venice-image-transform.js';
import {verifyExternalSkillBundle,validateExternalLfsFile} from './external-skill-bundles.js';
import {readExternalTheme} from './external-theme.js';
import {validateThemeBrandSource} from './brand-bindings.js';
import {validateExternalOpen,validateExternalNativeResult} from './open-design-tools.js';
import {selectExternalHtmlFiles,externalHtmlOmissionPreview} from './external-html-import.js';
import {validateProjectFontRecord,validateUserFontFile,validateUserFontBytes} from './project-fonts.js';
import {validateFalWorkflowRecord} from './fal-workflow-service.js';
import {falStorageSecretAsset} from './fal-storage-upload.js';
import {falRemoteSecretAsset} from './fal-remote-artifacts.js';
import {validateVeniceAudioRecord} from './venice-audio.js';
import {validateVeniceVideoRecord} from './venice-video.js';
import {validateFigmaExport,validateFigmaOpen,validateFigmaLink,validateFigmaAsset} from './figma-source.js';
import {validateReplicateRecord} from './replicate-workflow.js';
import {validateOpenAiSvgJob,validateOpenAiSvgResult,validateOpenAiSvgOpen,validateOpenAiSvgLink,validateOpenAiSvgAsset} from './openai-svg.js';
import {validateStitchJob,validateStitchResultBytes,validateStitchResultReceipt} from './stitch-service.js';
import {validateFigmaMcpJob,validateFigmaMcpResultBytes,validateFigmaMcpResultReceipt} from './figma-mcp-service.js';
import {validateFigmaMcpImage,verifyFigmaMcpImage,validateFigmaMcpOpen,validateFigmaMcpLink} from './figma-mcp-image.js';
import {validateFigmaUpload,verifyFigmaUploadInput} from './figma-mcp-upload.js';
import {validateFigmaMcpFile,verifyFigmaMcpFile} from './figma-mcp-download.js';
import {validateFigmaPromptRecord,verifyFigmaPromptRecord} from './figma-mcp-prompt.js';
import {validateFigmaFileOpen,validateFigmaFileLink} from './figma-mcp-file-native.js';
import {validateFigmaHtmlTransfer,verifyFigmaHtmlTransfer} from './figma-html-transfer.js';
import {validateFalRealtimeSession,validateFalRealtimeJob,verifyFalRealtimeAssets} from './fal-realtime.js';
import {validateFalRtImage,validateFalRtOpen,validateFalRtLink,verifyFalRtImage} from './fal-realtime-native.js';
import {validateEcommercePlan,validateEcommerceGallery,ecommerceRequestSignature} from './ecommerce-workflow.js';
import {validateWorkflowImage,verifyWorkflowImage,validateWorkflowImageOpen,validateWorkflowImageLink} from './workflow-image-import.js';
import {validateStitchAsset,verifyStitchAsset} from './stitch-source.js';
import {validateStitchImageOpen,validateStitchImageLink} from './stitch-image-import.js';
import {validatePixelbinJob,validatePixelbinAcceptance,validatePixelbinResultBytes,validatePixelbinAssetResponse} from './pixelbin-service.js';
import {validatePixelbinAsset,verifyPixelbinAsset,validatePixelbinOpen,validatePixelbinLink} from './pixelbin-source.js';
import {validatePixelbinOperation,validatePixelbinOperationReceipt} from './pixelbin-operations.js';
import {readStockSearch,readStockImage,stockCredits} from './stock-images.js';
import {validateStockOpen,validateStockLink,verifyStockNative} from './stock-native.js';

const product=dirname(dirname(fileURLToPath(import.meta.url)));
const limit=256*1024*1024;
const hex=/^[a-f0-9]{64}$/;
const engineExtensions={vectorcraft:'vectorcraft',deckcraft:'deckcraft',photocraft:'pcraft'};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const rootPrefix='design/.designcraft/v2';
const maximumEntries=15000;
function fail(message,status=409){throw new SafetyError(message,status);}
async function directories(path){
 try{return await readdir(path,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
}
function addFont(value,set){
 if(typeof value==='string'&&value.length<=200&&value.trim())set.add(value.trim());
}
function nativeDependencies(bytes,engine,fonts){
 let doc;
 if(engine==='vectorcraft'){
  const file=nativeVectorHeader(bytes);
  if(Object.values(file.images||{}).some(image=>image.proxy))fail('矢量源含依赖外部原件的代理图，请先嵌入原件');
  doc=file.document;
 }else if(engine==='deckcraft'){
  doc=nativeDeckDocument(bytes);
  if(Object.values(doc.media||{}).some(m=>m.link!=null))fail('演示中有外部媒体，请先嵌入后再打包');
 }else if(engine==='photocraft'){
  const file=readZip(bytes,{includeNames:['manifest.json'],maxEntries:20000,maxEntryBytes:limit,maxTotalBytes:limit,maxSelectedBytes:16*1024*1024}).find(row=>row.name==='manifest.json');
  if(!file)fail('无法核对图片原生依赖');
  doc=JSON.parse(file.data).document;
 }else fail('项目包含未支持的原生源');
 let count=0;
 function visit(node,depth){
  if(node===null||typeof node!=='object')return;
  if(++count>400000||depth>96)fail('源结构超过项目包核对预算',413);
  if(Array.isArray(node)){for(const child of node)visit(child,depth+1);return;}
  if(engine==='vectorcraft'&&['image','placeddocument'].includes(node.kind?.type)&&node.kind.link?.path)fail('海报中有外部链接，请先嵌入原件');
  for(const [key,value] of Object.entries(node)){
   if(['fontFamily','font_family','typeface','latin','family'].includes(key))addFont(value,fonts);
   visit(value,depth+1);
  }
 }
 visit(doc,0);
}
/** Follow published immutable pointers only. Never walk a session or operations
 * log into the archive. A fresh workspace can open the extracted design tree. */
export async function projectPackage(root){
 const graph=new ProjectGraph(root),store=graph.sources;
 const design=await directories(workspacePath(root,'design'));
 const legacyNames=design.filter(entry=>entry.name.endsWith('.dc.json'));
 const legacyDocs=legacyStore.listDocs(root);
 if(legacyNames.length!==legacyDocs.length)fail('有旧作品无法读取；请先保留原文件并修复后再打包');
 const snapshot=await graph.read(),sources=await store.list(),htmlStore=new HtmlArtifacts(root),htmlSources=await htmlStore.list();
 const planStore=new DesignPlans(root),designPlans=planStore.list();
 const stockDir=workspacePath(root,'design/.designcraft/stock-images'),stockEntries=await directories(stockDir),stockPattern=/^stock(?:search|image|open|link)-[a-f0-9]{64}\.json$/;
 if(stockEntries.length>2500||stockEntries.some(item=>!stockPattern.test(item.name)||!item.isFile()))fail('在线图库目录含未知或未完成记录，请先核对，未生成不完整项目包');
 const planLinkDir=workspacePath(root,'design/.designcraft/plan-source-links'),planLinkAll=await directories(planLinkDir),planLinkPattern=/^plan(?:link|unlink)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(planLinkAll.some(item=>/^plan(?:link|unlink)-/.test(item.name)&&!planLinkPattern.test(item.name)))fail('设计计划关联目录包含未知记录');const planLinkEntries=planLinkAll.filter(item=>planLinkPattern.test(item.name));if(planLinkEntries.length>4000||planLinkEntries.some(item=>!item.isFile())||planLinkEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('设计计划关联记录无效或超过预算',413);
 const briefDir=workspacePath(root,'design/.designcraft/opendesign-brief'),briefAll=await directories(briefDir),briefPattern=/^odbriefjob-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(briefAll.some(item=>item.name.startsWith('odbriefjob-')&&!briefPattern.test(item.name)))fail('设计简报目录包含未知记录');const briefEntries=briefAll.filter(item=>briefPattern.test(item.name));if(briefEntries.length>3000||briefEntries.some(item=>!item.isFile())||briefEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('设计简报记录无效或超过预算',413);
 const htmlAssetDir=workspacePath(root,'design/.designcraft/html-asset-ops'),htmlAssetAll=await directories(htmlAssetDir),htmlAssetPattern=/^htmlassetop-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(htmlAssetAll.some(item=>item.name.startsWith('htmlassetop-')&&!htmlAssetPattern.test(item.name)))fail('网页项目素材目录包含未知记录');const htmlAssetEntries=htmlAssetAll.filter(item=>htmlAssetPattern.test(item.name));if(htmlAssetEntries.length>3000||htmlAssetEntries.some(item=>!item.isFile())||htmlAssetEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('网页项目素材记录无效或超过预算',413);
 const falDir=workspacePath(root,'design/.designcraft/fal-workflows'),falAll=await directories(falDir);
 const falCurrent=/^faljob-[a-f0-9]{64}\.json$/,falTemporary=/^faljob-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/,falPreserved=/^faljob-[a-f0-9]{64}\.preserved-[a-f0-9]{64}\.json$/;
 if(falAll.some(item=>item.name.startsWith('faljob-')&&!falCurrent.test(item.name)&&!falTemporary.test(item.name)&&!falPreserved.test(item.name)))fail('fal 工作流目录包含无法识别的记录，未生成不完整项目包');
 const falEntries=falAll.filter(item=>falCurrent.test(item.name)||falTemporary.test(item.name)||falPreserved.test(item.name));
 if(falEntries.length>3000||falEntries.some(item=>!item.isFile())||falEntries.filter(item=>falTemporary.test(item.name)).length>128)fail('fal 工作流记录无效或超过预算',413);
 const falStorageAssetPattern=/^falstore-(?:input-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.[a-z0-9]{1,8}|secret-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.bin)$/,falStorageAssetNames=legacyStore.listAssets(root).filter(item=>falStorageAssetPattern.test(item.name)).map(item=>item.name).sort();if(falStorageAssetNames.length>2000)fail('fal 存储保留素材超过预算',413);
 const falRemoteSecretPattern=/^falremote-secret-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.bin$/,falRemoteSecretNames=legacyStore.listAssets(root).filter(item=>falRemoteSecretPattern.test(item.name)).map(item=>item.name).sort();if(falRemoteSecretNames.length>2000)fail('fal 远端输出加密引用超过预算',413);
 const falRealtimeDir=workspacePath(root,'design/.designcraft/fal-realtime'),falRealtimeAll=await directories(falRealtimeDir),falRealtimeRecord=/^(?:falrtsession|falrtjob)-[a-f0-9]{64}(?:\.json(?:\.tmp-[a-f0-9-]{36})?|\.preserved-[a-f0-9]{64}\.json)$/;
 if(falRealtimeAll.some(item=>/^(?:falrtsession|falrtjob)-/.test(item.name)&&!falRealtimeRecord.test(item.name)))fail('fal 实时目录含未知记录');const falRealtimeEntries=falRealtimeAll.filter(item=>falRealtimeRecord.test(item.name));if(falRealtimeEntries.length>3000||falRealtimeEntries.some(item=>!item.isFile())||falRealtimeEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('fal 实时记录无效或超过预算',413);
 const falRealtimeAssetPattern=/^falrt-(?:input|image)-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:png|jpg)$/,falRealtimeAssetNames=legacyStore.listAssets(root).filter(item=>falRealtimeAssetPattern.test(item.name)).map(item=>item.name).sort();if(falRealtimeAssetNames.length>2000)fail('fal 实时素材超过预算',413);
 const falRtNativeDir=workspacePath(root,'design/.designcraft/fal-realtime-native'),falRtNativeAll=await directories(falRtNativeDir),falRtNativeRecord=/^(?:falrtimage|falrtopen|falrtlink)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(falRtNativeAll.some(item=>/^falrt(?:image|open|link)-/.test(item.name)&&!falRtNativeRecord.test(item.name)))fail('fal 实时原生目录含未知记录');const falRtNativeEntries=falRtNativeAll.filter(item=>falRtNativeRecord.test(item.name));if(falRtNativeEntries.length>3000||falRtNativeEntries.some(item=>!item.isFile())||falRtNativeEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('fal 实时原生记录无效或超过预算',413);
 const veniceDir=workspacePath(root,'design/.designcraft/venice-audio'),veniceAll=await directories(veniceDir);
 const veniceCurrent=/^veniceaudio-[a-f0-9]{64}\.json$/,veniceTemporary=/^veniceaudio-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/,veniceReceipt=/^veniceaudio-[a-f0-9]{64}\.accepted-[a-f0-9-]{36}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(veniceAll.some(item=>item.name.startsWith('veniceaudio-')&&!veniceCurrent.test(item.name)&&!veniceTemporary.test(item.name)&&!veniceReceipt.test(item.name)))fail('Venice 音频目录包含无法识别的记录');
 const veniceEntries=veniceAll.filter(item=>veniceCurrent.test(item.name)||veniceTemporary.test(item.name)||veniceReceipt.test(item.name));
 if(veniceEntries.length>3000||veniceEntries.some(item=>!item.isFile())||veniceEntries.filter(item=>veniceTemporary.test(item.name)||item.name.includes('.tmp-')).length>128)fail('Venice 音频记录无效或超过预算',413);
 const videoDir=workspacePath(root,'design/.designcraft/venice-video'),videoAll=await directories(videoDir);
 const videoCurrent=/^venicevideo-[a-f0-9]{64}\.json$/,videoTemporary=/^venicevideo-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/,videoReceipt=/^venicevideo-[a-f0-9]{64}\.accepted-[a-f0-9-]{36}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(videoAll.some(item=>item.name.startsWith('venicevideo-')&&!videoCurrent.test(item.name)&&!videoTemporary.test(item.name)&&!videoReceipt.test(item.name)))fail('Venice 视频目录包含无法识别的记录');
 const videoEntries=videoAll.filter(item=>videoCurrent.test(item.name)||videoTemporary.test(item.name)||videoReceipt.test(item.name));
 if(videoEntries.length>3000||videoEntries.some(item=>!item.isFile())||videoEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('Venice 视频记录无效或超过预算',413);
 const externalNativeDir=workspacePath(root,'design/.designcraft/external-native'),externalNativeAll=await directories(externalNativeDir),externalNativeRecord=/^(?:externalopen|externalopenresult)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(externalNativeAll.some(item=>/^externalopen(?:result)?-/.test(item.name)&&!externalNativeRecord.test(item.name)))fail('外部原生导入目录包含无法识别的记录');const externalNativeEntries=externalNativeAll.filter(item=>externalNativeRecord.test(item.name));if(externalNativeEntries.length>3000||externalNativeEntries.some(item=>!item.isFile())||externalNativeEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('外部原生导入记录无效或超过预算',413);
 const workflowImageDir=workspacePath(root,'design/.designcraft/workflow-images'),workflowImageAll=await directories(workflowImageDir),workflowImageRecord=/^(?:workflowimage|workflowimageopen|workflowimagelink)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(workflowImageAll.some(item=>/^workflowimage(?:open|link)?-/.test(item.name)&&!workflowImageRecord.test(item.name)))fail('工作流图片目录包含无法识别的记录');const workflowImageEntries=workflowImageAll.filter(item=>workflowImageRecord.test(item.name));if(workflowImageEntries.length>3000||workflowImageEntries.some(item=>!item.isFile())||workflowImageEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('工作流图片记录无效或超过预算',413);
 const ecommerceDir=workspacePath(root,'design/.designcraft/ecommerce'),ecommerceAll=await directories(ecommerceDir),ecommerceRecord=/^(?:ecomplan|ecomgallery)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(ecommerceAll.some(item=>/^ecom(?:plan|gallery)-/.test(item.name)&&!ecommerceRecord.test(item.name)))fail('电商图目录包含无法识别的记录');const ecommerceEntries=ecommerceAll.filter(item=>ecommerceRecord.test(item.name));if(ecommerceEntries.length>3000||ecommerceEntries.some(item=>!item.isFile())||ecommerceEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('电商图记录无效或超过预算',413);
 const ecommerceRefPattern=/^ecom-reference-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:png|jpg)$/,ecommerceRefNames=legacyStore.listAssets(root).filter(item=>ecommerceRefPattern.test(item.name)).map(item=>item.name).sort();if(ecommerceRefNames.length>2000)fail('电商图保留原件超过预算',413);
 const figmaDir=workspacePath(root,'design/.designcraft/figma-sources'),figmaAll=await directories(figmaDir);
 const figmaRecord=/^(figmaexport|figmaopen|figmalink)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(figmaAll.some(item=>/^figma(?:export|open|link)-/.test(item.name)&&!figmaRecord.test(item.name)))fail('Figma 来源目录包含无法识别的记录');
 const figmaEntries=figmaAll.filter(item=>figmaRecord.test(item.name));if(figmaEntries.length>3000||figmaEntries.some(item=>!item.isFile())||figmaEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('Figma 来源记录无效或超过预算',413);
 const figmaAssetPattern=/^figma-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:svg|png)$/;
 const figmaAssetNames=legacyStore.listAssets(root).filter(item=>figmaAssetPattern.test(item.name)).map(item=>item.name).sort();if(figmaAssetNames.length>2000)fail('Figma 原件素材超过预算',413);
 const replicateDir=workspacePath(root,'design/.designcraft/replicate-workflows'),replicateAll=await directories(replicateDir);
 const replicateCurrent=/^replicatejob-[a-f0-9]{64}\.json$/,replicateTemporary=/^replicatejob-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/,replicateReceipt=/^replicatejob-[a-f0-9]{64}\.accepted-[a-z0-9-]{8,100}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(replicateAll.some(item=>item.name.startsWith('replicatejob-')&&!replicateCurrent.test(item.name)&&!replicateTemporary.test(item.name)&&!replicateReceipt.test(item.name)))fail('Replicate 目录包含无法识别的记录');
 const replicateEntries=replicateAll.filter(item=>replicateCurrent.test(item.name)||replicateTemporary.test(item.name)||replicateReceipt.test(item.name));if(replicateEntries.length>3000||replicateEntries.some(item=>!item.isFile())||replicateEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('Replicate 任务记录无效或超过预算',413);
 const svgDir=workspacePath(root,'design/.designcraft/openai-svg'),svgAll=await directories(svgDir),svgRecord=/^(openaisvgjob|openaisvgresult|openaisvgopen|openaisvglink)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(svgAll.some(item=>/^openaisvg(?:job|result|open|link)-/.test(item.name)&&!svgRecord.test(item.name)))fail('OpenAI SVG 目录包含无法识别的记录');
 const svgEntries=svgAll.filter(item=>svgRecord.test(item.name));if(svgEntries.length>3000||svgEntries.some(item=>!item.isFile())||svgEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('OpenAI SVG 记录无效或超过预算',413);
 const svgAssetPattern=/^openaisvg-([a-f0-9]{12})-([a-f0-9]{24})(?:-[a-f0-9]{24})?\.svg$/,svgAssetNames=legacyStore.listAssets(root).filter(item=>svgAssetPattern.test(item.name)).map(item=>item.name).sort();if(svgAssetNames.length>2000)fail('OpenAI SVG 原件超过预算',413);
 const figmamcpJobDir=workspacePath(root,'design/.designcraft/figmamcp-jobs'),figmamcpJobAll=await directories(figmamcpJobDir),figmamcpJobName=/^figmamcpjob-[a-f0-9]{64}\.json$/,figmamcpJobTemp=/^figmamcpjob-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/;
 if(figmamcpJobAll.some(item=>item.name.startsWith('figmamcpjob-')&&!figmamcpJobName.test(item.name)&&!figmamcpJobTemp.test(item.name)))fail('FigmaMcp 任务目录包含无法识别的记录');
 const figmamcpJobs=figmamcpJobAll.filter(item=>figmamcpJobName.test(item.name)||figmamcpJobTemp.test(item.name));if(figmamcpJobs.length>3000||figmamcpJobs.some(item=>!item.isFile())||figmamcpJobs.filter(item=>figmamcpJobTemp.test(item.name)).length>128)fail('FigmaMcp 任务记录无效或超过预算',413);
 const figmamcpResultDir=workspacePath(root,'design/.designcraft/figmamcp-results'),figmamcpResultAll=await directories(figmamcpResultDir),figmamcpResultName=/^figmamcpresult-[a-f0-9]{64}\.json$/,figmamcpResultTemp=/^figmamcpresult-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/;
 if(figmamcpResultAll.some(item=>item.name.startsWith('figmamcpresult-')&&!figmamcpResultName.test(item.name)&&!figmamcpResultTemp.test(item.name)))fail('FigmaMcp 结果回执目录包含无法识别的记录');
 const figmamcpResults=figmamcpResultAll.filter(item=>figmamcpResultName.test(item.name)||figmamcpResultTemp.test(item.name));if(figmamcpResults.length>3000||figmamcpResults.some(item=>!item.isFile())||figmamcpResults.filter(item=>figmamcpResultTemp.test(item.name)).length>128)fail('FigmaMcp 结果回执无效或超过预算',413);
 const figmamcpDataPattern=/^figmamcp-result-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.json$/,figmamcpDataNames=legacyStore.listAssets(root).filter(item=>figmamcpDataPattern.test(item.name)).map(item=>item.name).sort();if(figmamcpDataNames.length>2000)fail('Figma MCP 已保存文件超过预算',413);
 const figmaPromptDir=workspacePath(root,'design/.designcraft/figmamcp-prompts'),figmaPromptAll=await directories(figmaPromptDir),figmaPromptRecord=/^figmamcpprompt-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(figmaPromptAll.some(item=>item.name.startsWith('figmamcpprompt-')&&!figmaPromptRecord.test(item.name)))fail('Figma 提示参考目录包含未知记录');const figmaPromptEntries=figmaPromptAll.filter(item=>figmaPromptRecord.test(item.name));if(figmaPromptEntries.length>3000||figmaPromptEntries.some(item=>!item.isFile())||figmaPromptEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('Figma 提示参考记录无效或超过预算',413);
 const figmaPromptTextPattern=/^figmamcp-prompt-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.txt$/,figmaPromptTextNames=legacyStore.listAssets(root).filter(item=>figmaPromptTextPattern.test(item.name)).map(item=>item.name).sort();if(figmaPromptTextNames.length>2000)fail('Figma 提示参考文本超过预算',413);
 const figmamcpAssetDir=workspacePath(root,'design/.designcraft/figmamcp-assets'),figmamcpAssetAll=await directories(figmamcpAssetDir),figmamcpAssetRecord=/^(?:figmamcpasset|figmamcpopen|figmamcplink)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(figmamcpAssetAll.some(item=>/^figmamcp(?:asset|open|link)-/.test(item.name)&&!figmamcpAssetRecord.test(item.name)))fail('Figma MCP 图片目录包含无法识别的记录');const figmamcpAssets=figmamcpAssetAll.filter(item=>figmamcpAssetRecord.test(item.name));if(figmamcpAssets.length>3000||figmamcpAssets.some(item=>!item.isFile())||figmamcpAssets.filter(item=>item.name.includes('.tmp-')).length>128)fail('Figma MCP 图片记录无效或超过预算',413);
 const figmamcpImagePattern=/^figmamcp-image-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:png|jpg)$/,figmamcpImageNames=legacyStore.listAssets(root).filter(item=>figmamcpImagePattern.test(item.name)).map(item=>item.name).sort();if(figmamcpImageNames.length>2000)fail('Figma MCP 图片原件超过预算',413);
 const figmamcpFileDir=workspacePath(root,'design/.designcraft/figmamcp-files'),figmamcpFileAll=await directories(figmamcpFileDir),figmamcpFileRecord=/^figmamcpfile-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(figmamcpFileAll.some(item=>item.name.startsWith('figmamcpfile-')&&!figmamcpFileRecord.test(item.name)))fail('Figma MCP 素材目录包含无法识别的记录');const figmamcpFiles=figmamcpFileAll.filter(item=>figmamcpFileRecord.test(item.name));if(figmamcpFiles.length>3000||figmamcpFiles.some(item=>!item.isFile())||figmamcpFiles.filter(item=>item.name.includes('.tmp-')).length>128)fail('Figma MCP 素材记录无效或超过预算',413);
 const figmamcpFilePattern=/^figmamcp-file-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:png|jpg|gif|webp|svg|pdf)$/,figmamcpFileNames=legacyStore.listAssets(root).filter(item=>figmamcpFilePattern.test(item.name)).map(item=>item.name).sort();if(figmamcpFileNames.length>2000)fail('Figma MCP 已保存素材超过预算',413);
 const figmaFileNativeDir=workspacePath(root,'design/.designcraft/figmamcp-file-native'),figmaFileNativeAll=await directories(figmaFileNativeDir),figmaFileNativeRecord=/^(?:figmafileopen|figmafilelink)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(figmaFileNativeAll.some(item=>/^figmafile(?:open|link)-/.test(item.name)&&!figmaFileNativeRecord.test(item.name)))fail('Figma 素材原生目录含未知记录');const figmaFileNativeEntries=figmaFileNativeAll.filter(item=>figmaFileNativeRecord.test(item.name));if(figmaFileNativeEntries.length>3000||figmaFileNativeEntries.some(item=>!item.isFile())||figmaFileNativeEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('Figma 素材原生记录无效或超过预算',413);
 const figmaHtmlDir=workspacePath(root,'design/.designcraft/figma-html-transfers'),figmaHtmlAll=await directories(figmaHtmlDir),figmaHtmlRecord=/^figmahtmltransfer-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(figmaHtmlAll.some(item=>item.name.startsWith('figmahtmltransfer-')&&!figmaHtmlRecord.test(item.name)))fail('Figma 网页转移目录含未知记录');const figmaHtmlEntries=figmaHtmlAll.filter(item=>figmaHtmlRecord.test(item.name));if(figmaHtmlEntries.length>3000||figmaHtmlEntries.some(item=>!item.isFile())||figmaHtmlEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('Figma 网页转移记录无效或超过预算',413);
 const figmaUploadDir=workspacePath(root,'design/.designcraft/figma-uploads'),figmaUploadAll=await directories(figmaUploadDir),figmaUploadRecord=/^figmaupload-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(figmaUploadAll.some(item=>item.name.startsWith('figmaupload-')&&!figmaUploadRecord.test(item.name)))fail('Figma 上传目录包含无法识别的记录');const figmaUploadEntries=figmaUploadAll.filter(item=>figmaUploadRecord.test(item.name));if(figmaUploadEntries.length>3000||figmaUploadEntries.some(item=>!item.isFile())||figmaUploadEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('Figma 上传记录无效或超过预算',413);
 const figmaUploadInputPattern=/^figmaupload-input-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:png|jpg|gif|webp|svg)$/,figmaUploadInputNames=legacyStore.listAssets(root).filter(item=>figmaUploadInputPattern.test(item.name)).map(item=>item.name).sort();if(figmaUploadInputNames.length>2000)fail('Figma 上传原件超过预算',413);
 const stitchJobDir=workspacePath(root,'design/.designcraft/stitch-jobs'),stitchJobAll=await directories(stitchJobDir),stitchJobName=/^stitchjob-[a-f0-9]{64}\.json$/,stitchJobTemp=/^stitchjob-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/;
 if(stitchJobAll.some(item=>item.name.startsWith('stitchjob-')&&!stitchJobName.test(item.name)&&!stitchJobTemp.test(item.name)))fail('Stitch 任务目录包含无法识别的记录');
 const stitchJobs=stitchJobAll.filter(item=>stitchJobName.test(item.name)||stitchJobTemp.test(item.name));if(stitchJobs.length>3000||stitchJobs.some(item=>!item.isFile())||stitchJobs.filter(item=>stitchJobTemp.test(item.name)).length>128)fail('Stitch 任务记录无效或超过预算',413);
 const stitchResultDir=workspacePath(root,'design/.designcraft/stitch-results'),stitchResultAll=await directories(stitchResultDir),stitchResultName=/^stitchresult-[a-f0-9]{64}\.json$/,stitchResultTemp=/^stitchresult-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/;
 if(stitchResultAll.some(item=>item.name.startsWith('stitchresult-')&&!stitchResultName.test(item.name)&&!stitchResultTemp.test(item.name)))fail('Stitch 结果回执目录包含无法识别的记录');
 const stitchResults=stitchResultAll.filter(item=>stitchResultName.test(item.name)||stitchResultTemp.test(item.name));if(stitchResults.length>3000||stitchResults.some(item=>!item.isFile())||stitchResults.filter(item=>stitchResultTemp.test(item.name)).length>128)fail('Stitch 结果回执无效或超过预算',413);
 const stitchAssetDir=workspacePath(root,'design/.designcraft/stitch-assets'),stitchAssetAll=await directories(stitchAssetDir),stitchAssetName=/^stitchasset-[a-f0-9]{64}\.json$/,stitchAssetTemp=/^stitchasset-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/;
 if(stitchAssetAll.some(item=>item.name.startsWith('stitchasset-')&&!stitchAssetName.test(item.name)&&!stitchAssetTemp.test(item.name)))fail('Stitch 原件目录包含无法识别的记录');
 const stitchAssets=stitchAssetAll.filter(item=>stitchAssetName.test(item.name)||stitchAssetTemp.test(item.name));if(stitchAssets.length>3000||stitchAssets.some(item=>!item.isFile())||stitchAssets.filter(item=>stitchAssetTemp.test(item.name)).length>128)fail('Stitch 原件记录无效或超过预算',413);
 const stitchImageDir=workspacePath(root,'design/.designcraft/stitch-image-imports'),stitchImageAll=await directories(stitchImageDir),stitchImageRecord=/^(?:stitchimageopen|stitchimagelink)-[a-f0-9]{64}\.json(?:\.tmp-[a-f0-9-]{36})?$/;
 if(stitchImageAll.some(item=>/^stitchimage(?:open|link)-/.test(item.name)&&!stitchImageRecord.test(item.name)))fail('Stitch 图片导入目录包含无法识别的记录');const stitchImageEntries=stitchImageAll.filter(item=>stitchImageRecord.test(item.name));if(stitchImageEntries.length>3000||stitchImageEntries.some(item=>!item.isFile())||stitchImageEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('Stitch 图片导入记录无效或超过预算',413);
 const stitchDataPattern=/^stitch-(?:source|result)-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:json|html|png|jpg|webp)$/;
 const stitchDataNames=legacyStore.listAssets(root).filter(item=>stitchDataPattern.test(item.name)).map(item=>item.name).sort();if(stitchDataNames.length>2000)fail('Stitch 已保存文件超过预算',413);
 const pixelDir=workspacePath(root,'design/.designcraft/pixelbin-jobs'),pixelAll=await directories(pixelDir),pixelJobName=/^pixeljob-[a-f0-9]{64}\.json$/,pixelJobTemp=/^pixeljob-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/,pixelAcceptName=/^pixelaccept-[a-f0-9]{64}\.json$/,pixelAcceptTemp=/^pixelaccept-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/;
 if(pixelAll.some(item=>/^(?:pixeljob|pixelaccept)-/.test(item.name)&&![pixelJobName,pixelJobTemp,pixelAcceptName,pixelAcceptTemp].some(pattern=>pattern.test(item.name))))fail('PixelBin 任务目录包含无法识别的记录');
 const pixelEntries=pixelAll.filter(item=>[pixelJobName,pixelJobTemp,pixelAcceptName,pixelAcceptTemp].some(pattern=>pattern.test(item.name)));if(pixelEntries.length>3000||pixelEntries.some(item=>!item.isFile())||pixelEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('PixelBin 任务记录无效或超过预算',413);
 const pixelOpDir=workspacePath(root,'design/.designcraft/pixelbin-operations'),pixelOpAll=await directories(pixelOpDir),pixelOpName=/^pixelop-[a-f0-9]{64}\.json$/,pixelOpTemp=/^pixelop-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/,pixelOpReceiptName=/^pixelopreceipt-[a-f0-9]{64}\.json$/,pixelOpReceiptTemp=/^pixelopreceipt-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/;
 if(pixelOpAll.some(item=>/^(?:pixelop|pixelopreceipt)-/.test(item.name)&&![pixelOpName,pixelOpTemp,pixelOpReceiptName,pixelOpReceiptTemp].some(pattern=>pattern.test(item.name))))fail('PixelBin 操作目录包含无法识别的记录');
 const pixelOpEntries=pixelOpAll.filter(item=>[pixelOpName,pixelOpTemp,pixelOpReceiptName,pixelOpReceiptTemp].some(pattern=>pattern.test(item.name)));if(pixelOpEntries.length>3000||pixelOpEntries.some(item=>!item.isFile())||pixelOpEntries.filter(item=>item.name.includes('.tmp-')).length>128)fail('PixelBin 操作记录无效或超过预算',413);
 const pixelAssetDir=workspacePath(root,'design/.designcraft/pixelbin-assets'),pixelAssetAll=await directories(pixelAssetDir),pixelAssetName=/^pixelasset-[a-f0-9]{64}\.json$/,pixelAssetTemp=/^pixelasset-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/,pixelOpenName=/^pixelopen-[a-f0-9]{64}\.json$/,pixelLinkName=/^pixellink-[a-f0-9]{64}\.json$/,pixelNativeTemp=/^(?:pixelopen|pixellink)-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/;
 if(pixelAssetAll.some(item=>/^(?:pixelasset|pixelopen|pixellink)-/.test(item.name)&&![pixelAssetName,pixelAssetTemp,pixelOpenName,pixelLinkName,pixelNativeTemp].some(pattern=>pattern.test(item.name))))fail('PixelBin 图片目录包含无法识别的记录');
 const pixelAssets=pixelAssetAll.filter(item=>[pixelAssetName,pixelAssetTemp,pixelOpenName,pixelLinkName,pixelNativeTemp].some(pattern=>pattern.test(item.name)));if(pixelAssets.length>3000||pixelAssets.some(item=>!item.isFile())||pixelAssets.filter(item=>item.name.includes('.tmp-')).length>128)fail('PixelBin 图片记录无效或超过预算',413);
 const pixelDataPattern=/^pixelbin-(?:image|result)-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:json|png|jpg|webp)$/;
 const pixelDataNames=legacyStore.listAssets(root).filter(item=>pixelDataPattern.test(item.name)).map(item=>item.name).sort();if(pixelDataNames.length>2000)fail('PixelBin 已保存文件超过预算',413);
 const resourceDir=workspacePath(root,rootPrefix+'/resource-imports');
 const fontTemporary=/^projectfont-[a-f0-9]{64}\.json\.tmp-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const userFontTemporary=/^userfont-[a-f0-9]{64}\.json\.tmp-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const userFontAsset=/^userfont-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.(?:ttf|otf)$/i;
 const allResourceEntries=await directories(resourceDir);
 if(allResourceEntries.some(item=>item.name.startsWith('projectfont-')&&!/^projectfont-[a-f0-9]{64}\.json$/.test(item.name)&&!fontTemporary.test(item.name)))fail('项目字体目录包含无法识别的记录，未生成不完整项目包');
 if(allResourceEntries.some(item=>item.name.startsWith('userfont-')&&!/^userfont-[a-f0-9]{64}\.json$/.test(item.name)&&!userFontTemporary.test(item.name)))fail('用户字体目录包含无法识别的记录，未生成不完整项目包');
 const resourceEntries=allResourceEntries.filter(item=>/^(?:resource|link|package|external|externalbundle|externalfile|externallfs|userfont|projectfont)-[a-f0-9]{64}\.json$/.test(item.name)||fontTemporary.test(item.name)||userFontTemporary.test(item.name));
 if(resourceEntries.length>10000||resourceEntries.some(item=>!item.isFile()))fail('资源来源记录无效或超过预算',413);
 if(resourceEntries.filter(item=>fontTemporary.test(item.name)||userFontTemporary.test(item.name)).length>128)fail('未发布字体记录超过项目包预算',413);
 const userFontAssets=legacyStore.listAssets(root).filter(item=>userFontAsset.test(item.name));
 if(userFontAssets.length>512)fail('用户字体原件超过项目包预算',413);
 const quarantineDir=workspacePath(root,rootPrefix+'/font-quarantine'),quarantineEntries=await directories(quarantineDir);
 const quarantineName=/^(?:projectfont|userfont)-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}\.saved-[a-f0-9-]{36}$/;
 if(quarantineEntries.length>256||quarantineEntries.some(item=>!item.isFile()||!quarantineName.test(item.name)))fail('字体候选保留区无效或超过预算',413);
 if(sources.some(s=>s.error))fail('有专业源无法读取，未生成不完整的项目包');
 if(htmlSources.some(source=>source.error))fail('有网页源无法读取，未生成不完整的项目包');
 if(designPlans.some(plan=>plan.error))fail('有设计计划无法读取，未生成不完整的项目包');
 if(!stockEntries.length&&!sources.length&&!htmlSources.length&&!legacyDocs.length&&!designPlans.length&&!planLinkEntries.length&&!briefEntries.length&&!htmlAssetEntries.length&&!falEntries.length&&!falStorageAssetNames.length&&!falRemoteSecretNames.length&&!falRealtimeEntries.length&&!falRealtimeAssetNames.length&&!falRtNativeEntries.length&&!veniceEntries.length&&!videoEntries.length&&!externalNativeEntries.length&&!workflowImageEntries.length&&!ecommerceEntries.length&&!ecommerceRefNames.length&&!figmaEntries.length&&!figmaAssetNames.length&&!replicateEntries.length&&!svgEntries.length&&!svgAssetNames.length&&!figmamcpJobs.length&&!figmamcpResults.length&&!figmamcpDataNames.length&&!figmaPromptEntries.length&&!figmaPromptTextNames.length&&!figmamcpAssets.length&&!figmamcpImageNames.length&&!figmamcpFiles.length&&!figmamcpFileNames.length&&!figmaFileNativeEntries.length&&!figmaHtmlEntries.length&&!figmaUploadEntries.length&&!figmaUploadInputNames.length&&!stitchJobs.length&&!stitchResults.length&&!stitchAssets.length&&!stitchImageEntries.length&&!stitchDataNames.length&&!pixelEntries.length&&!pixelOpEntries.length&&!pixelAssets.length&&!pixelDataNames.length&&!userFontAssets.length&&!quarantineEntries.length&&!resourceEntries.some(item=>item.name.startsWith('resource-')||item.name.startsWith('package-')||item.name.startsWith('external-')||item.name.startsWith('externalbundle-')||item.name.startsWith('userfont-')||fontTemporary.test(item.name)))fail('当前项目还没有已保存的作品或素材',404);
 const records=new Map(),entries=[],fonts=new Set(),engines=new Set(),assets=new Map();
 let total=0;
 function add(name,bytes,expected){
  if(!Buffer.isBuffer(bytes)||name.startsWith('/')||name.includes('..')||name.includes('\\')||name.includes(':'))fail('项目包文件路径或内容无效',422);
  const hash=sha(bytes);if(expected&&expected!==hash)fail('项目包内容与保存记录不符：'+name);
  const prior=records.get(name);
  if(prior){if(prior.sha256!==hash)fail('同一路径出现不同内容');return;}
  if(total+bytes.length>limit||entries.length>=maximumEntries)fail('项目包超过 256 MiB 或条目数上限',413);
  total+=bytes.length;records.set(name,{path:name,bytes:bytes.length,sha256:hash});
  entries.push({name,data:bytes,store:!(/\.(json|svg|txt|md)$/i.test(name))});
 }
 async function copyRelative(base,relative,destination,expected,maxSize=limit){
  let path=base;
  for(const step of relative.split('/')){
   if(!step||step==='.'||step==='..'||step.includes('\\'))fail('文件路径无效',422);
   path=join(path,step);
   const st=await lstat(path);if(st.isSymbolicLink())fail('项目包含链接目录或文件，请使用嵌入的真实文件');
  }
  const confined=workspacePath(base,path,{mustExist:true}),stat=await lstat(confined);
  if(!stat.isFile()||stat.size>maxSize||total+stat.size>limit)fail('项目文件超过打包预算',413);
  const data=await readFile(confined);add(destination,data,expected);return data;
 }
 async function copyProject(relative,expected,maxSize){
  return copyRelative(root,rootPrefix+'/'+relative,rootPrefix+'/'+relative,expected,maxSize);
 }
 const stockHeads=new Map(),stockAssets=new Map(),stockSearches=new Map(),stockImages=new Map(),stockOpens=new Map(),stockLinks=new Map();
 for(const item of stockEntries){
  const relative='design/.designcraft/stock-images/'+item.name,raw=await copyRelative(root,relative,relative,null,item.name.startsWith('stocksearch-')?3*1024*1024:16384);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{fail('在线图库记录损坏');}if(row.id!==item.name.slice(0,-5))fail('在线图库记录身份不一致');stockHeads.set(item.name,sha(raw));
  if(row.id.startsWith('stocksearch-')){const saved=await readStockSearch(root,row.id);if(JSON.stringify(saved.row)!==JSON.stringify(row))fail('读取期间图库搜索发生变化');add('design/assets/'+row.responseAsset,saved.bytes,row.responseSha256);stockAssets.set(row.responseAsset,row.responseSha256);stockSearches.set(row.id,row);}
  else if(row.id.startsWith('stockimage-')){const saved=await readStockImage(root,row.id);if(JSON.stringify(saved.row)!==JSON.stringify(row))fail('读取期间图库图片发生变化');add('design/assets/'+row.assetName,saved.bytes,row.sha256);stockAssets.set(row.assetName,row.sha256);stockImages.set(row.id,row);add('design/stock-credits/'+row.id+'.json',json(await stockCredits(root,row.id)));}
  else if(row.id.startsWith('stockopen-')){validateStockOpen(row);stockOpens.set(row.id,row);}else{validateStockLink(row);stockLinks.set(row.id,row);}
 }
 for(const row of stockImages.values())if(!stockSearches.has(row.searchId))fail('在线图库图片缺少搜索来源记录');
 for(const row of stockOpens.values())if(!stockImages.has(row.imageId))fail('在线图库原生预约缺少图片');
 for(const row of stockLinks.values()){const open=stockOpens.get(row.openId);if(!open||open.imageId!==row.imageId||[...stockLinks.values()].filter(item=>item.openId===row.openId).length!==1)fail('在线图库关联缺少唯一匹配预约');await verifyStockNative({store:()=>store},root,open,row);}
 const resourceHeads=new Map(),resourceRecords=new Map(),directorReceipts=new Map(),directorFiles=new Map(),resourceLinks=[],externalBundles=[],externalFiles=[],externalLfsFiles=[],userFontFiles=[],projectFonts=[];let packageLibrary,resourcePackages=0,director;
 for(const item of resourceEntries){
  const relative='resource-imports/'+item.name,raw=await copyProject(relative,null,16384);
  if(fontTemporary.test(item.name)||userFontTemporary.test(item.name)){resourceHeads.set(item.name,sha(raw));continue;}
  const record=JSON.parse(raw.toString('utf8'));assertSafeJson(record);
  if(record.id+'.json'!==item.name||record.schema!==1)fail('资源来源记录身份无效');
  if(record.kind==='resource'){
   const expected='resource-'+sha(Buffer.from(JSON.stringify([record.revision,record.packageId,record.file,record.gitSha1])));
   const safePath=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!value.startsWith('/')&&!value.includes('\\')&&!/[\x00-\x1f]/.test(value)&&!value.split('/').some(part=>!part||part==='.'||part==='..');
   if(expected!==record.id||record.repository!=='nexu-io/open-design'||!/^[a-f0-9]{40}$/.test(record.revision||'')||!/^[a-f0-9]{40}$/.test(record.gitSha1||'')||!hex.test(record.sha256||'')||typeof record.assetName!=='string'||!safePath(record.packageId)||!safePath(record.file))fail('固定资源来源无效');
   const origin='https://raw.githubusercontent.com/'+record.repository+'/'+record.revision+'/';
   const source=origin+(record.packageId+'/'+record.file).split('/').map(encodeURIComponent).join('/');
   if(record.source!==source||record.licenseSource!==origin+'LICENSE')fail('固定资源来源地址与记录不一致');
   const bytes=legacyStore.readAsset(root,record.assetName);
   if(!bytes||bytes.length!==record.bytes||sha(bytes)!==record.sha256)fail('固定资源原件缺失或发生变化');
   const gitHash=createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex');
   if(gitHash!==record.gitSha1)fail('固定资源 Git 内容身份不一致');
   add('design/assets/'+record.assetName,bytes,record.sha256);resourceRecords.set(record.id,record);
  }else if(record.kind==='package'){
   const bytes=legacyStore.readAsset(root,record.assetName);
   if(!bytes)fail('完整资源包原件缺失');
   packageLibrary ||= new OpenDesignLibrary();
   verifyOpenDesignPackage(packageLibrary,bytes,record);
   add('design/assets/'+record.assetName,bytes,record.sha256);
   resourcePackages++;
  }else if(record.kind==='external-source'){
   const bundle=openCreativeDirector(root,record.id);bundle.verifyUsage(record);directorReceipts.set(record.id,{record,bundle});
  }else if(record.kind==='external-bundle'){
   externalBundles.push(record);
  }else if(record.kind==='external-file'){
   externalFiles.push(record);
  }else if(record.kind==='external-lfs-file'){
   externalLfsFiles.push(record);
  }else if(record.kind==='user-font-file'){
   userFontFiles.push(record);
  }else if(record.kind==='project-font'){
   projectFonts.push(record);
  }else if(['svg-source','image-source','deck-source'].includes(record.kind))resourceLinks.push(record);
  else fail('未知资源来源记录');
  resourceHeads.set(item.name,sha(raw));
 }
 const verifiedBundles=new Map();
 for(const record of externalBundles){
  const stub=resourceRecords.get(record.odReceiptId),archive=legacyStore.readAsset(root,record.assetName);
  if(!stub||stub.packageId!==record.odId||stub.file!=='SKILL.md'||!archive)fail('外部资源原包或 OpenDesign 目录项缺失');
  const stubBytes=legacyStore.readAsset(root,stub.assetName);if(!stubBytes)fail('外部资源目录项原件缺失');
  packageLibrary ||= new OpenDesignLibrary();const checked=verifyExternalSkillBundle(packageLibrary,archive,record,stubBytes);
  verifiedBundles.set(record.id,new Map(checked.metadata.files.map(row=>[row.path,row])));
  add('design/assets/'+record.assetName,archive,record.sha256);
 }
 for(const record of externalFiles){
  const row=verifiedBundles.get(record.bundleId)?.get(record.file),expected='externalfile-'+sha(Buffer.from(JSON.stringify([record.bundleId,record.file,record.gitSha1]))),bytes=legacyStore.readAsset(root,record.assetName);
  if(record.id!==expected||!row||row.lfs||row.gitSha1!==record.gitSha1||row.sha256!==record.sha256||record.bytes!==row.bytes||typeof record.assetName!=='string'||!/^extfile-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.[a-z0-9]{1,12}$/.test(record.assetName)||!record.assetName.startsWith('extfile-'+record.sha256.slice(0,24))||!bytes||bytes.length!==record.bytes||sha(bytes)!==record.sha256||createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex')!==record.gitSha1)fail('外部资源文件或来源回执不一致');
  add('design/assets/'+record.assetName,bytes,record.sha256);
 }
 const externalFileRecords=new Map(externalFiles.map(record=>[record.id,record]));
 for(const record of externalLfsFiles){
  const row=verifiedBundles.get(record.bundleId)?.get(record.file);if(!row)fail('LFS 文件缺少已核对的原包指针');validateExternalLfsFile(record,row);
  const bytes=legacyStore.readAsset(root,record.assetName);if(!bytes||bytes.length!==record.bytes||sha(bytes)!==record.sha256)fail('LFS 实际文件缺失或与指针不一致');
  add('design/assets/'+record.assetName,bytes,record.sha256);externalFileRecords.set(record.id,record);
 }
 for(const record of userFontFiles){
  validateUserFontFile(record);const path=workspacePath(root,join('design','assets',record.assetName),{mustExist:true}),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size!==record.bytes)fail('用户字体原文件缺失或大小改变');
  const bytes=await readFile(path);validateUserFontBytes(record,bytes);add('design/assets/'+record.assetName,bytes,record.sha256);externalFileRecords.set(record.id,record);
 }
 const checkedBrandThemes=new Map();
 for(const brand of Object.values(snapshot.manifest.brandState?.brands||{}))if(brand.themeSource!==undefined){
  const source=brand.themeSource;validateThemeBrandSource(source);if(brand.resource)fail('品牌不能同时关联主题和设计系统');
  const file=externalFileRecords.get(source.fileId),bundle=externalBundles.find(item=>item.id===source.bundleId);
  if(!file||file.kind!=='external-file'||file.bundleId!==source.bundleId||file.file!==source.file||file.gitSha1!==source.gitSha1||file.sha256!==source.sha256||!bundle||bundle.odId!=='skills/theme-factory')fail('品牌主题原件或来源记录缺失');
  const key=source.bundleId+'\0'+source.file;let theme=checkedBrandThemes.get(key);
  if(!theme){packageLibrary ||= new OpenDesignLibrary();theme=await readExternalTheme(packageLibrary,root,source.bundleId,source.file);checkedBrandThemes.set(key,theme);}
  if(theme.gitSha1!==source.gitSha1||theme.sha256!==source.sha256||!theme.colors.some(item=>item.hex===source.selectedHex))fail('品牌选择的主题颜色与原文件不一致');
 }
 const userFontAssetHeads=new Map();
 for(const item of userFontAssets){const bytes=await copyRelative(root,'design/assets/'+item.name,'design/assets/'+item.name,null,4*1024*1024);userFontAssetHeads.set(item.name,sha(bytes));}
 for(const record of projectFonts){const file=externalFileRecords.get(record.fileId);if(!file)fail('项目字体缺少原文件来源');validateProjectFontRecord(record,file);}
 const disabledDir=workspacePath(root,rootPrefix+'/font-disabled'),disabledEntries=await directories(disabledDir),disabledHeads=new Map();
 if(disabledEntries.length>256||disabledEntries.some(item=>!item.isFile()||!/^projectfont-[a-f0-9]{64}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(item.name)))fail('停用字体历史无效或超过预算',413);
 for(const item of disabledEntries){
  const raw=await copyProject('font-disabled/'+item.name,null,16384),record=JSON.parse(raw.toString('utf8')),file=externalFileRecords.get(record.fileId);
  if(!file||!item.name.startsWith(record.id+'-'))fail('停用字体历史缺少来源');validateProjectFontRecord(record,file);disabledHeads.set(item.name,sha(raw));
 }
 const recoveredDir=workspacePath(root,rootPrefix+'/font-recovered'),recoveredEntries=await directories(recoveredDir),recoveredHeads=new Map();
 if(recoveredEntries.length>256||recoveredEntries.some(item=>!item.isFile()||!/^projectfont-[a-f0-9]{64}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(item.name)))fail('字体恢复历史无效或超过预算',413);
 for(const item of recoveredEntries){
  const raw=await copyProject('font-recovered/'+item.name,null,16384),record=JSON.parse(raw.toString('utf8')),file=externalFileRecords.get(record.fileId);
  if(!file||!item.name.startsWith(record.id+'-'))fail('字体恢复历史缺少来源');validateProjectFontRecord(record,file);recoveredHeads.set(item.name,sha(raw));
 }
 const recoveredUserDir=workspacePath(root,rootPrefix+'/userfont-recovered'),recoveredUserEntries=await directories(recoveredUserDir),recoveredUserHeads=new Map();
 if(recoveredUserEntries.length>256||recoveredUserEntries.some(item=>!item.isFile()||!/^userfont-[a-f0-9]{64}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/.test(item.name)))fail('用户字体恢复历史无效或超过预算',413);
 for(const item of recoveredUserEntries){
  const raw=await copyProject('userfont-recovered/'+item.name,null,16384),record=JSON.parse(raw.toString('utf8')),saved=externalFileRecords.get(record.id);
  validateUserFontFile(record);if(!saved||['schema','kind','id','file','sha256','bytes','assetName'].some(key=>saved[key]!==record[key])||!item.name.startsWith(record.id+'-'))fail('用户字体恢复历史缺少来源');recoveredUserHeads.set(item.name,sha(raw));
 }
 const quarantineHeads=new Map();
 for(const item of quarantineEntries){const raw=await copyProject('font-quarantine/'+item.name,null,1024*1024);quarantineHeads.set(item.name,sha(raw));}
 const resourceLinkOperations=new Map();
 for(const link of resourceLinks){
  const external=/^(?:externalfile|externallfs)-/.test(link.resourceId||''),resource=external?externalFileRecords.get(link.resourceId):resourceRecords.get(link.resourceId),expected='link-'+sha(Buffer.from(JSON.stringify([link.resourceId,link.sourceId,link.sourceRevision,link.jobId]))),image=link.kind==='image-source',deck=link.kind==='deck-source',engine=deck?'deckcraft':image?'photocraft':'vectorcraft',extension=link.extension||'svg';
  if(expected!==link.id||!resource||resource.sha256!==link.sha256||!/^[-a-f0-9]{36}$/.test(link.jobId||'')||!hex.test(link.sourceRevision||'')||!(deck?['pptx','potx','ppsx']:image?['png','jpg']:['svg']).includes(extension)||deck&&(!external||typeof resource.file!=='string'||!resource.file.toLowerCase().endsWith('.'+extension))||(image||deck)&&link.sourceId!=='import-'+link.jobId||!sources.some(source=>source.id===link.sourceId&&source.engine===engine))fail('资源与原生源的关系无效');
  const version=await store.source(link.sourceId,link.sourceRevision);if(version.meta.engine!==engine)fail('资源原生源版本不存在');if(external){const operation=version.meta.operation;if(operation?.action!=='resource-import'||operation.id!==link.jobId||operation.resourceReceiptId!==resource.id||operation.inputHash!==resource.sha256||operation.kind!==(deck?'deck':image?'image':'svg')||(deck||operation.originOperationId!==undefined)&&!/^external-native-[a-f0-9]{64}$/.test(operation.originOperationId||''))fail('外部文件原生来源回执不一致');resourceLinkOperations.set(link.id,operation);}
  const original=workspacePath(root,join(store.directory((image||deck?'import-':'generated-')+link.jobId),'originals',link.sha256+'.'+extension),{mustExist:true});
  if(deck){const info=await lstat(original);if(!info.isFile()||info.isSymbolicLink()||info.size!==resource.bytes||info.size>16*1024*1024)fail('外部演示原件大小或类型不一致');}
  if(sha(await readFile(original))!==link.sha256)fail('资源导入原件与来源记录不一致');
 }
 const externalNativeHeads=new Map(),externalNativeOpens=new Map(),externalNativeResults=new Map();
 for(const item of externalNativeEntries){
  const relative='design/.designcraft/external-native/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('外部原生导入记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('外部原生导入记录损坏');}
  if(row){if(base.startsWith('externalopenresult-')){validateExternalNativeResult(row);if(row.id!==base)fail('外部原生结果身份不一致');const prior=externalNativeResults.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('外部原生结果冲突');if(!item.name.includes('.tmp-'))externalNativeResults.set(row.id,row);}else{validateExternalOpen(row);if(row.id!==base)fail('外部原生预约身份不一致');const prior=externalNativeOpens.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('外部原生预约冲突');if(!item.name.includes('.tmp-'))externalNativeOpens.set(row.id,row);}}
  else if(/(?:https?:\/\/|Bearer\s+[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('外部未完成导入记录含链接或疑似凭据');add(relative,raw);externalNativeHeads.set(item.name,sha(raw));
 }
 for(const open of externalNativeOpens.values())if(!externalFileRecords.has(open.resourceId))fail('外部原生预约缺少已核对的原文件');
 for(const result of externalNativeResults.values()){const open=externalNativeOpens.get(result.openId),resource=externalFileRecords.get(result.resourceId),link=resourceLinks.find(item=>item.id===result.linkId);if(!open||open.resourceId!==result.resourceId||!resource||resource.sha256!==result.sha256||!link||link.resourceId!==result.resourceId||link.sourceId!==result.sourceId||link.sourceRevision!==result.sourceRevision||link.jobId!==result.jobId||link.sha256!==result.sha256||link.kind!==(open.mediaKind==='deck'?'deck-source':open.mediaKind==='image'?'image-source':'svg-source')||resourceLinkOperations.get(link.id)?.originOperationId!==undefined&&resourceLinkOperations.get(link.id).originOperationId!==open.operationId)fail('外部原生结果与预约、来源或已保存源不一致');}
 const pendingFigmaPlanRefs=[],planStates=designPlans.map(plan=>({plan,pending:planStore.recoverable(plan.id)}));
 if(planStates.some(({pending})=>pending.invalidTemporary))fail('存在不完整的计划临时文件，已保留原文件；请先处理后再打包');
 const planHeads=planStates.map(({plan,pending})=>JSON.stringify([plan.id,pending.head,pending.items.map(item=>item.revision).sort()])).sort();
 for(const plan of designPlans){
  const lineage=planStore.lineage(plan.id),pending=planStates.find(item=>item.plan.id===plan.id).pending;
  if((plan.revision||null)!==pending.head||(lineage.at(-1)?.revision||null)!==pending.head||!lineage.length&&!pending.items.length)fail('设计计划在打包时已改变');
  const prefix='plans/'+plan.id+'/';if(lineage.length)await copyProject(prefix+'root.json',null,1024);
  const addPlanRevision=async row=>{
   for(const source of row.value.sources){
    if(source.resourceId.startsWith('figmaexport-')){pendingFigmaPlanRefs.push(source);continue;}
    if(source.resourceId.startsWith('external-')){
     if(!directorReceipts.has(source.resourceId))fail('设计计划缺少创意指导来源记录');
     const key=source.resourceId+'|'+source.file;let file=directorFiles.get(key);if(!file){file=directorReceipts.get(source.resourceId).bundle.read({file:source.file,limit:1});directorFiles.set(key,file);}
     if(file.gitSha1!==source.gitSha1||file.sha256!==source.sha256)fail('设计计划引用的创意指导文件不一致');
     continue;
    }
    const external=source.resourceId.startsWith('externalfile-')||source.resourceId.startsWith('externallfs-'),saved=external?externalFileRecords.get(source.resourceId):resourceRecords.get(source.resourceId);
    if(!saved||external&&saved.bundleId!==source.bundleId||!external&&saved.packageId!==source.packageId||saved.file!==source.file||saved.gitSha1!==source.gitSha1||saved.sha256!==source.sha256)fail('设计计划引用的资源原件或来源记录缺失');
   }
   if(/(?:\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"][^'"]{12,}|\bBearer\s+[A-Za-z0-9_.-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{30,})/i.test(row.value.brief+'\n'+row.value.content))fail('设计计划中包含疑似凭据，请先移除后再导出项目包');
   await copyProject(prefix+'history/'+(row.storageName||row.revision+'.json'),row.revision,256*1024);
  };
  let previous=null;
  for(const row of lineage){
   if(previous)await copyProject(prefix+'next/'+previous+'.json',null,1024);
   await addPlanRevision(row);previous=row.revision;
  }
  for(const item of pending.items){const candidate=planStore.candidate(plan.id,item.revision,{allowTemporary:true});await addPlanRevision({revision:item.revision,storageName:candidate.storageName,value:candidate.plan});}
 }
 const planLinkHeads=new Map(),planLinkRecords=new Map(),planUnlinkRecords=[],planLinkPlanCache=new Map(),planLinkSourceCache=new Map(),planLinkCountedSources=new Set();let planLinkSourceBytes=0;
 for(const item of [...planLinkEntries.filter(item=>!item.name.includes('.tmp-')),...planLinkEntries.filter(item=>item.name.includes('.tmp-'))]){const relative='design/.designcraft/plan-source-links/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('设计计划关联记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('设计计划关联记录损坏');}if(row){if(base.startsWith('planlink-')){validatePlanSourceLink(row);if(row.id!==base)fail('设计计划关联身份不一致');const cacheSize=planLinkSourceCache.size;await verifyPlanSourceLink(root,row,{planCache:planLinkPlanCache,sourceCache:planLinkSourceCache});if(planLinkSourceCache.size!==cacheSize){const key=row.sourceType+'|'+row.sourceId+'|'+row.sourceRevision,size=planLinkSourceCache.get(key)?.bytes,countKey=row.sourceType+'|'+row.sourceId+'|'+(row.sourceType==='native'?row.sourceHash:row.sourceRevision);if(!Number.isSafeInteger(size)||size<0)fail('设计计划关联的作品大小无效');if(!planLinkCountedSources.has(countKey)){planLinkCountedSources.add(countKey);if((planLinkSourceBytes+=size)>limit)fail('设计计划关联的作品版本超过项目包预算',413);}}const prior=planLinkRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('设计计划关联记录冲突');if(!item.name.includes('.tmp-'))planLinkRecords.set(row.id,row);}else{validatePlanSourceUnlink(row);if(row.id!==base)fail('设计计划关联撤销身份不一致');planUnlinkRecords.push(row);}}else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('未完成计划关联记录含链接或疑似凭据');add(relative,raw);planLinkHeads.set(item.name,sha(raw));}
 for(const row of planUnlinkRecords)if(!planLinkRecords.has(row.linkId))fail('设计计划关联撤销缺少原声明');
 const briefHeads=new Map(),briefRecords=new Map();
 for(const item of [...briefEntries.filter(item=>!item.name.includes('.tmp-')),...briefEntries.filter(item=>item.name.includes('.tmp-'))]){const relative='design/.designcraft/opendesign-brief/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('设计简报任务记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('设计简报任务记录损坏');}if(row){validateBriefJob(row);if(row.id!==base||!resourceRecords.has(row.ruleResourceId))fail('设计简报任务缺少匹配的固定规则');const checked=await verifyBriefArtifacts(root,row),prior=briefRecords.get(row.id);if(prior&&JSON.stringify(prior.job)!==JSON.stringify(row))fail('设计简报任务记录冲突');if(!item.name.includes('.tmp-'))briefRecords.set(row.id,checked);}else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('未完成设计简报记录含链接或疑似凭据');add(relative,raw);briefHeads.set(item.name,sha(raw));}
 const htmlAssetHeads=new Map(),htmlAssetRecords=new Map(),htmlAssetCache=new Map(),htmlAssetGraphCache=new Map(),htmlAssetSources=new Set();let htmlAssetSourceBytes=0;
 for(const item of [...htmlAssetEntries.filter(item=>!item.name.includes('.tmp-')),...htmlAssetEntries.filter(item=>item.name.includes('.tmp-'))]){const relative='design/.designcraft/html-asset-ops/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('网页项目素材预约无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('网页项目素材预约损坏');}if(row){validateHtmlAssetReservation(row);if(row.id!==base)fail('网页项目素材预约身份不一致');const oldSize=htmlAssetCache.size,checked=await verifyHtmlAssetReservation(root,row,{assetCache:htmlAssetCache,graphCache:htmlAssetGraphCache});if(htmlAssetGraphCache.size>64)fail('网页素材关联的项目历史超过核对预算',413);if(htmlAssetCache.size!==oldSize){const material=htmlAssetCache.get(row.assetId),sourceKey=row.sourceId+'|'+row.sourceHash,size=material.source?.meta?.bytes;if(!Number.isSafeInteger(size)||size<0)fail('网页素材原生源大小无效');if(!htmlAssetSources.has(sourceKey)){htmlAssetSources.add(sourceKey);htmlAssetSourceBytes+=size;}htmlAssetSourceBytes+=row.assetBytes;if(htmlAssetSourceBytes>limit)fail('网页素材关联的源超过项目包预算',413);}const prior=htmlAssetRecords.get(row.id);if(prior&&JSON.stringify(prior.reservation)!==JSON.stringify(row))fail('网页项目素材预约冲突');if(!item.name.includes('.tmp-'))htmlAssetRecords.set(row.id,checked);}else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('未完成网页素材预约含链接或疑似凭据');add(relative,raw);htmlAssetHeads.set(item.name,sha(raw));}
 const migration=new LegacyMigration(root),plans=legacyDocs.length?await migration.plans():[],legacyHeads=legacyDocs.map(doc=>doc.id+'@'+doc.revision).sort();
 for(const workflow of await localWorkflowExport(root)){add('design/.designcraft/local-workflows/'+workflow.name,workflow.bytes);for(const asset of workflow.assets)add('design/assets/'+asset.name,asset.bytes,asset.sha256);}
 for(const trace of imagePlanTraces(root)){add('design/.designcraft/image-plan-links/'+trace.name,trace.bytes);for(const asset of trace.assets)add('design/assets/'+asset.name,asset.bytes,asset.sha256);}
 for(const doc of legacyDocs){
  const plan=plans.find(item=>!item.error&&item.docId===doc.id&&item.revision===doc.revision);
  if(!plan)fail('旧作品 '+doc.title+' 尚未创建当前版本的迁移备份，请先在迁移面板准备快照');
  if(plan.missing.length)fail('旧作品 '+doc.title+' 缺少素材，未生成不完整项目包');
  const backup=await migration.backup(plan.id),archived=readZip(backup,{maxEntries:10000,maxEntryBytes:64*1024*1024,maxTotalBytes:160*1024*1024});
  const byName=new Map(archived.map(item=>[item.name,item.data])),original=byName.get('original/'+doc.id+'.dc.json');
  if(!original||legacyStore.revisionOf(original.toString('utf8'))!==doc.revision)fail('旧作品备份与当前版本不一致');
  add('design/'+doc.id+'.dc.json',original);
  for(const name of plan.assetNames){
   const content=byName.get('original/assets/'+name);if(!content)fail('旧作品备份缺少引用素材：'+name);
   add('design/assets/'+name,content);
   const mapped=plan.assetMap?.[name];if(mapped){const value=legacyStore.readAsset(root,mapped);if(!value||sha(value)!==sha(content))fail('迁移快照素材与原件不一致');add('design/assets/'+mapped,value);}
  }
  const prefix='migrations/'+plan.id+'/';
  for(const name of ['snapshot.json','snapshot.sha256','document.json','original.zip'])await copyProject(prefix+name,null,name==='original.zip'?160*1024*1024:16*1024*1024);
  for(const sub of ['items','receipts'])for(const item of await directories(workspacePath(root,rootPrefix+'/'+prefix+sub))){
   if(!item.isFile()||!(/^[\w.-]+$/.test(item.name)))fail('迁移记录包含无效文件名');
   await copyProject(prefix+sub+'/'+item.name,null,64*1024*1024);
  }
 }
 const imageDir=workspacePath(root,'design/.designcraft/image-jobs'),imageEntries=(await directories(imageDir)).filter(item=>/^image-[a-f0-9-]{36}\.json$/.test(item.name));
 if(imageEntries.length>2000)fail('图片任务记录超过项目包预算',413);
 if(imageEntries.some(item=>!item.isFile()))fail('图片任务记录包含非普通文件',422);
 const imageHeads=new Map(),imageRecords=new Map(),availableAssets=new Set(legacyStore.listAssets(root).map(item=>item.name));
 for(const item of imageEntries){
  const relative='design/.designcraft/image-jobs/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)fail('图片候选记录无效或超过预算',422);
  const raw=await readFile(path),job=JSON.parse(raw.toString('utf8'));assertSafeJson(job);
  if(job.id+'.json'!==item.name||!Array.isArray(job.candidates))fail('图片候选记录身份无效',422);
  if(job.returnedImages!==undefined&&(!Array.isArray(job.returnedImages)||job.returnedImages.length>512))fail('服务原图记录无效或超过预算',422);
  if(job.transparentBackground!==undefined&&typeof job.transparentBackground!=='boolean')fail('透明背景任务选项无效');
  if(job.transparentBackground===true&&(job.mode!=='generate'||!job.studio||!/^[a-f0-9]{64}$/.test(job.connectionFingerprint||'')||!Array.isArray(job.referenceHashes)||(job.returnedImages||[]).some(output=>!output||output.mime!=='image/png'||output.warnings!==undefined&&(!Array.isArray(output.warnings)||output.warnings.length>10||output.warnings.some(value=>typeof value!=='string'||value.length>500)))))fail('透明背景任务或原始 PNG 记录无效');
  if(job.quality!==undefined&&(!['low','medium','high','xhigh','max'].includes(job.quality)||!job.studio||!['generate','edit'].includes(job.mode)||!/^[a-f0-9]{64}$/.test(job.connectionFingerprint||'')||job.mode==='generate'&&!Array.isArray(job.referenceHashes)||job.mode==='edit'&&(!job.studio.source?.sourceId||!job.studio.source?.sourceRevision||!Array.isArray(job.editReferenceHashes))))fail('图片画质任务记录无效');
  if(job.editReferenceHashes!==undefined&&(job.mode!=='edit'||!job.quality&&job.veniceSizing!==true))fail('图片编辑参考图摘要的任务类型无效');
  if(job.veniceSizing!==undefined&&(job.veniceSizing!==true||!job.studio||!['generate','edit'].includes(job.mode)||!job.resolution&&!job.aspectRatio||!/^[a-f0-9]{64}$/.test(job.connectionFingerprint||'')||job.mode==='generate'&&!Array.isArray(job.referenceHashes)||job.mode==='edit'&&(!job.studio.source?.sourceId||!job.studio.source?.sourceRevision||!Array.isArray(job.editReferenceHashes))))fail('Venice 图片尺寸任务记录无效');
  if(job.openAiSizing!==undefined&&(job.openAiSizing!==true||!job.studio||job.mode!=='generate'||!job.resolution||!!job.aspectRatio||!/^[a-f0-9]{64}$/.test(job.connectionFingerprint||'')||!Array.isArray(job.referenceHashes)))fail('OpenAI 图片尺寸任务记录无效');
  if(job.veniceStyleReferences!==undefined&&(job.veniceStyleReferences!==true||!job.studio||job.mode!=='generate'||!Array.isArray(job.referenceAssets)||job.referenceAssets.length!==0||!Array.isArray(job.referenceHashes)||job.referenceHashes.length!==0||!/^[a-f0-9]{64}$/.test(job.connectionFingerprint||'')||!Array.isArray(job.styleReferenceAssets)||job.styleReferenceAssets.length<1||job.styleReferenceAssets.length>4||new Set(job.styleReferenceAssets).size!==job.styleReferenceAssets.length||!Array.isArray(job.styleReferenceHashes)||job.styleReferenceHashes.length!==job.styleReferenceAssets.length||job.styleReferenceStrength!==undefined&&(typeof job.styleReferenceStrength!=='number'||!Number.isFinite(job.styleReferenceStrength)||job.styleReferenceStrength<0.1||job.styleReferenceStrength>1)))fail('Venice 风格参考任务记录无效');
  if(job.veniceStyleReferences!==true&&(job.styleReferenceAssets!==undefined||job.styleReferenceHashes!==undefined||job.styleReferenceStrength!==undefined))fail('风格参考缺少相应任务身份');
  if(job.transparentBackground===true||job.quality||job.veniceSizing||job.openAiSizing||job.veniceStyleReferences){
   const expected=sha(Buffer.from(JSON.stringify({mode:job.mode,sourceId:job.mode==='edit'?job.studio.source.sourceId:null,sourceRevision:job.mode==='edit'?job.studio.source.sourceRevision:null,provider:job.provider||null,model:job.model,prompt:job.prompt,count:job.count,resolution:job.resolution||null,aspectRatio:job.aspectRatio||null,referenceAssets:job.referenceAssets||[],...(job.referenceHashes?{referenceHashes:job.referenceHashes}:{}),...(job.editReferenceHashes?{editReferenceHashes:job.editReferenceHashes}:{}),...(job.connectionFingerprint?{connectionFingerprint:job.connectionFingerprint}:{}),...(job.quality?{quality:job.quality}:{}),...(job.transparentBackground?{transparentBackground:true}:{}),...(job.veniceStyleReferences?{styleReferenceAssets:job.styleReferenceAssets,styleReferenceHashes:job.styleReferenceHashes,...(job.styleReferenceStrength!==undefined?{styleReferenceStrength:job.styleReferenceStrength}:{})}:{})})));
   if(job.requestSignature!==expected)fail('图片选项或风格参考任务与请求身份不一致');
  }
  if(VENICE_IMAGE_MODES.includes(job.mode)||VENICE_IMAGE_MODES.some(mode=>job.kind==='image.'+mode)){
   validateVeniceTransformRecord(job);if((job.returnedImages||[]).some(output=>!output||output.mime!=='image/png'||output.warnings!==undefined&&(!Array.isArray(output.warnings)||output.warnings.length>10||output.warnings.some(value=>typeof value!=='string'||value.length>500))))fail('Venice 图片处理原始输出或提示无效');
  }
  if(['queued','running','adopting'].includes(job.status))fail('图片任务正在执行，请等待或取消后再打包',423);
  if(/(?:\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"][^'"]{12,}|\bBearer\s+[A-Za-z0-9_.-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{30,})/i.test(job.prompt||''))fail('图片任务提示词中包含疑似凭据，请先移除后再导出项目包');
  if(job.referenceHashes!==undefined&&(!Array.isArray(job.referenceAssets)||!Array.isArray(job.referenceHashes)||job.referenceAssets.length!==job.referenceHashes.length||job.referenceHashes.some((value,index)=>{const bytes=legacyStore.readAsset(root,job.referenceAssets[index]);return !/^[a-f0-9]{64}$/.test(value||'')||!bytes||sha(bytes)!==value;})))fail('图片任务的参考图摘要不一致');
  if(job.editReferenceHashes!==undefined&&(!Array.isArray(job.referenceAssets)||!Array.isArray(job.editReferenceHashes)||job.referenceAssets.length!==job.editReferenceHashes.length||job.editReferenceHashes.some((value,index)=>{const bytes=legacyStore.readAsset(root,job.referenceAssets[index]);return !/^[a-f0-9]{64}$/.test(value||'')||!bytes||sha(bytes)!==value;})))fail('图片编辑参考图摘要不一致');
  if(job.veniceStyleReferences&&(job.styleReferenceHashes.some((value,index)=>{const bytes=legacyStore.readAsset(root,job.styleReferenceAssets[index]);return !/^[a-f0-9]{64}$/.test(value||'')||!bytes||!bytes.length||bytes.length>=8000000||sha(bytes)!==value;})))fail('图片风格参考图摘要不一致');
  const referenced=new Set();let nodes=0;
  const walk=value=>{if(++nodes>100000)fail('图片任务引用超过预算',413);if(typeof value==='string'){if(availableAssets.has(value))referenced.add(value);return;}if(Array.isArray(value)){for(const child of value)walk(child);return;}if(value&&typeof value==='object')for(const child of Object.values(value))walk(child);};
  walk(job);
  const required=[...(job.referenceAssets||[]),...(job.styleReferenceAssets||[]),job.source?.asset,job.source?.nativeSource,job.editMask?.maskAsset,job.editMask?.guideAsset,...(job.returnedImages||[]).map(output=>output.asset),...job.candidates.flatMap(candidate=>[candidate.asset,candidate.original,candidate.native?.source,candidate.native?.renderedAsset,candidate.native?.original,candidate.vendorOriginal,candidate.overlayAsset])].filter(name=>typeof name==='string'&&name);
  if(required.some(name=>!availableAssets.has(name)))fail('图片任务或候选缺少引用素材，未导出不完整项目');
  for(const name of referenced){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('图片候选引用的素材缺失：'+name);add('design/assets/'+name,bytes);}
  const returnedIds=new Set();for(const output of job.returnedImages||[]){
   const expected='imageoutput-'+sha(Buffer.from(JSON.stringify([job.id,output.index,output.ordinal,output.sha256]))),bytes=typeof output.asset==='string'?legacyStore.readAsset(root,output.asset):null;
   if(!/^imageoutput-[a-f0-9]{64}$/.test(output.id||'')||output.id!==expected||returnedIds.has(output.id)||!Number.isSafeInteger(output.index)||output.index<0||output.index>=job.count||!Number.isSafeInteger(output.ordinal)||output.ordinal<0||output.ordinal>=128||!/^[a-f0-9]{64}$/.test(output.sha256||'')||!bytes||bytes.length!==output.bytes||sha(bytes)!==output.sha256||!['image/png','image/jpeg','image/webp'].includes(output.mime))fail('服务原图或来源记录不一致');
   const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=bytes[0]===255&&bytes[1]===216,webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!(output.mime==='image/png'&&png||output.mime==='image/jpeg'&&jpeg||output.mime==='image/webp'&&webp))fail('服务原图类型不一致');returnedIds.add(output.id);
  }
  const convertedIds=new Set();for(const candidate of job.candidates)if(candidate.returnedImageId){const source=(job.returnedImages||[]).find(output=>output.id===candidate.returnedImageId),name=job.mode==='edit'?candidate.vendorOriginal:candidate.original,original=source&&typeof name==='string'?legacyStore.readAsset(root,name):null;if(!source||source.index!==candidate.index||source.ordinal!==candidate.returnedOrdinal||convertedIds.has(source.id)||!original||sha(original)!==source.sha256)fail('图片候选与服务原图关系不一致');convertedIds.add(source.id);}
  for(const candidate of job.candidates){if(!candidate.native?.source||!referenced.has(candidate.native.source)||!candidate.asset||!referenced.has(candidate.asset))fail('图片候选缺少可编辑源或预览，未导出不完整项目');if(candidate.sourceHash&&sha(legacyStore.readAsset(root,candidate.native.source))!==candidate.sourceHash)fail('图片候选原生源摘要不一致');}
  if(job.studio)job.studio={...job.studio,sessionId:null};delete job.ownerPid;
  add(relative,json(job));imageHeads.set(item.name,sha(raw));imageRecords.set(job.id,job);
 }
 const ecommerceHeads=new Map(),ecommerceRefHeads=new Map(),ecommercePlans=new Map(),ecommerceGalleries=new Map();
 const retainEcommerceRefs=plan=>{for(const ref of plan.references){const bytes=legacyStore.readAsset(root,ref.asset);if(!bytes||bytes.length!==ref.bytes||sha(bytes)!==ref.sha256)fail('电商图参考原件缺失或改变');add('design/assets/'+ref.asset,bytes,ref.sha256);}};
 for(const item of ecommerceEntries.filter(item=>item.name.startsWith('ecomplan-'))){
  const relative='design/.designcraft/ecommerce/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>128*1024)fail('电商图计划记录无效',422);const raw=await readFile(path),base=item.name.slice(0,'ecomplan-'.length+64);let plan;try{plan=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('电商图计划记录损坏');}
  if(plan){validateEcommercePlan(plan);if(plan.id!==base)fail('电商图计划身份不一致');retainEcommerceRefs(plan);const prior=ecommercePlans.get(plan.id);if(prior&&prior.requestHash!==plan.requestHash)fail('电商图计划候选冲突');if(!item.name.includes('.tmp-'))ecommercePlans.set(plan.id,plan);}
  else if(/(?:Bearer\s+[A-Za-z0-9_.:-]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})/i.test(raw.toString('utf8')))fail('电商图未完成计划含疑似凭据');add(relative,raw);ecommerceHeads.set(item.name,sha(raw));
 }
 for(const item of ecommerceEntries.filter(item=>item.name.startsWith('ecomgallery-'))){
  const relative='design/.designcraft/ecommerce/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('电商图画廊记录无效',422);const raw=await readFile(path),base=item.name.slice(0,'ecomgallery-'.length+64);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('电商图画廊记录损坏');}
  if(row){validateEcommerceGallery(row);const plan=ecommercePlans.get(row.planId);if(row.id!==base||!plan||plan.requestHash!==row.requestHash)fail('电商图画廊来源计划不一致');const saved=await htmlStore.read(row.htmlId,row.htmlRevision),doc=saved.document,manifestFile=doc.files.find(file=>file.path==='image-manifest.json'),galleryFile=doc.files.find(file=>file.path==='ecommerce-gallery.html');if(doc.provenance?.source!=='ecommerce-workflow'||doc.provenance.planId!==plan.id||doc.provenance.requestHash!==plan.requestHash||!manifestFile||manifestFile.sha256!==row.manifestSha256||!galleryFile||galleryFile.sha256!==row.gallerySha256)fail('电商画廊网页来源不一致');let manifest;try{manifest=JSON.parse(Buffer.from(manifestFile.data,'base64').toString('utf8'));assertSafeJson(manifest);}catch{fail('电商图片清单无效');}if(manifest.workflow!=='ecommerce-image-workflow'||manifest.mode!=='reference-product'||manifest.planId!==plan.id||manifest.requestHash!==plan.requestHash||!Array.isArray(manifest.references)||manifest.references.length!==plan.references.length||!Array.isArray(manifest.slots)||manifest.slots.length!==3)fail('电商图片清单来源不一致');for(let index=0;index<plan.references.length;index++){const ref=plan.references[index],expected='references/reference-'+(index+1)+'.'+ref.format,listed=manifest.references[index],savedRef=doc.files.find(file=>file.path===expected);if(listed?.file!==expected||listed.sourceAsset!==ref.asset||listed.sha256!==ref.sha256||savedRef?.sha256!==ref.sha256)fail('电商画廊参考原件不一致');}
   for(const value of row.items){const slot=plan.slots.find(slot=>slot.id===value.slot),job=imageRecords.get(value.jobId),candidate=job?.candidates?.find(candidate=>candidate.id===value.candidateId),preview=legacyStore.readAsset(root,value.asset),source=candidate?.native?.source&&legacyStore.readAsset(root,candidate.native.source),galleryImage=doc.files.find(file=>file.path==='images/'+value.slot+'.png');if(!slot||!job||job.requestSignature!==ecommerceRequestSignature(plan,slot)||!candidate||candidate.asset!==value.asset||candidate.sourceHash!==value.sourceSha256||!preview||sha(preview)!==value.previewSha256||!source||sha(source)!==value.sourceSha256||galleryImage?.sha256!==value.previewSha256||!manifest.slots.some(item=>item.id===value.slot&&item.jobId===value.jobId&&item.candidateId===value.candidateId&&item.output==='images/'+value.slot+'.png'&&item.sha256===value.previewSha256))fail('电商图画廊与实际图片候选不一致');}
   if(!item.name.includes('.tmp-'))ecommerceGalleries.set(row.id,row);
  }else if(/(?:Bearer\s+[A-Za-z0-9_.:-]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{30,})/i.test(raw.toString('utf8')))fail('电商图未完成画廊记录含疑似凭据');add(relative,raw);ecommerceHeads.set(item.name,sha(raw));
 }
 for(const name of ecommerceRefNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('电商图保留原件缺失');const digest=sha(bytes);if(!name.startsWith('ecom-reference-'+digest.slice(0,24)))fail('电商图保留原件名称与摘要不一致');add('design/assets/'+name,bytes,digest);ecommerceRefHeads.set(name,digest);}
 const falRealtimeHeads=new Map(),falRealtimeAssetHeads=new Map(),falRealtimeSessions=new Map(),falRealtimeJobs=new Map();
 for(const name of falRealtimeAssetNames){const bytes=legacyStore.readAsset(root,name),digest=bytes&&sha(bytes),prefix=name.startsWith('falrt-input-')?'falrt-input-':'falrt-image-',png=bytes?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=bytes?.[0]===255&&bytes?.[1]===216;if(!bytes||!name.startsWith(prefix+digest.slice(0,24))||!(name.endsWith('.png')&&png||name.endsWith('.jpg')&&jpg))fail('fal 实时保留素材类型或摘要不一致');add('design/assets/'+name,bytes,digest);falRealtimeAssetHeads.set(name,digest);}
 for(const item of falRealtimeEntries){const relative='design/.designcraft/fal-realtime/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('fal 实时记录无效',422);const raw=await readFile(path),preserved=/\.preserved-([a-f0-9]{64})\.json$/.exec(item.name),base=item.name.replace(/\.preserved-[a-f0-9]{64}\.json$/,'').replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');if(preserved&&sha(raw)!==preserved[1])fail('fal 实时原记录备份摘要不一致');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('fal 实时记录损坏');}if(row){if(base.startsWith('falrtsession-')){validateFalRealtimeSession(row);if(row.id!==base)fail('fal 实时会话身份不一致');if(!item.name.includes('.tmp-')&&!preserved){if(['connecting','open'].includes(row.status))fail('fal 实时会话尚未关闭，请先关闭或核对中断状态',423);falRealtimeSessions.set(row.id,row);}}else{validateFalRealtimeJob(row);if(row.id!==base)fail('fal 实时任务身份不一致');verifyFalRealtimeAssets(root,row);if([...row.inputAssets,...row.outputs].some(asset=>!falRealtimeAssetHeads.has(asset.asset)))fail('fal 实时任务缺少实际素材');if(!item.name.includes('.tmp-')&&!preserved){if(['prepared','sent'].includes(row.status)||row.status==='partial'&&!row.finishedAt)fail('fal 实时帧尚未结束，请先关闭或核对状态',423);falRealtimeJobs.set(row.id,row);}}if(item.name.includes('.tmp-')||preserved)add(relative,raw);else{const portable={...row};delete portable.ownerPid;add(relative,json(portable));}}
  else{if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,}|fal_jwt_token)/i.test(raw.toString('utf8')))fail('fal 实时未完成记录含链接或疑似凭据');add(relative,raw);}falRealtimeHeads.set(item.name,sha(raw));}
 for(const job of falRealtimeJobs.values()){const session=falRealtimeSessions.get(job.sessionId);if(!session||session.provider!==job.provider||session.model!==job.model||session.schemaSha256!==job.schemaSha256)fail('fal 实时任务缺少匹配会话');}
 const falRtNativeHeads=new Map(),falRtImages=new Map(),falRtOpens=new Map(),falRtLinks=new Map();
 for(const item of falRtNativeEntries){const relative='design/.designcraft/fal-realtime-native/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('fal 实时原生记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('fal 实时原生记录损坏');}if(row){if(base.startsWith('falrtimage-')){validateFalRtImage(row);if(row.id!==base)fail('fal 实时图片身份不一致');const job=falRealtimeJobs.get(row.jobId);if(!job)fail('fal 实时图片缺少任务');await verifyFalRtImage(root,row);const prior=falRtImages.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('fal 实时图片来源冲突');if(!item.name.includes('.tmp-'))falRtImages.set(row.id,row);}else if(base.startsWith('falrtopen-')){validateFalRtOpen(row);if(row.id!==base)fail('fal 实时图片预约身份不一致');const prior=falRtOpens.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('fal 实时图片预约冲突');if(!item.name.includes('.tmp-'))falRtOpens.set(row.id,row);}else{validateFalRtLink(row);if(row.id!==base)fail('fal 实时图片关联身份不一致');const prior=falRtLinks.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('fal 实时图片关联冲突');if(!item.name.includes('.tmp-'))falRtLinks.set(row.id,row);}}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,}|fal_jwt_token)/i.test(raw.toString('utf8')))fail('fal 实时未完成原生记录含链接或疑似凭据');add(relative,raw);falRtNativeHeads.set(item.name,sha(raw));}
 for(const open of falRtOpens.values())if(!falRtImages.has(open.imageId))fail('fal 实时图片预约缺少来源');
 for(const link of falRtLinks.values()){const original=falRtImages.get(link.imageId),open=falRtOpens.get(link.openId);if(!original||!open||open.imageId!==link.imageId||original.sha256!==link.sha256||!sources.some(source=>source.id===link.sourceId&&source.engine==='photocraft'))fail('fal 实时原生来源关联不一致');const source=await store.source(link.sourceId,link.sourceRevision),op=source.meta.operation;if(source.meta.engine!=='photocraft'||op?.action!=='resource-import'||op.id!==link.jobId||op.originOperationId!==open.operationId||op.resourceReceiptId!==original.id||op.inputHash!==original.sha256||op.kind!=='image')fail('fal 实时原生保存回执无效');const prefix='sources/import-'+link.jobId+'/originals/',filename=link.sha256+'.'+original.format;await copyProject(prefix+filename,link.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+link.sha256+'.json',null,16384));if(metadata.sha256!==link.sha256||metadata.file!==filename)fail('fal 实时图片原件元数据不一致');}
 const figmamcpJobHeads=new Map(),figmamcpResultHeads=new Map(),figmamcpAssetHeads=new Map(),figmamcpDataHeads=new Map(),figmamcpJobRecords=new Map(),figmamcpResultRecords=new Map(),figmamcpResultsByJob=new Map(),figmamcpAssetRecords=new Map();
 for(const item of figmamcpJobs.filter(item=>figmamcpJobName.test(item.name))){
  const relative='design/.designcraft/figmamcp-jobs/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('FigmaMcp 任务记录无效',422);
  const raw=await readFile(path),job=JSON.parse(raw.toString('utf8'));validateFigmaMcpJob(job);if(job.id+'.json'!==item.name)fail('FigmaMcp 任务身份不一致');if(['queued','running'].includes(job.status))fail('FigmaMcp 任务正在执行，请等待或停止后再打包',423);
  if(job.resultAsset){const bytes=legacyStore.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)fail('FigmaMcp 结果缺失或摘要不一致');validateFigmaMcpResultBytes(bytes);add('design/assets/'+job.resultAsset,bytes,job.resultSha256);}
  figmamcpJobHeads.set(item.name,sha(raw));figmamcpJobRecords.set(job.id,job);delete job.ownerPid;delete job.snapshotId;add(relative,json(job));
 }
 for(const item of figmamcpJobs.filter(item=>figmamcpJobTemp.test(item.name))){
  const relative='design/.designcraft/figmamcp-jobs/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('FigmaMcp 任务候选无效',422);
  const raw=await readFile(path),base=item.name.slice(0,'figmamcpjob-'.length+64);let job;try{job=JSON.parse(raw.toString('utf8'));}catch{}
  if(job){validateFigmaMcpJob(job);const current=figmamcpJobRecords.get(base);if(job.id!==base||current&&(current.tool!==job.tool||current.requestHash!==job.requestHash||current.inputHash!==job.inputHash||current.schemaSha256!==job.schemaSha256))fail('FigmaMcp 任务候选与来源不一致');if(job.resultAsset){const bytes=legacyStore.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)fail('FigmaMcp 任务候选结果缺失');validateFigmaMcpResultBytes(bytes);add('design/assets/'+job.resultAsset,bytes,job.resultSha256);}}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('FigmaMcp 未完成任务记录含链接或疑似凭据');
  add(relative,raw);figmamcpJobHeads.set(item.name,sha(raw));
 }
 for(const item of [...figmamcpResults.filter(item=>figmamcpResultName.test(item.name)),...figmamcpResults.filter(item=>figmamcpResultTemp.test(item.name))]){
  const relative='design/.designcraft/figmamcp-results/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('FigmaMcp 结果回执无效',422);
  const raw=await readFile(path),base=item.name.slice(0,'figmamcpresult-'.length+64);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(figmamcpResultName.test(item.name))fail('FigmaMcp 结果回执损坏');}
  if(row){
   validateFigmaMcpResultReceipt(row);const job=figmamcpJobRecords.get(row.jobId);if(row.id!==base||!job||job.tool!==row.tool||job.requestHash!==row.requestHash||job.inputHash!==row.inputHash||job.schemaSha256!==row.schemaSha256)fail('FigmaMcp 结果回执与任务不一致');
   const bytes=legacyStore.readAsset(root,row.resultAsset);if(!bytes||bytes.length!==row.resultBytes||sha(bytes)!==row.resultSha256)fail('FigmaMcp 结果回执对应的文件缺失');validateFigmaMcpResultBytes(bytes);add('design/assets/'+row.resultAsset,bytes,row.resultSha256);
   const prior=figmamcpResultRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('FigmaMcp 结果回执冲突');if(figmamcpResultName.test(item.name)){figmamcpResultRecords.set(row.id,row);const group=figmamcpResultsByJob.get(row.jobId)||[];group.push(row);figmamcpResultsByJob.set(row.jobId,group);}
  }else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('FigmaMcp 未完成结果回执含链接或疑似凭据');
  add(relative,raw);figmamcpResultHeads.set(item.name,sha(raw));
 }
 for(const job of figmamcpJobRecords.values())if(job.status==='responded'&&!(figmamcpResultsByJob.get(job.id)||[]).some(row=>row.resultAsset===job.resultAsset&&row.resultSha256===job.resultSha256&&row.resultBytes===job.resultBytes))fail('FigmaMcp 已返回任务缺少对应结果回执');
 const figmamcpOpens=new Map(),figmamcpLinks=new Map(),figmamcpImageHeads=new Map();
 for(const item of figmamcpAssets){
  const relative='design/.designcraft/figmamcp-assets/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Figma MCP 图片来源记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Figma MCP 图片来源记录损坏');}
  if(row){
   if(base.startsWith('figmamcpasset-')){validateFigmaMcpImage(row);if(row.id!==base)fail('Figma MCP 图片身份不一致');const bytes=legacyStore.readAsset(root,row.assetName),response=legacyStore.readAsset(root,row.responseAsset);verifyFigmaMcpImage(row,bytes,response,validateFigmaMcpResultBytes);add('design/assets/'+row.assetName,bytes,row.sha256);add('design/assets/'+row.responseAsset,response,row.responseSha256);const prior=figmamcpAssetRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma MCP 图片回执冲突');if(!item.name.includes('.tmp-'))figmamcpAssetRecords.set(row.id,row);}
   else if(base.startsWith('figmamcpopen-')){validateFigmaMcpOpen(row);if(row.id!==base)fail('Figma MCP 图片导入身份不一致');const prior=figmamcpOpens.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma MCP 图片导入预约冲突');if(!item.name.includes('.tmp-'))figmamcpOpens.set(row.id,row);}
   else{validateFigmaMcpLink(row);if(row.id!==base)fail('Figma MCP 图片关联身份不一致');const prior=figmamcpLinks.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma MCP 图片关联冲突');if(!item.name.includes('.tmp-'))figmamcpLinks.set(row.id,row);}
  }else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|fig[dou]_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Figma MCP 未完成图片记录含链接或疑似凭据');add(relative,raw);figmamcpAssetHeads.set(item.name,sha(raw));
 }
 for(const open of figmamcpOpens.values())if(!figmamcpAssetRecords.has(open.assetId))fail('Figma MCP 图片预约缺少来源原件');
 for(const link of figmamcpLinks.values()){
  const original=figmamcpAssetRecords.get(link.assetId),open=figmamcpOpens.get(link.openId);if(!original||!open||open.assetId!==link.assetId||original.sha256!==link.sha256||!sources.some(source=>source.id===link.sourceId&&source.engine==='photocraft'))fail('Figma MCP 原生图片来源关联不一致');const source=await store.source(link.sourceId,link.sourceRevision),operation=source.meta.operation;if(source.meta.engine!=='photocraft'||operation?.action!=='resource-import'||operation.id!==link.jobId||operation.resourceReceiptId!==original.id||operation.inputHash!==original.sha256||operation.kind!=='image'||link.sourceId!=='import-'+link.jobId)fail('Figma MCP 原生图片源或回执无效');const prefix='sources/import-'+link.jobId+'/originals/',filename=link.sha256+'.'+original.format;await copyProject(prefix+filename,link.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+link.sha256+'.json',null,16384));if(metadata.sha256!==link.sha256||metadata.file!==filename)fail('Figma MCP 图片原件元数据不一致');
 }
 for(const name of figmamcpImageNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Figma MCP 保留图片缺失');const digest=sha(bytes);if(!name.startsWith('figmamcp-image-'+digest.slice(0,24)))fail('Figma MCP 保留图片名称与摘要不一致');add('design/assets/'+name,bytes,digest);figmamcpImageHeads.set(name,digest);}
 for(const name of figmamcpDataNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Figma MCP 保留结果缺失');const digest=sha(bytes);if(!name.startsWith('figmamcp-result-'+digest.slice(0,24)))fail('Figma MCP 结果名称与摘要不一致');validateFigmaMcpResultBytes(bytes);add('design/assets/'+name,bytes,digest);figmamcpDataHeads.set(name,digest);}
 const figmaPromptHeads=new Map(),figmaPromptTextHeads=new Map(),figmaPromptRecords=new Map();
 for(const name of figmaPromptTextNames){const bytes=legacyStore.readAsset(root,name),digest=bytes&&sha(bytes);if(!bytes||bytes.length>512*1024||!name.startsWith('figmamcp-prompt-'+digest.slice(0,24)))fail('Figma 提示参考文本大小或摘要不一致');let content;try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('Figma 提示参考文本不是 UTF-8');}validateFigmaMcpResultBytes(Buffer.from(JSON.stringify({content})));add('design/assets/'+name,bytes,digest);figmaPromptTextHeads.set(name,digest);}
 for(const item of figmaPromptEntries){const relative='design/.designcraft/figmamcp-prompts/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Figma 提示参考记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Figma 提示参考记录损坏');}if(row){validateFigmaPromptRecord(row);if(row.id!==base)fail('Figma 提示参考身份不一致');const text=legacyStore.readAsset(root,row.textAsset),response=legacyStore.readAsset(root,row.responseAsset);verifyFigmaPromptRecord(row,text,response,validateFigmaMcpResultBytes);if(!figmaPromptTextHeads.has(row.textAsset)||!figmamcpDataHeads.has(row.responseAsset))fail('Figma 提示参考缺少文本或来源响应');const prior=figmaPromptRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma 提示参考记录冲突');if(!item.name.includes('.tmp-'))figmaPromptRecords.set(row.id,row);}else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|fig[dou]_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Figma 未完成提示记录含链接或疑似凭据');add(relative,raw);figmaPromptHeads.set(item.name,sha(raw));}
 const figmamcpFileHeads=new Map(),figmamcpSavedFileHeads=new Map(),figmamcpFileRecords=new Map();
 for(const name of figmamcpFileNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Figma MCP 保留素材缺失');const digest=sha(bytes);if(!name.startsWith('figmamcp-file-'+digest.slice(0,24)))fail('Figma MCP 素材名称与摘要不一致');add('design/assets/'+name,bytes,digest);figmamcpSavedFileHeads.set(name,digest);}
 for(const item of figmamcpFiles){const relative='design/.designcraft/figmamcp-files/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Figma MCP 素材记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Figma MCP 素材记录损坏');}
  if(row){validateFigmaMcpFile(row);if(row.id!==base)fail('Figma MCP 素材身份不一致');const bytes=legacyStore.readAsset(root,row.assetName),response=legacyStore.readAsset(root,row.responseAsset);verifyFigmaMcpFile(row,bytes,response,validateFigmaMcpResultBytes);if(!figmamcpSavedFileHeads.has(row.assetName)||!figmamcpDataHeads.has(row.responseAsset))fail('Figma MCP 素材缺少原件或来源响应');const prior=figmamcpFileRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma MCP 素材来源冲突');if(!item.name.includes('.tmp-'))figmamcpFileRecords.set(row.id,row);}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|fig[dou]_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Figma MCP 未完成素材记录含链接或疑似凭据');add(relative,raw);figmamcpFileHeads.set(item.name,sha(raw));}
 const figmaFileNativeHeads=new Map(),figmaFileOpens=new Map(),figmaFileLinks=new Map();
 for(const item of figmaFileNativeEntries){const relative='design/.designcraft/figmamcp-file-native/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Figma 素材原生记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Figma 素材原生记录损坏');}if(row){if(base.startsWith('figmafileopen-')){validateFigmaFileOpen(row);if(row.id!==base)fail('Figma 素材预约身份不一致');const prior=figmaFileOpens.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma 素材预约冲突');if(!item.name.includes('.tmp-'))figmaFileOpens.set(row.id,row);}else{validateFigmaFileLink(row);if(row.id!==base)fail('Figma 素材关联身份不一致');const prior=figmaFileLinks.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma 素材关联冲突');if(!item.name.includes('.tmp-'))figmaFileLinks.set(row.id,row);}}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|fig[dou]_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Figma 素材未完成原生记录含链接或疑似凭据');add(relative,raw);figmaFileNativeHeads.set(item.name,sha(raw));}
 for(const open of figmaFileOpens.values()){const original=figmamcpFileRecords.get(open.fileId);if(!original||open.mediaKind==='svg'&&original.format!=='svg'||open.mediaKind==='image'&&!['png','jpg'].includes(original.format))fail('Figma 素材预约缺少匹配原件');}
 for(const link of figmaFileLinks.values()){
  const original=figmamcpFileRecords.get(link.fileId),open=figmaFileOpens.get(link.openId),engine=link.mediaKind==='svg'?'vectorcraft':'photocraft';if(!original||!open||open.fileId!==link.fileId||open.mediaKind!==link.mediaKind||original.sha256!==link.sha256||!sources.some(source=>source.id===link.sourceId&&source.engine===engine))fail('Figma 素材原生关联不一致');const source=await store.source(link.sourceId,link.sourceRevision),op=source.meta.operation;if(source.meta.engine!==engine||op?.action!=='resource-import'||op.id!==link.jobId||op.originOperationId!==open.operationId||op.resourceReceiptId!==original.id||op.inputHash!==original.sha256||op.kind!==link.mediaKind)fail('Figma 素材原生保存回执无效');const prefix='sources/'+(link.mediaKind==='svg'?'generated-':'import-')+link.jobId+'/originals/',filename=link.sha256+'.'+original.format;await copyProject(prefix+filename,link.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+link.sha256+'.json',null,16384));if(metadata.sha256!==link.sha256||metadata.file!==filename)fail('Figma 素材导入原件元数据不一致');
 }
 const figmaHtmlHeads=new Map(),figmaHtmlTransfers=new Map();
 for(const item of figmaHtmlEntries){const relative='design/.designcraft/figma-html-transfers/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('Figma 网页转移记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Figma 网页转移记录损坏');}if(row){validateFigmaHtmlTransfer(row);if(row.id!==base||!htmlSources.some(source=>source.id===row.htmlId))fail('Figma 网页转移缺少已保存网页');await verifyFigmaHtmlTransfer(root,row,figmamcpJobRecords.get(row.jobId));const prior=figmaHtmlTransfers.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma 网页转移记录冲突');if(!item.name.includes('.tmp-'))figmaHtmlTransfers.set(row.id,row);}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|fig[dou]_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Figma 网页未完成转移记录含链接或疑似凭据');add(relative,raw);figmaHtmlHeads.set(item.name,sha(raw));}
 const figmaUploadHeads=new Map(),figmaUploadInputHeads=new Map(),figmaUploadRecords=new Map();
 for(const name of figmaUploadInputNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Figma 上传保留原件缺失');const digest=sha(bytes);if(!name.startsWith('figmaupload-input-'+digest.slice(0,24)))fail('Figma 上传原件名称与摘要不一致');add('design/assets/'+name,bytes,digest);figmaUploadInputHeads.set(name,digest);}
 for(const item of figmaUploadEntries){
  const relative='design/.designcraft/figma-uploads/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Figma 上传记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Figma 上传记录损坏');}
  if(row){validateFigmaUpload(row);if(row.id!==base)fail('Figma 上传记录身份不一致');verifyFigmaUploadInput(root,row);if(!figmaUploadInputHeads.has(row.inputAsset))fail('Figma 上传记录缺少实际输入原件');if(!item.name.includes('.tmp-')){if(['prepared','requesting_url','uploading'].includes(row.status))fail('Figma 上传尚未结束或中断后未整理，请先核对记录',423);const prior=figmaUploadRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Figma 上传记录冲突');figmaUploadRecords.set(row.id,row);const portable={...row};delete portable.ownerPid;add(relative,json(portable));}else add(relative,raw);
  }else{if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|fig[dou]_[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Figma 未完成上传记录含链接或疑似凭据');add(relative,raw);}figmaUploadHeads.set(item.name,sha(raw));
 }
 const stitchJobHeads=new Map(),stitchResultHeads=new Map(),stitchAssetHeads=new Map(),stitchDataHeads=new Map(),stitchJobRecords=new Map(),stitchResultRecords=new Map(),stitchResultsByJob=new Map(),stitchAssetRecords=new Map();
 for(const item of stitchJobs.filter(item=>stitchJobName.test(item.name))){
  const relative='design/.designcraft/stitch-jobs/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('Stitch 任务记录无效',422);
  const raw=await readFile(path),job=JSON.parse(raw.toString('utf8'));validateStitchJob(job);if(job.id+'.json'!==item.name)fail('Stitch 任务身份不一致');if(['queued','running'].includes(job.status))fail('Stitch 任务正在执行，请等待或停止后再打包',423);
  if(job.resultAsset){const bytes=legacyStore.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)fail('Stitch 结果缺失或摘要不一致');validateStitchResultBytes(bytes);add('design/assets/'+job.resultAsset,bytes,job.resultSha256);}
  stitchJobHeads.set(item.name,sha(raw));stitchJobRecords.set(job.id,job);delete job.ownerPid;delete job.snapshotId;add(relative,json(job));
 }
 for(const item of stitchJobs.filter(item=>stitchJobTemp.test(item.name))){
  const relative='design/.designcraft/stitch-jobs/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('Stitch 任务候选无效',422);
  const raw=await readFile(path),base=item.name.slice(0,'stitchjob-'.length+64);let job;try{job=JSON.parse(raw.toString('utf8'));}catch{}
  if(job){validateStitchJob(job);const current=stitchJobRecords.get(base);if(job.id!==base||current&&(current.tool!==job.tool||current.requestHash!==job.requestHash||current.inputHash!==job.inputHash||current.schemaSha256!==job.schemaSha256))fail('Stitch 任务候选与来源不一致');if(job.resultAsset){const bytes=legacyStore.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)fail('Stitch 任务候选结果缺失');validateStitchResultBytes(bytes);add('design/assets/'+job.resultAsset,bytes,job.resultSha256);}}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Stitch 未完成任务记录含链接或疑似凭据');
  add(relative,raw);stitchJobHeads.set(item.name,sha(raw));
 }
 for(const item of [...stitchResults.filter(item=>stitchResultName.test(item.name)),...stitchResults.filter(item=>stitchResultTemp.test(item.name))]){
  const relative='design/.designcraft/stitch-results/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Stitch 结果回执无效',422);
  const raw=await readFile(path),base=item.name.slice(0,'stitchresult-'.length+64);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(stitchResultName.test(item.name))fail('Stitch 结果回执损坏');}
  if(row){
   validateStitchResultReceipt(row);const job=stitchJobRecords.get(row.jobId);if(row.id!==base||!job||job.tool!==row.tool||job.requestHash!==row.requestHash||job.inputHash!==row.inputHash||job.schemaSha256!==row.schemaSha256)fail('Stitch 结果回执与任务不一致');
   const bytes=legacyStore.readAsset(root,row.resultAsset);if(!bytes||bytes.length!==row.resultBytes||sha(bytes)!==row.resultSha256)fail('Stitch 结果回执对应的文件缺失');validateStitchResultBytes(bytes);add('design/assets/'+row.resultAsset,bytes,row.resultSha256);
   const prior=stitchResultRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Stitch 结果回执冲突');if(stitchResultName.test(item.name)){stitchResultRecords.set(row.id,row);const group=stitchResultsByJob.get(row.jobId)||[];group.push(row);stitchResultsByJob.set(row.jobId,group);}
  }else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Stitch 未完成结果回执含链接或疑似凭据');
  add(relative,raw);stitchResultHeads.set(item.name,sha(raw));
 }
 for(const job of stitchJobRecords.values())if(job.status==='responded'&&!(stitchResultsByJob.get(job.id)||[]).some(row=>row.resultAsset===job.resultAsset&&row.resultSha256===job.resultSha256&&row.resultBytes===job.resultBytes))fail('Stitch 已返回任务缺少对应结果回执');
 for(const item of [...stitchAssets.filter(item=>stitchAssetName.test(item.name)),...stitchAssets.filter(item=>stitchAssetTemp.test(item.name))]){
  const relative='design/.designcraft/stitch-assets/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Stitch 原件记录无效',422);
  const raw=await readFile(path),base=item.name.slice(0,'stitchasset-'.length+64);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(stitchAssetName.test(item.name))fail('Stitch 原件记录损坏');}
  if(row){validateStitchAsset(row);if(row.id!==base)fail('Stitch 原件身份不一致');if(row.jobId){const job=stitchJobRecords.get(row.jobId);if(!job||job.tool!==row.tool||job.requestHash!==row.requestHash||job.status!=='responded')fail('Stitch 原件与远端任务记录不一致');}const bytes=legacyStore.readAsset(root,row.assetName);verifyStitchAsset(row,bytes);add('design/assets/'+row.assetName,bytes,row.sha256);const prior=stitchAssetRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Stitch 原件回执冲突');if(stitchAssetName.test(item.name))stitchAssetRecords.set(row.id,row);}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Stitch 未完成原件记录含链接或疑似凭据');
  add(relative,raw);stitchAssetHeads.set(item.name,sha(raw));
 }
 const stitchImageHeads=new Map(),stitchImageOpens=new Map(),stitchImageLinks=new Map();
 for(const item of stitchImageEntries){
  const relative='design/.designcraft/stitch-image-imports/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Stitch 图片导入记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Stitch 图片导入记录损坏');}
  if(row){if(base.startsWith('stitchimageopen-')){validateStitchImageOpen(row);if(row.id!==base)fail('Stitch 图片预约身份不一致');const prior=stitchImageOpens.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Stitch 图片预约冲突');if(!item.name.includes('.tmp-'))stitchImageOpens.set(row.id,row);}else{validateStitchImageLink(row);if(row.id!==base)fail('Stitch 图片关联身份不一致');const prior=stitchImageLinks.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('Stitch 图片关联冲突');if(!item.name.includes('.tmp-'))stitchImageLinks.set(row.id,row);}}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('Stitch 图片未完成记录含链接或疑似凭据');add(relative,raw);stitchImageHeads.set(item.name,sha(raw));
 }
 for(const open of stitchImageOpens.values()){const original=stitchAssetRecords.get(open.assetId);if(!original||!['png','jpg'].includes(original.format))fail('Stitch 图片预约缺少对应截图原件');}
 for(const link of stitchImageLinks.values()){
  const original=stitchAssetRecords.get(link.assetId),open=stitchImageOpens.get(link.openId);if(!original||!open||open.assetId!==link.assetId||!['png','jpg'].includes(original.format)||original.sha256!==link.sha256||!sources.some(source=>source.id===link.sourceId&&source.engine==='photocraft'))fail('Stitch 图片原生来源关联不一致');const source=await store.source(link.sourceId,link.sourceRevision),operation=source.meta.operation;if(source.meta.engine!=='photocraft'||operation?.action!=='resource-import'||operation.id!==link.jobId||operation.originOperationId!==open.operationId||operation.resourceReceiptId!==original.id||operation.inputHash!==original.sha256||operation.kind!=='image'||link.sourceId!=='import-'+link.jobId)fail('Stitch 图片原生保存回执无效');const prefix='sources/import-'+link.jobId+'/originals/',filename=link.sha256+'.'+original.format;await copyProject(prefix+filename,link.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+link.sha256+'.json',null,16384));if(metadata.sha256!==link.sha256||metadata.file!==filename)fail('Stitch 截图原件元数据不一致');
 }
 for(const name of stitchDataNames){
  const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Stitch 保留文件缺失');const digest=sha(bytes),kind=name.startsWith('stitch-result-')?'result':'source';if(!name.startsWith('stitch-'+kind+'-'+digest.slice(0,24)))fail('Stitch 保留文件名称与摘要不一致');
  if(kind==='result'){if(!name.endsWith('.json'))fail('Stitch 结果文件类型无效');validateStitchResultBytes(bytes);}
  else if(name.endsWith('.json'))fail('Stitch 原件文件类型无效');
  else if(name.endsWith('.html')&&/(?:Bearer\s+[A-Za-z0-9_.:-]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-[A-Za-z0-9_-]{20,}|\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"][^'"]{12,}|\b(?:access_token|token|signature|x-goog-signature|x-amz-signature|key-pair-id)\s*=)/i.test(bytes.toString('utf8')))fail('Stitch 网页原件包含疑似凭据或签名链接');
  add('design/assets/'+name,bytes,digest);stitchDataHeads.set(name,digest);
 }
 const pixelHeads=new Map(),pixelAssetHeads=new Map(),pixelDataHeads=new Map(),pixelJobs=new Map(),pixelAcceptances=new Map(),pixelByJob=new Map(),pixelAssetRecords=new Map(),pixelOpens=new Map(),pixelLinks=new Map();
 for(const item of pixelEntries.filter(item=>pixelJobName.test(item.name))){
  const relative='design/.designcraft/pixelbin-jobs/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('PixelBin 任务记录无效',422);
  const raw=await readFile(path),job=JSON.parse(raw.toString('utf8'));validatePixelbinJob(job);if(job.id+'.json'!==item.name)fail('PixelBin 任务身份不一致');if(['queued','running'].includes(job.status))fail('PixelBin 任务正在执行，请等待或停止后再打包',423);
  if(job.resultAsset){const bytes=legacyStore.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)fail('PixelBin 结果缺失或摘要不一致');validatePixelbinResultBytes(bytes);add('design/assets/'+job.resultAsset,bytes,job.resultSha256);}
  pixelHeads.set(item.name,sha(raw));pixelJobs.set(job.id,job);delete job.ownerPid;delete job.snapshotId;add(relative,json(job));
 }
 for(const item of pixelEntries.filter(item=>pixelJobTemp.test(item.name))){
  const relative='design/.designcraft/pixelbin-jobs/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('PixelBin 任务候选无效',422);const raw=await readFile(path),base=item.name.slice(0,'pixeljob-'.length+64);let job;try{job=JSON.parse(raw.toString('utf8'));}catch{}
  if(job){validatePixelbinJob(job);const current=pixelJobs.get(base);if(job.id!==base||current&&(current.inputHash!==job.inputHash||current.schemaSha256!==job.schemaSha256||current.estimateHash!==job.estimateHash))fail('PixelBin 任务候选与来源不一致');if(job.resultAsset){const bytes=legacyStore.readAsset(root,job.resultAsset);if(!bytes||bytes.length!==job.resultBytes||sha(bytes)!==job.resultSha256)fail('PixelBin 候选结果缺失');validatePixelbinResultBytes(bytes);add('design/assets/'+job.resultAsset,bytes,job.resultSha256);}}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('PixelBin 未完成任务记录含链接或疑似凭据');add(relative,raw);pixelHeads.set(item.name,sha(raw));
 }
 for(const item of [...pixelEntries.filter(item=>pixelAcceptName.test(item.name)),...pixelEntries.filter(item=>pixelAcceptTemp.test(item.name))]){
  const relative='design/.designcraft/pixelbin-jobs/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('PixelBin 接收回执无效',422);const raw=await readFile(path),base=item.name.slice(0,'pixelaccept-'.length+64);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(pixelAcceptName.test(item.name))fail('PixelBin 接收回执损坏');}
  if(row){validatePixelbinAcceptance(row);const job=pixelJobs.get(row.jobId);if(row.id!==base||!job||job.plugin!==row.plugin||job.operation!==row.operation||job.inputHash!==row.inputHash||job.schemaSha256!==row.schemaSha256||job.estimateHash!==row.estimateHash||job.predictionId&&job.predictionId!==row.predictionId)fail('PixelBin 接收回执与任务不一致');const prior=pixelAcceptances.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('PixelBin 接收回执冲突');if(pixelAcceptName.test(item.name)){pixelAcceptances.set(row.id,row);const group=pixelByJob.get(row.jobId)||[];group.push(row);pixelByJob.set(row.jobId,group);}}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('PixelBin 未完成接收回执含链接或疑似凭据');add(relative,raw);pixelHeads.set(item.name,sha(raw));
 }
 for(const job of pixelJobs.values())if(job.predictionId&&!(pixelByJob.get(job.id)||[]).some(row=>row.predictionId===job.predictionId))fail('PixelBin 已接收任务缺少对应回执');
 for(const item of [...pixelAssets.filter(item=>pixelAssetName.test(item.name)),...pixelAssets.filter(item=>pixelAssetTemp.test(item.name))]){
  const relative='design/.designcraft/pixelbin-assets/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('PixelBin 图片记录无效',422);const raw=await readFile(path),base=item.name.slice(0,'pixelasset-'.length+64);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(pixelAssetName.test(item.name))fail('PixelBin 图片记录损坏');}
  if(row){validatePixelbinAsset(row);if(row.id!==base)fail('PixelBin 图片身份不一致');if(row.jobId){const job=pixelJobs.get(row.jobId);if(!job||job.predictionId!==row.predictionId)fail('PixelBin 图片与任务身份不一致');}const bytes=legacyStore.readAsset(root,row.assetName),response=legacyStore.readAsset(root,row.responseAsset);verifyPixelbinAsset(row,bytes,response);validatePixelbinAssetResponse(row,response);add('design/assets/'+row.assetName,bytes,row.sha256);add('design/assets/'+row.responseAsset,response,row.responseSha256);const prior=pixelAssetRecords.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('PixelBin 图片回执冲突');if(pixelAssetName.test(item.name))pixelAssetRecords.set(row.id,row);}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('PixelBin 未完成图片记录含链接或疑似凭据');add(relative,raw);pixelAssetHeads.set(item.name,sha(raw));
 }
 for(const item of pixelAssets.filter(item=>pixelOpenName.test(item.name)||pixelLinkName.test(item.name)||pixelNativeTemp.test(item.name))){
  const relative='design/.designcraft/pixelbin-assets/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('PixelBin 原生来源记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!pixelNativeTemp.test(item.name))fail('PixelBin 原生来源记录损坏');}
  if(row){if(base.startsWith('pixelopen-'))validatePixelbinOpen(row);else validatePixelbinLink(row);if(row.id!==base)fail('PixelBin 原生来源身份不一致');const target=base.startsWith('pixelopen-')?pixelOpens:pixelLinks,prior=target.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('PixelBin 原生来源回执冲突');if(!pixelNativeTemp.test(item.name))target.set(row.id,row);}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('PixelBin 未完成来源记录含链接或疑似凭据');add(relative,raw);pixelAssetHeads.set(item.name,sha(raw));
 }
 for(const open of pixelOpens.values())if(!pixelAssetRecords.has(open.assetId))fail('PixelBin 原生导入预约缺少图片原件');
 for(const link of pixelLinks.values()){
  const original=pixelAssetRecords.get(link.assetId),open=pixelOpens.get(link.openId);if(!original||!open||open.assetId!==link.assetId||!['png','jpg'].includes(original.format)||original.sha256!==link.sha256||!sources.some(source=>source.id===link.sourceId&&source.engine==='photocraft'))fail('PixelBin 原生来源关联不一致');
  const source=await store.source(link.sourceId,link.sourceRevision),operation=source.meta.operation;if(source.meta.engine!=='photocraft'||operation?.action!=='resource-import'||operation.id!==link.jobId||operation.resourceReceiptId!==original.id||operation.inputHash!==original.sha256||operation.kind!=='image')fail('PixelBin 原生源版本或来源回执无效');
  const prefix='sources/import-'+link.jobId+'/originals/';await copyProject(prefix+link.sha256+'.'+original.format,link.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+link.sha256+'.json',null,16384));if(metadata.sha256!==link.sha256||metadata.file!==link.sha256+'.'+original.format)fail('PixelBin 导入原件元数据不一致');
 }
 for(const name of pixelDataNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('PixelBin 保留文件缺失');const digest=sha(bytes),kind=name.startsWith('pixelbin-result-')?'result':'image';if(!name.startsWith('pixelbin-'+kind+'-'+digest.slice(0,24)))fail('PixelBin 保留文件名称与摘要不一致');if(kind==='result'){if(!name.endsWith('.json'))fail('PixelBin 结果文件类型无效');validatePixelbinResultBytes(bytes);}else if(name.endsWith('.json'))fail('PixelBin 图片文件类型无效');add('design/assets/'+name,bytes,digest);pixelDataHeads.set(name,digest);}
 const pixelOpHeads=new Map(),pixelOps=new Map(),pixelOpReceipts=new Map(),pixelOpByOperation=new Map();
 const retainPixelOp=value=>{
  if(value.sourceAsset){const bytes=legacyStore.readAsset(root,value.sourceAsset);if(!bytes||bytes.length!==value.sourceBytes||sha(bytes)!==value.sourceSha256)fail('PixelBin 上传原件缺失或改变');add('design/assets/'+value.sourceAsset,bytes,value.sourceSha256);}
  if(value.resultAsset){const bytes=legacyStore.readAsset(root,value.resultAsset);if(!bytes||bytes.length!==value.resultBytes||sha(bytes)!==value.resultSha256)fail('PixelBin 操作结果缺失或改变');validatePixelbinResultBytes(bytes);add('design/assets/'+value.resultAsset,bytes,value.resultSha256);}
 };
 for(const item of pixelOpEntries.filter(item=>pixelOpName.test(item.name))){
  const relative='design/.designcraft/pixelbin-operations/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('PixelBin 操作记录无效',422);const raw=await readFile(path),row=JSON.parse(raw.toString('utf8'));validatePixelbinOperation(row);if(row.id+'.json'!==item.name)fail('PixelBin 操作身份不一致');if(['queued','running'].includes(row.status))fail('PixelBin 操作正在执行，请等待或停止后再打包',423);retainPixelOp(row);pixelOpHeads.set(item.name,sha(raw));pixelOps.set(row.id,row);delete row.ownerPid;add(relative,json(row));
 }
 for(const item of pixelOpEntries.filter(item=>pixelOpTemp.test(item.name))){
  const relative='design/.designcraft/pixelbin-operations/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>32768)fail('PixelBin 操作候选无效',422);const raw=await readFile(path),base=item.name.slice(0,'pixelop-'.length+64);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{}
  if(row){validatePixelbinOperation(row);const prior=pixelOps.get(base);if(row.id!==base||prior&&(prior.inputHash!==row.inputHash||prior.schemaSha256!==row.schemaSha256||prior.operation!==row.operation||prior.access!==row.access))fail('PixelBin 操作候选与来源不一致');retainPixelOp(row);}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('PixelBin 未完成操作记录含链接或疑似凭据');add(relative,raw);pixelOpHeads.set(item.name,sha(raw));
 }
 for(const item of [...pixelOpEntries.filter(item=>pixelOpReceiptName.test(item.name)),...pixelOpEntries.filter(item=>pixelOpReceiptTemp.test(item.name))]){
  const relative='design/.designcraft/pixelbin-operations/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('PixelBin 操作回执无效',422);const raw=await readFile(path),base=item.name.slice(0,'pixelopreceipt-'.length+64);let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(pixelOpReceiptName.test(item.name))fail('PixelBin 操作回执损坏');}
  if(row){validatePixelbinOperationReceipt(row);const operation=pixelOps.get(row.operationId);if(row.id!==base||!operation||operation.inputHash!==row.inputHash||operation.access!=='public-read'&&row.publicUrls?.length)fail('PixelBin 操作回执与来源不一致');const bytes=legacyStore.readAsset(root,row.resultAsset);if(!bytes||bytes.length!==row.resultBytes||sha(bytes)!==row.resultSha256)fail('PixelBin 操作回执结果缺失');validatePixelbinResultBytes(bytes);add('design/assets/'+row.resultAsset,bytes,row.resultSha256);const prior=pixelOpReceipts.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('PixelBin 操作回执冲突');if(pixelOpReceiptName.test(item.name)){pixelOpReceipts.set(row.id,row);const group=pixelOpByOperation.get(row.operationId)||[];group.push(row);pixelOpByOperation.set(row.operationId,group);}}
  else if(/(?:https?:\/\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('PixelBin 未完成操作回执含链接或疑似凭据');add(relative,raw);pixelOpHeads.set(item.name,sha(raw));
 }
 for(const operation of pixelOps.values())if(operation.status==='responded'&&!(pixelOpByOperation.get(operation.id)||[]).some(row=>row.resultAsset===operation.resultAsset&&row.resultSha256===operation.resultSha256&&row.resultBytes===operation.resultBytes&&JSON.stringify(row.publicUrls||[])===JSON.stringify(operation.publicUrls||[])))fail('PixelBin 已返回操作缺少对应回执');
 const falHeads=new Map(),falAssetHeads=new Map(),falIds=new Set(),falCurrentRecords=new Map(),falParsedRecords=[];
 const retainFalAsset=row=>{
  const bytes=legacyStore.readAsset(root,row.asset);if(!bytes||bytes.length!==row.bytes||sha(bytes)!==row.sha256)fail('fal 工作流引用的项目素材缺失或改变');
  add('design/assets/'+row.asset,bytes,row.sha256);falAssetHeads.set(row.asset,row.sha256);
 };
 for(const item of falEntries){
  const relative='design/.designcraft/fal-workflows/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)fail('fal 工作流记录无效或超过预算',422);
  const raw=await readFile(path),id=item.name.slice(0,'faljob-'.length+64);falIds.add(id);let job;
  try{job=JSON.parse(raw.toString('utf8'));}catch{if(!falTemporary.test(item.name))fail('fal 工作流记录不是有效 JSON');}
  if(job){
   validateFalWorkflowRecord(job);if(job.id!==id)fail('fal 工作流记录身份不一致');
   if(falCurrent.test(item.name)&&['queued','running'].includes(job.status))fail('fal 工作流正在执行，请等待或停止后再打包',423);
   for(const row of [...job.inputAssets,...job.outputs])retainFalAsset(row);
   for(const upload of job.uploads||[])if(upload.secretAsset){const encrypted=falStorageSecretAsset(root,upload);add('design/assets/'+upload.secretAsset,encrypted,upload.secretSha256);falAssetHeads.set(upload.secretAsset,upload.secretSha256);}
   for(const link of job.remoteLinks||[]){const encrypted=falRemoteSecretAsset(root,link);add('design/assets/'+link.secretAsset,encrypted,link.secretSha256);falAssetHeads.set(link.secretAsset,link.secretSha256);}
   falParsedRecords.push(job);if(falCurrent.test(item.name)){falCurrentRecords.set(job.id,job);delete job.ownerPid;add(relative,json(job));}else add(relative,raw);
  }else{
   const text=raw.toString('utf8').replaceAll('https://api.fal.ai/v1','');
   if(/(?:[a-z][a-z0-9+.-]*:\/\/|data:(?:image|audio|video|application)\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,}|"(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)"\s*:\s*"[^\"]{8,})/i.test(text))fail('未完成的 fal 记录包含未核对的链接或疑似凭据，请先处理后打包');
   add(relative,raw);
  }
  falHeads.set(item.name,sha(raw));
 }
 for(const job of falParsedRecords)for(const ref of job.remoteInputRefs||[]){const source=falCurrentRecords.get(ref.jobId),link=source?.remoteLinks?.find(item=>item.pointer===ref.outputPointer);if(!source||source.status!=='ready'||source.remote?.state!=='response_received'||source.provider!==job.provider||source.connection!==job.connection||source.resultSha256!==ref.resultSha256||!link||link.secretSha256!==ref.secretSha256)fail('fal 远端输入缺少对应的已保存输出来源');}
 const falOutputPrefixes=[...falIds].map(id=>'fal-'+id.slice(7,19)+'-');
 const falOutputNames=legacyStore.listAssets(root).filter(item=>falOutputPrefixes.some(prefix=>item.name.startsWith(prefix))).map(item=>item.name).sort();
 if(falOutputNames.length>2000)fail('fal 工作流保留素材超过预算',413);
 for(const name of falOutputNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('fal 工作流保留素材缺失');const digest=sha(bytes);add('design/assets/'+name,bytes,digest);falAssetHeads.set(name,digest);}
 for(const name of falStorageAssetNames){const bytes=legacyStore.readAsset(root,name),digest=bytes&&sha(bytes),prefix=name.startsWith('falstore-input-')?'falstore-input-':'falstore-secret-';if(!bytes||!name.startsWith(prefix+digest.slice(0,24))||prefix==='falstore-secret-'&&bytes.length>16384)fail('fal 存储保留素材摘要或大小不一致');add('design/assets/'+name,bytes,digest);falAssetHeads.set(name,digest);}
 for(const name of falRemoteSecretNames){const bytes=legacyStore.readAsset(root,name),digest=bytes&&sha(bytes);if(!bytes||bytes.length>16384||!name.startsWith('falremote-secret-'+digest.slice(0,24)))fail('fal 远端输出加密引用摘要或大小不一致');add('design/assets/'+name,bytes,digest);falAssetHeads.set(name,digest);}
 const veniceHeads=new Map(),veniceAssetHeads=new Map(),veniceRecords=new Map(),veniceIds=new Set();
 for(const item of veniceEntries.filter(item=>veniceCurrent.test(item.name))){
  const relative='design/.designcraft/venice-audio/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)fail('Venice 音频记录无效',422);
  const raw=await readFile(path),job=JSON.parse(raw.toString('utf8'));validateVeniceAudioRecord(job);if(job.id+'.json'!==item.name)fail('Venice 音频记录身份不一致');if(['queued','running'].includes(job.status))fail('Venice 音频任务正在执行，请等待或停止后再打包',423);
  if(job.audio){const bytes=legacyStore.readAsset(root,job.audio.asset);if(!bytes||bytes.length!==job.audio.bytes||sha(bytes)!==job.audio.sha256)fail('Venice 音频素材缺失或改变');add('design/assets/'+job.audio.asset,bytes,job.audio.sha256);veniceAssetHeads.set(job.audio.asset,job.audio.sha256);}
  veniceHeads.set(item.name,sha(raw));veniceRecords.set(job.id,job);veniceIds.add(job.id);delete job.ownerPid;add(relative,json(job));
 }
 for(const item of veniceEntries.filter(item=>!veniceCurrent.test(item.name))){
  const relative='design/.designcraft/venice-audio/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)fail('Venice 音频候选记录无效',422);
  const raw=await readFile(path),id=item.name.slice(0,'veniceaudio-'.length+64),current=veniceRecords.get(id);if(!current)fail('Venice 音频候选缺少原任务记录');let value;
  try{value=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Venice 音频来源记录损坏');}
  if(value){
   if(veniceTemporary.test(item.name)){validateVeniceAudioRecord(value);if(value.id!==id||value.inputHash!==current.inputHash||value.connection!==current.connection)fail('Venice 音频候选与原任务不一致');if(value.audio){const bytes=legacyStore.readAsset(root,value.audio.asset);if(!bytes||bytes.length!==value.audio.bytes||sha(bytes)!==value.audio.sha256)fail('Venice 音频候选素材缺失');add('design/assets/'+value.audio.asset,bytes,value.audio.sha256);veniceAssetHeads.set(value.audio.asset,value.audio.sha256);}}
   else{assertSafeJson(value);if(value.schema!==1||value.id!==id||value.model!==current.model||value.inputHash!==current.inputHash||value.connection!==current.connection||!/^[a-f0-9-]{36}$/.test(value.queueId||'')||value.modelMismatch!==undefined&&typeof value.modelMismatch!=='boolean'||Object.keys(value).some(key=>!['schema','id','model','inputHash','connection','queueId','modelMismatch'].includes(key))||!item.name.startsWith(id+'.accepted-'+value.queueId+'.json'))fail('Venice 音频接收回执无效');}
  }else{
   const text=raw.toString('utf8').replaceAll('https://api.venice.ai/api/v1','');if(/(?:[a-z][a-z0-9+.-]*:\/\/|data:(?:image|audio|video|application)\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(text))fail('Venice 未完成记录包含未核对的链接或疑似凭据');
  }
  add(relative,raw);veniceHeads.set(item.name,sha(raw));
 }
 const venicePrefixes=[...veniceIds].map(id=>'venice-audio-'+id.slice(12,24)+'-'),veniceOutputNames=legacyStore.listAssets(root).filter(item=>venicePrefixes.some(prefix=>item.name.startsWith(prefix))).map(item=>item.name).sort();
 if(veniceOutputNames.length>2000)fail('Venice 音频保留素材超过预算',413);for(const name of veniceOutputNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Venice 音频保留素材缺失');const digest=sha(bytes);add('design/assets/'+name,bytes,digest);veniceAssetHeads.set(name,digest);}
 const videoHeads=new Map(),videoAssetHeads=new Map(),videoRecords=new Map(),videoIds=new Set();
 const retainVideoAsset=item=>{if(!item)return;const bytes=legacyStore.readAsset(root,item.asset);if(!bytes||bytes.length!==item.bytes||sha(bytes)!==item.sha256)fail('Venice 视频相关素材缺失或改变');add('design/assets/'+item.asset,bytes,item.sha256);videoAssetHeads.set(item.asset,item.sha256);};
 for(const item of videoEntries.filter(item=>videoCurrent.test(item.name))){
  const relative='design/.designcraft/venice-video/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)fail('Venice 视频记录无效',422);
  const raw=await readFile(path),job=JSON.parse(raw.toString('utf8'));validateVeniceVideoRecord(job);if(job.id+'.json'!==item.name)fail('Venice 视频记录身份不一致');if(['queued','running'].includes(job.status))fail('Venice 视频任务正在执行，请等待或停止后再打包',423);
  if(job.remote.privateLink===true&&job.status!=='ready')fail('该 Venice 视频依赖本机私有链接，请先取回视频再打包；私有链接不会进入项目包',409);
  retainVideoAsset(job.inputAsset);retainVideoAsset(job.video);videoHeads.set(item.name,sha(raw));videoRecords.set(job.id,job);videoIds.add(job.id);delete job.ownerPid;add(relative,json(job));
 }
 for(const item of videoEntries.filter(item=>!videoCurrent.test(item.name))){
  const relative='design/.designcraft/venice-video/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)fail('Venice 视频候选记录无效',422);
  const raw=await readFile(path),id=item.name.slice(0,'venicevideo-'.length+64),current=videoRecords.get(id);if(!current)fail('Venice 视频候选缺少原任务记录');let value;
  try{value=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Venice 视频来源记录损坏');}
  if(value){
   if(videoTemporary.test(item.name)){validateVeniceVideoRecord(value);if(value.id!==id||value.inputHash!==current.inputHash||value.connection!==current.connection)fail('Venice 视频候选与原任务不一致');if(value.remote.privateLink===true&&(current.status!=='ready'||current.remote.queueId!==value.remote.queueId))fail('Venice 视频候选仍依赖本机私有链接，请先取回后打包');retainVideoAsset(value.inputAsset);retainVideoAsset(value.video);}
   else{assertSafeJson(value);if(value.schema!==1||value.id!==id||value.model!==current.model||value.inputHash!==current.inputHash||value.connection!==current.connection||!/^[a-f0-9-]{36}$/.test(value.queueId||'')||typeof value.privateLink!=='boolean'||value.modelMismatch!==undefined&&typeof value.modelMismatch!=='boolean'||Object.keys(value).some(key=>!['schema','id','model','inputHash','connection','queueId','privateLink','modelMismatch'].includes(key))||!item.name.startsWith(id+'.accepted-'+value.queueId+'.json'))fail('Venice 视频接收回执无效');if(value.privateLink&&(current.status!=='ready'||current.remote.queueId!==value.queueId))fail('Venice 视频回执仍依赖本机私有链接，请先取回后打包');}
  }else{const text=raw.toString('utf8').replaceAll('https://api.venice.ai/api/v1','');if(/(?:[a-z][a-z0-9+.-]*:\/\/|data:(?:image|audio|video|application)\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]{20,})/i.test(text))fail('Venice 视频未完成记录包含未核对的链接或疑似凭据');}
  add(relative,raw);videoHeads.set(item.name,sha(raw));
 }
 const videoPrefixes=[...videoIds].map(id=>'venice-video-'+id.slice(12,24)+'-'),videoOutputNames=legacyStore.listAssets(root).filter(item=>videoPrefixes.some(prefix=>item.name.startsWith(prefix))).map(item=>item.name).sort();
 if(videoOutputNames.length>2000)fail('Venice 视频保留素材超过预算',413);for(const name of videoOutputNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Venice 视频保留素材缺失');const digest=sha(bytes);add('design/assets/'+name,bytes,digest);videoAssetHeads.set(name,digest);}
 const figmaHeads=new Map(),figmaAssetHeads=new Map(),figmaExports=new Map(),figmaOpens=new Map(),figmaLinks=new Map();
 for(const item of figmaEntries){
  const relative='design/.designcraft/figma-sources/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('Figma 来源记录无效或超过预算',422);
  const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/, '');let value;
  try{value=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Figma 来源记录损坏');}
  if(value){
   if(base.startsWith('figmaexport-')){validateFigmaExport(value);if(value.id!==base)fail('Figma 导出身份不一致');const bytes=legacyStore.readAsset(root,value.assetName);validateFigmaAsset(value,bytes);add('design/assets/'+value.assetName,bytes,value.sha256);figmaAssetHeads.set(value.assetName,value.sha256);if(figmaExports.has(value.id)&&JSON.stringify(figmaExports.get(value.id))!==JSON.stringify(value))fail('Figma 导出回执冲突');figmaExports.set(value.id,value);}
   else if(base.startsWith('figmaopen-')){validateFigmaOpen(value);if(value.id!==base)fail('Figma 导入预约身份不一致');if(figmaOpens.has(value.id)&&JSON.stringify(figmaOpens.get(value.id))!==JSON.stringify(value))fail('Figma 导入预约冲突');figmaOpens.set(value.id,value);}
   else{validateFigmaLink(value);if(value.id!==base)fail('Figma 导入关联身份不一致');if(figmaLinks.has(value.id)&&JSON.stringify(figmaLinks.get(value.id))!==JSON.stringify(value))fail('Figma 导入关联冲突');figmaLinks.set(value.id,value);}
  }else{const text=raw.toString('utf8');if(/(?:[a-z][a-z0-9+.-]*:\/\/|data:(?:image|audio|video|application)\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|figd_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{20,})/i.test(text))fail('Figma 未完成记录包含未核对的链接或疑似凭据');}
  add(relative,raw);figmaHeads.set(item.name,sha(raw));
 }
 for(const open of figmaOpens.values())if(!figmaExports.has(open.exportId))fail('Figma 导入预约缺少原始导出');
 for(const source of pendingFigmaPlanRefs){const saved=figmaExports.get(source.resourceId);if(!saved||['fileKey','nodeId','version','format','sha256'].some(key=>saved[key]!==source[key]))fail('设计计划引用的 Figma 原件或来源记录缺失');}
 for(const link of figmaLinks.values()){
  const original=figmaExports.get(link.exportId),open=figmaOpens.get(link.openId);if(!original||!open||open.exportId!==link.exportId||original.sha256!==link.sha256)fail('Figma 原生来源关联不一致');
  const kind=original.format==='png'?'image':'svg',engine=kind==='image'?'photocraft':'vectorcraft';if(!sources.some(source=>source.id===link.sourceId&&source.engine===engine)||kind==='image'&&link.sourceId!=='import-'+link.jobId)fail('Figma 原生源与格式不一致');
  const source=await store.source(link.sourceId,link.sourceRevision),operation=source.meta.operation;if(source.meta.engine!==engine||operation?.action!=='resource-import'||operation.id!==link.jobId||operation.resourceReceiptId!==original.id||operation.inputHash!==original.sha256||operation.kind!==kind)fail('Figma 关联的原生源版本或来源回执无效');
  const prefix='sources/'+(kind==='image'?'import-':'generated-')+link.jobId+'/originals/',filename=link.sha256+'.'+original.format;await copyProject(prefix+filename,link.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+link.sha256+'.json',null,16384));if(metadata.sha256!==link.sha256||metadata.file!==filename)fail('Figma 导入原件元数据不一致');
 }
 for(const name of figmaAssetNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Figma 保留原件缺失');const digest=sha(bytes);if(!name.startsWith('figma-'+digest.slice(0,24)))fail('Figma 保留原件名称与摘要不符');add('design/assets/'+name,bytes,digest);figmaAssetHeads.set(name,digest);}
 const replicateHeads=new Map(),replicateAssetHeads=new Map(),replicateRecords=new Map(),replicateIds=new Set();
 const retainReplicateAsset=item=>{const bytes=legacyStore.readAsset(root,item.asset);if(!bytes||bytes.length!==item.bytes||sha(bytes)!==item.sha256)fail('Replicate 工作流素材缺失或改变');add('design/assets/'+item.asset,bytes,item.sha256);replicateAssetHeads.set(item.asset,item.sha256);};
 const retainReplicateUploads=job=>{for(const upload of job.uploads||[]){if(!upload.secretAsset)continue;const bytes=legacyStore.readAsset(root,upload.secretAsset);if(!bytes||bytes.length!==upload.secretBytes||sha(bytes)!==upload.secretSha256)fail('Replicate 加密上传身份缺失或改变');add('design/assets/'+upload.secretAsset,bytes,upload.secretSha256);replicateAssetHeads.set(upload.secretAsset,upload.secretSha256);}};
 for(const item of replicateEntries.filter(item=>replicateCurrent.test(item.name))){
  const relative='design/.designcraft/replicate-workflows/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)fail('Replicate 任务记录无效',422);
  const raw=await readFile(path),job=JSON.parse(raw.toString('utf8'));validateReplicateRecord(job);if(job.id+'.json'!==item.name)fail('Replicate 任务身份不一致');if(['queued','running'].includes(job.status))fail('Replicate 任务正在执行，请等待或停止后再打包',423);
  for(const asset of [...job.inputAssets,...job.outputs])retainReplicateAsset(asset);retainReplicateUploads(job);replicateHeads.set(item.name,sha(raw));replicateRecords.set(job.id,job);replicateIds.add(job.id);delete job.ownerPid;add(relative,json(job));
 }
 for(const item of replicateEntries.filter(item=>!replicateCurrent.test(item.name))){
  const relative='design/.designcraft/replicate-workflows/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)fail('Replicate 候选记录无效',422);
  const raw=await readFile(path),id=item.name.slice(0,'replicatejob-'.length+64),current=replicateRecords.get(id);if(!current)fail('Replicate 候选缺少原任务记录');let value;
  try{value=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('Replicate 来源记录损坏');}
  if(value){
   if(replicateTemporary.test(item.name)){validateReplicateRecord(value);if(value.id!==id||value.inputHash!==current.inputHash||value.model!==current.model||value.version!==current.version||value.route!==current.route||value.schemaVersion!==current.schemaVersion)fail('Replicate 候选与原任务不一致');for(const asset of [...value.inputAssets,...value.outputs])retainReplicateAsset(asset);retainReplicateUploads(value);}
   else{assertSafeJson(value);if(value.schema!==1||value.id!==id||value.model!==current.model||value.version!==current.version||value.inputHash!==current.inputHash||!/^[a-z0-9][a-z0-9-]{7,99}$/.test(value.predictionId||'')||value.modelMismatch!==undefined&&typeof value.modelMismatch!=='boolean'||value.observedVersion!==undefined&&(current.route!=='official'||value.observedVersion!=='hidden'&&!/^[a-f0-9]{64}$/.test(value.observedVersion))||current.route==='official'&&current.schemaVersion&&/^[a-f0-9]{64}$/.test(value.observedVersion||'')&&current.schemaVersion!==value.observedVersion&&value.modelMismatch!==true||Object.keys(value).some(key=>!['schema','id','model','version','inputHash','predictionId','modelMismatch','observedVersion'].includes(key))||!item.name.startsWith(id+'.accepted-'+value.predictionId+'.json'))fail('Replicate 接收回执无效');}
  }else{const text=raw.toString('utf8');if(/(?:[a-z][a-z0-9+.-]*:\/\/|data:(?:image|audio|video|application)\/|(?:Bearer\s+|Token\s+)[A-Za-z0-9_.:-]{12,}|r8_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{20,})/i.test(text))fail('Replicate 未完成记录包含未核对的链接或疑似凭据');}
  add(relative,raw);replicateHeads.set(item.name,sha(raw));
 }
 const replicatePrefixes=[...replicateIds].map(id=>'replicate-'+id.slice(13,25)+'-'),replicateOutputNames=legacyStore.listAssets(root).filter(item=>replicatePrefixes.some(prefix=>item.name.startsWith(prefix))).map(item=>item.name).sort();
 if(replicateOutputNames.length>2000)fail('Replicate 保留素材超过预算',413);for(const name of replicateOutputNames){const bytes=legacyStore.readAsset(root,name);if(!bytes)fail('Replicate 保留素材缺失');const digest=sha(bytes);add('design/assets/'+name,bytes,digest);replicateAssetHeads.set(name,digest);}
 const workflowImageHeads=new Map(),workflowImages=new Map(),workflowImageOpens=new Map(),workflowImageLinks=new Map();
 for(const item of workflowImageEntries){
  const relative='design/.designcraft/workflow-images/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)fail('工作流图片来源记录无效',422);const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/,'');let row;try{row=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('工作流图片来源记录损坏');}
  if(row){if(base.startsWith('workflowimage-')){validateWorkflowImage(row);if(row.id!==base)fail('工作流图片来源身份不一致');const checked=await verifyWorkflowImage(root,row);add('design/assets/'+row.assetName,checked.bytes,row.sha256);const prior=workflowImages.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('工作流图片来源冲突');if(!item.name.includes('.tmp-'))workflowImages.set(row.id,row);}
   else if(base.startsWith('workflowimageopen-')){validateWorkflowImageOpen(row);if(row.id!==base)fail('工作流图片预约身份不一致');const prior=workflowImageOpens.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('工作流图片预约冲突');if(!item.name.includes('.tmp-'))workflowImageOpens.set(row.id,row);}
   else{validateWorkflowImageLink(row);if(row.id!==base)fail('工作流图片关联身份不一致');const prior=workflowImageLinks.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))fail('工作流图片关联冲突');if(!item.name.includes('.tmp-'))workflowImageLinks.set(row.id,row);}
  }else if(/(?:https?:\/\/|Bearer\s+[A-Za-z0-9_.:-]{12,}|r8_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{20,})/i.test(raw.toString('utf8')))fail('工作流未完成图片记录含链接或疑似凭据');add(relative,raw);workflowImageHeads.set(item.name,sha(raw));
 }
 for(const open of workflowImageOpens.values())if(!workflowImages.has(open.imageId))fail('工作流图片预约缺少对应原件');
 for(const link of workflowImageLinks.values()){
  const original=workflowImages.get(link.imageId),open=workflowImageOpens.get(link.openId);if(!original||!open||open.imageId!==link.imageId||original.sha256!==link.sha256||!sources.some(source=>source.id===link.sourceId&&source.engine==='photocraft'))fail('工作流图片原生来源关联不一致');const source=await store.source(link.sourceId,link.sourceRevision),operation=source.meta.operation;if(source.meta.engine!=='photocraft'||operation?.action!=='resource-import'||operation.id!==link.jobId||operation.resourceReceiptId!==original.id||operation.inputHash!==original.sha256||operation.kind!=='image'||link.sourceId!=='import-'+link.jobId)fail('工作流图片原生保存回执无效');const prefix='sources/import-'+link.jobId+'/originals/',filename=link.sha256+'.'+original.format;await copyProject(prefix+filename,link.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+link.sha256+'.json',null,16384));if(metadata.sha256!==link.sha256||metadata.file!==filename)fail('工作流图片原件元数据不一致');
 }
 const svgHeads=new Map(),svgAssetHeads=new Map(),svgJobs=new Map(),svgJobCandidates=[],svgResults=new Map(),svgPublishedResults=new Set(),svgOpens=new Map(),svgLinks=new Map();
 for(const item of svgEntries){
  const relative='design/.designcraft/openai-svg/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)fail('OpenAI SVG 记录无效或超过预算',422);
  const raw=await readFile(path),base=item.name.replace(/\.json(?:\.tmp-[a-f0-9-]{36})?$/, '');let value;try{value=JSON.parse(raw.toString('utf8'));}catch{if(!item.name.includes('.tmp-'))fail('OpenAI SVG 记录损坏');}
  if(value){
   if(base.startsWith('openaisvgjob-')){validateOpenAiSvgJob(value);if(value.id!==base)fail('OpenAI SVG 任务身份不一致');if(item.name.includes('.tmp-'))svgJobCandidates.push(value);else{if(['queued','running'].includes(value.status))fail('OpenAI SVG 任务正在执行，请等待或停止后再打包',423);svgJobs.set(value.id,value);}}
   else if(base.startsWith('openaisvgresult-')){validateOpenAiSvgResult(value);if(value.id!==base)fail('OpenAI SVG 结果身份不一致');if(svgResults.has(value.id)&&JSON.stringify(svgResults.get(value.id))!==JSON.stringify(value))fail('OpenAI SVG 结果回执冲突');svgResults.set(value.id,value);if(!item.name.includes('.tmp-'))svgPublishedResults.add(value.id);}
   else if(base.startsWith('openaisvgopen-')){validateOpenAiSvgOpen(value);if(value.id!==base)fail('OpenAI SVG 导入预约身份不一致');if(svgOpens.has(value.id)&&JSON.stringify(svgOpens.get(value.id))!==JSON.stringify(value))fail('OpenAI SVG 导入预约冲突');svgOpens.set(value.id,value);}
   else{validateOpenAiSvgLink(value);if(value.id!==base)fail('OpenAI SVG 导入关联身份不一致');if(svgLinks.has(value.id)&&JSON.stringify(svgLinks.get(value.id))!==JSON.stringify(value))fail('OpenAI SVG 导入关联冲突');svgLinks.set(value.id,value);}
  }else{const text=raw.toString('utf8').replaceAll('https://api.openai.com/v1','');if(/(?:[a-z][a-z0-9+.-]*:\/\/|data:(?:image|audio|video|application)\/|(?:Bearer\s+|Key\s+)[A-Za-z0-9_.:-]{12,}|sk-[A-Za-z0-9_-]+)/i.test(text))fail('OpenAI SVG 未完成记录包含未核对的链接或疑似凭据');}
  if(value&&base.startsWith('openaisvgjob-')&&!item.name.includes('.tmp-')){const {ownerPid,...portable}=value;add(relative,json(portable));}else add(relative,raw);svgHeads.set(item.name,sha(raw));
 }
 for(const candidate of svgJobCandidates){const current=svgJobs.get(candidate.id);if(!current||['provider','connection','model','promptHash','inputHash'].some(key=>candidate[key]!==current[key]))fail('OpenAI SVG 临时任务与原任务身份不一致');if(candidate.asset){const bytes=legacyStore.readAsset(root,candidate.asset.name);validateOpenAiSvgAsset(candidate.asset,bytes);add('design/assets/'+candidate.asset.name,bytes,candidate.asset.sha256);svgAssetHeads.set(candidate.asset.name,candidate.asset.sha256);}}
 for(const result of svgResults.values()){const job=svgJobs.get(result.jobId),bytes=legacyStore.readAsset(root,result.asset.name);if(!job||job.model!==result.model||job.inputHash!==result.inputHash)fail('OpenAI SVG 结果缺少匹配任务');validateOpenAiSvgAsset(result.asset,bytes);add('design/assets/'+result.asset.name,bytes,result.asset.sha256);svgAssetHeads.set(result.asset.name,result.asset.sha256);}
 for(const job of svgJobs.values())if(job.status==='ready'){const result=svgResults.get(job.resultId);if(!result||!svgPublishedResults.has(result.id)||JSON.stringify(result.asset)!==JSON.stringify(job.asset))fail('OpenAI SVG 已完成任务缺少已发布结果回执');}
 for(const open of svgOpens.values())if(!svgJobs.has(open.jobId))fail('OpenAI SVG 导入预约缺少生成任务');
 for(const link of svgLinks.values()){
  const job=svgJobs.get(link.svgJobId),open=svgOpens.get(link.openId);if(!job||job.status!=='ready'||!open||open.jobId!==job.id||job.asset.sha256!==link.sha256||!sources.some(source=>source.id===link.sourceId&&source.engine==='vectorcraft'))fail('OpenAI SVG 原生来源关联不一致');
  const source=await store.source(link.sourceId,link.sourceRevision),operation=source.meta.operation;if(source.meta.engine!=='vectorcraft'||operation?.action!=='resource-import'||operation.id!==link.jobId||operation.resourceReceiptId!==job.id||operation.inputHash!==job.asset.sha256||operation.kind!=='svg')fail('OpenAI SVG 原生保存回执无效');
  const prefix='sources/generated-'+link.jobId+'/originals/';await copyProject(prefix+link.sha256+'.svg',link.sha256,8*1024*1024);const metadata=JSON.parse(await copyProject(prefix+link.sha256+'.json',null,16384));if(metadata.sha256!==link.sha256||metadata.file!==link.sha256+'.svg')fail('OpenAI SVG 导入原件元数据不一致');
 }
 for(const name of svgAssetNames){const bytes=legacyStore.readAsset(root,name),match=svgAssetPattern.exec(name);if(!bytes||!match)fail('OpenAI SVG 保留原件缺失');const digest=sha(bytes);if(!digest.startsWith(match[2]))fail('OpenAI SVG 保留原件摘要不符');add('design/assets/'+name,bytes,digest);svgAssetHeads.set(name,digest);}
 const adoptionDir=workspacePath(root,'design/.designcraft/image-adoptions'),adoptions=(await directories(adoptionDir)).filter(item=>item.name.endsWith('.json')),adoptionHeads=new Map(),adoptionLineages=new Map();
 if(adoptions.length>10000||adoptions.some(item=>!item.isFile()))fail('图片采用记录无效或超过预算',413);
 for(const item of adoptions){
  const relative='design/.designcraft/image-adoptions/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>8192)fail('图片采用记录无效',422);
  const raw=await readFile(path),receipt=JSON.parse(raw.toString('utf8'));assertSafeJson(receipt);
  const candidate=imageRecords.get(receipt.jobId)?.candidates.find(row=>row.id===receipt.candidateId);
  const expectedName='adoption-'+sha(Buffer.from(JSON.stringify([receipt.jobId,receipt.candidateId,receipt.sourceId,receipt.sourceRevision])))+'.json';
  if(receipt.schema!==1||!candidate||receipt.sourceHash!==candidate.sourceHash||!hex.test(receipt.sourceHash||'')||item.name!==expectedName||!sources.some(source=>source.id===receipt.sourceId&&source.engine==='photocraft'))fail('图片采用记录与候选或作品不一致');
  if(!adoptionLineages.has(receipt.sourceId))adoptionLineages.set(receipt.sourceId,await store.lineage(receipt.sourceId));
  const version=adoptionLineages.get(receipt.sourceId).find(row=>row.revision===receipt.sourceRevision);if(!version)fail('图片采用缺少对应原生源版本');
  const op=version.meta.operation,inPlace=op?.action==='image-adopt'&&op.imageJobId===receipt.jobId&&op.candidateId===receipt.candidateId&&op.sourceHash===receipt.sourceHash;
  if(inPlace){const adopted=await store.read(receipt.sourceId,receipt.sourceRevision),original=legacyStore.readAsset(root,candidate.native.source);assertPhotoCandidateOnly(original,adopted.bytes);}
  else{const original=workspacePath(root,join(store.directory(receipt.sourceId),'originals',receipt.sourceHash+'.pcraft'),{mustExist:true});if(sha(await readFile(original))!==receipt.sourceHash)fail('图片采用原件与候选不一致');}
  add(relative,raw);adoptionHeads.set(item.name,sha(raw));
 }
 const currentHeads=sources.map(s=>s.id+'@'+s.revision).sort();
 const htmlHeads=htmlSources.map(s=>s.id+'@'+s.revision).sort();
 for(const source of sources){
  const lineage=await store.lineage(source.id);
  if(lineage.at(-1)?.revision!==source.revision)fail('打包时作品已改变，请重新导出');
  const start='sources/'+source.id+'/',first=JSON.parse(await copyProject(start+'root.json',null,1024));
  if(first.revision!==lineage[0].revision)fail('源版本链不一致');
  let previous=null;
  for(const {meta,revision} of lineage){
   if(!previous&&meta.operation?.action==='resource-import'&&/^stockimage-[a-f0-9]{64}$/.test(meta.operation.resourceReceiptId||'')){const original=stockImages.get(meta.operation.resourceReceiptId),op=meta.operation;if(!original||meta.engine!=='photocraft'||op.kind!=='image'||op.inputHash!==original.sha256||source.id!=='import-'+op.id||![...stockOpens.values()].some(open=>open.imageId===original.id&&open.operationId===op.originOperationId))fail('在线图库原生源缺少匹配原件或预约');const prefix='sources/'+source.id+'/originals/',filename=original.sha256+'.'+original.format;await copyProject(prefix+filename,original.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+original.sha256+'.json',null,16384));if(metadata.sha256!==original.sha256||metadata.file!==filename||metadata.bytes!==original.bytes)fail('在线图库图片原件元数据不一致');}
   if(!previous&&meta.operation?.action==='resource-import'&&/^stitchasset-[a-f0-9]{64}$/.test(meta.operation.resourceReceiptId||'')){const original=stitchAssetRecords.get(meta.operation.resourceReceiptId),operation=meta.operation;if(!original||!['png','jpg'].includes(original.format)||meta.engine!=='photocraft'||operation.kind!=='image'||operation.inputHash!==original.sha256||source.id!=='import-'+operation.id||![...stitchImageOpens.values()].some(open=>open.assetId===original.id&&open.operationId===operation.originOperationId))fail('Stitch 图片源缺少匹配原件或导入预约');const prefix='sources/'+source.id+'/originals/',filename=original.sha256+'.'+original.format;await copyProject(prefix+filename,original.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+original.sha256+'.json',null,16384));if(metadata.sha256!==original.sha256||metadata.file!==filename)fail('Stitch 图片源原件元数据不一致');}
   if(!previous&&meta.operation?.action==='resource-import'&&/^figmamcpfile-[a-f0-9]{64}$/.test(meta.operation.resourceReceiptId||'')){const original=figmamcpFileRecords.get(meta.operation.resourceReceiptId),op=meta.operation,kind=op.kind,engine=kind==='svg'?'vectorcraft':'photocraft';if(!original||!['svg','image'].includes(kind)||kind==='svg'&&original.format!=='svg'||kind==='image'&&!['png','jpg'].includes(original.format)||meta.engine!==engine||op.inputHash!==original.sha256||kind==='image'&&source.id!=='import-'+op.id||![...figmaFileOpens.values()].some(open=>open.fileId===original.id&&open.mediaKind===kind&&open.operationId===op.originOperationId))fail('Figma 素材原生源缺少匹配原件或预约');const prefix='sources/'+(kind==='svg'?'generated-':'import-')+op.id+'/originals/',filename=original.sha256+'.'+original.format;await copyProject(prefix+filename,original.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+original.sha256+'.json',null,16384));if(metadata.sha256!==original.sha256||metadata.file!==filename)fail('Figma 素材原生源原件元数据不一致');}
   if(!previous&&meta.operation?.action==='resource-import'&&/^falrtimage-[a-f0-9]{64}$/.test(meta.operation.resourceReceiptId||'')){const original=falRtImages.get(meta.operation.resourceReceiptId),op=meta.operation;if(!original||meta.engine!=='photocraft'||op.kind!=='image'||op.inputHash!==original.sha256||source.id!=='import-'+op.id||![...falRtOpens.values()].some(open=>open.imageId===original.id&&open.operationId===op.originOperationId))fail('fal 实时原生源缺少匹配原件或预约');const prefix='sources/'+source.id+'/originals/',filename=original.sha256+'.'+original.format;await copyProject(prefix+filename,original.sha256,16*1024*1024);const metadata=JSON.parse(await copyProject(prefix+original.sha256+'.json',null,16384));if(metadata.sha256!==original.sha256||metadata.file!==filename)fail('fal 实时原生源原件元数据不一致');}
   if(previous&&JSON.parse(await copyProject(start+'next/'+previous+'.json',null,1024)).revision!==revision)fail('版本指针不一致');
   await copyProject(start+'history/'+revision+'.json',revision,1024*1024);
   const ext=engineExtensions[meta.engine];if(!ext||!hex.test(meta.sourceHash))fail('原生源格式无效');
   const name=start+'versions/'+meta.sourceHash+'.'+ext;
   if(!records.has(rootPrefix+'/'+name)){
    const data=await copyProject(name,meta.sourceHash);
    if(data.length!==meta.bytes)fail('原生源字节长度不一致');
    nativeDependencies(data,meta.engine,fonts);
   }
   engines.add(meta.engine);previous=revision;
  }
 }
 let includesOpenDesignHtml=false;const odHtmlSnapshotHeads=new Map();
 for(const source of htmlSources){
  const lineage=await htmlStore.lineage(source.id);
  if(lineage.at(-1)?.revision!==source.revision)fail('打包时网页源已改变，请重新导出');
  const start='html/'+source.id+'/',first=JSON.parse(await copyProject(start+'root.json',null,1024));
  if(first.revision!==lineage[0].revision)fail('网页版本链不一致');
  let previous=null,previousValue=null;const initialProvenance=lineage[0].value.provenance;
  for(const {revision,value} of lineage){
   if(value.provenance?.source==='opendesign'&&value.provenance.selectionVersion!==3)includesOpenDesignHtml=true;
   if(initialProvenance?.source==='opendesign'&&[2,3].includes(initialProvenance.selectionVersion)){if(JSON.stringify(value.provenance)!==JSON.stringify(initialProvenance))fail('固定网页版本的原始来源已改变');if(!previous){if(initialProvenance.selectionVersion===2)packageLibrary ||= new OpenDesignLibrary();verifyResourceHtml(packageLibrary,value,root);if(initialProvenance.selectionVersion===3){const saved=loadResourceHtmlIndex(root,initialProvenance.indexSnapshot);for(const key of ['index','lock','license']){const row=initialProvenance.indexSnapshot[key];add('design/assets/'+row.asset,saved.bytes[key],row.sha256);odHtmlSnapshotHeads.set(row.asset,row.sha256);}add('dependencies/open-design/snapshots/'+initialProvenance.revision+'/LICENSE',saved.bytes.license,initialProvenance.indexSnapshot.license.sha256);}}}
   else if(value.provenance?.source==='opendesign'&&value.provenance.selectionVersion!==undefined)fail('固定网页来源版本无效或并非初始来源');
   if(value.provenance?.source==='opendesign-brief'){const job=briefRecords.get(value.provenance.jobId);if(!job?.preview||job.preview.id!==source.id||job.preview.originalRevision!==lineage[0].revision)fail('设计简报网页缺少已核对的任务和计划');}
   if(value.operation?.action==='project-asset-apply'){const operation=htmlAssetRecords.get(value.operation.id);if(!operation||operation.status!=='confirmed'||operation.revision!==revision||operation.reservation.htmlId!==source.id)fail('网页项目素材版本缺少匹配预约');}
   if(value.operation?.action==='tailwind-freeze'){if(!previousValue)fail('Tailwind 静态样式缺少基线版本');verifyTailwindFreezeTransition(previousValue,value);}
   if(value.operation?.action==='project-font-attach'){
    if(!previousValue)fail('网页项目字体缺少基线版本');verifyHtmlFontTransition(previousValue,value);
    const op=value.operation,source=externalFileRecords.get(op.fileId),format=op.fontPath.endsWith('.ttf')?'ttf':'otf';
    if(!source||source.sha256!==op.fontSha256||source.bytes!==op.fontBytes||!source.file.toLowerCase().endsWith('.'+format))fail('网页字体缺少匹配的项目字体原件来源');
   }
   if(value.provenance?.source==='external-bundle'){
    const provenance=value.provenance,bundle=externalBundles.find(item=>item.id===provenance.bundleId),sourceFiles=verifiedBundles.get(provenance.bundleId);if(!bundle||!sourceFiles||![1,2].includes(provenance.selectionVersion)||provenance.selectionVersion===1&&provenance.includeLfs!==undefined||provenance.selectionVersion===2&&provenance.includeLfs!==true||provenance.bundleSha256!==bundle.sha256||provenance.repository!==(bundle.resolvedRepository||bundle.repository)||provenance.revision!==bundle.revision)fail('外部网页缺少匹配的已验证原包');const selection=selectExternalHtmlFiles([...sourceFiles.values()],provenance.entry,provenance.scope,{includeLfs:provenance.selectionVersion===2}),omitted=externalHtmlOmissionPreview(selection.omitted);for(const file of selection.included.filter(item=>item.lfs)){const original=[...externalFileRecords.values()].find(item=>item.kind==='external-lfs-file'&&item.bundleId===bundle.id&&item.file===file.path&&item.gitSha1===file.gitSha1&&item.sha256===file.sha256&&item.bytes===file.bytes);if(!original)fail('外部网页缺少对应 LFS 实际文件来源');}if(provenance.selectionSha256!==selection.selectionSha256||provenance.includedCount!==selection.included.length||provenance.omittedCount!==selection.omitted.length||JSON.stringify(provenance.omitted)!==JSON.stringify(omitted))fail('外部网页来源选择或遗漏记录不一致');if(!previous&&(value.entry!==provenance.entry||value.files.length!==selection.included.length||value.files.some(file=>{const original=selection.included.find(item=>item.path===file.path);return !original||original.sha256!==file.sha256||original.bytes!==file.bytes;})))fail('外部网页初始版本与原包文件不一致');
   }
   if(value.provenance?.source==='ecommerce-workflow'){const plan=ecommercePlans.get(value.provenance.planId);if(!plan||plan.requestHash!==value.provenance.requestHash)fail('电商画廊缺少对应计划');}
   if(value.provenance?.source==='stitch'){
    const origin=stitchAssetRecords.get(value.provenance.stitchAssetId);if(!origin||origin.format!=='html'||origin.requestHash!==value.provenance.requestHash||origin.sha256!==value.provenance.sha256)fail('Stitch 网页来源记录缺失或不一致');
    if(!previous){const original=value.files.find(file=>file.path==='index.html');if(!original||original.sha256!==origin.sha256)fail('Stitch 网页初始版本与原件不一致');}
   }
   if(previous&&JSON.parse(await copyProject(start+'next/'+previous+'.json',null,1024)).revision!==revision)fail('网页版本指针不一致');
   for(const file of value.files){
    if(!/^(?:text\/|application\/json|image\/svg\+xml)/.test(file.mime))continue;
    const content=Buffer.from(file.data,'base64').toString('utf8');
    if(/(?:\b(?:api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"][^'"]{12,}|\bBearer\s+[A-Za-z0-9_.-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{30,})/i.test(content))fail('网页源中包含疑似凭据，请先移除后再导出项目包');
   }
   await copyProject(start+'history/'+revision+'.json',revision,34*1024*1024);previous=revision;previousValue=value;
  }
  for(const conversion of await htmlStore.conversions(source.id)){
   if(!lineage.some(item=>item.revision===conversion.sourceRevision))fail('网页转换引用了缺失的源版本');
   await htmlStore.conversion(source.id,conversion.sourceRevision,conversion.sha256);
   await copyProject(start+'conversions/'+conversion.sourceRevision+'-'+conversion.sha256+'.json',null,32768);
   if(!records.has(rootPrefix+'/'+start+'conversions/'+conversion.sha256+'.pptx'))await copyProject(start+'conversions/'+conversion.sha256+'.pptx',conversion.sha256,64*1024*1024);
  }
  const conversionDir=workspacePath(root,rootPrefix+'/'+start+'conversions');
  for(const item of await directories(conversionDir)){
   if(!item.isFile()||!/^([a-f0-9]{64})-([a-f0-9]{64})-([A-Za-z0-9][\w-]{0,80})\.json$/.test(item.name))continue;
   const body=await copyProject(start+'conversions/'+item.name,null,32768),link=JSON.parse(body);
   if(link.id!==source.id||!hex.test(link.sourceRevision)||!hex.test(link.sha256)||item.name!==link.sourceRevision+'-'+link.sha256+'-'+link.deckSourceId+'.json'||!sources.some(saved=>saved.id===link.deckSourceId)||!records.has(rootPrefix+'/sources/'+link.deckSourceId+'/history/'+link.deckRevision+'.json'))fail('网页转换与演示来源关系不完整');
  }
 }
 let rev=snapshot.revision;const projectHistory=[];
 while(rev){
  if(projectHistory.length>=10000||!hex.test(rev))fail('项目历史异常');
  const value=JSON.parse(await copyProject('project/history/'+rev+'.json',rev,4*1024*1024));projectHistory.push(rev);
  for(const asset of Object.values(value.assets))assets.set(asset.id,asset);
  rev=value.parentRevision;
 }
 projectHistory.reverse();
 if(projectHistory.length){
  if(JSON.parse(await copyProject('project/root.json',null,1024)).revision!==projectHistory[0])fail('项目起始版本不符');
  for(let i=1;i<projectHistory.length;i++){
   const next=JSON.parse(await copyProject('project/next/'+projectHistory[i-1]+'.json',null,1024));if(next.revision!==projectHistory[i])fail('项目历史链不符');
  }
 }
 for(const asset of assets.values()){
  if(!records.has(rootPrefix+'/sources/'+asset.sourceId+'/history/'+asset.sourceRevision+'.json'))fail('素材缺少对应原生源历史');
  for(const data of [asset,asset.preview].filter(Boolean)){
   const file='project/derivatives/'+data.sha256+'.'+data.format;
   if(!records.has(rootPrefix+'/'+file))await copyProject(file,data.sha256,4*1024*1024);
  }
 }
 // Originals live under hash-named paths, including imports which predate a
 // source head. Copy originals and their bounded canonical metadata only.
 for(const dir of await directories(workspacePath(root,rootPrefix+'/sources'))){
  if(!dir.isDirectory()||!/^[a-zA-Z0-9][\w-]{0,80}$/.test(dir.name))continue;
  const sub='sources/'+dir.name+'/originals/';
  for(const item of await directories(workspacePath(root,rootPrefix+'/'+sub))){
   if(!item.isFile()||!/^([a-f0-9]{64})\.json$/.test(item.name))continue;
   const raw=await copyProject(sub+item.name,null,8192),info=JSON.parse(raw);
   if(!hex.test(info.sha256)||item.name!==info.sha256+'.json'||!new RegExp('^'+info.sha256+'\\.(svg|vectorcraft|drawcraft|vctemplate|pcraft|png|jpg|jpeg|psd|psb|webp|tif|tiff|deckcraft|slidecraft|pptx|potx|ppsx)$').test(info.file)||Object.keys(info).some(k=>!['sha256','file','name','bytes'].includes(k)))fail('原始导入记录无效');
   const bytes=await copyProject(sub+info.file,info.sha256);if(bytes.length!==info.bytes)fail('原始导入件字节数不一致');
  }
 }
 const pkg=JSON.parse(await readFile(join(product,'package.json'),'utf8')),lock=JSON.parse(await readFile(join(product,'web-runtime-lock.json'),'utf8')),runtimes={};
 for(const engine of engines){
  const key=engine+'-host',runtime=lock.engines[key];
  if(!runtime)fail('缺少当前原生运行时的依赖清单');
  runtimes[engine]={version:runtime.version,revision:runtime.provenance?.sourceRevision||null,fontRevision:runtime.provenance?.fontRevision||runtime.provenance?.fonts?.sourceRevision||null};
  for(const [name,meta] of Object.entries(runtime.files)){
   if(!/^(LICENSE-(?:APACHE|MIT)|NOTICE|ATTRIBUTION\.md|fonts\/[\w/.-]+\.(?:ttf|otf|woff2?|txt|json))$/i.test(name))continue;
   await copyRelative(join(product,'runtimes','web',key),name,'dependencies/'+key+'/'+name,meta.sha256);
  }
 }
 const resourceLock=JSON.parse(await readFile(join(product,'resources/open-design/lock.json'),'utf8'));
 const brandResources=Object.values(snapshot.manifest.brandState?.brands||{}).map(b=>b.resource).filter(Boolean);
 const styles=new Set(brandResources.map(resource=>resource.id));
 for(const resource of brandResources){
  if(resourceLock.styles.includes(resource.id)){
   for(const file of resourceLock.files.filter(f=>f.path.startsWith('design-systems/'+resource.id+'/')))await copyRelative(join(product,'resources/open-design'),file.path,'dependencies/open-design/'+file.path,file.sha256);
  }else{
   const manifest=resourceRecords.get(resource.manifestResourceId),tokens=resourceRecords.get(resource.tokenResourceId),packageId='design-systems/'+resource.id;
   const tokenFile=resource.tokenFile||'design-tokens.json';
   if(resource.repository!=='nexu-io/open-design'||!['design-tokens.json','tokens.css'].includes(tokenFile)||!manifest||!tokens||manifest.packageId!==packageId||tokens.packageId!==packageId||manifest.file!=='manifest.json'||tokens.file!==tokenFile||manifest.revision!==resource.revision||tokens.revision!==resource.revision)fail('按需品牌设计系统原件或来源记录缺失');
  }
 }
 if(styles.size||resourceRecords.size||resourcePackages||includesOpenDesignHtml){
  await copyRelative(join(product,'resources/open-design'),'LICENSE','dependencies/open-design/LICENSE');
  const extra={'source-lock.json':'0930a02f085de66bf0209b6fd1bb374611a2abcc0e3343340596d046c0b08d55',
   'cloudflare-kumo-LICENSE.txt':'df3e141c129d1804bea95fe087b157b156241b3bb1a4664808630aa85f2cd8fc',
   'tom-modern-LICENSE.txt':'603513fe37c4744395a6d06886d5cf4b7bbe46dc12952d2c423c9c38b0b7fdd5'};
  for(const [name,digest] of Object.entries(extra))await copyRelative(join(product,'licenses/opendesign-styles'),name,'dependencies/opendesign-styles/'+name,digest);
 }
 for(const [id,{bundle}]of directorReceipts){
  const files=bundle.exportFiles();for(const file of files){const bytes=file.bytes||await readFile(join(bundle.root,file.file));add(rootPrefix+'/resource-bundles/creative-director/'+id+'/'+file.file,bytes,file.sha256);if(directorReceipts.size===1)add('dependencies/creative-director/'+file.file,bytes,file.sha256);}
 }
 if(externalBundles.some(record=>record.odId==='skills/canvas-design'&&record.repository==='anthropics/skills'&&record.revision==='2c5958ecac7cee2b583967a2c4981d0f4a75c579')){
  const references={'source-lock.json':'6a07e0c4292640fb6011a443b039ec42c4918e8c88337b7ffc314a0797781caf','ibmplexserif-OFL.txt':'7e6b2818edbd8f6a01ae80641cc8f16a51080d08fb4e532be3a0b6f74adb07da','instrumentserif-OFL.txt':'129ed7618959716959f2941fdd5b49e0ad6e6c1d78726761786a00253d865521'};
  for(const [name,digest] of Object.entries(references))await copyRelative(join(product,'resources/canvas-design/font-license-references'),name,'dependencies/canvas-design-font-licenses/'+name,digest);
 }
 for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])await copyRelative(product,name,'dependencies/designcraft/'+name);
 if(falRealtimeEntries.length||falRealtimeAssetNames.length){await copyRelative(product,'resources/vendor/msgpack-3.1.3/LICENSE','dependencies/msgpack-3.1.3/LICENSE','d95a411bcdadac85d678a99367ff51719e53539fa5ee9994943cd760c4ae64e4');await copyRelative(product,'resources/vendor/msgpack-3.1.3/source-lock.json','dependencies/msgpack-3.1.3/source-lock.json','4168e35d481459388644c7f8c1a28dcaeafcca61dac6230fdd52a1f61d341f13');}
 const refreshed=(await store.list()).map(s=>s.id+'@'+s.revision).sort();
 const refreshedHtml=(await htmlStore.list()).map(s=>s.id+'@'+s.revision).sort();
 for(const [name,digest]of odHtmlSnapshotHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 OpenDesign 网页索引快照发生变化');}
 const refreshedLegacy=legacyStore.listDocs(root).map(doc=>doc.id+'@'+doc.revision).sort();
 const refreshedPlans=planStore.list().map(plan=>{if(plan.error)fail('导出期间设计计划无法读取');const pending=planStore.recoverable(plan.id);return JSON.stringify([plan.id,pending.head,pending.items.map(item=>item.revision).sort()]);}).sort();
 const refreshedPlanLinkAll=await directories(planLinkDir);if(refreshedPlanLinkAll.some(item=>/^plan(?:link|unlink)-/.test(item.name)&&!planLinkPattern.test(item.name)))fail('导出期间设计计划关联目录出现未知记录');const refreshedPlanLinks=refreshedPlanLinkAll.filter(item=>planLinkPattern.test(item.name));if(refreshedPlanLinks.length!==planLinkHeads.size||refreshedPlanLinks.some(item=>!item.isFile()))fail('导出期间设计计划关联发生变化');for(const item of refreshedPlanLinks)if(sha(await readFile(workspacePath(root,'design/.designcraft/plan-source-links/'+item.name,{mustExist:true})))!==planLinkHeads.get(item.name))fail('导出期间设计计划关联发生变化');
 const refreshedBriefAll=await directories(briefDir);if(refreshedBriefAll.some(item=>item.name.startsWith('odbriefjob-')&&!briefPattern.test(item.name)))fail('导出期间设计简报目录出现未知记录');const refreshedBrief=refreshedBriefAll.filter(item=>briefPattern.test(item.name));if(refreshedBrief.length!==briefHeads.size||refreshedBrief.some(item=>!item.isFile()))fail('导出期间设计简报记录发生变化');for(const item of refreshedBrief)if(sha(await readFile(workspacePath(root,'design/.designcraft/opendesign-brief/'+item.name,{mustExist:true})))!==briefHeads.get(item.name))fail('导出期间设计简报记录发生变化');
 const refreshedHtmlAssetAll=await directories(htmlAssetDir);if(refreshedHtmlAssetAll.some(item=>item.name.startsWith('htmlassetop-')&&!htmlAssetPattern.test(item.name)))fail('导出期间网页素材目录出现未知记录');const refreshedHtmlAssets=refreshedHtmlAssetAll.filter(item=>htmlAssetPattern.test(item.name));if(refreshedHtmlAssets.length!==htmlAssetHeads.size||refreshedHtmlAssets.some(item=>!item.isFile()))fail('导出期间网页素材预约发生变化');for(const item of refreshedHtmlAssets)if(sha(await readFile(workspacePath(root,'design/.designcraft/html-asset-ops/'+item.name,{mustExist:true})))!==htmlAssetHeads.get(item.name))fail('导出期间网页素材预约发生变化');
 const refreshedJobs=(await directories(imageDir)).filter(item=>/^image-[a-f0-9-]{36}\.json$/.test(item.name));
 if(refreshedJobs.some(item=>!item.isFile()))fail('导出期间图片任务记录类型发生变化');
 if(refreshedJobs.length!==imageHeads.size)fail('导出期间图片任务发生变化，请重新导出');
 for(const item of refreshedJobs)if(sha(await readFile(workspacePath(root,'design/.designcraft/image-jobs/'+item.name,{mustExist:true})))!==imageHeads.get(item.name))fail('导出期间图片候选发生变化，请重新导出');
 const refreshedFalAll=await directories(falDir);
 if(refreshedFalAll.some(item=>item.name.startsWith('faljob-')&&!falCurrent.test(item.name)&&!falTemporary.test(item.name)&&!falPreserved.test(item.name)))fail('导出期间 fal 工作流目录出现无法识别的记录');
 const refreshedFal=refreshedFalAll.filter(item=>falCurrent.test(item.name)||falTemporary.test(item.name)||falPreserved.test(item.name));
 if(refreshedFal.length!==falHeads.size||refreshedFal.some(item=>!item.isFile()))fail('导出期间 fal 工作流记录发生变化，请重新导出');
 for(const item of refreshedFal)if(sha(await readFile(workspacePath(root,'design/.designcraft/fal-workflows/'+item.name,{mustExist:true})))!==falHeads.get(item.name))fail('导出期间 fal 工作流记录发生变化，请重新导出');
 const refreshedFalRealtimeAll=await directories(falRealtimeDir);if(refreshedFalRealtimeAll.some(item=>/^(?:falrtsession|falrtjob)-/.test(item.name)&&!falRealtimeRecord.test(item.name)))fail('导出期间 fal 实时目录出现未知记录');const refreshedFalRealtime=refreshedFalRealtimeAll.filter(item=>falRealtimeRecord.test(item.name));if(refreshedFalRealtime.length!==falRealtimeHeads.size||refreshedFalRealtime.some(item=>!item.isFile()))fail('导出期间 fal 实时记录发生变化');for(const item of refreshedFalRealtime)if(sha(await readFile(workspacePath(root,'design/.designcraft/fal-realtime/'+item.name,{mustExist:true})))!==falRealtimeHeads.get(item.name))fail('导出期间 fal 实时记录发生变化');const refreshedFalRealtimeAssets=legacyStore.listAssets(root).filter(item=>falRealtimeAssetPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFalRealtimeAssets)!==JSON.stringify(falRealtimeAssetNames))fail('导出期间 fal 实时素材发生变化');for(const [name,digest]of falRealtimeAssetHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 fal 实时素材发生变化');}
 const refreshedFalRtNativeAll=await directories(falRtNativeDir);if(refreshedFalRtNativeAll.some(item=>/^falrt(?:image|open|link)-/.test(item.name)&&!falRtNativeRecord.test(item.name)))fail('导出期间 fal 实时原生目录出现未知记录');const refreshedFalRtNative=refreshedFalRtNativeAll.filter(item=>falRtNativeRecord.test(item.name));if(refreshedFalRtNative.length!==falRtNativeHeads.size||refreshedFalRtNative.some(item=>!item.isFile()))fail('导出期间 fal 实时原生记录发生变化');for(const item of refreshedFalRtNative)if(sha(await readFile(workspacePath(root,'design/.designcraft/fal-realtime-native/'+item.name,{mustExist:true})))!==falRtNativeHeads.get(item.name))fail('导出期间 fal 实时原生记录发生变化');
 const refreshedFalOutputs=legacyStore.listAssets(root).filter(item=>falOutputPrefixes.some(prefix=>item.name.startsWith(prefix))).map(item=>item.name).sort();
 if(JSON.stringify(refreshedFalOutputs)!==JSON.stringify(falOutputNames))fail('导出期间 fal 输出素材发生变化，请重新导出');
 const refreshedFalStorageAssets=legacyStore.listAssets(root).filter(item=>falStorageAssetPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFalStorageAssets)!==JSON.stringify(falStorageAssetNames))fail('导出期间 fal 存储素材发生变化，请重新导出');
 const refreshedFalRemoteSecrets=legacyStore.listAssets(root).filter(item=>falRemoteSecretPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFalRemoteSecrets)!==JSON.stringify(falRemoteSecretNames))fail('导出期间 fal 远端输出引用发生变化，请重新导出');
 for(const [name,digest]of falAssetHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 fal 工作流素材发生变化，请重新导出');}
 const refreshedVeniceAll=await directories(veniceDir);if(refreshedVeniceAll.some(item=>item.name.startsWith('veniceaudio-')&&!veniceCurrent.test(item.name)&&!veniceTemporary.test(item.name)&&!veniceReceipt.test(item.name)))fail('导出期间 Venice 音频目录出现无法识别的记录');
 const refreshedVenice=refreshedVeniceAll.filter(item=>veniceCurrent.test(item.name)||veniceTemporary.test(item.name)||veniceReceipt.test(item.name));if(refreshedVenice.length!==veniceHeads.size||refreshedVenice.some(item=>!item.isFile()))fail('导出期间 Venice 音频记录发生变化，请重新导出');
 for(const item of refreshedVenice)if(sha(await readFile(workspacePath(root,'design/.designcraft/venice-audio/'+item.name,{mustExist:true})))!==veniceHeads.get(item.name))fail('导出期间 Venice 音频记录发生变化，请重新导出');
 const refreshedVeniceOutputs=legacyStore.listAssets(root).filter(item=>venicePrefixes.some(prefix=>item.name.startsWith(prefix))).map(item=>item.name).sort();if(JSON.stringify(refreshedVeniceOutputs)!==JSON.stringify(veniceOutputNames))fail('导出期间 Venice 音频素材发生变化，请重新导出');
 for(const [name,digest]of veniceAssetHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Venice 音频素材发生变化，请重新导出');}
 const refreshedVideoAll=await directories(videoDir);if(refreshedVideoAll.some(item=>item.name.startsWith('venicevideo-')&&!videoCurrent.test(item.name)&&!videoTemporary.test(item.name)&&!videoReceipt.test(item.name)))fail('导出期间 Venice 视频目录出现无法识别的记录');
 const refreshedVideo=refreshedVideoAll.filter(item=>videoCurrent.test(item.name)||videoTemporary.test(item.name)||videoReceipt.test(item.name));if(refreshedVideo.length!==videoHeads.size||refreshedVideo.some(item=>!item.isFile()))fail('导出期间 Venice 视频记录发生变化，请重新导出');
 for(const item of refreshedVideo)if(sha(await readFile(workspacePath(root,'design/.designcraft/venice-video/'+item.name,{mustExist:true})))!==videoHeads.get(item.name))fail('导出期间 Venice 视频记录发生变化，请重新导出');
 const refreshedVideoOutputs=legacyStore.listAssets(root).filter(item=>videoPrefixes.some(prefix=>item.name.startsWith(prefix))).map(item=>item.name).sort();if(JSON.stringify(refreshedVideoOutputs)!==JSON.stringify(videoOutputNames))fail('导出期间 Venice 视频素材发生变化，请重新导出');
 for(const [name,digest]of videoAssetHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Venice 视频素材发生变化，请重新导出');}
 const refreshedEcommerceAll=await directories(ecommerceDir);if(refreshedEcommerceAll.some(item=>/^ecom(?:plan|gallery)-/.test(item.name)&&!ecommerceRecord.test(item.name)))fail('导出期间电商图目录出现无法识别的记录');const refreshedEcommerce=refreshedEcommerceAll.filter(item=>ecommerceRecord.test(item.name));if(refreshedEcommerce.length!==ecommerceHeads.size||refreshedEcommerce.some(item=>!item.isFile()))fail('导出期间电商图记录发生变化');for(const item of refreshedEcommerce)if(sha(await readFile(workspacePath(root,'design/.designcraft/ecommerce/'+item.name,{mustExist:true})))!==ecommerceHeads.get(item.name))fail('导出期间电商图记录发生变化');const refreshedEcommerceRefs=legacyStore.listAssets(root).filter(item=>ecommerceRefPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedEcommerceRefs)!==JSON.stringify(ecommerceRefNames))fail('导出期间电商参考原件发生变化');for(const [name,digest]of ecommerceRefHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间电商参考原件发生变化');}
 const refreshedFigmaAll=await directories(figmaDir);if(refreshedFigmaAll.some(item=>/^figma(?:export|open|link)-/.test(item.name)&&!figmaRecord.test(item.name)))fail('导出期间 Figma 来源目录出现无法识别的记录');
 const refreshedFigma=refreshedFigmaAll.filter(item=>figmaRecord.test(item.name));if(refreshedFigma.length!==figmaHeads.size||refreshedFigma.some(item=>!item.isFile()))fail('导出期间 Figma 来源记录发生变化，请重新导出');
 for(const item of refreshedFigma)if(sha(await readFile(workspacePath(root,'design/.designcraft/figma-sources/'+item.name,{mustExist:true})))!==figmaHeads.get(item.name))fail('导出期间 Figma 来源记录发生变化，请重新导出');
 const refreshedFigmaAssets=legacyStore.listAssets(root).filter(item=>figmaAssetPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFigmaAssets)!==JSON.stringify(figmaAssetNames))fail('导出期间 Figma 原件发生变化，请重新导出');for(const [name,digest]of figmaAssetHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Figma 素材发生变化，请重新导出');}
 const refreshedExternalNativeAll=await directories(externalNativeDir);if(refreshedExternalNativeAll.some(item=>/^externalopen(?:result)?-/.test(item.name)&&!externalNativeRecord.test(item.name)))fail('导出期间外部原生目录出现无法识别记录');const refreshedExternalNative=refreshedExternalNativeAll.filter(item=>externalNativeRecord.test(item.name));if(refreshedExternalNative.length!==externalNativeHeads.size||refreshedExternalNative.some(item=>!item.isFile()))fail('导出期间外部原生记录发生变化');for(const item of refreshedExternalNative)if(sha(await readFile(workspacePath(root,'design/.designcraft/external-native/'+item.name,{mustExist:true})))!==externalNativeHeads.get(item.name))fail('导出期间外部原生记录发生变化');
 const refreshedWorkflowImagesAll=await directories(workflowImageDir);if(refreshedWorkflowImagesAll.some(item=>/^workflowimage(?:open|link)?-/.test(item.name)&&!workflowImageRecord.test(item.name)))fail('导出期间工作流图片目录出现无法识别记录');const refreshedWorkflowImages=refreshedWorkflowImagesAll.filter(item=>workflowImageRecord.test(item.name));if(refreshedWorkflowImages.length!==workflowImageHeads.size||refreshedWorkflowImages.some(item=>!item.isFile()))fail('导出期间工作流图片记录发生变化');for(const item of refreshedWorkflowImages)if(sha(await readFile(workspacePath(root,'design/.designcraft/workflow-images/'+item.name,{mustExist:true})))!==workflowImageHeads.get(item.name))fail('导出期间工作流图片记录发生变化');
 const refreshedReplicateAll=await directories(replicateDir);if(refreshedReplicateAll.some(item=>item.name.startsWith('replicatejob-')&&!replicateCurrent.test(item.name)&&!replicateTemporary.test(item.name)&&!replicateReceipt.test(item.name)))fail('导出期间 Replicate 目录出现无法识别的记录');
 const refreshedReplicate=refreshedReplicateAll.filter(item=>replicateCurrent.test(item.name)||replicateTemporary.test(item.name)||replicateReceipt.test(item.name));if(refreshedReplicate.length!==replicateHeads.size||refreshedReplicate.some(item=>!item.isFile()))fail('导出期间 Replicate 任务记录发生变化，请重新导出');
 for(const item of refreshedReplicate)if(sha(await readFile(workspacePath(root,'design/.designcraft/replicate-workflows/'+item.name,{mustExist:true})))!==replicateHeads.get(item.name))fail('导出期间 Replicate 任务记录发生变化，请重新导出');
 const refreshedReplicateOutputs=legacyStore.listAssets(root).filter(item=>replicatePrefixes.some(prefix=>item.name.startsWith(prefix))).map(item=>item.name).sort();if(JSON.stringify(refreshedReplicateOutputs)!==JSON.stringify(replicateOutputNames))fail('导出期间 Replicate 输出素材发生变化，请重新导出');for(const [name,digest]of replicateAssetHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Replicate 素材发生变化，请重新导出');}
 const refreshedSvgAll=await directories(svgDir);if(refreshedSvgAll.some(item=>/^openaisvg(?:job|result|open|link)-/.test(item.name)&&!svgRecord.test(item.name)))fail('导出期间 OpenAI SVG 目录出现无法识别的记录');const refreshedSvg=refreshedSvgAll.filter(item=>svgRecord.test(item.name));if(refreshedSvg.length!==svgHeads.size||refreshedSvg.some(item=>!item.isFile()))fail('导出期间 OpenAI SVG 记录发生变化，请重新导出');
 for(const item of refreshedSvg)if(sha(await readFile(workspacePath(root,'design/.designcraft/openai-svg/'+item.name,{mustExist:true})))!==svgHeads.get(item.name))fail('导出期间 OpenAI SVG 记录发生变化，请重新导出');const refreshedSvgAssets=legacyStore.listAssets(root).filter(item=>svgAssetPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedSvgAssets)!==JSON.stringify(svgAssetNames))fail('导出期间 OpenAI SVG 原件发生变化，请重新导出');for(const [name,digest]of svgAssetHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 OpenAI SVG 素材发生变化，请重新导出');}
 const refreshedPixelOpAll=await directories(pixelOpDir);if(refreshedPixelOpAll.some(item=>/^(?:pixelop|pixelopreceipt)-/.test(item.name)&&![pixelOpName,pixelOpTemp,pixelOpReceiptName,pixelOpReceiptTemp].some(pattern=>pattern.test(item.name))))fail('导出期间 PixelBin 操作目录出现无法识别的记录');
 const refreshedPixelOps=refreshedPixelOpAll.filter(item=>[pixelOpName,pixelOpTemp,pixelOpReceiptName,pixelOpReceiptTemp].some(pattern=>pattern.test(item.name)));if(refreshedPixelOps.length!==pixelOpHeads.size||refreshedPixelOps.some(item=>!item.isFile()))fail('导出期间 PixelBin 操作记录发生变化');for(const item of refreshedPixelOps)if(sha(await readFile(workspacePath(root,'design/.designcraft/pixelbin-operations/'+item.name,{mustExist:true})))!==pixelOpHeads.get(item.name))fail('导出期间 PixelBin 操作记录发生变化');
 const refreshedPixelAll=await directories(pixelDir);if(refreshedPixelAll.some(item=>/^(?:pixeljob|pixelaccept)-/.test(item.name)&&![pixelJobName,pixelJobTemp,pixelAcceptName,pixelAcceptTemp].some(pattern=>pattern.test(item.name))))fail('导出期间 PixelBin 任务目录出现无法识别的记录');
 const refreshedPixel=refreshedPixelAll.filter(item=>[pixelJobName,pixelJobTemp,pixelAcceptName,pixelAcceptTemp].some(pattern=>pattern.test(item.name)));if(refreshedPixel.length!==pixelHeads.size||refreshedPixel.some(item=>!item.isFile()))fail('导出期间 PixelBin 任务记录发生变化');for(const item of refreshedPixel)if(sha(await readFile(workspacePath(root,'design/.designcraft/pixelbin-jobs/'+item.name,{mustExist:true})))!==pixelHeads.get(item.name))fail('导出期间 PixelBin 任务记录发生变化');
 const refreshedPixelAssetAll=await directories(pixelAssetDir);if(refreshedPixelAssetAll.some(item=>/^(?:pixelasset|pixelopen|pixellink)-/.test(item.name)&&![pixelAssetName,pixelAssetTemp,pixelOpenName,pixelLinkName,pixelNativeTemp].some(pattern=>pattern.test(item.name))))fail('导出期间 PixelBin 图片目录出现无法识别的记录');
 const refreshedPixelAssets=refreshedPixelAssetAll.filter(item=>[pixelAssetName,pixelAssetTemp,pixelOpenName,pixelLinkName,pixelNativeTemp].some(pattern=>pattern.test(item.name)));if(refreshedPixelAssets.length!==pixelAssetHeads.size||refreshedPixelAssets.some(item=>!item.isFile()))fail('导出期间 PixelBin 图片记录发生变化');for(const item of refreshedPixelAssets)if(sha(await readFile(workspacePath(root,'design/.designcraft/pixelbin-assets/'+item.name,{mustExist:true})))!==pixelAssetHeads.get(item.name))fail('导出期间 PixelBin 图片记录发生变化');
 const refreshedPixelData=legacyStore.listAssets(root).filter(item=>pixelDataPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedPixelData)!==JSON.stringify(pixelDataNames))fail('导出期间 PixelBin 文件发生变化');for(const [name,digest]of pixelDataHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 PixelBin 文件发生变化');}
 const refreshedFigmaMcpJobAll=await directories(figmamcpJobDir);if(refreshedFigmaMcpJobAll.some(item=>item.name.startsWith('figmamcpjob-')&&!figmamcpJobName.test(item.name)&&!figmamcpJobTemp.test(item.name)))fail('导出期间 FigmaMcp 任务目录出现无法识别的记录');
 const refreshedFigmaMcpJobs=refreshedFigmaMcpJobAll.filter(item=>figmamcpJobName.test(item.name)||figmamcpJobTemp.test(item.name));if(refreshedFigmaMcpJobs.length!==figmamcpJobHeads.size||refreshedFigmaMcpJobs.some(item=>!item.isFile()))fail('导出期间 FigmaMcp 任务发生变化');
 for(const item of refreshedFigmaMcpJobs)if(sha(await readFile(workspacePath(root,'design/.designcraft/figmamcp-jobs/'+item.name,{mustExist:true})))!==figmamcpJobHeads.get(item.name))fail('导出期间 FigmaMcp 任务发生变化');
 const refreshedFigmaMcpResultAll=await directories(figmamcpResultDir);if(refreshedFigmaMcpResultAll.some(item=>item.name.startsWith('figmamcpresult-')&&!figmamcpResultName.test(item.name)&&!figmamcpResultTemp.test(item.name)))fail('导出期间 FigmaMcp 结果目录出现无法识别的记录');
 const refreshedFigmaMcpResults=refreshedFigmaMcpResultAll.filter(item=>figmamcpResultName.test(item.name)||figmamcpResultTemp.test(item.name));if(refreshedFigmaMcpResults.length!==figmamcpResultHeads.size||refreshedFigmaMcpResults.some(item=>!item.isFile()))fail('导出期间 FigmaMcp 结果回执发生变化');
 for(const item of refreshedFigmaMcpResults)if(sha(await readFile(workspacePath(root,'design/.designcraft/figmamcp-results/'+item.name,{mustExist:true})))!==figmamcpResultHeads.get(item.name))fail('导出期间 FigmaMcp 结果回执发生变化');
 const refreshedFigmaMcpAssetAll=await directories(figmamcpAssetDir);if(refreshedFigmaMcpAssetAll.some(item=>/^figmamcp(?:asset|open|link)-/.test(item.name)&&!figmamcpAssetRecord.test(item.name)))fail('导出期间 Figma MCP 图片目录出现无法识别的记录');const refreshedFigmaMcpAssets=refreshedFigmaMcpAssetAll.filter(item=>figmamcpAssetRecord.test(item.name));if(refreshedFigmaMcpAssets.length!==figmamcpAssetHeads.size||refreshedFigmaMcpAssets.some(item=>!item.isFile()))fail('导出期间 Figma MCP 图片来源发生变化');for(const item of refreshedFigmaMcpAssets)if(sha(await readFile(workspacePath(root,'design/.designcraft/figmamcp-assets/'+item.name,{mustExist:true})))!==figmamcpAssetHeads.get(item.name))fail('导出期间 Figma MCP 图片来源发生变化');
 const refreshedFigmaMcpImages=legacyStore.listAssets(root).filter(item=>figmamcpImagePattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFigmaMcpImages)!==JSON.stringify(figmamcpImageNames))fail('导出期间 Figma MCP 图片发生变化');for(const [name,digest]of figmamcpImageHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Figma MCP 图片发生变化');}
 const refreshedFigmaMcpData=legacyStore.listAssets(root).filter(item=>figmamcpDataPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFigmaMcpData)!==JSON.stringify(figmamcpDataNames))fail('导出期间 Figma MCP 已保存结果发生变化');for(const [name,digest]of figmamcpDataHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Figma MCP 已保存结果发生变化');}
 const refreshedFigmaPromptAll=await directories(figmaPromptDir);if(refreshedFigmaPromptAll.some(item=>item.name.startsWith('figmamcpprompt-')&&!figmaPromptRecord.test(item.name)))fail('导出期间 Figma 提示参考目录出现未知记录');const refreshedFigmaPrompts=refreshedFigmaPromptAll.filter(item=>figmaPromptRecord.test(item.name));if(refreshedFigmaPrompts.length!==figmaPromptHeads.size||refreshedFigmaPrompts.some(item=>!item.isFile()))fail('导出期间 Figma 提示参考发生变化');for(const item of refreshedFigmaPrompts)if(sha(await readFile(workspacePath(root,'design/.designcraft/figmamcp-prompts/'+item.name,{mustExist:true})))!==figmaPromptHeads.get(item.name))fail('导出期间 Figma 提示参考发生变化');const refreshedFigmaPromptTexts=legacyStore.listAssets(root).filter(item=>figmaPromptTextPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFigmaPromptTexts)!==JSON.stringify(figmaPromptTextNames))fail('导出期间 Figma 提示文本发生变化');for(const [name,digest]of figmaPromptTextHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Figma 提示文本发生变化');}
 const refreshedFigmaMcpFileAll=await directories(figmamcpFileDir);if(refreshedFigmaMcpFileAll.some(item=>item.name.startsWith('figmamcpfile-')&&!figmamcpFileRecord.test(item.name)))fail('导出期间 Figma MCP 素材目录出现未知记录');const refreshedFigmaMcpFiles=refreshedFigmaMcpFileAll.filter(item=>figmamcpFileRecord.test(item.name));if(refreshedFigmaMcpFiles.length!==figmamcpFileHeads.size||refreshedFigmaMcpFiles.some(item=>!item.isFile()))fail('导出期间 Figma MCP 素材记录发生变化');for(const item of refreshedFigmaMcpFiles)if(sha(await readFile(workspacePath(root,'design/.designcraft/figmamcp-files/'+item.name,{mustExist:true})))!==figmamcpFileHeads.get(item.name))fail('导出期间 Figma MCP 素材记录发生变化');const refreshedFigmaMcpSavedFiles=legacyStore.listAssets(root).filter(item=>figmamcpFilePattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFigmaMcpSavedFiles)!==JSON.stringify(figmamcpFileNames))fail('导出期间 Figma MCP 素材发生变化');for(const [name,digest]of figmamcpSavedFileHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Figma MCP 素材发生变化');}
 const refreshedFigmaFileNativeAll=await directories(figmaFileNativeDir);if(refreshedFigmaFileNativeAll.some(item=>/^figmafile(?:open|link)-/.test(item.name)&&!figmaFileNativeRecord.test(item.name)))fail('导出期间 Figma 素材原生目录出现未知记录');const refreshedFigmaFileNative=refreshedFigmaFileNativeAll.filter(item=>figmaFileNativeRecord.test(item.name));if(refreshedFigmaFileNative.length!==figmaFileNativeHeads.size||refreshedFigmaFileNative.some(item=>!item.isFile()))fail('导出期间 Figma 素材原生记录发生变化');for(const item of refreshedFigmaFileNative)if(sha(await readFile(workspacePath(root,'design/.designcraft/figmamcp-file-native/'+item.name,{mustExist:true})))!==figmaFileNativeHeads.get(item.name))fail('导出期间 Figma 素材原生记录发生变化');
 const refreshedFigmaHtmlAll=await directories(figmaHtmlDir);if(refreshedFigmaHtmlAll.some(item=>item.name.startsWith('figmahtmltransfer-')&&!figmaHtmlRecord.test(item.name)))fail('导出期间 Figma 网页转移目录出现未知记录');const refreshedFigmaHtml=refreshedFigmaHtmlAll.filter(item=>figmaHtmlRecord.test(item.name));if(refreshedFigmaHtml.length!==figmaHtmlHeads.size||refreshedFigmaHtml.some(item=>!item.isFile()))fail('导出期间 Figma 网页转移记录发生变化');for(const item of refreshedFigmaHtml)if(sha(await readFile(workspacePath(root,'design/.designcraft/figma-html-transfers/'+item.name,{mustExist:true})))!==figmaHtmlHeads.get(item.name))fail('导出期间 Figma 网页转移记录发生变化');
 const refreshedFigmaUploadAll=await directories(figmaUploadDir);if(refreshedFigmaUploadAll.some(item=>item.name.startsWith('figmaupload-')&&!figmaUploadRecord.test(item.name)))fail('导出期间 Figma 上传目录出现未知记录');const refreshedFigmaUploads=refreshedFigmaUploadAll.filter(item=>figmaUploadRecord.test(item.name));if(refreshedFigmaUploads.length!==figmaUploadHeads.size||refreshedFigmaUploads.some(item=>!item.isFile()))fail('导出期间 Figma 上传记录发生变化');for(const item of refreshedFigmaUploads)if(sha(await readFile(workspacePath(root,'design/.designcraft/figma-uploads/'+item.name,{mustExist:true})))!==figmaUploadHeads.get(item.name))fail('导出期间 Figma 上传记录发生变化');const refreshedFigmaUploadInputs=legacyStore.listAssets(root).filter(item=>figmaUploadInputPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedFigmaUploadInputs)!==JSON.stringify(figmaUploadInputNames))fail('导出期间 Figma 上传原件发生变化');for(const [name,digest]of figmaUploadInputHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Figma 上传原件发生变化');}
 const refreshedStitchJobAll=await directories(stitchJobDir);if(refreshedStitchJobAll.some(item=>item.name.startsWith('stitchjob-')&&!stitchJobName.test(item.name)&&!stitchJobTemp.test(item.name)))fail('导出期间 Stitch 任务目录出现无法识别的记录');
 const refreshedStitchJobs=refreshedStitchJobAll.filter(item=>stitchJobName.test(item.name)||stitchJobTemp.test(item.name));if(refreshedStitchJobs.length!==stitchJobHeads.size||refreshedStitchJobs.some(item=>!item.isFile()))fail('导出期间 Stitch 任务发生变化');
 for(const item of refreshedStitchJobs)if(sha(await readFile(workspacePath(root,'design/.designcraft/stitch-jobs/'+item.name,{mustExist:true})))!==stitchJobHeads.get(item.name))fail('导出期间 Stitch 任务发生变化');
 const refreshedStitchResultAll=await directories(stitchResultDir);if(refreshedStitchResultAll.some(item=>item.name.startsWith('stitchresult-')&&!stitchResultName.test(item.name)&&!stitchResultTemp.test(item.name)))fail('导出期间 Stitch 结果目录出现无法识别的记录');
 const refreshedStitchResults=refreshedStitchResultAll.filter(item=>stitchResultName.test(item.name)||stitchResultTemp.test(item.name));if(refreshedStitchResults.length!==stitchResultHeads.size||refreshedStitchResults.some(item=>!item.isFile()))fail('导出期间 Stitch 结果回执发生变化');
 for(const item of refreshedStitchResults)if(sha(await readFile(workspacePath(root,'design/.designcraft/stitch-results/'+item.name,{mustExist:true})))!==stitchResultHeads.get(item.name))fail('导出期间 Stitch 结果回执发生变化');
 const refreshedStitchAssetAll=await directories(stitchAssetDir);if(refreshedStitchAssetAll.some(item=>item.name.startsWith('stitchasset-')&&!stitchAssetName.test(item.name)&&!stitchAssetTemp.test(item.name)))fail('导出期间 Stitch 原件目录出现无法识别的记录');
 const refreshedStitchAssets=refreshedStitchAssetAll.filter(item=>stitchAssetName.test(item.name)||stitchAssetTemp.test(item.name));if(refreshedStitchAssets.length!==stitchAssetHeads.size||refreshedStitchAssets.some(item=>!item.isFile()))fail('导出期间 Stitch 原件记录发生变化');
 for(const item of refreshedStitchAssets)if(sha(await readFile(workspacePath(root,'design/.designcraft/stitch-assets/'+item.name,{mustExist:true})))!==stitchAssetHeads.get(item.name))fail('导出期间 Stitch 原件记录发生变化');
 const refreshedStitchImageAll=await directories(stitchImageDir);if(refreshedStitchImageAll.some(item=>/^stitchimage(?:open|link)-/.test(item.name)&&!stitchImageRecord.test(item.name)))fail('导出期间 Stitch 图片导入目录出现未知记录');const refreshedStitchImages=refreshedStitchImageAll.filter(item=>stitchImageRecord.test(item.name));if(refreshedStitchImages.length!==stitchImageHeads.size||refreshedStitchImages.some(item=>!item.isFile()))fail('导出期间 Stitch 图片导入记录发生变化');for(const item of refreshedStitchImages)if(sha(await readFile(workspacePath(root,'design/.designcraft/stitch-image-imports/'+item.name,{mustExist:true})))!==stitchImageHeads.get(item.name))fail('导出期间 Stitch 图片导入记录发生变化');
 const refreshedStitchData=legacyStore.listAssets(root).filter(item=>stitchDataPattern.test(item.name)).map(item=>item.name).sort();if(JSON.stringify(refreshedStitchData)!==JSON.stringify(stitchDataNames))fail('导出期间 Stitch 已保存文件发生变化');
 for(const [name,digest]of stitchDataHeads){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间 Stitch 已保存文件发生变化');}
 const refreshedAllResources=await directories(resourceDir);
 if(refreshedAllResources.some(item=>item.name.startsWith('projectfont-')&&!/^projectfont-[a-f0-9]{64}\.json$/.test(item.name)&&!fontTemporary.test(item.name)))fail('导出期间项目字体目录出现无法识别的记录');
 if(refreshedAllResources.some(item=>item.name.startsWith('userfont-')&&!/^userfont-[a-f0-9]{64}\.json$/.test(item.name)&&!userFontTemporary.test(item.name)))fail('导出期间用户字体目录出现无法识别的记录');
 const refreshedResources=refreshedAllResources.filter(item=>/^(?:resource|link|package|external|externalbundle|externalfile|externallfs|userfont|projectfont)-[a-f0-9]{64}\.json$/.test(item.name)||fontTemporary.test(item.name)||userFontTemporary.test(item.name));
 if(refreshedResources.length!==resourceHeads.size||refreshedResources.some(item=>!item.isFile()))fail('导出期间资源来源记录发生变化，请重新导出');
 for(const item of refreshedResources)if(sha(await readFile(workspacePath(root,rootPrefix+'/resource-imports/'+item.name,{mustExist:true})))!==resourceHeads.get(item.name))fail('导出期间资源来源记录发生变化，请重新导出');
 const refreshedUserFontAssets=legacyStore.listAssets(root).filter(item=>userFontAsset.test(item.name));
 if(refreshedUserFontAssets.length!==userFontAssetHeads.size||refreshedUserFontAssets.some(item=>!userFontAssetHeads.has(item.name)||item.size>4*1024*1024))fail('导出期间用户字体原件发生变化，请重新导出');
 for(const item of refreshedUserFontAssets)if(sha(await readFile(workspacePath(root,'design/assets/'+item.name,{mustExist:true})))!==userFontAssetHeads.get(item.name))fail('导出期间用户字体原件发生变化，请重新导出');
 const refreshedDisabled=await directories(disabledDir);
 if(refreshedDisabled.length!==disabledHeads.size||refreshedDisabled.some(item=>!item.isFile()||!disabledHeads.has(item.name)))fail('导出期间停用字体历史发生变化，请重新导出');
 for(const item of refreshedDisabled)if(sha(await readFile(workspacePath(root,rootPrefix+'/font-disabled/'+item.name,{mustExist:true})))!==disabledHeads.get(item.name))fail('导出期间停用字体历史发生变化，请重新导出');
 const refreshedRecovered=await directories(recoveredDir);
 if(refreshedRecovered.length!==recoveredHeads.size||refreshedRecovered.some(item=>!item.isFile()||!recoveredHeads.has(item.name)))fail('导出期间字体恢复历史发生变化，请重新导出');
 for(const item of refreshedRecovered)if(sha(await readFile(workspacePath(root,rootPrefix+'/font-recovered/'+item.name,{mustExist:true})))!==recoveredHeads.get(item.name))fail('导出期间字体恢复历史发生变化，请重新导出');
 const refreshedUserRecovered=await directories(recoveredUserDir);
 if(refreshedUserRecovered.length!==recoveredUserHeads.size||refreshedUserRecovered.some(item=>!item.isFile()||!recoveredUserHeads.has(item.name)))fail('导出期间用户字体恢复历史发生变化，请重新导出');
 for(const item of refreshedUserRecovered)if(sha(await readFile(workspacePath(root,rootPrefix+'/userfont-recovered/'+item.name,{mustExist:true})))!==recoveredUserHeads.get(item.name))fail('导出期间用户字体恢复历史发生变化，请重新导出');
 const refreshedQuarantine=await directories(quarantineDir);
 if(refreshedQuarantine.length!==quarantineHeads.size||refreshedQuarantine.some(item=>!item.isFile()||!quarantineHeads.has(item.name)))fail('导出期间字体候选保留区发生变化，请重新导出');
 for(const item of refreshedQuarantine)if(sha(await readFile(workspacePath(root,rootPrefix+'/font-quarantine/'+item.name,{mustExist:true})))!==quarantineHeads.get(item.name))fail('导出期间字体候选保留区发生变化，请重新导出');
 const refreshedAdoptions=(await directories(adoptionDir)).filter(item=>item.name.endsWith('.json'));
 if(refreshedAdoptions.length!==adoptionHeads.size||refreshedAdoptions.some(item=>!item.isFile()))fail('导出期间图片采用记录发生变化，请重新导出');
 for(const item of refreshedAdoptions)if(sha(await readFile(workspacePath(root,'design/.designcraft/image-adoptions/'+item.name,{mustExist:true})))!==adoptionHeads.get(item.name))fail('导出期间图片采用记录发生变化，请重新导出');
 if(JSON.stringify(refreshed)!==JSON.stringify(currentHeads)||JSON.stringify(refreshedHtml)!==JSON.stringify(htmlHeads)||JSON.stringify(refreshedLegacy)!==JSON.stringify(legacyHeads)||JSON.stringify(refreshedPlans)!==JSON.stringify(planHeads)||(await graph.read()).revision!==snapshot.revision)fail('导出期间作品、计划或素材关系发生变化，请重新导出');
 const stockRefreshed=await directories(stockDir);if(stockRefreshed.length!==stockHeads.size||stockRefreshed.some(item=>!item.isFile()||!stockHeads.has(item.name)))fail('导出期间在线图库记录发生变化');for(const item of stockRefreshed){const relative='design/.designcraft/stock-images/'+item.name,path=workspacePath(root,relative,{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>(item.name.startsWith('stocksearch-')?3*1024*1024:16384)||sha(await readFile(path))!==stockHeads.get(item.name))fail('导出期间在线图库记录发生变化');}for(const [name,digest]of stockAssets){const bytes=legacyStore.readAsset(root,name);if(!bytes||sha(bytes)!==digest)fail('导出期间在线图库原件发生变化');}
 const manifest={format:'designcraft-project',schema:1,designcraft:pkg.version,uiBuild:pkg.designcraftUiBuild,projectRevision:snapshot.revision,
  sources:sources.map(({id,title,engine,revision})=>({id,title,engine,revision})),htmlSources:htmlSources.map(({id,title,entry,revision})=>({id,title,entry,revision})),legacySources:legacyDocs.map(({id,title,revision})=>({id,title,revision})),designPlans:planStates.map(({plan,pending})=>({id:plan.id,title:plan.title,revision:pending.head,pendingCandidates:pending.items.map(item=>item.revision)})),stockSearches:stockSearches.size,stockImages:stockImages.size,stockNativeImports:stockLinks.size,stockUnconfirmedImports:[...stockOpens.values()].filter(open=>![...stockLinks.values()].some(link=>link.openId===open.id)).length,htmlProjectAssetOperations:htmlAssetRecords.size,htmlProjectAssetPendingRecords:htmlAssetEntries.filter(item=>item.name.includes(".tmp-")).length,designBriefJobs:briefRecords.size,designBriefPendingRecords:briefEntries.filter(item=>item.name.includes(".tmp-")).length,planSourceLinks:planLinkRecords.size,planSourceUnlinks:planLinkEntries.filter(item=>/^planunlink-[a-f0-9]{64}\.json$/.test(item.name)).length,planSourcePendingRecords:planLinkEntries.filter(item=>item.name.includes(".tmp-")).length,imageJobs:imageHeads.size,falWorkflowRecords:falEntries.filter(item=>falCurrent.test(item.name)).length,falRealtimeSessions:falRealtimeSessions.size,falRealtimeJobs:falRealtimeJobs.size,falRealtimeImages:falRtImages.size,falRealtimeUnconfirmedImports:[...falRtOpens.values()].filter(open=>![...falRtLinks.values()].some(link=>link.openId===open.id)).length,falRealtimeNativePendingRecords:falRtNativeEntries.filter(item=>item.name.includes(".tmp-")).length,falRealtimePendingRecords:falRealtimeEntries.filter(item=>item.name.includes(".tmp-")).length,falPendingRecords:falEntries.filter(item=>falTemporary.test(item.name)).length,veniceAudioRecords:veniceRecords.size,veniceVideoRecords:videoRecords.size,replicateWorkflowRecords:replicateRecords.size,pixelbinOperations:pixelOps.size,pixelbinOperationReceipts:pixelOpReceipts.size,pixelbinJobs:pixelJobs.size,pixelbinAcceptances:pixelAcceptances.size,pixelbinAssets:pixelAssetRecords.size,pixelbinUnconfirmedImports:[...pixelOpens.values()].filter(open=>![...pixelLinks.values()].some(link=>link.openId===open.id)).length,pixelbinPendingRecords:pixelEntries.filter(item=>item.name.includes(".tmp-")).length+pixelAssets.filter(item=>item.name.includes(".tmp-")).length,externalNativeOpens:externalNativeOpens.size,externalNativeResults:externalNativeResults.size,externalNativeUnconfirmed:[...externalNativeOpens.values()].filter(open=>![...externalNativeResults.values()].some(result=>result.openId===open.id)).length,externalNativePendingRecords:externalNativeEntries.filter(item=>item.name.includes(".tmp-")).length,workflowImages:workflowImages.size,workflowImageUnconfirmedImports:[...workflowImageOpens.values()].filter(open=>![...workflowImageLinks.values()].some(link=>link.openId===open.id)).length,workflowImagePendingRecords:workflowImageEntries.filter(item=>item.name.includes(".tmp-")).length,ecommercePlans:ecommercePlans.size,ecommerceGalleries:ecommerceGalleries.size,ecommercePendingRecords:ecommerceEntries.filter(item=>item.name.includes(".tmp-")).length,figmaMcpPromptReferences:figmaPromptRecords.size,figmaMcpPromptPendingRecords:figmaPromptEntries.filter(item=>item.name.includes(".tmp-")).length,figmaMcpJobs:figmamcpJobRecords.size,figmaMcpResultReceipts:figmamcpResultRecords.size,figmaMcpImages:figmamcpAssetRecords.size,figmaMcpFiles:figmamcpFileRecords.size,figmaHtmlTransfers:figmaHtmlTransfers.size,figmaHtmlPendingRecords:figmaHtmlEntries.filter(item=>item.name.includes(".tmp-")).length,figmaFileUnconfirmedImports:[...figmaFileOpens.values()].filter(open=>![...figmaFileLinks.values()].some(link=>link.openId===open.id)).length,figmaFileNativePendingRecords:figmaFileNativeEntries.filter(item=>item.name.includes(".tmp-")).length,figmaMcpFilePendingRecords:figmamcpFiles.filter(item=>item.name.includes(".tmp-")).length,figmaUploads:figmaUploadRecords.size,figmaUploadPendingRecords:figmaUploadEntries.filter(item=>item.name.includes(".tmp-")).length,figmaMcpUnconfirmedImports:[...figmamcpOpens.values()].filter(open=>![...figmamcpLinks.values()].some(link=>link.openId===open.id)).length,figmaMcpPendingRecords:figmamcpJobs.filter(item=>figmamcpJobTemp.test(item.name)).length+figmamcpResults.filter(item=>figmamcpResultTemp.test(item.name)).length,stitchJobs:stitchJobRecords.size,stitchResultReceipts:stitchResultRecords.size,stitchAssets:stitchAssetRecords.size,stitchImageUnconfirmedImports:[...stitchImageOpens.values()].filter(open=>![...stitchImageLinks.values()].some(link=>link.openId===open.id)).length,stitchImagePendingRecords:stitchImageEntries.filter(item=>item.name.includes(".tmp-")).length,stitchPendingRecords:stitchJobs.filter(item=>stitchJobTemp.test(item.name)).length+stitchResults.filter(item=>stitchResultTemp.test(item.name)).length+stitchAssets.filter(item=>stitchAssetTemp.test(item.name)).length,openAiSvgJobs:svgJobs.size,openAiSvgUnconfirmedImports:[...svgOpens.values()].filter(open=>![...svgLinks.values()].some(link=>link.openId===open.id)).length,figmaExports:figmaExports.size,figmaUnconfirmedImports:[...figmaOpens.values()].filter(open=>![...figmaLinks.values()].some(link=>link.openId===open.id)).length,resources:resourceRecords.size,resourcePackages,externalBundles:externalBundles.length,externalFiles:externalFiles.length,externalLfsFiles:externalLfsFiles.length,userFontFiles:userFontFiles.length,projectFonts:projectFonts.length,pendingFontRecords:resourceEntries.filter(item=>fontTemporary.test(item.name)||userFontTemporary.test(item.name)).length,disabledFontRecords:disabledHeads.size,recoveredFontRecords:recoveredHeads.size+recoveredUserHeads.size,quarantinedFontRecords:quarantineHeads.size,assets:assets.size,runtimes,fontsReferenced:[...fonts].sort(),styles:[...styles],
  usage:'解压到空目录，在 DSH 中把该目录作为工作区打开。原生编辑器由 DesignCraft 提供；项目登记的字体原件随包保留并由插件尝试加载。外部办公软件读取 PPTX 内嵌素材，未随演示嵌入的字体仍需在使用端提供；字体许可应按实际条款确认。',files:[...records.values()]};
 add('designcraft-project.json',json(manifest));
 return createZip(entries);
}
