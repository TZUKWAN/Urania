# Urania UI166 工作台重构

UI166（`designcraft@1.3.0-dev.151`）把 Photo、Vector、Deck 和 Motion 放进同一套 DSH 工作台。创作围绕画布与专用 AI 对话展开。原生编辑器继续保存可编辑文件，素材与 AI 意见继续使用源版本、选区和操作回执。

- [设计系统](DESIGN_SYSTEM.md)记录颜色、字号、间距、控件和动效。
- [基线审计](UI_AUDIT.md)和[设计方向](DESIGN_DIRECTION.md)记录参考资料、三种设计路线和选择依据。
- [前后界面对照](media/ui165-ui166-comparison.jpg)为同一组测试作品在真实 DSH 中的截图。[35 秒操作录像](media/ui166-interactions.mp4)剪自实际操作，包含选区、历史、时间轴和渲染状态。
- [回归结果](REGRESSION.json)记录当前版的命令、关键链路、运行环境和证据摘要。

## 逐项变更

| 原界面问题 | 本轮实现 | 文件 |
| --- | --- | --- |
| 首页入口少，动画进入后与设计割裂 | 首页直达四类创作，可自定义尺寸、导入、从 AI 开始和打开最近作品。设计与动画使用同一个轻量顶栏、同一个项目的 AI 对话。 | `client/ui.js`、`client/studio-system.js`、`client/studio-panels.js` |
| 工具争抢画布空间，对话分栏缺少收起状态 | AI 对话可收起展开，鼠标拖动或方向键调整宽度。分栏宽度持久化。宿主原有对话组件、附件、发送与设计会话继续工作。 | `client/chat-split.js`、`client/ui.js`、`client/dsh-context.js` |
| 选区与 AI 操作范围不够明显 | 在真实选区旁打开输入框，显示目标和数量。扩大选区时保留正在输入的意见，有既有对话草稿时将新意见放入草稿。当前范围通过持久化引用发给 AI。 | `client/selection-ai.js`、`client/ai-canvas.js`、`client/design-feedback.js` |
| 已完成的 AI 意见缺少直观的核对入口 | 一次真实保存回执对应修改前、后图片，可确认结果，或打开修改前源的独立副本继续编辑。确认写入项目意见记录。Deck 可按具体幻灯片的原生 ID 对比。 | `client/native-workspace.js`、`host/editor-routes.js`、`host/design-feedback.js` |
| 编辑工具与文件操作混在一起 | 顶栏保留常用操作，画布使用浮动缩放工具。右侧按实际选择显示图层、对象、页面及上下文属性。专业编辑调用原生工具，适应画布通过相应引擎执行。 | `client/studio-panels.js`、`client/native-workspace.js`、`client/native-controller.js` |
| 图片方案要逐个打开查看 | 对比两个真实候选或重绘前后。候选的预览及可编辑原件由原有完整性校验提供。当前原图版本与候选的目标一致时可采用，其他候选可以独立打开。 | `client/studio-image-workspace.js` |
| 历史作品和素材入口难找 | 历史作品提供关键词、类型、真实缩略图和时间，也支持浏览历史、打开独立副本。素材卡片提供来源、使用处、当前作品置入及动画传递。 | `client/native-workspace.js`、`host/native-source-store.js`、`host/editor-routes.js` |
| 动画只有简易进度条 | 时间轴显示实际片段、层次、关键帧、时间和帧率，并支持选取、拖动、预览缩放、取消及重试。渲染成功由真实任务的生成回执驱动，视频可以下载。 | `client/motion-workspace.js`、`client/motion-preview.js`、`client/actions.js`、`host/motion/preview-protocol.js` |

## 视觉迭代

使用 Windows x64 上的隔离 DSH 浏览器检查 1280×720、1440×900、1920×1080 三个尺寸。基线保存 20 张，改造三轮分别保存 21、21、24 张。每轮打开实际作品并绘制原生预览。截图中的文案和素材来自测试项目。

1. 确立统一导航、首页和状态颜色，压缩重复提示，让画布留出完整空间。
2. 打磨 Motion 的预览比例、原生帧刻度、片段和导出状态。狭窄布局下将次要操作压缩成有名称的图标按钮。
3. 核查 Photo 与 Deck 专业视图、画布缩放和对象属性。历史入口补充可见名称，并等待实际缩略图加载。中文单选和多选、真实模型执行和修改结果、图像候选、错误提示及取消重试均另存场景证据。

## 验证范围

- 当前源码和固定的 Windows 运行时在隔离 DSH 加载。运行时包含 7,713 个逐文件核对的归档项。部署见[部署、配置与恢复](../../DEPLOYMENT_AND_RECOVERY.md)。
- Photo 候选测试使用之前真实图像服务返回的两张生成图与一张选区重绘图，逐字节核对归档，在 UI166 打开比较和可编辑原件。本轮图片比较没有消耗新请求。文本模型及 Deck 局部修改使用本轮真实 DSH 对话、原生工具与保存回执。
- 交互性能使用 Windows headless Chromium、SwiftShader 和实际操作采样。帧时间是此环境下的观测，设备、图层复杂度和内容长度会影响性能。IME 核对使用浏览器原生合成事件。PPTX 验证覆盖可编辑文本与源版本回执，PowerPoint 客户端视觉渲染另有环境依赖。
