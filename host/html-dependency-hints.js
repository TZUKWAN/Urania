/** Read-only, bounded hints for common external HTML/CSS references. */
import {SafetyError} from './safety.js';

const MAX_FILES=256,MAX_BYTES=24*1024*1024,MAX_MATCHES=5000,MAX_ITEMS=60;
const TAG=/<(script|link|img|source|video|audio|iframe)\b[^<>]{0,8192}>/gi;
const ATTRIBUTE=/(?:^|\s)(src|href|poster)\s*=\s*(?:"([^"\r\n]{0,2048})"|'([^'\r\n]{0,2048})')/gi;
const CSS_URL=/url\s*\(\s*(?:"([^"\r\n]{1,2048})"|'([^'\r\n]{1,2048})'|([^()\s'"\r\n]{1,2048}))\s*\)/gi;
const CSS_IMPORT=/@import\s+(?:"([^"\r\n]{1,2048})"|'([^'\r\n]{1,2048})')/gi;

export function inspectHtmlDependencyHints(files){
 if(!Array.isArray(files)||files.length>MAX_FILES)throw new SafetyError('网页依赖检查文件列表无效',422);
 const found=new Map();let bytesTotal=0,matches=0,scanned=0,skipped=0,truncated=false;
 const add=(raw,kind)=>{
  if(++matches>MAX_MATCHES){truncated=true;return false;}
  const text=String(raw||'').trim();if(!/^(?:https?:\/\/|\/\/)/i.test(text))return true;
  const protocolRelative=text.startsWith('//');let url;try{url=new URL(protocolRelative?'https:'+text:text);}catch{return true;}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname)return true;
  // Only the origin is returned: paths, queries, fragments and userinfo may be private.
  const origin=protocolRelative?'//'+url.host:url.origin,key=kind+'\0'+origin,previous=found.get(key);
  if(previous)previous.count++;
  else if(found.size<MAX_ITEMS)found.set(key,{origin,kind,count:1});
  else truncated=true;
  return true;
 };
 for(const file of files){
  if(!file||typeof file.path!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<0||typeof file.data!=='string')throw new SafetyError('网页依赖检查文件记录无效',422);
  if(!/\.(?:html?|css)$/i.test(file.path))continue;
  bytesTotal+=file.bytes;if(file.bytes>8*1024*1024||bytesTotal>MAX_BYTES)throw new SafetyError('网页依赖检查超过文本预算',413);
  const bytes=Buffer.from(file.data,'base64');if(bytes.length!==file.bytes)throw new SafetyError('网页依赖检查文件长度不一致',409);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{skipped++;continue;}scanned++;
  TAG.lastIndex=0;let tag;
  while((tag=TAG.exec(text))){
   ATTRIBUTE.lastIndex=0;let attr;
   while((attr=ATTRIBUTE.exec(tag[0]))){
    const kind=tag[1].toLowerCase()==='script'?'script':tag[1].toLowerCase()==='link'?'linked-resource':'media';
    if(!add(attr[2]??attr[3],kind))break;
   }
   if(matches>MAX_MATCHES)break;
  }
  for(const pattern of [CSS_URL,CSS_IMPORT]){
   pattern.lastIndex=0;let match;
   while((match=pattern.exec(text))){if(!add(match[1]??match[2]??match[3],'css-resource'))break;}
   if(matches>MAX_MATCHES)break;
  }
  if(matches>MAX_MATCHES)break;
 }
 return {items:[...found.values()],scannedFiles:scanned,skippedFiles:skipped,truncated,
  note:'仅按常见静态写法提出外链候选，可能误报或遗漏动态、编码和复杂语法；只显示来源域名，不联网、不证明资源已加载或样式正确。'};
}
