/** Read-only render assets. No file:// page or browser access outside this project. */
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {randomBytes} from 'node:crypto';
const MIME={html:'text/html; charset=utf-8',htm:'text/html; charset=utf-8',js:'text/javascript',mjs:'text/javascript',css:'text/css',json:'application/json',txt:'text/plain',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',woff2:'font/woff2',woff:'font/woff',ttf:'font/ttf',otf:'font/otf',mp3:'audio/mpeg',wav:'audio/wav',mp4:'video/mp4',webm:'video/webm',m4a:'audio/mp4',ogg:'audio/ogg',wasm:'application/wasm'};
export async function createRenderSourceHost(projectDir){
 const root=fs.realpathSync(projectDir),files=new Map(),token=randomBytes(32).toString('hex');let size=0;
 function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isSymbolicLink())throw new Error('渲染工程不接受符号链接');if(entry.isDirectory()){walk(file);continue;}if(!entry.isFile())continue;
  const rel=path.relative(root,file).split(path.sep).join('/'),real=fs.realpathSync(file);if(!real.startsWith(root+path.sep))throw new Error('渲染资源超出本次工程');const stat=fs.statSync(real);if(files.size>=2048||(size+=stat.size)>256*1024*1024)throw new Error('渲染资源超过预算');files.set(rel,{file:real,bytes:stat.size});}}
 walk(root);let origin='';const basePath='/source/'+token+'/';
 const server=http.createServer((req,res)=>{
  const fail=status=>{res.writeHead(status,{'cache-control':'no-store'});res.end();};
  try{
   if(!['GET','HEAD'].includes(req.method))return fail(405);if(req.headers.cookie||req.headers.authorization||req.headers.host!==new URL(origin).host)return fail(403);
   const url=new URL(req.url,origin);if(url.pathname==='/favicon.ico'){res.writeHead(204,{'cache-control':'no-store'});res.end();return;}if(!url.pathname.startsWith(basePath))return fail(404);const rel=decodeURIComponent(url.pathname.slice(basePath.length)),saved=files.get(rel);if(!saved)return fail(404);
   if(fs.realpathSync(saved.file)!==saved.file||!saved.file.startsWith(root+path.sep))return fail(403);const mime=MIME[rel.split('.').pop().toLowerCase()];if(!mime)return fail(415);const data=fs.readFileSync(saved.file);if(data.length!==saved.bytes)return fail(409);
   const headers={'content-type':mime,'content-length':data.length,'access-control-allow-origin':'*','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' "+origin+"; style-src 'unsafe-inline' "+origin+"; font-src "+origin+" data:; img-src "+origin+" data: blob:; media-src "+origin+" data: blob:; connect-src "+origin+"; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'permissions-policy':'camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=()'};
   if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m)return fail(416);const start=Number(m[1]),end=m[2]?Number(m[2]):data.length-1;if(start>end||end>=data.length||!Number.isSafeInteger(start)||!Number.isSafeInteger(end))return fail(416);res.writeHead(206,{...headers,'content-length':end-start+1,'content-range':`bytes ${start}-${end}/${data.length}`});res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));return;}
   res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:data);
  }catch{return fail(400);}
 });server.maxHeadersCount=32;server.requestTimeout=10000;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.2',resolve);});server.unref();origin='http://127.0.0.2:'+server.address().port;
 const base=origin+basePath;
 return {origin,base,url:rel=>{if(!files.has(rel))throw new Error('动画入口不在本次工程中');return base+rel.split('/').map(encodeURIComponent).join('/');},allows:(raw,type)=>{try{const u=new URL(raw);return u.origin===origin&&(u.pathname.startsWith(basePath)||type!=='Document'&&u.pathname==='/favicon.ico')||type!=='Document'&&['data:','blob:'].includes(u.protocol);}catch{return false;}},close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();})};
}
