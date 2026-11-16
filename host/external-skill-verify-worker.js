import {parentPort,workerData} from 'node:worker_threads';
import {OpenDesignLibrary} from './open-design-library.js';
import {verifyExternalSkillBundle} from './external-skill-bundles.js';

try{
 const checked=verifyExternalSkillBundle(new OpenDesignLibrary({root:workerData.libraryRoot}),Buffer.from(workerData.archive),workerData.receipt,Buffer.from(workerData.stub));
 const row=workerData.file===undefined?null:checked.metadata.files.find(item=>item.path===workerData.file);
 if(workerData.file!==undefined&&!row)throw Object.assign(new Error('文件不在已保存的外部原包中'),{status:404});
 let selectedFiles;
 if(workerData.files!==undefined){
  if(!Array.isArray(workerData.files)||workerData.files.length>16||new Set(workerData.files).size!==workerData.files.length)throw Object.assign(new Error('所选文件超过预算'),{status:422});
  selectedFiles=workerData.files.map(path=>{const item=checked.metadata.files.find(value=>value.path===path);if(!item)throw Object.assign(new Error('文件不在已保存的外部原包中'),{status:404});return {path,bytes:checked.entries.get(item.archivePath)};});
  if(selectedFiles.reduce((total,item)=>total+item.bytes.length,0)>16*1024*1024)throw Object.assign(new Error('所选文件超过总预算'),{status:413});
 }
 const {tree,...metadata}=checked.metadata;
 parentPort.postMessage({ok:true,metadata,...(row?{selected:checked.entries.get(row.archivePath)}:{}),...(selectedFiles?{selectedFiles}:{})});
}catch(error){parentPort.postMessage({ok:false,status:error.status||500,error:String(error.message||error)});}
