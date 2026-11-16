/** Copy one verified project font and its explicit CSS mapping into HTML history. */
import {createHash} from 'node:crypto';
import {HtmlArtifacts,previewFiles} from './html-artifacts.js';
import {projectFontForHtml} from './project-fonts.js';
import {fontCss,htmlFontLink,validateHtmlFontOperation} from './html-font-contract.js';
import {SafetyError} from './safety.js';

const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sameFile=(a,b)=>!!a&&!!b&&a.path===b.path&&a.mime===b.mime&&a.bytes===b.bytes&&a.sha256===b.sha256;
const findPath=(files,path)=>files.find(file=>file.path.toLowerCase()===path.toLowerCase());

/** Verify exact additions; this does not assert font license or browser rendering. */
export function verifyHtmlFontTransition(before,after){
 const op=after?.operation;validateHtmlFontOperation(op,after?.parentRevision);
 if(!before||after.parentRevision!==op.baseRevision||after.title!==before.title||after.entry!==before.entry||JSON.stringify(after.provenance||null)!==JSON.stringify(before.provenance||null))throw new SafetyError('网页项目字体改变了未授权属性',409);
 const prior=new Map(before.files.map(file=>[file.path,file])),next=new Map(after.files.map(file=>[file.path,file])),font=next.get(op.fontPath),css=next.get(op.cssPath);
 if(!font||!css||font.sha256!==op.fontSha256||font.bytes!==op.fontBytes||css.sha256!==op.cssSha256||css.bytes!==op.cssBytes)throw new SafetyError('网页字体文件与回执不一致',409);
 const fontBytes=Buffer.from(font.data,'base64'),cssBytes=Buffer.from(css.data,'base64'),format=op.fontPath.endsWith('.ttf')?'ttf':'otf';
 if(fontBytes.length!==op.fontBytes||sha(fontBytes)!==op.fontSha256||!cssBytes.equals(fontCss({...op,format})))throw new SafetyError('网页字体或样式字节不一致',409);
 const added=[op.fontPath,op.cssPath].filter(path=>!prior.has(path));
 if(next.size!==prior.size+added.length)throw new SafetyError('网页字体加入改变了其他文件数量',409);
 for(const [path,file]of prior)if(!sameFile(file,next.get(path)))throw new SafetyError('网页字体加入改变了原有文件',409);
 return true;
}

export async function htmlProjectFontStatus(store,id,operationId,{baseRevision,fontId,family,weight,style}={}){
 if(!HASH.test(operationId||''))throw new SafetyError('网页字体操作身份无效',422);
 const rows=await store.lineage(id),matches=rows.map((item,index)=>({item,index})).filter(({item})=>item.value.operation?.action==='project-font-attach'&&item.value.operation.id==='htmlfont-'+operationId);
 if(matches.length>1)throw new SafetyError('同一网页字体操作出现多个版本',409);
 if(!matches.length)return {id,found:false,note:'未发现该操作的已发布网页版本。'};
 const {item,index}=matches[0],op=item.value.operation;
 if(!index||rows[index-1].revision!==op.baseRevision||Object.entries({baseRevision,fontId,family,weight,style}).some(([key,value])=>value!==undefined&&op[key]!==value))throw new SafetyError('网页字体操作身份与请求不一致',409);
 verifyHtmlFontTransition(rows[index-1].value,item.value);
 const entry=item.value.files.find(file=>file.path===item.value.entry),hasBase=/<base\b/i.test(Buffer.from(entry.data,'base64').toString('utf8'));
 return {id,found:true,revision:item.revision,currentRevision:rows.at(-1).revision,fontId:op.fontId,fontPath:op.fontPath,cssPath:op.cssPath,family:op.family,weight:op.weight,style:op.style,link:hasBase?null:htmlFontLink(item.value.entry,op.cssPath),note:'已核对加入的字体和样式文件；页面尚未自动引用。'+(hasBase?'入口含 base，链接路径需按实际 base 处理。':'')+' 字体许可、字形覆盖和显示效果仍需核对。'};
}

export async function attachHtmlProjectFont(library,root,{id,baseRevision,operationId,fontId,family,weight,style},signal,current){
 if(!HASH.test(baseRevision||'')||!HASH.test(operationId||''))throw new SafetyError('网页字体加入需要准确基线和稳定身份',422);
 const store=new HtmlArtifacts(root),expected={baseRevision,fontId,family,weight,style};
 let prior=await htmlProjectFontStatus(store,id,operationId,expected);if(prior.found){signal?.throwIfAborted();current?.();return {...prior,reused:true};}
 const base=await store.read(id);if(base.revision!==baseRevision)throw new SafetyError('网页已有新版本，未覆盖原稿',409);
 const selected=await projectFontForHtml(library,root,fontId,signal),format=selected.file.file.slice(-3).toLowerCase(),fontSha256=selected.record.sha256;
 const css=fontCss({family,weight,style,fontSha256,format}),cssSha256=sha(css),fontPath='assets/fonts/project-'+fontSha256+'.'+format,cssPath='assets/fonts/project-'+cssSha256+'.css';
 for(const [path,bytes]of [[fontPath,selected.bytes],[cssPath,css]]){const existing=findPath(base.document.files,path);if(existing&&(existing.path!==path||existing.bytes!==bytes.length||existing.sha256!==sha(bytes)))throw new SafetyError('网页已有不同内容的字体资源，未覆盖',409);}
 const files=base.document.files.map(({path,data})=>({path,data}));
 if(!findPath(base.document.files,fontPath))files.push({path:fontPath,data:selected.bytes.toString('base64')});
 if(!findPath(base.document.files,cssPath))files.push({path:cssPath,data:css.toString('base64')});
 const operation={action:'project-font-attach',id:'htmlfont-'+operationId,baseRevision,fontId,fileId:selected.file.id,fontSha256,fontBytes:selected.bytes.length,fontPath,cssSha256,cssBytes:css.length,cssPath,family,weight,style};
 verifyHtmlFontTransition(base.document,{...base.document,parentRevision:baseRevision,files:previewFiles(files,base.document.entry),operation});
 signal?.throwIfAborted();current?.();
 try{await store.save({id,baseRevision,title:base.document.title,entry:base.document.entry,files,operation});}
 catch(error){if(error.status!==409)throw error;prior=await htmlProjectFontStatus(store,id,operationId,expected);if(!prior.found)throw error;signal?.throwIfAborted();current?.();return {...prior,reused:true};}
 signal?.throwIfAborted();current?.();return htmlProjectFontStatus(store,id,operationId,expected);
}
