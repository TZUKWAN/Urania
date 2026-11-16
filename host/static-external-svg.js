import {SafetyError} from './safety.js';

export function validateStaticExternalSvg(bytes){
 let svg;try{svg=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new SafetyError('SVG 不是有效 UTF-8',422);}
 if(!Buffer.from(svg,'utf8').equals(bytes)||!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg)||/<!DOCTYPE|<!ENTITY|<\s*(?:script|foreignObject|iframe|object|embed|animate|set)\b|\son[a-z]+\s*=|@import/i.test(svg))throw new SafetyError('SVG 含不支持的活动内容或文档结构',422);
 for(const match of svg.matchAll(/(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi)){const value=match[2].trim();if(!(value.startsWith('#')||/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/i.test(value))||value.includes('&'))throw new SafetyError('SVG 含外部引用，未自动导入',422);}
 for(const match of svg.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi))if(!/^#[A-Za-z0-9_.:-]+$/.test(match[2].trim()))throw new SafetyError('SVG 含外部样式引用，未自动导入',422);
 return svg;
}
