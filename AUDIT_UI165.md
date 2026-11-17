# UI165 审查收口

当前版本 1.3.0-dev.150 / UI165；审查基线为公开 main b1627b7 / UI163。核心功能的判定以 VERIFICATION_UI165.json 的明确范围和实际结果为准。

| 问题 | 等级 | 模块 / 位置 | 根因与处理 | 实际验证 |
|---|---|---|---|---|
| I001 | P0 | motion runtime / host/motion/render-supervisor.js:startRender; runtime-env.js; worker entry | 统一路径/实际版本preflight/只传验证过的绝对文件/doctor CLI/API/UI | C02-node,C02-actual-runtime,C03-actual-supervisor,C05-export-ui |
| I002 | P0 | motion resource paths / resource-path.js; worker.scanAudioTracks; routes.reference | 统一相对与realpath验证/缺失实报/正确entry基目录 | C04-path-final15cases |
| I003 | P1 | render lifecycle / render-supervisor.js:cancelRender/close/finish | cancel→cancelling→close→verify→privatecopy/atomicpublish→cleanup→release | C05-short-cwd-lifecycle6cases; actualcancel/UIretry |
| I004 | P1 | artifact performance / artifact-verifier.js; routes.artifact | 1MiBstreamhash+短目录filehandleffprobe+streamdownload | C06-low-memory; C06-real-verifier; real-worker5cases |
| I005 | P1 | Node requirements / package.json; runtime-env.js | 统一Node>=22与doctor版本检测 | C02 versionnegative/actualNode25.6 |
| I006 | P1 | CI / repository .github/workflows; scripts | C15分层CI+门禁脚本与本地相同命令 | C15-public-contracts.log108pass; C15-public-source-check.log333syntax/44lockedresources/7713releaseentries; hosted CI result recorded externally after push |
| I007 | P1 | dependency provenance / docs/dependency-license-audit.json; licenses | C16追溯/必要时现行可追踪替代，保留历史原件 | C16-real-codec.json; C16-real-font-semantics.json; C16-independent-rebuild-final.json; C16-rebuild-script-final.log; C16-final-dependency-audit.log |
| I008 | P2 | font provenance / docs/dependency-license-audit.json:officialFontReferenceComparisons | C16按font metadata/实际源版本追溯 | C16-six-fonts-exact.json; licenses/canvas-fonts-exact-source.json |
| I009 | P2 | historical archive / docs/historical-evidence-reconciliation.json | C17仅按原始SHA检索并区分找回/永久缺失 | C17-historical-identity-closeout.json:56exact primarybytechecks,3notlocated; expectedhashes unchanged |
| I010 | P0 | four-engine workflows / core engine controllers/tools/source store/project graph | C08-C13同一当前构建真实连续验证，必要修复 | C12-four-engine-flow-attempt5.json:2actualGLMturns/current4engineflow+manual+freshApps+MP4+package; C08-C13individualevidence |
| I011 | P0 | version acceptance / VERIFICATION.json; locks; package; SOURCE_SNAPSHOT; Release | C18-C20下一dev150/UI165统一并实际候选验收 | Currentdev150/UI165; current452Node/19client/npmcheck; frozenpackage and remote identity recorded externally |
| I012 | P1 | motion UI / client/actions.js:renderMotion; motion-workspace.js | 接受running/verifying/cleaning/cancelling；新尝试key；取消按钮/主错误区 | C05 actualDSHUIexport/cancel/retry |
| I013 | P0 | Windows deep paths / render-supervisor.js:startRender cwd | 独立短OS-temp/专用profile，私有有界文件通信，验证后同输出目录原子发布 | C05-long-cwd-reproduction; actualDSHUIattempt4; lifecyclelongpathregression |
| I014 | P0 | motion package bounds / host/motion/package.js:readZip/inspectDcmotion | inflate maxOutputLength与累计预算/入口数/文件头/mode/CRC | C04-path-final15cases inclnewpackagebounds |
| I015 | P1 | browser failure cleanup / worker CdpClient/launchBrowser/owned-browser.mjs | 清理pendingtimers/专用profile进程树/早期验证预算 | C06-browser-crash; C06-real-worker5 |
| I016 | P1 | current product docs / requirements/capability/execution docs | C07/C18现行状态+历史归档对照；不恢复弃用服务 | VERIFICATION_UI165.json; core-product-scope.json; AUDIT_UI165.md; no old upstream inventory claimed as current universal acceptance |
| I017 | P1 | deployment recovery / scripts/release metadata | C14可重复doctor/下载恢复/版本hash保护 | C14-current-deployment.json7713offline/actualinterrupt/recovery/SHA/doctor/SDK; C14-restore-security.json5cases |
| I018 | P1 | optional services / optional service UI/tools/capabilities | C07/C13只检查公开入口状态，排除核心强制清单 | CoreactualDSHflow required no dropped service authorization. Optional source/UI status read, not claimed as a newly authorized or live-tested remote service. |
| I019 | P0 | Deck feedback navigation / host/human-edit-protection.js; host/design-feedback.js | Explicit destination + exact full-native unchanged proof; uint64 parameter normalization | C10-navigation-guard-node.log; C10-deck-model-resumed.json; C10-corrected-actual-store-head-audit.json |
| I020 | P1 | Deck native text formatting / upstream crates/engine/src/cmd/text/caret.rs | Preserve def_props/end_props per existing paragraph, inherit last for added paragraphs | C10-primary-native-field-audit.json (actual old loss); corrected Rust test1 + original CRLF/outline2 pass; C10-deck-host19-build.json152inputhashes; C10-native-style-actual.json exact2textfields/reopen/newPPTX6runs/noPageErrors |
| I021 | P1 | AI rejected feedback recovery / editor-session.js; editor-tools.js; native-source-store.js; design-feedback.js; native-controller.js | recover_feedback fenced job, exact rejected digest, two allowed server-generated source transitions; actual durable receipt; original current bytes always reopen safely; release matching draft token only after successful CAS | C10-feedback-recovery-attempt3.json; C10-recovery-node.log |
| I022 | P1 | Motion native materials / host/motion/native-import.js; routes.js; tool.js | Graph-verified import_native with saved source revision/hash, exact derivative bytes and fenced commit | C12-native-material-node.log; C12-four-engine-flow-attempt5.json |
| I023 | P1 | Motion package and source bytes / host/motion/package.js; schema.js; asset-store.js; routes.js | Preserve raw source bytes, deduplicate actual blobs, verify path/SHA/size before publication | C12-native-material-node.log; C12-four-engine-flow-attempt5.json |
| I024 | P1 | Offline runtime deployment / scripts/restore-runtime.ps1; release/runtime-manifest.json | Fixed offline payload now includes7447SDK files, total7713 independently hashed; actual clean restore/SDK edits | C14-current-runtime-archive.json; C14-current-deployment.json |
| I025 | P2 | Converter and six-font provenance / resources/open-design/dom-to-pptx; licenses/ | Rebuilt fixed WOFF2/Brotli/Emscripten/converter sources; exact independent rebuild;6official exact-font matches; original artifacts retained | C16-real-codec.json; C16-real-font-semantics.json; C16-rebuild-script-final.log; C16-six-fonts-exact.json |
| I026 | P1 | Large runtime restore performance / scripts/restore-runtime.ps1 | Bounded .NET parent attributes and streaming SHA; complete undo plan written once before install; actual interruption/recovery | C14-current-deployment.json; C14-restore-security.json |
| I027 | P1 | Current HTTP regression harness / tests/api-store.test.mjs; tests/fixtures/real-dsh-host.mjs | Load actual DSH SessionStore; reject ordinary/missing identity; validate real separate-origin preview without changing product admission | C18-api-design-session-regression.log; C18-npm-test.log |
| I028 | P1 | Converter SVG classes and reproducible browser paths / converter css-parser.js overlay; rebuild/rebuild.py | Read actual class attribute and use deterministic browser path modules; actual WOFF2/PPTX, independent exact UMD/Wasm | C16-real-converter-browser.json; C16-independent-rebuild-final.json; C16-rebuild-script-final.log |
| I029 | P1 | Selection popup draft retention / client/selection-ai.js; design-feedback.js; feedback-contract.js | Carry only actively typed draft to a strict same-source/page/UID expansion; preserve old/destination/conflicting drafts; retain normal source/epoch/submission fences | C19-final-ux-attempt4-real-draft-loss.json; C19-selection-draft-node.log; C19-final-ux.json |

历史缺档：59 项中56项找到原件并逐字节复核；3项未找到。它们是旧 opendesign-model-audit 的 host/dsh-tools.js、host/index.js、host/open-design-tools.js 快照，原期望摘要不改写，不能以当前文件替代。它们不作为当前核心验收依据。

安装在当前机器的干净独立目录验证；未操作用户桌面/DSH，未宣称全新物理电脑或 PowerPoint 原程序视觉验收。可选外部服务与用户取消的采集能力不恢复。

发布与最终 TGZ 的实际摘要、解包加载及远程读回结果位于相邻 DELIVERY.json / GitHub PR；本文件不凭未来动作宣称发布完成。

I030：最终审计修正公开证据摘要计算时机；31份当前证据按最终匿名化、UTF-8/LF公开副本核对，旧原始身份及转换前摘要保留。源码清单与证据摘要已纳入公开CI。
