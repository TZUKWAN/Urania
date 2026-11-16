"""Code/build/file evidence only; never import or execute product functionality."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,re,subprocess,os
P=Path(os.environ.get('DESIGNCRAFT_AUDIT_ROOT',r'D:\METIS超级合并\dsh-plugin\designcraft'));W=Path.cwd();B=W/'work/before-five-gaps-20261113';N=Path(r'C:\Users\lauze\Documents\Codex\2026-10-31\sess-28174214-674f-4f4e-8d9b-e550f3d0b2f7\work\designcraft-unified\upstream\deckcraft-4ce2944630b04188dee8504c14151994d06c416a')
read=lambda p:json.loads(p.read_text(encoding='utf-8-sig'));sha=lambda b:hashlib.sha256(b).hexdigest();baseline=read(B/'manifest.json');commands=[]
for name,meta in baseline.items():assert sha((B/'product'/name).read_bytes())==meta['sha256'],name
def run(args):
 result=subprocess.run(args,capture_output=True,text=True,encoding='utf-8',errors='replace');commands.append({'command':subprocess.list2cmdline(args),'exitCode':result.returncode,'output':result.stdout+result.stderr});assert result.returncode==0,commands[-1];return result
changed=[]
for folder in ['host','client']:
 for p in sorted((P/folder).glob('*.js')):
  name=p.relative_to(P).as_posix();old=baseline.get(name.replace('/','\\')) or baseline.get(name)
  if not old or old['sha256']!=sha(p.read_bytes()):
   run(['node','--check',str(p)]);changed.append({'file':name,'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size,'change':'modified' if old else 'added','syntaxChecked':True})
for script in ['work/static_external_imports.py','work/audit_client_module_routes.py']:run(['python',script])
# Entire vendored source import closure and exact npm-published file identities.
vendor=P/'host/vendor/colorjs';v=read(vendor/'source-lock.json');references=0
for row in v['files']:
 p=vendor/row['file'];assert sha(p.read_bytes())==row['sha256'],row['file']
 if p.suffix=='.js':
  for target in re.findall(r'''(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]''',p.read_text(encoding='utf-8')):
   assert (p.parent/target).resolve().is_relative_to(vendor.resolve()) and (p.parent/target).is_file(),(row['file'],target);references+=1
assert v['version']=='0.5.2' and v['license']=='MIT' and v['lifecycleScriptsExecuted'] is False
assert (P/'host/opendesign-design-brief-v1.js').read_bytes()==(B/'product/host/opendesign-design-brief.js').read_bytes()
helper=read(P/'runtimes/ink-recognizer.lock.json');bridge=(P/'host/deck-local-inputs.js').read_text(encoding='utf-8');runtime=read(P/'runtime-lock.json')['localInputs']['deck']
for filekey,hashkey,const in [('file','sha256','EXE_SHA'),('source','sourceSha256','SOURCE_SHA')]:
 actual=sha((P/'runtimes'/helper[filekey]).read_bytes());assert actual==helper[hashkey]==re.search(r'const '+const+r"='([a-f0-9]{64})'",bridge).group(1);assert actual==runtime[hashkey]
build=read(W/'work/evidence/deck-build-result.json');assert build['status']=='succeeded' and build['exitCode']==0 and build['sourceMatches'] is True;assert sha((W/'work/evidence/deck-build.log').read_bytes())==build['logSha256']
for name,digest in build['sourceFiles'].items():
 p=N.parent/'deck-fonts'/name[len('font-input/'):] if name.startswith('font-input/') else N/name;assert sha(p.read_bytes())==digest,name
web=read(P/'web-runtime-lock.json');deck=web['engines']['deckcraft-host'];assert deck['version']=='0.13.1+designcraft.host16' and deck['provenance']['sourceFiles']==build['sourceFiles'] and deck['provenance']['buildLogSha256']==build['logSha256']
for name,row in deck['files'].items():assert sha((P/'runtimes/web/deckcraft-host'/name).read_bytes())==row['sha256'],name
nativeBefore=read(B/'deck/manifest.json');nativeChanges=[]
for name,old in nativeBefore.items():
 p=N/name;actual=sha(p.read_bytes())
 if actual!=old['sha256']:assert name.replace('\\','/') in build['sourceFiles'];nativeChanges.append({'file':name.replace('\\','/'),'sha256':actual})
added='crates/engine/src/cmd/ink_recognition.rs';assert sha((N/added).read_bytes())==build['sourceFiles'][added];nativeChanges.append({'file':added,'sha256':build['sourceFiles'][added],'change':'added'})
sourceAudit=read(P/'docs/native-source-input-audit.json');assert sha((P/'docs'/sourceAudit['archive']).read_bytes())==sourceAudit['sha256'] and sourceAudit['archiveRoundtripBytesMatch'] is True
units={
 'K1':('Deck动态中文',['client/native-workspace.js','docs/hosted-ui-source-audit.json']),
 'K2':('图片任务与精确计划版本',['host/image-plan-binding.js','host/image-jobs.js','host/studio-image.js','client/studio-image-workspace.js','host/project-package.js']),
 'K3':('中文简报v2与旧v1兼容',['host/chinese-design-brief.js','host/opendesign-design-brief.js','host/opendesign-design-brief-v1.js','host/opendesign-brief-job.js']),
 'K4':('历史创意指导原包与计划迁移',['host/director-snapshots.js','host/creative-director-resource.js','host/design-plan-migration.js','host/design-plan-restore.js','host/project-package.js','client/native-workspace.js']),
 'K5':('本地OD编排/APCA/OKLCH/完整原生源颜色审计',['host/local-design-workflows.js','host/local-workflow-routes.js','host/open-design-tools.js','client/local-workflow-panel.js','host/color-contrast.js','host/document-color-audit.js','host/native-color-source.js','client/brand-panel.js','host/project-package.js']),
 'D1':('墨迹文字',['host/deck-local-inputs.js','runtimes/ink-recognizer.cs','client/deck-local-tools.js','client/native-controller.js']),
 'D2':('墨迹公式',['host/deck-local-inputs.js','runtimes/ink-recognizer.cs','client/mathml-to-omml.js','client/deck-local-tools.js','client/native-controller.js']),
 'D3':('屏幕截图',['host/deck-local-inputs.js','runtimes/ink-recognizer.cs','client/local-capture.js','client/deck-local-tools.js','client/native-controller.js']),
 'D4':('麦克风旁白',['client/local-capture.js','client/deck-local-tools.js','client/native-controller.js']),
 'D5':('摄像头照片/录像',['client/local-capture.js','client/deck-local-tools.js','client/native-controller.js'])}
evidence=[]
for name in sorted({x for _,paths in units.values() for x in paths}|{'host/index.js','runtime-lock.json','web-runtime-lock.json','runtimes/ink-recognizer.lock.json','runtimes/ink-recognizer.exe','docs/five-gaps-and-deck.md','README.md','skills/designcraft/SKILL.md'}):
 p=P/name;assert p.is_file() and not p.is_symlink();evidence.append({'file':name,'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size})
pkg=read(P/'package.json');assert pkg['version']=='1.3.0-dev.136' and pkg['designcraftUiBuild']==150
assert "auditSavedNativeColors" in (P/'host/html-routes.js').read_text(encoding='utf-8') and "liveSummaryUsed=false" in (P/'host/native-color-source.js').read_text(encoding='utf-8')
assert all(action in (P/'client/deck-local-tools.js').read_text(encoding='utf-8') and action in (N/'crates/ui-egui/src/control/hosted.rs').read_text(encoding='utf-8') for action in ['local_ink_text','local_ink_math','local_screenshot','local_narration','local_camera'])
deps=read(P/'docs/dependency-license-audit.json');assert not deps['integrityErrors'] and not deps['unlistedWebRuntimeFiles']
report={'schema':1,'kind':'requested-ten-units-code-build-static-audit','at':datetime.now(timezone.utc).isoformat(),'product':'DesignCraft','version':pkg['version'],'uiBuild':150,'status':'requested_code_written_build_and_static_checks_complete_functionality_unvalidated','scope':'Only the five reported code gaps and the five Deck inputs; current-session local design orchestration, not all upstream scripts or additional external services.','functionalValidation':False,'uiOrRecognitionOrHardwareOrModelOrServiceExecution':False,'userDesktopControlled':False,'dshRestarted':False,'allCoreFunctionsAccepted':False,'units':[{'id':key,'title':title,'codeStatus':'written_and_statically_reviewed','files':paths,'functionalValidation':'deferred_by_user'} for key,(title,paths) in units.items()],'changedJavaScript':changed,'syntaxFilesChecked':len(changed),'staticCommands':commands,'sourceEvidence':evidence,'nativeChangedSources':nativeChanges,'nativeBuild':{'host':deck['version'],'rustTrunkExitCode':0,'sourceMatches':True,'inputFiles':len(build['sourceFiles']),'logSha256':build['logSha256'],'sourceArchive':sourceAudit},'localHelper':helper,'vendor':{'name':v['name'],'version':v['version'],'license':v['license'],'filesMatched':len(v['files']),'relativeImportsChecked':references,'tarballSha256':v['tarballSha256'],'scriptsExecuted':False},'legacyBriefBytesIdentical':True,'mainModelReview':['十单元真实代码、工具/路由/UI/源文件接线按源码复核；没有用示例识别、假媒体或占位文件完成入口。','完整颜色检查改读保存原生源，常规UI摘要不作整稿依据。','候选先确认，原生源/epoch/修订/选区核对；已应用结果保存失败仅重试保存，取消和卸载释放采集设备。','历史指导原包按真实资源身份核验/保留，迁移只创建新计划修订；旧v1解析器为原字节副本。','本地编排检查实际规则分页和产物字节；人工查阅不记模型已读，停用声明单列，结果不证明模型遵循或视觉效果。','没有新接被放弃外部平台；未运行功能/识别/设备/API/UI/模型验证。'],'correctedFindings':['独立engine cargo check第一次缺已有getrandom/wasm_js feature，明确加feature后通过；web包release构建通过。','本地helper每次编译的EXE摘要不同；最终桥/锁均固定到实际最后编译产物，没有用旧摘要。','Display P3公共名称映射到实际Color.js p3空间。','颜色审计初稿使用受限UI摘要，已改读完整已保存原生结构。','本地工作流修正规则人工/模型交付区分、实际计划关联返回字段、停用关联、HTML不确定提交恢复和角色标识。','扩大排除范围时一处JS正则斜杠未转义被node --check拒绝；已修正并重新检查通过。','采集取消、AudioContext启动失败及编码启动失败的资源清理分支已补。'],'remainingCodeUnitsWithinRequestedScope':[],'deferred':['十单元的功能、UI、识别准确度和硬件权限验证','核心旅程、保存重开、PPTX/媒体/项目包效果和模型真实执行验收'],'residualLimits':['Windows Ink/Math组件可用性和识别准确度未经运行确认。','屏幕/麦克风/摄像头权限、DPI、多屏和编码器受实际宿主环境影响；Cameo是照片/视频对象而非直播放映。','APCA为实验性指标；原生源颜色检查保留主题/复杂背景/透明/栅格/遮挡和度量未知，不是像素级合规证明。','旧指导包如果没有原字节必须从旧项目包恢复，不能以当前版本替换。','当前DSH模型负责生成和遵循规则；本地编排不等于所有上游脚本/视频/浏览器/PR运行时兼容。']+deps['sourceLimitations'],'currentUserLoadedVersion':'unverified','backups':[str(B),str(W/'work/before-deck-host16'),str(W/'work/before-ui150')]}
target=P/'docs/five-gaps-code-audit.json';target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');(W/'outputs/DesignCraft_五类缺口和Deck五入口_代码静态审计_20261113.json').write_bytes(target.read_bytes())
print(json.dumps({'version':pkg['version'],'uiBuild':150,'codeUnits':len(units),'changedJsSyntaxChecked':len(changed),'nativeSourceInputsMatched':len(build['sourceFiles']),'vendorFilesMatched':len(v['files']),'functionalValidation':False,'report':str(target)},ensure_ascii=False))
