/** Read explicit theme-factory candidates from a verified saved source bundle. */
import {createHash} from 'node:crypto';
import {readExternalSkillFiles} from './external-skill-bundles.js';
import {SafetyError} from './safety.js';

const THEME=/^skills\/theme-factory\/themes\/[a-z0-9][a-z0-9-]{0,79}\.md$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export async function readExternalTheme(library,root,bundleId,file,signal){
 if(!THEME.test(file||''))throw new SafetyError('请选择 theme-factory 原包中的主题 Markdown',422);
 const saved=await readExternalSkillFiles(library,root,bundleId,[file],signal),row=saved.files[0],receipt=saved.receipt;
 if(receipt?.odId!=='skills/theme-factory'||receipt.repository?.toLowerCase()!=='anthropics/skills'||receipt.subdir!=='skills/theme-factory'||!row||row.path!==file||!row.metadata||row.metadata.lfs)throw new SafetyError('所选文件不是已保存的 theme-factory 主题原件',422);
 if(!Buffer.isBuffer(row.bytes)||!row.bytes.length||row.bytes.length>65536||!/^[a-f0-9]{40}$/.test(row.metadata.gitSha1||'')||!/^[a-f0-9]{64}$/.test(row.metadata.sha256||'')||sha(row.bytes)!==row.metadata.sha256)throw new SafetyError('主题文件为空、过大或摘要不一致',409);
 let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(row.bytes);}catch{throw new SafetyError('主题文件不是有效 UTF-8',422);}
 const lines=text.split(/\r?\n/),titles=lines.filter(line=>/^# [^#]/.test(line));
 if(titles.length!==1)throw new SafetyError('主题文件缺少唯一标题，请读取原文',422);
 const section=name=>{
  const label='## '+name,positions=[];for(let i=0;i<lines.length;i++)if(lines[i].trim()===label)positions.push(i);
  if(positions.length!==1)throw new SafetyError('主题文件缺少唯一的 '+name+' 部分，请读取原文',422);
  let end=positions[0]+1;while(end<lines.length&&!/^##\s/.test(lines[end]))end++;
  return lines.slice(positions[0]+1,end).map(line=>line.trim()).filter(Boolean);
 };
 const colors=[],names=new Set();
 for(const line of section('Color Palette')){
  const match=/^-\s+\*\*([^*]{1,120})\*\*:\s+\x60(#[a-f0-9]{6})\x60\s+-\s+(.{1,300})$/i.exec(line);
  if(!match||!match[1].trim()||!match[3].trim()||/[\x00-\x1f\x7f]/.test(match[1]+match[3])||names.has(match[1].trim().toLowerCase())||colors.length>=32)throw new SafetyError('主题配色结构不明确，请读取原文',422);
  names.add(match[1].trim().toLowerCase());colors.push({name:match[1].trim(),hex:match[2].toUpperCase(),description:match[3].trim()});
 }
 if(!colors.length)throw new SafetyError('主题没有可读取的配色，请读取原文',422);
 const fonts={};for(const line of section('Typography')){
  const match=/^-\s+\*\*(Headers|Body Text)\*\*:\s+(.{1,200})$/i.exec(line),key=match?.[1].toLowerCase()==='headers'?'heading':'body';
  if(!match||/[\x00-\x1f\x7f]/.test(match[2])||fonts[key])throw new SafetyError('主题字体结构不明确，请读取原文',422);
  fonts[key]=match[2].trim();
 }
 if(!fonts.heading||!fonts.body)throw new SafetyError('主题缺少标题或正文字体，请读取原文',422);
 const title=titles[0].slice(2).trim();if(!title||title.length>200||/[\x00-\x1f\x7f]/.test(title))throw new SafetyError('主题标题无效',422);
 signal?.throwIfAborted();
 return {bundleId,file,title,colors,fonts,repository:receipt.repository,revision:receipt.revision,gitSha1:row.metadata.gitSha1,sha256:row.metadata.sha256,license:typeof receipt.license==='string'&&receipt.license.length<=200?receipt.license:null,
  note:'候选来自已保存原文件；尚未应用主题或安装字体。请选择实际要使用的颜色和字体，核对字体许可、可用性与效果。'};
}
