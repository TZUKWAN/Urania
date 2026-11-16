import {SafetyError,assertSafeJson} from './safety.js';
import {readStockSearch,readStockImage,listStockImages,stockCredits} from './stock-images.js';
import {listStockImports,openStockNative,reconcileStockNative} from './stock-native.js';

export function stockToolDefinition(manager,service){
 return {name:'designcraft_stock',
  description:'Find real PNG/JPEG pictures from Wikimedia Commons for the current DesignCraft project. search performs an actual public API query and saves its original response and candidate metadata; search_read reopens that saved response; list lists local records; capture explicitly downloads one candidate, rechecks its source version/metadata, validates headers/dimensions and saves actual bytes and attribution. read/credits verify the saved picture and source without network. open imports a saved image into a separate native Photo source using a stable operationKey; the same confirmed reservation reopens that source instead of importing again; reconcile checks a prior open reservation against a unique actual saved source and never replays an uncertain import. Use the existing native derive/place flow to put edited pictures in posters or presentations. Source metadata is not a rights clearance; report the author/license and original Commons description page. Downloads can be scaled versions. This is DesignCraft public Commons integration, not OpenDesign/Vela project authorization, and functionality has not been verified in this build. Do not claim results without a successful real response.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:['search','search_read','list','capture','read','credits','open','reconcile']},query:{type:'string'},offset:{type:'integer',minimum:0,maximum:1000},searchId:{type:'string'},candidateId:{type:'string'},id:{type:'string'},imageId:{type:'string'},operationKey:{type:'string'}}},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},timeoutMs:120000,isConcurrencySafe:args=>['search_read','list','read','credits'].includes(args.action),
  async execute(args,exec){
   let session,root;
   try{
    assertSafeJson(args);exec.signal?.throwIfAborted();session=exec.agent?.session;if(!session?.id||!session.header?.cwd)throw new SafetyError('需要有工作区的当前 DSH 对话',422);root=manager.scope(session.id);const current=()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换，请回原项目核对图库记录',409);};let result;
    if(args.action==='search')result=await service.search(root,args.query,args.offset,exec.signal,current);
    else if(args.action==='search_read')result={search:(await readStockSearch(root,args.searchId||args.id)).row};
    else if(args.action==='list')result={...await listStockImages(root),imports:await listStockImports(root)};
    else if(args.action==='capture')result=await service.capture(root,args.searchId,args.candidateId,exec.signal,current);
    else if(args.action==='read'){const saved=await readStockImage(root,args.imageId||args.id);result={record:saved.row,candidate:saved.candidate};}
    else if(args.action==='credits')result={credits:await stockCredits(root,args.imageId||args.id)};
    else if(args.action==='open')result=await openStockNative(manager,root,session.id,args.imageId||args.id,args.operationKey||exec.callId,exec.signal,{current});
    else if(args.action==='reconcile')result=await reconcileStockNative(manager,root,session.id,args.id,exec.signal,current);
    else throw new SafetyError('未知图库动作',422);
    current();return {json:JSON.stringify({ok:true,...result})};
   }catch(error){let retained;try{if(session?.id&&root&&manager.scope(session.id)===root)retained=error.retained;}catch{}return {json:JSON.stringify({ok:false,status:error.status||500,error:error instanceof SafetyError?error.message:'图库操作失败，请保留记录后核对',...retained,readStateBeforeRetry:true})};}
  }
 };
}
export function registerStockTool(ctx,manager,service){ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(stockToolDefinition(manager,service));scope.effect(()=>()=>dispose?.(),'designcraft: Commons image search');});}
