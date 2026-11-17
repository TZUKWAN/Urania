#!/usr/bin/env node
import {readdir,readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url))),sha=b=>createHash('sha256').update(b).digest('hex'),json=async f=>JSON.parse(await readFile(join(root,f),'utf8'));
let checked=0;
async function syntax(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())await syntax(file);else if(/\.(?:js|mjs|cjs)$/.test(entry.name)){const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error(r.stderr||'Syntax failed: '+file);checked++;}}}
for(const name of ['host','client','motion-worker','scripts'])await syntax(join(root,name));
const pkg=await json('package.json'),assets=await json('release/runtime-assets.json'),manifest=await json('release/runtime-manifest.json'),motion=await json('motion-runtime-lock.json');
if(pkg.engines.node!=='>=22'||assets.packageVersion!==pkg.version||assets.uiBuild!==pkg.designcraftUiBuild||manifest.sourcePackageVersion!==pkg.version||manifest.uiBuild!==pkg.designcraftUiBuild||motion.productVersionAtLock!==pkg.version+' / UI'+pkg.designcraftUiBuild)throw new Error('Current versions/requirements differ');
const manifestBytes=await readFile(join(root,'release/runtime-manifest.json'));if(sha(manifestBytes)!==assets.runtimeManifest.sha256||manifest.files.length!==assets.runtimeManifest.files||manifest.platform!==assets.platform)throw new Error('Release manifest differs');
const seen=new Set();for(const row of manifest.files){if(!/^runtimes\//.test(row.path)||row.path.includes('\\')||row.path.split('/').some(p=>!p||p==='.'||p==='..'||/[\x00-\x1f:*?"<>|]/.test(p)||/[. ]$/.test(p))||seen.has(row.path.toLowerCase())||!Number.isSafeInteger(row.bytes)||row.bytes<0||!/^[a-f0-9]{64}$/.test(row.sha256))throw new Error('Unsafe/duplicate runtime manifest entry');seen.add(row.path.toLowerCase());}
const locks=['resources/open-design/lock.json','resources/open-design/dom-to-pptx/source-lock.json'];let resources=0;
for(const file of locks){const lock=await json(file),base=dirname(file);for(const entry of lock.files){const relative=entry.path||entry.name;if(relative.split('/').some(v=>!v||v==='..'||v==='.')||relative.includes('\\'))throw new Error('Unsafe resource lock path');const actual=resolve(root,base,relative);if(sha(await readFile(actual))!==entry.sha256)throw new Error('Resource hash differs: '+relative);resources++;}}
const codec=await json('resources/open-design/dom-to-pptx/codec-build-lock.json');for(const [name,meta] of Object.entries(codec.buildScripts)){if(sha(await readFile(join(root,'resources/open-design/dom-to-pptx',name)))!==meta.sha256)throw new Error('Build script differs: '+name);}
const snapshot=await json('SOURCE_SNAPSHOT.json');
function sourcePath(relative){if(typeof relative!=='string'||relative.includes('\\')||relative.split('/').some(v=>!v||v==='.'||v==='..'||v.includes(':')))throw new Error('Unsafe public source path');return join(root,relative);}
for(const row of snapshot.files){const bytes=await readFile(sourcePath(row.path));if(bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw new Error('Public source snapshot differs: '+row.path);}
const verification=await json('VERIFICATION_UI165.json');let evidence=0;
for(const row of verification.tests.targetedActual){if(sha(await readFile(sourcePath(row.file)))!==row.publicSummarySha256)throw new Error('Published evidence digest differs: '+row.file);evidence++;}
console.log(JSON.stringify({scope:'public source syntax/metadata/locked resources; not installed runtime or DSH acceptance',javascriptFiles:checked,resourceFiles:resources,releaseEntries:manifest.files.length,sourceSnapshotFiles:snapshot.files.length,publishedEvidenceDigests:evidence,version:pkg.version,uiBuild:pkg.designcraftUiBuild,ok:true}));
