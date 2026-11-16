/** A legacy SVG group is eligible only when the exact placed group and its
 * durable placement receipt still agree. This is a preflight, not migration. */
import {createHash} from 'node:crypto';
import {isUint64,sameUint64} from '../client/native-protocol.js';
import {materialOrigin} from './material-origin.js';
import {SafetyError} from './safety.js';

const digest=node=>createHash('sha256').update(JSON.stringify(node)).digest('hex');
/** Canonical native result for a legacy replacement. Reject unexpected fields
 * rather than silently omitting them from the saved-frame receipt. */
export function canonicalLegacyKind(kind,sourceHash){
 if(!kind||typeof kind!=='object'||Array.isArray(kind)||Object.keys(kind).sort().join(',')!=='embedded,height,key,link,type,width,xf'||
    kind.type!=='placeddocument'||kind.embedded!==true||!kind.link||Object.keys(kind.link).join(',')!=='path'||kind.link.path!==''||
    typeof kind.key!=='string'||!/^dsh-native-[a-f0-9]{64}$/.test(kind.key)||sourceHash!==undefined&&kind.key!=='dsh-native-'+sourceHash||
    !Number.isFinite(kind.width)||kind.width<=0||!Number.isFinite(kind.height)||kind.height<=0||!Array.isArray(kind.xf)||kind.xf.length!==6||
    kind.xf.some(v=>typeof v!=='number'||!Number.isFinite(v))||Math.abs(kind.xf[0]*kind.xf[3]-kind.xf[1]*kind.xf[2])<=1e-12)
  throw new SafetyError('旧 SVG 的原生源或边框凭据无效',409);
 return JSON.stringify([kind.type,kind.embedded,kind.link.path,kind.key,kind.width,kind.height,kind.xf]);
}
export function verifyLegacyVectorBinding({binding,receipt,boundRevision,boundNode,currentNode,asset,instances}){
 if(!binding||!receipt||!asset||asset.format!=='svg'||asset.id!==binding.assetId||binding.originToken||
    boundRevision!==binding.boundAtRevision||typeof binding.nativeNodeHash!=='string'||!/^[a-f0-9]{64}$/.test(binding.nativeNodeHash)||
    typeof binding.id!=='string'||!binding.id.startsWith('use-')||receipt.action!=='place'||'use-'+receipt.id!==binding.id||
    receipt.assetId!==binding.assetId||!isUint64(binding.nativeId)||!sameUint64(receipt.nativeId,binding.nativeId))
  throw new SafetyError('旧 SVG 放置记录或素材来源不一致，未修改设计',409);
 if(!boundNode||!currentNode||boundNode.kind?.type!=='group'||currentNode.kind?.type!=='group'||
    !sameUint64(boundNode.id,binding.nativeId)||!sameUint64(currentNode.id,binding.nativeId)||
    digest(boundNode)!==binding.nativeNodeHash||digest(currentNode)!==binding.nativeNodeHash)
  throw new SafetyError('旧 SVG 组已发生变化或缺少原始对象，未覆盖手工修改',409);
 const descendants=new Set();let count=0;
 function walk(node,depth){
  if(++count>100000||depth>64||!isUint64(node.id))throw new SafetyError('旧 SVG 组结构无效或超过预算',413);
  if(materialOrigin(node,'vectorcraft'))throw new SafetyError('旧 SVG 组含有独立素材来源，不能自动迁移',409);
  if(depth)descendants.add(String(node.id));
  const children=node.kind?.children;
  if(children!==undefined){if(!Array.isArray(children))throw new SafetyError('旧 SVG 组结构无效',422);for(const child of children)walk(child,depth+1);}
 }
 walk(currentNode,0);
 for(const other of Object.values(instances||{}))if(other?.id!==binding.id&&other?.sourceId===binding.sourceId&&isUint64(other?.nativeId)&&descendants.has(String(other.nativeId)))
  throw new SafetyError('旧 SVG 组包含其他已登记使用处，不能自动迁移',409);
 return {nativeId:String(binding.nativeId),assetId:binding.assetId,boundAtRevision:binding.boundAtRevision};
}
