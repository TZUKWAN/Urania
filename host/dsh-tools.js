import {resolve} from 'node:path';
import * as store from './docstore.js';
import {catalog} from './commands.js';
import {assertSafeJson,SafetyError,workspacePath} from './safety.js';
import {designResourceCatalog,readDesignResource,applyDesignResource} from './design-resources.js';

// Registry-ready ToolDefinition for the installed DSH 0.2.1 API. Root is confined to
// the owning DSH session's workspace; DSH retains tool policy/model/turn ownership.
export function designToolDefinition({jobs,native,images,media,broadcast}){
 const actions=['catalog','state','read','command','native','resource_list','resource_read','resource_apply','image_catalog','image_start','image_status','image_adopt','image_cancel','image_recover_fal','image_convert_returned','image_cancel_remote_fal','variant_list','variant_fork','variant_adopt','media_open','media_commit'];
 return {
  name:'designcraft_workspace',
  description:'LEGACY .dc.json compatibility and explicit older-project migration operations. This tool does not edit the persistent native App currently displayed in the professional workspace. For current visible designs use designcraft_editor; for original OpenDesign rules/templates/source manifests use designcraft_resources. Do not use these legacy command/native/resource_apply/image/media routes to claim the current live workspace supports PhotoCraft, DeckCraft or linked images: their continuous bridges are unfinished. Use this tool only when the user explicitly requests an older compatibility project or migration. Read its actual legacy document+revision before edits; command requires baseRevision. Never edit .dc.json files directly or replace an existing work from a stale snapshot. ok:false means failure, not completion.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{action:{type:'string',enum:actions},root:{type:'string',description:'Optional current workspace or a subdirectory; defaults to the owning DSH session cwd.'},docId:{type:'string'},baseRevision:{type:'string'},payloadJson:{type:'string',description:'JSON object: command={commands:[...]}; native={operation,...}; resource_read={file?:DESIGN.md|design-tokens.json|...}.'},resourceId:{type:'string'}}},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},
  timeoutMs:90000,
  isConcurrencySafe:args=>['catalog','state','read','resource_list','resource_read','image_catalog','image_status','variant_list'].includes(args.action),
  async execute(args,exec){
   try{
    assertSafeJson(args);if(!actions.includes(args.action))throw new SafetyError('未知 DesignCraft 动作',422);
    const allowed=['action','root','docId','baseRevision','payloadJson','resourceId'];if(Object.keys(args).some(key=>!allowed.includes(key)))throw new SafetyError('未知工具参数',422);
    for(const [key,value]of Object.entries(args))if(typeof value!=='string')throw new SafetyError('工具参数必须是字符串: '+key,422);
    const cwd=exec.agent?.session?.header?.cwd;if(!cwd)throw new SafetyError('当前 DSH 会话没有工作目录，请先选择项目',422);
    const root=store.validateRoot(args.root?workspacePath(cwd,args.root,{mustExist:true}):cwd);
    if(args.payloadJson?.length>1024*1024)throw new SafetyError('工具参数超过1MB预算',413);
    const payload=args.payloadJson?JSON.parse(args.payloadJson):{};assertSafeJson(payload);
    let result;
    if(args.action==='catalog')result={ok:true,...catalog(),native:native.catalog(),resources:designResourceCatalog()};
    else if(args.action==='state')result={ok:true,...await jobs.run('state',{root},{signal:exec.signal})};
    else if(args.action==='read')result={ok:true,...await jobs.run('read-doc',{root,id:args.docId},{signal:exec.signal})};
    else if(args.action==='resource_list')result={ok:true,resources:designResourceCatalog()};
    else if(args.action==='resource_read')result={ok:true,...readDesignResource(args.resourceId,payload.file||'DESIGN.md')};
    else if(args.action==='resource_apply')result=store.readDoc(root,args.docId).doc.native?.deck?.mode==='source'?await native.run({root,id:args.docId,operation:'deck.design',resourceId:args.resourceId,baseRevision:args.baseRevision},{signal:exec.signal}):{ok:true,...applyDesignResource(root,args.docId,args.resourceId,args.baseRevision)};
    else if(args.action==='media_open')result=await media.open({...payload,root,docId:args.docId,baseRevision:args.baseRevision},exec.signal);
    else if(args.action==='media_commit')result=await media.commit({...payload,root,childDocId:args.docId,childRevision:args.baseRevision},exec.signal);
    else if(args.action==='variant_list')result=await jobs.run('variant-list',{root,docId:args.docId},{signal:exec.signal});
    else if(args.action==='variant_fork')result=await jobs.run('variant-fork',{...payload,root,docId:args.docId,baseRevision:args.baseRevision},{signal:exec.signal});
    else if(args.action==='variant_adopt')result=await jobs.run('variant-adopt',{...payload,root},{signal:exec.signal});
    else if(args.action==='image_catalog')result={ok:true,...await images.providers.catalogue(payload.provider)};
    else if(args.action==='image_start')result={ok:true,...await images.start({...payload,root,docId:args.docId,baseRevision:args.baseRevision})};
    else if(args.action==='image_status')result={ok:true,job:images.get(root,payload.id)};
    else if(args.action==='image_adopt')result=await images.adopt({...payload,root,baseRevision:args.baseRevision});
    else if(args.action==='image_cancel')result={ok:true,cancelled:images.cancel(root,payload.id)};
    else if(args.action==='image_recover_fal')result={ok:true,...images.recoverFal(root,payload.id)};
    else if(args.action==='image_convert_returned')result={ok:true,...images.convertReturned(root,payload.id,payload.outputId)};
    else if(args.action==='image_cancel_remote_fal')result={ok:true,...await images.cancelRemoteFal(root,payload.id,exec.signal)};
    else if(args.action==='native')result=await native.run({...payload,root,id:args.docId,baseRevision:args.baseRevision},{signal:exec.signal});
    else{
     if(!Array.isArray(payload.commands))throw new SafetyError('缺少 commands 数组',422);
     for(const command of payload.commands)if(command.op==='asset.addFromFile')command.path=workspacePath(root,command.path,{mustExist:true});
     const output=await jobs.run('commands',{root,commands:payload.commands,options:{requireRevision:true,baseRevisions:payload.baseRevisions||{[args.docId]:args.baseRevision},stopOnError:true}},{signal:exec.signal});
     result={ok:output.results.every(item=>item.ok),...output};
    }
    if(['command','native','resource_apply','image_adopt','variant_fork','variant_adopt','media_open','media_commit'].includes(args.action))broadcast(root,{kind:'batch',writer:'dsh-tool'});
    return {json:JSON.stringify(result)};
   }catch(error){return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error?.message||error),...(error.current?{current:error.current}:{}),...(error.candidate?{candidate:error.candidate}:{})})};}
  }
 };
}
export function registerDesignTools(ctx,services,onReady=()=>{}){
 ctx.inject(['tools'],scope=>{
  const dispose=scope.tools.register(designToolDefinition(services));onReady(true);
  scope.effect(()=>()=>{dispose?.();onReady(false);},'designcraft: DSH tool lifetime');
 });
}
