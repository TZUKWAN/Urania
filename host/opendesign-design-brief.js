/** Versioned Chinese/English interpretation; processor 1 stays byte-compatible. */
import {resolveDesignBrief as legacyResolve} from './opendesign-design-brief-v1.js';
import {inferChineseBrief} from './chinese-design-brief.js';
import {SafetyError} from './safety.js';
export {BRIEF_RULE_GIT,BRIEF_RULE_SHA256,verifyBriefRule,renderDesignBrief} from './opendesign-design-brief-v1.js';
export function resolveDesignBrief(input){
 const version=input?.processorVersion??2;
 if(version===1)return legacyResolve(input);
 if(version!==2)throw new SafetyError('不支持的设计简报解析版本',422);
 const baseline=legacyResolve(input),explicit=input.dimensions||{},localized=input.mode==='ilang'?{dimensions:{},forbidden:{},matches:[],warnings:[]}:inferChineseBrief(input.brief,Object.keys(explicit));
 for(const [key,value] of Object.entries(localized.dimensions)){
  if(key!=='exclude'&&!Object.hasOwn(explicit,key)&&baseline.provenance[key]==='keyword'&&baseline.dimensions[key]!==value)throw new SafetyError('中英文简报对 '+key+' 的要求冲突，请明确选择',422);
 }
 const dimensions={...localized.dimensions,...explicit};
 if(!Object.hasOwn(explicit,'exclude')&&localized.dimensions.exclude)dimensions.exclude=[...new Set([...baseline.dimensions.exclude,...localized.dimensions.exclude])];
 const spec=legacyResolve({...input,dimensions});
 for(const [key,values]of Object.entries(localized.forbidden)){
  const current=Array.isArray(spec.dimensions[key])?spec.dimensions[key]:[spec.dimensions[key]],conflict=current.some(value=>values.includes(value));
  if(conflict&&!Object.hasOwn(explicit,key))throw new SafetyError('简报排除了 '+key+' 的 '+current.join(',')+'，请明确选择其他受支持值',422);
  if(conflict)spec.warnings.push(key+' 的明确选项与中文否定表达冲突，请核对。');
 }
 for(const key of Object.keys(localized.dimensions))if(!Object.hasOwn(explicit,key))spec.provenance[key]='chinese_keyword';
 spec.warnings=spec.warnings.filter(text=>!text.startsWith('仅匹配原规则中的有限英文关键词'));
 spec.warnings.push(...localized.warnings,'解析器仅识别已列明的中英文设计维度和否定约束；未识别意图保留在原简报中，请核对默认项。');
 return {...spec,processorVersion:2,languageEvidence:localized.matches,negativeConstraints:localized.forbidden};
}
