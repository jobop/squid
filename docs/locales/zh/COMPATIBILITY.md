# OpenClaw 飞书插件与 squid 兼容性结论

本文档对应变更 `integrate-feishu-openclaw-channel` 任务第 1 节，可从任务 1.1 的源码路径追溯。

## 1.1 实际 `openclaw/plugin-sdk/*` 引用（extensions/feishu）

以下路径来自对 `openclaw-main/extensions/feishu` 下 `.ts` 源码的静态扫描（`from "openclaw/..."`）：

| 模块路径 |
|----------|
| `openclaw/plugin-sdk/account-helpers` |
| `openclaw/plugin-sdk/account-id` |
| `openclaw/plugin-sdk/account-resolution` |
| `openclaw/plugin-sdk/allow-from` |
| `openclaw/plugin-sdk/channel-actions` |
| `openclaw/plugin-sdk/channel-config-helpers` |
| `openclaw/plugin-sdk/channel-contract` |
| `openclaw/plugin-sdk/channel-pairing` |
| `openclaw/plugin-sdk/channel-policy` |
| `openclaw/plugin-sdk/channel-send-result` |
| `openclaw/plugin-sdk/config-runtime` |
| `openclaw/plugin-sdk/conversation-runtime` |
| `openclaw/plugin-sdk/core` |
| `openclaw/plugin-sdk/directory-runtime` |
| `openclaw/plugin-sdk/feishu` |
| `openclaw/plugin-sdk/lazy-runtime` |
| `openclaw/plugin-sdk/media-runtime` |
| `openclaw/plugin-sdk/outbound-runtime` |
| `openclaw/plugin-sdk/reply-payload` |
| `openclaw/plugin-sdk/routing` |
| `openclaw/plugin-sdk/runtime-store` |
| `openclaw/plugin-sdk/secret-input` |
| `openclaw/plugin-sdk/setup` |
| `openclaw/plugin-sdk/status-helpers` |
| `openclaw/plugin-sdk/text-runtime` |
| `openclaw/plugin-sdk/webhook-ingress` |
| `openclaw/plugin-sdk/zod` |

根目录 `package.json` 将包声明为 `@openclaw/feishu`，**peer** 依赖 `openclaw >= 2026.3.27`，构建与运行均假设完整 OpenClaw 宿主。

## 1.2 与 `docs/feishu-interfaces.md` P0 对照（squid 侧）

| P0 项 | squid 状态 |
|-------|------------|
| 发送消息（等价 `sendMessageFeishu`） | **已有**：`FeishuChannelPlugin` + 飞书开放平台 HTTP（`im/v1/messages`） |
| 接收消息（Webhook） | **已有**：`POST /api/feishu/webhook` → 验签/解密 → `submitFeishuInboundToEventBridge` |
| 账号配置 appId / appSecret | **已有**：`~/.squid/feishu-channel.json` + `GET/POST /api/channels/feishu/config`（响应脱敏） |
| 状态检查（等价 `probeFeishu`） | **部分**：通过拉取 `tenant_access_token` 判断凭证是否有效 |

中文说明亦见 [feishu-interfaces.md](./feishu-interfaces.md)。

## 1.3 结论

- **不可直接 import 即用**：官方插件依赖大量 `plugin-sdk` 与 OpenClaw 运行时，与 Electrobun/Bun 桌面进程模型不一致，需 shim 或重写协议层。
- **适配层 / 薄封装可用**：squid 采用 **飞书开放平台直连 + `ChannelPlugin` + Adapter 入站 API → `EventBridge`**，不内嵌 OpenClaw 飞书插件运行时。
- **需独立实现的部分**：OpenClaw 侧的会话绑定、卡片、通讯录、配对向导等 P1/P2 能力；若未来要做 **兼容 shim**，应将原入站路径转发至 `submitFeishuInboundToEventBridge`（见 [openclaw-adapter.md](./openclaw-adapter.md)）。

## 1.4 可选 PoC

未在隔离分支做「实例化 `@openclaw/feishu`」运行时 PoC：静态分析已能证明符号依赖面（§1.1）。若需 PoC，应在拉齐 `openclaw` 宿主与插件 SDK 的独立 worktree 中记录报错栈。

## 6. `feishu-openclaw-compatibility` spec 走查（任务 5.3）

- **评估结论文档化**：本文 §1.3 将结论归为「需适配或独立实现」，§1.1 列出 OpenClaw 符号依据（不少于 3 项）。
- **P0 缺口**：§1.2 标明 P0 已由内置直连实现或等价覆盖；缺口主要为 OpenClaw 专有会话/卡片等（P1/P2）。
- **直接复用插件验收**：§1.3 已降级为独立实现路径；未声称可直接加载官方插件包。
- **shim 与 Adapter**：当前实现为**薄封装协议层**（非 shim）；任务 4.6 记为 **N/A**；若未来引入 shim，须转发至 `submitFeishuInboundToEventBridge`（见 [openclaw-adapter.md](./openclaw-adapter.md)）。
