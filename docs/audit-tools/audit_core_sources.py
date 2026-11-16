from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re,os
P=Path(os.environ.get('DESIGNCRAFT_AUDIT_ROOT',str(Path(__file__).resolve().parents[2]) if Path(__file__).resolve().parent.name=='audit-tools' else r'D:\METIS超级合并\dsh-plugin\designcraft'));D=P/'docs';W=Path(__file__).resolve().parent
matrix=json.loads((D/'capability-matrix.json').read_text(encoding='utf-8-sig'));sha=lambda b:hashlib.sha256(b).hexdigest()
# UI, AI, native/source persistence, output and recovery references, in that order.
rows='''A1|docs/requirements.json|host/editor-tools.js|docs/upstream-command-candidates.json|docs/opendesign-source-audit.json|docs/authorization-requirements.json
A2|client/client.js|host/editor-tools.js|host/installed-version.js|host/index.js|docs/capability-matrix.json
A3|client/native-workspace.js|host/editor-tools.js|host/editor-session.js|host/native-source-store.js|client/native-controller.js
A4|client/native-controller.js|host/editor-tools.js|host/editor-session.js|host/jobs.js|host/studio-image.js
A5|client/native-controller.js|host/editor-tools.js|host/native-source-store.js|host/persistence.js|client/recovery.js
A6|client/editor-surface.js|host/editor-tools.js|host/editor-session.js|host/editor-assets.js|client/native-controller.js
B1|client/native-workspace.js|host/editor-tools.js|client/editor-surface.js|client/editor-frame.js|client/native-controller.js
B2|client/native-workspace.js|host/editor-tools.js|host/editor-session.js|client/native-controller.js|host/editor-routes.js
B3|client/native-workspace.js|host/editor-tools.js|client/editor-surface.js|client/editor-frame.js|client/native-controller.js
B4|client/native-context-tools.js|host/editor-tools.js|host/editor-session.js|client/native-controller.js|host/editor-policy.js
B5|client/native-workspace.js|host/editor-tools.js|host/project-graph.js|host/preview-info.js|client/native-controller.js
B6|client/native-reference.js|host/selection-tool.js|client/native-contract.js|client/dsh-context.js|host/editor-session.js
C1|client/native-context-tools.js|host/editor-tools.js|host/native-vector-header.js|host/source-export.js|host/native-source-store.js
C2|client/native-reference.js|host/editor-tools.js|client/native-contract.js|host/editor-session.js|host/editor-policy.js
C3|client/native-controller.js|host/editor-tools.js|host/editor-session.js|host/native-source-store.js|host/editor-policy.js
C4|client/native-workspace.js|host/editor-tools.js|host/editor-session.js|host/source-export.js|client/native-controller.js
G1|client/html-workspace.js|host/open-design-tools.js|host/open-design-package.js|host/project-package.js|host/external-skill-bundles.js
G2|client/native-workspace.js|host/design-plan-tool.js|host/design-plans.js|host/od-workflow-context.js|host/design-plan-links.js
G3|client/html-workspace.js|host/open-design-tools.js|host/native-source-store.js|host/static-external-svg.js|host/editor-session.js
D1|client/native-contract.js|host/selection-tool.js|host/editor-session.js|host/native-source-store.js|host/editor-policy.js
D2|client/editor-surface.js|host/editor-tools.js|host/editor-session.js|host/native-source-store.js|client/native-controller.js
D3|client/native-workspace.js|host/editor-tools.js|host/native-source-store.js|host/source-export.js|client/native-controller.js
D4|client/native-context-tools.js|host/editor-tools.js|host/editor-session.js|host/source-export.js|host/native-source-store.js
D5|client/native-reference.js|host/editor-tools.js|host/editor-session.js|host/selection-tool.js|host/editor-policy.js
E1|client/editor-surface.js|host/editor-tools.js|host/editor-session.js|host/native-source-store.js|client/native-controller.js
E2|client/native-context-tools.js|host/editor-tools.js|host/native-deck-header.js|host/source-export.js|host/native-source-store.js
E3|client/native-workspace.js|host/editor-tools.js|host/native-deck-header.js|host/source-export.js|client/native-controller.js
E4|client/native-reference.js|host/editor-tools.js|host/editor-session.js|host/native-deck-header.js|host/editor-policy.js
E5|client/native-workspace.js|host/editor-tools.js|host/presentation-admission.js|host/source-export.js|host/native-source-store.js
F1|client/native-workspace.js|host/editor-tools.js|host/project-graph.js|host/material-origin.js|host/editor-session.js
F2|client/native-workspace.js|host/editor-tools.js|host/project-graph.js|host/material-origin.js|host/native-source-store.js
F3|client/native-context-tools.js|host/editor-tools.js|host/project-graph.js|host/linked-updates.js|client/native-controller.js
F4|client/native-context-tools.js|host/editor-tools.js|host/project-graph.js|host/linked-updates.js|client/native-controller.js
F5|client/native-workspace.js|host/editor-tools.js|host/native-deck-conversion.js|host/project-graph.js|host/editor-session.js
F6|client/native-workspace.js|host/editor-tools.js|host/project-graph.js|host/linked-updates.js|client/native-controller.js
G4|client/html-workspace.js|host/html-tools.js|host/html-artifacts.js|client/html-sandbox.js|client/native-controller.js
G5|client/html-workspace.js|host/html-tools.js|host/html-artifacts.js|host/editor-routes.js|client/native-controller.js
G6|client/brand-panel.js|host/editor-tools.js|host/brand-bindings.js|host/brand-updates.js|host/brand-font-updates.js
H1|client/studio-image-workspace.js|host/studio-image.js|host/image-provider.js|host/image-jobs.js|host/studio-image.js
H2|client/studio-image-workspace.js|host/studio-image.js|host/image-jobs.js|host/native-source-store.js|client/native-controller.js
H3|client/studio-image-workspace.js|host/selection-tool.js|host/photo-mask.js|host/image-jobs.js|host/photo-candidate-proof.js
H4|client/studio-image-workspace.js|host/studio-image.js|host/photo-candidate-proof.js|host/image-jobs.js|client/native-controller.js
H5|client/studio-image-workspace.js|host/native-variants.js|host/native-source-store.js|host/native-variants.js|client/image-adoption.js
I1|client/native-workspace.js|host/editor-tools.js|host/source-export.js|host/editor-routes.js|host/native-source-store.js
I2|client/native-workspace.js|host/editor-tools.js|host/presentation-admission.js|host/source-export.js|host/native-source-store.js
I3|client/native-workspace.js|host/editor-tools.js|host/project-package.js|host/editor-routes.js|host/project-graph.js
I4|client/legacy-migration-workspace.js|host/legacy-migration.js|host/native-vector-legacy.js|host/project-package.js|host/legacy-migration.js
J1|docs/requirements.json|host/editor-tools.js|docs/capability-matrix.json|docs/capability-inventory.json|docs/capability-matrix.json
J2|docs/requirements.json|host/editor-tools.js|docs/capability-matrix.json|docs/capability-inventory.json|docs/capability-matrix.json
J3|README.md|host/installed-version.js|package.json|web-runtime-lock.json|runtime-lock.json'''
mapping={a[0]:a[1:] for line in rows.splitlines() if (a:=line.split('|'))};assert len(mapping)==50 and set(mapping)=={x['id'] for x in matrix['tasks']}
cache={}
def source(name):
 if name in cache:return cache[name]
 path=P/name;assert path.is_file() and not path.is_symlink(),name
 raw=path.read_bytes();result={'file':name,'bytes':len(raw),'interpretation':'Source/file reference only; not proof the complete task is implemented or currently passes.'}
 if name not in {'docs/capability-matrix.json','docs/capability-inventory.json'}:result['sha256']=sha(raw)
 else:result['snapshot']='live status metadata; deliberately not self-hashed'
 if path.suffix in {'.js','.rs'}:
  lines=raw.decode('utf-8').splitlines();result['declaredEntrypoints']=[{'line':i+1,'declaration':l.strip()[:190]} for i,l in enumerate(lines) if re.match(r'\s*(?:export\s+(?:async\s+)?(?:function|class|const)|(?:pub\s+)?(?:async\s+)?fn|(?:async\s+)?[A-Za-z_][A-Za-z0-9_]*\([^;]*\)\s*\{)',l)][:40]
 cache[name]=result;return result
facets=['ui','ai','source','output','recovery'];tasks=[]
for task in matrix['tasks']:
 evidence=[]
 for name in task.get('evidence',[]):
  path=D/name;assert path.is_file(),name
  if name in {'capability-inventory.json','implementation-source-audit.json'}:evidence.append({'file':name,'kind':'generated_index_not_runtime_evidence'});continue
  raw=path.read_bytes();evidence.append({'file':name,'bytes':len(raw),'sha256':sha(raw),'kind':'historical_or_documentary_evidence; scope comes from the original report'})
 tasks.append({'id':task['id'],'goal':task['goal'],'acceptance':task['acceptance'],'recordedAcceptanceStatus':task['status'],'sourceReferenceAudit':'completed','facets':{k:source(v) for k,v in zip(facets,mapping[task['id']])},'evidence':evidence,'currentBuildRuntimeVerified':False,'runtimeBoundary':'This source-reference command does not execute functionality; current scoped runtime results are in verification/release-validation-20261113.json.','implementationNote':task.get('implementationNote','')})
legacy=W/'evidence/matrix-evidence-audit.json'
if not legacy.is_file():legacy=D/'historical-evidence-audit.json'
a=json.loads(legacy.read_text(encoding='utf-8-sig'))
report={'schema':1,'kind':'all-task-source-and-evidence-audit','at':datetime.now(timezone.utc).isoformat(),'functionalValidation':False,'fullScopeComplete':False,'taskCount':len(tasks),'facetReferenceCount':len(tasks)*5,'sourceFilesReferenced':len(cache),'tasks':tasks,'historicalEvidenceAudit':{'reports':a['reports'],'directMatchingPairs':a['hashPairsChecked'],'recoveredReferences':len(a['historicalReferencesRecovered']),'declaredFilesMissing':a['declaredFilesMissing'],'mismatches':a['hashMismatches'],'unresolved':a['unresolvedFileReferences'],'interpretation':'Changed or missing historical artifacts are preserved as findings, never rewritten to match current files.'},'notAssessedByThisStaticCommand':['Dynamic native command availability','UI, output/reopen and recovery behavior; see the separate current runtime report','Model/service authorization, quota and overall functional acceptance'],'currentRuntimeReport':'verification/release-validation-20261113.json','authorizationReport':'authorization-requirements.json','historicalReconciliation':json.loads((D/'historical-evidence-reconciliation.json').read_text(encoding='utf-8')) if (D/'historical-evidence-reconciliation.json').is_file() else None,'sourceInventory':'opendesign-source-audit.json','interpretation':'All 50 rows and their 5 source facets were statically traced to existing files. This closes this source-reference audit, not runtime task acceptance or every upstream feature.'}
(D/'implementation-source-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'tasks':len(tasks),'facetReferences':len(tasks)*5,'sourceFiles':len(cache),'historicalMismatches':len(a['hashMismatches']),'historicalUnresolved':len(a['unresolvedFileReferences']),'functionalValidation':False}))
