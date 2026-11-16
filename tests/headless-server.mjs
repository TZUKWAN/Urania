// Isolated HTTP host for the actual plugin routes and client entry, never the user's DSH.
import {createServer} from 'node:http';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {apply} from '../host/index.js';
import {createDoc,saveAsset} from '../host/docstore.js';
import {createImage,toPNG} from '../host/raster.js';
const base=resolve(process.argv[2]),vendor=resolve(process.argv[3]);
mkdirSync(base,{recursive:true});const root=process.argv[4]?resolve(process.argv[4]):mkdtempSync(join(base,'headless-'));if(!relative(base,root)||relative(base,root).startsWith('..'))throw new Error('Test root must be inside its owned base');
if(!existsSync(join(root,'design','drawing.dc.json'))){
saveAsset(root,'red.png',toPNG(createImage(8,8,[255,0,0,255])));
saveAsset(root,'black.png',toPNG(createImage(8,8,[0,0,0,255])));
createDoc(root,{id:'drawing',title:'协作检查',type:'canvas',canvas:{width:320,height:240},assets:[],pages:[{id:'p1',name:'画板',background:{kind:'solid',color:'#ffffff'},layers:[{id:'shape',type:'shape',shape:'rect',name:'shape',x:20,y:20,w:60,h:40,fill:'#ff0000'},{id:'text',type:'text',name:'标题',text:'base',x:20,y:90,w:200,h:30,fontSize:18,color:'#000000'}]}]});
}
const routes=new Map(),cleanup=[];
const effect=fn=>{const off=fn();if(typeof off==='function')cleanup.push(off)};
const hostServices={effect,webServer:{register:r=>{routes.set(r.path,r.handler);return()=>routes.delete(r.path)}},skills:{register:()=>()=>{}}};
if(process.env.DESIGNCRAFT_TEST_DSH_OPENROUTER_KEY||process.env.DESIGNCRAFT_TEST_DSH_EASY_KEY){hostServices.credentials={resolve:async ref=>{const value=ref==='OPENROUTER_API_KEY'?process.env.DESIGNCRAFT_TEST_DSH_OPENROUTER_KEY:ref==='EASYCLIPROXYAPI_API_KEY'?process.env.DESIGNCRAFT_TEST_DSH_EASY_KEY:undefined;return value?{value}:undefined;}};}
apply({get:key=>hostServices[key],effect,inject:(keys,fn)=>{if(keys.every(key=>hostServices[key]!==undefined))fn(hostServices)}},{imageConnections:JSON.parse(process.env.DESIGNCRAFT_TEST_IMAGE_CONNECTIONS||'[]')});
const html=`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#11151b;color:#eee;font:14px sans-serif}#root{height:calc(100vh - 24px)}#shell-sentinel{height:24px}</style></head><body><div id="shell-sentinel">isolated host alive</div><div id="root"></div><script src="/vendor/react.development.js"></script><script src="/vendor/react-dom.development.js"></script><script>
window.__DESIGNCRAFT_TEST__=true;const cleanups=[];const effect=fn=>{const off=fn();if(typeof off==='function')cleanups.push(off)};
const view=ReactDOM.createRoot(document.getElementById('root'));
const services={effect,locale:{register:()=>()=>{}},sessions:{list:{getSnapshot:()=>({byId:{test:{cwd:${JSON.stringify(root)},retainedBy:{mainView:1}}}}),subscribe:()=>()=>{}}},uiWorkspace:{pickDirectory:async()=>${JSON.stringify(root)}}};
services.slots={inject:(_name,fn)=>effect(fn),register:(info,factory)=>{if(info.name==='main')view.render(factory());return()=>{};}};
const ctx={...services,inject:(keys,fn)=>{if(keys.every(key=>services[key]!==undefined))fn(services)},get:name=>name==='layout'?{panelInfo:{getSnapshot:()=>({})},selectPanel:()=>{}}:undefined};
window.__ModuleLoader__={load:definition=>{const plugin=definition.factory(name=>{if(name==='react')return React;throw new Error('unsupported test dependency '+name)});plugin.apply(ctx)}};
window.addEventListener('beforeunload',()=>{for(const fn of cleanups.reverse())fn()});
</script><script src="/entry.js"></script></body></html>`;
const server=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);return;}
  if(path==='/entry.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(readFileSync(fileURLToPath(new URL('../client/client.js',import.meta.url))));return;}
  if(['/vendor/react.development.js','/vendor/react-dom.development.js'].includes(path)){res.writeHead(200,{'content-type':'text/javascript'});res.end(readFileSync(join(vendor,path.split('/').pop())));return;}
  const handler=routes.get(path);if(handler)handler(req,res);else{res.writeHead(404);res.end();}
});
server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:'http://127.0.0.1:'+server.address().port,root})+'\n'));
function stop(){for(const fn of cleanup.reverse())try{fn()}catch{}server.closeAllConnections();server.close(()=>{if(process.env.DESIGNCRAFT_KEEP_TEST_ROOT!=='1'&&!relative(base,root).startsWith('..'))rmSync(root,{recursive:true,force:true});process.exit(0)});}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
