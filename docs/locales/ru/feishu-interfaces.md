# Ключевые интерфейсы плагина OpenClaw Feishu

По результатам анализа `openclaw-main/extensions/feishu` ниже перечислены основные зависимости плагина.

## Базовые зависимости

### 1. Plugin SDK Core

- `createChatChannelPlugin` — фабрика чат‑канала
- `defineChannelPluginEntry` — описание точки входа плагина

### 2. Channel Config

- `createHybridChannelConfigAdapter` — гибридный адаптер конфигурации
- `adaptScopedAccountAccessor` — доступ к аккаунтам

### 3. Outbound (исходящие сообщения)

- `createRuntimeOutboundDelegates` — делегаты рантайма
- Требуется реализовать:
  - `sendMessageFeishu` — текст
  - `sendCardFeishu` — карточка
  - `updateCardFeishu` — обновление карточки
  - `editMessageFeishu` — редактирование сообщения

### 4. Directory (контакты)

- `createChannelDirectoryAdapter`
- `createRuntimeDirectoryLiveAdapter`
- Реализации:
  - `listFeishuDirectoryPeers`
  - `listFeishuDirectoryGroups`

### 5. Status

- `createComputedAccountStatusAdapter`
- `probeFeishu`
- `inspectFeishuCredentials`

### 6. Account Management

- `resolveFeishuAccount`
- `listFeishuAccountIds`
- `resolveDefaultFeishuAccountId`

### 7. Session & Routing

- `getSessionBindingService`
- `resolveFeishuOutboundSessionRoute`
- `buildFeishuConversationId`
- `parseFeishuConversationId`

### 8. Policy & Pairing

- `createPairingPrefixStripper`
- `resolveFeishuGroupToolPolicy`
- `formatAllowFromLowercase`

### 9. Setup

- `feishuSetupAdapter`
- `feishuSetupWizard`

### 10. Runtime

- `setFeishuRuntime`
- `getFeishuRuntime`

## Минимальная стратегия для squid

Для адаптации достаточно **ядра обмена сообщениями**:

### Обязательно (P0)

1. Отправка — `sendMessageFeishu`  
2. Приём — webhook или polling  
3. Учётные данные — appId, appSecret  
4. Проверка состояния — валидность учётных данных  

### Желательно (P1)

5. Управление сессией / контекстом  
6. Обработка ошибок сети и аутентификации  

### Опционально (P2)

7. Карточки  
8. Синхронизация контактов  
9. Политики для групп  
10. Продвинутая маршрутизация  

## Упрощённое сопоставление

```typescript
Интерфейс OpenClaw              →  squid
─────────────────────────────────────────────────────────
sendMessageFeishu()             →  FeishuChannelPlugin.outbound.sendText() + Open Platform im/v1/messages
Webhook                         →  POST /api/feishu/webhook → submitFeishuInboundToEventBridge()
                                →  eventBridge.onChannelInbound (не inbound.onMessage)
inspectFeishuCredentials()     →  status.check() (проверка tenant token)
resolveFeishuAccount()          →  config.getAll() с маскировкой / ~/.squid/feishu-channel.json
```

## Состояние реализации (проверено, P0)

- **Каталог**: `extensions/feishu/src/`; стабильные re-export могут идти через `src/channels/feishu`.
- **Исходящий текст**: `extensions/feishu/src/lark-client.ts` + `FeishuChannelPlugin`; нужны `defaultReceiveId` / `defaultReceiveIdType`.
- **Вход по умолчанию (WebSocket)**: `extensions/feishu/src/feishu-ws-inbound.ts`, `@larksuiteoapi/node-sdk` (`WSClient` + `EventDispatcher`), исходящее подключение к Feishu с этой машины, **без** публичного webhook / туннеля. `connectionMode` по умолчанию `websocket`.
- **Опциональный webhook**: `extensions/feishu/src/webhook-handler.ts` при `connectionMode: webhook`; алгоритм подписи согласован с OpenClaw `monitor.transport.ts`. Сообщения от самого бота (`sender_type === app`) повторно не принимаются.
- **Разбор сообщений**: `extensions/feishu/src/message-inbound.ts` (`parseFeishuImReceiveForInbound`) общий для WS и HTTP.
- **Связь с squid**: `extensions/feishu/src/squid-bridge.ts` (`registerFeishuSquidBridge`, вызывается из `FeishuChannelPlugin.setup.initialize` при наличии инжектированного `taskAPI`) — текст пользователя в `TaskAPI.executeTaskStream`, ответ — `sendFeishuTextMessageTo` в тот же `chat_id`.
- **Конфигурация**: `~/.squid/feishu-channel.json`; `GET/POST /api/channels/feishu/config` (без полных секретов в ответе). **Загрузка**: включите `feishu` в `config/channel-extensions.json` или `~/.squid/channel-extensions.json`; при неполном outbound‑конфиге точка входа расширения падает, в списке каналов может отображаться синтетическая строка Feishu.
- **Совместимость**: [COMPATIBILITY.md](./COMPATIBILITY.md).

## Приоритеты внедрения

1. **Фаза 1** — базовый обмен: appId/appSecret, исходящий текст, вход (webhook), связка с EventBridge  
2. **Фаза 2** — сессии, ретраи, мониторинг состояния  
3. **Фаза 3** — карточки, группы, права  
