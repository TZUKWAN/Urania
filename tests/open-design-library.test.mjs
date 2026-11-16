// Actual pinned source bytes are used for cache/paging/tamper checks. No network
// response or generation result is mocked, and no upstream script is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OpenDesignLibrary} from '../host/open-design-library.js';
const installed=fileURLToPath(new URL('../resources/open-design/',import.meta.url));
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'dc-od-data-'));
 for(const file of ['library-index.json','library-index.lock.json','LICENSE'])await copyFile(join(installed,file),join(root,file));
 const library=new OpenDesignLibrary({root});return {root,library};
}
async function cacheSource(library,id,file){
 const record=library.index().packages.get(id).fileMap.get(file),path=library.cachePath(record);
 await mkdir(join(library.root,'library-cache',library.index().revision),{recursive:true});
 const bytes=await readFile(join(installed,id,file));library.verify(bytes,record);await writeFile(path,bytes);return {path,bytes};
}
test('complete pinned package manifests are paged as source data and never marked executable',async()=>{
 const {library}=await fixture();const first=library.search({kind:'design-system',limit:3});assert.equal(first.total,152);assert.equal(first.items.length,3);assert.equal(first.nextOffset,3);
 assert.ok(first.items.every(p=>p.workflowReady===false));const second=library.search({kind:'design-system',offset:first.nextOffset,limit:3});assert.notEqual(first.items[0].id,second.items[0].id);
 const pack=library.package('design-systems/corporate');assert.equal(pack.fileCount,24);assert.equal(pack.files.length,24);assert.ok(pack.files.some(f=>f.path==='DESIGN.md'));assert.ok(pack.files.some(f=>f.path.startsWith('system/')));
 await assert.rejects(library.read({id:'../anything',file:'LICENSE'}),error=>error.status===404);
 await assert.rejects(library.read({id:pack.id,file:'../../LICENSE'}),error=>error.status===404);
});
test('actual pinned source text supports exact paging past 10000 characters with hashes and no execution',async()=>{
 const {library}=await fixture();const {bytes}=await cacheSource(library,'design-systems/corporate','design-tokens.json');
 const full=await library.read({id:'design-systems/corporate',file:'design-tokens.json',limit:40000});assert.equal(full.content,bytes.toString('utf8'));assert.equal(full.executed,false);assert.equal(full.verified,true);
 const tail=await library.read({id:'design-systems/corporate',file:'design-tokens.json',offset:19000,limit:1000});assert.equal(tail.content,full.content.slice(19000,20000));assert.equal(tail.sha256,full.sha256);assert.ok(full.source.includes(library.index().revision));
 const licence=await library.license();assert.ok(licence.content.includes('Apache License'));assert.equal(licence.executed,false);
});
test('tampered cache and damaged index fail without executing content or preventing lazy library construction',async()=>{
 const {library,root}=await fixture();const {path,bytes}=await cacheSource(library,'design-systems/corporate','DESIGN.md');
 const changed=Buffer.from(bytes);changed[0]^=1;await writeFile(path,changed);
 await assert.rejects(library.read({id:'design-systems/corporate',file:'DESIGN.md'}),error=>error.status===503);
 await writeFile(path,bytes);assert.equal((await library.read({id:'design-systems/corporate',file:'DESIGN.md'})).content,bytes.toString('utf8'));
 await writeFile(join(root,'library-index.json'),'{}');const damaged=new OpenDesignLibrary({root});assert.throws(()=>damaged.search(),error=>error.status===503);
});
