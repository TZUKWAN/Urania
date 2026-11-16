# OpenAI 图片与 SVG 适配（代码已写入，尚未功能验证）

图片工作区可通过 DSH 的 `OPENAI_API_KEY` 凭据引用使用官方 OpenAI 连接。代码只从实际 `/models` 结果中列出图片模型名称候选；模型的生图和参考图能力由名称及官方协议推断，账号权限和实际支持以服务响应为准。没有参考图时调用图片生成接口；有参考图时调用 multipart 图片编辑接口。局部重绘仍以实际原生选区做本地蒙版合成，不把参考图当作供应商硬蒙版。请求中断或结果不确定时不会自动重发。

对实际目录中出现且官方文档明确列明的 `gpt-image-2`、`gpt-image-2-2026-04-21`、`gpt-image-2.5-sunburst` / `gpt-image-2.5-flare` 及其 `2026-09-08` 快照，以及 `gpt-image-2.6-sunburst` / `gpt-image-2.6-flare`，可明确选择独立透明背景方案；前两者的透明支持处于预览。此能力标记来自官方文档和实际模型身份，不是 `/models` 返回的能力字段。生成或参考图编辑在用户选择后发送 `background=transparent` 和 PNG 格式；精确选区重绘不提供该选项。连接配置、输入摘要与选项纳入任务身份，收到的 PNG 先保存；实际账号权限、透明 alpha 与视觉效果仍需检查。依据：[图片生成 API](https://developers.openai.com/api/reference/resources/images/methods/generate)、[图片编辑 API](https://developers.openai.com/api/reference/resources/images/methods/edit) 和 [2.6 透明图片示例](https://developers.openai.com/api/docs/guides/image-prompting)。

这些官方明确型号的独立生成和参考图编辑还可选择保守的常用尺寸 `1024x1024`、`1536x1024` 或 `1024x1536`，对应接口 `size`；精确选区重绘不传尺寸，以保留原图比例。可选画质为 `low`、`medium`、`high`，2.5 和 2.6 型号另支持 `xhigh`、`max`；空选使用服务默认。这些选项来自官方型号文档，不是 `/models` 的能力声明；尺寸和画质可能影响费用，账号权限、实际成本与输出仍需核对。依据：[OpenAI 图片生成指南](https://developers.openai.com/api/docs/guides/image-generation)。

`designcraft_openai_svg` 提供独立 SVG 生成任务：只列出账号模型目录中实际返回且属于官方文档说明支持 SVG 的 GPT Image 2.6 家族。`start` 返回任务身份；实际静态 SVG 返回后才保存为不可变项目原件和结果回执。`recover_saved` 只核对已写入的结果回执，不重新生成；如果服务已受理但结果和回执均未保存，不能自动恢复。`open` 调用现有原生 Vector 导入，保存精确来源；`reconcile` 核对已有原生源与回执，避免重复导入。项目包代码保留任务、原件、结果和已确认的原生关联。

OpenAI 图片编辑接口不输出 SVG，当前代码不声称它能直接编辑现有 SVG。原位修改应使用 DesignCraft 已有的原生矢量编辑和关联应用流程。生成的 SVG 仍需验证文字、路径、字体、视觉效果和可编辑性，不能仅凭文件存在判定符合需求。

本次仅编写代码并做静态检查，没有请求 OpenAI 模型目录或生成接口，也未进行功能、界面、原位回写、失败恢复或项目包验证。官方依据：[图片生成与 SVG](https://developers.openai.com/api/docs/guides/image-generation)、[Images API](https://developers.openai.com/api/reference/resources/images)、[模型目录](https://developers.openai.com/api/reference/resources/models/methods/list)。
