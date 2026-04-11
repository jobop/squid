# Elenco interfacce core del plugin Feishu OpenClaw

Dall’analisi di `openclaw-main/extensions/feishu`, il plugin Feishu utilizza principalmente le interfacce seguenti.

## Dipendenze core

### 1. Plugin SDK Core
- `createChatChannelPlugin` — crea plugin canale chat
- `defineChannelPluginEntry` — definisce l’ingresso del plugin

### 2. Channel Config
- `createHybridChannelConfigAdapter` — adattatore configurazione ibrida
- `adaptScopedAccountAccessor` — adattatore accesso account

### 3. Outbound (invio messaggi)
- `createRuntimeOutboundDelegates` — delegati outbound runtime
- Da implementare:
  - `sendMessageFeishu` — invio messaggio testo
  - `sendCardFeishu` — invio messaggio scheda
  - `updateCardFeishu` — aggiornamento scheda
  - `editMessageFeishu` — modifica messaggio

### 4. Directory (rubrica)
- `createChannelDirectoryAdapter` — adattatore rubrica
- `createRuntimeDirectoryLiveAdapter` — adattatore rubrica live runtime
- Da implementare:
  - `listFeishuDirectoryPeers` — elenco contatti
  - `listFeishuDirectoryGroups` — elenco gruppi

### 5. Status (controllo stato)
- `createComputedAccountStatusAdapter` — stato account calcolato
- Da implementare:
  - `probeFeishu` — verifica connettività
  - `inspectFeishuCredentials` — verifica credenziali

### 6. Account Management
- `resolveFeishuAccount` — risoluzione account
- `listFeishuAccountIds` — elenco ID account
- `resolveDefaultFeishuAccountId` — account predefinito

### 7. Session & Routing
- `getSessionBindingService` — servizio binding sessione
- `resolveFeishuOutboundSessionRoute` — instradamento outbound sessione
- `buildFeishuConversationId` — costruzione ID conversazione
- `parseFeishuConversationId` — parsing ID conversazione

### 8. Policy & Pairing
- `createPairingPrefixStripper` — rimozione prefisso pairing
- `resolveFeishuGroupToolPolicy` — policy strumenti gruppo
- `formatAllowFromLowercase` — formattazione allowFrom

### 9. Setup
- `feishuSetupAdapter` — adattatore setup
- `feishuSetupWizard` — procedura guidata setup

### 10. Runtime
- `setFeishuRuntime` — imposta runtime
- `getFeishuRuntime` — ottiene runtime

## Strategia di implementazione minima

Per l’adattamento in squid bastano le **funzionalità core di invio/ricezione messaggi**:

### Obbligatorio (P0)
1. **Invio messaggi** — `sendMessageFeishu`
2. **Ricezione messaggi** — webhook o polling
3. **Configurazione account** — appId, appSecret
4. **Controllo stato** — validità credenziali

### Consigliato (P1)
5. **Gestione sessione** — contesto conversazione
6. **Gestione errori** — rete, autenticazione, ecc.

### Opzionale (P2)
7. Messaggi scheda
8. Sincronizzazione rubrica
9. Policy di gruppo
10. Instradamento avanzato

## Mappatura interfaccia semplificata

```typescript
Interfaccia OpenClaw                    →  Interfaccia squid
─────────────────────────────────────────────────────────
sendMessageFeishu()                   →  FeishuChannelPlugin.outbound.sendText() + Open Platform im/v1/messages
Webhook in ascolto                    →  POST /api/feishu/webhook → submitFeishuInboundToEventBridge()
                                      →  eventBridge.onChannelInbound (non inbound.onMessage)
inspectFeishuCredentials()            →  status.check() (probe tenant token)
resolveFeishuAccount()                →  config.getAll() vista mascherata / ~/.squid/feishu-channel.json
```

## Stato implementazione (verificato, P0)

- **Directory**: `extensions/feishu/src/` (pacchetto estensione nel repo); import stabili tramite re-export bucket `src/channels/feishu`.
- **Invio testo**: `extensions/feishu/src/lark-client.ts` + `FeishuChannelPlugin`; richiede `defaultReceiveId` / `defaultReceiveIdType`.
- **Ingresso predefinito (WebSocket long-lived)**: `extensions/feishu/src/feishu-ws-inbound.ts` con `WSClient` + `EventDispatcher` di `@larksuiteoapi/node-sdk`, connessione attiva dalla macchina locale a Feishu, **senza** Webhook pubblico / tunnel. `connectionMode` predefinito `websocket`.
- **Webhook opzionale**: `extensions/feishu/src/webhook-handler.ts` quando `connectionMode: webhook`; algoritmo firma allineato a OpenClaw `monitor.transport.ts`. I messaggi inviati dal bot (`sender_type === app`) non rientrano in ingresso.
- **Parsing messaggi**: `extensions/feishu/src/message-inbound.ts` (`parseFeishuImReceiveForInbound`) condiviso tra WS e HTTP.
- **Integrazione dialogo squid**: `extensions/feishu/src/squid-bridge.ts` (`registerFeishuSquidBridge`, registrato da `FeishuChannelPlugin.setup.initialize` quando è disponibile `taskAPI` iniettato) collega i messaggi utente a `TaskAPI.executeTaskStream` e invia la risposta con `sendFeishuTextMessageTo` allo stesso `chat_id`.
- **Configurazione**: `~/.squid/feishu-channel.json`; `GET/POST /api/channels/feishu/config` (risposta senza segreti completi). **Caricamento**: abilitare l’estensione `feishu` in `config/channel-extensions.json` (o `~/.squid/channel-extensions.json`); con configurazione outbound incompleta l’ingresso estensione può fallire ma la lista canali può mostrare comunque una riga Feishu sintetica.
- **Conclusioni compatibilità**: vedere [COMPATIBILITY.md](../../COMPATIBILITY.md).

## Priorità di implementazione

1. **Fase 1** — messaggi base
   - Configurare appId/appSecret
   - Inviare testo a Feishu
   - Ricevere messaggi Feishu (webhook)
   - Integrare EventBridge

2. **Fase 2** — funzioni complete
   - Gestione sessione
   - Retry errori
   - Monitoraggio stato

3. **Fase 3** — funzioni avanzate
   - Messaggi scheda
   - Gestione gruppi
   - Controllo permessi
