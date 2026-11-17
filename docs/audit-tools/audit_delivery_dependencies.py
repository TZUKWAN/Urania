from pathlib import Path
from datetime import datetime,timezone
from zipfile import ZipFile
from io import BytesIO
from fontTools.ttLib import TTFont
import json,hashlib,gzip,os
P=Path(os.environ.get('DESIGNCRAFT_AUDIT_ROOT',str(Path(__file__).resolve().parents[2]) if Path(__file__).resolve().parent.name=='audit-tools' else r'D:\METIS超级合并\dsh-plugin\designcraft'));D=P/'docs';read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'));sha=lambda b:hashlib.sha256(b).hexdigest();checks=[];errors=[]
def check(path,expected,kind,maximum=256*1024*1024):
 if not path.is_file() or path.is_symlink():errors.append({'file':str(path),'reason':'missing or symbolic link'});return None
 if path.stat().st_size>maximum:errors.append({'file':str(path),'reason':'over static read budget'});return None
 raw=path.read_bytes();actual=sha(raw);ok=actual==expected
 checks.append({'file':path.relative_to(P).as_posix(),'bytes':len(raw),'sha256':actual,'expected':expected,'kind':kind,'matched':ok})
 if not ok:errors.append({'file':str(path),'reason':'hash mismatch','expected':expected,'actual':actual})
 return raw
runtime=read(P/'runtime-lock.json')
for key,row in runtime['engines'].items():check(P/row['executable'],row['sha256'],'native-cli')
r=runtime['runner'];check(P/r['executable'],r['sha256'],'native-runner');check(P/r['source'],r['sourceSha256'],'native-runner-source')
for name in ['git-source-runner','private-link-protector','ink-recognizer']:
 path=P/'runtimes'/(name+'.lock.json')
 if path.is_file():
  row=read(path)
  for filekey,hashkey in [('file','sha256'),('source','sourceSha256')]:
   if isinstance(row.get(filekey),str) and isinstance(row.get(hashkey),str):check(path.parent/row[filekey],row[hashkey],name)
web=read(P/'web-runtime-lock.json');webExtra=[]
for key,row in web['engines'].items():
 root=P/'runtimes/web'/key
 for name,meta in row['files'].items():
  raw=check(root/name,meta['sha256'],'web-runtime:'+key)
  if raw is not None and len(raw)!=meta['bytes']:errors.append({'file':str(root/name),'reason':'size mismatch'})
 actual={q.relative_to(root).as_posix() for q in root.rglob('*') if q.is_file()};webExtra += [{'engine':key,'file':name} for name in sorted(actual-set(row['files']))]
for folder in ['resources/vendor/msgpack-3.1.3','resources/vendor/tailwind-3.4.17']:
 root=P/folder;data=read(root/'source-lock.json')
 if isinstance(data.get('files'),dict):
  for name,meta in data['files'].items():check(root/name,meta['sha256'],'vendor-source-and-license')
 else:check(root/data['file'],data['sha256'],'vendor-license-reference')
colorroot=P/'host/vendor/colorjs';colorlock=read(colorroot/'source-lock.json')
for item in colorlock['files']:check(colorroot/item['file'],item['sha256'],'Color.js 0.5.2 source/MIT')
for item in runtime.get('localInputs',{}).values():
 check(P/item['executable'],item['sha256'],'local-user-input-helper')
 check(P/item['source'],item['sourceSha256'],'local-user-input-helper-source')
root=P/'resources/open-design';fixed=read(root/'lock.json')
for row in fixed['files']:check(root/row['path'],row['sha256'],'fixed-design-resource')
converter=root/'dom-to-pptx';cl=read(converter/'source-lock.json')
for row in cl['files']:
 raw=check(converter/row['name'],row['sha256'],'pinned-converter')
 if raw is not None and row.get('expandedSha256'):assert sha(gzip.decompress(raw))==row['expandedSha256']
licenses=read(P/'licenses/dom-to-pptx-components/manifest.json');lockAuditPath=licenses.get('publisherTagLockAudit',{}).get('file','licenses/dom-to-pptx-components/publisher-tag-lock-audit.json');lockAudit=read(P/lockAuditPath)
for row in licenses['components']+lockAudit['packages']:
 if row.get('licenseFile') and row.get('licenseSha256'):check(P/row['licenseFile'],row['licenseSha256'],'converter-license-text')
for row in licenses.get('woff2Binary',{}).get('upstreamLicenses',[]):check(P/row['licenseFile'],row['sha256'],'referenced-upstream-license-text')
for row in licenses.get('native',[]):check(P/row.get('licenseFile','licenses/dom-to-pptx-components/'+row['name']),row['sha256'],'rebuilt-codec-runtime-license')
for row in licenses.get('publisherTagLockAudit',{}),:
 if row.get('file'):check(P/row['file'],row['sha256'],'publisher-tag-lock-audit')
canvas=P/'resources/canvas-design';cs=read(canvas/'source-lock.json');archive=check(canvas/cs['archive'],cs['archiveSha256'],'pinned-canvas-source-archive');fontRefs=read(canvas/'font-license-references/source-lock.json')
for row in fontRefs['licenses']:check(canvas/'font-license-references'/row['file'],row['sha256'],'official-font-license-reference')
fonts=[]
if archive is not None:
 with ZipFile(BytesIO(archive)) as z:
  for info in z.infolist():
   if info.filename.startswith('files/skills/canvas-design/canvas-fonts/') and info.filename.lower().endswith(('.ttf','.otf')):
    assert info.file_size<16*1024*1024;raw=z.read(info);f=TTFont(BytesIO(raw));names={str(i):f['name'].getDebugName(i) for i in [0,1,3,5,8,9,11,13,14] if f['name'].getDebugName(i)}
    fonts.append({'archiveFile':info.filename,'bytes':len(raw),'sha256':sha(raw),'embeddedNameRecords':names,'licenseDeclaredInFont':names.get('13'),'licenseUrlDeclaredInFont':names.get('14'),'actualSource':'Pinned original archive; font metadata and official reference text are separate evidence. No font is executed or installed.'})
standaloneLicenseFiles=[]
for root in [P/'licenses/getrandom-0.4.3',P/'licenses/opendesign-styles']:
 for p in root.rglob('*'):
  if p.is_file():standaloneLicenseFiles.append({'file':p.relative_to(P).as_posix(),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())})
report={'schema':1,'kind':'static-shipped-dependency-and-license-evidence-audit','at':datetime.now(timezone.utc).isoformat(),'functionalValidation':False,'runtimeFilesChecked':len(checks),'integrityErrors':errors,'unlistedWebRuntimeFiles':webExtra,'checks':checks,'nativeWebVersions':{k:r['version'] for k,r in web['engines'].items()},'fontsInOriginalCanvasArchive':fonts,'officialFontReferenceComparisons':fontRefs['fonts'],'otherLicenseEvidence':standaloneLicenseFiles,'sourceLimitations':[{'component':'pinned dom-to-pptx 2.0.1 bundle','status':'exact bytes and parent MIT source verified; complete bundle-to-lock relationship not established','details':licenses.get('unresolved',[])},{'component':'fonteditor-core@2.6.3 embedded WOFF2/Brotli','status':'package binary identity and upstream license texts recorded; exact native source/build revisions not identified'},{'component':'6 canvas fonts (IBM Plex Serif and Instrument Serif)','status':'actual source archive, embedded copyright/version/OFL declaration and official license reference recorded; exact Google Fonts reference bytes differ','files':[r['file'] for r in fontRefs['fonts'] if not r['bytesMatch']]}],'interpretation':'Hash checks and license/source declarations only. This is not a legal opinion, complete transitive-source proof, functional acceptance or authorization to a remote service.'}
if licenses.get('status')=='current-build-source-locked':
 codec=read(converter/'codec-build-lock.json');exact=read(P/'licenses/canvas-fonts-exact-source.json')
 for font in exact['files']:
  original=next(row for row in fonts if row['archiveFile']==font['archiveFile'])
  assert original['sha256']==font['sha256'] and font['exactBytesMatch']
 report['sourceLimitations']=[]
 report['currentSourceResolution']={'converter':{'status':'actual-source-build','sourceLock':cl,'codec':codec,'actualRollupModules':len(licenses['inputModules']),'historicalPrebuiltStillUnprovenAndInactive':True},'sixFonts':exact,'policy':'Original Google reference differences and old expected hashes are retained. New exact official font source closes the provenance gap without replacing the original fonts. npm publisher prebundles remain identified by verified package/lock identity rather than an invented independent nested build.'}
 report['currentVersion']=read(P/'package.json')['version'];report['uiBuild']=read(P/'package.json')['designcraftUiBuild']
(D/'dependency-license-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'checkedFiles':len(checks),'integrityErrors':len(errors),'webExtras':len(webExtra),'canvasFontMetadataRead':len(fonts),'sourceLimitations':len(report['sourceLimitations']),'functionalValidation':False}))
if errors or webExtra:raise SystemExit('Static dependency integrity findings require review')
