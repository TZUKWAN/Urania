import test from 'node:test';import assert from 'node:assert/strict';import {redactDiagnosticError,designDiagnostics} from '../host/design-diagnostics.js';
test('diagnostic allowlist removes credentials, URLs, paths and excludes chat/config structures',()=>{
 const secret='private-example-value',error='api_key='+secret+' Bearer bearer-private https://service.example/path?token=url-private C:\\Users\\someone\\private\\document.json';
 const clean=redactDiagnosticError(error);for(const word of [secret,'bearer-private','url-private','service.example','someone','document.json'])assert.ok(!clean.includes(word),word);
 for(const value of ['ghp_private123456789','github_pat_private123456789','sk-proj-private123456789','\\\\server\\private-share\\a.json'])assert.ok(!redactDiagnosticError(value).includes('private'));
 const view={id:'view',sessionId:'s',root:'C:/private-root',engine:'deckcraft',ready:true,sourceRevision:'actual-source',document:{revision:3,privateText:'must never serialize'},editorProtocol:2};
 const manager={active:new Map([['s','view']]),jobs:new Map([['one',{sessionId:'s',root:view.root,action:'execute',status:'failed',payload:{command:'shape.setFill',key:secret},error}]]),providerApiKey:secret,ordinaryConversation:'must never serialize'};
 const report=designDiagnostics(manager,view),json=JSON.stringify(report);for(const word of [secret,'must never serialize',view.root,'document.json'])assert.ok(!json.includes(word));assert.equal(report.privacy.automaticallySent,false);assert.equal(report.recentActions[0].status,'failed');assert.equal(report.design.engine,'deckcraft');
});
