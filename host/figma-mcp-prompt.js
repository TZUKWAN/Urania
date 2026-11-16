/** Preserve a selected sanitized Figma MCP prompt message as project reference data. */
import {createHash} from 'node:crypto';
import {mkdir,readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import * as store from './docstore.js';
import {atomicCreate} from './persistence.js';
import {SafetyError,assertSafeJson,workspacePath} from './safety.js';

const ID=/^figmamcpprompt-[a-f0-9]{64}$/,HASH=/^[a-f0-9]{64}$/,SNAP=/^figmamcpsnapshot-[a-f0-9-]{36}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const identity=value=>sha(Buffer.from(JSON.stringify(value)));
const idFor=row=>'figmamcpprompt-'+identity([row.source,row.requestHash,row.promptSha256,row.messageIndex,row.role,row.textSha256,row.responseSha256,row.redacted]);
const directory=root=>workspacePath(root,'design/.designcraft/figmamcp-prompts');
const pathFor=(root,id)=>{if(!ID.test(id||''))throw new SafetyError('Figma 提示参考身份无效',422);return workspacePath(root,join(directory(root),id+'.json'));};
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function sanitized(snapshot){
 if(!snapshot||!SNAP.test(snapshot.id||'')||snapshot.tool!=='prompt:create_design_system_rules'||!['remote','desktop'].includes(snapshot.source)||!HASH.test(snapshot.requestHash||'')||!HASH.test(snapshot.promptSha256||'')||typeof snapshot.redacted!=='boolean'||typeof snapshot.content!=='string'||Buffer.byteLength(snapshot.content)>8*1024*1024)throw new SafetyError('请选择实际 Figma 提示快照',422);
 let data;try{data=JSON.parse(snapshot.content);}catch{throw new SafetyError('Figma 提示快照无效',409);}if(!Array.isArray(data.messages)||data.messages.length>50)throw new SafetyError('Figma 提示消息无效',409);return data;
}
export function figmaPromptMessages(snapshot){
 const data=sanitized(snapshot),items=[];for(let index=0;index<data.messages.length;index++){const message=data.messages[index];if(message&&['user','assistant'].includes(message.role)&&message.content?.type==='text'&&typeof message.content.text==='string'&&message.content.text.trim()){const text=message.content.text;if(Buffer.byteLength(text)>512*1024)throw new SafetyError('Figma 提示文本超过预算',413);items.push({index,role:message.role,characters:text.length,preview:text.slice(0,300)});}}
 return {items,source:snapshot.source,redacted:snapshot.redacted,note:'只显示实际脱敏提示文本；它是参考指引，不代表项目规则已生成。'};
}
export function validateFigmaPromptRecord(row){
 assertSafeJson(row);const allowed=['schema','kind','id','source','requestHash','promptSha256','messageIndex','role','redacted','textAsset','textSha256','textBytes','responseAsset','responseSha256','responseBytes'];
 if(!row||Object.keys(row).some(key=>!allowed.includes(key))||row.schema!==1||row.kind!=='figmamcp-prompt-reference'||!ID.test(row.id||'')||!['remote','desktop'].includes(row.source)||!HASH.test(row.requestHash||'')||!HASH.test(row.promptSha256||'')||!Number.isSafeInteger(row.messageIndex)||row.messageIndex<0||row.messageIndex>=50||!['user','assistant'].includes(row.role)||typeof row.redacted!=='boolean'||typeof row.textAsset!=='string'||!/^figmamcp-prompt-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.txt$/.test(row.textAsset)||!HASH.test(row.textSha256||'')||!row.textAsset.startsWith('figmamcp-prompt-'+row.textSha256.slice(0,24))||!Number.isSafeInteger(row.textBytes)||row.textBytes<1||row.textBytes>512*1024||typeof row.responseAsset!=='string'||!/^figmamcp-result-[a-f0-9]{24}(?:-[a-f0-9]{24})?\.json$/.test(row.responseAsset)||!HASH.test(row.responseSha256||'')||!row.responseAsset.startsWith('figmamcp-result-'+row.responseSha256.slice(0,24))||!Number.isSafeInteger(row.responseBytes)||row.responseBytes<1||row.responseBytes>8*1024*1024||row.id!==idFor(row))throw new SafetyError('Figma 提示参考记录无效',409);return true;
}
export function verifyFigmaPromptRecord(row,text,response,validateResponse){
 validateFigmaPromptRecord(row);if(typeof validateResponse!=='function'||!Buffer.isBuffer(text)||text.length!==row.textBytes||sha(text)!==row.textSha256||!Buffer.isBuffer(response)||response.length!==row.responseBytes||sha(response)!==row.responseSha256)throw new SafetyError('Figma 提示文本或响应缺失或改变',409);validateResponse(response);
 let data,content;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response));content=new TextDecoder('utf-8',{fatal:true}).decode(text);}catch{throw new SafetyError('Figma 提示参考不是有效 UTF-8',409);}const message=data.messages?.[row.messageIndex];if(message?.role!==row.role||message.content?.type!=='text'||message.content.text!==content||!content.trim())throw new SafetyError('Figma 提示参考与响应消息不一致',409);return true;
}
async function immutable(path,row){await mkdir(join(path,'..'),{recursive:true});if(!atomicCreate(path,encode(row))){let old;try{old=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('Figma 提示参考记录损坏，未覆盖',409);}if(JSON.stringify(old)!==JSON.stringify(row))throw new SafetyError('Figma 提示参考记录冲突，未覆盖',409);}}
export async function readFigmaPrompt(root,id,validateResponse){
 root=store.validateRoot(root);const path=pathFor(root,id),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('Figma 提示参考记录无效',409);let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('Figma 提示参考记录损坏',409);}validateFigmaPromptRecord(row);if(row.id!==id)throw new SafetyError('Figma 提示参考身份不一致',409);const text=store.readAsset(root,row.textAsset),response=store.readAsset(root,row.responseAsset);verifyFigmaPromptRecord(row,text,response,validateResponse);return {row,text,response};
}
export async function captureFigmaPrompt(root,snapshot,index,signal,current,validateResponse){
 root=store.validateRoot(root);if(snapshot?.root!==root||!Number.isSafeInteger(index))throw new SafetyError('Figma 提示选择无效',422);const data=sanitized(snapshot),item=figmaPromptMessages(snapshot).items.find(value=>value.index===index);if(!item)throw new SafetyError('请选择当前快照中的实际文本消息',422);
 const text=Buffer.from(data.messages[index].content.text,'utf8'),responseBytes=Buffer.from(snapshot.content,'utf8');validateResponse(responseBytes);signal?.throwIfAborted();current?.();const textSha256=sha(text),responseSha256=sha(responseBytes),asset=store.saveAsset(root,'figmamcp-prompt-'+textSha256.slice(0,24)+'.txt',text),response=store.saveAsset(root,'figmamcp-result-'+responseSha256.slice(0,24)+'.json',responseBytes),row={schema:1,kind:'figmamcp-prompt-reference',source:snapshot.source,requestHash:snapshot.requestHash,promptSha256:snapshot.promptSha256,messageIndex:index,role:item.role,redacted:snapshot.redacted,textAsset:asset.name,textSha256,textBytes:text.length,responseAsset:response.name,responseSha256,responseBytes:responseBytes.length};row.id=idFor(row);verifyFigmaPromptRecord(row,text,responseBytes,validateResponse);
 try{signal?.throwIfAborted();current?.();await immutable(pathFor(root,row.id),row);}catch(error){error.retained={asset:{name:asset.name,path:asset.path,bytes:asset.size},record:row,sourceRecorded:false};throw error;}return {record:row,asset:{name:asset.name,path:asset.path,bytes:asset.size},note:'已保存脱敏提示参考及来源；项目设计规则尚未自动生成。'};
}
async function pending(root,name,validateResponse){
 if(!/^figmamcpprompt-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(name||''))throw new SafetyError('Figma 提示候选身份无效',422);const path=workspacePath(root,join(directory(root),name),{mustExist:true}),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16384)throw new SafetyError('Figma 提示候选无效',409);let row;try{row=JSON.parse(await readFile(path,'utf8'));}catch{throw new SafetyError('Figma 提示候选尚未完整写入',409);}validateFigmaPromptRecord(row);if(!name.startsWith(row.id+'.json.tmp-'))throw new SafetyError('Figma 提示候选身份不一致',409);verifyFigmaPromptRecord(row,store.readAsset(root,row.textAsset),store.readAsset(root,row.responseAsset),validateResponse);return row;
}
export async function listFigmaPrompts(root,validateResponse){
 root=store.validateRoot(root);let entries;try{entries=await readdir(directory(root),{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return {items:[],pending:[]};throw error;}const final=entries.filter(item=>/^figmamcpprompt-[a-f0-9]{64}\.json$/.test(item.name)),temps=entries.filter(item=>/^figmamcpprompt-[a-f0-9]{64}\.json\.tmp-[a-f0-9-]{36}$/.test(item.name));if(final.length>2000||temps.length>128||[...final,...temps].some(item=>!item.isFile()))throw new SafetyError('Figma 提示参考记录无效或超过预算',413);
 const items=[];for(const item of final)items.push((await readFigmaPrompt(root,item.name.slice(0,-5),validateResponse)).row);const candidates=[];for(const item of temps){try{const row=await pending(root,item.name,validateResponse);candidates.push({candidate:item.name,id:row.id,recoverable:true});}catch(error){candidates.push({candidate:item.name,recoverable:false,error:error instanceof SafetyError?error.message:'提示候选无法读取'});}}return {items,pending:candidates};
}
export async function recoverFigmaPrompt(root,name,signal,current,validateResponse){root=store.validateRoot(root);const row=await pending(root,name,validateResponse);signal?.throwIfAborted();current?.();await immutable(pathFor(root,row.id),row);return {record:row,recovered:true,note:'仅恢复已保存的提示参考，没有重新访问 Figma。'};}
