"""Rebuild Urania codec1 from its retained sources. Requires local emsdk4.0.17,
Node>=22 and pnpm10.27.0. Never activates an SDK or changes global settings.
Use an empty --work directory. All dependencies install with scripts disabled.
"""
from pathlib import Path
import argparse,base64,gzip,hashlib,json,os,subprocess,tarfile,zipfile,io,sys
p=argparse.ArgumentParser();p.add_argument('--work',type=Path,required=True);p.add_argument('--sdk-dir',type=Path,required=True);p.add_argument('--em-cache',type=Path);p.add_argument('--pnpm-cli',type=Path,required=True);p.add_argument('--node',default='node');a=p.parse_args()
vendor=Path(__file__).resolve().parent.parent;lock=json.loads((vendor/'codec-build-lock.json').read_text('utf8'));work=a.work.resolve();sdk=a.sdk_dir.resolve()
def sha(data):return hashlib.sha256(data).hexdigest()
if work.exists() and any(work.iterdir()):raise SystemExit('Build work directory must be empty')
work.mkdir(parents=True,exist_ok=True)
if (sdk/'upstream/emscripten/emscripten-version.txt').read_text().strip().strip('"')!='4.0.17':raise SystemExit('Exact Emscripten4.0.17 required')
archive=vendor/'codec-source.zip';expected=lock['sourceArchive']
if sha(archive.read_bytes())!=expected['sha256']:raise SystemExit('Source archive SHA256 differs')
with zipfile.ZipFile(archive) as z:
 if sum(i.file_size for i in z.infolist())>96*1024*1024:raise SystemExit('Source archive budget exceeded')
 for name in z.namelist():
  if name not in ['upstream/'+s['component']+'.tar.gz' for s in lock['sources']]+['patches/woff2-binding.cpp','patches/woff2-wrapper.cjs']:raise SystemExit('Unexpected source member')
 for source in lock['sources']:
  raw=z.read('upstream/'+source['component']+'.tar.gz')
  if len(raw)!=source['archiveBytes'] or sha(raw)!=source['archiveSha256']:raise SystemExit('Upstream source identity mismatch')
  if source['component']=='emsdk':continue # Tool archive is retained; use the explicit local SDK.
  dest=work/source['component'];dest.mkdir()
  with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as t:
   members=t.getmembers();total=0
   for member in members:
    parts=member.name.split('/')[1:]
    if not parts or not any(parts):continue
    if member.issym() or member.islnk() or any(x in ['','..','.'] or '\\' in x or ':' in x for x in parts):raise SystemExit('Unsafe upstream member')
    target=dest.joinpath(*parts)
    if member.isdir():target.mkdir(parents=True,exist_ok=True);continue
    if not member.isfile():raise SystemExit('Unsupported source member')
    total+=member.size
    if total>64*1024*1024:raise SystemExit('Source size budget exceeded')
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(t.extractfile(member).read())
 for name in ['woff2-binding.cpp','woff2-wrapper.cjs']:(work/name).write_bytes(z.read('patches/'+name))
for name,expected in lock['compilation']['sourceInputs'].items():
 if sha((work/name).read_bytes())!=expected:raise SystemExit('Compilation source mismatch: '+name)
env={**os.environ,'EM_CONFIG':str(sdk/'.emscripten'),'EM_CACHE':str((a.em_cache or work/'emscripten-cache').resolve()),'EMCC_CORES':'2','SOURCE_DATE_EPOCH':'1700000000'}
args=[x.replace('-ffile-prefix-map=<source-root>=.','-ffile-prefix-map='+str(work)+'=.') for x in lock['compilation']['arguments']]
(work/'output').mkdir()
subprocess.run([sys.executable,str(sdk/'upstream/emscripten/em++.py'),*args],cwd=work,env=env,check=True)
for name,expected in lock['compilation']['outputs'].items():
 if sha((work/'output'/name).read_bytes())!=expected['sha256']:raise SystemExit('Codec build output differs: '+name)
def run(command,cwd):subprocess.run(command,cwd=cwd,env=env,check=True)
project=work/'dom-to-pptx'
pnpm=[a.node,str(a.pnpm_cli.resolve())]
version=subprocess.check_output([*pnpm,'--version'],encoding='utf8').strip()
if version!='10.27.0':raise SystemExit('Exact pnpm10.27.0 required')
run([*pnpm,'install','--frozen-lockfile','--ignore-scripts','--store-dir',str(work/'npm-store')],project)
native=project/'node_modules/fonteditor-core/woff2'
def replace(file,data):
 tmp=file.with_name(file.name+'.urania-tmp');tmp.write_bytes(data);tmp.replace(file)
for name in ['woff2.js','woff2.wasm']:replace(native/name,(work/'output'/name).read_bytes())
replace(native/'index.js',(work/'woff2-wrapper.cjs').read_bytes())
encoded=base64.b64encode((work/'output/woff2.wasm').read_bytes()).decode()
replace(project/'src/woff2-wasm-base64.js',('// Urania codec1: fixed-source WOFF2/Brotli, see codec-build-lock.json.\nexport const woff2WasmBase64 = "data:application/wasm;base64,'+encoded+'";\n').encode())
file=project/'src/animations/css-parser.js';text=file.read_text('utf8');old=r'node.className ? node.className.split(/\s+/) : []'
if text.count(old)!=2:raise SystemExit('SVG class patch input differs')
replace(file,text.replace(old,r"(node.getAttribute('class') || '').split(/\s+/)").encode())
(project/'rollup.urania.config.js').write_text(r'''import configs from './rollup.config.js';
const bundle=configs[1];
// Browser-only dirname/filename polyfills must never embed a build-machine path.
const paths={name:'urania-browser-paths',resolveId(id){if(id==='\0node-polyfills:dirname'||id==='\0node-polyfills:filename')return '\0urania-browser-path';},load(id){if(id==='\0urania-browser-path')return 'export default "/";';}};
export default {...bundle,plugins:[paths,...bundle.plugins],output:{...bundle.output,sourcemap:true}};
''',encoding='utf8')
run([a.node,'node_modules/rollup/dist/bin/rollup','--config','rollup.urania.config.js'],project)
data=(project/'dist/dom-to-pptx.bundle.js').read_bytes();actual=sha(data)
if actual!=lock['browserBundle']['sha256']:raise SystemExit('Browser bundle differs: '+actual)
result={'codecOutputsExact':True,'browserBundleExact':True,'sha256':actual,'bytes':len(data),'noGlobalActivation':True,'lifecycleScripts':False}
(work/'REBUILD_RESULT.json').write_text(json.dumps(result,indent=2),encoding='utf8');print(json.dumps(result))
