# 本轮修复记录

## I001 · motion runtime

触发：开发机ffmpeg默认路径，环境白名单漏浏览器和FFmpeg配置

文件：host/motion/render-supervisor.js:startRender; runtime-env.js; worker entry

修改：统一路径/实际版本preflight/只传验证过的绝对文件/doctor CLI/API/UI

验证：C02-node,C02-actual-runtime,C03-actual-supervisor,C05-export-ui

## I002 · motion resource paths

触发：UI164已有真实目录约束；绝对工程内路径/重复编码/缺失静默跳过/子入口目录仍需补强

文件：resource-path.js; worker.scanAudioTracks; routes.reference

修改：统一相对与realpath验证/缺失实报/正确entry基目录

验证：C04-path-final15cases

## I003 · render lifecycle

触发：发出kill即释放槽位和删除temp

文件：render-supervisor.js:cancelRender/close/finish

修改：cancel→cancelling→close→verify→privatecopy/atomicpublish→cleanup→release

验证：C05-short-cwd-lifecycle6cases; actualcancel/UIretry

## I004 · artifact performance

触发：readFileSync整个视频；ffprobe同步阻塞

文件：artifact-verifier.js; routes.artifact

修改：1MiBstreamhash+短目录filehandleffprobe+streamdownload

验证：C06-low-memory; C06-real-verifier; real-worker5cases

## I005 · Node requirements

触发：packageNode>=18，worker需要全局WebSocket/Node22

文件：package.json; runtime-env.js

修改：统一Node>=22与doctor版本检测

验证：C02 versionnegative/actualNode25.6

## I006 · CI

触发：公开库无Actions

文件：repository .github/workflows; scripts

修改：C15分层CI+门禁脚本与本地相同命令

验证：C15-public-contracts.log108pass; C15-public-source-check.log333syntax/44lockedresources/7713releaseentries; hosted CI result recorded externally after push

## I007 · dependency provenance

触发：当前仍记录bundle-to-lock与二进制源修订未完全对应

文件：docs/dependency-license-audit.json; licenses

修改：C16追溯/必要时现行可追踪替代，保留历史原件

验证：C16-real-codec.json; C16-real-font-semantics.json; C16-independent-rebuild-final.json; C16-rebuild-script-final.log; C16-final-dependency-audit.log

## I008 · font provenance

触发：6字体与参考字节不同；版本/变体关系需核实

文件：docs/dependency-license-audit.json:officialFontReferenceComparisons

修改：C16按font metadata/实际源版本追溯

验证：C16-six-fonts-exact.json; licenses/canvas-fonts-exact-source.json

## I009 · historical archive

触发：59个历史唯一SHA未定位

文件：docs/historical-evidence-reconciliation.json

修改：C17仅按原始SHA检索并区分找回/永久缺失

验证：C17-historical-identity-closeout.json:56exact primarybytechecks,3notlocated; expectedhashes unchanged

## I010 · four-engine workflows

触发：UI164部分流程已验；没有本轮完整统一记录

文件：core engine controllers/tools/source store/project graph

修改：C08-C13同一当前构建真实连续验证，必要修复

验证：C12-four-engine-flow-attempt5.json:2actualGLMturns/current4engineflow+manual+freshApps+MP4+package; C08-C13individualevidence

## I011 · version acceptance

触发：公开仍148/163，本地149/164，不应回写成已验UI163

文件：VERIFICATION.json; locks; package; SOURCE_SNAPSHOT; Release

修改：C18-C20下一dev150/UI165统一并实际候选验收

验证：Currentdev150/UI165; current452Node/19client/npmcheck; frozenpackage and remote identity recorded externally

## I012 · motion UI

触发：只认rendering，backendrunning被提前停；revision固定key复用失败job；部分error只空页可见

文件：client/actions.js:renderMotion; motion-workspace.js

修改：接受running/verifying/cleaning/cancelling；新尝试key；取消按钮/主错误区

验证：C05 actualDSHUIexport/cancel/retry

## I013 · Windows deep paths

触发：现存390字符cwd启动Node报ENOENT，匿名pipe导致二次ENOTCONN使DSH退出

文件：render-supervisor.js:startRender cwd

修改：独立短OS-temp/专用profile，私有有界文件通信，验证后同输出目录原子发布

验证：C05-long-cwd-reproduction; actualDSHUIattempt4; lifecyclelongpathregression

## I014 · motion package bounds

触发：先inflate再查预算；ZIP模式/CRC/localcentral未全部验证

文件：host/motion/package.js:readZip/inspectDcmotion

修改：inflate maxOutputLength与累计预算/入口数/文件头/mode/CRC

验证：C04-path-final15cases inclnewpackagebounds

## I015 · browser failure cleanup

触发：CDP待办可挂到120s；失败后profile/process清理不确定

文件：worker CdpClient/launchBrowser/owned-browser.mjs

修改：清理pendingtimers/专用profile进程树/早期验证预算

验证：C06-browser-crash; C06-real-worker5

## I016 · current product docs

触发：旧pending、Kimi、已移除采集入口描述与当前事实不一致

文件：requirements/capability/execution docs

修改：C07/C18现行状态+历史归档对照；不恢复弃用服务

验证：VERIFICATION_UI165.json; core-product-scope.json; AUDIT_UI165.md; no old upstream inventory claimed as current universal acceptance

## I017 · deployment recovery

触发：恢复步骤缺可重复自动检查/下载中断/错误解压覆盖

文件：scripts/release metadata

修改：C14可重复doctor/下载恢复/版本hash保护

验证：C14-current-deployment.json7713offline/actualinterrupt/recovery/SHA/doctor/SDK; C14-restore-security.json5cases

## I018 · optional services

触发：需核对是否诚实不可用，不能阻塞核心

文件：optional service UI/tools/capabilities

修改：C07/C13只检查公开入口状态，排除核心强制清单

验证：CoreactualDSHflow required no dropped service authorization. Optional source/UI status read, not claimed as a newly authorized or live-tested remote service.

## I019 · Deck feedback navigation

触发：Real GLM nav was quarantined, 38+ steps stalled before titles saved; actual original manual native bytes remained intact

文件：host/human-edit-protection.js; host/design-feedback.js

修改：Explicit destination + exact full-native unchanged proof; uint64 parameter normalization

验证：C10-navigation-guard-node.log; C10-deck-model-resumed.json; C10-corrected-actual-store-head-audit.json

## I020 · Deck native text formatting

触发：Actual post-AI native diff found both original paragraph.endProps replaced by null

文件：upstream crates/engine/src/cmd/text/caret.rs

修改：Preserve def_props/end_props per existing paragraph, inherit last for added paragraphs

验证：C10-primary-native-field-audit.json (actual old loss); corrected Rust test1 + original CRLF/outline2 pass; C10-deck-host19-build.json152inputhashes; C10-native-style-actual.json exact2textfields/reopen/newPPTX6runs/noPageErrors

## I021 · AI rejected feedback recovery

触发：No AI recovery action; independent recovery left stale original ownedDraftTokens causing CAS conflict on returning

文件：editor-session.js; editor-tools.js; native-source-store.js; design-feedback.js; native-controller.js

修改：recover_feedback fenced job, exact rejected digest, two allowed server-generated source transitions; actual durable receipt; original current bytes always reopen safely; release matching draft token only after successful CAS

验证：C10-feedback-recovery-attempt3.json; C10-recovery-node.log

## I022 · Motion native materials

触发：Saved native materials had no registered Motion import operation

文件：host/motion/native-import.js; routes.js; tool.js

修改：Graph-verified import_native with saved source revision/hash, exact derivative bytes and fenced commit

验证：C12-native-material-node.log; C12-four-engine-flow-attempt5.json

## I023 · Motion package and source bytes

触发：Untouched binary/text source encodings or aliased media could be lost; package asset identity checked too late

文件：host/motion/package.js; schema.js; asset-store.js; routes.js

修改：Preserve raw source bytes, deduplicate actual blobs, verify path/SHA/size before publication

验证：C12-native-material-node.log; C12-four-engine-flow-attempt5.json

## I024 · Offline runtime deployment

触发：Old release omitted installed HyperFrames SDK dependencies

文件：scripts/restore-runtime.ps1; release/runtime-manifest.json

修改：Fixed offline payload now includes7447SDK files, total7713 independently hashed; actual clean restore/SDK edits

验证：C14-current-runtime-archive.json; C14-current-deployment.json

## I025 · Converter and six-font provenance

触发：Old prebuilt codec source revisions and6font exact source unproven

文件：resources/open-design/dom-to-pptx; licenses/

修改：Rebuilt fixed WOFF2/Brotli/Emscripten/converter sources; exact independent rebuild;6official exact-font matches; original artifacts retained

验证：C16-real-codec.json; C16-real-font-semantics.json; C16-rebuild-script-final.log; C16-six-fonts-exact.json

## I026 · Large runtime restore performance

触发：7713file restore exposed expensive repeated PS path probes and growing journal rewrites

文件：scripts/restore-runtime.ps1

修改：Bounded .NET parent attributes and streaming SHA; complete undo plan written once before install; actual interruption/recovery

验证：C14-current-deployment.json; C14-restore-security.json

## I027 · Current HTTP regression harness

触发：Old test omitted mandatory design session and requested retired authenticated-origin preview

文件：tests/api-store.test.mjs; tests/fixtures/real-dsh-host.mjs

修改：Load actual DSH SessionStore; reject ordinary/missing identity; validate real separate-origin preview without changing product admission

验证：C18-api-design-session-regression.log; C18-npm-test.log

## I028 · Converter SVG classes and reproducible browser paths

触发：Actual SVGAnimatedString.className crash; browser polyfill injected build paths

文件：converter css-parser.js overlay; rebuild/rebuild.py

修改：Read actual class attribute and use deterministic browser path modules; actual WOFF2/PPTX, independent exact UMD/Wasm

验证：C16-real-converter-browser.json; C16-independent-rebuild-final.json; C16-rebuild-script-final.log

## I029 · Selection popup draft retention

触发：Real Shift-selection expansion replaced actively typed popup request with another empty target draft

文件：client/selection-ai.js; design-feedback.js; feedback-contract.js

修改：Carry only actively typed draft to a strict same-source/page/UID expansion; preserve old/destination/conflicting drafts; retain normal source/epoch/submission fences

验证：C19-final-ux-attempt4-real-draft-loss.json; C19-selection-draft-node.log; C19-final-ux.json

完整新旧状态与证据边界见 AUDIT_UI165.md。
