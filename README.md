# Urania

AI 原生的 DSH 设计插件，把图片、矢量、PPT 与代码动画放在同一个设计工作区。用户描述需求或选中画面对象后，让当前项目的设计 AI 调用底层编辑能力。

当前公开快照：`designcraft@1.3.0-dev.148`，UI **163**，Windows x64。插件内部的 `designcraft` 名称与工具 ID 保留兼容。

## 项目范围

- 项目专用 AI 设计会话；对话与画布宽度调整、历史作品、选区 AI 输入。
- 图片、矢量与演示文稿的底层编辑、版本保存、导入导出。
- HTML/CSS/JavaScript 代码动画、预览时间轴、动画模板与本地视频渲染接入。
- 独立生图 API 配置、受作用域保护的 AI 工具与本地素材管理。

这是上传时的**开发快照**。本次公开操作检查了发布内容、凭据、文件摘要与远端上传，没有重新运行功能验收。既有开发记录仍列有 DSH 桌面重新加载后的动画完整流程待验收；不要把本仓库的存在理解为所有桌面功能已验收。详见 [公开范围说明](PUBLICATION.md)。

## 获取工程与运行文件

```powershell
git clone https://github.com/TZUKWAN/Urania.git
cd Urania
```

编译运行文件体积较大，在 [匹配的开发 Release](https://github.com/TZUKWAN/Urania/releases/tag/dev-ui163-20261116) 提供：

1. 下载 `urania-runtime-win-x64-ui163-20261116.zip`、`runtime-manifest.json` 与 `SHA256SUMS.txt`。
2. 用 `Get-FileHash -Algorithm SHA256` 核对 ZIP 摘要，或对照仓库 [运行文件清单](release/runtime-assets.json)。
3. 将已核验 ZIP 解压到本仓库根目录，恢复 `runtimes/` 中的文件。附带的兼容版本保留原文件身份。

该附件不包含 DSH 应用、私人 SDK/profile、node_modules、系统 Node/Chromium 缓存或外部 FFmpeg。主插件声明 Node >=18；动画 worker 的依赖要求 Node >=22。按所用 DSH 版本的本地插件加载方式加载本目录。动画依赖锁位于 `runtimes/motion-worker/package-lock.json`，可在该目录运行 `npm ci`；FFmpeg 作为外部程序配置。

## 目录

| 目录/文件 | 内容 |
| --- | --- |
| `client/` | 设计对话、画布、选区与动画界面 |
| `host/` | DSH 插件、作用域、存储、工具、原生及动画适配 |
| `runtimes/`、`motion-worker/` | 运行适配器、源文件、依赖锁和编译运行文件的元数据 |
| `resources/`、`skills/` | 固定资源、模板及 AI 制作指令 |
| `tests/` | 源码中的测试与明确的测试输入；本地缓存不公开 |
| `docs/engine-source-snapshots*.zip` | 原生引擎源码快照，来源/范围以锁文件和审计说明为准 |
| `runtime-lock.json`、`web-runtime-lock.json`、`motion-runtime-lock.json` | 固定版本、来源和摘要 |
| `SOURCE_SNAPSHOT.json` | 本次公开源文件清单与摘要 |

## 开发检查

现有入口为 `npm test`、`npm run check`；部分检查需要匹配 DSH 版本的 SDK、已恢复运行文件及本地依赖。私人 DSH SDK 不随仓库分发。本次上传没有将这些命令报告为新执行通过。

## 许可

自有代码见 [LICENSE](LICENSE)。第三方引擎、OpenDesign、HyperFrames、OpenMontage、字体及素材保留各自许可与声明，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 `licenses/`。MIT 不会覆盖第三方 AGPL 或资产条款；实际来源和修改记录一并保留。
