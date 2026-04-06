# Channel 扩展插件（动态加载）

## P0 信任模型（必读）

扩展通过 Bun **动态 `import()`** 与主进程**同进程**运行，**不是**内存沙箱隔离。请**只安装并配置你信任的扩展**（来源可信、可审计）。未配置的 `roots` 时不会加载任何扩展；**飞书**随仓库放在 `extensions/feishu/`，默认由 `config/channel-extensions.json` 的 `enabled: ["feishu"]` 加载（渠道页显示来源为「扩展」）。

优先级与冲突：

- **内置** 仅 WebUI；**飞书**与其它扩展经加载器注册。扩展 **不得覆盖** 已注册的相同 `id`（内置 `webui` 先于扩展），冲突时跳过并记入 `GET /api/channels` 的 `errors`。
- 两个扩展包声明同一 `id` 时，**先成功注册者生效**，后者跳过。

## 包结构

每个插件一个子目录，父目录由配置 `roots` 指向：

```text
<root>/
  my-plugin/
    channel-plugin.json
    plugin.ts        # 或 .js；由 main 指定
```

### channel-plugin.json

| 字段 | 说明 |
|------|------|
| `id` | 唯一 id，须与入口工厂返回的 `ChannelPlugin.id` 一致 |
| `name` | 展示名称 |
| `version` | 版本字符串 |
| `main` | 相对插件目录的 ESM 入口，不得为绝对路径或含 `..` |
| `capabilities` / `permissions` | 可选，预留 |

### 入口模块

须 **默认导出** 或命名导出 **`createChannelPlugin`**，签名为返回 `ChannelPlugin` 或 `Promise<ChannelPlugin>` 的工厂函数。

实现接口见 `src/channels/types.ts`（`config`、`outbound`、`status` 必填；`setup` 建议用于长连接等）。

## 配置

合并两处（都存在则合并 `roots`；`enabled` 以 **~/.squid/channel-extensions.json 优先**）：

1. `squid/config/channel-extensions.json`（可自建，参考 `config/channel-extensions.example.json`）
2. `~/.squid/channel-extensions.json`

字段：

- **`roots`**：`string[]`，每个元素是包含**多个插件子目录**的父路径。可为绝对路径，或相对 **squid 仓库根目录** 的相对路径。
- **`enabled`**（可选）：若省略或 `null`，则所有通过校验的候选包都会尝试加载；若为 `[]`，则不加载任何扩展；若为非空数组，则**仅**加载列出的 `id`。

### 用户目录 `~/.squid/extensions`（无需写进 roots）

若本机存在目录 **`~/.squid/extensions`**，则会**自动**作为额外扫描根与上述 `roots` 合并（目录不存在则忽略，不报错）。可将个人插件放在例如 `~/.squid/extensions/my-plugin/channel-plugin.json`。是否加载仍受 **`enabled`** 白名单约束（例如默认仅 `feishu` 时，须把自定义插件 `id` 加入 `~/.squid/channel-extensions.json` 或项目配置中的 `enabled`）。

修改配置后需**重启**宿主进程。

## 示例

仓库内自带 `extensions/example-echo-channel/`。在 `config/channel-extensions.json` 写入：

```json
{
  "roots": ["extensions"],
  "enabled": ["echo-demo"]
}
```

重启后，侧栏「渠道」中应出现来源为「扩展」的 `echo-demo`。

## API

- `GET /api/channels` 返回 `{ "channels": [...], "errors": [...] }`。每项 channel 含 `source`: `"builtin"` | `"extension"`。`errors` 为扩展扫描/加载阶段的非致命错误（不含密钥）。

## 本地调试

1. 在 `roots` 下新建子目录与 `channel-plugin.json`。  
2. 入口使用 TypeScript 时，确保由 **Bun** 加载（当前桌面后端为 Bun）。  
3. 查看控制台 `[ChannelExtensions]` 日志与 UI 顶部橙色提示框。

## 会话忙排队与回贴（无需再扩 QueuedCommand）

与飞书 / Telegram 一致，新渠道若要 **入队完成后把助手正文发回同一对话**：

1. 在扩展的 **`setup.initialize`** 里，若工厂上下文带有 **`ctx.taskAPI`**（宿主调用 `initializeBuiltinChannels(taskAPI)` 时会注入），则调用你的 **`registerXxxSquidBridge(ctx.taskAPI)`**（或等价逻辑），在桥内 **`taskAPI.addChannelQueuedCompleteHandler(...)`**，仅在 `cmd.channelReply?.channelId === '<你的 channel id>'` 时发消息；在 **`setup.cleanup`** 中调用桥返回的卸载函数。**宿主不必**再逐渠道 `import registerXxxSquidBridge`。
2. 会话忙时 **`enqueueFromRequest(..., { channelReply: { channelId: '<同上>', chatId: '<路由键>' } })`**。`chatId` 为核心透传的字符串，语义由渠道自行解释。

类型见 `src/utils/messageQueueManager.ts` 的 **`ChannelQueueReply`**。勿再向核心增加 `xxxChatId` 字段。

## 与内置贡献的关系

- **内置**：仍可通过 PR 在 `src/channels` 中增加实现并在 `initializeBuiltinChannels` 注册。  
- **扩展**：适合私有插件、试验性渠道，无需改核心注册表；安全责任在部署方配置与扩展来源。
