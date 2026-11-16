# 外部 GitHub 原包中的 Git LFS（代码阶段）

- 保存外部技能原包时保留并校验原始 Git blob。符合受支持格式的 LFS 指针保留在原包中并标注目标 SHA-256 与大小；原包和界面明确区分指针与尚未获取的实际文件。
- `designcraft_resources` 的 `external_lfs` 及网页资源面板的对应操作，可按固定仓库、提交和路径请求公开 GitHub media 文件，在写入前校验文件大小和 SHA-256。已保存且来源无误的文件可复用，不需要再次请求。普通 `external_materialize` 不会把指针当原件。
- 独立回执记录原包、Git 指针 blob 和实际内容的身份。设计计划可引用已核对的 LFS 文件，计划恢复重新核对来源；项目字体按既有格式和 4 MiB 上限登记；项目包同时核对并保存原包、指针、实际文件与回执。
- 单个实际文件上限为 16 MiB，设计计划引用单文件上限为 1 MiB；不跟随重定向、不发送个人令牌，使用固定 GitHub HTTPS 域名。仅实现无扩展的标准 v1 指针；未知扩展、历史格式、私有仓库、自定义 LFS 服务、超限或远端不可用时会明确失败。GitHub 的 media 路径并非适用于所有服务配置，不能保证所有 LFS 项目均可获取。
- 识别到一个原包许可文件不保证涵盖所有文件；下载和登记不执行外部脚本、不安装系统字体，也不代表原生编辑器已加载。源文件的许可和署名需按实际情况处理。
- 本轮只写入代码并做静态检查，未下载 LFS 实物、未运行 UI、服务或端到端功能验证。实际网络可用性和功能行为留待刘总授权验证。

参考：[Git LFS 指针规范](https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md)、[GitHub LFS 说明](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)、[GitHub Git blob API](https://docs.github.com/en/rest/git/blobs)。
