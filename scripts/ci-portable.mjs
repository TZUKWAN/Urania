#!/usr/bin/env node
// Public source contracts only. Full npm test/check remain unchanged and separate.
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const files=['motion-schema','motion-resource-path','motion-package-bounds','motion-package','motion-project-store','motion-asset-store','motion-native-material','motion-operations','motion-http-admission','motion-tool','motion-render-source','motion-preview-host','human-edit-protection','feedback-checkpoint','design-feedback','feedback-selection-draft','png-safety','store-safety'].map(n=>join(root,'tests',n+'.test.mjs'));
const result=spawnSync(process.execPath,['--test','--test-concurrency=2',...files],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
