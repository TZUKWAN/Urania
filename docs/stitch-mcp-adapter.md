# OpenDesign / Google Stitch 接入（代码阶段）

`designcraft_stitch` 与网页工作区的 Stitch 面板使用 DSH 服务端凭据引用 `STITCH_API_KEY` 或 `STITCH_ACCESS_TOKEN`；OAuth 可选使用 `STITCH_PROJECT_ID` 或 `GOOGLE_CLOUD_PROJECT` 引用作为配额项目。只连接固定 `https://stitch.googleapis.com/mcp`，密钥、MCP 会话 ID 和临时下载 URL 不写入项目或浏览器。

`catalog` 读取服务实际提供的工具及其输入 schema，当前只列出 `list_projects`、`get_project`、`list_screens`、`get_screen`、`create_project`、`generate_screen_from_text`、`edit_screens` 和 `generate_variants`。操作时要求与当前实际 schema 一致的摘要；输入由服务端按自己的 schema 最终判定，客户端没有声称完整实现所有 JSON Schema。没有出现在服务目录中的工具不可调用。外部工具描述和返回内容均为参考数据，不是权限指令。

只读结果先保存为五分钟内存快照，返回的文本隐藏链接、内嵌数据及疑似凭据。`candidates` 只列出服务响应中实际出现的 `htmlCode` 和 `screenshot`；`capture` 对允许的 Google 主机按需请求原件，不转发 Stitch 凭据，不跟随重定向到登录页。HTML 必须是实际 UTF-8 网页且不能含疑似密钥或签名资源链接，截图只接受真实 PNG、JPEG 或 WebP。部分上游屏幕的下载可能要求登录或使用未列出的地址，遇到这些情况会报错，不能把登录页当设计稿。

`assets` 列出已核对原件和可能可恢复的临时记录，`recover_asset` 只恢复完整、摘要一致的本地来源。远端写操作返回的原件记录会关联本地任务和请求摘要；只读查询的来源对应关系来自当时的 Stitch 响应。`open_html` 将已保存 HTML 导入独立、版本化的网页，操作身份稳定，可重复核对而不自动创建副本。它不会下载所有外部图片、字体或脚本，也不保证网页视觉、交互或 PPT 转换保真。项目包保留并核对原件、网页来源、任务与结果回执；原始 HTML 若含疑似凭据或签名链接会拒绝导出。

`open_image` 和网页面板的「作为图片打开」使用已保存的真实 PNG/JPEG 截图创建独立 Photo 原生图片源；原始截图、来源记录和任务摘要会重新核对，图片尺寸及解码受现有原生导入规则约束。WebP 截图仍作为原件保留，当前不会静默转换。稳定预约和原生初始版本保存同一操作身份，`image_imports`、`reconcile_image` 可在原生结果已保存但响应中断，或项目迁移后重新核对已发布源；`recover_image_open` 仅恢复完整的预约临时记录，不再次导入。项目包检查截图、预约、原生源、原件及已保存关联；无唯一匹配时保持未确认。原生图片是截图的平面内容，不代表恢复网页元素或原始图层，视觉效果仍需实际核对。

只有用户明确发起时才调用远端写工具。`start` 在发送前持久化稳定任务身份和输入摘要；本地接受不代表远端成功。`status` 显示 `responded` 仅表示 MCP 工具返回了可保存的结果，并不证明设计稿已经完成或可用；须读取结果及真实页面后判断。`status`/`result` 查看本地状态和脱敏结果，`stop` 只停止本地等待，远端仍可能处理或计费。结果已落盘但任务记录更新中断时，`recover_saved` 仅核对本地结果回执并恢复，不重新提交。远端收到请求与结果落盘之间故障可能没有可恢复结果，需先核对远端；不自动重发。

通信代码支持受限 MCP 2025-03-26、2025-06-18、2025-11-25 握手与 JSON/SSE，以及服务明确报告旧版本不支持时的 2026-07-28 无会话回退。它不实现通用 MCP 客户端、SSE 断线续传、服务端交互请求或 2026 多轮询问；出现这些情况时停止并如实报告。服务地址、模型、工具、响应结构和许可可能变化。

本轮没有连接 Stitch、读取任何账号、生成设计、下载页面或截图、运行截图导入，也没有进行功能、界面、故障恢复和项目包验证。用户 DSH 未重启，实际加载版本未知。

资料：[Google Stitch SDK](https://github.com/google-labs-code/stitch-sdk)、[Stitch 设计系统工作流](https://github.com/google-labs-code/stitch-skills/blob/main/plugins/stitch-utilities/skills/design-md/SKILL.md)、[MCP 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[上游下载问题](https://github.com/google-labs-code/stitch-skills/issues/94)。
