# OpenDesign 设计简报规则工作流

`designcraft_brief` 与设计计划面板的“OpenDesign 简报规则”使用固定 `skills/design-brief/SKILL.md` 原文对应的规则版本。`resolve` 读取并核对实际原规则后，根据用户的项目名称、实际简报及明确维度生成规范文本和维度来源报告；它不调用模型，也不自动保存。`create` 在明确操作后保存固定原规则、实际简报、设计计划和独立版本化网页预览；`status`/`list` 检查已保存状态，`recover` 只恢复完整的本地预约。相同操作身份和输入可继续未完成保存，不覆盖后续人工编辑。

计划面板提供中文标签的明确维度选择，用户可选择配色、强调色、正文及标题字体、布局、风格、密度和排除项；也可展开高级 JSON 编辑。未明确选择时仍按现有简报识别及默认规则处理，排除项可区分“未指定”和“明确不排除”。JSON 无效时选项停用、原文保留；每次选择都更新同一草稿并要求重新解析。控件不会把中文自动解析成用户要求，也不修改规则版本 1 或已有简报任务。

支持 `natural` 和 `ilang` 两种输入。自然语言模式只识别原规则列出的有限英文关键词，不声称理解全部自然语言；中文和其他未识别意图应由用户或当前 DSH 会话明确填写维度。I-Lang 模式读取 `[PLAN:@DESIGN|type=…]` 后的明确字段；原文示例中的附加字段会保留并提示，未定义的布局细节不会被猜测。显式维度可覆盖识别结果并提示核对；冲突、未知值或原规则缺少具体映射时会停止并要求明确选择。所有未指定项均列出所用默认值及理由。

`dimensions` 可使用的字段和值：

- `palette`：`navy_and_white`、`earth_tones`、`monochrome_dark`、`light_clean`。
- `accent`：`coral`、`electric_blue`、`emerald`、`muted_sage`、`slate`。
- `typography`：`inter`、`system_ui`、`dm_sans`、`georgia`。
- `display`：`space_grotesk`、`clash_display`、`same_as_body`、`playfair`。
- `layout`：`single_column`、`two_column`、`asymmetric`。
- `mood`：`professional_minimal`、`playful`、`brutalist`、`editorial`。
- `density`：`compact`、`balanced`、`spacious`。
- `exclude`：由 `animations`、`gradients`、`stock_photos`、`carousel` 组成的数组。

规范中的颜色、字号和间距来自固定原规则的明确表格；预览中的按钮、卡片和输入框是标明用途的组件示意，不是用户真实业务数据。预览不加载外部脚本或字体；字体可用性、颜色对比、视觉效果及实际工作流仍需核对。用户可以继续编辑保存的计划和网页，初始来源及规则摘要保留。设计计划面板保留原有手工草稿，规则生成不会自动删除草稿；响应丢失后可核对任务或用相同草稿及操作身份继续。

项目包代码核对原规则、任务记录、初始计划、规范、输入维度和预览摘要，并按固定规则重算初始内容。规则处理器版本 1 必须保持兼容，后续改动应引入新版本而不是覆盖旧算法。此路径尚未运行功能、界面、恢复、视觉或项目包验证，也没有调用模型或生成用户作品。
