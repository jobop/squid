# Channel 扩展：P1 沙箱方向（草图，未实现）

P0 仅提供**受信路径 + manifest 校验 + 单插件失败隔离**；扩展代码与主进程共享地址空间。以下为后续演进可选方案，便于评审与排期。

## 目标

在保持 `ChannelPlugin` **语义不变**的前提下，将不可信或高风险的出站/入站执行迁出主进程，缩小泄漏面。

## 方案 A：子进程适配器

- 主进程仅保留薄 **RPC 客户端**；扩展逻辑运行在 Node/Bun **子进程**，通过 `stdio` 或本地 socket 传递 JSON 消息。
- `ChannelPlugin.outbound.sendText` 等在主进程侧序列化为 RPC，子进程内调用真实 SDK。
- **优点**：操作系统级隔离、可限 CPU/内存（部分平台）。  
- **缺点**：延迟、部署复杂度、进程生命周期与桌面应用退出同步。

## 方案 B：Worker 线程

- 将纯计算或与网络无关的校验放入 `worker_threads`（若 Bun 支持度足够）。
- **限制**：许多 IM SDK 依赖主线程或 native 模块，往往仍须子进程方案。

## 方案 C：V8 Isolate / `isolated-vm` 类

- 在单进程内做轻量隔离；需评估 **Bun 兼容性** 与 Node API 可用性。
- 适合**极受限**的脚本扩展，不适合直接托管官方大型 SDK。

## 接口草图（RPC）

```text
主进程                          扩展子进程
  |  spawn(channel-plugin.json)    |
  |----------------init----------->|
  |<-------------ready--------------|
  |  outbound.sendText(payload) --> |
  |<------------- result ----------|
```

消息信封可包含 `correlationId`、`channelId`、`method`、`payload`；错误带 `code` + `message`（脱敏）。

## 验收建议（未来）

- 子进程崩溃不拖垮主进程；主进程退出向子进程发 SIGTERM 并限时 SIGKILL。  
- 单扩展 RPC 超时与配额（消息大小、QPS）可配置。

当前里程碑仍以 P0 文档与配置为准；实现本页方案前须单独 OpenSpec/设计评审。
