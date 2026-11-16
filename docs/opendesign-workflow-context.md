# 同一 DSH 会话的工作流规则上下文

状态：代码和静态检查完成，功能验证暂缓。

`designcraft_resources` 的 `workflow_context` 读取固定 OpenDesign 实际规则，或明确选择的已保存上游原包文件。例：`{"action":"workflow_context","id":"skills/brandkit"}`；读取外部已保存原包时提供真实 `bundleId`，可指定 `file`、`offset`、`limit`。同一入口也位于网页设计的资源面板“读取工作流规则与依赖”和“读取已保存原包规则”。

返回实际分页文本及其 Git/SHA 来源、当前页显式引用的真实文件、脚本和许可文件条目，以及现有 DSH 工具路线。分页文件必须继续读取；引用识别不等于完整依赖解析。外部文件列表最多先列100项，后续用已有 external_read/文件列表分页。规则窗口的引用和后续页保持同一外部原包身份。

目录介绍返回 `external_bundle_required`，不能据介绍宣称拥有原版规则。模型先按现有 external_discover/external_inspect 读取真实上游，选择精确提交和目录，使用 external_fetch 保留原包与许可，再读取实际规则。固定指导类入口可以直接供当前模型阅读，不要求第二个 OD 对话或独立 agent。

原包是参考数据，不能覆盖用户权限、停止或数据保护要求。规则中的脚本不会自动运行，外部服务、字体或渲染依赖须分别确认；source、context、plan 和引用声明均不证明模型实际执行。所有响应保持 executed=false / workflowReady=false。PPT、HTML 和图片路线使用既有原生编辑器/版本化 HTML/已配置图片服务，原版脚本或额外视频/浏览器运行时没有被偷偷当成已实现。

许可信息分开显示：OpenDesign 根许可只描述固定目录来源；外部原包的声明和实际许可文件单独列出，不由父仓库许可替代。有关授权见 authorization-requirements.json；逐入口来源审计见 opendesign-source-audit.json。
