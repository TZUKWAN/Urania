/** Actual Cordis/WebServer/Connection/credential provider, isolated from the user profile. */
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';
import {existsSync} from 'node:fs';
import {apply,inject as dcInject} from '../../host/index.js';
const HERE=dirname(fileURLToPath(import.meta.url));
/** 测试靶子 = 生产靶子：优先用从 DSH 桌面 app.asar 解出的内嵌 SDK（tests/.work/dsh-desktop-sdk），
 *  其次用 DSH_TEST_PACKAGE 显式指定。npm 全局的 @deepseek-ai/dsh 是另一棵树，不是桌面运行时。 */
function resolveSdkPackage(){
 if(process.env.DSH_TEST_PACKAGE)return process.env.DSH_TEST_PACKAGE;
 const desktopSdk=join(HERE,'..','.work','dsh-desktop-sdk','dsh','package.json');
 if(existsSync(desktopSdk))return desktopSdk;
 throw new Error('未找到测试用 SDK：请设置 DSH_TEST_PACKAGE，或先从 DSH 桌面 app.asar 解出内嵌 SDK 到 tests/.work/dsh-desktop-sdk');
}
export async function realDshHost(root){
 const sdk=createRequire(resolveSdkPackage()),load=async name=>import(pathToFileURL(sdk.resolve(name)).href);
 const [{Context},{default:WebServer},{default:Credentials},Connection]=await Promise.all([load('@deepseek-ai/cordis'),load('@deepseek-ai/dsh-host-webserver'),load('@deepseek-ai/dsh-credentials-local'),load('@deepseek-ai/dsh-client-connection')]);
 const ctx=new Context();
 try{
  await ctx.plugin(WebServer,{host:'127.0.0.1',port:0,compression:'none',compressionLevel:1,compressionThresholdBytes:1024});
  await ctx.plugin(Credentials,{path:join(root,'test-host-credentials.yaml'),dshHome:root,watch:false});
  await ctx.plugin(Connection,{});
  if(!ctx.get('connection'))throw new Error('Actual DSH Connection did not activate');
  ctx.webServer.register({kind:'exact',path:'/',handler:(req,res)=>{if(ctx.connection.authorizeIndex(req,res)){res.writeHead(200,{'content-type':'text/plain'});res.end('isolated real DSH host');}}});
  await ctx.plugin({name:'designcraft-real-host-integration',inject:dcInject,apply});
  const origin='http://127.0.0.1:'+ctx.webServer.port,response=await fetch(ctx.connection.authenticatedUrl(origin+'/'),{redirect:'manual'});
  const cookie=response.headers.get('set-cookie')?.split(';')[0];if(response.status!==303||!cookie)throw new Error('Actual DSH launch exchange did not issue a signed browser cookie');
  return {origin,ownerFetch:(path,options={})=>{const url=new URL(path,origin);if(url.origin!==origin)throw new Error('Integration request outside owned host');return fetch(url,{...options,headers:{...options.headers,cookie}});},close:()=>ctx.fiber.dispose()};
 }catch(error){await ctx.fiber.dispose();throw error;}
}
