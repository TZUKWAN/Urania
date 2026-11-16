from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,re,os
P=Path(os.environ.get('DESIGNCRAFT_AUDIT_ROOT',str(Path(__file__).resolve().parents[2]) if Path(__file__).resolve().parent.name=='audit-tools' else r'D:\METIS超级合并\dsh-plugin\designcraft'));R=P/'resources/open-design';D=P/'docs';indexBytes=(R/'library-index.json').read_bytes();index=json.loads(indexBytes);lock=json.loads((R/'library-index.lock.json').read_text(encoding='utf-8-sig'))
sha=lambda b:hashlib.sha256(b).hexdigest()
assert sha(indexBytes)==lock['sha256'];cache=R/'library-cache'/index['revision'];ledger=json.loads((D/'opendesign-workflow-ledger.json').read_text(encoding='utf-8'));states={r['id']:r for r in ledger['entries']}
entries=[];packages=[];issues=[];dependencies=[];verifiedCache={}
for pack in index['packages']:
 rows=pack['files'];scripts=[r for r in rows if re.search(r'\.(?:py|sh|ps1|[cm]?js|tsx?|rs)$',r['path'],re.I)];licenses=[r for r in rows if re.search(r'(^|/)(LICENSE[^/]*|NOTICE[^/]*|COPYING[^/]*|OFL[^/]*)$',r['path'],re.I)];cached=0
 for row in rows:
  path=cache/(row['gitSha1']+'.blob')
  if not path.is_file():continue
  if row['gitSha1'] not in verifiedCache:
   raw=path.read_bytes();assert len(raw)==row['bytes'];assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==row['gitSha1'];verifiedCache[row['gitSha1']]=raw
  cached+=1
  if Path(row['path']).name in {'package.json','requirements.txt','Cargo.toml','pyproject.toml','pnpm-lock.yaml','package-lock.json','yarn.lock'}:
   raw=verifiedCache[row['gitSha1']];dep={'package':pack['id'],'file':row['path'],'gitSha1':row['gitSha1'],'sha256':sha(raw),'bytes':len(raw),'execution':'not_run'}
   if Path(row['path']).name=='package.json':
    try:
     j=json.loads(raw);dep.update(declaredLicense=j.get('license'),dependencies={k:j[k] for k in ['dependencies','optionalDependencies','peerDependencies','devDependencies'] if k in j},scriptNames=list(j.get('scripts',{})))
    except (ValueError,UnicodeError) as e:dep['parseError']=str(e)
   else:dep['manifestTextReviewedAsData']=True
   dependencies.append(dep)
 packages.append({'id':pack['id'],'kind':pack['kind'],'fileCount':len(rows),'indexedBytes':sum(r['bytes'] for r in rows),'cachedFiles':cached,'scriptCount':len(scripts),'htmlCount':sum(bool(re.search(r'\.html?$',r['path'],re.I)) for r in rows),'fontCount':sum(bool(re.search(r'\.(?:ttf|otf|woff2?)$',r['path'],re.I)) for r in rows),'licenseFiles':licenses,'symbolicLinks':[r['path'] for r in rows if r['mode']=='120000'],'scope':'Index and verified local cache only; uncached files are not claimed present or executable.'})
 if pack['id'] not in states:continue
 skill=next((r for r in rows if r['path']=='SKILL.md'),None);assert skill is not None
 raw=verifiedCache.get(skill['gitSha1']);assert raw is not None,pack['id'];text=raw.decode('utf-8');catalogue=bool(re.search('This catalogue entry advertises the skill',text));upstream=re.search(r'^\s*upstream:\s*[\"\']?(https://[^\s\"\']+)',text,re.M)
 declarations={}
 for key in ['mode','surface','platform','category']:
  m=re.search(r'^\s*'+key+r':\s*[\"\']?([^\n\"\']+)',text,re.M)
  if m:declarations[key]=m[1].strip()
 html=[r['path'] for r in rows if re.search(r'\.html?$',r['path'],re.I)]
 category='catalogue_requires_upstream_bundle' if catalogue else 'source_with_scripts' if scripts else 'source_with_html' if html else 'direct_guidance_source'
 if pack['id']=='skills/pptx-html-fidelity-audit':category='validation_deferred_by_user'
 if pack['id']=='skills/pr-feedback-quality-gate':category='repository_maintenance_guidance'
 entries.append({'id':pack['id'],'sourceAssessment':category,'sourceBlob':skill['gitSha1'],'sourceSha256':sha(raw),'sourceBytes':len(raw),'sourceMatched':True,'catalogueOnly':catalogue,'upstream':upstream[1] if upstream else states[pack['id']].get('declaredUpstream'),'declarations':declarations,'scriptFiles':[r['path'] for r in scripts],'htmlFiles':html,'licenseFiles':[r['path'] for r in licenses],'declaredEnvironmentNames':sorted(set(re.findall(r'\b(?:OD_[A-Z0-9_]+|[A-Z][A-Z0-9_]*(?:API_KEY|ACCESS_TOKEN|SECRET_KEY))\b',text))),'implementationState':states[pack['id']]['state'],'currentCodePaths':states[pack['id']]['codePaths'],'contextEntry':{'tool':'designcraft_resources','action':'workflow_context','id':pack['id']},'sourceReadIsExecution':False,'workflowVerified':False})
assert len(entries)==169 and len(packages)==928
from collections import Counter
report={'schema':1,'at':datetime.now(timezone.utc).isoformat(),'kind':'source-and-dependency-audit','repository':index['repository'],'revision':index['revision'],'indexSha256':sha(indexBytes),'functionalValidation':False,'packagesAssessed':len(packages),'skillEntriesAssessed':len(entries),'verifiedCachedBlobs':len(verifiedCache),'sourceAssessmentCounts':dict(Counter(r['sourceAssessment'] for r in entries)),'entries':entries,'packages':packages,'cachedDependencyManifests':dependencies,'boundaries':['Each entry was read and its local Git blob verified; source classification is not workflow acceptance.','All indexed files were classified by path and cache presence; uncached data and full transitive dependencies were not fetched or executed.','No account authorization was inferred from source keywords. Public source retrieval, runtime availability, licensing evidence and service authorization are separate concerns.']}
(D/'opendesign-source-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
auth={'schema':1,'at':report['at'],'scope':'Authorization conditions only; no credentials read or services invoked.','blocksOtherWork':False,'items':[{'id':'original-od-stock-search','affectedFeature':'OpenDesign 原版图库守护进程及授权项目绑定','status':'real_run_project_authorization_not_available_to_this_process','required':['真实 OD daemon 地址','对应的 OD run/project 上下文','该上下文签发的短期工具令牌','上游要求的 Vela 登录和项目权限'],'currentProcessVariables':{k:bool(os.environ.get(k)) for k in ['OD_DAEMON_URL','OD_TOOL_TOKEN','OD_NODE_BIN','OD_BIN','VELA_BIN','VELA_WORKSPACE_ID']},'accountState':'not inspected; absence in this process does not prove no account/service exists','currentImplementation':'DesignCraft Commons search is separate; the original authorized OD workflow is not connected','unaffected':['Commons public image source','local resource readers','native image/vector/deck code','source/metadata/license/delivery audits']},{'id':'configured-image-services','affectedFeature':'实际图片生成、编辑和其他远端模型任务','status':'functional_validation_deferred; credential availability not checked','required':['用户现有 DSH 服务配置及对应真实服务权限'],'currentImplementation':'Host adapters exist; provider-specific credentials and quota must be evaluated only when real use is requested','blocksCodeAudit':False},{'id':'optional-external-mcp','affectedFeature':'用户选择的 Stitch/PixelBin/Figma 等外部工作流','status':'optional; connections and authorization not inspected','required':['实际选择该服务时的账号/连接权限'],'requiredForCoreProduct':False,'blocksCodeAudit':False}], 'notAuthorizationBlocks':['未执行的功能验证','未完整评估的上游脚本或附加运行时','历史证据缺档','精确字体/预构建依赖来源未证实']}
(D/'authorization-requirements.json').write_text(json.dumps(auth,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'packagesAssessed':len(packages),'skillEntriesAssessed':len(entries),'verifiedCachedBlobs':len(verifiedCache),'cachedManifests':len(dependencies),'sourceAssessmentCounts':report['sourceAssessmentCounts'],'authorizationConditionsSeparate':True,'functionalValidation':False},ensure_ascii=False))
