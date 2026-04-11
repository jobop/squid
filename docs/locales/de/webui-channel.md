# WebUI-Channel

## Überblick

Der WebUI-Channel ist ein **eingebautes** Channel-Plugin: die Chat-Oberfläche erscheint als normaler Kanal und kommuniziert per WebSocket bidirektional mit der Engine.

In der Seitenleiste unter **Kanäle** erscheint WebUI in der Liste inkl. Status; Details sind schreibgeschützt erklärt, ohne separates Web-Config-Formular.

## Merkmale

- Echtzeit-Benachrichtigungen bei Aufgabenende  
- Befehle aus dem Chat an die Engine  
- Automatischer WebSocket-Reconnect  
- Heartbeat  
- Mehrere Clients gleichzeitig  

## Architektur

```
┌─────────────┐         WebSocket         ┌──────────────────┐
│  Frontend   │ ◄─────────────────────► │ WebUIChannelPlugin│
│ (Browser)   │                           │   (Backend)      │
└─────────────┘                           └────────┬─────────┘
                                                    │ EventBridge
                                                    ▼
                                          ┌──────────────────┐
                                          │   Engine         │
                                          │(Cron/Tasks)      │
                                          └──────────────────┘
```

## Konfiguration

### Server

In `config/channels.json`:

```json
{
  "channels": {
    "webui": {
      "enabled": true,
      "port": 8080,
      "heartbeatInterval": 30000
    }
  }
}
```

- `enabled` – WebUI-Channel aktiv  
- `port` – WebSocket-Port (Standard 8080)  
- `heartbeatInterval` – Intervall in ms (Standard 30000)  

### Client

Standard: `ws://localhost:8080`. Adresse bei Bedarf in `public/websocket-client.js` ändern:

```javascript
window.wsClient = new WebSocketClient('ws://localhost:8080');
```

## Nutzung

### App starten

```typescript
import { initializeBuiltinChannels } from './channels';

await initializeBuiltinChannels(taskAPI);
```

### Aufgabenbenachrichtigungen

```javascript
window.wsClient.on('task:complete', (event) => {
  showTaskNotification(event);
});
```

### Befehle senden

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

## Nachrichtenformate

### Server → Client

**Aufgabe fertig**

```json
{
  "type": "task:complete",
  "data": {
    "taskId": "task-123",
    "taskName": "Datenverarbeitung",
    "result": { "processed": 100 },
    "duration": 5000,
    "timestamp": 1234567890000
  }
}
```

**Allgemeine Benachrichtigung**

```json
{
  "type": "notification",
  "data": {
    "title": "System",
    "content": "Vorgang erfolgreich",
    "type": "success"
  }
}
```

**Heartbeat**

```json
{ "type": "ping" }
```

### Client → Server

**Befehl**

```json
{
  "type": "command",
  "data": {
    "command": "restart-task",
    "args": { "taskId": "task-123" }
  }
}
```

**Pong**

```json
{ "type": "pong" }
```

## API (Frontend `WebSocketClient`)

- `connect()` / `disconnect()`  
- `send(type, data)`  
- `sendCommand(command, args)`  
- `on(type, handler)` / `off(type, handler)`  
- `isConnected()`  

## Fehlerbehebung

**Verbindung schlägt fehl** – Dienst läuft? Port frei? Konsolenfehler?

**Keine Nachrichten** – WebSocket aktiv? EventBridge feuert? Server-Logs?

**Reconnect stoppt** – exponentielles Backoff (1 s, 2 s, 4 s, …), typischerweise bis 10 Versuche; danach Seite neu laden.

## Beispiele

Aufgabenende anzeigen, Verbindungsstatus loggen, `restartTask`/`cancelTask` Hilfsfunktionen – siehe englisches Original für vollständige Snippets; Logik identisch.

## Performance

Batching bei Massennachrichten, Heartbeat an Netzwerk anpassen, Server verwaltet mehrere Clients.

## Sicherheit

- Derzeit Fokus auf **localhost**  
- **Keine Authentifizierung** – nur vertrauenswürdige Umgebungen  
- Server validiert Nachrichtenformate  

## Roadmap

- [ ] TLS/WSS  
- [ ] Authentifizierung  
- [ ] Remote-Zugriff (kontrolliert)  
- [ ] Kompression  
- [ ] Persistente Offline-Warteschlange  
