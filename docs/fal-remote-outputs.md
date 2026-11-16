# fal 训练结果与后续模型输入

`designcraft_fal_workflow` 的模型选择与参数仍由 `search` 和 `inspect` 读取 fal 当时实际返回的模型 schema。用户明确要求提交一项可计费任务时，可在 `start` 加上 `captureRemoteOutputs:true`，以便捕获该任务实际响应中允许来源的文件地址。发起任务前会检查当前 Windows 用户的 DPAPI 链接保护器；不符合保护要求时不会发起模型任务。

允许的输出地址限 HTTPS `fal.media` 及其子域名，或 `storage.googleapis.com/falserverless/`；不保存明文地址或凭据。每项引用记录来源任务、实际输出 JSON 指针、密文文件及其摘要；只有经过服务返回的指针才会登记，不能按模型名称猜测地址。优先沿用现有媒体下载路径：如文件不可读取、超过单文件 64 MiB 或总量 128 MiB 下载预算，保留加密的远端引用并在结果中标为 `remote-reference-only`，不声称文件已下载或字节已核对。大权重不会因此自动成为本地文件，服务链接也可能失效；用户仍可用已取得 request ID 查询同一任务。

之后用户明确要求另一个模型任务时，可在 `start` 的 `remoteOutputRefs` 中指定目标输入 `pointer`、来源 `jobId` 和该任务实际 `remoteLinks` 列出的 `outputPointer`。目标字段必须是空值、`@asset` 或对象中尚不存在的字段；来源必须为已完成并取得服务响应的任务，连接与凭据须一致。系统解密并仅在内存中绑定地址，再用当时真实输入 schema 验证；不会将地址写入请求记录。所有项目素材与远端引用总计最多 8 个，绑定字段不可重复。`resume_storage` 时必须提供与原任务一致的远端引用，模型提交不明时不自动续接。

例如，fal 官方 Z Image Trainer 将训练权重描述为 `diffusers_lora_file.url`，其 Z Image LoRA 推理接口描述了 `loras` 的 `path` 参数；这些只是官方接口示例，实际任务必须从所选模型的实时 schema 和来源记录取得精确路径，不推断任意训练器与推理器兼容。捕获的地址可能指向尚未下载、不可访问、过期或不兼容的文件；输出记录不独立证明权重内容、授权或训练质量。对模型端真实性与文件内容，仍需后续实际验证。

项目包代码保存两侧任务的记录和链接密文，核对任务连接、结果摘要、输出指针及密文摘要；项目包不含未下载的大文件原件，并受 256 MiB 总预算约束。DPAPI 当前用户范围无法保证跨用户或换机解密；这不改变 fal 的访问控制或保留期。源与目标记录的对应由本地接收时建立，不构成可独立重放的服务签名证明。

本路径尚未运行真实服务、训练、推理、链接保护器或功能、恢复与项目包验证。

- [fal Z Image Trainer API](https://fal.ai/models/fal-ai/z-image-trainer/api)
- [fal Z Image Base LoRA API](https://fal.ai/models/fal-ai/z-image/base/lora/api)
- [fal 数据保留与存储](https://fal.ai/docs/documentation/model-apis/media-expiration)
