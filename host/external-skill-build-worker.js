import {parentPort,workerData} from 'node:worker_threads';
import {createZip} from './zip.js';

try{
 const entries=workerData.files.map(item=>({name:'files/'+item.path,data:Buffer.from(item.bytes),store:true}));
 entries.push({name:'_designcraft/source.json',data:Buffer.from(workerData.metadata),store:true});
 parentPort.postMessage({ok:true,archive:createZip(entries)});
}catch(error){parentPort.postMessage({ok:false,status:error.status||500,error:String(error.message||error)});}
