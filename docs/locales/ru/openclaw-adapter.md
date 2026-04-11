# Адаптация плагинов OpenClaw

## Обзор

Как подключать channel‑плагины экосистемы **OpenClaw** к squid.

## Контекст

**OpenClaw** — платформа мультиканального AI‑ассистента с богатой экосистемой каналов (Feishu, DingTalk, Telegram, Discord и др.). В squid есть **минимальный адаптер**, позволяющий запускать такие плагины в ограниченном объёме.

## Стратегия совместимости

**Принцип:** реализуем по мере необходимости, без полного паритета API.

- Покрываем интерфейсы, которые плагин реально вызывает  
- Для остального — разумные значения по умолчанию или деградация  
- Полный набор OpenClaw API не тянем за один раз  

## Архитектура

```
┌──────────────────┐
│ OpenClaw Plugin  │
│  (Feishu/…)      │
└────────┬─────────┘
         │ вызовы API OpenClaw
         ▼
┌──────────────────┐
│ OpenClawAdapter  │  ◄── слой адаптации
└────────┬─────────┘
         │ перевод в контракт squid
         ▼
┌──────────────────┐
│   EventBridge    │
└──────────────────┘
```

## Feishu: inbound API адаптера и EventBridge (встроенная реализация)

В squid встроено **прямое подключение к Feishu Open Platform** (`FeishuChannelPlugin`), без рантайма пакета `@openclaw/feishu`. Единственная точка приёма входящих:

| Поле | Описание |
|------|----------|
| Модуль | `extensions/feishu/src/inbound-adapter.ts` |
| Функция | `submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload)` |
| Поля payload | `text` (обязательно), `chatId`, `messageId`, `senderOpenId`, `accountId`, `raw` (опционально) |
| Имя события | `channel:inbound` (константа `CHANNEL_INBOUND_EVENT`) |
| Форма события | `ChannelInboundEvent` в `src/channels/bridge/event-bridge.ts`, в т.ч. `channelId: 'feishu'`, `timestamp` |

**По умолчанию** `FeishuChannelPlugin` поднимает **WebSocket long connection** (`feishu-ws-inbound.ts`), затем тот же адаптер. Режим `connectionMode: webhook` использует `POST /api/feishu/webhook` с проверкой подписи (и опционально расшифровкой) и **только** вызывает указанную функцию.

**Мост squid**: `registerFeishuSquidBridge(taskAPI)` вызывается из расширения в `setup.initialize` (инжект `TaskAPI` через `initializeBuiltinChannels(taskAPI)`), подписка на `channel:inbound`, пользовательский текст → `TaskAPI.executeTaskStream` с `conversationId` вида `feishubot_<chatId>`, ответ модели — `sendFeishuTextMessageTo` в **тот же** чат/группу. Дополнительно можно подписаться на `eventBridge.onChannelInbound`.

Любой будущий **OpenClaw‑совместимый shim** обязан проксировать вход плагина в `submitFeishuInboundToEventBridge` (или эквивалент), чтобы удовлетворять спецификации `feishu-openclaw-compatibility`.

## Шаги внедрения

### Шаг 1: изучить плагин

Определить, какие символы OpenClaw реально используются.

**Пример: Feishu**

```bash
cd openclaw-main/extensions/feishu
grep -r "runtime\." src/
```

Типичные вызовы: `runtime.text.chunkText`, `runtime.reply.dispatchReply`, `runtime.routing.resolveAgentRoute`, `runtime.pairing.*`.

### Шаг 2: реализовать адаптер

Файл `src/channels/openclaw-adapter/adapter.ts` (идея):

```typescript
import { ChannelPlugin } from '../types';
import { eventBridge } from '../bridge/event-bridge';

export class OpenClawChannelAdapter implements ChannelPlugin {
  id: string;
  meta: ChannelMeta;
  capabilities: ChannelCapabilities;

  constructor(private openclawPlugin: any) {
    this.id = openclawPlugin.id || 'openclaw-plugin';
    this.meta = {
      name: openclawPlugin.name || 'OpenClaw Plugin',
      description: 'OpenClaw channel adapter',
      category: 'third-party',
    };
    
    this.capabilities = {
      outbound: { text: true, media: false, rich: true, streaming: false },
      inbound: { text: true, commands: true, interactive: true },
    };
  }

  config = {
    get: (key: string) => this.openclawPlugin.config?.[key],
    set: (key: string, value: any) => {
      if (this.openclawPlugin.config) {
        this.openclawPlugin.config[key] = value;
      }
    },
    getAll: () => this.openclawPlugin.config || {},
    validate: () => true,
  };

  outbound = {
    sendText: async (params) => {
      try {
        await this.openclawPlugin.send({
          content: params.content,
          title: params.title,
        });
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    },
    sendNotification: async (message) => {
      return this.outbound.sendText({
        content: message.content,
        title: message.title,
      });
    },
  };

  inbound = {
    onMessage: (callback) => {
      if (this.openclawPlugin.on) {
        this.openclawPlugin.on('message', (msg: any) => {
          callback(msg);
          if (msg.type === 'command') {
            eventBridge.sendCommand(msg.command, msg.args, this.id);
          }
        });
      }
    },
  };

  status = {
    check: async () => {
      if (this.openclawPlugin.isConnected) {
        const connected = await this.openclawPlugin.isConnected();
        return {
          healthy: connected,
          message: connected ? 'Connected' : 'Disconnected',
        };
      }
      return { healthy: true, message: 'Unknown' };
    },
  };

  setup = {
    initialize: async () => {
      if (this.openclawPlugin.initialize) {
        await this.openclawPlugin.initialize();
      }
      eventBridge.onTaskComplete((event) => {
        this.outbound.sendText({
          content: `Task ${event.taskId} completed`,
        });
      });
    },
    cleanup: async () => {
      if (this.openclawPlugin.cleanup) {
        await this.openclawPlugin.cleanup();
      }
    },
  };
}
```

### Шаг 3: минимальный runtime

```typescript
// src/channels/openclaw-adapter/runtime.ts

export const createMinimalRuntime = () => {
  return {
    text: {
      chunkText: (text: string, limit: number) => {
        const chunks: string[] = [];
        for (let i = 0; i < text.length; i += limit) {
          chunks.push(text.slice(i, i + limit));
        }
        return chunks;
      },
      chunkMarkdownText: (text: string, limit: number) => {
        return createMinimalRuntime().text.chunkText(text, limit);
      },
    },
    reply: {
      dispatchReply: async (params: any) => {
        console.log('Dispatch reply:', params);
      },
    },
    routing: {
      resolveAgentRoute: (params: any) => {
        return { sessionKey: 'default', agentId: 'default' };
      },
    },
  };
};
```

### Шаг 4: загрузка плагина

```typescript
import { OpenClawChannelAdapter } from './openclaw-adapter/adapter';
import { createMinimalRuntime } from './openclaw-adapter/runtime';

async function loadOpenClawPlugin(pluginPath: string) {
  const pluginModule = await import(pluginPath);
  const PluginClass = pluginModule.default || pluginModule.Plugin;
  const runtime = createMinimalRuntime();
  const plugin = new PluginClass({ runtime });
  const adapter = new OpenClawChannelAdapter(plugin);
  channelRegistry.register(adapter);
  if (adapter.setup) {
    await adapter.setup.initialize();
  }
  return adapter;
}
```

## Известные ограничения

### Не поддерживается в текущей версии

1. Полный набор runtime‑интерфейсов  
2. Pairing / сопряжение  
3. Медиа upload/download  
4. Сложная привязка сессий  
5. Allowlist и прочие политики  

### Что делать

- **Вариант 1:** доращивать адаптер по стеку ошибок  
- **Вариант 2:** заглушки для второстепенных вызовов  
- **Вариант 3:** форкнуть плагин и убрать лишние зависимости  

## Чеклист тестирования адаптера

- [ ] Плагин грузится и инициализируется  
- [ ] Приходят уведомления о задачах из squid  
- [ ] Исходящие сообщения доходят до платформы  
- [ ] Входящие с платформы обрабатываются  
- [ ] Команды пользователя доходят до squid  
- [ ] Ошибки обрабатываются  
- [ ] После обрыва возможен реконнект  

## Пример: Feishu

```typescript
npm install @openclaw/feishu-plugin

import { loadOpenClawPlugin } from './channels/openclaw-adapter/loader';

const feishuPlugin = await loadOpenClawPlugin('@openclaw/feishu-plugin');
feishuPlugin.config.set('appId', 'your-app-id');
feishuPlugin.config.set('appSecret', 'your-app-secret');

await feishuPlugin.outbound.sendText({
  content: 'Test message',
});
```

## Диагностика

### Не грузится плагин

Путь, зависимости, стек ошибок на предмет отсутствующих методов.

### Не отправляется сообщение

Конфигурация (appId, appSecret), сеть, документация целевой платформы.

### Несовместимость интерфейса

По ошибке добавить метод в адаптер или упростить реализацию.

## Вклад

Если вы адаптировали плагин:

1. Список необходимых интерфейсов  
2. Код адаптера  
3. Тесты  
4. Обновление этой страницы  

## Ссылки

- [OpenClaw на GitHub](https://github.com/openclaw/openclaw)  
- [Типы channel runtime OpenClaw](https://github.com/openclaw/openclaw/blob/main/src/plugins/runtime/types-channel.ts)  
- [Документация Feishu Open Platform](https://open.feishu.cn/document/)  
