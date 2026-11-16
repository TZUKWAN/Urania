# OpenDesign / PixelBin 图片工作流（代码阶段）

OpenDesign 目录中的 `pixelbin-media` 上游 GitHub 地址在资料读取时返回 404；本适配依据 [PixelBin 官方 MCP 说明](https://www.pixelbin.io/ai-tools/pixelbin-mcp)，不声称已取得该失效仓库或执行其脚本。当前范围是图片生成、处理、项目图片上传及结果保存，不把官方目录中其他媒体能力视为已经接入。

`designcraft_pixelbin` 和专业图片工作区的 PixelBin 面板使用固定 `https://mcp.pixelbin.io/mcp`。可选择 DSH 的 `PIXELBIN_ACCESS_TOKEN` 引用，或由用户主动发起 OAuth 设备授权：界面展示官方授权地址与用户码，由用户自行打开和授权；不会自动操控浏览器。设备码、访问令牌、刷新令牌和客户端密钥不进入项目或前端。授权完成后，代码使用 Windows 当前用户 DPAPI 加密保存在用户的 `LOCALAPPDATA/DesignCraft/PixelBin/oauth`，支持本机加密候选恢复与授权来源切换。本机停用不会撤销 PixelBin 账户授权；DSH 引用需在 DSH 中管理。令牌刷新有跨进程互斥和不确定结果记录；刷新响应丢失时不会自动重放，可能需要恢复加密候选或重新授权。DPAPI 保护器此前已编译，本轮未运行验证。

`catalog` 读取服务实际提供的工具/schema。`read` 支持 `list-predictions` 和 `get-prediction`，快照仅短期存于内存并隐藏链接和敏感字段。`estimate` 请求实际费用并短期保留服务返回的确认令牌；只有用户明确选择提交，且插件、操作、输入、账户和 schema 与估算一致时，`start` 才尝试 `create-prediction`。本地任务、可能已发送状态和实际返回的预测 ID 分别记录，接收回执可恢复；服务没有返回可识别的唯一 ID 时不会猜测或重发。`refresh` 使用保存的 ID 查询同一个预测；状态只接受服务实际返回的已知值，不把排队、响应或本地取消说成完成。

当实际查询响应明确给出 `SUCCESS`，`candidates`/`capture` 可从响应的输出字段取得图片。当前下载只接受 `cdn.pixelbin.io` 和官方 SDK 示例中的 `delivery.pixelbin.io`、不跟随跳转，支持 PNG、JPEG、WebP；其他主机或格式会明确失败。预测身份兼容 MCP 常见的 `prediction_id` / `predictionId` 以及官方 SDK 示例中的顶层或 `prediction` 下的 `_id`；若响应未返回身份，则仅保存明确查询的 ID。实际文件、脱敏查询响应和来源摘要一起保存。`assets`/`recover_asset` 检查已保存图片和完整临时候选；`open` 将不超过 16 MiB 的 PNG/JPEG 导入独立的原生 Photo 源，`reconcile` 核对已保存源和导入回执，不重复执行。其他格式和大小的原件仍可保留，但不能声称已导入。

`upload` 和 `save_remote` 必须由用户明确发起，且必须显式选择 `private` 或 `public-read`；公开读取还要求明确勾选/传入 `allowPublic`。上传只读取当前项目中实际存在的 PNG/JPEG/WebP，禁止覆盖远端文件；签名 PUT 不携带 PixelBin OAuth 凭据。目前仅接受受限 PixelBin 上传主机和受支持请求头，服务若返回其他存储主机或头部会停止，不猜测。PixelBin 官方说明预测输入需要公开 HTTPS 图片，私有上传未必可供预测使用。远端保存和上传可能产生费用或公开数据；服务响应仅表示响应结果，访问范围和文件是否可读取仍须核对。公开 CDN 地址仅在用户明确选择公开且服务返回无签名查询的 `cdn.pixelbin.io` 地址时记录；签名上传地址、头部和私有链接不写项目。

所有远端写入都先写稳定本地操作身份和摘要；网络中断或停止本地等待后，远端可能仍在处理或计费。`operation_recover` 只恢复已保存的本地回执，不重复上传或远端保存。项目包保留并核对任务、接收回执、原件、脱敏结果、显式公开地址及原生关联；本机 OAuth 加密文件不进入项目包。原件下载/保存与回执之间崩溃仍可能留下未关联文件，远端接受请求与本地记录之间崩溃也可能无法恢复 ID，需先核对远端。

通信使用受限 MCP JSON/SSE，未实现通用 MCP、SSE 续传或服务端多轮询问。OAuth 只接受固定 PixelBin 官方来源的发现、注册和令牌端点；若实际服务使用其他来源、认证方式或 schema，代码会报错而非猜测。模型、接口、主机、授权和价格均以服务实际返回为准。

本轮没有登录 PixelBin、执行 DPAPI 保护器、查询目录或费用、上传图片、生成/下载结果、导入原生源或运行功能/UI/恢复/项目包验证。用户 DSH 未操作或重启，实际加载版本未知。

资料：[PixelBin MCP 官方说明](https://www.pixelbin.io/ai-tools/pixelbin-mcp)、[PixelBin Python 官方 SDK](https://github.com/pixelbin-io/pixelbin-python-sdk)、[OAuth 设备授权 RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)、[动态客户端注册 RFC 7591](https://www.rfc-editor.org/rfc/rfc7591)、[MCP 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。
