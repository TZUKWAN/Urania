/** Current-session OD workflows: real pinned rules, plans, local writes and artifact receipts. */
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,readdirSync,lstatSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {atomicCreate,atomicWrite} from './persistence.js';
import {readAsset,saveAsset} from './docstore.js';
import {workflowContext} from './od-workflow-context.js';
import {materializeExternalSkillFile} from './external-skill-bundles.js';
import {DesignPlans} from './design-plans.js';
import {NativeSourceStore} from './native-source-store.js';
import {HtmlArtifacts} from './html-artifacts.js';
import {createPlanSourceLink,readPlanSourceLink} from './design-plan-links.js';
import {auditSavedNativeColors} from './native-color-source.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';
const HASH=/^[a-f0-9]{64}$/,ID=/^odflow-[a-f0-9]{64}$/;
const sha=raw=>createHash('sha256').update(raw).digest('hex'),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const digest=value=>sha(Buffer.from(JSON.stringify(value)));
const directory=root=>workspacePath(root,'design/.designcraft/local-workflows');
const file=(root,id)=>{if(!ID.test(id||''))throw new SafetyError('本地工作流身份无效',422);return join(directory(root),id+'.json');};
const excluded=id=>/(?:figma|stitch|pixelbin|replicate|vela|stock-search|agent-browser|(?:^|\/)pr-|(?:^|[-/])remotion(?:[-/]|$)|(?:^|[-/])fal(?:[-/]|$)|venice|od-next-media-inputs|web-clone|chat-motion-overlay|pull-request|github-pr|(?:^|[-/])video(?:[-/]|$))/i.test(id);
const KINDS=new Set(['vector','photo','deck','html','report']);
function seal(value){const {revision,...body}=value;return {...body,revision:digest(body)};}
function validate(row){
 assertSafeJson(row);if(!row||row.schema!==1||row.kind!=='local-design-workflow'||!ID.test(row.id||'')||!HASH.test(row.revision||'')||seal(row).revision!==row.revision||typeof row.skillId!=='string'||excluded(row.skillId)||!KINDS.has(row.outputKind)||!HASH.test(row.requestHash||'')||!/^plan-[a-f0-9]{32}$/.test(row.planId||'')||!HASH.test(row.planRevision||'')||!Array.isArray(row.rules)||row.rules.length<1||row.rules.length>40||!Array.isArray(row.artifacts)||row.artifacts.length>100||!['awaiting_model','has_artifacts','completed','cancelled'].includes(row.status)||!row.readRanges||typeof row.readRanges!=='object')throw new SafetyError('本地工作流记录或摘要无效',409);
 for(const rule of row.rules)if(typeof rule.assetName!=='string'||!HASH.test(rule.sha256||'')||!Number.isSafeInteger(rule.characters)||rule.characters<1)throw new SafetyError('本地工作流规则记录无效',409);return row;
}
function read(root,id){const path=file(root,id);let bytes;try{const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>512*1024)throw new SafetyError('本地工作流记录类型或大小无效',409);bytes=readFileSync(path);}catch(error){if(error.code==='ENOENT')throw new SafetyError('本地工作流不存在',404);throw error;}let row;try{row=JSON.parse(bytes);}catch{throw new SafetyError('本地工作流记录损坏',409);}validate(row);if(row.id!==id)throw new SafetyError('本地工作流身份不一致',409);return row;}
function update(root,id,expected,change){
 const path=file(root,id),lock=path+'.lock',token=JSON.stringify({pid:process.pid,id:randomUUID()});mkdirSync(directory(root),{recursive:true});
 try{writeFileSync(lock,token,{flag:'wx'});}catch(error){throw new SafetyError(error.code==='EEXIST'?'工作流正在另一处更新，请稍后读取；中断残留锁可通过 recover_lock 清理':'工作流无法取得写入锁',409);}
 try{const row=read(root,id);if(expected&&row.revision!==expected)throw new SafetyError('工作流已有新版本，请重新读取',409);if(['completed','cancelled'].includes(row.status))throw new SafetyError('工作流已结束，原件保留，请创建新的工作流',409);const next=seal({...row,...change(row),updatedAt:new Date().toISOString()});validate(next);atomicWrite(path,json(next));return next;}
 finally{try{if(readFileSync(lock,'utf8')===token)unlinkSync(lock);}catch{}}
}
function actualRule(root,rule){const bytes=readAsset(root,rule.assetName);if(!bytes||sha(bytes)!==rule.sha256)throw new SafetyError('工作流的实际规则原件缺失或改变',409);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('工作流规则不是UTF-8',409);}if(text.length!==rule.characters)throw new SafetyError('规则字符数与保存记录不一致',409);return text;}
function rangesCover(ranges,length){let at=0;for(const [start,end]of [...(ranges||[])].sort((a,b)=>a[0]-b[0])){if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>length)return false;if(start>at)return false;at=Math.max(at,end);}return at>=length;}
async function inspectArtifact(root,item){
 if(item.sourceType==='native'){const source=await new NativeSourceStore(root).source(item.sourceId,item.sourceRevision);return {sourceHash:source.meta.sourceHash,engine:source.meta.engine};}
 if(item.sourceType==='html'){const source=await new HtmlArtifacts(root).read(item.sourceId,item.sourceRevision);return {sourceHash:source.revision,engine:'html'};}
 if(item.sourceType==='report'){const bytes=readAsset(root,item.assetName);if(!bytes)throw new SafetyError('工作流报告原件不存在',409);return {sourceHash:sha(bytes),engine:'report'};}
 throw new SafetyError('工作流产物类型无效',422);
}
export class LocalDesignWorkflows{
 constructor(manager,library){this.manager=manager;this.library=library;}
 catalog(){return {items:[...this.library.index().packages.keys()].filter(id=>id.startsWith('skills/')&&!excluded(id)).map(id=>({id,executionOwner:'current_dsh_session',artifactKinds:[...KINDS]})),connectsExcludedServices:false,note:'通用本地编排由当前DSH模型读取真实规则并操作已有专业工具；不是原版脚本/额外服务的兼容承诺。'};}
 async prepare(root,input,operationId,signal,current){
  const {skillId,bundleId,file:chosen,title,brief,outputKind='vector'}=input;
  if(typeof skillId!=='string'||!skillId.startsWith('skills/')||excluded(skillId)||!KINDS.has(outputKind)||typeof title!=='string'||!title.trim()||title.length>200||typeof brief!=='string'||!brief.trim()||brief.length>40000||!HASH.test(operationId||''))throw new SafetyError('请选择保留范围内的本地设计规则、真实简报及输出类型',422);
  const id='odflow-'+operationId,requestHash=digest({skillId,bundleId:bundleId||null,file:chosen||null,title,brief,outputKind});
  try{const prior=read(root,id);if(prior.requestHash!==requestHash)throw new SafetyError('该工作流身份已用于其他输入，未覆盖',409);return this.status(root,id);}catch(error){if(error.status!==404)throw error;}
  const context=await workflowContext(this.library,root,{id:skillId,bundleId,file:chosen,offset:0,limit:20000},signal);current?.();
  if(context.catalogueOnly)throw new SafetyError('该入口只有目录说明，请先通过现有原包入口保留真实规则；不能把目录当成执行规则',422);
  const ruleFile=context.source.file,materialized=bundleId?await materializeExternalSkillFile(this.library,root,bundleId,ruleFile,signal,current):await (await import('./open-design-tools.js')).materialize(this.library,root,skillId,ruleFile,signal),receipt=materialized.file||materialized.receipt;
  const raw=readAsset(root,receipt.assetName);if(!raw||sha(raw)!==receipt.sha256||raw.length>2*1024*1024)throw new SafetyError('本地工作流实际规则原件无效或超过预算',409);let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{throw new SafetyError('规则不是UTF-8',422);}
  const source=bundleId?{resourceId:receipt.id,bundleId,file:receipt.file,gitSha1:receipt.gitSha1,sha256:receipt.sha256}:{resourceId:receipt.id,packageId:skillId,file:receipt.file,gitSha1:receipt.gitSha1,sha256:receipt.sha256};
  const planId='plan-'+digest(['local-workflow-plan',id]).slice(0,32),plans=new DesignPlans(root),content='# '+title.trim()+'\n\n## 用户简报\n'+brief+'\n\n## 当前DSH执行路线\n输出：'+outputKind+'。读取已固定规则及其引用，使用现有专业编辑工具创建或修改真实源。\n规则：'+skillId+'/'+receipt.file+' / '+receipt.sha256+'\n\n## 完成条件\n规则分页已返回给当前会话；实际作品版本或报告已保存并关联。保存关联不证明视觉质量或模型遵循程度。';
  let plan;try{plan=plans.read(planId);if(plan.plan.title!==title.trim()||plan.plan.brief!==brief||plan.plan.content!==content||JSON.stringify(plan.plan.sources)!==JSON.stringify([source]))throw new SafetyError('工作流的计划身份已用于其他输入',409);}catch(error){if(error.status!==404)throw error;current?.();plan=plans.save({id:planId,baseRevision:null,title:title.trim(),brief,content,sources:[source]});}
  signal?.throwIfAborted();current?.();const at=new Date().toISOString(),rule={...source,assetName:receipt.assetName,characters:text.length},row=seal({schema:1,kind:'local-design-workflow',id,requestHash,skillId,outputKind,planId,planRevision:plan.revision,rules:[rule],readRanges:{},artifacts:[],status:'awaiting_model',createdAt:at,updatedAt:at,executionOwner:'current_dsh_session'});
  mkdirSync(directory(root),{recursive:true});if(!atomicCreate(file(root,id),json(row))){const prior=read(root,id);if(prior.requestHash!==requestHash)throw new SafetyError('工作流创建冲突，未覆盖',409);}
  return {...await this.status(root,id),nextAction:'workflow_read',contextTools:context.executionRoute?.tools||['designcraft_editor','designcraft_html','designcraft_image_studio'],note:'已保存真实规则引用和计划；尚未生成作品。接续使用当前DSH会话，不启动第二个模型循环，不自动运行脚本或额外平台。'};
 }
 readRule(root,{runId,revision,offset=0,limit=20000},actor='agent'){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>40000)throw new SafetyError('工作流规则读取范围无效',422);
  const row=read(root,runId),rule=row.rules[0],text=actualRule(root,rule);if(offset>text.length)throw new SafetyError('规则偏移超过实际内容',422);const end=Math.min(text.length,offset+limit),next=actor==='agent'&&!['completed','cancelled'].includes(row.status)?update(root,runId,revision,old=>({readRanges:{...old.readRanges,[rule.resourceId]:[...(old.readRanges[rule.resourceId]||[]),[offset,end]].slice(-128)}})):row;
  return {workflow:next,source:rule,content:text.slice(offset,end),offset,totalCharacters:text.length,nextOffset:end<text.length?end:null,deliveredToCurrentSession:actor==='agent',modelComplianceVerified:false};
 }
 async status(root,id){
  const row=read(root,id);new DesignPlans(root).read(row.planId,row.planRevision);for(const rule of row.rules)actualRule(root,rule);
  const artifactDeclarations=[];for(const item of row.artifacts){const actual=await inspectArtifact(root,item);if(actual.sourceHash!==item.sourceHash||actual.engine!==item.engine)throw new SafetyError('工作流关联产物或摘要不一致',409);let active=true;if(item.planLink){const declared=await readPlanSourceLink(root,item.planLink.id);if(JSON.stringify(declared.link)!==JSON.stringify(item.planLink))throw new SafetyError('工作流计划关联记录不一致',409);active=declared.active;}artifactDeclarations.push({sourceId:item.sourceId||item.assetName,bytesVerified:true,active});}
  return {workflow:row,rulesDelivered:row.rules.every(rule=>rangesCover(row.readRanges[rule.resourceId],rule.characters)),artifactsVerifiedFromSavedBytes:row.artifacts.length>0,verifiedArtifactCount:row.artifacts.length,eligibleArtifactCount:artifactDeclarations.filter(item=>item.active).length,artifactDeclarations,modelComplianceVerified:false,functionalValidation:false};
 }
 async attach(root,{runId,revision,sourceType,sourceId,sourceRevision,assetName,actor='agent'},signal,current){
  const row=read(root,runId),item={sourceType,...(sourceType==='report'?{assetName}:{sourceId,sourceRevision})};if(sourceType!=='report'&&(!HASH.test(sourceRevision||'')||typeof sourceId!=='string'))throw new SafetyError('请提供已保存的精确作品版本',422);
  const actual=await inspectArtifact(root,item),expected={vector:'vectorcraft',photo:'photocraft',deck:'deckcraft',html:'html',report:'report'}[row.outputKind];
  if(actual.engine!==expected)throw new SafetyError('产物类型不符合该工作流明确选择的输出',422);Object.assign(item,actual);
  if(row.artifacts.some(old=>JSON.stringify([old.sourceType,old.sourceId,old.sourceRevision,old.assetName])===JSON.stringify([item.sourceType,item.sourceId,item.sourceRevision,item.assetName])))return this.status(root,runId);
  if(sourceType!=='report'){const link=await createPlanSourceLink(root,{planId:row.planId,planRevision:row.planRevision,sourceType,sourceId,sourceRevision,actor,operationId:digest([runId,sourceType,sourceId,sourceRevision,actor])},signal,current);item.planLink=link.link;}
  signal?.throwIfAborted();current?.();update(root,runId,revision,old=>({artifacts:[...old.artifacts,item],status:'has_artifacts'}));return this.status(root,runId);
 }
 async publishHtml(root,input,signal,current){
  const row=read(root,input.runId);if(row.outputKind!=='html')throw new SafetyError('当前工作流输出不是HTML',422);if(!Array.isArray(input.files)||!input.files.length)throw new SafetyError('需要实际HTML/CSS/资源文件字节',422);
  const id='html-'+row.id.slice(7,15)+'-'+row.id.slice(15,19)+'-'+row.id.slice(19,23)+'-'+row.id.slice(23,27)+'-'+row.id.slice(27,39),html=new HtmlArtifacts(root),prior=await html.lineage(id);
  if(prior.length&&input.baseRevision===undefined){const saved=await html.read(id),normalize=files=>JSON.stringify(files.map(item=>[item.path,item.data]).sort((a,b)=>a[0].localeCompare(b[0])));if(saved.document.entry===input.entry&&normalize(saved.document.files)===normalize(input.files))return this.attach(root,{runId:row.id,revision:input.revision,sourceType:'html',sourceId:id,sourceRevision:saved.revision,actor:input.actor},signal,current);const error=new SafetyError('该工作流已有不同HTML产物，请读取现有版本并显式续改：'+id+' / '+saved.revision,409);error.retained={sourceId:id,sourceRevision:saved.revision};throw error;}
  signal?.throwIfAborted();current?.();const saved=await html.save({id,baseRevision:input.baseRevision??null,title:input.title||row.skillId,entry:input.entry,files:input.files});current?.();return this.attach(root,{runId:row.id,revision:input.revision,sourceType:'html',sourceId:id,sourceRevision:saved.revision,actor:input.actor},signal,current);
 }
 async publishReport(root,input,signal,current){
  const row=read(root,input.runId);if(row.outputKind!=='report')throw new SafetyError('当前工作流未选择报告输出',422);let bytes,method;
  if(input.operation==='color_audit'){
   const view=this.manager.views.get(this.manager.active.get(input.sessionId));if(!view||view.root!==root)throw new SafetyError('请先打开当前项目的真实文档',409);bytes=json(await auditSavedNativeColors(view,{background:input.background}));method='computed_source_color_audit';
  }else{if(typeof input.content!=='string'||!input.content.trim()||input.content.length>100000)throw new SafetyError('请提供实际报告文本',422);bytes=Buffer.from(input.content);method=input.actor==='manual'?'user_supplied_report_not_independently_verified':'current_model_report_not_independently_verified';}
  signal?.throwIfAborted();current?.();const saved=saveAsset(root,'odflow-report-'+sha(bytes).slice(0,24)+(method.startsWith('computed')?'.json':'.md'),bytes),result=await this.attach(root,{runId:row.id,revision:input.revision,sourceType:'report',assetName:saved.name,actor:input.actor},signal,current);return {...result,reportMethod:method};
 }
 async finish(root,{runId,revision},signal,current){const status=await this.status(root,runId);if(status.workflow.status==='completed')return {...status,reused:true};if(!status.rulesDelivered||!status.eligibleArtifactCount)throw new SafetyError('规则尚未完整返回或没有有效关联的真实保存产物，不能结束工作流',409);signal?.throwIfAborted();current?.();update(root,runId,revision,()=>({status:'completed'}));return {...await this.status(root,runId),note:'本地编排已关联真实保存产物；不证明视觉质量、模型遵循全部规则或功能验收通过。'};}
 cancel(root,{runId,revision}){return {workflow:update(root,runId,revision,()=>({status:'cancelled'})),note:'仅结束本地编排，原规则、计划和已保存作品保留；未取消或重发图片服务任务。'};}
 recoverLock(root,{runId}){const path=file(root,runId)+'.lock';let raw;try{const info=lstatSync(path);if(!info.isFile()||info.isSymbolicLink()||info.size>512)throw new Error();raw=readFileSync(path,'utf8');const owner=JSON.parse(raw);if(!Number.isSafeInteger(owner.pid)||owner.pid<1)throw new Error();try{process.kill(owner.pid,0);throw new SafetyError('持锁进程仍存活，未移除写入锁',409);}catch(error){if(error.code!=='ESRCH')throw error;}if(readFileSync(path,'utf8')!==raw)throw new Error();unlinkSync(path);}catch(error){if(error.code==='ENOENT')return {recovered:false,absent:true};if(error instanceof SafetyError)throw error;throw new SafetyError('工作流写锁状态不能安全恢复',409);}return {recovered:true,workflow:read(root,runId)};}
 list(root){let names;try{names=readdirSync(directory(root));}catch(error){if(error.code==='ENOENT')return {items:[]};throw error;}if(names.length>2200)throw new SafetyError('本地工作流数量超过预算',413);return {items:names.filter(name=>/^odflow-[a-f0-9]{64}\.json$/.test(name)).map(name=>{const row=read(root,name.slice(0,-5));return {id:row.id,revision:row.revision,skillId:row.skillId,outputKind:row.outputKind,status:row.status,planId:row.planId,planRevision:row.planRevision,artifacts:row.artifacts.length};})};}
}
export async function localWorkflowExport(root){const service=new LocalDesignWorkflows(null,null),out=[];for(const item of service.list(root).items){const {workflow}=await service.status(root,item.id),assets=[];for(const rule of workflow.rules)assets.push({name:rule.assetName,bytes:readAsset(root,rule.assetName),sha256:rule.sha256});for(const artifact of workflow.artifacts)if(artifact.sourceType==='report')assets.push({name:artifact.assetName,bytes:readAsset(root,artifact.assetName),sha256:artifact.sourceHash});out.push({name:item.id+'.json',bytes:readFileSync(file(root,item.id)),assets});}return out;}
