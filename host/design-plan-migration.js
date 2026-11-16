/** Explicit resource-version migration creates a new plan revision; old history stays intact. */
import {DesignPlans} from './design-plans.js';
import {CreativeDirectorResource,openCreativeDirector} from './creative-director-resource.js';
import {SafetyError,assertSafeJson} from './safety.js';
export function previewPlanMigration(root,{id,baseRevision}){
 const saved=new DesignPlans(root).read(id);if(saved.revision!==baseRevision)throw new SafetyError('计划版本已改变，请刷新迁移预览',409);
 const current=new CreativeDirectorResource(),targetId=current.referenceId(),files=current.index().files,items=[];
 for(const source of saved.plan.sources){
  if(!source.resourceId.startsWith('external-')||source.resourceId===targetId)continue;
  const old=openCreativeDirector(root,source.resourceId),actual=old.read({file:source.file,limit:1});if(actual.sha256!==source.sha256||actual.gitSha1!==source.gitSha1)throw new SafetyError('旧计划引用的资源原件不一致，未迁移',409);
  const target=files.get(source.file);items.push({resourceId:source.resourceId,file:source.file,fromRevision:actual.revision,fromSha256:source.sha256,targetResourceId:targetId,targetRevision:current.index().revision,targetSha256:target?.sha256||null,targetGitSha1:target?.gitSha1||null,available:!!target,contentChanged:!!target&&target.sha256!==source.sha256});
 }
 return {id,baseRevision,items,note:'迁移只更换您明确选择的资源引用，不改计划文字或旧历史；规则内容变化后须由当前会话重新审阅。'};
}
export function migratePlanResources(manager,root,{id,baseRevision,migrations},signal,assertCurrent){
 assertSafeJson(migrations);if(!Array.isArray(migrations)||!migrations.length||migrations.length>40)throw new SafetyError('请选择迁移预览中的实际资源项',422);
 const preview=previewPlanMigration(root,{id,baseRevision}),choices=new Map();
 for(const item of migrations){
  if(!item||Object.keys(item).some(k=>!['resourceId','file','expectedTargetSha256'].includes(k)))throw new SafetyError('资源迁移输入无效',422);
  const key=item.resourceId+'\0'+item.file,row=preview.items.find(row=>row.resourceId===item.resourceId&&row.file===item.file);
  if(choices.has(key)||!row?.available||row.targetSha256!==item.expectedTargetSha256)throw new SafetyError('迁移目标或摘要已改变，请重新预览',409);choices.set(key,row);
 }
 const plans=new DesignPlans(root),saved=plans.read(id);if(saved.revision!==baseRevision)throw new SafetyError('计划在迁移期间已有新版本',409);
 const current=new CreativeDirectorResource();signal?.throwIfAborted();assertCurrent?.();current.markUsed(root);
 const sources=saved.plan.sources.map(source=>{const item=choices.get(source.resourceId+'\0'+source.file);return item?{resourceId:item.targetResourceId,file:source.file,gitSha1:item.targetGitSha1,sha256:item.targetSha256}:source;});
 const identities=sources.map(source=>source.resourceId+'\0'+source.file);if(new Set(identities).size!==identities.length)throw new SafetyError('迁移将产生重复来源引用，请分别整理计划',409);
 signal?.throwIfAborted();assertCurrent?.();const result=plans.save({id,baseRevision,title:saved.plan.title,brief:saved.plan.brief,content:saved.plan.content,sources});try{manager.onChange(root,{kind:'design-plan',id,revision:result.revision});}catch{}
 return {...result,migratedFrom:baseRevision,migrations:[...choices.values()],note:'已创建新计划修订，旧规则、原计划历史及作品均保留；没有自动执行新规则。'};
}
