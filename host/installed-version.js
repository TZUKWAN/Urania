import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

// Read only package and runtime metadata. The editor route separately verifies
// the entire binary before serving it; stale retained binaries are not active.
export function installedVersion(directory){
 const pkg=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
 const lock=JSON.parse(readFileSync(join(directory,'web-runtime-lock.json'),'utf8'));
 const engines={};
 for(const engine of ['vectorcraft','photocraft','deckcraft']){
  const key=engine+'-host',release=lock.engines[key];
  if(!release)continue;
  const index=readFileSync(join(directory,'runtimes','web',key,'index.html'));
  const indexHash=createHash('sha256').update(index).digest('hex');
  const active=new Set(index.toString('utf8').match(new RegExp(engine+'-web-[a-f0-9]+_bg\\.wasm','g'))||[]);
  const [wasmFile]=active;
  const valid=indexHash===release.files['index.html']?.sha256&&active.size===1&&release.files[wasmFile]?.sha256;
  engines[engine]={version:release.version,wasmFile:valid?wasmFile:null,sha256:valid?release.files[wasmFile].sha256:null,valid:!!valid};
 }
 return {version:pkg.version,uiBuild:pkg.designcraftUiBuild,engines};
}
