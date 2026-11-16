# Venice 图片服务适配（代码已写入，尚未功能验证）

DesignCraft 的图片服务适配可从 DSH 已配置的 `VENICE_API_KEY` 凭据引用发现 Venice，或从插件 `imageConnections` 中读取明确配置的 `protocol: venice`、HTTPS `baseURL` 与 `credentialRef`。插件只在需要请求时解析凭据，不把密钥写入前端、项目或任务记录；没有可用凭据时该连接不会出现在服务列表。

代码按服务实际返回的 `/models?type=image` 和 `/models?type=inpaint` 区分生成与编辑模型。文生图调用 `/image/generate`，带参考图的编辑调用 `/image/multi-edit`；若模型仅接受一张图，就不会把需要原图和选区参考的局部重绘显示为可用。局部重绘仍由 DesignCraft 根据真实原生选区做本地蒙版合成，不把参考图声称为供应商硬蒙版。

请求发出前保存本地任务身份；中断、取消或网络异常时不会自动重发。停止本地等待不证明服务端已停止或不会计费。服务返回的真实图片才进入候选，处理规则标记会显示；未获得有效图片时报告失败。模型与服务能力以实际返回为准，不根据名称虚构。

Venice 图片编辑指南要求每张输入图至少 256×256；发送前会按 PNG/JPEG 文件头检查宽、高，并继续执行项目既有的最大尺寸限制。文件头检查不是完整图像解码，也不保证服务会接受文件。依据：[Venice 图片编辑指南](https://docs.venice.ai/guides/media/image-editing)。

独立图片生成可明确选择“请求透明背景”。只有所选模型的实际目录 `model_spec.constraints.supportsTransparentBackground` 为 `true` 时才可提交；无参考图时按 `type=image` 的声明判断，有参考图时按 `type=inpaint` 的声明判断。重复目录项的声明冲突时保守停用，精确选区重绘不提供此选项。请求使用 PNG，把选项、连接配置指纹与实际参考图摘要纳入任务身份，发送前再次核对；服务返回原始 PNG 先保存，再生成独立原生候选。真实 alpha、画面边缘及 Photo 导入效果仍须验证，不能把设置参数当作透明结果。官方说明：[透明背景生成与编辑](https://docs.venice.ai/guides/media/transparent-backgrounds)。

若模型实际目录在 `model_spec.constraints.qualities` 列出 `low`、`medium` 或 `high`，工作区可针对当前生成或编辑端点选择相应画质；重复条目只保留共同声明的档位。未选择时不发送 `quality`，由服务采用默认值。画质可能影响费用，实际价格和默认档位以服务为准；选择会纳入任务身份，返回原图先保留。若模型没有明确声明则不会提供该选项。依据：[Venice 图片生成 API](https://docs.venice.ai/api-reference/endpoint/image/generate) 和 [多图编辑 API](https://docs.venice.ai/api-reference/endpoint/image/multi-edit)。

比例和分辨率仅使用模型目录对应生成或编辑项的 `constraints.aspectRatios`、`constraints.resolutions`；重复声明取交集。带参考图的独立方案及选区重绘使用编辑项，电商产品图也按编辑项判断。若模型明确声明单图编辑不支持更改比例，就不发送比例；精确选区重绘也不发送比例参数，以保护原图构图。服务返回的宽高比若与原图不符，现有合成逻辑会拒绝覆盖，原始返回图仍保留。未声明的选项不猜测；实际尺寸、单图行为和费用仍以服务返回及实际计费为准。依据：[Venice 模型技能说明](https://github.com/veniceai/skills/blob/main/skills/venice-models/SKILL.md)。

独立文生图可在模型实际声明 `model_spec.supportsStyleReferences` 且给出有效 `constraints.maxStyleReferences` 时，选择单独的风格参考 PNG/JPEG，或使用当前原生图片的合成快照；工作区最多 4 张，单张小于 8,000,000 字节，总计不超过 16 MiB。只有模型同时声明 `supportsStyleReferenceStrength` 时才可显式填写统一强度 0.1–1；留空使用服务默认值。风格参考不与普通参考图、图片处理或选区重绘混用，并通过 `/image/generate` 的 `style_references` 发送；部分模型可能按风格图另行收费。实际风格符合度、费用及服务行为仍需验证。依据：[Venice 图片生成指南](https://docs.venice.ai/guides/media/image-generation)。

图片工作区还提供“Venice 图片放大”和“Venice 移除背景”，可选择一张 PNG/JPEG，或将当前原生图片的合成快照作为输入；原始分层源保留。`designcraft_image_studio transform_catalog` 只列出 DSH 当前已配置、凭据可解析的 Venice 连接，不请求模型目录，也不证明账户可使用端点。用户明确发起时，`start` 的 `payload.mode` 可为 `venice_upscale` 或 `venice_remove_background`，并指定 `provider` 和恰好一个已保存 PNG/JPEG 项目素材名称 `referenceAssets`，单张不超过 8 MiB。放大接受 `scale` 为 2 或 4、`creativity` 为 0–0.02；按官方指南保守要求输入至少 256×256 且少于 16,777,216 像素。最终尺寸由服务返回，服务可能降低有效倍数。背景移除请求期望 PNG；透明度和边缘效果须实际检查。

这两个端点是同步外部请求，可能计费。任务在发送前记录“已提交或结果未知”，不会自动重复；网络中断后无法凭该记录取回远端结果。收到实际 PNG 后先保存服务原图，再尝试生成独立 Photo 候选；若候选转换失败，可使用现有 `convert_returned` 处理已保存的同一原图，不再次请求服务。原输入与已存在的设计源不会被自动覆盖。任务记录和项目包代码会核对输入摘要及请求身份；这些路径均尚未功能验证。

本次仅实现代码，未获取该账户模型目录，未调用生成/编辑接口，也未验证服务、凭据或计费状态。以下官方协议是实现依据：

- [模型目录](https://docs.venice.ai/api-reference/endpoint/models/list)
- [图片生成](https://docs.venice.ai/api-reference/endpoint/image/generate)
- [多图编辑](https://docs.venice.ai/api-reference/endpoint/image/multi-edit)
- [图片放大](https://docs.venice.ai/api-reference/endpoint/image/upscale)
- [放大指南](https://docs.venice.ai/guides/media/image-upscaling)
- [移除背景](https://docs.venice.ai/api-reference/endpoint/image/background-remove)
