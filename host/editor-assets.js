/** Pinned professional editor assets. Stream WASM; never serve arbitrary package files. */
import {createReadStream, readFileSync, statSync, realpathSync} from 'node:fs';
import {resolve, relative, extname, sep} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
export const EDITOR_SHARED_MODULES=Object.freeze(['native-protocol.js','native-contract.js']);

const MIME = new Map(Object.entries({
 '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
 '.wasm':'application/wasm', '.json':'application/json; charset=utf-8',
 '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon',
 '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf', '.otf':'font/otf',
 '.part-aa':'application/octet-stream', '.part-ab':'application/octet-stream',
 '.txt':'text/plain; charset=utf-8', '.md':'text/plain; charset=utf-8',
}));

function failure(res, status, message) {
 if (res.headersSent) { res.destroy(); return; }
 res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
 res.end(JSON.stringify({ok:false,error:message}));
}

export function editorAssetRoutes(packageDir, {prefix='/designcraft/editor/'}={}) {
 const lockFile=resolve(packageDir,'web-runtime-lock.json');
 let lock,lockStamp;
 function currentLock(){
  const stat=statSync(lockFile),stamp=[stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino].join(':');
  if(stamp!==lockStamp){
   const next=JSON.parse(readFileSync(lockFile,'utf8'));
   if(next.schema!==1||!next.engines||typeof next.engines!=='object')throw new Error('Invalid editor asset manifest');
   lock=next;lockStamp=stamp;
  }
  return lock;
 }
 currentLock();
 const base=resolve(packageDir,'runtimes/web');
 const integrity=new Map();
 async function verify(file,stat,expected){
  const stamp=[stat.size,stat.mtimeMs,stat.ctimeMs,stat.ino].join(':'),cached=integrity.get(file);
  if(cached?.stamp===stamp&&cached.expected===expected)return cached.promise;
  const promise=(async()=>{const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);
   if(hash.digest('hex')!==expected)throw Object.assign(new Error('Editor bundle integrity check failed'),{status:409});
  })();
  integrity.set(file,{stamp,expected,promise});
  try{await promise;}catch(error){integrity.delete(file);throw error;}
 }
 const routePrefix=prefix.replace(/\/+$/,'');
 const routes=['editor-frame.js','editor-surface.js',...EDITOR_SHARED_MODULES].map(file=>({kind:'exact',path:'/designcraft/workspace/'+file,handler:(req,res)=>{
  if(!['GET','HEAD'].includes(req.method))return failure(res,405,'GET or HEAD required');
  const source=readFileSync(resolve(packageDir,'client',file));res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:source);
 }}));
 routes.push({kind:'prefix',path:routePrefix,handler:async(req,res)=>{
  if (!['GET','HEAD'].includes(req.method)) return failure(res,405,'GET or HEAD required');
  try {
   const pathname=new URL(req.url,'http://localhost').pathname;
   const remainder=decodeURIComponent(pathname.slice(routePrefix.length+1));
   if (!remainder || /[\\\0:]/.test(remainder) || remainder.split('/').some(p=>p==='..'||p==='.')) return failure(res,400,'Invalid editor asset path');
   const [engine,...parts]=remainder.split('/');
   const requested=parts.join('/')||'index.html',hosted=requested==='host.html',file=hosted?'index.html':requested,entry=currentLock().engines[engine]?.files[file];
   if (!entry) return failure(res,404,'Pinned editor asset not found');
   const engineDir=realpathSync(resolve(base,engine)), target=realpathSync(resolve(engineDir,file));
   if (relative(engineDir,target).startsWith('..'+sep)||relative(engineDir,target)==='..') return failure(res,403,'Editor asset outside bundle');
   const stat=statSync(target);
   if (!stat.isFile()||stat.size!==entry.bytes) return failure(res,409,'Editor bundle changed');
   await verify(target,stat,entry.sha256);
   if(hosted){
    const html=readFileSync(target,'utf8').replace('</head>','<script type="module" src="/designcraft/workspace/editor-frame.js"></script></head>');
    const bytes=Buffer.from(html);res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-length':bytes.length,'cache-control':'no-store','origin-agent-cluster':'?1','referrer-policy':'no-referrer','x-content-type-options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   const etag='"'+entry.sha256+'"';
   if (req.headers['if-none-match']===etag) {res.writeHead(304,{etag});res.end();return;}
   res.writeHead(200,{'content-type':MIME.get(extname(file))||'application/octet-stream',
    'content-length':stat.size,'cache-control':file==='index.html'?'no-cache':'private, max-age=86400',
    etag,'x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin',
    'origin-agent-cluster':'?1','referrer-policy':'no-referrer'});
   if(req.method==='HEAD'){res.end();return;}
   await pipeline(createReadStream(target),res);
  } catch(error) {failure(res,error.status||(error instanceof URIError?400:500),String(error.message||error));}
 }});
 return routes;
}
