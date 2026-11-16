/** Input identity for Venice's synchronous image transformations. */
import {createHash} from 'node:crypto';
import {SafetyError,assertPortableName} from './safety.js';

export const VENICE_IMAGE_MODES=['venice_upscale','venice_remove_background'];
const HASH=/^[a-f0-9]{64}$/;

export function veniceTransformSignature({mode,provider,asset,sha256,scale,creativity}){
 if(!VENICE_IMAGE_MODES.includes(mode)||typeof provider!=='string'||!provider.trim()||provider.length>200||/[\x00-\x1f\x7f]/.test(provider)||!HASH.test(sha256||''))throw new SafetyError('Venice 图片处理的连接或输入身份无效',422);
 assertPortableName(asset);
 if(mode==='venice_upscale'){
  if(![2,4].includes(scale)||typeof creativity!=='number'||!Number.isFinite(creativity)||creativity<0||creativity>0.02)throw new SafetyError('放大倍数须为 2 或 4，创意强度须为 0 至 0.02',422);
 }else if(scale!==null||creativity!==null)throw new SafetyError('背景移除不接受放大参数',422);
 return createHash('sha256').update(JSON.stringify({mode,provider,asset,sha256,scale,creativity})).digest('hex');
}

export function validateVeniceTransformRecord(job){
 if(!job||!VENICE_IMAGE_MODES.includes(job.mode)||job.kind!=='image.'+job.mode||!job.studio||job.model!==null||job.prompt!==''||job.count!==1||!Array.isArray(job.referenceAssets)||job.referenceAssets.length!==1||!Array.isArray(job.referenceHashes)||job.referenceHashes.length!==1||!HASH.test(job.connectionFingerprint||''))throw new SafetyError('Venice 图片处理任务身份无效',409);
 const signature=veniceTransformSignature({mode:job.mode,provider:job.provider,asset:job.referenceAssets[0],sha256:job.referenceHashes[0],scale:job.scale,creativity:job.creativity});
 if(signature!==job.requestSignature)throw new SafetyError('Venice 图片处理任务与输入身份不一致',409);
 return true;
}
