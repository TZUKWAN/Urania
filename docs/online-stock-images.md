# 在线图片搜索与来源记录

状态：功能代码已写，尚未运行搜索、下载、图片导入、恢复、UI 或项目包验证。磁盘标识见 README；用户当前 DSH 是否加载此代码未知。

工作区“更多操作 → 在线找图”直接进入 Wikimedia Commons 公共图库，也可从“图片生成与处理 → 在线找图”进入。此入口不要求 AI 图片服务、图库 API 密钥、OpenDesign/Vela 或 Figma。用户主动搜索后可查看结果元数据、选择预览、保存图片与来源，再打开独立 Photo 源；编辑后沿用原生派生素材和放入海报/PPT 的流程。独立图片编辑仍要求现有 Photo 运行时可用。

`designcraft_stock` 在同一 DSH 会话提供 search、search_read、list、capture、read、credits、open、reconcile。search 保存实际官方响应和经过筛选的候选；search_read 读取既有搜索，无网络。capture 保存所选实际图片，read/credits 重新核对已保存内容和搜索来源；open 使用稳定 operationKey 预约新的图片源，已确认的相同预约则打开该源的当前保存版本，不重复导入；reconcile 根据唯一匹配的真实保存源恢复来源关联，不重发不确定的导入。列表仅检查记录结构，不证明图片字节仍可用。

搜索采用 MediaWiki generator=search，File 命名空间，每页最多 8 项，人工继续分页到 offset 1000；只采用 PNG/JPEG，单文件最多 16 MiB，返回图片长边最多 4096、总像素最多 24 Mi。请求缩放尺寸 1600，但采用并核对服务实际返回的尺寸，不假定恰好 1600。格式、尺寸或元数据不合条件的项会跳过，并显示数量；没有合适结果时明确显示空页。不会用示例图或占位结果填补。

预览由宿主在用户点击后读取，只访问 Commons API 和官方 upload.wikimedia.org 的 Commons 图片路径，拒绝跳转、凭据、外部任意 URL。网页只显示经过宿主检查并核对 SHA-256 的本地 Blob，不自动加载外站缩略图。请求有 20 秒超时、2 个并发上限、同类至少 500ms 的间隔和响应大小上限，无自动重试。停止/关闭会中止本地等待，不能证明远端未收到请求；项目中已保存的内容保留。

预览/下载前重新查询同一 pageId，核对图片版本、摘要、地址、实际返回尺寸及许可元数据是否与保存搜索一致；改变时要求重新搜索。下载后检查实际 PNG/JPEG 文件头、尺寸与 Content-Type；若是原尺寸文件，还核对服务声明的原件字节数和 SHA-1（十六进制或 MediaWiki base36），另为所有下载记录实际 SHA-256。缩放图通常没有服务提供的成品内容摘要，SHA-256 仅标识实际下载的字节，不能独立证明缩放图与原图的像素关系。文件头准入也不等于完整解码或视觉验收。

`design/.designcraft/stock-images/` 保存搜索、图片、导入预约及来源关联；`design/assets/` 保存原始 API JSON 与实际图片。搜索记录保存作者、许可、署名、附加条款等原始字段和可显示文本。许可为第三方声明，可能缺失或含多种许可，不能自动判定商用权、肖像权等。界面提供原始说明页和许可链接，credits 可下载署名 JSON。服务提供的缩放图会明确标记。原生 PNG/JPEG/PPTX 单文件导出不会自动嵌入图库署名；发布时应同时保留并核对署名记录。

原生导入保留原件，首个 resource-import 回执记录同一图库图片 ID、输入摘要及稳定预约身份。源保存不确定时不再自动导入；已有关联也要核对实际源版本、原件和预约。项目包包含这些记录、搜索原始响应、图片及额外的 `design/stock-credits/*.json`，并核对记录、原件、关联和导出期间变化；存在损坏或未知/未完成记录时拒绝生成不完整项目包。已保存图片的本地读取和打包不需要重新访问在线图库。

这是 DesignCraft 自己的公共图库接入，不代表 OpenDesign 原版 stock-search 守护进程及 run/project 授权项目绑定已经完成。上游原版仍需真实 OD/Vela 环境与相应授权，不以猜测的 DSH 路径或假令牌替代。

资料（2026-11-12 读取官方文档，未调用查询 API）：[Search](https://www.mediawiki.org/wiki/API:Search)、[Continue](https://www.mediawiki.org/wiki/API:Continue)、[Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo)、[CommonsMetadata](https://www.mediawiki.org/wiki/Extension:CommonsMetadata)、[API etiquette](https://www.mediawiki.org/wiki/API:Etiquette)、[User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy)、[原件 SHA-1 格式](https://www.mediawiki.org/wiki/Manual:Image_table#img_sha1)、[Commons 内容复用说明](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia)。
