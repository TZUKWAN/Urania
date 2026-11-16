# Replicate 模型工作流（代码已写入，尚未功能验证）

`designcraft_replicate_workflow` 使用 DSH 中的 `REPLICATE_API_TOKEN` 引用访问 Replicate，令牌只留在宿主侧。`model` 和 `versions` 读取实际模型及版本信息，官方标记缺失时返回未知。普通模型使用实际固定版本；当服务明确标记模型为官方且模型元数据实际提供可核对的输入 schema 时，可用 version=`official` 读取并提交官方模型接口。用户明确要求相应操作后，`start` 核对 schema 摘要再提交；服务不提供可用 schema、权限不足或约束不受支持时拒绝。

官方模型由服务维护，权重可能变化；schema 摘要不等于固定权重。若服务暴露实际 schema 版本，代码在请求前再次核对并与响应中可观察到的 SHA 版本比较；响应为 `hidden` 或未提供版本时如实记录，不能声称权重版本确定。遇到不同的可观察版本会保留真实预测 ID 和冲突状态，不自动重发。即使重新读取 schema，服务也可能在读取与实际执行之间更新。

项目素材通过 `assetRefs` 显式绑定到输入中的空值或 `"@asset"`。单文件不超过 256 KiB 时以内嵌数据发送；更大的文件在用户明确发起预测时，通过 Replicate 官方 Files 接口上传，所有输入素材合计最多 32 MiB。上传会把文件交给 Replicate 并创建可用于预测的文件地址；该地址可能被持有者访问，官方 SDK 说明上传文件通常在 24 小时后到期，实际以服务的 `expires_at` 为准。不会把外部上传误称为本地处理。

每项上传发送前记录不确定状态，服务返回后核对文件大小、SHA-256 与官方文件地址；文件身份使用 Windows 当前用户 DPAPI 加密保存，明文身份、数据 URI、上传地址及令牌不写入项目记录。项目包保留已引用的密文和摘要，但密文通常只能由同一 Windows 用户解密，换设备或用户后不能承诺恢复。当前仅接受官方示例的 `https://api.replicate.com/v1/files/<id>` 地址及返回 SHA-256；若服务返回其他地址或缺少摘要，安全停止并保留状态。完整模型 schema 在预测发出前重新核对；若大文件上传后 schema 不接受实际文件 URL，文件可能已存在而预测未提交。

上传或预测中断后不会自动重复。`reconcile_upload` 在同一账户的实际文件目录中按唯一关联元数据、大小及 SHA-256 查找未知上传，不重新上传；目录超出预算、无唯一匹配或服务不返回所需元数据时仍保持未知。`resume_unsent` 仅在预测明确尚未发送、上传均不处于未知状态时，要求完全相同的输入与素材后恢复；已观察到的加密文件身份会先通过服务查询核对。服务接收预测前后分别记录不确定状态和真实 prediction ID，`recover` 只取回同一预测；`stop` 仅停止本地等待，`cancel_remote` 明确请求服务取消。

受支持的实际输出文件按内容保存为项目素材，其他来源链接隐藏；部分文件可能过期、超出大小预算或被服务拒绝。项目包代码包含任务、接收回执、未发布记录及已保存输入和输出素材，不包含令牌或签名链接。空输出不标记为已生成作品。模型效果、价格、授权、保真及不同文件格式仍需实际核对。

已保存 PNG/JPEG 的原生接管代码和边界见 `workflow-image-handoff.md`。

本次未调用 Replicate 模型目录、Files 接口、上传或 prediction，未运行 DPAPI 保护器，也未进行功能、界面、失败恢复或项目包验证。通用接口不表示每个模型及 OpenDesign 外部原包已经接通。官方依据：[HTTP API](https://replicate.com/docs/reference/http)、[模型 schema](https://replicate.com/docs/reference/openapi/)、[输出保留](https://replicate.com/docs/topics/predictions/data-retention)、[官方文件上传实现](https://github.com/replicate/replicate-javascript/blob/main/lib/files.js)、[官方模型接口](https://replicate.com/docs/topics/models/official-models)。
