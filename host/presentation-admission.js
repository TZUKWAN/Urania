/** Bounded structural admission only; DeckCraft remains the actual PPTX importer. */
import {readZip} from './zip.js';
import {SafetyError} from './safety.js';

export function validatePresentationInput(bytes,name){
 const format=typeof name==='string'?/\.(pptx|potx|ppsx)$/i.exec(name):null;
 if(!format||!Buffer.isBuffer(bytes)||bytes.length<22||bytes.length>16*1024*1024)throw new SafetyError('请选择不超过 16 MiB 的外部 PPTX、POTX 或 PPSX 原文件',422);
 let entries;
 try{entries=readZip(bytes,{maxEntries:10000,maxEntryBytes:32*1024*1024,maxTotalBytes:128*1024*1024,maxSelectedBytes:2*1024*1024,includeNames:['[Content_Types].xml','ppt/presentation.xml']});}
 catch{throw new SafetyError('演示压缩包结构无效或超过导入预算，原件已保留',422);}
 if(entries.length!==2||entries.some(entry=>!entry.data.length))throw new SafetyError('演示文件缺少必要条目，原件已保留',422);
 return {extension:format[1].toLowerCase(),bytes:bytes.length};
}
