# OpenClaw Feishu plugin — core interface inventory

Based on analysis of `openclaw-main/extensions/feishu`, the Feishu plugin depends on the following surfaces:

## Core dependencies

### 1. Plugin SDK core

- `createChatChannelPlugin` — construct a chat channel plugin  
- `defineChannelPluginEntry` — declare the plugin entrypoint  

### 2. Channel configuration

- `createHybridChannelConfigAdapter` — hybrid configuration adapter  
- `adaptScopedAccountAccessor` — account accessor adapter  

### 3. Outbound (sending messages)

- `createRuntimeOutboundDelegates` — runtime outbound delegates  
- Implementations typically include:  
  - `sendMessageFeishu` — send text  
  - `sendCardFeishu` — send interactive cards  
  - `updateCardFeishu` — update cards  
  - `editMessageFeishu` — edit messages  

### 4. Directory (contacts)

- `createChannelDirectoryAdapter`  
- `createRuntimeDirectoryLiveAdapter`  
- Expected helpers:  
  - `listFeishuDirectoryPeers`  
  - `listFeishuDirectoryGroups`  

### 5. Status (health checks)

- `createComputedAccountStatusAdapter`  
- Expected helpers:  
  - `probeFeishu`  
  - `inspectFeishuCredentials`  

### 6. Account management

- `resolveFeishuAccount`  
- `listFeishuAccountIds`  
- `resolveDefaultFeishuAccountId`  

### 7. Session and routing

- `getSessionBindingService`  
- `resolveFeishuOutboundSessionRoute`  
- `buildFeishuConversationId`  
- `parseFeishuConversationId`  

### 8. Policy and pairing

- `createPairingPrefixStripper`  
- `resolveFeishuGroupToolPolicy`  
- `formatAllowFromLowercase`  

### 9. Setup

- `feishuSetupAdapter`  
- `feishuSetupWizard`  

### 10. Runtime

- `setFeishuRuntime`  
- `getFeishuRuntime`  

## Minimal implementation strategy

For squid, only **core messaging** is required initially.

### Must have (P0)

1. **Send messages** — `sendMessageFeishu`  
2. **Receive messages** — webhook or long connection  
3. **Account configuration** — `appId`, `appSecret`  
4. **Status checks** — validate credentials  

### Recommended (P1)

5. **Session management** — track conversational context  
6. **Error handling** — network/auth failures  

### Optional (P2)

7. Card messages  
8. Directory sync  
9. Group policy  
10. Advanced routing  

## Simplified mapping

```text
OpenClaw surface                    →  squid surface
──────────────────────────────────────────────────────────────
sendMessageFeishu()                 →  FeishuChannelPlugin.outbound.sendText()
                                       + Open Platform im/v1/messages
Webhook listener                    →  POST /api/feishu/webhook
                                       → submitFeishuInboundToEventBridge()
                                       → eventBridge.onChannelInbound
                                       (not inbound.onMessage)
inspectFeishuCredentials()          →  status.check() (tenant token probe)
resolveFeishuAccount()              →  config.getAll() redacted view
                                       + ~/.squid/feishu-channel.json
```

## Implementation status (verified, P0)

- **Package path**: `extensions/feishu/src/` (bundled extension); stable imports may also use `src/channels/feishu` re-exports.  
- **Outbound text**: `extensions/feishu/src/lark-client.ts` + `FeishuChannelPlugin`; requires `defaultReceiveId` / `defaultReceiveIdType`.  
- **Default inbound (WebSocket)**: `extensions/feishu/src/feishu-ws-inbound.ts` using `@larksuiteoapi/node-sdk` `WSClient` + `EventDispatcher`; connects outbound from the desktop—**no public webhook or tunnel required**. Default `connectionMode` is `websocket`.  
- **Optional webhook inbound**: `extensions/feishu/src/webhook-handler.ts` when `connectionMode: webhook`; signing matches OpenClaw `monitor.transport.ts`. Bot-originated messages (`sender_type === app`) are filtered from re-ingest.  
- **Parsing**: `extensions/feishu/src/message-inbound.ts` (`parseFeishuImReceiveForInbound`) shared by WS and HTTP.  
- **squid bridge**: `extensions/feishu/src/squid-bridge.ts` (`registerFeishuSquidBridge`, registered from `FeishuChannelPlugin.setup.initialize` when `taskAPI` is injected) routes user text to `TaskAPI.executeTaskStream` and replies with `sendFeishuTextMessageTo` the originating `chat_id`.  
- **Configuration**: `~/.squid/feishu-channel.json`; `GET/POST /api/channels/feishu/config` (responses omit full secrets). **Loading**: enable the `feishu` extension in `config/channel-extensions.json` or `~/.squid/channel-extensions.json`; if outbound config is incomplete the extension factory may fail while the Channels list still shows a synthetic Feishu row.  
- **Compatibility**: see `docs/COMPATIBILITY.md`.

## Rollout phases

1. **Phase 1** — basic messaging  
   - Configure `appId` / `appSecret`  
   - Send text to Feishu  
   - Receive Feishu events (webhook path)  
   - Wire EventBridge  

2. **Phase 2** — hardening  
   - Session management  
   - Retries  
   - Monitoring  

3. **Phase 3** — advanced features  
   - Cards  
   - Group administration  
   - Fine-grained permissions  
