# OpenDesign / fal 实时图片（代码阶段）

`designcraft_fal_realtime` 和图片工作区的「fal 实时图片」面板为用户明确发起的实时图片工作提供 fal WebSocket 路径；这与已有排队工作流是不同协议。先用 `inspect` 读取实际模型及输入 schema，再用稳定操作身份 `open` 会话；代码按官方协议在宿主使用 DSH fal 凭据申请短期令牌，连接固定 fal 主机，密钥和令牌不进入浏览器或项目。当前需要支持全局 WebSocket 的 Node 运行时；不支持时明确报错。实际账号、模型和 schema 是否支持该通道尚未验证。

连接本身及推理可能产生费用。会话最多保留两分钟，每个会话同时只允许一帧等待结果、最多发送 60 帧且相隔至少 250 毫秒；离开面板或工作区切换时请求关闭，不自动重连。`inputs` 列出项目中 PNG/JPEG 候选，`send` 仅在用户明确发起时按实际 schema 和项目素材引用提交一帧。发送前保存稳定任务身份、输入摘要和真实素材副本；`list` / `status` 查看本地状态，`close` 只关闭本地连接。断线、停止、响应异常或结果丢失时远端可能仍在处理或计费；实时通道没有队列任务 ID，不会自动重发或声称可恢复远端结果。

授权错误，以及无帧身份的非超时 `x-fal-error`，会关闭本地连接；若当时有待处理帧，记录为结果未知，不推断该错误属于某个任务。`TIMEOUT` 空闲控制消息不当作帧失败，不匹配的旧帧继续忽略。具体服务行为仍需实际验证。

只有服务响应包含与发送帧一致的 `request_id`，且实际返回可确认的 PNG/JPEG 字节或受限 fal 地址，代码才保存图片；不匹配的消息不会被归到该任务。每帧处理首条匹配结果，不证明后续流式帧已全部接收；该条响应中受支持图片均保存时记 `ready`，只保存了一部分时记 `partial`，不含受支持图片时仅记 `responded`。图片逐张保存并登记，后续下载失败时已保存的部分会保留。输入、输出及来源摘要随项目包保留，原始响应只保存摘要与长度，不保存链接、令牌或完整响应；因此不能仅凭该摘要独立重建服务响应。输出最多 8 张、单张 16 MiB、合计 32 MiB，图片尺寸受原生预览预算约束。图片内容、速度、效果和费用均需按实际结果核对。

`prepare_image` 可按已完成任务的输出序号登记实际 PNG/JPEG 来源，`open_image` 将登记原件打开为独立 Photo 源；`images`、`reconcile_image` 和 `recover_image` 检查或恢复本地图片来源/预约，不重复调用 fal 或导入。原生版本保留稳定预约身份，项目包核对任务、会话、原件、预约和原生源。`pending` 列出完整性可检查的会话/帧临时记录，`recover` 在会话不再活动时只恢复已保存的本地候选并保留原记录备份；未确认帧仍为未知，不重新发送。

MessagePack 使用固定 `@msgpack/msgpack` 3.1.3 ESM 文件；官方 npm 包 SHA-512、逐文件 SHA-256 和 ISC 许可保存在 `resources/vendor/msgpack-3.1.3/`。运行前核对清单和每个文件后才加载；没有执行安装脚本。代码阶段没有连接 fal、申请令牌、打开 WebSocket、生成图片或运行功能/UI/恢复/项目包验证，用户 DSH 没有操作或重启。

官方资料：[fal 实时协议说明](https://fal.ai/learn/serverless/real-time-gpu-inference-websockets)、[fal 客户端协议](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/realtime/protocol.ts)、[短期令牌实现](https://github.com/fal-ai/fal-js/blob/main/libs/client/src/auth.ts)、[MessagePack JavaScript](https://github.com/msgpack/msgpack-javascript)。
