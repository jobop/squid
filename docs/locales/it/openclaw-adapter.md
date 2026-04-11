# Adattamento plugin OpenClaw

## Panoramica

Come collegare i plugin canale OpenClaw all’esecuzione in squid.

## Contesto

OpenClaw è una piattaforma multicanale matura con un ecosistema di plugin (Feishu, DingTalk, Telegram, Discord, ecc.). squid fornisce un **adattatore minimale** per eseguire tali plugin nell’ambiente desktop.

## Strategia di compatibilità

**Principio:** implementare solo ciò che serve, senza perseguire la compatibilità totale.

- Implementare le interfacce effettivamente usate dal plugin  
- Fornire valori predefiniti o percorsi di degradazione sensati  
- Non replicare l’intera superficie OpenClaw in un colpo solo  

## Architettura

```
┌──────────────────┐
│ Plugin OpenClaw  │
│   (Feishu/…)     │
└────────┬─────────┘
         │
         │ chiamate API OpenClaw
         ▼
┌──────────────────┐
│ OpenClawAdapter  │  ◄── livello adattamento
└────────┬─────────┘
         │
         │ conversione verso API squid
         ▼
┌──────────────────┐
│   EventBridge    │
└──────────────────┘
```

## Feishu: API Adapter in ingresso ed EventBridge (implementazione integrata)

squid integra la **connessione diretta all’Open Platform Feishu** (`FeishuChannelPlugin`) senza dipendere dal runtime OpenClaw del pacchetto `@openclaw/feishu`. L’**unico** punto di ingresso per i messaggi in arrivo è:

| Voce | Descrizione |
|------|-------------|
| Modulo | `extensions/feishu/src/inbound-adapter.ts` |
| Funzione | `submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload)` |
| Payload | `text` (obbligatorio), `chatId`, `messageId`, `senderOpenId`, `accountId`, `raw` (JSON grezzo opzionale) |
| Nome evento | `channel:inbound` (costante `CHANNEL_INBOUND_EVENT`) |
| Forma payload | `ChannelInboundEvent` (vedi `src/channels/bridge/event-bridge.ts`), include `channelId: 'feishu'`, `timestamp` |

**Predefinito:** `FeishuChannelPlugin` avvia una **connessione WebSocket long-lived** (`feishu-ws-inbound.ts`) per ricevere eventi, poi li passa allo stesso adapter; solo con `connectionMode: webhook` si usa la rotta HTTP `POST /api/feishu/webhook`, che dopo verifica firma (e decifratura opzionale) **chiama soltanto** la funzione sopra.

**Bridge Feishu ↔ squid:** `registerFeishuSquidBridge(taskAPI)` è invocato dall’estensione in `setup.initialize` (`TaskAPI` iniettato tramite `initializeBuiltinChannels(taskAPI)`), sottoscrive `channel:inbound`, passa il testo utente a `TaskAPI.executeTaskStream` (`conversationId` `feishubot_<chatId>`) e invia la risposta del modello con `sendFeishuTextMessageTo` alla **stessa** chat/gruppo. È possibile sottoscrivere anche `eventBridge.onChannelInbound` per logica aggiuntiva.

Un futuro **shim** compatibile OpenClaw **deve** inoltrare l’ingresso del plugin verso `submitFeishuInboundToEventBridge` (o equivalente), in linea con la spec `feishu-openclaw-compatibility`.

## Passi di implementazione

### Passo 1: analisi del plugin

Capire quali API OpenClaw il plugin usa realmente.

**Esempio: plugin Feishu**

```bash
cd openclaw-main/extensions/feishu
grep -r "runtime\." src/
```

Esempi comuni:
- `runtime.text.chunkText` — suddivisione testo
- `runtime.reply.dispatchReply` — invio risposta
- `runtime.routing.resolveAgentRoute` — risoluzione instradamento
- `runtime.pairing.*` — gestione pairing

### Passo 2: creare l’adattatore

File `src/channels/openclaw-adapter/adapter.ts`:

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
          message: connected ? 'Connesso' : 'Non connesso',
        };
      }
      return { healthy: true, message: 'Stato sconosciuto' };
    },
  };

  setup = {
    initialize: async () => {
      if (this.openclawPlugin.initialize) {
        await this.openclawPlugin.initialize();
      }
      eventBridge.onTaskComplete((event) => {
        this.outbound.sendText({
          content: `Task ${event.taskId} completato`,
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

### Passo 3: runtime minimale

I plugin OpenClaw possono richiedere un runtime. Esempio minimale:

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

### Passo 4: caricamento plugin

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

## Limitazioni note

### Non supportato nella versione corrente

1. **Runtime completo** — solo sottoinsieme core  
2. **Pairing** — non implementato  
3. **Media** — upload/download non implementati  
4. **Sessioni complesse** — binding avanzato non implementato  
5. **Permessi** — allowlist e simili non implementati  

### Mitigazioni

- **Opzione 1:** implementare on-demand in base agli errori runtime  
- **Opzione 2:** mock o no-op per interfacce secondarie  
- **Opzione 3:** modificare il plugin se il codice è sotto controllo  

## Checklist di test

Dopo l’adattamento verificare:

- [ ] Caricamento e init del plugin  
- [ ] Ricezione notifiche attività da squid  
- [ ] Invio messaggi verso la piattaforma (Feishu, ecc.)  
- [ ] Ricezione messaggi dalla piattaforma  
- [ ] Inoltro comandi utente a squid  
- [ ] Gestione errori  
- [ ] Riconnessione dopo disconnessione  

## Esempio: plugin Feishu

```typescript
npm install @openclaw/feishu-plugin

import { loadOpenClawPlugin } from './channels/openclaw-adapter/loader';

const feishuPlugin = await loadOpenClawPlugin('@openclaw/feishu-plugin');
feishuPlugin.config.set('appId', 'your-app-id');
feishuPlugin.config.set('appSecret', 'your-app-secret');

await feishuPlugin.outbound.sendText({
  content: 'Messaggio di prova',
});
```

## Risoluzione problemi

### Caricamento plugin fallito

1. Percorso plugin corretto  
2. Dipendenze installate  
3. Stack trace per API mancanti  

### Invio messaggi fallito

1. Configurazione (appId, appSecret, …)  
2. Connettività di rete  
3. Documentazione API della piattaforma  

### Incompatibilità interfaccia

1. Leggere l’errore e l’API chiamata  
2. Estendere l’adattatore  
3. Fornire versione semplificata se accettabile  

## Contributi

Se adatti con successo un plugin OpenClaw:

1. Elenca le API necessarie  
2. Condividi il codice adattatore  
3. Aggiungi test  
4. Aggiorna questa documentazione  

## Riferimenti

- [Documentazione OpenClaw](https://github.com/openclaw/openclaw)
- [Definizioni tipo Channel OpenClaw](https://github.com/openclaw/openclaw/blob/main/src/plugins/runtime/types-channel.ts)
- [Documentazione Open Platform Feishu](https://open.feishu.cn/document/)
