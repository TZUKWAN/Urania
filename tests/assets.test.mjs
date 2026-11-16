import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {saveAsset,readAsset} from '../host/docstore.js';
const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||fileURLToPath(new URL('./.work/',import.meta.url)));mkdirSync(base,{recursive:true});
test('reusing an asset name never destroys an older pixel version',t=>{
 const root=mkdtempSync(join(base,'assets-'));t.after(()=>{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});
 const first=saveAsset(root,'paint.png',Buffer.from('first pixels'));
 const second=saveAsset(root,'paint.png',Buffer.from('second pixels'));
 assert.notEqual(first.name,second.name);assert.equal(readAsset(root,first.name).toString(),'first pixels');assert.equal(readAsset(root,second.name).toString(),'second pixels');
 assert.equal(saveAsset(root,'paint.png',Buffer.from('second pixels')).name,second.name);
 assert.equal(saveAsset(root,'paint.png',Buffer.from('first pixels')).name,first.name);
});
