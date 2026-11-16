import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CreativeDirectorResource} from '../host/creative-director-resource.js';
import {loadRetainedDirector} from '../host/director-snapshots.js';
import {DesignPlans} from '../host/design-plans.js';
import {previewPlanMigration,migratePlanResources} from '../host/design-plan-migration.js';
import {readZip,createZip} from '../host/zip.js';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function project(t){const base=resolve(process.env.DESIGNCRAFT_TEST_ROOT||'tests/.work');mkdirSync(base,{recursive:true});const root=mkdtempSync(join(base,'retained-director-'));t.after(()=>{assert.ok(!relative(base,root).startsWith('..'));rmSync(root,{recursive:true,force:true});});return root;}
test('actual pinned creative-director archive survives project retention and legacy dependency fallback',t=>{
 const root=project(t),current=new CreativeDirectorResource(),{usage}=current.markUsed(root),retained=loadRetainedDirector(root,usage.id),file=[...current.index().files.keys()].find(f=>f.endsWith('SKILL.md'));
 assert.ok(file);assert.equal(retained.read({file}).content,current.read({file}).content);assert.equal(retained.referenceId(),usage.id);
 const legacy=join(root,'dependencies/creative-director');mkdirSync(legacy,{recursive:true});for(const row of current.exportFiles())writeFileSync(join(legacy,row.file),readFileSync(join(current.root,row.file)));
 const retainedDirectory=join(root,'design/.designcraft/v2/resource-bundles/creative-director',usage.id);assert.ok(resolve(retainedDirectory).startsWith(resolve(root)+sep));rmSync(retainedDirectory,{recursive:true});
 const recovered=loadRetainedDirector(root,usage.id);assert.equal(recovered.read({file}).content,current.read({file}).content);assert.ok(readFileSync(join(retainedDirectory,'creative-director.zip')).equals(current.archive()));
});
test('explicit migration between two real archive identities of the same pinned source preserves old history',t=>{
 const root=project(t),current=new CreativeDirectorResource(),{usage}=current.markUsed(root),original=current.archive(),entries=readZip(original),alternate=createZip([...entries].reverse());assert.notEqual(sha(alternate),sha(original));
 // Same real repository revision and identical Git blobs, repacked in reverse order.
 // This verifies archive-identity migration; it does not fabricate a historical upstream commit.
 const oldUsage={...usage,archiveSha256:sha(alternate)};oldUsage.id='external-'+sha(Buffer.from(JSON.stringify([oldUsage.repository,oldUsage.revision,oldUsage.archiveSha256])));
 const lock=JSON.parse(readFileSync(join(current.root,'source-lock.json'),'utf8'));lock.archiveSha256=sha(alternate);lock.archiveBytes=alternate.length;
 const directory=join(root,'design/.designcraft/v2/resource-bundles/creative-director',oldUsage.id);mkdirSync(directory,{recursive:true});writeFileSync(join(directory,'creative-director.zip'),alternate);writeFileSync(join(directory,'source-lock.json'),JSON.stringify(lock));for(const name of ['LICENSE','NOTICE'])writeFileSync(join(directory,name),readFileSync(join(current.root,name)));
 writeFileSync(join(root,'design/.designcraft/v2/resource-imports',oldUsage.id+'.json'),JSON.stringify(oldUsage));const old=loadRetainedDirector(root,oldUsage.id),file=[...old.index().files.keys()].find(name=>name.endsWith('SKILL.md')),source=old.read({file}),plans=new DesignPlans(root),id='plan-'+randomUUID().replaceAll('-','');
 const first=plans.save({id,baseRevision:null,title:'规则迁移验收',brief:'保留原计划与历史',content:'原文不随规则迁移改写',sources:[{resourceId:oldUsage.id,file,gitSha1:source.gitSha1,sha256:source.sha256}]}),preview=previewPlanMigration(root,{id,baseRevision:first.revision});
 assert.equal(preview.items.length,1);assert.equal(preview.items[0].available,true);assert.equal(preview.items[0].contentChanged,false);
 assert.throws(()=>migratePlanResources({},root,{id,baseRevision:first.revision,migrations:[{resourceId:oldUsage.id,file,expectedTargetSha256:'0'.repeat(64)}]}),e=>e.status===409);
 const migrated=migratePlanResources({onChange(){}},root,{id,baseRevision:first.revision,migrations:[{resourceId:oldUsage.id,file,expectedTargetSha256:preview.items[0].targetSha256}]});assert.notEqual(migrated.revision,first.revision);assert.equal(migrated.plan.sources[0].resourceId,current.referenceId());const historical=plans.read(id,first.revision);assert.equal(historical.historical,true);assert.equal(historical.revision,first.revision);assert.deepEqual(historical.plan,first.plan);assert.equal(migrated.plan.content,first.plan.content);
 writeFileSync(join(directory,'NOTICE'),'deliberate isolated corruption');assert.throws(()=>loadRetainedDirector(root,oldUsage.id),e=>e.status===409);
});
