import {readFile,lstat} from 'node:fs/promises';
import {join,win32} from 'node:path';
import {createHash} from 'node:crypto';

const files={regular:'msyh.ttc',bold:'msyhbd.ttc'};
const cache=new Map();

/** Load the current Windows installation's display faces for a local renderer. */
export async function deckDisplayFont(face){
 const systemRoot=process.env.SystemRoot;
 if(process.platform!=='win32'||!Object.hasOwn(files,face)||!systemRoot||!win32.isAbsolute(systemRoot))return null;
 const file=join(systemRoot,'Fonts',files[face]);
 const stat=await lstat(file).catch(()=>null);
 if(!stat?.isFile()||stat.isSymbolicLink()||stat.size<16||stat.size>24*1024*1024)return null;
 const identity=stat.mtimeMs+':'+stat.size;
 const current=cache.get(file);
 if(current?.identity===identity)return current.promise;
 const promise=(async()=>{
  const bytes=await readFile(file);
  if(bytes.length!==stat.size||bytes.subarray(0,4).toString('ascii')!=='ttcf')return null;
  return {face,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};
 })();
 cache.set(file,{identity,promise});
 try{return await promise;}
 catch(error){if(cache.get(file)?.promise===promise)cache.delete(file);throw error;}
}

export function isLocalFontRequest(req){
 const address=req.socket?.remoteAddress||'';
 const host=req.headers.host||'';
 if(req.headers.forwarded||req.headers['x-forwarded-for']||req.headers['x-forwarded-host'])return false;
 return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address)&&/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
}
