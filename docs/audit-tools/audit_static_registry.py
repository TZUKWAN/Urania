from pathlib import Path
from datetime import datetime,timezone
import re,json,hashlib,os
P=Path(os.environ.get('DESIGNCRAFT_AUDIT_ROOT',r'D:\METIS超级合并\dsh-plugin\designcraft'));sha=lambda b:hashlib.sha256(b).hexdigest();host=P/'host';index=(host/'index.js').read_text(encoding='utf-8');tools=[]
for p in sorted(host.glob('*.js')):
 s=p.read_text(encoding='utf-8');declarations=list(re.finditer(r'''\bname\s*:\s*['"](designcraft_[A-Za-z0-9_]+)['"]''',s))
 for match in declarations:
  enums=[]
  for a in re.finditer(r'\baction\s*:\s*\{.{0,160}?enum\s*:\s*\[([^\]]{1,6000})\]',s,re.S):enums.extend(re.findall(r'''['"]([a-zA-Z0-9_-]+)['"]''',a[1]))
  tools.append({'name':match[1],'file':p.relative_to(P).as_posix(),'line':s.count('\n',0,match.start())+1,'sourceSha256':sha(p.read_bytes()),'actionLiterals':sorted(set(enums)),'runtimeRegistered':'not verified; source declaration only'})
imports={}
for m in re.finditer(r"import\s*\{([^}]+)\}\s*from\s*['\"](\./[^'\"]+)['\"]",index):
 for name in m[1].split(','):
  name=name.strip()
  if re.fullmatch(r'register\w+Tools?',name):imports[name]=m[2]
registrations=[{'function':name,'module':imports.get(name),'line':i+1} for i,l in enumerate(index.splitlines()) for name in imports if re.search(r'\b'+name+r'\s*\(',l)]
routes=[{'function':m[1],'line':index.count('\n',0,m.start())+1} for m in re.finditer(r'routes\.push\(\.\.\.(\w+Routes)\(',index)]
upstream=json.loads((P/'docs/upstream-command-candidates.json').read_text(encoding='utf-8'));sourceRoots=Path(r'C:\Users\lauze\Documents\Codex\2026-10-31\sess-28174214-674f-4f4e-8d9b-e550f3d0b2f7\work\designcraft-unified\upstream');snapshots={}
for key,row in upstream['projects'].items():
 folder=sourceRoots/row['checkout'];matches=[];changed=[];missing=[]
 for name,digest in row.get('filesSha256',{}).items():
  p=folder/name
  if not p.is_file():missing.append(name)
  elif sha(p.read_bytes())==digest:matches.append(name)
  else:changed.append({'file':name,'recorded':digest,'current':sha(p.read_bytes())})
 snapshots[key]={'recordedCandidateCount':row['candidateCount'],'currentFilesMatchingSnapshot':len(matches),'changedSinceSnapshot':changed,'filesNotLocated':missing,'currentCommandAvailability':'not determined by this static command; see separately scoped runtime reports'}
report={'schema':1,'kind':'static-tool-route-and-command-source-audit','at':datetime.now(timezone.utc).isoformat(),'functionalValidation':False,'toolDeclarations':tools,'initializationCalls':registrations,'composedRouteRegistrations':routes,'upstreamSourceSnapshots':snapshots,'limitations':['Static declarations and literal action enums are not proof of runtime registration or supported parameters.','Snapshot differences preserve original hashes; no old source inventory was rewritten to match changed UI code.','This command does not execute the UI or model. Current scoped functional cases are recorded in verification/release-validation-20261113.json.']}
(P/'docs/static-registry-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'toolDeclarations':len(tools),'initializationCalls':len(registrations),'routeGroups':len(routes),'upstreamSnapshotChanges':{k:len(v['changedSinceSnapshot']) for k,v in snapshots.items()},'functionalValidation':False}))
