import {createHash} from 'node:crypto';
import {SafetyError} from './safety.js';
import {startFigmaUpload,getFigmaUpload,listFigmaUploads,listFigmaUploadInputs,recoverFigmaUpload} from './figma-mcp-upload.js';
import {listFigmaFileNative,recoverFigmaFileOpen,reconcileFigmaFileNative,openFigmaFileNative} from './figma-mcp-file-native.js';
import {sendFigmaHtml,listFigmaHtmlTransfers,getFigmaHtmlTransfer,pendingFigmaHtmlTransfers,recoverFigmaHtmlTransfer,inspectFigmaHtmlInline,suggestFigmaHtmlInline} from './figma-html-transfer.js';

export function figmaMcpRoutes(manager,service,{guard,readJsonBody,sendJson}){
 const base='/designcraft/api/v2/studio/figma-mcp';
 return [{kind:'exact',path:base,handler:guard(async(request,response)=>{
  if(request.method!=='POST')throw new SafetyError('POST required',405);const body=await readJsonBody(request,512*1024),view=manager.getView(request.headers['x-designcraft-view'],request.headers['x-designcraft-capability']);
  if(!body.epoch||body.epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);if(body.source!==undefined&&!['remote','desktop'].includes(body.source)||body.source==='desktop'&&['start','upload','send-html'].includes(body.action))throw new SafetyError('Figma 桌面 MCP 不支持远端写入、上传或发送网页',422);const root=manager.scope(view.sessionId,view.root),write=['start','prompt-capture','prompt-recover','capture','recover-asset','open','reconcile','recover-saved','upload','upload-recover','capture-file','recover-file','file-native-open','file-native-recover','file-native-reconcile','send-html','html-transfer-recover'].includes(body.action);if(write)manager.fileActionIdle(view,body.epoch);
  const controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};response.once('close',abort);
  const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==body.epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对 Figma MCP 记录',409);if(write)manager.fileActionIdle(view,body.epoch);};
  try{
   let result;
   if(body.action==='catalog')result=await service.catalog(controller.signal,body.source||'remote');
   else if(body.action==='read')result=await service.read(root,{tool:body.tool,args:body.args,schemaSha256:body.schemaSha256,source:body.source||'remote'},controller.signal);
   else if(body.action==='prompt-catalog')result=await service.promptCatalog(controller.signal,body.source||'remote');
   else if(body.action==='prompt-read')result=await service.promptRead(root,{source:body.source||'remote',args:body.args||{},promptSha256:body.promptSha256},controller.signal);
   else if(body.action==='prompt-messages')result=service.promptMessages(root,body.snapshotId);
   else if(body.action==='prompt-capture')result=await service.capturePrompt(root,body.snapshotId,body.messageIndex,controller.signal,current);
   else if(body.action==='prompt-list')result=await service.savedPrompts(root);
   else if(body.action==='prompt-text')result=await service.savedPromptText(root,body.id,{offset:body.offset??0,limit:12000});
   else if(body.action==='prompt-recover')result=await service.recoverPrompt(root,body.candidate,controller.signal,current);
   else if(body.action==='snapshot')result=service.readSnapshot(root,body.snapshotId,{offset:body.offset??0,limit:12000});
   else if(body.action==='links')result=service.links(root,body.snapshotId);
   else if(body.action==='candidates')result=service.candidates(root,body.snapshotId);
   else if(body.action==='capture')result=await service.capture(root,body.snapshotId,body.candidateId,controller.signal,current);
   else if(body.action==='assets')result=await service.assets(root);
   else if(body.action==='recover-asset')result=await service.recoverAsset(root,body.candidate,controller.signal,current);
   else if(body.action==='reconcile')result=await service.reconcile(root,body.id,controller.signal,current);
   else if(body.action==='file-candidates')result=service.fileCandidates(root,body.snapshotId);
   else if(body.action==='capture-file')result=await service.captureFile(root,body.snapshotId,body.candidateId,controller.signal,current);
   else if(body.action==='files')result=await service.files(root);
   else if(body.action==='recover-file')result=await service.recoverFile(root,body.candidate,controller.signal,current);
   else if(body.action==='file-native-list')result=await listFigmaFileNative(root);
   else if(body.action==='file-native-recover')result=await recoverFigmaFileOpen(root,body.candidate,controller.signal,current);
   else if(body.action==='file-native-reconcile')result=await reconcileFigmaFileNative(manager,root,body.id,controller.signal,current);
   else if(body.action==='file-native-open')result=await openFigmaFileNative(manager,root,view.sessionId,body.assetId,'ui-open-'+String(body.assetId||''),controller.signal);
   else if(body.action==='html-transfers')result={items:await listFigmaHtmlTransfers(root),pending:await pendingFigmaHtmlTransfers(root)};
   else if(body.action==='html-transfer-status')result=await getFigmaHtmlTransfer(root,body.id,service);
   else if(body.action==='html-transfer-recover')result=await recoverFigmaHtmlTransfer(root,body.candidate,controller.signal,current);
   else if(body.action==='inspect-html-inline')result=await inspectFigmaHtmlInline(root,body.htmlId,body.htmlRevision,body.inlineRules);
   else if(body.action==='suggest-html-inline')result=await suggestFigmaHtmlInline(root,body.htmlId,body.htmlRevision);
   else if(body.action==='send-html'){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('Figma 网页转移操作身份无效',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await sendFigmaHtml(service,root,{htmlId:body.htmlId,htmlRevision:body.htmlRevision,argsTemplate:body.args,pointer:body.pointer,schemaSha256:body.schemaSha256,operationId,inlineRules:body.inlineRules},controller.signal,current);
   }
   else if(body.action==='upload-inputs')result=listFigmaUploadInputs(root,{offset:body.offset??0,limit:100});
   else if(body.action==='upload-list')result={uploads:await listFigmaUploads(root)};
   else if(body.action==='upload-status')result={upload:await getFigmaUpload(root,body.id)};
   else if(body.action==='upload-recover')result=await recoverFigmaUpload(root,body.id,current);
   else if(body.action==='upload'){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('Figma 上传操作身份无效',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await startFigmaUpload(service,root,{assetName:body.assetName,args:body.args,schemaSha256:body.schemaSha256,operationId},controller.signal,current);
   }
   else if(body.action==='jobs')result={jobs:service.list(root)};
   else if(body.action==='job')result={job:service.get(root,body.id)};
   else if(body.action==='result')result=service.readResult(root,body.id,{offset:body.offset??0,limit:12000});
   else if(body.action==='recover-saved')result=service.recoverSaved(root,body.id,current);
   else if(body.action==='stop')result={stopped:service.stop(root,body.id)};
   else if(body.action==='start'){
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.operationKey||''))throw new SafetyError('Figma MCP 操作身份无效',422);const operationId=createHash('sha256').update(view.sessionId+'\0'+body.operationKey).digest('hex');result=await service.start(root,{tool:body.tool,args:body.args,schemaSha256:body.schemaSha256,operationId},controller.signal,current);
   }else if(body.action==='open'){
    result=await service.openImage(root,view.sessionId,body.assetId,'ui-open-'+String(body.assetId||''),controller.signal);
   }else throw new SafetyError('未知 Figma MCP 操作',422);
   if(['open','file-native-open'].includes(body.action)){if(manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对素材导入',409);}else current();sendJson(response,200,{ok:true,...result});
  }catch(error){let retained;try{if(manager.active.get(view.sessionId)===view.id&&view.epoch===body.epoch&&manager.scope(view.sessionId)===root)retained=error.retained;}catch{}if(retained&&!response.destroyed&&!response.writableEnded){sendJson(response,error.status||500,{ok:false,error:String(error.message||error),...retained,readStateBeforeRetry:true});return;}throw error;
  }finally{response.off('close',abort);}
 })}];
}
