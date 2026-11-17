#!/usr/bin/env node
import {readFile,stat,realpath} from 'node:fs/promises';
import {createReadStream,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {checkMotionRuntime} from '../host/motion/runtime-env.js';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceOnly=process.argv.includes('--source-only');
const result={schemaVersion:1,scope:sourceOnly?'source-metadata':'installed-win32-x64',ok:false,readyForDsh:false,checks:[],problems:[]};
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const sha=async file=>{const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');};
const check=async(name,run)=>{try{result.checks.push({name,ok:true,...await run()});}catch(error){result.problems.push({name,error:error.message,recovery:error.recovery||'参见 DEPLOYMENT_AND_RECOVERY.md；不要覆盖已有作品。'});}};
const inside=async relative=>{
 if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f:*?"<>|]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw new Error('Invalid release path');
 const file=path.resolve(root,relative),base=await realpath(root),actual=await realpath(file);
 if(!actual.toLowerCase().startsWith((base+path.sep).toLowerCase())||!(await stat(actual)).isFile())throw new Error('Release file escapes repository or is not a file');return actual;
};
let pkg,assets,manifest;
await check('package-node',async()=>{pkg=await json(path.join(root,'package.json'));if(Number(process.versions.node.split('.')[0])<22||pkg.engines.node!=='>=22')throw new Error('Plugin and Motion require Node >=22');return {version:pkg.version,uiBuild:pkg.designcraftUiBuild,node:process.version,pluginMinimum:22};});
await check('release-metadata',async()=>{
 assets=await json(path.join(root,'release/runtime-assets.json'));const file=await inside('release/runtime-manifest.json');manifest=await json(file);
 if(!pkg||assets.packageVersion!==pkg.version||assets.uiBuild!==pkg.designcraftUiBuild||manifest.sourcePackageVersion!==pkg.version||manifest.uiBuild!==pkg.designcraftUiBuild||assets.platform!=='win32-x64'||manifest.platform!==assets.platform||manifest.files.length!==assets.runtimeManifest.files||await sha(file)!==assets.runtimeManifest.sha256)throw new Error('Package, release and manifest identity differ');
 const seen=new Set();for(const row of manifest.files){if(!row.path.startsWith('runtimes/')||!Number.isSafeInteger(row.bytes)||row.bytes<0||!/^[a-f0-9]{64}$/.test(row.sha256)||seen.has(row.path.toLowerCase()))throw new Error('Invalid or duplicate manifest file');seen.add(row.path.toLowerCase());}
 return {files:manifest.files.length,manifestSha256:assets.runtimeManifest.sha256};
});
if(!sourceOnly){
 await check('platform',async()=>{if(process.platform!=='win32'||process.arch!=='x64')throw new Error('This release requires Windows x64');return {platform:process.platform,arch:process.arch};});
 await check('installed-runtimes',async()=>{
  if(!manifest)throw new Error('Valid release manifest is required');let bytes=0;
  for(const row of manifest.files){const file=await inside(row.path);if((await stat(file)).size!==row.bytes||await sha(file)!==row.sha256)throw new Error('Runtime checksum mismatch: '+row.path);bytes+=row.bytes;}
  return {files:manifest.files.length,bytes,allSha256Matched:true};
 });
 await check('dsh-sdk',async()=>{
  let directory=process.env.DESIGNCRAFT_DSH_ROOT;
  if(!directory){try{const req=createRequire(import.meta.url);let cursor=path.dirname(req.resolve('@deepseek-ai/dsh'));for(let i=0;i<5;i++,cursor=path.dirname(cursor)){if(existsSync(path.join(cursor,'package.json'))&&(await json(path.join(cursor,'package.json'))).name==='@deepseek-ai/dsh'){directory=cursor;break;}}}catch{}}
  if(!directory||!path.isAbsolute(directory))throw new Error('Set DESIGNCRAFT_DSH_ROOT to the absolute installed @deepseek-ai/dsh package directory');
  const sdk=await json(path.join(directory,'package.json'));if(sdk.name!=='@deepseek-ai/dsh'||!existsSync(path.join(directory,'lib/bin.js')))throw new Error('DSH package or CLI is missing');
  const minimum=/^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(sdk.engines?.node||'');
  if(!minimum)throw new Error('DSH Node requirement is not recognized: '+sdk.engines?.node);
  const current=process.versions.node.split('.').map(Number),needed=minimum.slice(1).map(Number);
  if(current[0]<needed[0]||(current[0]===needed[0]&&(current[1]<needed[1]||(current[1]===needed[1]&&current[2]<needed[2]))))throw new Error('Installed DSH requires Node '+sdk.engines.node+'; use the stricter host requirement');
  return {version:sdk.version,nodeRequirement:sdk.engines.node,validatedSdkVersion:'0.2.2-rc.1',sameAsValidatedSdk:sdk.version==='0.2.2-rc.1',launched:false};
 });
 await check('motion-runtime',async()=>{const {workerEnv,...report}=checkMotionRuntime();return report;});
}
result.ok=result.problems.length===0;
result.readyForDsh=!sourceOnly&&result.ok;
console.log(JSON.stringify(result,null,2));
if(!result.ok)process.exitCode=1;
