# UI169 DSH 性能兼容补丁

同一冻结源码已通过硬件三轮、严格软件三轮及两条无轨迹对照的真实完整流程。发行安装验收和公开回读记录由发布页 UI169-DELIVERY.json 提供。

本轮优化同时涉及 Urania 的发送准备和 DSH 的原生对话组件。插件文件本身不能覆盖所有宿主热点，因此提供独立、明确、可还原的兼容补丁。它仅支持 npm SDK `@deepseek-ai/dsh@0.2.2-rc.1` 的七个已固定摘要文件；不支持直接修改 Electron ASAR，不推测用户安装路径，不自动重启应用。其他版本或未知修改会拒绝，不宣称拥有相同性能结果。

## 安装与还原

先保存设计，再通过正常应用操作停止将要更新的那份 DSH。进入 Urania 插件根目录，对包含 `node_modules` 的**明确 SDK 安装目录**执行只读检查：

```powershell
node scripts/patch-dsh-performance.mjs --sdk-root C:/Tools/dsh --check
```

`C:/Tools/dsh` 是路径格式示例，必须替换为实际目录。它与 doctor 的 `DESIGNCRAFT_DSH_ROOT` 不同：doctor 指向该目录中的 `node_modules/@deepseek-ai/dsh` 包目录。检查输出会列出实际文件 SHA-256；`allOriginal=true` 表示可应用，`allPatched=true` 表示已是当前补丁。

```powershell
node scripts/patch-dsh-performance.mjs --sdk-root C:/Tools/dsh --apply
node scripts/patch-dsh-performance.mjs --sdk-root C:/Tools/dsh --check
```

所有替换、版本、上下文和输出摘要都先校验，再写源文件。原件和回执保存在明确 SDK 目录的 `.urania-performance-patch`。源文件及回执采用临时文件与原子更名；写入失败会恢复本次已写源文件。原件备份须保留。

还原时使用**与已应用补丁相同版本**的 Urania 脚本及计划：

```powershell
node scripts/patch-dsh-performance.mjs --sdk-root C:/Tools/dsh --restore
node scripts/patch-dsh-performance.mjs --sdk-root C:/Tools/dsh --check
```

还原后应为 `allOriginal=true`。升级不同补丁前先使用旧版脚本还原。若任何源文件被其他人修改，脚本会拒绝覆盖；保留备份和错误，先核对实际修改。脚本不会读取账号凭据、发送模型请求、操作项目设计文件或管理桌面窗口。

## 改动边界

- 对话布局读写、自动焦点、原生输入暂时锁定及视觉通知合并仅在 Urania 活跃工作台生效。底层输入锁、真实会话状态、草稿和最终设计引用校验继续执行。
- 会话正文、历史记录、选择和原生画布保留。视觉通知可在同帧合并；源 `getSnapshot()` 始终读取原生当前值。界面使用 React `useDeferredValue` 分配较大侧栏列表的渲染工作，原始状态及完成信号不延后。
- 文件侧栏的两条 CSS 规则采用全局等价兄弟选择器重写，匹配集合和优先级相同，避免后代变化使整页样式失效。这一项并非仅 Urania 作用域。
- 七个目标分别为 `dsh-client-ui-session`、`dsh-client-ui-chat`、`dsh-client-ui-conversation`、`dsh-client-ui-workspace`、`dsh-client-ui-sidebar-files` 的 `lib/client.js`，以及 `dsh-web-frontend/dist` 的主 JS 和 `index.html`。完整上下文、前后 SHA 在 `scripts/dsh-performance-patch.json`。

复用的原生片段来自相同 SDK 的 MIT 源码；原始署名和许可在 `licenses/dsh-native-components-MIT.txt`。发行包不包含测试 profile、用户会话、账号配置或完整 SDK 副本。

## 当前证据与限制

真实长回复覆盖发送、正文和收尾，三轮硬件及三轮严格软件连续达到公开固定门槛。原生草稿/引用、实时权限订阅、标题菜单、历史导航和安装器还原检查另有实际证据；底层会话及getSnapshot仍即时，UI会话/列表与Chat节点的视觉通知合并。此前失败、测量范围和设备边界见[本轮报告](REPORT.md)。
