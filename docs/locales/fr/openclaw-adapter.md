# Adaptateur pour plugins OpenClaw

## Vue d’ensemble

Ce document explique comment adapter les plugins de canal OpenClaw pour qu’ils s’exécutent dans squid.

## Contexte

OpenClaw est une plateforme multi-canaux pour assistants IA, avec un écosystème de plugins (Feishu, DingTalk, Telegram, Discord, etc.). squid fournit une couche d’adaptation minimale pour exécuter ces plugins.

## Stratégie de compatibilité

**Principe :** implémenter au besoin, sans viser une compatibilité exhaustive.

- Couvrir les interfaces réellement utilisées par le plugin  
- Fournir des valeurs par défaut ou des repli raisonnables  
- Ne pas implémenter toute l’API OpenClaw d’un bloc  

## Architecture

```
┌──────────────────┐
│ Plugin OpenClaw  │
│   (Feishu, etc.) │
└────────┬─────────┘
         │
         │ appels API OpenClaw
         ▼
┌──────────────────┐
│ OpenClawAdapter  │  ◄── couche d’adaptation
└────────┬─────────┘
         │
         │ conversion vers les primitives squid
         ▼
┌──────────────────┐
│   EventBridge    │
└──────────────────┘
```

## Feishu : API d’entrée adaptateur et EventBridge (implémentation intégrée)

squid embarque une **connexion directe à l’API ouverte Feishu** (`FeishuChannelPlugin`), sans dépendre du runtime OpenClaw `@openclaw/feishu`. Le **seul** point d’entrée pour les messages entrants est :

| Élément | Détail |
|---------|--------|
| Module | `extensions/feishu/src/inbound-adapter.ts` |
| Fonction | `submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload)` |
| Charge utile | `text` (obligatoire), `chatId`, `messageId`, `senderOpenId`, `accountId`, `raw` (JSON brut optionnel) |
| Nom d’événement | `channel:inbound` (constante `CHANNEL_INBOUND_EVENT`) |
| Forme du payload | `ChannelInboundEvent` (voir `src/channels/bridge/event-bridge.ts`), dont `channelId: 'feishu'` et `timestamp` |

**Par défaut**, `FeishuChannelPlugin` démarre une **longue connexion WebSocket** (`feishu-ws-inbound.ts`) pour recevoir les événements, puis les achemine via le même adaptateur ; si `connectionMode: webhook`, la route `POST /api/feishu/webhook` vérifie la signature (et le déchiffrement optionnel) puis **n’appelle** que cette fonction.

**Pont Feishu squid** : `registerFeishuSquidBridge(taskAPI)` est invoqué par l’extension dans `setup.initialize` (`TaskAPI` injecté via `initializeBuiltinChannels(taskAPI)`), s’abonne à `channel:inbound`, transmet le texte utilisateur à `TaskAPI.executeTaskStream` (`conversationId` de la forme `feishubot_<chatId>`) et renvoie la réponse du modèle avec `sendFeishuTextMessageTo` vers **le même** groupe ou fil. Le comportement d’extension peut aussi s’abonner à `eventBridge.onChannelInbound`.

Tout **shim de compatibilité OpenClaw** futur **doit** réacheminer l’entrée côté plugin vers `submitFeishuInboundToEventBridge` (ou équivalent) pour satisfaire la spec `feishu-openclaw-compatibility`.

## Étapes de mise en œuvre

### Étape 1 : analyser le code du plugin

Identifier les appels OpenClaw réellement utilisés.

**Exemple Feishu**

```bash
cd openclaw-main/extensions/feishu
grep -r "runtime\\." src/
```

Interfaces fréquentes : `runtime.text.chunkText`, `runtime.reply.dispatchReply`, `runtime.routing.resolveAgentRoute`, `runtime.pairing.*`, etc.

### Étape 2 : créer l’adaptateur

Fichier `src/channels/openclaw-adapter/adapter.ts` (schéma indicatif) :

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
      description: 'Adaptation plugin OpenClaw',
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
          message: connected ? 'Connecté' : 'Non connecté',
        };
      }
      return { healthy: true, message: 'État inconnu' };
    },
  };

  setup = {
    initialize: async () => {
      if (this.openclawPlugin.initialize) {
        await this.openclawPlugin.initialize();
      }
      eventBridge.onTaskComplete((event) => {
        this.outbound.sendText({
          content: `Tâche ${event.taskId} terminée`,
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

### Étape 3 : runtime minimal

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

### Étape 4 : chargement du plugin

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

## Limites connues

### Non pris en charge dans la version actuelle

1. Runtime OpenClaw complet  
2. Gestion du pairing  
3. Médias (upload / téléchargement)  
4. Liaisons de session complexes  
5. Listes d’autorisation fines  

### Pistes de contournement

- **1** : enrichir l’adaptateur au fil des erreurs  
- **2** : implémentations vides ou mock pour les interfaces secondaires  
- **3** : modifier le plugin si le code est sous votre contrôle  

## Liste de tests après adaptation

- [ ] Chargement et initialisation  
- [ ] Réception des notifications de fin de tâche squid  
- [ ] Envoi vers la plateforme cible  
- [ ] Réception depuis la plateforme  
- [ ] Relais des commandes utilisateur vers squid  
- [ ] Gestion d’erreur  
- [ ] Reconnexion après coupure  

## Exemple Feishu

```typescript
npm install @openclaw/feishu-plugin
import { loadOpenClawPlugin } from './channels/openclaw-adapter/loader';

const feishuPlugin = await loadOpenClawPlugin('@openclaw/feishu-plugin');
feishuPlugin.config.set('appId', 'your-app-id');
feishuPlugin.config.set('appSecret', 'your-app-secret');
await feishuPlugin.outbound.sendText({ content: 'Message test' });
```

## Dépannage

### Chargement du plugin

Chemins, dépendances, pile d’erreurs pour interfaces manquantes.

### Envoi de message

Configuration (appId, appSecret), connectivité, documentation API de la plateforme.

### Incompatibilité d’interface

Identifier l’appel depuis le message d’erreur, compléter l’adaptateur ou fournir une version simplifiée.

## Contribution

En cas d’adaptation réussie : liste des interfaces requises, code d’adaptateur, tests, mise à jour de ce document.

## Références

- [OpenClaw sur GitHub](https://github.com/openclaw/openclaw)  
- [Types canal OpenClaw](https://github.com/openclaw/openclaw/blob/main/src/plugins/runtime/types-channel.ts)  
- [Documentation API ouverte Feishu](https://open.feishu.cn/document/)  
