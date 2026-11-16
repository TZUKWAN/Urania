# 颜色对比计算与 OpenDesign 色彩专家（代码阶段）

`designcraft_resources` 的 `color_contrast` 和品牌面板的“计算文字对比”对用户明确输入的两个不透明 `#RRGGBB` sRGB 颜色，使用 WCAG 2.2 相对亮度与对比度公式。返回完整计算值，并用未四舍五入的值分别判断普通/大号文字的 AA、AAA 数值阈值；界面显示值截取到四位小数，不用于阈值判断。此计算不读取当前画布，也不修改任何作品。

UI150 新增 APCA 0.0.98G、OKLCH/OKLab/sRGB/Display P3 转换及完整已保存原生结构的颜色检查。APCA 是实验性指标，颜色数值不证明整稿无障碍符合性。标准中的例外、主题继承、复杂背景、像素遮挡与实际字体度量仍需按内容核对；未解析部分明确列出。实施和边界见 [本轮说明](five-gaps-and-deck.md)。

OpenDesign `skills/color-expert` 是指向上游仓库的目录说明，不包含完整知识库。需要其规则时，可通过既有外部资源入口按实际仓库及提交发现、读取并在需要时保存原包；原文及依赖/第三方材料的许可范围须单独核对，不自动安装或运行脚本。2026-11-10 对仓库公开树的只读检查记录到提交 `5bf7c7704d56bccc6aeea38c36bcf449abe56a6c`，不保证之后版本不变。

本次只写入代码并做静态检查，未运行颜色计算、界面、项目、模型或外部服务功能验证。依据：[W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)、[对比度最低要求说明](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)、[OpenDesign 目录项](https://github.com/nexu-io/open-design/blob/12d970eacc8971150e3c76470d2a9afe16dc2ed1/skills/color-expert/SKILL.md)、[色彩专家上游仓库](https://github.com/meodai/skill.color-expert)。
