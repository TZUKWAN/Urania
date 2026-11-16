import {previewPlanMigration,migratePlanResources} from './design-plan-migration.js';
import {createHash,randomUUID} from 'node:crypto';
import {DesignPlans} from './design-plans.js';
import {materialize} from './open-design-tools.js';
import {loadSavedOpenDesignPackage} from './open-design-package.js';
import {restoreDesignPlan,recoverDesignPlan} from './design-plan-restore.js';
import {SafetyError,assertSafeJson} from './safety.js';
import {readExternalSkillFiles,materializeExternalSkillFile,materializeExternalLfsFile} from './external-skill-bundles.js';
import {readFigmaExport} from './figma-source.js';
import {CreativeDirectorResource} from './creative-director-resource.js';
import {createPlanSourceLink,unlinkPlanSource,readPlanSourceLink,listPlanSourceLinks,recoverPlanSourceLink} from './design-plan-links.js';

const sha=value=>createHash('sha256').update(value).digest('hex');

export function designPlanToolDefinition(manager,library){
 return {name:'designcraft_plan',description:'Manage versioned project design briefs and visual plans in the current DSH session. link explicitly associates a published plan id/revision with an exact saved native or HTML sourceId/sourceRevision using a stable operationKey; links lists declarations, verify_link checks their real source bytes, unlink disables a declaration without deleting either artifact, and recover_link restores a complete local candidate. This association is a declaration, not proof of model behavior or visual quality. list, history and read return real saved plans and versions. create/save persist the supplied brief and plan; save requires the exact latest baseRevision. restore uses id, historical revision and latest baseRevision to save that exact content as a new version without overwriting later edits. recoverable lists written but unpublished candidates; candidate reads one and recover publishes it only when its base still matches. If its base diverged, preserve it and create a separate plan. resources references pinned OpenDesign files; externalResources references exact files from a previously saved external bundle; directorResources references explicitly selected files from the pinned creative-director bundle; figmaResources references already saved Figma exports. Specifying one source list replaces that type and preserves the other types. Original files and provenance are verified and retained before commit. Read the real source before claiming to have used it. If stopped or a reply is lost, list/read the saved state before retrying. A plan is not a generated design and does not run an external agent or script.',
  parameters:{type:'object',additionalProperties:false,required:['action'],properties:{
   action:{type:'string',enum:['list','history','read','recoverable','candidate','recover','create','save','restore','migration_preview','migrate_resources','links','link','unlink','verify_link','recover_link']},id:{type:'string'},revision:{type:'string'},baseRevision:{type:['string','null']},sourceType:{type:'string',enum:['native','html']},sourceId:{type:'string'},sourceRevision:{type:'string'},operationKey:{type:'string'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},candidate:{type:'string'},
   migrations:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['resourceId','file','expectedTargetSha256'],properties:{resourceId:{type:'string'},file:{type:'string'},expectedTargetSha256:{type:'string'}}}},
   title:{type:'string'},brief:{type:'string'},content:{type:'string'},
   resources:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['id','file'],properties:{id:{type:'string'},file:{type:'string'},gitSha1:{type:'string'}}}},
   externalResources:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['bundleId','file'],properties:{bundleId:{type:'string'},file:{type:'string'},gitSha1:{type:'string'}}}},
   directorResources:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['file'],properties:{file:{type:'string'},gitSha1:{type:'string'}}}},
   figmaResources:{type:'array',maxItems:40,items:{type:'object',additionalProperties:false,required:['exportId'],properties:{exportId:{type:'string'}}}}
  }},
  output:{schema:{type:'object',additionalProperties:false,required:['json'],properties:{json:{type:'string'}}},render:(_args,value)=>[{type:'text',text:value.json}]},
  timeoutMs:180000,isConcurrencySafe:args=>['list','history','read','recoverable','candidate','links','verify_link'].includes(args.action),
  async execute(args,execution){
   const retained=[];let committed,linkContext;
   try{
    assertSafeJson(args);execution.signal?.throwIfAborted();
    const session=execution.agent?.session;if(!session?.id)throw new SafetyError('需要当前 DSH 对话',422);
    const root=manager.scope(session.id),plans=new DesignPlans(root);
    const assertScope=()=>{if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已改变，请回原项目核对计划关联',409);};
    if(args.action==='links'){const result=await listPlanSourceLinks(root,{planId:args.id,offset:args.offset??0,limit:args.limit??30});assertScope();return {json:JSON.stringify({ok:true,...result})};}
    if(args.action==='verify_link'){const result=await readPlanSourceLink(root,args.id);assertScope();return {json:JSON.stringify({ok:true,...result})};}
    if(args.action==='unlink'){const result=await unlinkPlanSource(root,args.id,execution.signal,assertScope);return {json:JSON.stringify({ok:true,...result,...(execution.signal?.aborted?{completedAfterCancel:true}:{})})};}
    if(args.action==='recover_link'){const result=await recoverPlanSourceLink(root,args.candidate,execution.signal,assertScope);return {json:JSON.stringify({ok:true,...result,...(execution.signal?.aborted?{completedAfterCancel:true}:{})})};}
    if(args.action==='link'){const key=args.operationKey||execution.callId;if(typeof key!=='string'||!key||key.length>250)throw new SafetyError('计划关联需要稳定操作身份',422);linkContext={sessionId:session.id,root,operationKey:key};const operationId=sha(session.id+'\0'+key),result=await createPlanSourceLink(root,{planId:args.id,planRevision:args.revision,sourceType:args.sourceType,sourceId:args.sourceId,sourceRevision:args.sourceRevision,actor:'agent',operationId},execution.signal,assertScope);return {json:JSON.stringify({ok:true,...result,operationKey:key,...(execution.signal?.aborted?{completedAfterCancel:true}:{})})};}
    if(args.action==='list')return {json:JSON.stringify({ok:true,items:plans.list()})};
    if(args.action==='history')return {json:JSON.stringify({ok:true,id:args.id,items:plans.history(args.id)})};
    if(args.action==='read')return {json:JSON.stringify({ok:true,...plans.read(args.id,args.revision)})};
    if(args.action==='recoverable')return {json:JSON.stringify({ok:true,...plans.recoverable(args.id)})};
    if(args.action==='candidate')return {json:JSON.stringify({ok:true,...plans.unpublished(args.id,args.revision)})};
    if(args.action==='recover'){
     committed=await recoverDesignPlan(manager,library,root,{id:args.id,revision:args.revision,baseRevision:args.baseRevision},execution.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已改变，未恢复计划',409);});
     return {json:JSON.stringify({ok:true,...committed})};
    }
    if(args.action==='migration_preview')return {json:JSON.stringify({ok:true,...previewPlanMigration(root,args)})};
    if(args.action==='migrate_resources'){committed=migratePlanResources(manager,root,args,execution.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('工作区已切换，未迁移计划',409);});return {json:JSON.stringify({ok:true,...committed})};}
    if(args.action==='restore'){
     committed=await restoreDesignPlan(manager,library,root,{id:args.id,revision:args.revision,baseRevision:args.baseRevision},execution.signal,()=>{if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已改变，未恢复计划',409);});
     return {json:JSON.stringify({ok:true,...committed})};
    }
    if(!['create','save'].includes(args.action))throw new SafetyError('未知设计计划操作',422);
    if(typeof args.title!=='string'||!args.title.trim()||args.title.length>200||typeof args.brief!=='string'||!args.brief.trim()||args.brief.length>40000||typeof args.content!=='string'||!args.content.trim()||args.content.length>80000)throw new SafetyError('请提供实际简报和计划内容，且不要超过大小预算',422);
    const id=args.action==='create'?(args.id||'plan-'+sha(session.id+'\0'+String(execution.callId||randomUUID())).slice(0,32)):args.id;
    let current=null;try{current=plans.read(id);}catch(error){if(error.status!==404)throw error;}
    if(args.action==='save'&&!current)throw new SafetyError('设计计划不存在',404);
    const base=args.action==='create'?null:args.baseRevision;
    if(args.action==='save'&&current.revision!==base&&current.plan.parentRevision!==base)throw new SafetyError('设计计划已有新版本，请先读取最新内容',409);
    let sources=current?.plan.sources||[];
    if(args.resources!==undefined){
     if(!Array.isArray(args.resources)||args.resources.length>40)throw new SafetyError('设计计划来源超过数量预算',413);
     const seen=new Set(),selected=[];let total=0;
     for(const item of args.resources){
      if(!item||typeof item!=='object'||Array.isArray(item))throw new SafetyError('设计计划来源必须为资源对象',422);
      const pack=library.index().packages.get(item.id),entry=pack?.fileMap.get(item.file),key=String(item.id)+'\0'+String(item.file);
      if(!entry||entry.mode==='120000'||entry.bytes<1||entry.bytes>1024*1024||item.gitSha1!==undefined&&item.gitSha1!==entry.gitSha1||seen.has(key))throw new SafetyError('设计计划引用的固定资源无效或重复',422);
      if((total+=entry.bytes)>8*1024*1024)throw new SafetyError('设计计划引用超过 8 MiB 预算',413);
      seen.add(key);selected.push(item);
     }
     sources=sources.filter(source=>!source.resourceId.startsWith('resource-'));const snapshots=new Map();
     for(const item of selected){
      execution.signal?.throwIfAborted();
      if(!snapshots.has(item.id))snapshots.set(item.id,await loadSavedOpenDesignPackage(library,root,item.id));
      const saved=await materialize(library,root,item.id,item.file,execution.signal,snapshots.get(item.id));retained.push(saved.receipt.id);
      sources.push({resourceId:saved.receipt.id,packageId:item.id,file:item.file,gitSha1:saved.receipt.gitSha1,sha256:saved.receipt.sha256});
     }
    }
    if(args.figmaResources!==undefined){
     if(!Array.isArray(args.figmaResources)||args.figmaResources.length>40)throw new SafetyError('设计计划 Figma 来源超过数量预算',413);
     const seen=new Set(),selected=[];let total=0;
     for(const item of args.figmaResources){
      if(!item||!/^figmaexport-[a-f0-9]{64}$/.test(item.exportId||'')||seen.has(item.exportId))throw new SafetyError('设计计划 Figma 来源无效或重复',422);
      execution.signal?.throwIfAborted();const {receipt,bytes}=await readFigmaExport(root,item.exportId);if((total+=bytes.length)>32*1024*1024)throw new SafetyError('设计计划 Figma 原件超过 32 MiB 预算',413);seen.add(item.exportId);selected.push(receipt);
     }
     sources=sources.filter(source=>!source.resourceId.startsWith('figmaexport-'));
     for(const receipt of selected)sources.push({resourceId:receipt.id,fileKey:receipt.fileKey,nodeId:receipt.nodeId,version:receipt.version,format:receipt.format,sha256:receipt.sha256});
    }
    if(args.externalResources!==undefined){
     if(!Array.isArray(args.externalResources)||args.externalResources.length>40)throw new SafetyError('设计计划外部来源超过数量预算',413);
     const seen=new Set(),groups=new Map(),lfsKeys=new Set();let total=0;
     for(const item of args.externalResources){
      if(!item||!/^externalbundle-[a-f0-9]{64}$/.test(item.bundleId||'')||typeof item.file!=='string'||item.file.length>1000||item.gitSha1!==undefined&&!/^[a-f0-9]{40}$/.test(item.gitSha1))throw new SafetyError('设计计划外部来源无效',422);
      const key=item.bundleId+'\0'+item.file;if(seen.has(key))throw new SafetyError('设计计划外部来源重复',422);seen.add(key);
      if(!groups.has(item.bundleId))groups.set(item.bundleId,[]);groups.get(item.bundleId).push(item);
     }
     for(const [bundleId,items] of groups)for(let start=0;start<items.length;start+=16){
      const batch=items.slice(start,start+16),verified=await readExternalSkillFiles(library,root,bundleId,batch.map(item=>item.file),execution.signal);
      for(const item of batch){const row=verified.files.find(file=>file.path===item.file),size=row?.metadata.lfs?row.metadata.lfs.size:row?.bytes.length;if(!row||!size||size>1024*1024||item.gitSha1!==undefined&&item.gitSha1!==row.metadata.gitSha1)throw new SafetyError('计划外部文件缺失、超限或身份不一致',422);if(row.metadata.lfs)lfsKeys.add(item.bundleId+'\0'+item.file);if((total+=size)>8*1024*1024)throw new SafetyError('计划外部来源超过 8 MiB 预算',413);}
     }
     sources=sources.filter(source=>!source.resourceId.startsWith('externalfile-')&&!source.resourceId.startsWith('externallfs-'));
     const assertCurrent=()=>{if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已改变，未保存计划',409);};
     for(const item of args.externalResources){
      execution.signal?.throwIfAborted();assertCurrent();const saved=await (lfsKeys.has(item.bundleId+'\0'+item.file)?materializeExternalLfsFile:materializeExternalSkillFile)(library,root,item.bundleId,item.file,execution.signal,assertCurrent);
      if(item.gitSha1!==undefined&&saved.file.gitSha1!==item.gitSha1)throw new SafetyError('计划外部文件身份已变化，未保存计划',409);
      retained.push(saved.file.id);sources.push({resourceId:saved.file.id,bundleId:item.bundleId,file:item.file,gitSha1:saved.file.gitSha1,sha256:saved.file.sha256});
     }
    }
    if(args.directorResources!==undefined){
     if(!Array.isArray(args.directorResources)||args.directorResources.length>40)throw new SafetyError('创意指导来源超过数量预算',413);
     const director=new CreativeDirectorResource(),seen=new Set(),selected=[];let total=0;
     for(const item of args.directorResources){
      if(!item||typeof item.file!=='string'||item.file.length>1000||item.gitSha1!==undefined&&!/^[a-f0-9]{40}$/.test(item.gitSha1)||seen.has(item.file))throw new SafetyError('创意指导来源无效或重复',422);
      const entry=director.index().files.get(item.file);if(!entry||entry.bytes<1||entry.bytes>1024*1024||(total+=entry.bytes)>8*1024*1024)throw new SafetyError('创意指导文件缺失或超过预算',413);
      execution.signal?.throwIfAborted();const file=director.read({file:item.file,limit:1});
      if(item.gitSha1!==undefined&&item.gitSha1!==file.gitSha1)throw new SafetyError('创意指导文件身份不一致',409);
      seen.add(item.file);selected.push(file);
     }
     sources=sources.filter(source=>!source.resourceId.startsWith('external-'));
     if(sources.length+selected.length>40)throw new SafetyError('设计计划来源总数超过 40 项',413);
     if(selected.length){
      execution.signal?.throwIfAborted();assertScope();const saved=director.markUsed(root);retained.push(saved.usage.id);
      for(const file of selected)sources.push({resourceId:saved.usage.id,file:file.file,gitSha1:file.gitSha1,sha256:file.sha256});
     }
    }
    if(sources.length>40)throw new SafetyError('设计计划来源总数超过 40 项',413);
    execution.signal?.throwIfAborted();if(manager.scope(session.id)!==root)throw new SafetyError('对话工作区已改变，未保存计划',409);
    committed=plans.save({id,baseRevision:base,title:args.title,brief:args.brief,content:args.content,sources});
    try{manager.onChange(root,{kind:'design-plan',id,revision:committed.revision});}catch{/* The immutable plan remains saved if a subscriber disappears. */}
    return {json:JSON.stringify({ok:true,...committed,...(execution.signal?.aborted?{completedAfterCancel:true}:{}),storedSources:retained})};
   }catch(error){
    let linkRetained;try{if(linkContext&&manager.scope(linkContext.sessionId)===linkContext.root)linkRetained=error.retained;}catch{}return {json:JSON.stringify({ok:false,status:error.status||500,error:String(error.message||error),storedSources:retained,...(committed?{committed}:{}),...(linkRetained?{retained:linkRetained}:{}),...(linkContext?{operationKey:linkContext.operationKey}:{}),readStateBeforeRetry:true})};
   }
  }
 };
}
export function registerDesignPlanTool(ctx,manager,library){
 ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(designPlanToolDefinition(manager,library));scope.effect(()=>()=>dispose?.(),'designcraft: versioned design plans');});
}
