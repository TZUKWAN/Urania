import {readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(process.env.DESIGNCRAFT_TEST_ROOT||join(directory,'.work'));mkdirSync(root,{recursive:true});
const files=readdirSync(directory).filter(name=>name.endsWith('.test.mjs')&&name!=='client.test.mjs').sort().map(name=>join(directory,name));
const common={cwd:dirname(directory),windowsHide:true,encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,DESIGNCRAFT_TEST_ROOT:root,ELECTRON_RUN_AS_NODE:'1'}};
const started=new Date().toISOString(),result=spawnSync(process.execPath,['--test','--test-concurrency=2','--test-reporter=tap',...files],common);process.stdout.write(result.stdout||'');process.stderr.write(result.stderr||'');
const value=key=>Number(result.stdout?.match(new RegExp('^# '+key+' (\\d+)','m'))?.[1]??-1);
const client=result.status===0?spawnSync(process.execPath,[join(directory,'client.test.mjs')],common):null;if(client){process.stdout.write(client.stdout||'');process.stderr.write(client.stderr||'');}
const clientCounts=client?.stdout?.match(/CLIENT TESTS: (\d+) pass, (\d+) fail/);
const report={started,finished:new Date().toISOString(),node:process.version,files:files.map(file=>file.slice(directory.length+1)),nodeTests:{count:value('tests'),pass:value('pass'),fail:value('fail'),exitCode:result.status,error:result.error?.message},clientPure:client?{pass:Number(clientCounts?.[1]??-1),fail:Number(clientCounts?.[2]??-1),exitCode:client.status}:null};
writeFileSync(join(root,'current-node-results.json'),JSON.stringify(report,null,2));
process.exit(result.status===0&&client?.status===0?0:1);
