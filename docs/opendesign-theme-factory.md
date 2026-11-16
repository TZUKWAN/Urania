# OpenDesign 外部主题候选（代码阶段）

OpenDesign 的 `skills/theme-factory` 是指向 Anthropic 上游技能的目录项。先通过已有外部资源发现、检查和保存入口，选择真实仓库版本并保留完整原包及许可；主题展示 PDF 可在外部原包面板中选择并请求下载。不要把目录项本身当作已经应用的主题。

用户明确选择原包内 `skills/theme-factory/themes/*.md` 文件后，资源面板的“读取主题配色与字体”或 `designcraft_resources external_theme` 可读取该已保存文件。代码重新核对原包与 Git 文件身份，按已观察的 Markdown 结构返回原文颜色名、HEX、描述和标题/正文字体名；不硬编码主题值，也不从背景色或强调色猜测品牌主色。结构变化、LFS 指针或无法安全解析时会拒绝并提示读取原文。

用户可以在“项目品牌色”中读取已保存的 theme-factory 原包，选择具体主题文件和一个颜色，再输入品牌名称并明确创建。服务端重新读取实际主题，确认所选 HEX 与原文件一致，保存原文和来源，并在新品牌上记录首次选色；随后可使用已有品牌绑定和主色更新能力。此操作不会修改现有品牌或原生对象，也不会安装或设置字体；已建立的品牌主色后续可以独立更改，来源记录保留最初所选颜色。若建立设计计划，可用 `externalResources` 记录该文件的实际 `bundleId`、路径和 `gitSha1`。返回的字体名称不代表字体已安装、可用于中文或有分发许可；具体授权、字体覆盖、颜色对比及最终视觉效果仍需核对。此路径尚未运行功能、界面、原包下载、PDF 显示、主题品牌创建或实际品牌应用验证。

资料依据：[OpenDesign 目录项](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/skills/theme-factory/SKILL.md)、[上游 theme-factory 原技能](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/theme-factory/SKILL.md)。
