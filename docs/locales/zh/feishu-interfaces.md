# OpenClaw 飞书插件核心接口清单

基于对 `openclaw-main/extensions/feishu` 的分析，飞书插件主要使用以下接口：

## 核心依赖接口

### 1. Plugin SDK Core

- `createChatChannelPlugin` — 创建聊天 channel 插件
- `defineChannelPluginEntry` — 定义插件入口

### 2. Channel Config

- `createHybridChannelConfigAdapter` — 混合配置适配器
- `adaptScopedAccountAccessor` — 账号访问适配器

### 3. Outbound（发送消息）

- `createRuntimeOutboundDelegates` — 运行时出站代理
- 需要实现：
  - `sendMessageFeishu` — 发送文本消息
  - `sendCardFeishu` — 发送卡片消息
  - `updateCardFeishu` — 更新卡片
  - `editMessageFeishu` — 编辑消息

### 4. Directory（通讯录）

- `createChannelDirectoryAdapter` — 通讯录适配器
- `createRuntimeDirectoryLiveAdapter` — 运行时通讯录适配器
- 需要实现：
  - `listFeishuDirectoryPeers` — 列出联系人
  - `listFeishuDirectoryGroups` — 列出群组

### 5. Status（状态检查）

- `createComputedAccountStatusAdapter` — 计算账号状态
- 需要实现：
  - `probeFeishu` — 探测连接状态
  - `inspectFeishuCredentials` — 检查凭证

### 6. Account Management（账号管理）

- `resolveFeishuAccount` — 解析账号
- `listFeishuAccountIds` — 列出账号 ID
- `resolveDefaultFeishuAccountId` — 解析默认账号

### 7. Session & Routing（会话路由）

- `getSessionBindingService` — 获取会话绑定服务
- `resolveFeishuOutboundSessionRoute` — 解析出站会话路由
- `buildFeishuConversationId` — 构建会话 ID
- `parseFeishuConversationId` — 解析会话 ID

### 8. Policy & Pairing（策略和配对）

- `createPairingPrefixStripper` — 配对前缀处理
- `resolveFeishuGroupToolPolicy` — 群组工具策略
- `formatAllowFromLowercase` — 格式化 allowFrom

### 9. Setup（设置）

- `feishuSetupAdapter` — 设置适配器
- `feishuSetupWizard` — 设置向导

### 10. Runtime（运行时）

- `setFeishuRuntime` — 设置运行时
- `getFeishuRuntime` — 获取运行时

## 最小化实现策略

对于 squid 的适配，我们只需要实现**核心消息收发功能**：

### 必须实现 (P0)

1. **发送消息** — `sendMessageFeishu`
2. **接收消息** — 监听 webhook 或轮询
3. **账号配置** — appId, appSecret
4. **状态检查** — 验证凭证是否有效

### 建议实现 (P1)

5. **会话管理** — 记录会话上下文
6. **错误处理** — 网络错误、认证失败等

### 可选实现 (P2)

7. 卡片消息
8. 通讯录同步
9. 群组策略
10. 高级路由

## 简化的接口映射

```typescript
OpenClaw 接口                    →  squid 接口
─────────────────────────────────────────────────────────
sendMessageFeishu()              →  FeishuChannelPlugin.outbound.sendText() + 开放平台 im/v1/messages
监听 webhook                      →  POST /api/feishu/webhook → submitFeishuInboundToEventBridge()
                                  →  eventBridge.onChannelInbound（非 inbound.onMessage）
inspectFeishuCredentials()       →  status.check()（tenant token 探测）
resolveFeishuAccount()           →  config.getAll() 脱敏视图 / ~/.squid/feishu-channel.json
```

## 实现状态（已验证，P0）

- **实现目录**：`extensions/feishu/src/`（随仓库分发的扩展包）；稳定 import 可继续用 `src/channels/feishu` 桶文件 re-export。
- **发送文本**：`extensions/feishu/src/lark-client.ts` + `FeishuChannelPlugin`；需配置 `defaultReceiveId` / `defaultReceiveIdType`。
- **默认入站（WebSocket 长连接）**：`extensions/feishu/src/feishu-ws-inbound.ts`，使用 `@larksuiteoapi/node-sdk` 的 `WSClient` + `EventDispatcher`，本机主动连飞书，**无需公网 Webhook / 穿透**。`connectionMode` 默认为 `websocket`。
- **可选 Webhook 入站**：`extensions/feishu/src/webhook-handler.ts`（`connectionMode: webhook` 时使用）；签名算法与 OpenClaw `monitor.transport.ts` 一致。机器人自身发送的消息（`sender_type === app`）不会再次入站。
- **消息解析**：`extensions/feishu/src/message-inbound.ts`（`parseFeishuImReceiveForInbound`）供 WS 与 HTTP 共用。
- **与 squid 对话**：`extensions/feishu/src/squid-bridge.ts`（`registerFeishuSquidBridge`，由 `FeishuChannelPlugin.setup.initialize` 在获得注入的 `taskAPI` 时注册）将用户消息接到 `TaskAPI.executeTaskStream`，回复 `sendFeishuTextMessageTo` 到原 `chat_id`。
- **配置**：`~/.squid/feishu-channel.json`；`GET/POST /api/channels/feishu/config`（响应不含完整密钥）。**加载**：须在 `config/channel-extensions.json`（或 `~/.squid/channel-extensions.json`）中启用 `feishu` 扩展；出站配置不完整时扩展入口会失败，渠道列表仍显示合成飞书行。
- **兼容性结论**：见 [COMPATIBILITY.md](./COMPATIBILITY.md)。

## 实现优先级

1. **第一阶段** — 基础消息收发
   - 配置 appId/appSecret
   - 发送文本消息到飞书
   - 接收飞书消息（webhook）
   - 集成 EventBridge

2. **第二阶段** — 完善功能
   - 会话管理
   - 错误重试
   - 状态监控

3. **第三阶段** — 高级功能
   - 卡片消息
   - 群组管理
   - 权限控制
