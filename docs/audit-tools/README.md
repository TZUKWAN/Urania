# 静态审计工具

这三个脚本只读取源码、锁、许可和原有证据，生成 JSON 审计文件；不导入或执行产品 JS，不调用模型或图库，不启动编辑器。使用 Python 3.11+；字体元数据核对另依赖现有 fontTools。依赖并非插件运行要求，工具不会安装包。

从发行目录运行：`python docs/audit-tools/audit_opendesign_sources.py`、`python docs/audit-tools/audit_delivery_dependencies.py`、`python docs/audit-tools/audit_core_sources.py`。需要其他根目录时设置 `DESIGNCRAFT_AUDIT_ROOT`。报告会更新当前目录的 docs；审计既有交付包时，先解压到独立目录以保留原包不变。

历史文件定位的原始机器路径只作取证记录；发行包无法凭这些路径找回原机器外部的旧文件。`historical-evidence-audit.json` 和 `historical-evidence-reconciliation.json` 保留实际发现，不伪造缺档。`engine-source-snapshots.zip` 保留三引擎安装构建记录的229个源码/字体输入及原许可，内部清单可逐字节核对；在对应固定上游提交上复现宿主时使用，不能当成整个上游仓库或已通过运行验收。


2026-11-13：本轮功能证据见 ../verification/release-validation-20261113.json。这里的 source/dependency/import 命令仅进行静态核对，不表示整轮未测试；可用 DESIGNCRAFT_AUDIT_ROOT 指向候选根目录。audit_five_gaps_code.py 保留原 UI150 代码阶段约束，不是当前版本的功能测试或候选审计入口。
