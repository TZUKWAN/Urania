/** Durable opinions, user drafts and evidenced delivery/results. No second design source. */
import fs from 'node:fs';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {workspacePath,SafetyError,assertSafeJson} from './safety.js';import {requireDesignScope} from './design-scope.js';
import {feedbackTarget,feedbackTargetKey} from '../client/feedback-contract.js';import {readRevision,readHeadRevision} from './motion/project-store.js';
import {sameUint64} from '../client/native-protocol.js';import {selectedObjectIds} from '../client/native-contract.js';
import {HumanEditProtection} from './human-edit-protection.js';
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),now=()=>new Date().toISOString(),copy=x=>JSON.parse(JSON.stringify(x));
const failure=(message,status=409)=>{throw new SafetyError(message,status);};
export class DesignFeedback{
 constructor(manager){this.manager=manager;this.protection=new HumanEditProtection(manager);}
 file(root,sessionId){return workspacePath(root,join('design/.designcraft/feedback',sha(sessionId)+'.json'));}
 load(root,sessionId){const file=this.file(root,sessionId);if(!fs.existsSync(file))return {schema:1,sessionId,version:0,drafts:{},items:{},submissions:{}};if(fs.statSync(file).size>8*1024*1024)failure('设计意见记录超过预算',413);const record=JSON.parse(fs.readFileSync(file,'utf8'));assertSafeJson(record);if(record.schema!==1||record.sessionId!==sessionId)failure('设计意见身份损坏',422);return record;}
 save(root,record){
  const bytes=Buffer.from(JSON.stringify({...record,version:record.version+1,updatedAt:now()}));if(bytes.length>8*1024*1024)failure('设计意见记录已满，请导出或整理历史意见',413);
  const file=this.file(root,record.sessionId);fs.mkdirSync(workspacePath(root,'design/.designcraft/feedback'),{recursive:true});const tmp=file+'.tmp-'+randomUUID();let fd;
  try{fd=fs.openSync(tmp,'wx');fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;fs.renameSync(tmp,file);}finally{if(fd!==null&&fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  record.version++;this.manager.onChange?.(root,{kind:'design-feedback',version:record.version});return record;
 }
 scope(sessionId,root){return requireDesignScope(this.manager,sessionId,root);}
 async validateTarget(root,target,{live=false,sessionId}={}){
  const t=feedbackTarget(target);
  if(t.kind==='motion'){readRevision(root,t.sourceId,t.revision);return {target:t,stale:readHeadRevision(root,t.sourceId).revision!==t.revision};}
  const source=await this.manager.store(root).source(t.sourceId,t.revision),head=await this.manager.store(root).head(t.sourceId);
  if(source.meta.engine!==t.engine)failure('意见引擎与原生源不一致');
  if(live){const view=this.manager.views.get(this.manager.active.get(sessionId));
   if(!view||view.root!==root||view.sourceId!==t.sourceId||view.sourceRevision!==t.revision||!view.ready||!sameUint64(view.document?.uid,t.engineUid)||!sameUint64(view.document?.revision,t.engineRevision))failure('设计已变化，请重新选择目标；意见草稿已保留');
   const p=view.document.page?.nativePage;if(t.page&&(!p||p.kind!==t.page.kind||!sameUint64(p.id,t.page.id)))failure('意见页面已切换');
   const selected=selectedObjectIds(view.document).map(String);if(t.objectIds.some(id=>!selected.includes(id)))failure('意见对象已经离开当前原生选区');
  }
  return {target:t,stale:head?.revision!==t.revision};
 }
 async run(sessionId,root,args,{ai=false}={}){
  root=this.scope(sessionId,root);assertSafeJson(args);let record=this.load(root,sessionId);const action=args.action;
  if(action==='list')return {version:record.version,drafts:Object.values(record.drafts),items:Object.values(record.items),submissions:Object.values(record.submissions).map(s=>this.submission(record,s))};
  if(action==='save_draft'){
   if(ai)failure('AI 不能改写用户未提交草稿',403);const target=feedbackTarget(args.target),key=sha(feedbackTargetKey(target)),old=record.drafts[key];
   if((args.baseVersion??0)!==(old?.version??0))failure('其他窗口已更新这条意见草稿，当前输入已保留');
   if(typeof args.text!=='string'||args.text.length>12000)failure('意见文本超过12000字预算',413);
   const draft={key,target,text:args.text,version:(old?.version||0)+1,at:now()};record.drafts[key]=draft;this.save(root,record);return {draft};
  }
  if(action==='add'){
   if(ai)failure('AI 不能替用户提交新意见',403);const checked=await this.validateTarget(root,args.target,{live:true,sessionId});record=this.load(root,sessionId);
   if(!/^op-[a-f0-9-]{36}$/.test(args.operationId||''))failure('意见动作身份无效',422);
   const text=String(args.text||'').trim();if(!text||text.length>12000)failure('请输入12000字以内的修改要求',422);
   const digest=sha([checked.target,text]),existing=Object.values(record.items).find(i=>i.operationId===args.operationId);
   if(existing){if(existing.digest!==digest)failure('同一意见动作不能重试不同内容');return {item:existing,replayed:true};}
   if(Object.keys(record.items).length>=2000)failure('意见记录已满，请整理后再添加',413);
   const item={id:'feedback-'+randomUUID(),operationId:args.operationId,digest,target:checked.target,text,status:'queued',at:now()};record.items[item.id]=item;
   const key=sha(feedbackTargetKey(checked.target));if(record.drafts[key]?.text.trim()===text)delete record.drafts[key];this.save(root,record);return {item};
  }
  if(action==='discard'){
   if(ai)failure('AI 不能删除用户意见',403);const item=record.items[args.itemId];if(!item||item.submissionId)failure('只有未提交意见可以移除');item.status='discarded';this.save(root,record);return {item};
  }
  if(action==='submit'){
   if(ai)failure('AI 不能代用户发起一批意见',403);if(!/^submission-[a-f0-9-]{36}$/.test(args.submissionId||''))failure('批次身份无效',422);
   const ids=[...new Set(args.itemIds||[])];if(!ids.length||ids.length>64)failure('每批请选择1至64条意见',422);
   const existing=record.submissions[args.submissionId];if(existing){if(sha(ids)!==sha(existing.itemIds))failure('同一批次不能更换意见');return {submission:this.submission(record,existing),replayed:true};}
   if(ids.some(id=>!record.items[id]||record.items[id].status!=='queued'||record.items[id].submissionId))failure('意见已提交或已移除，请刷新列表');
   const sub={id:args.submissionId,itemIds:ids,status:'saved',delivery:'pending',at:now(),attempts:[]};record.submissions[sub.id]=sub;for(const id of ids){record.items[id].submissionId=sub.id;record.items[id].status='submitted';}this.save(root,record);return {submission:this.submission(record,sub)};
  }
  const sub=record.submissions[args.submissionId];if(!sub)failure('未找到此意见批次',404);
  if(action==='review'){
   if(ai)failure('只有用户可以确认设计结果',403);
   if(!['accepted','declined'].includes(args.decision))failure('设计确认动作无效',422);
   const result=[...(sub.results||[])].reverse().find(row=>row.sourceId===args.sourceId);
   if(sub.status!=='modified'||!result||result.revision!==args.revision)failure('修改回执已更新，请重新核对');
   sub.reviews||=[];
   const previous=sub.reviews.find(item=>item.sourceId===args.sourceId);
   if(previous?.decision===args.decision&&previous.revision===result.revision)return {submission:this.submission(record,sub)};
   sub.reviews=sub.reviews.filter(item=>item.sourceId!==args.sourceId);
   sub.reviews.push({sourceId:result.sourceId,revision:result.revision,decision:args.decision,at:now()});
   this.save(root,record);return {submission:this.submission(record,sub)};
  }
  if(action==='claim_delivery'){
   if(ai||!/^delivery-[a-f0-9-]{36}$/.test(args.attemptId||''))failure('送达动作身份无效',422);
   if(!['pending','failed'].includes(sub.delivery)||sub.receivedAt)return {accepted:false,submission:this.submission(record,sub)};
   sub.delivery='preparing';sub.deliveryAttemptId=args.attemptId;this.save(root,record);return {accepted:true};
  }
  if(action==='delivery'){
   if(ai)failure('送达动作由当前设计输入框登记',403);if(!['staged','submitted','failed','uncertain'].includes(args.delivery))failure('无效送达状态',422);
   if(args.attemptId!==sub.deliveryAttemptId||!sub.deliveryAttemptId)failure('送达记录不属于本次已预约输入动作');
   sub.delivery=args.delivery;sub.attempts.push({at:now(),delivery:args.delivery,...(args.error?{error:String(args.error).slice(0,400)}:{})});sub.attempts=sub.attempts.slice(-20);this.save(root,record);return {submission:this.submission(record,sub)};
  }
  if(action==='read'){
   const targets=await Promise.all(sub.itemIds.map(id=>this.validateTarget(root,record.items[id].target)));
   const humanProtections=[];
   for(const sourceId of new Set(targets.filter(row=>row.target.kind==='native').map(row=>row.target.sourceId))){const head=await this.manager.store(root).head(sourceId),protectedState=await this.protection.read(root,sourceId,head.revision);humanProtections.push({sourceId,currentRevision:head.revision,fields:Object.entries(protectedState.record.fields).flatMap(([object,paths])=>Object.entries(paths).map(([path,field])=>({object,path,since:field.since})))});}
   record=this.load(root,sessionId);const current=record.submissions[sub.id];
   if(ai&&!current.receivedAt){current.receivedAt=now();if(current.status!=='modified')current.status='received';this.save(root,record);}
   return {submission:this.submission(record,current),targets,humanProtections,manualEditPolicy:'Read the latest native state before each edit. The target revision is an anchor, never permission to restore over newer manual changes. Unselected objects and fields outside the request remain protected. Page-wide/template/layout requests must preserve protected manual fields. A CURRENT explicit object request grants changes to that object; an older queued object request does not override later human edits.'};
  }
  if(action==='complete'){
   if(!ai)failure('只有已执行的设计工具能登记修改结果',403);
   const ids=[...new Set(args.jobIds||[])];if(!ids.length||ids.length>128)failure('请提供真实保存动作的 jobIds',422);
   const jobs=ids.map(id=>{
    const live=this.manager.jobs.get(id);if(live)return live;
    if(!/^[a-f0-9-]{36}$/.test(id))return null;const file=workspacePath(root,join('design/.designcraft/v2/operations',id+'.json'));if(!fs.existsSync(file)||fs.statSync(file).size>2*1024*1024)return null;
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));assertSafeJson(saved);if(saved.id!==id)return null;const e=saved.feedbackEvidence;
    return {...saved,root,saved:saved.savedRevision,payload:{command:saved.command},initiator:e?.initiator,executionStartedAt:e?.executionStartedAt,feedbackId:e?.feedbackId,feedbackProof:e?.proof,feedbackObjectIds:e?.beforeObjectIds,beforeDocument:{page:{nativePage:e?.beforePage}}};
   });
   if(jobs.some(j=>!j||j.sessionId!==sessionId||j.root!==root||j.status!=='succeeded'||j.initiator!=='ai'||!j.saved||!j.feedbackProof?.checked||!j.feedbackProof?.changed||!j.executionStartedAt||j.executionStartedAt<sub.at||j.feedbackId!==sub.id||j.action!=='execute'||/^select\.|^slide\.go$/.test(j.payload?.command||'')))failure('部分动作尚未实际完成内容修改并保存，不能登记已修改');
   for(const id of sub.itemIds){const t=record.items[id].target;
    if(t.kind!=='native')failure('动画意见需凭动画修订回执核对，不能用原生动作冒充');
    if(!jobs.some(j=>j.sourceId===t.sourceId&&(!t.page||j.feedbackProof.changedPages.includes(t.page.kind+':'+t.page.id))&&(!t.objectIds.length||t.objectIds.every(id=>j.feedbackProof.changedObjectIds.includes(id)))))failure('存在没有对应页面或对象内容变化的意见');
   }
   const results=[];for(const job of jobs){await this.manager.store(root).source(job.sourceId,job.saved);results.push({jobId:job.id,sourceId:job.sourceId,revision:job.saved,command:job.payload.command});}
   record=this.load(root,sessionId);const current=record.submissions[sub.id];current.status='modified';current.receivedAt||=now();current.completedAt=now();current.results=results;for(const id of current.itemIds)record.items[id].status='modified';this.save(root,record);return {submission:this.submission(record,current)};
  }
  failure('未支持的设计意见动作',422);
 }
 submission(record,sub){return copy({...sub,items:sub.itemIds.map(id=>record.items[id])});}
 hasRejected(view){return Object.values(this.load(view.root,view.sessionId).blockedCandidates||{}).some(row=>row.sourceId===view.sourceId);}
 registerRejected(view,job,bytes,reason){const record=this.load(view.root,view.sessionId),digest=createHash('sha256').update(bytes).digest('hex');record.blockedCandidates||={};record.blockedCandidates[digest]={sourceId:view.sourceId,baseRevision:view.sourceRevision,jobId:job.id,at:now(),reason:String(reason).slice(0,500)};this.save(view.root,record);return digest;}
 rejectedCandidate(view,bytes){const digest=createHash('sha256').update(bytes).digest('hex'),row=this.load(view.root,view.sessionId).blockedCandidates?.[digest];return row?.sourceId===view.sourceId?row:null;}
 async isRejected(view,bytes){if(!this.rejectedCandidate(view,bytes))return false;const digest=createHash('sha256').update(bytes).digest('hex'),head=await this.manager.store(view.root).head(view.sourceId);return head?.meta.sourceHash!==digest;}
 async verifySource(view,job,bytes){const record=this.load(view.root,view.sessionId),sub=record.submissions[job.feedbackId];if(!sub?.receivedAt||sub.status==='modified')failure('意见任务已变化，未提交旧候选');return this.protection.verify(view,job,bytes,sub.itemIds.map(id=>record.items[id].target));}
 async authorize(sessionId,view,{action,payload,feedbackId}){
  const root=this.scope(sessionId,view.root),record=this.load(root,sessionId),sub=record.submissions[feedbackId];
  if(!sub?.receivedAt||sub.status==='modified')failure('请先读取尚未完成的这批设计意见');
  if(action!=='execute')return;
  const targets=sub.itemIds.map(id=>record.items[id].target).filter(t=>t.kind==='native'&&t.sourceId===view.sourceId);
  if(!targets.length)failure('当前作品不在这批意见范围内');
  const check=(command,params={})=>{
   if(command==='command.batch'){if(params.commands.some(c=>c.command==='slide.go'))failure('跨页意见请逐页定位再分别执行，不能批次中途猜页');for(const step of params.commands)check(step.command,step.params);return;}
   if(command==='slide.go'){const destination=params.id?.$u64??params.id;if(!targets.some(t=>!t.page||sameUint64(t.page.id,destination)))failure('该页面不在这批意见范围内');return;}
   const page=view.document?.page?.nativePage,applicable=targets.filter(t=>!t.page||page?.kind===t.page.kind&&sameUint64(page.id,t.page.id));
   if(!applicable.length)failure('请先定位到意见指定的真实页面 UID');
   if(applicable.some(t=>!t.objectIds.length))return;
   const allowed=new Set(applicable.flatMap(t=>t.objectIds)),values=[];
   const collect=value=>{if(value&&typeof value==='object'&&!Array.isArray(value)){if(value.$u64!==undefined)values.push(String(value.$u64));else for(const [key,v]of Object.entries(value)){if(['id','layerId','shapeId','ids','shapeIds','layerIds'].includes(key)){for(const id of Array.isArray(v)?v:[v])values.push(String(id?.$u64??id));}else if(v&&typeof v==='object')collect(v);}}};collect(params);
   if(command==='select.all'||command==='edit.selectAll')failure('本批意见只授权指定对象，不能全选整页');
   const ids=values.length?values:selectedObjectIds(view.document).map(String);
   if(!ids.length||ids.some(id=>!allowed.has(id)))failure('命令包含未授权对象，已保留其他对象和人工改动');
  };check(payload.command,payload.params);
 }
}

export function feedbackToolDefinition(service){return {
 name:'designcraft_feedback',description:'Read a persisted UraniaFeedback submission before editing. read marks AI actually received it. Do not claim changes from delivery alone. Use designcraft_editor actual native commands and save checkpoints, then complete with the resulting jobIds for every requested page/object. Old revisions require reading the current state and preserving later human edits.',
 parameters:{type:'object',additionalProperties:false,required:['action','submissionId'],properties:{action:{type:'string',enum:['read','complete']},submissionId:{type:'string'},jobIds:{type:'array',items:{type:'string'}}}},
 output:{schema:{type:'object',required:['json'],additionalProperties:false,properties:{json:{type:'string'}}},render:(_args,v)=>[{type:'text',text:v.json}]},timeoutMs:90000,
 async execute(args,execution){try{const session=execution.agent?.session;if(!session?.id||!session.header?.cwd)throw new Error('缺少实际 DSH 设计会话');return {json:JSON.stringify({ok:true,...await service.run(session.id,session.header.cwd,args,{ai:true})})};}catch(error){return {json:JSON.stringify({ok:false,error:error.message,status:error.status||409})};}}
};}
export function registerFeedbackTool(ctx,service){ctx.inject(['tools'],scope=>{const dispose=scope.tools.register(feedbackToolDefinition(service));scope.effect(()=>()=>dispose?.(),'designcraft: durable design feedback');});}
export function feedbackRoutes(service,{guard,readJsonBody,sendJson}){return [{kind:'exact',path:'/designcraft/api/v2/feedback',handler:guard(async(req,res)=>{if(req.method!=='POST')throw new SafetyError('需要 POST',405);const body=await readJsonBody(req,1024*1024);sendJson(res,200,{ok:true,...await service.run(body.sessionId,body.root,body)});})}];}
