# Motion 模板来源与许可（复用 nexu-io/open-design，Apache-2.0）

`resources/motion-templates/` 下的模板复用自 [nexu-io/open-design](https://github.com/nexu-io/open-design)
（Apache-2.0），其上游为 [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) registry
（模板本体 Apache-2.0；内联的 GSAP 3.14.2 为 GreenSock 标准许可，随模板一并保留）。

| 目录 | 来源 | 改造 |
|------|------|------|
| frame-kinetic-type | open-design `plugins/_official/video-templates/frame-kinetic-type` | 内联 `compositions/main-graphics.html`（原引擎缝合改静态内联） |
| frame-product-promo-30s | 同上 frame-product-promo-30s | 内联 8 个 `compositions/*.html`；保留 assets（含音频） |
| frame-glitch-title / frame-logo-outro / frame-liquid-bg-hero / frame-data-chart-nyt | 同上对应目录 | 原样（静态设计帧，无 GSAP） |

运行时兼容说明：我们的帧时钟运行时在预览服务端注入（`injectFrameRuntime`），模板原有的
`window.__timelines` 注册与 `data-composition-id` 契约与 DesignCraft 双时钟完全兼容，
多时间线驱动在 `host/motion/frame-runtime.js`。
