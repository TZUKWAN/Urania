import {SafetyError} from './safety.js';
import {isUint64,sameUint64,compareUint64} from '../client/native-protocol.js';

/** Apply the same live-document boundary to every step in an engine batch. */
export function checkHostedCommand(command,params={},nested=false){
 if(typeof command!=='string'||!command)throw new SafetyError('缺少原生命令',422);
 if(command==='picture.convertSvgToShapes')throw new SafetyError('SVG 转换必须使用工作区的专用转换动作，以保留原文并核对保存结果',422);
 if(command==='shape.assignBrandOrigins')throw new SafetyError('请使用项目品牌色的专用绑定动作',422);
 if(command==='shape.assignFontOrigins')throw new SafetyError('请使用项目品牌字体的专用绑定动作',422);
 if(command==='object.setProps'&&params?.data&&Object.keys(params.data).some(key=>['dsh-brand-color-v1','dsh-brand-font-v1'].includes(key.toLowerCase().replace(/^data-/,''))))throw new SafetyError('请使用项目品牌的专用绑定动作',422);
 if(/^(file|app)\./.test(command)||/^document\.(open|new|close|save|export|serialize)$/.test(command)||command==='action.batch')throw new SafetyError('文件和文档生命周期必须使用工作区 new/open/save 动作',422);
 if(/^edit\.(undo($|Group\.)|redo$|clearHistory$)/.test(command)||command.startsWith('history.'))throw new SafetyError('AI 撤销必须使用 undo 动作和具体 jobId；不直接操作历史，以免覆盖后续手改',422);
 if(command==='command.batch'){
  if(nested||!Array.isArray(params.commands)||params.commands.length<1||params.commands.length>100)throw new SafetyError('批量编辑需包含1至100个可验证步骤且不能嵌套',422);
  for(const step of params.commands)checkHostedCommand(step?.command,step?.params||{},true);
 }
}

/** A conservative proof: exactly one new, unsliced native undo entry. */
export function singleUndoProof(before,after,checkpointRevision){
 const old=before?.history,next=after?.history;
 if(!before||!after||!sameUint64(before.uid,after.uid)||!isUint64(before.revision)||!isUint64(after.revision)||compareUint64(after.revision,before.revision)<=0||!sameUint64(checkpointRevision,after.revision))return null;
 // The transport limits command replies to the last 20 entries. A full/sliced
 // history or a command that made zero/multiple steps cannot prove ownership.
 if(!Array.isArray(old)||!Array.isArray(next)||old.length>=20||next.length!==old.length+1||JSON.stringify(next.slice(0,-1))!==JSON.stringify(old))return null;
 return {uid:after.uid,revision:after.revision,label:next.at(-1),beforeCount:old.length,afterCount:next.length};
}
