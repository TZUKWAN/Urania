/** Exact-revision, read-only preview on an origin with no DSH cookies or API. */
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readRevision,readSourceBytes} from './project-store.js';
import {readAssetBytes} from './asset-store.js';
import {validateProjectId,validateRevision,safeRelativePath,SchemaError} from './schema.js';
import {injectFrameRuntime} from './frame-runtime.js';
import {previewShell,previewComposition} from './preview-protocol.js';

const MIME={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',json:'application/json',svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',ttf:'font/ttf',otf:'font/otf',woff:'font/woff',woff2:'font/woff2',mp3:'audio/mpeg',wav:'audio/wav',m4a:'audio/mp4',mp4:'video/mp4',webm:'video/webm',ogg:'audio/ogg'};
const error=(message,status=403)=>Object.assign(new Error(message),{status});
export class MotionPreviewHost{
 constructor({isActive=()=>true,ttlMs=30*60*1000,maxTickets=32}={}){
  this.isActive=isActive;this.ttlMs=ttlMs;this.maxTickets=maxTickets;this.tickets=new Map();this.servers=new Map();this.closed=false;
 }
 async listen(host){
  if(this.closed)throw error('预览服务已关闭',503);
  if(!this.servers.has(host)){
   const pending=new Promise((resolve,reject)=>{
    const server=http.createServer((req,res)=>this.serve(req,res));
    server.maxHeadersCount=32;server.requestTimeout=10000;server.headersTimeout=10000;server.keepAliveTimeout=1000;
    server.once('error',reject);server.listen(0,host,()=>{server.unref();resolve({server,origin:'http://'+host+':'+server.address().port});});
   });this.servers.set(host,pending);pending.catch(()=>this.servers.delete(host));
  }
  return this.servers.get(host);
 }
 async create({root,sessionId,projectId,revision,viewEpoch,leaseId,parentOrigin}){
  validateProjectId(projectId);validateRevision(revision);
  const app=new URL(parentOrigin);
  if(!['http:','https:'].includes(app.protocol)||app.origin!==parentOrigin||!sessionId||!viewEpoch)throw error('预览上下文无效');
  const host=app.hostname==='127.0.0.2'?'127.0.0.3':'127.0.0.2';
  const {origin}=await this.listen(host),manifest=readRevision(root,projectId,revision);
  if(!/\.html?$/i.test(manifest.entryFile))throw error('动画入口必须是 HTML',422);
  const ticket={root,sessionId,projectId,revision,viewEpoch,leaseId,parentOrigin,origin,manifest,nonce:randomBytes(24).toString('hex'),token:randomBytes(32).toString('hex'),expires:Date.now()+this.ttlMs};
  for(const [key,old] of this.tickets)if(old.sessionId===sessionId||old.expires<Date.now())this.tickets.delete(key);
  while(this.tickets.size>=this.maxTickets)this.tickets.delete(this.tickets.keys().next().value);
  this.tickets.set(ticket.token,ticket);
  const base=origin+'/preview/'+ticket.token+'/';
  return {url:base+'_shell',origin,nonce:ticket.nonce,epoch:viewEpoch,projectId,revision,expiresAt:new Date(ticket.expires).toISOString(),entryFile:manifest.entryFile};
 }
 revoke(sessionId,{leaseId,projectId}={}){for(const [token,t] of this.tickets)if(t.sessionId===sessionId&&(!leaseId||t.leaseId===leaseId)&&(!projectId||t.projectId===projectId))this.tickets.delete(token);}
 headers(t){
  const origin=t.origin;
  return {'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','access-control-allow-origin':'*',
   'content-security-policy':"default-src 'none'; script-src 'unsafe-inline' "+origin+"; style-src 'unsafe-inline' "+origin+"; img-src "+origin+" data: blob:; font-src "+origin+" data:; media-src "+origin+" data: blob:; connect-src "+origin+"; frame-src "+origin+"; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors "+t.parentOrigin+' '+origin,
   'permissions-policy':'camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), serial=(), payment=(), clipboard-read=(), clipboard-write=()'};
 }
 serve(req,res){
  try{
   if(!['GET','HEAD'].includes(req.method))throw error('只读预览不接受写入',405);
   if(req.headers.cookie||req.headers.authorization)throw error('预览不接受会话或账号凭据');
   const url=new URL(req.url,'http://preview.invalid'),m=/^\/preview\/([a-f0-9]{64})\/(.+)$/.exec(url.pathname);
   if(!m)throw error('预览路径不存在',404);
   const t=this.tickets.get(m[1]);
   if(!t||t.expires<Date.now()||!this.isActive(t)){if(t)this.tickets.delete(m[1]);throw error('预览已失效，请重新打开',410);}
   if(req.headers.host!==new URL(t.origin).host)throw error('预览 Host 不一致');
   const rel=decodeURIComponent(m[2]);let bytes,mime;
   const config={origin:t.origin,nonce:t.nonce,epoch:t.viewEpoch,render:t.manifest.render};
   if(rel==='_shell'){
    const entry=t.manifest.entryFile.split('/').map(encodeURIComponent).join('/');
    bytes=Buffer.from(previewShell({...config,parentOrigin:t.parentOrigin,entry}));mime=MIME.html;
   }else{
    safeRelativePath(rel);const ext=rel.split('.').pop().toLowerCase();mime=MIME[ext];
    if(!mime)throw error('预览不提供此文件类型',415);
    if(t.manifest.sources[rel])bytes=readSourceBytes(t.root,t.projectId,t.manifest,rel);
    else{
     const a=(t.manifest.assets||[]).find(a=>(a.path||a.file||a.name)===rel);
     if(!a||!/^[a-f0-9]{64}$/.test(a.sha256||''))throw error('文件不在本修订清单中',404);
     bytes=readAssetBytes(t.root,a.sha256).bytes;
    }
    if(ext==='html'||ext==='htm')bytes=Buffer.from(previewComposition(injectFrameRuntime(bytes.toString('utf8')),config));
   }
   const headers={...this.headers(t),'content-type':mime,'content-length':bytes.length};
   const range=req.headers.range;
   if(range){
    const m=/^bytes=(\d+)-(\d*)$/.exec(range);
    if(!m)throw error('不支持此范围',416);
    const start=Number(m[1]),end=m[2]?Number(m[2]):bytes.length-1;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||end>=bytes.length)throw error('范围超过文件',416);
    res.writeHead(206,{...headers,'content-length':end-start+1,'content-range':`bytes ${start}-${end}/${bytes.length}`,'accept-ranges':'bytes'});
    res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));return;
   }
   res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:bytes);
  }catch(e){if(!res.headersSent){res.writeHead(e.status||400,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end('预览不可用：'+String(e.message||e).slice(0,300));}else res.end();}
 }
 async dispose(){
  this.closed=true;this.tickets.clear();
  await Promise.all([...this.servers.values()].map(async pending=>{try{const {server}=await pending;await new Promise(resolve=>{server.close(resolve);server.closeAllConnections?.();});}catch{}}));this.servers.clear();
 }
}
