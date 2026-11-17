// Real reservation files with an explicit resolver fixture; actual DSH acceptance is separate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {reserveDesignAssistantSession} from '../host/design-assistant-session.js';
import {requireDesignScope} from '../host/design-scope.js';
import {workspacePath} from '../host/safety.js';

test('design scope requires the actual reserved identity and bounds the workspace',()=>{
 const base=mkdtempSync(join(tmpdir(),'urania-design-scope-')),a=join(base,'one'),b=join(base,'two');mkdirSync(a);mkdirSync(b);
 try{
  const record=reserveDesignAssistantSession({root:a,workspaceId:'workspace-one',resolveWorkspace:()=>({path:a})});
  const manager={scope:(id,root)=>{assert.equal(id,record.sessionId);return realpathSync(workspacePath(a,root||'.',{mustExist:true}));}};
  assert.equal(requireDesignScope(manager,record.sessionId,a),realpathSync(a));
  assert.throws(()=>requireDesignScope(manager,'ordinary-chat',a));
  assert.throws(()=>requireDesignScope(manager,record.sessionId,b));
  const other=reserveDesignAssistantSession({root:b,workspaceId:'workspace-two',resolveWorkspace:()=>({path:b})});
  const unbound={scope:()=>realpathSync(a)};
  assert.throws(()=>requireDesignScope(unbound,other.sessionId,a),/不是此项目/);
 }finally{assert.ok(resolve(base).startsWith(resolve(tmpdir())+sep));rmSync(base,{recursive:true,force:true});}
});
