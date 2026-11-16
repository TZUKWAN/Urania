import {readFile,stat,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {openNativeSession} from './native.js';
import {SafetyError} from './safety.js';

// Exchange formats use the installed native exporter on immutable
// bytes. The current editor stays open with its own selection and undo history.
export async function exportCheckpoint(store,sourceId,revision,format,signal){
 const saved=await store.source(sourceId,revision);
 const photo=saved.meta.engine==='photocraft'&&['psd','webp','tiff'].includes(format);
 const deck=saved.meta.engine==='deckcraft'&&format==='pdf';
 if(!photo&&!deck)throw new SafetyError('此原生源不支持所选交换格式',422);
 const session=await openNativeSession(saved.meta.engine,store.root,{signal});
 const file=join(session.directory,'exchange.'+format);
 try{
  await session.call(photo?'doc_open':'open_presentation',{path:saved.path});
  const exported=photo?await session.call('doc_save',{path:file,format}):await session.call('export',{path:file,format:'pdf',textLayer:true,dpi:144});
  const info=await stat(file);
  if(!info.isFile()||info.size<24||info.size>128*1024*1024)throw new SafetyError('原生导出文件为空或超过预算',413);
  const bytes=await readFile(file);
  const valid=format==='psd'?bytes.toString('ascii',0,4)==='8BPS':format==='webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':format==='tiff'?['49492a00','4d4d002a','49492b00','4d4d002b'].includes(bytes.subarray(0,4).toString('hex')):bytes.toString('ascii',0,5)==='%PDF-';
  if(!valid)throw new SafetyError('原生导出格式核对失败',422);
  const warnings=Array.isArray(exported.data?.warnings)?exported.data.warnings.filter(item=>typeof item==='string').slice(0,20).map(item=>item.slice(0,200)):[];
  if(session.projectFontCount)warnings.push('本机导出已提供项目字体，但系统同名字体可能被优先选用；文字外观需核对。');
  return {bytes,type:({psd:'image/vnd.adobe.photoshop',webp:'image/webp',tiff:'image/tiff',pdf:'application/pdf'})[format],warnings};
 }finally{
  await session.close();
  await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
}
