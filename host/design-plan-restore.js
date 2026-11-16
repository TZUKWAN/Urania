import {DesignPlans} from './design-plans.js';
import {materialize} from './open-design-tools.js';
import {loadSavedOpenDesignPackage} from './open-design-package.js';
import {SafetyError} from './safety.js';
import {materializeExternalSkillFile,materializeExternalLfsFile} from './external-skill-bundles.js';
import {readFigmaExport} from './figma-source.js';
import {CreativeDirectorResource,openCreativeDirector} from './creative-director-resource.js';

async function retainSources(library,root,sources,signal,assertCurrent){
 const snapshots=new Map();let director;
 for(const source of sources){
  signal?.throwIfAborted();
  assertCurrent?.();
  if(source.resourceId.startsWith('figmaexport-')){
   const {receipt}=await readFigmaExport(root,source.resourceId);if(['fileKey','nodeId','version','format','sha256'].some(key=>receipt[key]!==source[key]))throw new SafetyError('计划引用的 Figma 原件不一致，未提交版本',409);continue;
  }
  if(source.resourceId.startsWith('external-')){
   director=openCreativeDirector(root,source.resourceId);
   const file=director.read({file:source.file,limit:1});
   if(file.gitSha1!==source.gitSha1||file.sha256!==source.sha256)throw new SafetyError('计划引用的创意指导原件不一致，未提交版本',409);
   signal?.throwIfAborted();assertCurrent?.();const used=director.markUsed(root);
   if(used.usage.id!==source.resourceId)throw new SafetyError('计划引用的创意指导版本不一致，未提交版本',409);
   continue;
  }
  if(source.resourceId.startsWith('externalfile-')||source.resourceId.startsWith('externallfs-')){
   const actual=await (source.resourceId.startsWith('externallfs-')?materializeExternalLfsFile:materializeExternalSkillFile)(library,root,source.bundleId,source.file,signal,assertCurrent);
   if(actual.file.id!==source.resourceId||actual.file.gitSha1!==source.gitSha1||actual.file.sha256!==source.sha256)throw new SafetyError('计划引用的外部原件不一致，未提交版本',409);
   continue;
  }
  if(!snapshots.has(source.packageId))snapshots.set(source.packageId,await loadSavedOpenDesignPackage(library,root,source.packageId));
  const actual=await materialize(library,root,source.packageId,source.file,signal,snapshots.get(source.packageId));
  if(actual.receipt.id!==source.resourceId||actual.receipt.gitSha1!==source.gitSha1||actual.receipt.sha256!==source.sha256)throw new SafetyError('计划引用的资源原件不一致，未提交版本',409);
 }
}

/** Restore historical content as a new revision; never move a head backward. */
export async function restoreDesignPlan(manager,library,root,{id,revision,baseRevision},signal,assertCurrent){
 if(!/^[a-f0-9]{64}$/.test(revision||'')||!/^[a-f0-9]{64}$/.test(baseRevision||'')||revision===baseRevision)throw new SafetyError('请选择历史版本和当前版本后恢复',422);
 signal?.throwIfAborted();const plans=new DesignPlans(root),historical=plans.read(id,revision),current=plans.read(id);
 if(current.revision!==baseRevision&&current.plan.parentRevision!==baseRevision)throw new SafetyError('设计计划已有新版本，请刷新后再恢复',409);
 await retainSources(library,root,historical.plan.sources,signal,assertCurrent);
 signal?.throwIfAborted();assertCurrent?.();
 const saved=plans.save({id,baseRevision,title:historical.plan.title,brief:historical.plan.brief,content:historical.plan.content,sources:historical.plan.sources});
 try{manager.onChange(root,{kind:'design-plan',id,revision:saved.revision});}catch{/* The committed revision remains valid without a subscriber. */}
 return {...saved,restoredFrom:historical.revision,...(signal?.aborted?{completedAfterCancel:true}:{})};
}

/** Publish an exact, previously written candidate only if its base is current. */
export async function recoverDesignPlan(manager,library,root,{id,revision,baseRevision},signal,assertCurrent){
 if(!/^[a-f0-9]{64}$/.test(revision||'')||baseRevision!==null&&!/^[a-f0-9]{64}$/.test(baseRevision||''))throw new SafetyError('请选择待恢复版本和准确基础版本',422);
 signal?.throwIfAborted();const plans=new DesignPlans(root),candidate=plans.candidate(id,revision,{allowTemporary:true}),rows=plans.lineage(id),head=rows.at(-1)?.revision||null;
 if(head!==revision&&(head!==baseRevision||candidate.plan.parentRevision!==baseRevision))throw new SafetyError('计划基础版本已变化，请另存候选内容',409);
 await retainSources(library,root,candidate.plan.sources,signal,assertCurrent);
 signal?.throwIfAborted();assertCurrent?.();const saved=plans.publishCandidate(id,revision,baseRevision);
 try{manager.onChange(root,{kind:'design-plan',id,revision:saved.revision});}catch{/* The committed revision remains valid without a subscriber. */}
 return {...saved,recoveredCandidate:revision,...(signal?.aborted?{completedAfterCancel:true}:{})};
}
