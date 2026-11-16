import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openNativeSession} from './native.js';
import * as store from './docstore.js';
import {workspacePath,assertPortableName,assertImageSize,SafetyError} from './safety.js';

// Copy the actual native selection through an alpha channel into a temporary
// transparent document. This retains feathering; its bounds are not a substitute.
export async function captureNativeSelection(root,source,{session:provided,signal}={}){
 assertPortableName(source);const session=provided||await openNativeSession('photocraft',root,{signal}),abort=()=>session.close();signal?.addEventListener('abort',abort,{once:true});
 try{
  const opened=await session.call('doc_open',{path:workspacePath(root,join('design','assets',source),{mustExist:true})}),info=(await session.call('doc_inspect',{})).data;assertImageSize(info.width,info.height);if(!info.hasSelection)throw new SafetyError('原生图片没有活动选区',422);if(info.width*info.height>8_000_000)throw new SafetyError('精确选区与局部重绘目前最多8MP',413);
  const name='dc-mask-'+randomUUID();await session.call('command_run',{id:'select.saveSelection',params:{name},wait:true});await session.call('doc_new',{width:info.width,height:info.height,background:'transparent'});
  if(!Number.isInteger(opened.data?.index))throw new SafetyError('源文档索引未确认，未读取近似选区',502);
  await session.call('command_run',{id:'select.loadSelection',params:{document:opened.data.index,channel:name},wait:true});await session.call('command_run',{id:'edit.fill',params:{color:'#ffffff'},wait:true});await session.call('command_run',{id:'select.deselect',params:{},wait:true});
  const output=join(session.directory,'selection-mask.png');await session.call('doc_export',{path:output});const asset=store.saveAsset(root,name+'.png',await readFile(output));return {maskAsset:asset.name,width:info.width,height:info.height,encoding:'alpha',bounds:info.selectionBounds,source};
 }finally{signal?.removeEventListener('abort',abort);if(!provided)await session.close();}
}
