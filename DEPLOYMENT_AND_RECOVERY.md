# Urania UI165 部署与恢复

适用版本：`designcraft@1.3.0-dev.150`，UI165，Windows x64。现有作品保存在各项目的 `design/.designcraft/`，升级插件不应移动或覆盖这些目录。

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

## 从公开源码安装

检出需要的版本，先阅读 `release/runtime-assets.json`。源码、插件包和运行时必须属于同一版本。普通 Git 中没有大型 EXE/DLL/WASM，也没有开发依赖目录。

在仓库根目录执行：

```powershell
pwsh -NoProfile -File scripts/restore-runtime.ps1 -Download
```

该命令只下载清单固定的 Urania GitHub Release ZIP，支持保留 `.part` 文件后续传；只有整个 ZIP 的大小和 SHA256 正确才会解包。也可使用已下载的离线原包：

```powershell
pwsh -NoProfile -File scripts/restore-runtime.ps1 -ArchivePath C:/Downloads/urania-runtime-win-x64-ui165-20261118.zip
```

当前包包含 7,713 个有逐文件摘要的运行文件，其中 7,447 个属于固定的 HyperFrames SDK 及传递依赖。它们从同一校验包离线恢复，不需要在用户项目中执行 `npm install`。原生兼容文件、源码、字体和许可一并保留。ZIP 约 1.32GB，展开的清单文件约 3.23GB；它不是普通 CI 构建产物。

从发布的插件 TGZ 安装时，保留同版 `release/` 与 `scripts/`。npm 打包会排除嵌套 `node_modules`，因此也要运行上述恢复命令补齐固定 SDK；不能把“TGZ 已解包”当成所有运行依赖已经安装。

## 运行前检查

按实际安装位置配置以下可选环境变量；值必须为绝对路径：

```powershell
$env:DESIGNCRAFT_BROWSER_PATH='C:/Program Files/Google/Chrome/Application/chrome.exe'
$env:DESIGNCRAFT_FFMPEG_DIR='C:/Tools/ffmpeg/bin'
$env:DESIGNCRAFT_DSH_ROOT='C:/Tools/dsh/node_modules/@deepseek-ai/dsh'
node scripts/doctor.mjs
```

以上路径是配置格式示例，请使用您的真实目录。浏览器也支持指向含其可执行文件的目录；FFmpeg 目录必须同时包含 ffmpeg.exe、ffprobe.exe。未指定浏览器或 FFmpeg 时按 PATH 和系统安装位置发现，不使用开发机固定路径。明确配置的无效路径会直接报错，不悄悄换用另一安装。

统一 doctor 校验平台、Node、DSH 包及其 Node 要求、当前发布清单、7,713 个文件的 SHA256，以及浏览器/FFmpeg/FFprobe 实际版本。检查浏览器时使用独立临时 profile 和无窗口参数。`readyForDsh=true` 表示这些预检通过，不表示替用户完成了模型服务或物理桌面验收。

`node scripts/motion-doctor.mjs` 只检查动画运行环境；`node scripts/doctor.mjs --source-only` 只检查源码/清单元数据，输出不会宣称可直接启动完整插件。

## 在 DSH 中加载

使用 DSH 支持的插件配置，将已有 `designcraft` 包指向该安装目录，并保留 `cordis.patch.yml`。不要把包名、工具名和持久化目录改成另一个名字；Urania 是显示名称。

本轮真实隔离验收采用一个独立 DSH profile，其 `package.json` 的 `dsh.profile.bundles` 在基础 DSH bundle 后包含 `designcraft`，profile 的 `node_modules/designcraft` 指向安装目录。通过 SDK 的 `lib/bin.js --profile <独立profile名> --no-open` 启动。普通使用者应通过自己的 DSH 插件安装/配置流程加载，不要复制验收 probe、凭据、测试 profile 或会话。

更新已经加载的插件时，先保存作品，再由用户自行使用 DSH 的正常后台重载或重新打开应用。插件后台与前端都应显示 UI165；“更多操作 → 设计诊断与帮助”可查看当前状态。不能凭磁盘版本判断一个未重载的窗口已经运行新版。本轮没有重启或操作用户的 DSH 窗口。

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

本轮在当前 Windows 机器的干净独立源目录中实际执行了错误 ZIP 拒绝、安装进程中断、恢复、全部文件摘要复核、幂等 VerifyOnly、统一 doctor 和恢复后真实 SDK 编辑。它不是另一台物理电脑的测试。实际证据见 `VERIFICATION_UI165.json` 与 `docs/verification/ui165-closeout/`。

PowerPoint 原程序的逐页视觉验收、所有输入媒体/外部 API 的可用性不在本轮已验证范围。六个字体来源和新转换器构建来源已闭合；仍有 3 个历史旧源码快照未找到原件，其旧摘要不改写，也不作为本版功能验收依据。
