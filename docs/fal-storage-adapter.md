# fal 项目素材与训练数据上传

`designcraft_fal_workflow` 可在用户明确要求相应远端任务时，将当前项目 `design/assets` 中的实际文件通过 fal 存储绑定到模型输入。先用 `search`/`inspect` 读取真实模型及 `schemaSha256`；输入字段、费用与模型支持的文件类型以当时的模型 schema 和 fal 实际服务为准。上传或队列提交不表示模型训练成功。

`start` 支持 `storageAssetRefs` 数组，元素为实际 JSON 指针 `pointer` 与项目素材名 `asset`；目标位置必须是空值、`@asset` 或对象中尚不存在的字段。总素材引用（含原有 `assetRefs`）最多 8 项。若指定 `storageAssetRefs`，必须显式传 `allowPublicUpload:true`，表示知悉文件会离开本机，fal 的存储对象可能被链接持有者访问，保留和访问策略由服务实际配置决定。原有 `assetRefs` 仍走现有内嵌文件路径；同一指针不能同时使用两种引用。

存储上传支持按真实内容识别的媒体及非加密、非 ZIP64 的 ZIP；ZIP 只检查有限目录结构和路径，不解压，也不证明内部文件 CRC、图片合法性、版权许可或训练适用性。单文件不超过项目素材的 64 MiB 限制，存储输入总量不超过 128 MiB；这些上限不意味着模型支持对应大小。实际原件会复制为按 SHA-256 命名的不可变项目素材。正式上传前只用内存中的暂定 URL 做一次参数结构检查，暂定值不会发往服务或写入任务；在得到服务实际地址后会再次按实际 schema 验证。

适配使用官方 fal SDK 所示的单文件 `storage/upload/initiate` 和上传地址 PUT 协议，不执行上传包内的任何脚本。凭据仅发送给官方 `rest.fal.ai` 发起接口，上传和文件地址仅允许 HTTPS `fal.media` 域名及其子域名，不跟随跳转。服务可能返回该范围以外的合法地址，此时会安全拒绝，尚需后续真实服务验证。上传地址只保留在进程内，文件地址使用 Windows 当前用户 DPAPI 加密后存入项目；这不改变服务端权限或生命周期。跨 Windows 用户、不同设备或失去原 DPAPI 密钥后可能无法解密。

`status`/`list` 中的 `uploads` 分别记录 `not_sent`（未发送）、`initiating`（发起结果不确定）、`prepared`（发起地址已获取、文件尚未确认上传）、`uploading`（上传结果不确定）或 `accepted`（PUT 收到成功响应）。`accepted` 不是对远端字节、访问权限、有效期或训练结果的独立证明。操作中断或响应丢失时不自动重发。`resume_storage` 仅接受原任务 ID、完整一致的原输入与两类素材引用和明确存储同意；仅当模型尚未提交且各上传均为 `accepted` 或 `not_sent` 时，复用已确认地址并继续未发送素材。`initiating`、`prepared`、`uploading` 和模型提交未知的任务不能通过该动作自动重发；请先核对服务端实际状态。已有 request ID 的模型结果仍使用原 `recover`，不会重新提交。

项目包包含相关工作流记录、实际素材及加密链接，导出前后核对摘要；现有整个项目包的 256 MiB 上限仍适用。项目包不包含明文链接或 fal 凭据，不保证加密链接在其他用户环境可恢复，远端对象也可能过期。文件引用、上传协议、DPAPI、训练模型及项目包尚未通过真实功能验证。

官方资料：

- [fal JavaScript 客户端存储实现](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/storage.ts)
- [fal 数据保留与存储](https://fal.ai/docs/documentation/model-apis/media-expiration)
- [fal Z Image Trainer API](https://fal.ai/models/fal-ai/z-image-trainer/api)
