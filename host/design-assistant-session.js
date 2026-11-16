/** Durable, project-specific identity reservation; stores no conversation content. */
import {mkdirSync,readFileSync,statSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {atomicCreate} from './persistence.js';
import {workspacePath,SafetyError} from './safety.js';

const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
export function reserveDesignAssistantSession({root,workspaceId,resolveWorkspace}){
 const workspace=typeof workspaceId==='string'&&resolveWorkspace(workspaceId);
 if(!workspace?.path||typeof root!=='string')throw new SafetyError('请先选择有效的 DSH 项目',403);
 const actual=workspacePath(resolve(workspace.path),'.');
 if(!samePath(actual,workspacePath(resolve(root),'.')))throw new SafetyError('设计对话与 DSH 项目目录不一致',403);
 const key=createHash('sha256').update(workspaceId).digest('hex');
 const file=workspacePath(actual,'design/.designcraft/assistant-sessions/'+key+'.json');
 mkdirSync(dirname(file),{recursive:true});
 // Publish one random reserved identity atomically. No catalog search, title
 // matching, blank reuse, transcript copy, or global-current fallback.
 const proposed={schema:1,purpose:'designcraft-ai-assistant',workspaceId,root:actual,sessionId:'session-dcdesign-'+randomUUID(),createdAt:new Date().toISOString()};
 atomicCreate(file,JSON.stringify(proposed,null,2)+'\n');
 if(statSync(file).size>4096)throw new SafetyError('设计对话身份文件超过预算',413);
 let saved;try{saved=JSON.parse(readFileSync(file,'utf8'));}catch{throw new SafetyError('设计对话身份文件损坏，未绑定其他对话',422);}
 if(saved.schema!==1||saved.purpose!=='designcraft-ai-assistant'||saved.workspaceId!==workspaceId||typeof saved.root!=='string'||!samePath(saved.root,actual)||!/^session-dcdesign-[a-f0-9-]{36}$/.test(saved.sessionId||''))throw new SafetyError('设计对话身份无效，未绑定其他对话',422);
 return saved;
}
