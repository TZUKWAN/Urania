# OpenDesign Gemini 图片工作流（代码阶段）

OpenDesign 的 `imagen` 目录项上游使用 Gemini 图片接口。Google 文档所列该上游示例的旧预览型号及 Imagen 4 的停用日期早于当前日期，实际服务可用性未调用确认；本适配使用当前连接的模型目录，不把旧名称写成始终可用的服务。

- 图片服务可通过 DSH 凭据解析 `GOOGLE_API_KEY` 或 `GEMINI_API_KEY`；两个引用作为可选择的连接，只在凭据可解析时显示，Google 原生请求使用 `x-goog-api-key`。密钥不写入浏览器或项目。
- 只展示目录真实返回的图片候选；当目录未给出输出模态时，按模型名称和 `generateContent` 方法推断并标明。目录返回并不证明账号的模型权限、配额或实际请求成功。
- 仅对 Google 官方来源及文档明确的 `gemini-nano-banana-2.1`、`gemini-3.1-flash-image`、`gemini-3-pro-image` 和 `gemini-3.1-flash-lite-image` 提供相应的可选比例和分辨率；参数走 `generationConfig.imageConfig`，不支持的选项在发送前拒绝。专业图片面板默认不传尺寸，旧界面在选项存在时默认选择 1K 和 1:1；输出尺寸以返回图片为准。
- `gemini-nano-banana-2.1` 名称不含 image；仅当 Google 官方模型目录实际返回它，并明确声明图片输出，或在未提供输出模态时列出 generateContent 方法，才按官方文档补充缺失的图片能力和尺寸候选；若服务明确排除该方法则不列出。输出可选 1K、2K、4K 与文档列出的 14 种比例；当前项目参考图数量限制仍为最多四张。上述能力是推断，不证明账号可用或输出达到请求尺寸。

- 从完成的响应候选中取非 `thought` 图片；一次返回多张时，代码先将各张原始位图及摘要记录在项目，再转换首张，其余可在图片面板或 `convert_returned` 按需转换，不重复调用远端服务。每次响应最多保留 128 张，超过预算会拒绝；中断可能发生在服务返回与本地保存之间。请求失败、取消或连接中断后沿用现有任务记录，不自动重新发送；服务仍可能计费。
- 参考图、最终原件和项目候选继续使用现有保存、原生图片来源、蒙版合成和项目包机制；这不代表 Google 编辑是精确蒙版 API，也不代表输出能在所有原生运行时打开。项目局部重绘与候选处理仍受现有大小预算约束。

本轮未读取真实模型目录、调用 Gemini、生成图片、操作界面或进行功能验证；代码能否适配实际账号与服务响应尚待刘总授权验证。

资料：[上游规则](https://github.com/sanjay3290/ai-skills/blob/main/skills/imagen/SKILL.md)、[Google 模型退役](https://ai.google.dev/gemini-api/docs/deprecations)、[生图与编辑](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)、[生成接口](https://ai.google.dev/api/generate-content)、[API 密钥](https://ai.google.dev/gemini-api/docs/api-key)。
