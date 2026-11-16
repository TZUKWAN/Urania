# 将项目字体加入网页

网页工作区可以选择当前项目已登记的 TTF 或 OTF 字体，明确填写所需的 CSS 字体族名称、字重和样式，再选择“加入当前网页”。`designcraft_html project_fonts` 列出项目字体；`attach_font` 可按网页 `id`、已保存的 `revision`、`fontId`、`family`、`weight`、`fontStyle` 和稳定 `operationKey` 执行相同操作。字体族名称由使用者指定，不根据文件名猜测。

操作核对实际项目字体原件与来源，保留原网页版本，在新版本中加入字体文件和引用该字体的 CSS 文件。入口 HTML 不会被自动改写。返回的 `link` 可放入需要使用字体的 HTML 入口；页面还需用相同 `font-family` 指定实际文本。若入口存在 `base` 标签，则不提供猜测的链接，路径需按实际 base 配置处理。CSS 内的字体 URL 相对于该 CSS 文件；参见 [MDN 的 `@font-face src` 说明](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40font-face/src)。

基础版本发生变化时不会覆盖已有网页；界面会保留待核对的操作身份与独立草稿。结果不确定时，可在界面“核对字体加入”，或用同一网页 `id`、基础 `revision` 和 `operationKey` 调用 `font_status`；不要重复创建版本。项目包代码会核对网页新增文件与对应项目字体原件来源，字体之后停用不删除已保存版本中的文件。

登记和复制字节不代表已有使用、嵌入或分发许可；权限需依据字体实际条款确认。字体族映射是用户输入，不证明字形覆盖、页面渲染或 PPT 内嵌成功，也不会自动移除 Google Fonts 等外链。OpenType 的字体嵌入权限字段见 [Microsoft OpenType OS/2 规范](https://learn.microsoft.com/en-us/typography/opentype/spec/os2)。

网页转演示的字体候选收集代码会遍历已加载且处于本次网页资源范围内的本地 CSS `@import` 样式表，并按导入样式表的地址解析相对字体路径；外链、未加载或不可读取的导入会提示。遍历有深度与规则数量限制；候选不等于实际加载或内嵌，同名字体的不同字重、条件媒体规则和后备字体仍需检查。CSSOM 中导入样式表的关系见 [MDN CSSStyleSheet 文档](https://developer.mozilla.org/en-US/docs/Web/API/CSSStyleSheet)。

字体候选名称按引号及 CSS 转义识别首选字体族，名称内的逗号不作为分隔符；超出预算或无法解析的名称给出提示。该有限解析不代表识别所有 CSS 情况，也不能判断浏览器逐字形回退；相关代码尚未运行验证。参见 [CSS Syntax 转义规则](https://www.w3.org/TR/css-syntax-3/#escaping) 和 [MDN font-family](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/font-family)。

此路径目前只完成代码和静态检查，尚未进行实际字体导入、网页预览、转换、项目包、界面或视觉验证。
