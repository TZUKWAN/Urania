# Urania UI169 部署与恢复

本页适用 `designcraft@1.3.1`（UI169）和 Windows x64。现有作品保存在各项目的 `design/.designcraft/`。

## 环境

| 组件 | 要求与本轮实际环境 |
|---|---|
| 插件、Motion Worker | Node >=22；本轮 Node25.6.0 |
| DSH | 本轮实际 SDK0.2.2-rc.1，其自身要求 Node >=24.9.0；同时满足较严格的宿主要求 |
| 浏览器 | Chromium/Chrome/Edge >=120，可无窗口启动 |
| 视频编码 | FFmpeg、FFprobe >=6；MP4 编码需要 libx264；本轮使用外部 FFmpeg9.0.2 |
| 磁盘 | 安装/升级建议至少 12GB 可用空间；渲染另有临时文件预算 |
| 模型 | 使用您已配置的 DSH 模型；图片生成 API 在插件内独立配置 |

DSH、Node、浏览器和 FFmpeg 不随运行包分发。恢复脚本不会安装系统程序、激活 SDK、执行 npm 安装脚本、读取账号密钥或重启正在使用的 DSH。Figma、Stitch、PixelBin 等已排除的外部服务不是安装前置条件。

## 安装插件和运行时

解开发布页的 `designcraft-1.3.1.tgz`，或检出对应源码标签。进入含有 `package.json` 的插件目录。UI169 使用本轮三原生引擎更新后的独立运行时 ZIP，恢复脚本按 `release/runtime-assets.json` 检查归档和每个文件的摘要。

在仓库根目录执行：

```powershell
pwsh -NoProfile -File scripts/restore-runtime.ps1 -Download
```

该命令只下载清单固定的 Urania GitHub Release ZIP，支持保留 `.part` 文件后续传；只有整个 ZIP 的大小和 SHA256 正确才会解包。也可使用已下载的离线原包：

```powershell
pwsh -NoProfile -File scripts/restore-runtime.ps1 -ArchivePath C:/Downloads/urania-runtime-win-x64-ui169.zip
```

归档包含 7,721 个有逐文件摘要的运行文件，其中 7,447 个属于固定的 HyperFrames SDK 及传递依赖。ZIP 约 1.41 GB，展开约 3.43 GB。从本地归档恢复无需在项目内运行 `npm install`。

公开 TGZ 随附安装脚本和对应的归档摘要。Deck 会在本机运行的 DSH 中读取 Windows 已安装的微软雅黑常规及粗体字形用于预览。运行时归档不分发这两份系统字体，PPTX 保留可编辑文本及原字体名称。若目标系统没有该字体，实际打开的字体由该系统回退规则决定。

## DSH性能兼容补丁

本轮性能验收要求同版可还原SDK界面补丁。先正常保存并停止目标DSH，再对含node_modules的实际npm SDK目录执行：

```powershell
node scripts/patch-dsh-performance.mjs --sdk-root C:/Tools/dsh --check
node scripts/patch-dsh-performance.mjs --sdk-root C:/Tools/dsh --apply
```

仅支持已固定七个文件摘要的0.2.2-rc.1，未知版本/本地修改拒绝。路径是格式示例，不能直接套用。原件和回执在SDK目录的`.urania-performance-patch`，升级其他补丁前用原版本脚本`--restore`。不支持直接修改Electron ASAR，不自动重启DSH。完整边界与回滚见[兼容补丁](docs/ui169/DSH_COMPANION.md)。

## 运行前检查

按实际安装位置配置以下可选环境变量；值必须为绝对路径：

```powershell
$env:DESIGNCRAFT_BROWSER_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:DESIGNCRAFT_FFMPEG_DIR='C:/Tools/ffmpeg/bin'
$env:DESIGNCRAFT_DSH_ROOT='C:/Tools/dsh/node_modules/@deepseek-ai/dsh'
node scripts/doctor.mjs
```

以上路径是配置格式示例，请使用您的真实目录。浏览器也支持指向含其可执行文件的目录；FFmpeg 目录必须同时包含 ffmpeg.exe、ffprobe.exe。未指定浏览器或 FFmpeg 时按 PATH 和系统安装位置发现，不使用开发机固定路径。明确配置的无效路径会直接报错，不悄悄换用另一安装。

统一 doctor 校验平台、Node、DSH 包及其 Node 要求、当前发布清单、7,721 个文件的 SHA256，以及浏览器、FFmpeg 和 FFprobe 的实际版本。检查浏览器时使用独立临时 profile 和无窗口参数。看到 `readyForDsh=true` 后可在 DSH 中加载。

`node scripts/motion-doctor.mjs` 只检查动画运行环境；`node scripts/doctor.mjs --source-only` 只检查源码/清单元数据，输出不会宣称可直接启动完整插件。

## 在 DSH 中加载

使用 DSH 支持的插件配置，将已有 `designcraft` 包指向该安装目录，并保留 `cordis.patch.yml`。不要把包名、工具名和持久化目录改成另一个名字；Urania 是显示名称。

本轮真实隔离验收采用一个独立 DSH profile，其 `package.json` 的 `dsh.profile.bundles` 在基础 DSH bundle 后包含 `designcraft`，profile 的 `node_modules/designcraft` 指向安装目录。通过 SDK 的 `lib/bin.js --profile <独立profile名> --no-open` 启动。普通使用者应通过自己的 DSH 插件安装/配置流程加载，不要复制验收 probe、凭据、测试 profile 或会话。

更新已经加载的插件时，先保存作品，再使用 DSH 的正常后台重载或重新打开应用。插件后台与前端都应显示 UI169。可在「更多操作 → 设计诊断与帮助」核对当前运行状态。

## 安装失败、中断与回滚

恢复过程先校验 ZIP 和所有文件，在 `.urania/` 内暂存，再一次写入完整恢复计划，之后才更改安装文件。目录穿越、重复 ZIP 项、符号链接/junction、大小或摘要不符都会拒绝。路径核验使用 .NET 文件属性，仍逐级检查已存在的父目录。

若安装进程意外退出，使用原命令和同版原 ZIP 再运行。脚本先根据 write-ahead journal 回滚未完成的安装，再重试；不会在后台继续使用上一任务的临时文件。若有人在中断后改过运行文件，脚本保留原件和备份并报出冲突，不覆盖不认识的版本。

成功后可重复验证：

```powershell
pwsh -NoProfile -File scripts/restore-runtime.ps1 -VerifyOnly
```

切回旧版时，将该旧版**全部源码/锁/运行时**恢复为同一发布，重新运行其对应校验；不要用 UI165 的清单覆盖 UI163 的安装。安装备份保留在 `.urania/runtime-backup-<transactionId>`；清理前先核对目录、摘要和对应事务。项目源、版本历史、人工草稿都不属于该脚本的恢复目标。

## 验证与已知边界

当前源码的全量命令是 `npm test`、`npm run check`。全量测试还需要对应 DSH SDK，可用 `DSH_TEST_PACKAGE` 指向其真实 `package.json`；它不随公开源分发。公开门使用 `npm run test:public`、`npm run check:public`，不冒充 DSH/原生集成验收。CI 不缓存或上传大型运行 ZIP。

安装验收使用同一台 Windows 机器的干净目录、独立 DSH profile 和无窗口浏览器。UI169 结果见 [本轮验收记录](docs/ui169/VERIFICATION.json)。归档错误拒绝、进程中断与恢复的回归用例在 [UI165 验收记录](VERIFICATION_UI165.json) 中。

六页PPTX已有PowerPoint原程序逐页验收证据，本轮要求干净安装包再次导出并匹配其完整SHA256，详见 [逐页记录](docs/ui168/powerpoint/REVIEW.md)。历史审计附件见 [附件目录](docs/verification/ui165-attachments/README.md)。
