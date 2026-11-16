---
name: designcraft-motion
description: Urania — DSH 中的代码动画创作：用 designcraft_motion 工具创建/编辑/预览/渲染 HTML/CSS/JS 动画工程，导出实际 MP4 和可编辑 .dcmotion。
whenToUse: 用户要求做动画、视频、动效、开场动画、数据可视化动画；或要求导出 MP4。
---

# DesignCraft 动画制作

你通过 `designcraft_motion` 工具操作动画工程。用户描述需求，你编写 HTML/CSS/JS 代码，工具负责存储、预览和渲染。

## 工具状态优先

每次修改前先 `list_projects` 或 `open` 读取当前 state。`create` 和 `write_sources` 需要 `operationKey`（稳定的操作标识，相同 key 相同输入不会重复执行）。`write_sources` 需要 `baseRevision`（从上一次返回获取）。预览自动通过 lease 建立。

## 动画编写规则

1. 根元素需要 `data-composition-id`、`data-duration`（秒）、`data-width`、`data-height`。
2. 每个需要 AI 编辑的元素加 `data-hf-id="hf-<slug>"`。
3. `data-start` 和 `data-duration` 是元素**可见窗口**（秒），不是动画时长。元素在窗口外被隐藏。动画进度用 CSS `@keyframes` + `animation: <name> <duration> <timing> <delay> both`。
4. 所有动画状态必须是帧时钟的纯函数——禁止 `Date.now()`、`requestAnimationFrame` 计时、无种子随机数。用固定 seed 的伪随机（如 mulberry32）。
5. 中文文本使用 `font-family:'Noto Sans SC','Microsoft YaHei',sans-serif`。
6. 工程文件仅限 HTML/CSS/浏览器 JS。不能使用 Node.js API、npm 包、外部 CDN 或远程资源。

## 帧时钟契约

预览与渲染都通过 `window.__hfSeek(timeMs)` 把合成确定性地推进到任意时刻；实时预览用 `__hfPlay()`/`__hfPause()` 原生播放/暂停（自动循环），并向父窗口回报 `{source:'hf-preview', t, duration}`。默认模板自带这段运行时：**修改 composition.html 时必须保留它**（可增删元素与 CSS，勿删 `__hfSeek/__hfPlay/__hfPause` 与可见窗口逻辑）。合成可覆盖 `__hfSeek` 实现自定义时间线（如 canvas/JS 动画），但必须保持纯函数语义——渲染 worker 逐帧调用它后截图；覆盖 `__hfSeek` 时也要提供 `__hfPlay/__hfPause`，否则预览无法播放。

## 音频（导出会混入 MP4）

用 `<audio src="assets/xxx.mp3" data-start="秒" data-duration="秒" data-volume="0~1" preload="auto"></audio>`（放在 body 任意处）加音轨：
- `data-start`：音轨从合成的第几秒进入（0 = 开头）。`data-duration`：截取多长（不写 = 整个文件）。`data-volume`：0~1，默认 1。
- 音频文件必须是**工程本地资产**（同项目目录内相对路径），禁止远程 URL。多轨会自动混音（amix）。
- 导出时 worker 自动扫描这些标签混入 AAC；浏览器拦截自动播放时预览会提示"点击画面开启声音"。

## GSAP 时间线（可选进阶）

允许把 gsap.min.js 作为本地资产引入（放入工程目录后 `<script src="gsap.min.js">`，禁止 CDN）。使用 GSAP 时必须遵守（预览与渲染的时钟会直接驱动这个时间线）：
```js
window.__timelines = window.__timelines || {};
window.__timelines['dc'] = gsap.timeline();   // 'dc' = data-composition-id 的值
// 主时间线规则：真实秒创作、timeScale 恒为 1、总时长必须等于 data-duration、不加 repeat/delay
```
违反规则的合成预览会提示错误且不播放。无 GSAP 时默认走 Web Animations 时钟（CSS keyframes/WAAPI），两种方式不要混用同一元素。

## 修改流程

1. `open` 打开工程 → 获取 leaseId + baseRevision
2. 局部修改优先用 `write_sources` 更新受影响的 HTML/CSS 文件
3. 完成后告知用户预览效果

## 渲染

用户确认后用工具执行渲染。渲染是长任务（约 20 分钟上限），有进度回执。渲染完成后自动做帧数/尺寸/编解码验证，验证通过才发布。

## 创作参考库（复用 nexu-io/open-design，Apache-2.0，见 licenses/MotionTemplates-ATTRIBUTION.md）

写复杂动画前先读 `skills/designcraft-motion/references/`：
- `huashu-explainer-grammars.md` — 九种解说动画语法（3Blue1Brown 数学可视化、产品演示等），长篇解说/科普视频首选套路
- `motion-lab-basic.md` / `motion-lab-advanced.md` / `motion-lab-interaction.md` — 动效编排基础/进阶/交互三卷
- `oil-motion-SKILL.md` — 讲解型动画工作流（分镜→元素→时间线）
- `ui-animation-choreography.md` / `ui-animation-clip-path.md` / `ui-animation-code-output.md` — 编排节奏、clip-path 技法、代码输出规范

## 内置模板（action=templates 列表 / create_from_template 创建）

工程级模板复用自 heygen-com/hyperframes registry（Apache-2.0）：
- `frame-kinetic-type`（15s GSAP 动态排版宣传片）· `frame-product-promo-30s`（30s 产品宣传片，8 幕含音效与配乐）——**完整 GSAP 时间线工程，AI 应优先在模板上改文案/换图而非从零写**
- `frame-glitch-title` / `frame-logo-outro` / `frame-liquid-bg-hero` / `frame-data-chart-nyt` — 静态设计帧（标题/片尾/背景/数据图）
模板里的字体、资产都是工程本地文件，可直接替换；组合内联已完成，无需处理 data-composition-src。

## 限制

- 不支持：TTS、AI 视频生成、云渲染、4K/HDR/透明视频、GIF、多轨手动剪辑器
- 帧：24/25/30fps，最长 180 秒，最大 1920 边长
- 图片/视频/音频资产从项目本地上传，不用付费 API
