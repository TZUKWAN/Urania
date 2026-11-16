import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve,dirname,join} from 'node:path';
import {readFile,mkdtemp,mkdir,copyFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {editorAssetRoutes} from '../host/editor-assets.js';
const packageDir=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const base=resolve(packageDir,'..');
/** 测试靶子 = 生产靶子：桌面内嵌 SDK（tests/.work/dsh-desktop-sdk）优先，其次 DSH_TEST_PACKAGE。 */
function resolveSdkPackage(){
 if(process.env.DSH_TEST_PACKAGE)return process.env.DSH_TEST_PACKAGE;
 return resolve(packageDir,'tests','.work','dsh-desktop-sdk','dsh','package.json');
}
const sdk=createRequire(resolveSdkPackage());
const {Context}=await import(pathToFileURL(sdk.resolve('@deepseek-ai/cordis')).href);
const {default:WebServer}=await import(pathToFileURL(sdk.resolve('@deepseek-ai/dsh-host-webserver')).href);

async function server(root,run){
 const ctx=new Context();
 try{
  await ctx.plugin(WebServer,{host:'127.0.0.1',port:0,compression:'none',compressionLevel:1,compressionThresholdBytes:1024});
  for(const route of editorAssetRoutes(root))ctx.webServer.register(route);
  await run('http://127.0.0.1:'+ctx.webServer.port);
 }finally{await ctx.fiber.dispose();}
}

test('real DSH server streams pinned HTML/WASM with correct MIME and cache validation',async()=>{
 const lock=JSON.parse(await readFile(join(packageDir,'web-runtime-lock.json'),'utf8'));
 const wasm=Object.keys(lock.engines.vectorcraft.files).find(file=>file.endsWith('.wasm'));
 await server(packageDir,async origin=>{
  const html=await fetch(origin+'/designcraft/editor/vectorcraft/index.html');assert.equal(html.status,200);
  assert.match(html.headers.get('content-type'),/^text\/html/);assert.match(await html.text(),/vectorcraft_canvas/);
  const head=await fetch(origin+'/designcraft/editor/vectorcraft/'+wasm,{method:'HEAD'});assert.equal(head.status,200);
  assert.equal(head.headers.get('content-type'),'application/wasm');assert.equal(Number(head.headers.get('content-length')),lock.engines.vectorcraft.files[wasm].bytes);
  const cached=await fetch(origin+'/designcraft/editor/vectorcraft/'+wasm,{headers:{'if-none-match':head.headers.get('etag')}});assert.equal(cached.status,304);
 });
});

test('actual routes reject mutation, unknown engines/files and traversal',async()=>{
 await server(packageDir,async origin=>{
  assert.equal((await fetch(origin+'/designcraft/editor/vectorcraft/index.html',{method:'POST'})).status,405);
  assert.equal((await fetch(origin+'/designcraft/editor/unknown/index.html')).status,404);
  assert.equal((await fetch(origin+'/designcraft/editor/vectorcraft/not-in-lock.js')).status,404);
  assert.equal((await fetch(origin+'/designcraft/editor/vectorcraft/%2E%2E%5Cpackage.json')).status,400);
 });
});

test('same-length tampering is detected before serving an editor script or page',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-assets-')),dir=join(root,'runtimes/web/vectorcraft');await mkdir(dir,{recursive:true});
 const lock=JSON.parse(await readFile(join(packageDir,'web-runtime-lock.json'),'utf8'));
 await copyFile(join(packageDir,'runtimes/web/vectorcraft/index.html'),join(dir,'index.html'));
 await writeFile(join(root,'web-runtime-lock.json'),JSON.stringify(lock));
 await server(root,async origin=>{
  const url=origin+'/designcraft/editor/vectorcraft/index.html';assert.equal((await fetch(url)).status,200);
  const bytes=await readFile(join(dir,'index.html'));bytes[0]=bytes[0]===65?66:65;await writeFile(join(dir,'index.html'),bytes);
  const response=await fetch(url);assert.equal(response.status,409);assert.match((await response.json()).error,/integrity/i);
 });
});

test('an already registered DSH route adopts a published asset manifest without restarting or weakening integrity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'designcraft-assets-update-')),dir=join(root,'runtimes/web/vectorcraft');await mkdir(dir,{recursive:true});
 const lock=JSON.parse(await readFile(join(packageDir,'web-runtime-lock.json'),'utf8'));
 const original=await readFile(join(packageDir,'runtimes/web/vectorcraft/index.html'));
 await writeFile(join(dir,'index.html'),original);await writeFile(join(root,'web-runtime-lock.json'),JSON.stringify(lock));
 await server(root,async origin=>{
  const url=origin+'/designcraft/editor/vectorcraft/index.html';assert.equal((await fetch(url)).status,200);
  const updated=Buffer.concat([original,Buffer.from('\n<!-- owned asset-route update fixture -->')]);
  await writeFile(join(dir,'index.html'),updated);
  assert.equal((await fetch(url)).status,409,'unpublished bytes remain rejected');
  lock.engines.vectorcraft.files['index.html']={bytes:updated.length,sha256:createHash('sha256').update(updated).digest('hex')};
  await writeFile(join(root,'web-runtime-lock.json'),JSON.stringify(lock));
  const next=await fetch(url);assert.equal(next.status,200);assert.deepEqual(Buffer.from(await next.arrayBuffer()),updated);
  // A new expected digest must never reuse verification of the same file under an old digest.
  lock.engines.vectorcraft.files['index.html'].sha256='0'.repeat(64);
  await writeFile(join(root,'web-runtime-lock.json'),JSON.stringify(lock));
  assert.equal((await fetch(url)).status,409);
 });
});
