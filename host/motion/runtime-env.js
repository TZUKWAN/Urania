/** Trusted machine configuration only. Never inherit provider credentials into a renderer. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';

export class MotionRuntimeError extends Error {
 constructor(component,message){super(message);this.code='E_MOTION_RUNTIME';this.component=component;this.status=422;this.recovery='运行 node scripts/motion-doctor.mjs 检查环境；配置 DESIGNCRAFT_BROWSER_PATH 和 DESIGNCRAFT_FFMPEG_DIR 后，在方便时重新加载 DSH。';}
}
const error=(component,message)=>{throw new MotionRuntimeError(component,message);};
export function parseRuntimeVersion(component,text){
 const pattern=component==='node'?/^v?(\d+)\.(\d+)\.(\d+)/:component==='browser'?/(?:Chromium|Chrome|Edge|Edg|HeadlessChrome)[ /]*(\d+)\.(\d+)\.(\d+)/i:/\b(?:ffmpeg|ffprobe) version\s+n?(\d+)\.(\d+)(?:\.(\d+))?/i;
 const m=pattern.exec(String(text).trim()),minimum=component==='node'?22:component==='browser'?120:6;
 if(!m||Number(m[1])<minimum)error(component,`${component} 版本不符合要求（最低 ${minimum}）；请安装受支持版本`);
 return m.slice(1,4).map(n=>Number(n||0)).join('.');
}
function executable(file,component){
 if(!file||!path.isAbsolute(file))error(component,`${component} 必须配置绝对路径`);
 let real;try{real=fs.realpathSync(file);if(!fs.statSync(real).isFile())throw new Error('not a file');fs.accessSync(real,fs.constants.X_OK);}catch{error(component,`${component} 程序不存在或不可执行：${file}`);}
 if(process.platform==='win32'){
  const fd=fs.openSync(real,'r'),head=Buffer.alloc(2);try{fs.readSync(fd,head,0,2,0);}finally{fs.closeSync(fd);}
  if(path.extname(real).toLowerCase()!=='.exe'||head.toString()!=='MZ')error(component,`${component} 需要真实的 Windows EXE 程序`);
 }
 return real;
}
function locate(names,env){
 for(const directory of (env.PATH||env.Path||'').split(path.delimiter).filter(Boolean)){
  if(!path.isAbsolute(directory))continue;
  for(const name of names){const file=path.join(directory.replace(/^"|"$/g,''),name);try{if(fs.statSync(file).isFile())return file;}catch{}}
 }
}
const bin=name=>name+(process.platform==='win32'?'.exe':'');
export function resolveMotionPaths({env=process.env,components=['node','browser','ffmpeg','ffprobe']}={}){
 const result={};
 if(components.includes('node'))result.nodePath=executable(process.execPath,'node');
 if(components.some(c=>c==='ffmpeg'||c==='ffprobe')){
  const dir=env.DESIGNCRAFT_FFMPEG_DIR;if(dir&&!path.isAbsolute(dir))error('ffmpeg','DESIGNCRAFT_FFMPEG_DIR 必须是绝对目录');
  for(const component of ['ffmpeg','ffprobe'].filter(c=>components.includes(c)))result[component+'Path']=executable(dir?path.join(dir,bin(component)):locate([bin(component)],env),component);
 }
 if(components.includes('browser')){
  const configured=env.DESIGNCRAFT_BROWSER_PATH;
  if(configured&&!path.isAbsolute(configured))error('browser','DESIGNCRAFT_BROWSER_PATH 必须是绝对文件或目录');
  const names=process.platform==='win32'?['chrome.exe','msedge.exe','headless_shell.exe']:['chromium','chromium-browser','google-chrome','chrome'];
  let chosen=configured;
  if(configured&&fs.existsSync(configured)&&fs.statSync(configured).isDirectory())chosen=names.map(n=>path.join(configured,n)).find(f=>fs.existsSync(f));
  if(!configured){
   chosen=locate(names,env);
   if(!chosen&&process.platform==='win32'){
    const bases=[env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.LOCALAPPDATA].filter(Boolean);
    chosen=bases.flatMap(base=>['Google/Chrome/Application/chrome.exe','Microsoft/Edge/Application/msedge.exe'].map(s=>path.join(base,s))).find(f=>fs.existsSync(f));
   }
  }
  result.browserPath=executable(chosen,'browser');
 }
 return result;
}
export function motionWorkerEnvironment(paths,env=process.env){
 const safe={};for(const name of ['SYSTEMROOT','SYSTEMDRIVE','COMSPEC','PATHEXT','WINDIR','TEMP','TMP','LOCALAPPDATA','OS'])if(env[name]!==undefined)safe[name]=env[name];
 // Child processes use validated absolute executables; PATH, NODE_OPTIONS,
 // proxy variables and credentials have no role in rendering.
 safe.ELECTRON_RUN_AS_NODE='1';
 if(paths.browserPath)safe.DESIGNCRAFT_BROWSER_PATH=paths.browserPath;
 if(paths.ffmpegPath)safe.DESIGNCRAFT_FFMPEG_DIR=path.dirname(paths.ffmpegPath);
 return safe;
}
export function checkMotionRuntime({env=process.env,components=['node','browser','ffmpeg','ffprobe']}={}){
 const paths=resolveMotionPaths({env,components}),versions={},safe=motionWorkerEnvironment(paths,env);
 if(components.includes('node'))versions.node=parseRuntimeVersion('node',process.versions.node);
 for(const component of ['ffmpeg','ffprobe'].filter(c=>components.includes(c))){
  let output;try{output=execFileSync(paths[component+'Path'],['-version'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:128*1024,env:safe});}catch{error(component,`${component} 无法启动或版本检查超时`);}
  versions[component]=parseRuntimeVersion(component,output);
 }
 if(components.includes('browser')){
  // A private headless profile also makes version probing independent of the
  // person's existing browser, including launchers that reuse a live profile.
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'urania-browser-version-'));
  try{
   let output;try{output=execFileSync(paths.browserPath,['--headless=new','--no-first-run','--disable-background-networking','--user-data-dir='+profile,'--version'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:128*1024,env:safe});}catch{error('browser','浏览器无法无窗口启动或版本检查超时');}
   versions.browser=parseRuntimeVersion('browser',output);
  }finally{try{fs.rmSync(profile,{recursive:true,force:true});}catch{}}
 }
 return {ok:true,paths,versions,requirements:{node:22,browser:120,ffmpeg:6,ffprobe:6},workerEnv:safe};
}
