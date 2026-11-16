# Venice 视频队列与私有链接（代码已写入，尚未功能验证）

`designcraft_venice_video` 在当前 DSH 对话中提供实际模型目录、报价、视频入队和已有任务取回。`models` 返回服务端模型描述和 `specHash`；`quote` 查询服务报价；用户明确要求生成时 `start` 重新读取并核对模型能力与摘要。当前仅提交提示词、模型明确声明的时长、分辨率、比例及明确声明支持的项目图片；其他参考、增强、语音和授权字段尚未接入。

代码在发送前保存不确定状态，得到 `queue_id` 后保存接收回执，停止本地等待不代表服务端停止。`recover` 只查询已有任务，不重新提交。实际返回的 MP4 需通过类型及文件头检查，才保存为项目不可变素材；视频内容本身仍须单独验证。

部分模型在入队时只返回一次 `download_url`。代码使用 Windows 当前用户 DPAPI 保护该链接，密文只存放在项目的 `design/.designcraft/venice-video-private/`，不会写进任务回执、对话或项目包。开始付费请求前的运行时代码会预先检查保护器；但本次尚未运行该检查。只有同一 Windows 用户及其可用的用户配置才能解密，链接本身也可能过期。若进程在收到链接和保护完成之间中断，链接仍可能丢失；不能声称可以恢复所有中断。需要私有链接且视频尚未取回的任务不能打出误称可移植的项目包。

`cleanup` 删除 Venice 端保存的媒体；`revoke_link` 撤销私有链接。两者只能在用户明确要求并核对本地视频后执行，状态不确定时不自动重复。它们是两个不同操作，均不会自动触发。

本次仅编译 `runtimes/private-link-protector.exe`、编写代码并做静态检查；未运行保护器或其预检，未请求 Venice 模型、报价或视频服务，未进行功能、界面、并发、恢复或项目包验证。官方依据：[视频队列与私有链接](https://docs.venice.ai/guides/media/video-generation)、[Windows DPAPI](https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection)。
