# Kernschnittstellen des OpenClaw-Feishu-Plugins

Auswertung von `openclaw-main/extensions/feishu` – zentrale Bausteine:

## Kernabhängigkeiten

### 1. Plugin SDK Core
- `createChatChannelPlugin`
- `defineChannelPluginEntry`

### 2. Channel-Konfiguration
- `createHybridChannelConfigAdapter`
- `adaptScopedAccountAccessor`

### 3. Outbound (Senden)
- `createRuntimeOutboundDelegates`
- zu implementieren u. a.:
  - `sendMessageFeishu`
  - `sendCardFeishu`
  - `updateCardFeishu`
  - `editMessageFeishu`

### 4. Directory (Adressbuch)
- `createChannelDirectoryAdapter`
- `createRuntimeDirectoryLiveAdapter`
- `listFeishuDirectoryPeers`, `listFeishuDirectoryGroups`

### 5. Status
- `createComputedAccountStatusAdapter`
- `probeFeishu`, `inspectFeishuCredentials`

### 6. Kontoverwaltung
- `resolveFeishuAccount`, `listFeishuAccountIds`, `resolveDefaultFeishuAccountId`

### 7. Sitzung und Routing
- `getSessionBindingService`
- `resolveFeishuOutboundSessionRoute`
- `buildFeishuConversationId`, `parseFeishuConversationId`

### 8. Policy und Pairing
- `createPairingPrefixStripper`
- `resolveFeishuGroupToolPolicy`
- `formatAllowFromLowercase`

### 9. Setup
- `feishuSetupAdapter`, `feishuSetupWizard`

### 10. Runtime
- `setFeishuRuntime`, `getFeishuRuntime`

## Minimalstrategie für squid

Für die squid-Anbindung reicht zunächst **Kern-Nachrichtenfluss**:

### P0 (Pflicht)
1. Nachrichten senden – `sendMessageFeishu`  
2. Nachrichten empfangen – Webhook oder Polling  
3. Kontokonfiguration – `appId`, `appSecret`  
4. Status – gültige Credentials  

### P1 (empfohlen)
5. Sitzungsverwaltung  
6. Fehlerbehandlung (Netzwerk, Auth)  

### P2 (optional)
7. Karten  
8. Adressbuch  
9. Gruppenrichtlinien  
10. erweitertes Routing  

## Schnittstellen-Mapping

```typescript
OpenClaw-Schnittstelle              →  squid
─────────────────────────────────────────────────────────
sendMessageFeishu()                 →  FeishuChannelPlugin.outbound.sendText() + Open Platform im/v1/messages
Webhook lauschen                    →  POST /api/feishu/webhook → submitFeishuInboundToEventBridge()
                                    →  eventBridge.onChannelInbound (nicht inbound.onMessage)
inspectFeishuCredentials()          →  status.check() (tenant_token-Probe)
resolveFeishuAccount()              →  config.getAll() (redigiert) / ~/.squid/feishu-channel.json
```

## Umsetzungsstand (verifiziert, P0)

- **Verzeichnis**: `extensions/feishu/src/`; stabile Imports ggf. über Re-Export in `src/channels/feishu`.  
- **Text senden**: `extensions/feishu/src/lark-client.ts` + `FeishuChannelPlugin`; Konfiguration `defaultReceiveId` / `defaultReceiveIdType`.  
- **Standard-Inbound (WebSocket)**: `extensions/feishu/src/feishu-ws-inbound.ts` mit `@larksuiteoapi/node-sdk` (`WSClient` + `EventDispatcher`), aktiv zu Feishu, **ohne** öffentlichen Webhook/Tunnel. Standard `connectionMode`: `websocket`.  
- **Optional Webhook**: `extensions/feishu/src/webhook-handler.ts` bei `connectionMode: webhook`; Signaturalgorithmus wie OpenClaw `monitor.transport.ts`. Eigene Bot-Nachrichten (`sender_type === app`) werden nicht erneut eingespeist.  
- **Parsing**: `extensions/feishu/src/message-inbound.ts` (`parseFeishuImReceiveForInbound`) für WS und HTTP.  
- **squid-Dialog**: `extensions/feishu/src/squid-bridge.ts` (`registerFeishuSquidBridge`, aus `FeishuChannelPlugin.setup.initialize` mit injiziertem `taskAPI`) → `TaskAPI.executeTaskStream`, Antworten per `sendFeishuTextMessageTo` an dieselbe `chat_id`.  
- **Konfiguration**: `~/.squid/feishu-channel.json`; `GET/POST /api/channels/feishu/config` ohne vollständige Secrets. **Laden**: `feishu` in `config/channel-extensions.json` bzw. `~/.squid/channel-extensions.json` aktivieren; unvollständige Outbound-Konfiguration kann am Einstieg scheitern, die Kanalliste zeigt trotzdem eine synthetische Feishu-Zeile.  
- **Kompatibilität**: siehe [COMPATIBILITY.md](./COMPATIBILITY.md).

## Priorisierte Phasen

1. **Phase 1** – Basis-Senden/Empfangen, App-ID/Secret, Webhook, EventBridge  
2. **Phase 2** – Sitzungen, Retries, Monitoring  
3. **Phase 3** – Karten, Gruppen, Berechtigungen  
