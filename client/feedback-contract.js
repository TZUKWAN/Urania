import {isUint64} from './native-protocol.js?v=168';
const fail=message=>{throw new Error(message);};
export function feedbackTarget(input){
 if(!input||!['native','motion'].includes(input.kind))fail('意见目标类型无效');
 if(!/^[\w-]{1,100}$/.test(input.sourceId||'')||!/^[a-f0-9]{64}$/.test(input.revision||''))fail('请先保存当前设计再添加意见');
 const ids=input.objectIds||[];if(!Array.isArray(ids)||ids.length>128)fail('意见对象数量超过限制');
 if(ids.some(id=>input.kind==='native'?!isUint64(id):typeof id!=='string'||!id||id.length>256))fail('意见必须引用精确的原生对象身份');
 let page=null;
 if(input.page){if(typeof input.page.kind!=='string'||input.page.kind.length>32||!isUint64(input.page.id))fail('意见页面身份无效');page={kind:input.page.kind,id:String(input.page.id),...(Number.isSafeInteger(input.page.index)?{index:input.page.index}:{})};}
 let region=null;
 if(input.region){const r=input.region;if(!['page-normalized','preview-normalized','native-pixels'].includes(r.space)||['x','y','width','height'].some(k=>!Number.isFinite(r[k])||r[k]<0)||!r.width||!r.height)fail('意见区域无效');if(r.space!=='native-pixels'&&(r.x+r.width>1.00001||r.y+r.height>1.00001))fail('意见区域超过画布');region={space:r.space,...Object.fromEntries(['x','y','width','height'].map(k=>[k,r[k]]))};}
 const out={kind:input.kind,sourceId:input.sourceId,revision:input.revision,engine:String(input.engine||''),title:String(input.title||'设计').slice(0,200),page,objectIds:[...new Set(ids.map(String))],region};
 if(input.engineUid!==undefined){if(!isUint64(input.engineUid)||!isUint64(input.engineRevision))fail('意见文档修订不精确');out.engineUid=String(input.engineUid);out.engineRevision=String(input.engineRevision);}
 if(input.frame!==undefined){if(!Number.isSafeInteger(input.frame)||input.frame<0)fail('意见帧无效');out.frame=input.frame;}
 if(input.nativeSelection){if(JSON.stringify(input.nativeSelection).length>512000)fail('原生选区超过预算');out.nativeSelection=input.nativeSelection;}
 if(input.reference){if(JSON.stringify(input.reference).length>2000)fail('模板参考超过预算');out.reference=input.reference;}
 return out;
}
export function feedbackTargetKey(target){const t=feedbackTarget(target);return JSON.stringify([t.kind,t.sourceId,t.page?[t.page.kind,t.page.id]:null,[...t.objectIds].sort(),t.region,t.frame??null]);}
/** A current, actively typed request may follow an explicit selection expansion.
 * Never carry it to another source/page/document, a region, or a disjoint target.
 */
export function expandsFeedbackSelection(from,to){
 try{
  const a=feedbackTarget(from),b=feedbackTarget(to);
  return a.kind==='native'&&b.kind==='native'&&a.sourceId===b.sourceId&&a.engine===b.engine&&!!a.engineUid&&a.engineUid===b.engineUid&&!a.region&&!b.region&&a.page?.kind===b.page?.kind&&a.page?.id===b.page?.id&&a.objectIds.length>0&&b.objectIds.length>a.objectIds.length&&a.objectIds.every(id=>b.objectIds.includes(id));
 }catch{return false;}
}
export function nativeFeedbackTarget(context,{region,reference}={}){
 if(!context)fail('当前设计尚未就绪');const p=context.page?.nativePage;
 return feedbackTarget({kind:'native',sourceId:context.sourceId,revision:context.sourceRevision,engine:context.engine,title:context.title,objectIds:context.objectIds,engineUid:context.engineUid,engineRevision:context.engineRevision,page:p?.id!=null?{kind:p.kind,id:p.id,index:p.index??context.page?.index}:null,nativeSelection:context.nativeSelection,region,reference});
}
export function feedbackLabel(target){return target.title+(target.page?' · '+(Number.isSafeInteger(target.page.index)?'第 '+(target.page.index+1)+' 页':target.page.kind+' '+target.page.id):'')+(target.objectIds.length?' · '+target.objectIds.length+' 个对象':'')+(target.region?' · 区域':'')+(target.frame!==undefined?' · 帧 '+target.frame:'');}
export function feedbackPrompt(submission){return '[UraniaFeedback]'+JSON.stringify({submissionId:submission.id,items:submission.items.map(item=>({id:item.id,text:item.text,target:item.target})),workflow:'Call designcraft_feedback action=read with submissionId first. These are persisted requests, not completed edits. Read current designcraft_editor state and each exact source/page/UID; stale targets require re-reading and preserving later manual edits. Use native commands in the live App, not raw file overwrites. Set TOP-LEVEL feedbackId to this submissionId on EVERY designcraft_editor execute call, retaining its normal sourceId/epoch/base fences. Select the intended IDs, navigate pages by actual UID, then read state again. Keep objects, positions, text, styles and notes outside each requested scope. Template/layout references describe an AI request; apply only requested fields. After actual saved native jobs, call designcraft_feedback action=complete with submissionId and all returned jobIds. Never mark done for a draft, queued message, navigation, or a promised change.'})+'[/UraniaFeedback]';}
