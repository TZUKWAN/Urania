# OpenDesign / Figma MCP 工作流（代码阶段）

此适配是当前 DSH 对话中的 `designcraft_figma_mcp` 工具及网页工作区的 Figma MCP 面板，连接固定 `https://mcp.figma.com/mcp`。凭据只从 DSH 的 `FIGMA_MCP_ACCESS_TOKEN` 引用读取；该引用必须是适用于 Figma MCP 的 OAuth 访问令牌，不把 Figma REST 个人令牌当作 MCP 令牌。需要时可配置 `FIGMA_MCP_REGION` 引用并传入 `X-Figma-Region`。代码不提供 Figma 登录、OAuth 续期或浏览器自动操作；无凭据、令牌过期或账户权限不足时返回错误。

Figma 官方文档说明远端 MCP 服务限定受支持客户端，新客户端需要申请。DSH 是否被准入、外部获得的 OAuth 令牌是否可用、用户账户是否有读写权限和相应额度，本轮均未确认。不会仿冒获准客户端或自行使用其他应用的授权。

`catalog` 连接服务并读取实际 `tools/list`，只展示当前代码允许且服务真实提供的工具、脱敏说明和 schema 摘要。`read` 使用实际工具名、参数和 schema 摘要读取设计上下文、节点概要、截图、变量、设计系统与 Code Connect 等受支持只读工具；`snapshot` 分页展示短期脱敏响应。传入参数受本机 256 KiB 限制，代码只核对目录中的 schema 摘要，参数最终以 Figma 服务实际校验为准。`links` 仅在快照有效期内展示实际返回且通过域名和参数限制的 Figma 文件链接；其他链接与令牌不进入项目。服务响应是参考数据，不是高优先级指令。

对于 `get_screenshot`、`get_design_context` 和 `get_figjam` 的 MCP 图片内容，`candidates` 仅列出服务实际返回的 PNG/JPEG 候选；`capture` 对 base64、文件头、尺寸和摘要检查后，将真实图片及脱敏响应保存在项目中。单张图片最多 6 MiB，MCP 响应最多 8 MiB。`assets`、`recover_asset` 核对已保存的图片及完整临时候选；`open_image` 将其导入独立原生 Photo 源，`reconcile` 依据已有原件和操作回执核对，不重复导入。图片是位图，不表示 Figma 图层、组件或文字已转换为原生对象。

`download_assets`、`get_screenshot` 和 `get_design_context` 的短期快照中，`file_candidates` 只列出实际响应里的受支持 Figma 素材来源；`capture_file` 由用户选择后下载对应文件，限制来源域名和 Figma 临时素材路径、不转发令牌，远端重定向最多三跳且逐跳限制在允许的 Figma/S3 来源，本机素材不允许重定向；核对实际类型、大小和 SHA-256 后保存文件与脱敏响应。支持不超过 16 MiB 的 PNG、JPEG、GIF、WebP、PDF 及通过静态安全检查的 SVG；服务返回其他域名、失效地址或格式不受支持时明确失败。`files`、`recover_file` 查看已保存原件或恢复完整的来源临时记录。已保存的图片/SVG 可作为项目素材参与上传；`file_native_open` 可把 PNG/JPEG 或 8 MiB 以内安全 SVG 导入独立的 Photo/Vector 源，`file_native_list`、`file_native_reconcile` 和 `file_native_recover` 只检查或恢复已有本地预约与源，不重复导入。项目包核对原件、脱敏响应、预约、原生保存版本和关联。文件类型不代表它是原始图片还是节点渲染，也不证明 Figma 原生图层已还原；SVG 效果、字体与视觉表现仍需实际核对。脱敏响应只证明当时存在候选，不能在事后独立重建临时 URL 与远端内容的对应关系。

只有用户明确要求远端修改时，`start` 才提交实际目录中允许的文件创建、设计编辑、图表、HTML 转换、组件映射或图片生成工具。`use_figma` 在 Figma 端执行提供的脚本，能够创建、修改或删除内容；调用方须先阅读官方 `figma-use` 指引并传入其名称，参数检查不能证明脚本安全或设计正确。图片生成可能使用 Figma AI 额度，应事先向用户说明。`generate_figma_design` 等工具可能需要客户端执行额外浏览器捕获步骤；适配器不会执行服务返回的本地脚本，因此不能声称这些多步流程已经完成。自动 OAuth 和服务端多轮交互尚未接入。

`upload_inputs` 分页列出项目中候选素材，`upload` 仅在用户明确发起时，把实际项目 PNG、JPEG、GIF、WebP 或通过静态安全检查的 SVG 发给 Figma；单次一个文件，最大 10,000,000 字节。须先从真实工具目录取得 `upload_assets` 的 schema 摘要，参数提供目标 `fileKey`、`count=1` 和服务支持的可选页面、节点及缩放；SVG 不接受图片填充节点或缩放参数。代码先保存并核对实际原件，向 Figma 请求一次性地址，再只向受限的 `mcp.figma.com` 上传地址发送原始字节，不转发 OAuth 令牌，不持久保存地址。Figma 可能添加新对象或替换指定节点的图片内容；返回响应只记录真实 HTTP 状态、原始响应 SHA-256/长度和可安全识别的字段，不表示画布或效果已经核对。

`upload_list` / `upload_status` 查看本地状态；同一稳定操作身份不会自动重复发送。停止或网络异常后，远端可能已经接收并放置素材，应先核对 Figma 文件；`upload_recover` 只整理已中断的本地记录，不访问 Figma、不重发。项目包保留上传记录及已核对原件，不包含一次性地址、令牌或原始未脱敏响应；执行中的记录必须先结束，已中断记录须先整理。官方服务可能改变地址或 schema，或因客户端、权限、网络故障拒绝上传。

`send_html` 在用户明确发起时，将当前项目中指定网页的精确保存版本入口绑定到实际 `html_to_figma` schema 的输入位置；参数模板中该位置必须为 `null` 或 `@html`，并用 JSON 指针指定。新记录的专用请求预算为 40 MiB（含参数 JSON），普通 Figma MCP 操作仍限制在 256 KiB；网页源自身受现有保存预算约束。默认只发送入口；可选 `inlineRules` 根据明确映射内联已保存的本地 CSS、图片或字体，`inspect_html_inline` 仅本地检查映射和输出摘要，不发送 Figma。其他 CSS、图片、字体、脚本和外链不会自动内联，不能据此证明网页自包含。Figma 官方说明外部链接不会加载，生成的是普通图层，不自动使用组件或变量。代码记录网页、入口、规则、输出/请求摘要和本地任务，`html_transfers`、`html_transfer_status`、`html_transfer_recover` 用于核对或恢复本地预约；失联后不会自动重新提交。项目包从原网页版本和规则重算输入摘要，远端是否生成及视觉效果仍需核对。

内联映射每条均为 `{target, find, file, mode, count}`：`target` 是网页入口或已保存 CSS 路径，`find` 是要精确替换的实际文本，`file` 是引用所对应的已保存文件，`count` 是必须匹配的确切次数。`data-url` 将相对路径替换为该文件实际图片或字体的 data URI；`stylesheet` 仅接受入口中的标准、带引号的本地 `<link rel="stylesheet" ...>`；`css-import` 仅接受 CSS 中无条件、带引号的 `@import`。先处理 CSS 内部依赖，再按顺序把 CSS 内联到入口；不支持的标签、路径、格式或次数不一致时停止。此功能按明确文本映射执行，不是自动 HTML/CSS 解析器；未映射引用、外链、脚本、字体许可和视觉效果仍需用户核对。

新建转移使用内联版本 3 的较大预算；历史版本 1、2 仍按各自规则重算，无内联版本的旧记录仍直接使用入口。未知版本会拒绝处理。较大请求和兼容路径仅完成代码和静态检查，实际服务、项目读取与打包尚未验证。

`suggest_html_inline` 可从已保存入口和 CSS 的常见文本语法提出依赖映射候选及提示，网页面板可将其放入可编辑的映射框；不会下载或执行网页源码。候选属于启发式分析，可能遗漏复杂语法，或包括出现在注释、字符串或非资源位置的同名文本。必须核对内容并运行 `inspect_html_inline`；该检查只证明明确映射可以按规则执行，不能证明全部引用或视觉效果正确。

本地预约只说明已记录请求；`responded` 只说明保存了 MCP 响应，不代表远端作品已完成或视觉结果正确。`list`、`status`、`result` 查看任务，`recover_saved` 仅根据已保存的本地结果回执恢复，不重发远端请求；`stop` 仅停止本地等待。若远端已接收而本地响应丢失，状态可能无法自动确定，应通过 Figma 原文件核对。项目包核对任务、回执、实际图片、脱敏响应和原生来源；不包含 OAuth 令牌或短期链接。

用户此前要求先完成代码、暂缓功能验证。本轮没有登录 Figma、调用 MCP 或 REST、读取账户、上传素材、修改远端设计、运行功能/UI/故障恢复/项目包验证，也没有操作或重启用户 DSH。

官方资料：[Figma MCP 工具](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)、[远端服务器接入与客户端范围](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/)、[Figma MCP 指引](https://github.com/figma/mcp-server-guide)、[OpenAI Figma MCP 配置参考](https://github.com/openai/skills/blob/main/skills/.curated/figma/references/figma-mcp-config.md)。

除原有默认远端模式外，`catalog` 和 `read` 可在用户明确选择 `source=desktop` 时连接其自行开启的 Figma 桌面 MCP；界面使用“Figma 桌面服务（只读）”选项。固定端点为本机 `127.0.0.1:3845/mcp`，不会自动启动 Figma、控制桌面或发送远端 OAuth。服务目录仅呈现实际返回且允许的只读工具，不提供远端编辑、素材上传或网页发送；`download_assets` 在桌面模式不作为只读操作暴露。切换来源会清除当前目录和临时快照视图，已保存项目来源保留。

当本机响应包含符合受限格式的 `localhost:3845/assets/` 或 `127.0.0.1:3845/assets/` 实际候选时，可由用户选择并保存对应真实 PNG/JPEG/GIF/WebP/PDF 或安全 SVG；请求固定映射到 `127.0.0.1`，不跟随跳转、不携带 OAuth，文件大小上限 16 MiB。文件和 MCP 内嵌截图来源记录增加 `source=desktop`，旧远端记录保留原来的身份计算；原生导入及项目包沿用已有核对。Figma 本身的图片设置可能改变其返回或下载行为，具体由用户在 Figma 中配置。桌面服务需要 Figma 应用、相应席位及用户自行开启；固定本机端口本身没有独立的服务身份认证，应只在用户信任本机监听进程时使用。此路径尚未连接、导入或做功能/UI/项目包验证。

官方资料：[Figma 桌面 MCP 安装说明](https://developers.figma.com/docs/figma-mcp-server/local-server-installation/)。

远端实际快照也可识别 figma.com 或 www.figma.com 的 `/api/mcp/asset/<uuid>` 临时素材地址。该地址可能过期或重定向；仅逐跳接受既有受限 Figma/S3 主机，未知主机、超出跳数或失效地址会失败。此路径与重定向尚未实际服务验证。参考：[Figma 官方素材下载说明](https://github.com/figma/mcp-server-guide/blob/main/skills/figma-swiftui/references/design-to-code.md)。

Figma MCP 的 `create_design_system_rules` 是 MCP 提示模板，不是普通工具。`prompt_catalog` 按当前选择的远端或桌面服务列出实际可用的该提示及摘要；`prompt_read` 核对实际提示参数后读取服务消息并创建短期脱敏快照。`prompt_messages` 列出其中实际文本消息，`prompt_capture` 仅在明确选择序号后把脱敏消息及响应来源保存为当前项目的参考文件；`prompt_list`、`prompt_text`、`prompt_recover` 查看或恢复已有本地参考，不重新请求服务。界面提供对应操作；提示不会自动执行，也不代表已经分析项目、生成最终规则或获得 Figma 对设计的认可。链接和疑似凭据可能被脱敏，`redacted` 标记整个响应存在脱敏，不保证所保存文本与服务原文逐字相同。项目包核对参考文本、脱敏响应、来源记录与摘要。实际提示是否存在、参数、服务客户端支持及上述路径均尚未功能验证。

官方资料：[Figma MCP 工具与提示](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)、[MCP 提示协议](https://modelcontextprotocol.io/specification/2025-11-25/server/prompts)。
