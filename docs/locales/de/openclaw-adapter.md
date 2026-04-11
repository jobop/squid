# OpenClaw-Plugin-Adapter

## Überblick

So werden OpenClaw-Channel-Plugins in squid betrieben.

## Hintergrund

OpenClaw ist eine ausgereifte Multi-Channel-KI-Plattform mit vielen Plugins (Feishu, DingTalk, Telegram, Discord …). squid stellt eine **minimale Adapter-Schicht** bereit, damit solche Plugins teilweise auf squid laufen können.

## Kompatibilitätsstrategie

**Grundsatz:** Bedarfsgerecht implementieren, kein Vollabgleich erzwingen.

- Nur tatsächlich genutzte Schnittstellen bereitstellen  
- Sinnvolle Defaults oder Degradation  
- Nicht alle OpenClaw-APIs auf einmal nachbauen  

## Architektur

```
┌──────────────────┐
│ OpenClaw-Plugin  │
│   (Feishu/…)     │
└────────┬─────────┘
         │ OpenClaw-APIs
         ▼
┌──────────────────┐
│ OpenClawAdapter  │
└────────┬─────────┘
         │ squid-Schnittstellen
         ▼
┌──────────────────┐
│   EventBridge    │
└──────────────────┘
```

## Feishu: Adapter-Inbound-API und EventBridge (eingebaut)

squid spricht **direkt** die Feishu Open Platform an (`FeishuChannelPlugin`), **ohne** die OpenClaw-Laufzeit von `@openclaw/feishu`. **Einziger** Einstieg für eingehende Nachrichten:

| Punkt | Beschreibung |
|-------|----------------|
| Modul | `extensions/feishu/src/inbound-adapter.ts` |
| Funktion | `submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload)` |
| Payload | `text` (Pflicht), optional `chatId`, `messageId`, `senderOpenId`, `accountId`, `raw` |
| Ereignis | `channel:inbound` (`CHANNEL_INBOUND_EVENT`) |
| Form | `ChannelInboundEvent` in `src/channels/bridge/event-bridge.ts`, u. a. `channelId: 'feishu'`, `timestamp` |

**Standard**: WebSocket-Long-Poll (`feishu-ws-inbound.ts`) → derselbe Adapter. Bei `connectionMode: webhook` verarbeitet `POST /api/feishu/webhook` Signatur/Entschlüsselung und ruft **nur** diese Funktion auf.

**squid-Feishu-Brücke**: `registerFeishuSquidBridge(taskAPI)` wird in `setup.initialize` der Erweiterung registriert (`TaskAPI` via `initializeBuiltinChannels`). Abonniert `channel:inbound`, leitet Text an `TaskAPI.executeTaskStream` (`conversationId` wie `feishubot_<chatId>`), Antworten mit `sendFeishuTextMessageTo` zurück in dieselbe Konversation. Zusätzliche Logik kann `eventBridge.onChannelInbound` nutzen.

Ein künftiger **OpenClaw-Shim** muss eingehende Plugin-Ereignisse an `submitFeishuInboundToEventBridge` (oder gleichwertig) weiterreichen, um die Spec `feishu-openclaw-compatibility` zu erfüllen.

## Umsetzungsschritte

### 1. Plugin-Code studieren

Welche OpenClaw-Runtime-APIs werden wirklich aufgerufen? (Beispiel: `grep -r "runtime\\."` im Feishu-Plugin.)

### 2. Adapter anlegen

Siehe `src/channels/openclaw-adapter/adapter.ts` – Muster: `ChannelPlugin` mit `config`, `outbound`, `inbound`, `status`, `setup`, Anbindung an `eventBridge`.

### 3. Minimale Runtime

`createMinimalRuntime()` mit `text.chunkText`, `reply.dispatchReply`, `routing.resolveAgentRoute` usw. – nach Bedarf erweitern.

### 4. Plugin laden

Dynamischer `import`, Instanz mit Runtime erzeugen, mit `OpenClawChannelAdapter` umhüllen, in `channelRegistry` registrieren, `setup.initialize` aufrufen.

## Bekannte Lücken

1. Keine vollständige Runtime-API  
2. Kein Pairing-Stack  
3. Keine Medien-Pipeline  
4. Keine komplexe Sitzungsbindung  
5. Keine Allowlist-Policy  

**Optionen**: fehlende API nachrüsten, harmloser Stub, oder Plugin anpassen.

## Test-Checkliste

- [ ] Plugin lädt und initialisiert  
- [ ] Aufgabenbenachrichtigungen aus squid werden zugestellt  
- [ ] Ausgehende Nachrichten zur Zielplattform  
- [ ] Eingehende Nutzernachrichten  
- [ ] Befehle an squid  
- [ ] Fehlerpfade  
- [ ] Reconnect nach Netzwerkproblemen  

## Beispiel Feishu (Konzept)

```typescript
npm install @openclaw/feishu-plugin
// Plugin laden, konfigurieren, sendText testen
```

## Fehlerbehebung

- Ladefehler: Pfade, Dependencies, Stacktrace  
- Sendefehler: Credentials, Netz, Plattform-API-Doku  
- Inkompatibilität: fehlende Methode im Adapter ergänzen oder vereinfachen  

## Beitragen

Erfolgreiche Adapter: Schnittstellenliste, Code, Tests, Doku-Update.

## Referenzen

- [OpenClaw auf GitHub](https://github.com/openclaw/openclaw)  
- [Channel-Typen in OpenClaw](https://github.com/openclaw/openclaw/blob/main/src/plugins/runtime/types-channel.ts)  
- [Feishu Open Platform](https://open.feishu.cn/document/)  
