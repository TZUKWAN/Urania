# Urania

DSH 内的 AI 原生设计工作空间：Photo 图片、Vector 矢量、Deck 演示和代码动画。选中对象、多选或框选后向 AI 提修改要求；原生能力由 AI 调用，源文件、人工修改和非目标对象受到版本/选区/回执保护。对话分栏支持拖动，历史作品可搜索打开，图片 API 独立配置。

当前交付代码：`designcraft@1.3.0-dev.150`，UI165。完成本轮审查的运行环境、路径约束、取消/性能、四引擎协作、Deck 样式、意见恢复与多选草稿、离线恢复和来源核对。

本轮 `npm test`：452 项 Node + 19 项客户端通过，`npm run check` 通过。真实隔离 DSH、原生编辑器、两轮现有 GLM 连续流程及实际 MP4/工程导出已有当前证据。没有操作用户桌面或重启其 DSH；逐项边界见 [验收记录](VERIFICATION_UI165.json)。

Windows x64；插件/Worker Node>=22，实际验收 DSH SDK0.2.2-rc.1 要求 Node>=24.9。浏览器>=120、FFmpeg/FFprobe>=6。运行文件从同版 Release 逐文件校验恢复，固定 SDK 依赖离线包含：

```powershell
pwsh -NoProfile -File scripts/restore-runtime.ps1 -Download
node scripts/doctor.mjs
```

见 [部署、配置与恢复](DEPLOYMENT_AND_RECOVERY.md)、[问题审计](AUDIT_UI165.md)、[修改记录](FIX_LOG.md) 与 [交付说明](DELIVERY_SUMMARY.md)。最终归档、提交、PR 和发布读回摘要由相邻 DELIVERY.json 记录。

Figma、Stitch、PixelBin 等已放弃外部服务不是核心依赖；麦克风、摄像头、截图和 Windows 公式识别不恢复。56个旧证据原件恢复，3个旧源码快照未找到且未伪造。原有历史报告不作为当前验收的替代。

自有代码 MIT；第三方软件、AGPL 材料、字体和资源保留各自许可，见 THIRD_PARTY_NOTICES.md 与 licenses/。兼容包名、工具名和项目存储路径继续使用 designcraft。
