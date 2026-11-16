import {parentPort,workerData} from 'node:worker_threads';
import {projectPackage} from './project-package.js';
try{
 const bytes=await projectPackage(workerData.root);
 const result=bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes:new Uint8Array(bytes);
 parentPort.postMessage({bytes:result},[result.buffer]);
}catch(error){
 parentPort.postMessage({error:error.message||'项目包生成失败',status:error.status||422});
}
