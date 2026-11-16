/** Pure contract for an explicitly selected project font in an HTML revision. */
import {createHash} from 'node:crypto';
import {SafetyError,assertSafeJson} from './safety.js';

const HASH=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function fontCss({family,weight,style,fontSha256,format}){
 if(typeof family!=='string'||!family.trim()||family!==family.trim()||family.length>100||/[\x00-\x1f\x7f-\x9f]/.test(family)||!Number.isInteger(weight)||weight<1||weight>1000||!['normal','italic','oblique'].includes(style)||!HASH.test(fontSha256||'')||!['ttf','otf'].includes(format))throw new SafetyError('网页字体族、字重、样式或文件身份无效',422);
 const text='@font-face {\n  font-family: '+JSON.stringify(family)+';\n  src: url("./project-'+fontSha256+'.'+format+'");\n  font-weight: '+weight+';\n  font-style: '+style+';\n}\n';
 return Buffer.from(text,'utf8');
}

export function validateHtmlFontOperation(op,previous){
 assertSafeJson(op);
 const keys=['action','id','baseRevision','fontId','fileId','fontSha256','fontBytes','fontPath','cssSha256','cssBytes','cssPath','family','weight','style'];
 if(!op||Object.keys(op).some(key=>!keys.includes(key))||op.action!=='project-font-attach'||!/^htmlfont-[a-f0-9]{64}$/.test(op.id||'')||!HASH.test(op.baseRevision||'')||op.baseRevision!==previous||!/^projectfont-[a-f0-9]{64}$/.test(op.fontId||'')||!/^(?:externalfile|externallfs|userfont)-[a-f0-9]{64}$/.test(op.fileId||'')||op.fontId!=='projectfont-'+sha(Buffer.from(JSON.stringify([op.fileId])))||!HASH.test(op.fontSha256||'')||!Number.isSafeInteger(op.fontBytes)||op.fontBytes<4||op.fontBytes>4*1024*1024||!HASH.test(op.cssSha256||'')||!Number.isSafeInteger(op.cssBytes)||op.cssBytes<1||op.cssBytes>4096)throw new SafetyError('网页项目字体操作回执无效',409);
 const path=/^assets\/fonts\/project-([a-f0-9]{64})\.(ttf|otf)$/.exec(op.fontPath||'');
 if(!path||path[1]!==op.fontSha256||op.cssPath!=='assets/fonts/project-'+op.cssSha256+'.css')throw new SafetyError('网页字体资源路径与回执不一致',409);
 const css=fontCss({...op,format:path[2]});if(css.length!==op.cssBytes||sha(css)!==op.cssSha256)throw new SafetyError('网页字体样式与回执不一致',409);
 return true;
}

export function htmlFontLink(entry,cssPath){
 const depth=entry.split('/').length-1;
 return '<link rel="stylesheet" href="'+'../'.repeat(depth)+cssPath+'">';
}
