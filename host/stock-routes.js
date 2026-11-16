import {createHash} from 'node:crypto';
import {SafetyError} from './safety.js';
import {readStockSearch,readStockImage,listStockImages,stockCredits} from './stock-images.js';
import {listStockImports,openStockNative,reconcileStockNative} from './stock-native.js';
const API='/designcraft/api/v2/studio/stock-images';
export function stockRoutes(manager,service,{guard,readJsonBody,sendJson}){
 function context(request,response,epoch){
  const view=manager.getView(request.headers['x-designcraft-view'],request.headers['x-designcraft-capability']);if(!epoch||epoch!==view.epoch)throw new SafetyError('设计工作区已切换',409);const root=manager.scope(view.sessionId,view.root),controller=new AbortController(),abort=()=>{if(!response.writableEnded)controller.abort();};
  const current=()=>{if(manager.active.get(view.sessionId)!==view.id||view.epoch!==epoch||manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对图库记录',409);};current();response.once('close',abort);return {view,root,current,signal:controller.signal,release:()=>response.off('close',abort)};
 }
 return [{kind:'exact',path:API,handler:guard(async(request,response)=>{
  if(request.method!=='POST')throw new SafetyError('POST required',405);const body=await readJsonBody(request,16384),scope=context(request,response,body.epoch);const {view,root,current,signal}=scope;
  try{let result;
   if(body.action==='search')result=await service.search(root,body.query,body.offset,signal,current);
   else if(body.action==='search_read')result={search:(await readStockSearch(root,body.searchId)).row};
   else if(body.action==='list')result={...await listStockImages(root),imports:await listStockImports(root)};
   else if(body.action==='capture')result=await service.capture(root,body.searchId,body.candidateId,signal,current);
   else if(body.action==='read'){const saved=await readStockImage(root,body.imageId);result={record:saved.row,candidate:saved.candidate};}
   else if(body.action==='credits')result={credits:await stockCredits(root,body.imageId)};
   else if(body.action==='reconcile')result=await reconcileStockNative(manager,root,view.sessionId,body.id,signal,current);
   else if(body.action==='open')result=await openStockNative(manager,root,view.sessionId,body.imageId,'ui-open-'+String(body.imageId||''),signal,{initiator:'manual',current});
   else throw new SafetyError('未知图库动作',422);
   if(body.action==='open'){if(manager.scope(view.sessionId)!==root)throw new SafetyError('工作区已切换，请回原项目核对图库导入',409);}else current();sendJson(response,200,{ok:true,...result});
  }catch(error){let retained;try{if(manager.scope(view.sessionId)===root)retained=error.retained;}catch{}if(retained&&!response.destroyed&&!response.writableEnded){sendJson(response,error.status||500,{ok:false,error:error instanceof SafetyError?error.message:'图库操作失败',...retained,readStateBeforeRetry:true});return;}throw error;}
  finally{scope.release();}
 })},{kind:'exact',path:API+'/preview',handler:guard(async(request,response)=>{
  if(request.method!=='GET')throw new SafetyError('GET required',405);const params=new URL(request.url,'http://localhost').searchParams,scope=context(request,response,params.get('epoch'));
  try{let bytes,type;if(params.has('imageId')){const saved=await readStockImage(scope.root,params.get('imageId'));bytes=saved.bytes;type=saved.candidate.mime;}
   else{const saved=await service.acquire(scope.root,params.get('searchId'),params.get('candidateId'),scope.signal,scope.current);bytes=saved.bytes;type=saved.candidate.mime;}
   scope.signal.throwIfAborted();scope.current();response.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Designcraft-Sha256':createHash('sha256').update(bytes).digest('hex'),'Content-Security-Policy':"default-src 'none'; sandbox"});response.end(bytes);
  }finally{scope.release();}
 })}];
}
