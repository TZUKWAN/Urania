import {feedbackTargetKey,nativeFeedbackTarget,feedbackPrompt,feedbackLabel,expandsFeedbackSelection} from './feedback-contract.js?v=169';
import {submitDesignFeedbackPrompt} from './native-ai-input.js?v=169';
import {isActiveDesignSession} from './design-session.js?v=169';

/** Local emergency journal + server CAS. Typing never invokes a model. */
export class DesignFeedbackClient{
 constructor(controller,getServices){this.controller=controller;this.getServices=getServices;this.listeners=new Set();this.state={drafts:{},items:[],submissions:[],loading:true,error:null};this.timers=new Map();this.flights=new Map();this.scope=null;this.generation=0;}
 get=()=>this.state;subscribe=callback=>{this.listeners.add(callback);return()=>this.listeners.delete(callback);};
 change(patch){this.state={...this.state,...patch};for(const f of this.listeners)f();}
 key(){return 'urania-feedback|'+this.scope.root+'|'+this.scope.sessionId;}
 journal(){if(!this.scope)return;try{localStorage.setItem(this.key(),JSON.stringify(this.state.drafts));}catch(error){this.change({error:'浏览器意见备份失败，请保持窗口并保存意见：'+error.message});}}
 async bind({root,sessionId}){
  if(this.scope?.root===root&&this.scope?.sessionId===sessionId)return;
  this.suspend();this.scope={root,sessionId};this.generation++;let drafts={};
  try{drafts=JSON.parse(localStorage.getItem(this.key())||'{}');if(!drafts||typeof drafts!=='object'||Array.isArray(drafts)||Object.keys(drafts).length>2000)throw new Error('本地意见记录无效');}catch(error){this.change({error:error.message});drafts={};}
  this.change({drafts,items:[],submissions:[],loading:true,error:null});await this.refresh();
 }
 suspend(){for(const timer of this.timers.values())clearTimeout(timer);this.timers.clear();this.journal();this.scope=null;this.generation++;}
 async api(args,scope=this.scope){if(!scope)throw new Error('设计意见会话尚未就绪');const response=await fetch('/designcraft/api/v2/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...args,...scope})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'设计意见保存失败');return result;}
 async refresh(){
  if(!this.scope)return;const generation=this.generation;
  try{const data=await this.api({action:'list'});if(generation!==this.generation)return;
   if(!this.state.loading&&(data.version<this.state.version||data.version===this.state.version&&!this.state.error))return;
   const drafts={...this.state.drafts};for(const server of data.drafts){const key=feedbackTargetKey(server.target),local=drafts[key];
    if(!local||!local.dirty||local.text===server.text)drafts[key]={...server,baseVersion:server.version,dirty:false,sequence:local?.sequence||0};
    else if((local.baseVersion||0)!==server.version)drafts[key]={...local,conflict:server};
   }
   this.change({...data,drafts,loading:false});this.journal();
  }catch(error){if(generation===this.generation)this.change({loading:false,error:error.message});throw error;}
 }
 draft(target){return this.state.drafts[feedbackTargetKey(target)]?.text||'';}
 carryExpandedDraft(from,to){
  if(!this.scope||this.state.loading||!expandsFeedbackSelection(from,to))return false;
  const source=this.state.drafts[feedbackTargetKey(from)],key=feedbackTargetKey(to);
  // Even an explicitly empty destination draft belongs to that target. Do not
  // overwrite it, merge requests, or copy an uncertain/already queued add.
  if(Object.hasOwn(this.state.drafts,key)||!source?.text.trim()||source.conflict||source.pendingAdd)return false;
  this.setDraft(to,source.text);return true;
 }
 setDraft(target,text){
  if(!this.scope)throw new Error('设计意见会话尚未就绪');const key=feedbackTargetKey(target),old=this.state.drafts[key];
  const draft={...old,target,text,baseVersion:old?.baseVersion||0,sequence:(old?.sequence||0)+1,dirty:true};
  if(old?.pendingAdd?.text!==text)delete draft.pendingAdd;
  this.change({drafts:{...this.state.drafts,[key]:draft},error:null});this.journal();clearTimeout(this.timers.get(key));
  this.timers.set(key,setTimeout(()=>{this.timers.delete(key);void this.persist(key).catch(error=>this.change({error:error.message}));},350));
 }
 async persist(key){
  if(this.flights.get(key)?.generation===this.generation)return this.flights.get(key);const scope={...this.scope},generation=this.generation;
  const flight=(async()=>{
   while(generation===this.generation){const draft=this.state.drafts[key];if(!draft?.dirty)return;if(draft.conflict)throw new Error('此意见在另一窗口有更新，已保留两个版本，请在待处理意见中选择');
    const {draft:saved}=await this.api({action:'save_draft',target:draft.target,text:draft.text,baseVersion:draft.baseVersion},scope);
    if(generation!==this.generation)return;const current=this.state.drafts[key];if(!current)return;
    this.change({drafts:{...this.state.drafts,[key]:{...current,baseVersion:saved.version,dirty:current.sequence!==draft.sequence}}});this.journal();
   }
  })();flight.generation=generation;this.flights.set(key,flight);try{return await flight;}finally{if(this.flights.get(key)===flight)this.flights.delete(key);}
 }
 resolveDraft(key,choice){const old=this.state.drafts[key];if(!old?.conflict)return;const remote=old.conflict,draft=choice==='remote'?{...remote,baseVersion:remote.version,sequence:(old.sequence||0)+1,dirty:false}:{...old,baseVersion:remote.version,conflict:null,dirty:true};this.change({drafts:{...this.state.drafts,[key]:draft}});this.journal();if(choice!=='remote')void this.persist(key).catch(error=>this.change({error:error.message}));}
 async add(target,text){
  const generation=this.generation,key=feedbackTargetKey(target),old=this.state.drafts[key];
  let operationId=old?.pendingAdd?.text===text?old.pendingAdd.id:'op-'+crypto.randomUUID();
  if(old){this.change({drafts:{...this.state.drafts,[key]:{...old,pendingAdd:{id:operationId,text}}}});this.journal();await this.persist(key);}
  const {item}=await this.api({action:'add',target,text,operationId});if(generation!==this.generation)return item;
  const drafts={...this.state.drafts};if(drafts[key]?.text.trim()===text.trim())delete drafts[key];this.change({drafts});this.journal();await this.refresh();return item;
 }
 async currentTarget(options={}){
  const before=this.controller.context();if(!before)throw new Error('设计尚未就绪');const key=feedbackTargetKey(nativeFeedbackTarget(before,options));
  await this.controller.flush();const context=await this.controller.referenceContext(),target=nativeFeedbackTarget(context,options);
  if(feedbackTargetKey(target)!==key)throw new Error('准备意见时页面或选区已改变，草稿已保留');return target;
 }
 async selection(text,{defer=false,region,reference}={}){const target=await this.currentTarget({region,reference}),item=await this.add(target,text);if(defer)return {saved:true,item};return this.submit([item.id]);}
 async submit(itemIds){
  const signature=JSON.stringify(itemIds),pending=this.pendingSubmission;
  const id=pending?.signature===signature?pending.id:'submission-'+crypto.randomUUID();this.pendingSubmission={signature,id};
  const {submission}=await this.api({action:'submit',submissionId:id,itemIds});await this.refresh();
  this.pendingSubmission=null;return this.deliver(submission);
 }
 async deliver(submission){
  if(['submitted','preparing','uncertain'].includes(submission.delivery)||submission.receivedAt)return {pending:true};
  const scope={...this.scope};if(!isActiveDesignSession(this.getServices(),scope.sessionId))throw new Error('项目设计对话尚未就绪，意见已保留');
  const attemptId='delivery-'+crypto.randomUUID(),claim=await this.api({action:'claim_delivery',submissionId:submission.id,attemptId},scope);
  if(!claim.accepted){await this.refresh();return {pending:true};}
  try{const result=await submitDesignFeedbackPrompt({services:this.getServices(),sessionId:scope.sessionId,submissionId:submission.id,label:submission.items.length+' 条设计意见',text:feedbackPrompt(submission),isCurrent:()=>this.scope?.sessionId===scope.sessionId&&this.scope?.root===scope.root});
   await this.api({action:'delivery',submissionId:submission.id,attemptId,delivery:result.staged?'staged':'submitted'},scope);await this.refresh();return result;
  }catch(error){await this.api({action:'delivery',submissionId:submission.id,attemptId,delivery:error.beforeInput?'failed':'uncertain',error:error.message},scope).catch(()=>{});await this.refresh().catch(()=>{});throw error;}
 }
 async discard(id){await this.api({action:'discard',itemId:id});await this.refresh();}
}

const status=sub=>sub.status==='modified'?'修改已保存':sub.receivedAt?'AI 已收到':sub.delivery==='staged'?'已放入对话草稿，等待发送':sub.delivery==='submitted'?'已提交，等待 AI 回执':sub.delivery==='uncertain'?'送达状态待核对，意见已保存':sub.delivery==='failed'?'未送达，意见已保存':'意见已保存';
export function createFeedbackPanel(React,feedback){const h=React.createElement;return function FeedbackPanel({native,onReview}){
 const state=React.useSyncExternalStore(feedback.subscribe,feedback.get,feedback.get),[busy,setBusy]=React.useState(false),[reference,setReference]=React.useState(''),[whole,setWhole]=React.useState(false);
 const queued=state.items.filter(i=>i.status==='queued'),run=fn=>async()=>{setBusy(true);feedback.change({error:null});try{await fn();}catch(error){feedback.change({error:error.message});}finally{setBusy(false);}};
 React.useEffect(()=>{if(!feedback.scope)return;const timer=setInterval(()=>{void feedback.refresh().catch(()=>{});},2000);return()=>clearInterval(timer);},[feedback.scope?.sessionId]);
 return h('details',{className:'dcFeedbackPanel'},h('summary',null,'设计意见'+(queued.length?' · 待提交 '+queued.length:'')+(state.submissions.some(s=>s.receivedAt&&s.status!=='modified')?' · AI 处理中':'')),
  state.error?h('p',{role:'alert'},state.error):null,
  ...Object.entries(state.drafts).filter(([,d])=>d.conflict).map(([key,draft])=>h('div',{key},h('p',null,'草稿冲突：'+feedbackLabel(draft.target)),h('pre',null,'本窗口：'+draft.text+'\n另一窗口：'+draft.conflict.text),h('button',{className:'dcBtn',onClick:()=>feedback.resolveDraft(key,'local')},'保留本窗口'),h('button',{className:'dcBtn',onClick:()=>feedback.resolveDraft(key,'remote')},'使用另一窗口'))),
  ...queued.map(item=>h('div',{className:'dcFeedbackRow',key:item.id},h('span',null,h('small',null,feedbackLabel(item.target)),h('p',null,item.text)),h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>feedback.discard(item.id))},'移除'))),
  queued.length?h('button',{className:'dcBtn dcPrimary',disabled:busy||!feedback.scope,onClick:run(()=>feedback.submit(queued.map(i=>i.id)))},busy?'正在保存…':'将 '+queued.length+' 条意见一起交给 AI'):null,
  h('details',null,h('summary',null,'模板与版式参考'),h('input',{'aria-label':'模板或版式要求',value:reference,placeholder:'例如：学术汇报风格，这页改为左右对比',onChange:e=>setReference(e.target.value)}),native.engine==='deckcraft'?h('label',null,h('input',{type:'checkbox',checked:whole,onChange:e=>setWhole(e.target.checked)}),'应用范围：整套演示'):null,
   h('button',{className:'dcBtn',disabled:busy||!reference.trim(),onClick:run(async()=>{let target=await feedback.currentTarget({reference:{kind:'design-reference',description:reference.trim(),scope:whole?'source':'page'}});target={...target,objectIds:[],...(whole?{page:null}:{} )};await feedback.add(target,reference.trim());setReference('');})},'保存为 AI 意见')),
  ...state.submissions.slice(-8).reverse().map(sub=>h('div',{className:'dcFeedbackReceipt',key:sub.id},h('strong',null,status(sub)),h('small',null,' · '+sub.items.length+' 条意见'),
   sub.status==='modified'&&sub.results?.length&&onReview?h('button',{className:'dcBtn',onClick:()=>onReview(sub),'aria-label':'查看 AI 修改结果'},'查看结果'):null,
   h('details',null,h('summary',null,'查看修改要求'),...sub.items.map(i=>h('p',{key:i.id},feedbackLabel(i.target)+'：'+i.text)),
    sub.results?.length?h('details',null,h('summary',null,'版本回执'),...sub.results.map(r=>h('code',{key:r.jobId},r.sourceId+' @ '+r.revision.slice(0,12)))):null),
   ['pending','failed'].includes(sub.delivery)&&!sub.receivedAt?h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>feedback.deliver(sub))},'交给 AI'):null)),
  h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>feedback.refresh())},'核对状态'));
};}
