# Urania

DSH 内的 AI 原生设计工作空间：Photo 图片、Vector 矢量、Deck 演示和代码动画。选中对象、多选或框选后向 AI 提修改要求；原生能力由 AI 调用，源文件、人工修改和非目标对象受到版本/选区/回执保护。对话分栏支持拖动，历史作品可搜索打开，图片 API 独立配置。

当前版本为 `designcraft@1.3.0-dev.151`（UI166）。首页提供 Photo、Vector、Deck 和代码动画四种入口。顶栏可收起 AI 对话，画布旁可查看对象属性。用「历史作品」打开设计、核对修订或打开独立副本。

交互、视觉和验证见 [UI 重构报告](docs/ui-redesign/UI_REDESIGN_REPORT.md)、[设计系统](docs/ui-redesign/DESIGN_SYSTEM.md)和 [本轮回归结果](docs/ui-redesign/REGRESSION.json)。[UI165 验收记录](VERIFICATION_UI165.json)保留为上一版本证据。

支持 Windows x64。插件和动画 Worker 需要 Node ≥22，验收使用的 DSH SDK 0.2.2-rc.1 需要 Node ≥24.9。动画预览和导出需要 Chromium ≥120、FFmpeg 和 FFprobe ≥6。UI166 使用经 `release/runtime-assets.json` 固定的原生运行时归档。

```powershell
pwsh -NoProfile -File scripts/restore-runtime.ps1 -Download
node scripts/doctor.mjs
```

请将正常 DSH 插件配置中的 `designcraft` 指向已恢复的目录。详细步骤见[部署、配置与恢复](DEPLOYMENT_AND_RECOVERY.md)。

Figma、Stitch、PixelBin 等已放弃外部服务不是核心依赖；麦克风、摄像头、截图和 Windows 公式识别不恢复。56个旧证据原件恢复，3个旧源码快照未找到且未伪造。原有历史报告不作为当前验收的替代。

自有代码 MIT；第三方软件、AGPL 材料、字体和资源保留各自许可，见 THIRD_PARTY_NOTICES.md 与 licenses/。兼容包名、工具名和项目存储路径继续使用 designcraft。
