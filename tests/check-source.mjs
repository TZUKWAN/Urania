import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=dirname(dirname(fileURLToPath(import.meta.url))),files=[];
for(const directory of ['host','client'])for(const entry of readdirSync(join(root,directory))){if(entry.endsWith('.js'))files.push(join(root,directory,entry));}
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{windowsHide:true,encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr);}
const lock=JSON.parse(readFileSync(join(root,'runtime-lock.json'),'utf8'));
for(const [name,entry]of Object.entries({...lock.engines,runner:lock.runner})){const file=join(root,entry.executable);if(!existsSync(file)||createHash('sha256').update(readFileSync(file)).digest('hex')!==entry.sha256)throw new Error('Runtime checksum mismatch: '+name);}
const resourceRoot=join(root,'resources','open-design'),resources=JSON.parse(readFileSync(join(resourceRoot,'lock.json'),'utf8'));
for(const entry of resources.files)if(createHash('sha256').update(readFileSync(join(resourceRoot,entry.path))).digest('hex')!==entry.sha256)throw new Error('Resource checksum mismatch: '+entry.path);
console.log(JSON.stringify({javascriptFiles:files.length,syntax:'passed',nativeBinaries:4,runtimeHashes:'passed',resourceFiles:resources.files.length,resourceHashes:'passed'}));
