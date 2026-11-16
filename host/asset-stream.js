import {mkdir,open,link,unlink,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {join,extname} from 'node:path';
import {workspacePath,assertPortableName,SafetyError} from './safety.js';
let active=0;
async function digestFile(file,maxBytes){
 const info=await stat(file);if(!info.isFile()||info.size>maxBytes)return null;
 const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');
}
export async function saveAssetStream(root,name,input,{maxBytes=64*1024*1024}={}){
 assertPortableName(name);if(name.length>120||extname(name).length>32)throw new SafetyError('素材文件名过长',400);if(active>=2)throw new SafetyError('已有两个素材在上传，请等待完成',429);active++;
 let temp,handle;
 try{
  const directory=workspacePath(root,'design/assets'),staging=workspacePath(root,'design/.designcraft/uploads');
  await mkdir(directory,{recursive:true});await mkdir(staging,{recursive:true});temp=workspacePath(root,join('design','.designcraft','uploads',randomUUID()+'.tmp'));
  handle=await open(temp,'wx');const hash=createHash('sha256');let bytes=0;
  for await(const raw of input){const chunk=Buffer.isBuffer(raw)?raw:Buffer.from(raw);bytes+=chunk.length;if(bytes>maxBytes)throw new SafetyError('素材超过64MB上传预算',413);hash.update(chunk);let offset=0;while(offset<chunk.length){const written=await handle.write(chunk,offset,chunk.length-offset);if(!written.bytesWritten)throw new Error('素材写入未前进');offset+=written.bytesWritten;}}
  if(!bytes)throw new SafetyError('素材内容为空',400);await handle.sync();await handle.close();handle=null;
  const digest=hash.digest('hex'),extension=extname(name),stem=name.slice(0,name.length-extension.length).slice(0,120);let candidate=name;
  for(let attempt=0;attempt<3;attempt++){
   const target=workspacePath(root,join('design','assets',candidate));
   try{await link(temp,target);return {name:candidate,size:bytes,sha256:digest};}
   catch(error){if(error.code!=='EEXIST')throw error;if(await digestFile(target,maxBytes)===digest)return {name:candidate,size:bytes,sha256:digest};const suffix=attempt?'-'+attempt:'';candidate=stem.slice(0,120-1-digest.length-suffix.length-extension.length)+'-'+digest+suffix+extension;}
  }
  throw new SafetyError('素材名称冲突，原文件未被覆盖',409);
 }finally{try{await handle?.close();}catch{}if(temp)try{await unlink(temp);}catch{}active--;}
}
