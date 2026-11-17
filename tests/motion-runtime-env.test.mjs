/** Filesystem/version/configuration contracts; actual supervisor render is separate. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {resolveMotionPaths,parseRuntimeVersion,motionWorkerEnvironment} from '../host/motion/runtime-env.js';
test('runtime versions reject missing/old tools and accept supported versions',()=>{
 for(const [kind,good,bad] of [['node','v22.12.0','v18.20.0'],['browser','Microsoft Edge 135.0.3179.85','Chrome 100.0.0'],['ffmpeg','ffmpeg version 9.0.2-essentials_build','ffmpeg version 4.4'],['ffprobe','ffprobe version 6.1','unknown']]){assert.ok(parseRuntimeVersion(kind,good));assert.throws(()=>parseRuntimeVersion(kind,bad),/版本/);}
});
test('custom absolute directory supports Chinese/spaces; invalid explicit values do not silently fall back',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'urania 配置 ')),file=path.join(root,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
 try{fs.copyFileSync(process.execPath,file);fs.chmodSync(file,0o755);const paths=resolveMotionPaths({env:{DESIGNCRAFT_FFMPEG_DIR:root},components:['ffmpeg']});assert.equal(paths.ffmpegPath,fs.realpathSync(file));assert.throws(()=>resolveMotionPaths({env:{DESIGNCRAFT_FFMPEG_DIR:'relative'},components:['ffmpeg']}),/绝对/);assert.throws(()=>resolveMotionPaths({env:{DESIGNCRAFT_FFMPEG_DIR:path.join(root,'missing')},components:['ffmpeg']}),/不存在/);assert.throws(()=>resolveMotionPaths({env:{DESIGNCRAFT_BROWSER_PATH:'relative'},components:['browser']}),/绝对/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('worker environment carries only resolved executables and OS bootstrap, never providers/proxies/node options',()=>{
 const env=motionWorkerEnvironment({browserPath:'C:/Chrome/chrome.exe',ffmpegPath:'C:/FF/bin/ffmpeg.exe'},{SYSTEMROOT:'C:/Windows',PATH:'bad',API_KEY:'private',HTTP_PROXY:'private',NODE_OPTIONS:'--import=bad'});
 assert.equal(env.DESIGNCRAFT_BROWSER_PATH,'C:/Chrome/chrome.exe');assert.equal(env.DESIGNCRAFT_FFMPEG_DIR,'C:/FF/bin');for(const name of ['PATH','API_KEY','HTTP_PROXY','NODE_OPTIONS'])assert.equal(env[name],undefined);
});
