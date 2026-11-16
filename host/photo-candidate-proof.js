import {createHash} from 'node:crypto';
import {readZip} from './zip.js';
import {SafetyError} from './safety.js';
import {decodeNativeJson} from '../client/native-protocol.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
}
function packageData(bytes){
 let entries;try{entries=readZip(bytes,{maxEntries:20000,maxEntryBytes:128*1024*1024,maxTotalBytes:512*1024*1024,maxSelectedBytes:128*1024*1024});}
 catch(error){throw new SafetyError('图片候选原生包无法读取：'+error.message,422);}
 const manifest=entries.find(item=>item.name==='manifest.json');if(!manifest||manifest.data.length>8*1024*1024)throw new SafetyError('图片候选缺少原生清单',422);
 let parsed;try{parsed=decodeNativeJson(new TextDecoder('utf-8',{fatal:true}).decode(manifest.data));}catch{throw new SafetyError('图片候选清单无效',422);}
 if(!parsed.document||typeof parsed.document!=='object'||!parsed.format_version)throw new SafetyError('图片候选原生文档无效',422);
 const previews=new Set([parsed.thumbnail,parsed.composite].filter(value=>typeof value==='string'));
 const contents=new Map(entries.filter(item=>item.name!=='manifest.json'&&!previews.has(item.name)).map(item=>[item.name,hash(item.data)]));
 return {document:canonical(parsed.document),version:parsed.format_version,contents};
}

/** Compare the complete native model and all non-preview package members. */
export function assertPhotoCandidateOnly(candidate,actual){
 const expected=packageData(candidate),saved=packageData(actual);
 if(expected.version!==saved.version||JSON.stringify(expected.document)!==JSON.stringify(saved.document)||expected.contents.size!==saved.contents.size||[...expected.contents].some(([name,value])=>saved.contents.get(name)!==value))throw new SafetyError('图片候选与保存的原生层、蒙版或素材不一致；原图片未被覆盖',409);
}
