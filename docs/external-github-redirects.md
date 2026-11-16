# OpenDesign 外部 GitHub 仓库跳转（代码阶段）

对于 OpenDesign 目录项声明的 GitHub 仓库，解析代码支持仓库改名或转移时的官方 HTTPS 跳转。API 元数据请求最多跟随三次跳转，只接受 `api.github.com` 的仓库级路径；API 不可用时，尝试仅从 `github.com` 仓库页面的有限 HEAD 跳转取得新路径，再使用现有受限 Git 对象读取。禁止跳转至其他主机、带凭据或查询参数的地址；不发送个人令牌。

原始目录项、声明的仓库、实际仓库、跳转链、证据类型、固定提交及文件树分别记录。原包读取、项目包和 LFS 获取继续以该记录核对来源、文件树及内容摘要。GitHub 跳转关系来自当时的 HTTPS 响应，记录本身不能作为脱机独立签名证明；原地址被重新占用时，GitHub 可能不再给出旧跳转。未找到可信跳转、地址失效、仓库内容不匹配或无法识别的地址会报错，不自动猜测后继仓库。

此轮没有运行产品的网络获取、跳转、功能、界面、离线回读或项目包验证。上游 `sanjay3290/imagen` 的网页资料读取曾返回 404，没有验证其与任何其他仓库的关系。

参考：[GitHub REST 重定向](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#follow-redirects)、[重命名仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)、[转移仓库](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)。
