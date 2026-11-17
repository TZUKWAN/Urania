/** One project-relative URL decoding and real-path boundary for local media. */
import fs from 'node:fs';import path from 'node:path';import {safeRelativePath} from './schema.js';
export function resolveProjectResource(projectDir,reference,{baseFile='index.html'}={}){
 if(typeof reference!=='string'||!reference||reference.length>2048)throw new Error('素材路径无效');
 let decoded;try{decoded=decodeURIComponent(reference.split(/[?#]/,1)[0]);}catch{throw new Error('素材路径包含非法编码');}
 if(/^[a-z][a-z0-9+.-]*:/i.test(decoded)||decoded.startsWith('/')||decoded.includes('\\')||/%(?:2e|2f|5c|00)/i.test(decoded))throw new Error('素材必须使用工程内的相对路径，拒绝绝对路径或多重编码');
 safeRelativePath(decoded);safeRelativePath(baseFile);
 const root=fs.realpathSync(projectDir),candidate=path.resolve(root,path.dirname(baseFile),decoded),inside=target=>{const rel=path.relative(root,target);return rel!==''&&rel!=='..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel);};
 if(!inside(candidate))throw new Error('素材路径越出本次工程');
 let real;try{real=fs.realpathSync(candidate);if(!fs.statSync(real).isFile())throw new Error('not a file');}catch{throw new Error('工程素材不存在或不是文件：'+decoded);}
 if(!inside(real))throw new Error('素材符号链接越出本次工程');return real;
}
