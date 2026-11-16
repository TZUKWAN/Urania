# Venice 音乐和音效队列（代码已写入，尚未功能验证）

`designcraft_venice_audio` 从 DSH 的 Venice 凭据引用读取实际 `music` 模型目录；`models` 给出模型原始能力描述与摘要，`quote` 请求服务端报价。用户明确要求相应创作时，`start` 会再次读取模型并检查摘要，仅提交该模型明确声明支持的可选字段。每次任务有稳定操作身份；重复的同一身份只返回已有记录，不再次提交。

提交前记录远端接收状态不确定；收到实际 `queue_id` 后另写接收回执并保存任务。`status` 查看项目记录，`stop` 仅停止本地等待，`recover` 检查已有任务和接收回执并取回同一队列任务，不重新发送生成请求。下载时不自动删除服务端文件；实际响应需符合支持的音频类型和文件头，才保存为项目素材。`cleanup` 只在用户明确要求时调用，并先核对本地文件；若清理状态不确定，不自动重复。项目包代码包含任务、接收回执、未发布记录及已保存音频。

当前音频路径处理音乐和音效，不包括语音克隆或变声。模型参数命名、账户权限、报价和输出格式以服务实际响应为准；未识别的字段或格式会拒绝。Venice 视频另有独立代码及私有链接保护方案，具体范围见 `venice-video-adapter.md`，同样尚未功能验证。

本次未调用 Venice 模型目录、报价或生成接口，也未运行功能、界面、并发或项目包验证。官方依据：[音乐和音效](https://docs.venice.ai/guides/media/music-and-sound-effects)、[队列](https://docs.venice.ai/api-reference/endpoint/audio/queue)、[报价](https://docs.venice.ai/api-reference/endpoint/audio/quote)、[取回](https://docs.venice.ai/api-reference/endpoint/audio/retrieve)。
