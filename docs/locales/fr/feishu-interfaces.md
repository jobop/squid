# Inventaire des interfaces cœur du plugin Feishu OpenClaw

D’après l’analyse de `openclaw-main/extensions/feishu`, le plugin Feishu s’appuie principalement sur les interfaces suivantes :

## Dépendances cœur

### 1. Plugin SDK Core

- `createChatChannelPlugin` — création d’un plugin de canal de chat  
- `defineChannelPluginEntry` — définition du point d’entrée du plugin  

### 2. Channel Config

- `createHybridChannelConfigAdapter` — adaptateur de configuration hybride  
- `adaptScopedAccountAccessor` — adaptateur d’accès aux comptes  

### 3. Outbound (envoi)

- `createRuntimeOutboundDelegates` — délégués sortants à l’exécution  
- À implémenter notamment :  
  - `sendMessageFeishu` — message texte  
  - `sendCardFeishu` — message carte  
  - `updateCardFeishu` — mise à jour de carte  
  - `editMessageFeishu` — édition de message  

### 4. Directory (annuaire)

- `createChannelDirectoryAdapter`  
- `createRuntimeDirectoryLiveAdapter`  
- À implémenter :  
  - `listFeishuDirectoryPeers`  
  - `listFeishuDirectoryGroups`  

### 5. Status

- `createComputedAccountStatusAdapter`  
- À implémenter :  
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

## Stratégie de minimalisation

Pour l’adaptation squid, seules les **fonctions messages essentielles** sont nécessaires :

### Indispensable (P0)

1. **Envoi** — `sendMessageFeishu`  
2. **Réception** — webhook ou polling  
3. **Configuration du compte** — appId, appSecret  
4. **Contrôle d’état** — validité des identifiants  

### Recommandé (P1)

5. **Gestion de session** — contexte de conversation  
6. **Gestion d’erreurs** — réseau, authentification, etc.  

### Optionnel (P2)

7. Messages carte  
8. Synchronisation annuaire  
9. Stratégies de groupe  
10. Routage avancé  

## Correspondance d’interfaces simplifiée

```typescript
Interface OpenClaw                    →  Interface squid
─────────────────────────────────────────────────────────
sendMessageFeishu()                 →  FeishuChannelPlugin.outbound.sendText() + API ouverte im/v1/messages
Écoute webhook                      →  POST /api/feishu/webhook → submitFeishuInboundToEventBridge()
                                    →  eventBridge.onChannelInbound (pas inbound.onMessage)
inspectFeishuCredentials()          →  status.check() (sonde tenant token)
resolveFeishuAccount()              →  config.getAll() masqué / ~/.squid/feishu-channel.json
```

## État d’implémentation (validé, P0)

- **Répertoire** : `extensions/feishu/src/` (paquet d’extension fourni avec le dépôt) ; imports stables possibles via réexport du fichier tonneau `src/channels/feishu`.  
- **Texte sortant** : `extensions/feishu/src/lark-client.ts` + `FeishuChannelPlugin` ; configurer `defaultReceiveId` / `defaultReceiveIdType`.  
- **Entrée par défaut (WebSocket)** : `extensions/feishu/src/feishu-ws-inbound.ts`, `@larksuiteoapi/node-sdk` (`WSClient` + `EventDispatcher`), connexion active vers Feishu depuis la machine, **sans** webhook public obligatoire. `connectionMode` par défaut : `websocket`.  
- **Webhook optionnel** : `extensions/feishu/src/webhook-handler.ts` si `connectionMode: webhook` ; algorithme de signature aligné sur OpenClaw `monitor.transport.ts`. Les messages envoyés par le bot (`sender_type === app`) ne réentrent pas.  
- **Analyse des messages** : `extensions/feishu/src/message-inbound.ts` (`parseFeishuImReceiveForInbound`) partagé WS / HTTP.  
- **Lien avec squid** : `extensions/feishu/src/squid-bridge.ts` (`registerFeishuSquidBridge`, appelé depuis `FeishuChannelPlugin.setup.initialize` lorsque `taskAPI` est injecté) relie les messages utilisateur à `TaskAPI.executeTaskStream` et renvoie la réponse via `sendFeishuTextMessageTo` vers le `chat_id` d’origine.  
- **Configuration** : `~/.squid/feishu-channel.json` ; `GET/POST /api/channels/feishu/config` (sans secret complet en réponse). **Chargement** : activer l’extension `feishu` dans `config/channel-extensions.json` (ou `~/.squid/channel-extensions.json`) ; si la config sortante est incomplète, l’entrée d’extension échoue mais une ligne Feishu synthétique peut rester visible dans la liste des canaux.  
- **Compatibilité** : voir [COMPATIBILITY.md](./COMPATIBILITY.md).  

## Priorités d’implémentation

1. **Phase 1** — messages de base  
   - Configurer appId / appSecret  
   - Envoyer du texte vers Feishu  
   - Recevoir des messages (webhook)  
   - Intégrer EventBridge  

2. **Phase 2** — enrichissement  
   - Gestion de session  
   - Nouvelles tentatives sur erreur  
   - Surveillance d’état  

3. **Phase 3** — fonctions avancées  
   - Cartes  
   - Gestion de groupes  
   - Contrôle d’accès  
