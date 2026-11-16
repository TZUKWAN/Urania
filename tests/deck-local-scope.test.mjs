// Real validation paths and real text-only helper. No synthetic recognition or capture response.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isDeckLocalAction} from '../client/deck-local-tools.js';
import {recognizeLocalInk} from '../host/deck-local-inputs.js';

test('only the retained handwriting-text host panel is admitted',()=>{
 assert.equal(isDeckLocalAction('local_ink_text'),true);
 for(const action of ['local_ink_math','local_screenshot','local_narration','local_camera',undefined,'local_unknown'])assert.equal(isDeckLocalAction(action),false);
});
test('removed recognition and capture modes are rejected before launching a helper',async()=>{
 for(const mode of ['math','screen','camera','microphone'])await assert.rejects(recognizeLocalInk(mode,[]),error=>error.status===422&&/已移除/.test(error.message));
});
test('the actual compiled Windows helper refuses its former math and screen modes without opening windows',()=>{
 assert.equal(process.platform,'win32','This packaged helper targets Windows x64');
 for(const mode of ['math','screen']){
  const result=spawnSync(fileURLToPath(new URL('../runtimes/ink-recognizer.exe',import.meta.url)),[],{input:JSON.stringify({mode,strokes:[]}),encoding:'utf8',windowsHide:true,timeout:5000});
  assert.equal(result.error,undefined);assert.equal(result.status,1);
  const value=JSON.parse(result.stdout);assert.equal(value.ok,false);assert.equal(value.error,'unknown recognition mode');
 }
});
