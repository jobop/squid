# OpenClaw plugin adapter guide

## Overview

How to adapt OpenClaw-style channel plugins to run on squid.

## Background

OpenClaw is a multi-channel assistant platform with a rich plugin ecosystem (Feishu, DingTalk, Telegram, Discord, etc.). squid ships a **minimal adapter layer** so those plugins can be wired in incrementally.

## Compatibility strategy

**Principle:** implement what you need, not full parity.

- Cover interfaces the plugin actually calls  
- Provide sensible defaults or graceful degradation  
- Avoid mirroring the entire OpenClaw surface in one pass  

## Architecture

```
┌──────────────────┐
│ OpenClaw Plugin  │
│ (Feishu / etc.)  │
└────────┬─────────┘
         │
         │ calls OpenClaw interfaces
         ▼
┌──────────────────┐
│ OpenClawAdapter  │  ◄── adapter layer
└────────┬─────────┘
         │
         │ maps to squid primitives
         ▼
┌──────────────────┐
│   EventBridge    │
└──────────────────┘
```

## Feishu: adapter inbound API and EventBridge (built-in path)

squid’s production Feishu path is **direct Feishu Open Platform access** (`FeishuChannelPlugin`) and does **not** require the OpenClaw `@openclaw/feishu` runtime. The **only** supported inbound injection point is:

| Item | Detail |
|------|--------|
| Module | `extensions/feishu/src/inbound-adapter.ts` |
| Function | `submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload)` |
| Payload | `text` (required), optional `chatId`, `messageId`, `senderOpenId`, `accountId`, `raw` |
| Event | `channel:inbound` (`CHANNEL_INBOUND_EVENT` constant) |
| Shape | `ChannelInboundEvent` (see `src/channels/bridge/event-bridge.ts`), includes `channelId: 'feishu'`, `timestamp` |

**By default** `FeishuChannelPlugin` opens a **WebSocket long connection** (`feishu-ws-inbound.ts`) and funnels events through this adapter. With `connectionMode: webhook`, HTTP `POST /api/feishu/webhook` verifies signatures (and optional decryption) and **only** calls the function above.

**squid Feishu bridge**: `registerFeishuSquidBridge(taskAPI)` runs inside the Feishu extension’s `setup.initialize` (hosts inject `TaskAPI` via `initializeBuiltinChannels(taskAPI)`), subscribes to `channel:inbound`, forwards user text to `TaskAPI.executeTaskStream` (`conversationId` pattern `feishubot_<chatId>`), and sends model replies with `sendFeishuTextMessageTo` back to the **same** chat or group. Extensions may also subscribe to `eventBridge.onChannelInbound`.

Future **OpenClaw-compatible shims** MUST forward plugin-side inbound traffic to `submitFeishuInboundToEventBridge` (or an equivalent wrapper) to satisfy the `feishu-openclaw-compatibility` spec.

## Implementation steps

### Step 1: study the plugin

Understand which OpenClaw APIs the target plugin calls.

**Example: Feishu plugin**

```bash
cd openclaw-main/extensions/feishu
grep -r "runtime\." src/
```

Common calls include:

- `runtime.text.chunkText`  
- `runtime.reply.dispatchReply`  
- `runtime.routing.resolveAgentRoute`  
- `runtime.pairing.*`  

### Step 2: build the adapter

Sketch for `src/channels/openclaw-adapter/adapter.ts`:

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
      description: 'OpenClaw plugin adapter',
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
      return { healthy: true, message: 'Unknown status' };
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

### Step 3: provide runtime helpers

OpenClaw plugins may expect a runtime object. Minimal stub:

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
        console.log('dispatchReply:', params);
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

### Step 4: load the plugin

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

## Known gaps in this release

1. **Runtime surface** — only a small subset is implemented  
2. **Pairing flows** — not implemented  
3. **Media upload/download** — not implemented  
4. **Session binding** — complex routing not implemented  
5. **Permission engines** — allowlists not implemented  

## Mitigation strategies

- **Incremental implementation** — add APIs as errors surface  
- **Stubs** — return no-ops for non-critical calls (clearly marked)  
- **Fork the plugin** — remove unused dependencies when possible  

## Test checklist

- [ ] Plugin loads and initializes  
- [ ] Task completion notifications reach the plugin  
- [ ] Outbound messages reach the target platform  
- [ ] Inbound user messages reach squid  
- [ ] Commands propagate through EventBridge  
- [ ] Errors are handled predictably  
- [ ] Reconnect behavior works for long-lived transports  

## Example: Feishu plugin wiring

```typescript
npm install @openclaw/feishu-plugin

import { loadOpenClawPlugin } from './channels/openclaw-adapter/loader';

const feishuPlugin = await loadOpenClawPlugin('@openclaw/feishu-plugin');

feishuPlugin.config.set('appId', 'your-app-id');
feishuPlugin.config.set('appSecret', 'your-app-secret');

await feishuPlugin.outbound.sendText({
  content: 'Smoke test message',
});
```

## Troubleshooting

### Plugin fails to import

1. Verify the path  
2. Install peer dependencies  
3. Read the stack trace for missing symbols  

### Outbound failures

1. Validate credentials  
2. Check outbound network access  
3. Consult the vendor API documentation  

### Interface mismatch

1. Identify the missing call site  
2. Extend the adapter or runtime stub  
3. Prefer real implementations over silent mocks when behavior matters  

## Contributing successful adapters

1. Document required interfaces  
2. Share adapter code  
3. Add automated tests  
4. Update this guide  

## References

- [OpenClaw repository](https://github.com/openclaw/openclaw)  
- [OpenClaw channel runtime types](https://github.com/openclaw/openclaw/blob/main/src/plugins/runtime/types-channel.ts)  
- [Feishu Open Platform documentation](https://open.feishu.cn/document/)  
