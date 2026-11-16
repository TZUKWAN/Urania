# 五类代码缺口与 Deck 五入口：UI150 代码交付

本轮按刘总授权补代码，功能验证暂缓。当前代码不新增原版 OD/Vela 授权图库、Figma、Stitch、PixelBin、fal/Replicate/Venice 音视频等外部接入。

| 单元 | 已写代码和实际接线 | 未执行的验证 |
| --- | --- | --- |
| K1 动态中文 | Deck hosted 显示分支新增 130 个动态文案位点，变量、文档内容、命令 ID 保留；含原有固定文案 | 界面、语言与视觉检查 |
| K2 图片与计划 | 图片工作区可选已保存计划及精确修订；任务签名、候选、原生源和项目包保留 SHA-256 追溯；对话 start payload 接受 planId/planRevision | 生图、重绘、候选采用及项目包 |
| K3 中文简报 | 默认解析器 v2 识别列明的中文风格、配色、字体、排版、密度和否定约束；冲突要求明确选择；旧任务仍用原字节 v1 解析器 | 语义与保存恢复 |
| K4 旧资源 | 按项目/资源身份留存创意指导原包，读取旧包与旧 dependencies；预览后显式迁移为新计划版本，多版本随项目包导出 | 跨版本恢复和迁移 |
| K5 本地 OD | APCA、OKLCH、完整已保存原生结构颜色审计；当前 DSH 会话的规则、计划、实际产物、报告与结束状态编排 | 数值、工作流、文档及模型执行 |
| D1 墨迹文字 | 当前选中笔迹 → Windows Ink 实际识别 → 可校正候选 → 原生文字框与保存；保留原笔迹与撤销历史 | 系统组件、识别准确度与原位保存 |
| D2 墨迹公式 | 原笔迹 → Windows Math Input Control → 实际 MathML → 支持结构的 OMML → 原生可编辑公式；不能保真转换时拒绝写入 | 数学组件、公式显示与 PPTX |
| D3 截图 | 用户主动浏览器屏幕/窗口选择，或明确点击 Windows 区域框选；实际 PNG 候选确认后插入 | 屏幕权限、不同 DPI、多屏和导出 |
| D4 旁白 | 主动麦克风权限与真实 PCM 采样，WAV 试听后插入本页媒体，设置自动播放与非播放隐藏 | 设备、音频、放映和 PPTX |
| D5 摄像头 | 主动打开预览，拍照或录制实际 MP4/WebM，保存实际视频帧封面和媒体对象 | 设备、编码器、放映及外部播放器 |

## 当前 DSH 会话的本地工作流

使用 `designcraft_resources workflow_catalog` / `workflow_prepare` 创建真实规则、计划与工作记录，`workflow_read` 分页返回规则；`workflow_status` 返回精确身份。界面“放入当前 DSH 输入框”只插入草稿，不自动发送。当前 DSH 模型通过已有专业工具创作，再 `workflow_attach` 指定已保存的 native/HTML 源和精确版本，或 `workflow_publish_html` 写入实际文件，`workflow_publish_report` 写入实际报告。`workflow_complete` 要求规则已返回模型且有有效关联的真实保存产物。读取/关联/完成状态均不证明模型遵循规则或作品视觉合格。

只有目录说明的入口须先保存真实上游原包并明确规则文件；系统拒绝以介绍文件当作完整技能。此实现复用当前 DSH 模型和现有编辑器，不运行第三方脚本，不另起第二个模型代理。视频、浏览器克隆、PR 等额外工作流不在本轮设计产品范围内。生成和决策由当前模型承担，没有固定图稿、假报告或占位产物。

规则分页交付只由实际对话工具读取登记；面板人工查阅不会记为模型已读。状态、源文件、规则和报告字节随项目包核对；已停用计划关联仍保留历史，并单列为无效声明。中断后可读取原记录；只允许恢复死进程遗留写锁；不自动重发图片付费请求。

## 颜色审计边界

Color.js 0.5.2 官方 npm 包固定到 `host/vendor/colorjs`，记录包 SRI、逐文件 SHA-256 和 MIT 许可；没有生命周期脚本。两色对比维持 WCAG 2.2 原公式，APCA 返回有正负极性的 0.0.98G 指标，不能称 WCAG 3 合规。颜色空间转换支持 OKLCH/OKLab/sRGB/线性 sRGB/Display P3。

整稿入口要求当前原生源已保存，读取 Vector 的完整 document、Photo 的 manifest.json 或 Deck 的 presentation.json，保留原生源和结构摘要；不以有数量上限的 UI 摘要代替。遍历实际文字和颜色，明确报告无法解析的主题色、复杂背景、透明、栅格、遮挡及未知文字度量。它是完整源结构检查，不能代替像素级无障碍验收。结构/解压超过预算时明确失败，不截断后称完成。

## 本地输入和恢复

Windows x64 helper 仅在产品用户主动点击识别/区域截图后启动；编译期不运行。文字需系统 Windows Ink 组件；公式需 Math Input Control，系统识别窗由用户确认实际结果。屏幕框选 Esc 取消。麦克风最长 5 分钟或 48 MiB，摄像头录像最长 2 分钟或 48 MiB。取消、离开、切换、失败时释放设备；生成候选不会自动改源。

提交核对原工作区、源、epoch、内容修订和选区；写入后保存失败保留已应用状态，重试仅保存，不重复插入。浏览器摄像头/麦克风权限、系统组件及编解码器受具体宿主和 Windows 环境影响；不伪造识别或媒体来掩盖不可用。Cameo 是幻灯片上的真实照片/视频对象，本轮没有实现直播摄像头放映。

## 交付证据与剩余事项

源码和文件证据见 `five-gaps-code-audit.json`、`hosted-ui-source-audit.json`、`native-source-input-audit.json`、`dependency-license-audit.json`。Deck host16 为真实 Rust/Trunk release 构建；新旧源码快照分开保留。Windows helper 为实际 C# 编译产物，源码、EXE 和加载摘要一致。JS 只执行语法与静态引用检查；没有运行产品模块、识别器、硬件、界面、模型或服务测试。

本轮十个代码单元的功能验收仍待刘总通知。原转换器完整构建来源、WOFF2/Brotli 准确修订、字体参考差异和历史证据缺档独立保留，不能因本次补代码而抹去。用户当前 DSH 加载版本未知，未控制电脑、重启 DSH 或激活开发包。

资料：[Microsoft Math Input Control](https://learn.microsoft.com/en-us/windows/win32/api/micaut/nn-micaut-imathinputcontrol)、[LoadInk](https://learn.microsoft.com/en-us/windows/win32/api/micaut/nf-micaut-imathinputcontrol-loadink)、[Ink recognition](https://learn.microsoft.com/en-us/windows/uwp/ui-input/convert-ink-to-text)、[Color.js 对比算法](https://colorjs.io/docs/contrast)、[CSS Color 4](https://www.w3.org/TR/css-color-4/)。
