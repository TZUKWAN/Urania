# Figma 只读来源适配（代码已写入，尚未功能验证）

`designcraft_figma_source` 使用 DSH 凭据引用 `FIGMA_ACCESS_TOKEN` 或 `FIGMA_TOKEN` 调用 Figma 的只读 REST API；当前没有配置引用时会明确报告，不在前端、项目或下载请求中暴露令牌。需要 Figma 账号对文件的访问权限以及相应的 `file_content:read` 范围。Figma 的额度和速率限制按账号及计划决定；代码不自动重试 429。

`inspect` 读取明确指定的文件及节点，返回服务实际提供的版本和内存快照身份；`read_snapshot` 分页读取处理过的节点数据，临时链接和疑似凭据被隐藏。`export` 要求明确节点、版本和 SVG/PNG 格式，以 Figma 真实渲染结果保存项目原件和来源回执；不支持的下载域名、空渲染、活动 SVG 内容或外部引用会拒绝。文件、节点和版本的对应关系来自 Figma HTTPS 响应，而不是本地独立签名证明。

`brand_candidates` 只从已读取快照统计节点纯色填充/描边及文字默认字体，保留节点身份和出现次数；它不测量视觉面积，也不自动判断主色、配色语义、品牌标识或文字局部样式。深度限制、渐变、图片、混合、透明度继承和局部覆盖均在返回说明中明确。

`open_svg` 将已保存并核对的 SVG 交给原生 Vector；`open_image` 将已保存 PNG 交给原生 Photo，作为独立图片源。两者均保留原件及稳定导入预约，源保存回执记录 Figma 来源和原文件摘要；中断后 `reconcile` 检查已保存源和操作回执，不重复创建。PNG 导入不会还原 Figma 的节点、图层、组件或文字语义。`designcraft_plan` 可以通过 `figmaResources` 引用已保存的导出；计划历史恢复和项目包核对来源。项目包保留原件、回执及已确认的原生关联，未确认的导入预约会如实计数；操作日志和临时下载 URL 不打包。

上述 `designcraft_figma_source` 是 REST 只读适配；另有代码阶段的 Figma MCP 适配，能力与限制见 `figma-mcp-adapter.md`。REST 来源本身不提供 MCP 写入、新文件、组件库或设计系统同步。SVG 文本可保留为文本或转为路径，但字体、布局、图片和效果是否可编辑及外观是否一致仍须在实际编辑器中验证。渲染来源域名可能变化，当前只接受代码列出的有限来源。

本次没有访问任何 Figma 账号、读取真实文件或运行功能、界面、恢复和项目包验证。官方依据：[文件与节点接口](https://developers.figma.com/docs/rest-api/file-endpoints/)、[个人令牌](https://developers.figma.com/docs/rest-api/personal-access-tokens/)、[速率限制](https://developers.figma.com/docs/rest-api/rate-limits/)。
