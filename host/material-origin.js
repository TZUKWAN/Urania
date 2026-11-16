/** Explicit project-local source declarations carried by native objects. */
import {SafetyError,assertSafeJson} from './safety.js';
export const VECTOR_ORIGIN_KEY='dsh-material-v1',DECK_ORIGIN_KEY='DSH-MATERIAL-V1';
const identity=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(value);
const match=(key,engine)=>typeof key==='string'&&(engine==='deckcraft'?key.toUpperCase()===DECK_ORIGIN_KEY:key===VECTOR_ORIGIN_KEY);
function entries(node,engine){
 const value=engine==='deckcraft'?node?.tags:node?.attrs?.data;
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.some(row=>!Array.isArray(row)||row.length!==2||typeof row[0]!=='string'||typeof row[1]!=='string'))throw new SafetyError('原生来源字段结构无效',422);
 return value;
}
export function materialOrigin(node,engine){
 if(!['vectorcraft','deckcraft'].includes(engine))return null;
 const rows=entries(node,engine).filter(([key])=>match(key,engine));if(!rows.length)return null;
 if(rows.length!==1||Buffer.byteLength(rows[0][1])>1024)throw new SafetyError('原生来源声明重复或超过预算',422);
 let value;try{value=JSON.parse(rows[0][1]);}catch{throw new SafetyError('原生来源声明编码无效',422);}
 assertSafeJson(value);
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='assetId,instanceId,projectId,schema'||value.schema!==1||!identity(value.projectId)||!value.projectId.startsWith('project-')||!identity(value.assetId)||!value.assetId.startsWith('asset-')||typeof value.instanceId!=='string'||!/^[a-f0-9]{32}$/.test(value.instanceId))throw new SafetyError('原生来源声明身份无效',422);
 return value;
}
function withoutOrigin(node,engine){
 if(engine==='deckcraft')return entries(node,engine).filter(([key])=>!match(key,engine));
 const attrs=structuredClone(node.attrs||{}),data=entries(node,engine).filter(([key])=>!match(key,engine));
 if(data.length)attrs.data=data;else delete attrs.data;return attrs;
}
/** Validate the only allowed provenance change, then restore its old native
 * representation for the caller's whole-document non-content comparison. */
export function normalizeMaterialOrigin(before,after,engine,expected){
 const old=materialOrigin(before,engine),next=materialOrigin(after,engine);
 if(!old&&!next)return;
 if(!expected){
  if(JSON.stringify(old)!==JSON.stringify(next))throw new SafetyError('原生来源声明在非授权操作中改变',409);
  return;
 }
 if(old&&(old.projectId!==expected.projectId||old.assetId!==expected.previousAssetId))throw new SafetyError('原图片的来源声明与已绑定版本不一致',409);
 if(!next||next.projectId!==expected.projectId||next.assetId!==expected.assetId||old&&old.instanceId!==next.instanceId)throw new SafetyError('已保存图片的来源声明不属于本次原位回写',409);
 if(JSON.stringify(withoutOrigin(before,engine))!==JSON.stringify(withoutOrigin(after,engine)))throw new SafetyError('原位回写改变了非来源属性或标签',409);
 const field=engine==='deckcraft'?'tags':'attrs';
 if(Object.hasOwn(before,field))after[field]=structuredClone(before[field]);else delete after[field];
}
export function originInstanceId(projectId,sourceId,token,digest){
 // Source-local identity survives undo/reopen; native copies have new tokens.
 const hex=digest(Buffer.from(projectId+'\0'+sourceId+'\0'+token)).slice(0,32);
 return 'use-'+[hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}
