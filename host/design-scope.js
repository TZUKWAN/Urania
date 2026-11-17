/** Resolve an authenticated DSH design identity; never adopt an ordinary chat. */
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {workspacePath,SafetyError} from './safety.js';

export function requireDesignScope(manager,sessionId,requestedRoot){
 if(!/^session-dcdesign-[a-f0-9-]{36}$/.test(sessionId||''))throw new SafetyError('请先打开当前项目的设计对话',403);
 const cwd=manager.scope(sessionId),root=manager.scope(sessionId,requestedRoot||cwd);
 const dir=workspacePath(cwd,'design/.designcraft/assistant-sessions',{mustExist:true});
 const names=readdirSync(dir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name));
 if(names.length>512)throw new SafetyError('设计会话记录超过预算',413);
 const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
 let matched=false;
 for(const name of names){
  const file=workspacePath(cwd,join('design/.designcraft/assistant-sessions',name),{mustExist:true});
  if(statSync(file).size>4096)continue;
  let record;try{record=JSON.parse(readFileSync(file,'utf8'));}catch{continue;}
  if(record.sessionId!==sessionId)continue;
  if(record.schema===1&&record.purpose==='designcraft-ai-assistant'&&typeof record.root==='string'&&same(record.root,cwd)){matched=true;break;}
 }
 if(!matched)throw new SafetyError('该会话不是此项目持久绑定的设计对话',403);
 return root;
}
