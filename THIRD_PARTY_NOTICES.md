DesignCraft 自有适配器、共同编辑器、进程启动器和版本化存储代码使用 MIT。

随包的 Windows x64 portable CLI 保留官方发布文件：

| 软件 | 版本 | 官方来源 | 许可 |
|---|---|---|---|
| PhotoCraft | 0.18.0 | https://github.com/storytold/photocraft/releases/tag/v0.18.0 | MIT OR Apache-2.0 |
| VectorCraft | 0.19.0 | https://github.com/storytold/vectorcraft/releases/tag/v0.19.0 | MIT OR Apache-2.0 |
| DeckCraft | 0.13.1 | https://github.com/storytold/deckcraft/releases/tag/v0.13.1 | MIT OR Apache-2.0 |

各运行时目录保留官方 LICENSE-MIT、LICENSE-APACHE、NOTICE 和随包第三方材料。字体、图标、PDF 后端等遵循各自许可；本插件没有取得 ArtCraft 商标所有权，也没有重画其标识。原始官方发布文件保持原样；另有明确标为 vectorcraft-host、photocraft-host、deckcraft-host 的 Rust 宿主源码修改与定制 Web 构建，其提交、源码散列、构建日志散列和字体来源记录在 web-runtime-lock.json。详细官方运行时来源与散列见 runtime-lock.json，第三方许可见各自目录中的 NOTICE/licenses 等文件。

原生图片来源身份使用 rust-random 项目的 getrandom 0.4.3（MIT OR Apache-2.0），Web 应用显式启用 wasm_js，调用浏览器 Crypto.getRandomValues。固定依赖与校验和保留在两个引擎的 Cargo.lock；完整许可和本地包来源元数据位于 licenses/getrandom-0.4.3/。来源身份不包含凭据，也不赋予项目访问权限。

OpenDesign 资源来自 https://github.com/nexu-io/open-design ，固定提交12d970eacc8971150e3c76470d2a9afe16dc2ed1，Apache-2.0。原始许可位于 resources/open-design/LICENSE，逐文件来源/散列位于同目录 lock.json；本插件的名称映射和令牌应用是新增适配代码，原始参考资料保持原样。

新增只读库的完整包文件索引位于 resources/open-design/library-index.json，索引散列位于 library-index.lock.json。library-cache 中的不可变 blob 通过该索引映射回原始路径、Git blob 散列与固定提交；按需获取的文件保留原文和各自声明，不自动执行代码。OpenDesign 内部分 SKILL 是外部项目的目录介绍，缓存这些介绍不代表安装、运行或重新授权了所链接的外部完整包；所需外部素材、字体和服务仍需在对应接入中单独核实。

OpenDesign 的 creative-director 目录项所指向的外部原包由 Serge Shima 创作，来源 https://github.com/smixs/creative-director-skill ，固定提交 ac06eb255371da35d1db0a146dbfcca8c8857543，采用 CC BY 4.0。完整许可、作者署名、文件身份及原包分别位于 resources/creative-director/LICENSE、NOTICE、source-lock.json 和 creative-director.zip。原包作为可读取的参考数据提供，其脚本不会自动执行；使用原包时应保留作者署名和许可。

其他由用户按需获取的外部 GitHub 原包保存在各自项目中，原包内保留实际文件、来源树和识别到的许可文件。许可文件的识别不证明它覆盖包内所有内容；字体、嵌入素材和其他依赖仍须按各自权利声明核对。插件不会自动执行这些原包脚本。

OpenDesign 的 canvas-design 目录项指向 Anthropic skills 仓库的 `skills/canvas-design`；本插件另行保留固定提交 2c5958ecac7cee2b583967a2c4981d0f4a75c579 中该目录的全部 83 个原文件，见 resources/canvas-design/canvas-design.zip 和 source-lock.json。技能目录附有 Apache-2.0 许可，原包附带的字体许可文件均已保留；其 54 个字体的内部元数据均声明 OFL 1.1，但 IBM Plex Serif 与 Instrument Serif 没有同名的随包许可文本。两套 Google Fonts 官方许可快照及逐文件摘要对照保存在 resources/canvas-design/font-license-references/，当前对照的六个字体文件与原包文件均非逐字节相同，故这些快照不是原包文件的精确来源证明。字体不会自动安装到系统。该固定快照不保证为上游最新版本，其提交对象、文件树和逐文件 Git 摘要用于来源核对，包内内容作为数据而非自动执行代码。 本轮补充：六个原字体已与 anthropics/skills 固定提交 e4bb5d960d87126ff3b3a8af1a104b7db67560ba 中的官方原文件逐字节核对一致，详见 licenses/canvas-fonts-exact-source.json。旧 Google Fonts 对照差异保留为历史事实，不再作为当前来源缺口；字体的 SIL OFL 条款独立于父技能 Apache-2.0。

OpenDesign 的 cloudflare-kumo 设计系统清单标明来源为 Cloudflare Kumo 的固定提交 0c5832575c99988917b81cd752002e10f3dc9c7a，MIT 许可及来源摘要保留于 licenses/opendesign-styles/。tom-modern 清单标明来源仓库但未固定其原始提交；同目录保留了该仓库 0ef8506584a1759ab8d6df163a48e8418b74fdec 的 MIT 许可快照，这不能证明 OpenDesign 所用内容的精确源修订。其他设计系统或字体的独立许可仍须按其实际来源核实。

网页转演示当前使用从 atharva9167j/dom-to-pptx 固定提交 c0447adc47d3bc734d017050834edf0941adc189 实际构建的 2.0.1 + urania.codec1（MIT）。pnpm 冻结锁、实际 Rollup 模块、完整原始许可、构建输入与输出摘要位于 resources/open-design/dom-to-pptx/ 和 licenses/dom-to-pptx-components/。WOFF2 来自 google/woff2@1bccf208bca986e53a647dfe4811322adb06ecf8，其实际 Git 子模块 Brotli 为 google/brotli@5b4769990dc14a2bd466d2599c946c5652cba4b2，均为 MIT；真实 Wasm 由 SDK-local Emscripten4.0.17 编译，Embind 包装基于 MIT 的 fonteditor-core2.6.3。新增补丁支持 Promise 初始化、释放向量、字体预算、SVG 类名和稳定浏览器路径。Emscripten、musl、libc++、libc++abi 与 compiler-rt 原始版权许可一并保留。两套独立依赖目录实际构建的 Wasm/UMD 摘要一致；npm 发布包内预构建依赖按其已验证包身份归档，不冒称逐个独立重建。旧 OpenDesign 包的来源缺口作为历史事实保存在 historical-open-design/，宿主不会加载它。

DSH 服务由运行本插件的 DeepSeek Harness 提供，没有把本机用户的配置、密钥、会话或 DSH SDK 副本加入发行包。隔离验证使用的 React/Playwright/Python 库属于测试环境，不是插件运行依赖。

UI169 性能兼容补丁在 `scripts/dsh-performance-patch.json` 中包含 SDK0.2.2-rc.1 的精确原生代码上下文与修改片段，采用 MIT，Copyright (c) 2026 DeepSeek；完整原始许可保留在 `licenses/dsh-native-components-MIT.txt`。它只处理显式选择且摘要匹配的 npm SDK，不分发完整 SDK。安装、作用域、全局等价 CSS 例外、还原方式和验收设备边界见 `docs/ui169/DSH_COMPANION.md`。

fal 实时通道使用 MessagePack Community 的 `@msgpack/msgpack` 3.1.3（ISC）。原始许可、固定 npm 包完整性和逐文件 SHA-256 保存在 `resources/vendor/msgpack-3.1.3/`；插件仅包含该包的 ESM 运行文件和许可，不运行安装脚本。该依赖及实时服务尚未进行功能验证。

Tailwind CSS 3.4.17 的官方 MIT 许可原文与来源摘要保存在 `resources/vendor/tailwind-3.4.17/`。Play CDN 脚本不随插件分发；兼容预览仅在用户主动启用时获取固定摘要的官方脚本。生成样式的其他依赖、模板和字体许可仍需按实际来源核对。

本次逐文件依赖与许可证据核对见 `docs/dependency-license-audit.json`；实际读取54个 canvas-design 字体的内嵌版权、版本和 OFL 声明，没有运行或安装字体。原包内6个字体与既有 Google Fonts 参考文件的字节差异继续保留，不把参考文件的摘要当成原包摘要。Deck host15 的577个中文显示键包含从同一固定 Craft 系列 MIT OR Apache-2.0 简体中文目录复用的词条和本次新增译文；输入目录摘要与修改源码列表见 `docs/hosted-ui-source-audit.json`。

## Color.js 0.5.2
Color conversion and APCA implementation by Lea Verou, Chris Lilley and contributors. MIT license; original source https://github.com/color-js/color.js/tree/v0.5.2. Pinned npm tarball and per-file hashes: host/vendor/colorjs/source-lock.json. Original license: host/vendor/colorjs/LICENSE. APCA 0.0.98G is an experimental contrast metric, not a WCAG 3 conformance assertion.

## 动画与代码视频模块（motion）

本模块使用以下第三方运行时与参考资料；固定版本、完整性哈希与采用范围见 `motion-runtime-lock.json` 与 `resources/motion-workflows/SOURCES.json`。

| 软件 | 版本 | 来源 | 许可 | 用途 |
|---|---|---|---|---|
| @hyperframes/sdk | 0.9.44 | https://registry.npmjs.org/@hyperframes/sdk/-/sdk-0.9.44.tgz | Apache-2.0（包内 LICENSE） | 编辑 SDK（受信任 worker） |
| @hyperframes/player | 0.9.44 | https://registry.npmjs.org/@hyperframes/player/-/player-0.9.44.tgz | Apache-2.0（包内 LICENSE） | 无特权预览 origin 内播放器 |
| @hyperframes/producer | 0.9.44 | https://registry.npmjs.org/@hyperframes/producer/-/producer-0.9.44.tgz | Apache-2.0（包内 LICENSE） | 渲染管线（受信任渲染 worker） |
| @hyperframes/core | 0.9.44 | https://registry.npmjs.org/@hyperframes/core/-/core-0.9.44.tgz | Apache-2.0（包内 LICENSE） | 共享组合核心 |
| OpenMontage | 提交 fecb9a1e3cc23ef84de30b272059457a427f16f8 | https://github.com/OpenMontageInc/OpenMontage | AGPL-3.0（licenses/motion/OpenMontage-AGPL-3.0.txt） | 仅最小阶段/资产 schema 采用；原件与后续适配/对应源随交付 |
| claude-motion | 提交 6f80380b91858dad66524a5b34e027dad656d538 | https://github.com/whaleyxbt/claude-motion | MIT（licenses/motion/claude-motion-MIT.txt） | 评审方法与捕获参考（resources/motion-workflows/upstream/） |
| video-shotcraft | 提交 6700db2ba80572ebc777b99d72049679fed9840c | https://github.com/Vincentwei1021/video-shotcraft | Apache-2.0（licenses/motion/video-shotcraft-Apache-2.0.txt） | 镜头卡元信息参考 |

FFmpeg 9.0.2-essentials（GPLv3/libx264，gyan.dev 构建）在开发验证中作为**外部配置程序**使用，不随插件分发；若最终捆绑，将附带其真实许可、来源与构建材料并如实标注，绝不标为 LGPL。MotionHarness（UNLICENSED）、onetake（PolyForm NC）与 remotion-dev/skills（无根 LICENSE）不安装、不捆绑、不作为运行时。
