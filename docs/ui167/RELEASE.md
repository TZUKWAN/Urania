# Urania UI167 候选版

工作区和 DSH 外壳共用更接近的底色，字号、留白和控件按阅读顺序调整。Photo 和 Deck 打开作品时自动适配画布。Deck 在简洁模式缩窄左侧页轨。主画布把常用选区操作收在底部，上方保留作品历史、导入和导出。图集同时保存工具栏、选区指令、历史作品、属性面板及夜间状态。 [图集](GALLERY.md)

实际验收涵盖鼠标拖宽及键盘调宽、关闭对话后保留作品、Vector 多选及意见草稿延续、独立设计对话、历史作品独立副本、Photo 真实框选、Deck 六页原生预览和 Motion 编辑时间轴。录屏来自同一隔离环境中操作实装 DSH 的浏览器。 [验收记录](VERIFICATION.json)

Windows 本机 Deck 支持使用微软雅黑常规和粗体预览。PPTX 保留可编辑文字和原字体名称。运行时里的新增 Deck Web 构建由原锁定版本及 [Rust 源码补丁](deckcraft-display-font.patch) 生成。固定源修订为 `4ce2944630b04188dee8504c14151994d06c416a`，对应原生源码见 [源归档](../engine-source-snapshots-ui165.zip)。编译使用 Rust 1.95.0 的 `wasm32-unknown-unknown` release 目标、`wasm-bindgen 0.2.129` 和 `wasm-opt version_123 -Oz`。工具链、输入与产物摘要见 [运行时锁](../../web-runtime-lock.json)。

Motion 导出实际渲染了《Glass Garden》，1920×1080、240 帧、30 fps，包含三个镜头段落、五条轨道、13 个可见关键帧及两条原创合成音频素材。导出的工程已重新导入，HTML、CSS、音频摘要与初次导入一致。FFprobe 核对 H.264 和 AAC，PCM 解码取得两条素材的独立频率证据。 [验收记录](VERIFICATION.json)

UI165 到 UI166 的 452→439 差额来自两个 DSH 合约测试文件未进入 UI166 执行清单，少 14 项，另新增 1 项历史副本用例。UI167 恢复两个原测试文件。31 条旧公开摘要已重新核对，另补录 11 项原审计附件。三个更早的源代码快照仍缺原件。 [旧审计附件和摘要](../verification/ui165-attachments/README.md)

最终真实流式样本的 P95 为 33.4 ms，长帧仍可出现。稳定 60 Hz、PowerPoint 桌面原程序预览和实际物理桌面体验尚未验收。 [性能报告](PERFORMANCE.md)
