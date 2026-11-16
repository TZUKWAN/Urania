/** Save client-reported Tailwind CSS as a guarded HTML revision. */
import {createHash} from 'node:crypto';
import {HtmlArtifacts,previewFiles,validateTailwindFreezeOperation} from './html-artifacts.js';
import {TAILWIND_PREVIEW_SHA256,TAILWIND_LICENSE_SHA256,tailwindLicenseBytes} from './tailwind-preview.js';
import {SafetyError} from './safety.js';

const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const tag=()=>/<script\s+src\s*=\s*(["'])https:\/\/cdn\.tailwindcss\.com(?:\/3\.4\.17)?\1\s*>\s*<\/script\s*>/gi;
const licensePath='assets/tailwind-3.4.17-'+TAILWIND_LICENSE_SHA256.slice(0,16)+'.license.txt';
const decode=file=>{try{const bytes=Buffer.from(file.data,'base64'),text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);if(!Buffer.from(text,'utf8').equals(bytes))throw new Error();return text;}catch{throw new SafetyError('网页入口不能无损读取为 UTF-8',422);}};
function entryWithStylesheet(before,cssPath){
 if(/<base\b/i.test(before))throw new SafetyError('网页含 base 标签，请手动处理样式路径',422);
 const pattern=tag();if(!pattern.test(before)||pattern.test(before))throw new SafetyError('网页入口缺少唯一受支持的 Tailwind CDN 标签',422);
 const depth=cssPath.entry.split('/').length-1,href='../'.repeat(depth)+cssPath.path;
 return before.replace(tag(),()=>'<link rel="stylesheet" href="'+href+'">');
}
function cssBytes(css){
 if(typeof css!=='string')throw new SafetyError('缺少预览报告的 Tailwind 样式',422);
 const bytes=Buffer.from(css,'utf8');if(!bytes.length||bytes.length>2*1024*1024||!/tailwindcss\s+v3\.4\.17/i.test(css)||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes)!==css)throw new SafetyError('预览样式缺少版本标记、编码无效或超过预算',422);return bytes;
}
function findPath(files,path){return files.find(file=>file.path.toLowerCase()===path.toLowerCase());}
function sameFile(left,right){return !!left&&!!right&&left.path===right.path&&left.sha256===right.sha256&&left.bytes===right.bytes&&left.mime===right.mime;}

/** Check the exact file-level transition, not the semantic completeness of the CSS. */
export function verifyTailwindFreezeTransition(before,after){
 const op=after?.operation;validateTailwindFreezeOperation(op,after?.parentRevision);
 if(!before||after.parentRevision!==op.baseRevision||after.title!==before.title||after.entry!==before.entry||JSON.stringify(after.provenance||null)!==JSON.stringify(before.provenance||null))throw new SafetyError('Tailwind 保存改变了未授权的网页属性',409);
 const prior=new Map(before.files.map(file=>[file.path,file])),next=new Map(after.files.map(file=>[file.path,file])),oldEntry=prior.get(before.entry),newEntry=next.get(before.entry),css=next.get(op.cssPath),license=next.get(op.licensePath);
 if(!oldEntry||!newEntry||!css||!license||css.sha256!==op.cssSha256||css.bytes!==op.cssBytes||license.sha256!==op.licenseSha256)throw new SafetyError('Tailwind 样式或许可文件与回执不一致',409);
 const actualCss=Buffer.from(css.data,'base64'),actualLicense=Buffer.from(license.data,'base64');
 if(actualCss.length!==op.cssBytes||sha(actualCss)!==op.cssSha256||sha(actualLicense)!==TAILWIND_LICENSE_SHA256)throw new SafetyError('Tailwind 样式或许可字节不一致',409);
 let cssText;try{cssText=new TextDecoder('utf-8',{fatal:true}).decode(actualCss);}catch{throw new SafetyError('Tailwind 样式不是有效 UTF-8',409);}cssBytes(cssText);
 const expected=Buffer.from(entryWithStylesheet(decode(oldEntry),{entry:before.entry,path:op.cssPath}),'utf8');
 if(sha(expected)!==op.entrySha256||newEntry.sha256!==op.entrySha256||!Buffer.from(newEntry.data,'base64').equals(expected))throw new SafetyError('Tailwind 入口替换与回执不一致',409);
 const added=[op.cssPath,op.licensePath].filter(path=>!prior.has(path));
 if(next.size!==prior.size+added.length)throw new SafetyError('Tailwind 保存改变了其他文件数量',409);
 for(const [path,file]of prior)if(path!==before.entry&&!sameFile(file,next.get(path)))throw new SafetyError('Tailwind 保存改变了其他网页文件',409);
 return true;
}

export async function tailwindFreezeStatus(store,id,operationId,{baseRevision,cssSha256}={}){
 if(!HASH.test(operationId||''))throw new SafetyError('Tailwind 保存身份无效',422);
 const rows=await store.lineage(id),matches=rows.map((item,index)=>({item,index})).filter(({item})=>item.value.operation?.action==='tailwind-freeze'&&item.value.operation.id==='tailwindfreeze-'+operationId);
 if(matches.length>1)throw new SafetyError('同一 Tailwind 保存身份出现多个版本',409);
 if(!matches.length)return {id,found:false,note:'未发现该操作的已发布网页版本。'};
 const {item,index}=matches[0],op=item.value.operation;if(!index||baseRevision!==undefined&&op.baseRevision!==baseRevision||cssSha256!==undefined&&op.cssSha256!==cssSha256)throw new SafetyError('Tailwind 保存身份与请求不一致',409);
 if(rows[index-1].revision!==op.baseRevision)throw new SafetyError('Tailwind 保存基线不一致',409);verifyTailwindFreezeTransition(rows[index-1].value,item.value);
 return {id,found:true,revision:item.revision,currentRevision:rows.at(-1).revision,cssPath:op.cssPath,cssSha256:op.cssSha256,licensePath:op.licensePath,note:'已核对网页版本与客户端报告的静态 CSS；动态类、字体和视觉效果仍需检查。'};
}

export async function freezeTailwindHtml(root,{id,baseRevision,operationId,css},signal,current){
 if(!HASH.test(baseRevision||'')||!HASH.test(operationId||''))throw new SafetyError('Tailwind 保存需要准确基线和稳定身份',422);
 const cssData=cssBytes(css),cssSha256=sha(cssData),store=new HtmlArtifacts(root),prior=await tailwindFreezeStatus(store,id,operationId,{baseRevision,cssSha256});
 if(prior.found){signal?.throwIfAborted();current?.();return {...prior,reused:true};}
 const base=await store.read(id),document=base.document;if(base.revision!==baseRevision)throw new SafetyError('网页已有新版本，未覆盖原稿',409);
 const oldEntry=document.files.find(file=>file.path===document.entry);if(!oldEntry)throw new SafetyError('网页入口不存在',409);
 const cssPath='assets/tailwind-'+cssSha256+'.css',license=await tailwindLicenseBytes(),entryBytes=Buffer.from(entryWithStylesheet(decode(oldEntry),{entry:document.entry,path:cssPath}),'utf8');
 for(const [path,bytes]of [[cssPath,cssData],[licensePath,license]]){const existing=findPath(document.files,path);if(existing&&(existing.path!==path||existing.bytes!==bytes.length||existing.sha256!==sha(bytes)))throw new SafetyError('网页已有不同内容的样式或许可文件，未覆盖',409);}
 const files=document.files.map(file=>({path:file.path,data:file.path===document.entry?entryBytes.toString('base64'):file.data}));
 if(!findPath(document.files,cssPath))files.push({path:cssPath,data:cssData.toString('base64')});
 if(!findPath(document.files,licensePath))files.push({path:licensePath,data:license.toString('base64')});
 const operation={action:'tailwind-freeze',id:'tailwindfreeze-'+operationId,baseRevision,cssPath,cssSha256,cssBytes:cssData.length,licensePath,licenseSha256:TAILWIND_LICENSE_SHA256,entrySha256:sha(entryBytes),evidence:'client-reported-css',scriptSha256:TAILWIND_PREVIEW_SHA256};
 const prospective={...document,parentRevision:baseRevision,files:previewFiles(files,document.entry),operation};verifyTailwindFreezeTransition(document,prospective);
 signal?.throwIfAborted();current?.();
 try{await store.save({id,baseRevision,title:document.title,entry:document.entry,files,operation});}
 catch(error){if(error.status!==409)throw error;const checked=await tailwindFreezeStatus(store,id,operationId,{baseRevision,cssSha256});if(!checked.found)throw error;return {...checked,reused:true};}
 signal?.throwIfAborted();current?.();return tailwindFreezeStatus(store,id,operationId,{baseRevision,cssSha256});
}
