# Documentazione WebUI Channel

## Panoramica

WebUI Channel è un plugin canale integrato che tratta l’interfaccia chat come canale standard, con comunicazione bidirezionale WebSocket verso il motore di esecuzione.

Dalla barra laterale **Canali** è visibile l’elenco dei canali incluso WebUI e lo stato di salute; i dettagli WebUI sono informativi in sola lettura, senza form di configurazione Web dedicato.

## Caratteristiche

- Notifiche in tempo reale al completamento attività  
- Invio comandi dall’interfaccia chat  
- Riconnessione automatica WebSocket  
- Heartbeat per mantenere la connessione  
- Supporto multi-client  

## Architettura

```
┌─────────────┐         WebSocket         ┌──────────────────┐
│  Pagina UI  │ ◄─────────────────────► │ WebUIChannelPlugin│
│ (browser)   │                           │   (backend)       │
└─────────────┘                           └──────────────────┘
                                                    │
                                                    │ EventBridge
                                                    ▼
                                          ┌──────────────────┐
                                          │ Motore esecuzione │
                                          │(CronManager/Tasks)│
                                          └──────────────────┘
```

## Configurazione

### Lato server

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

**Campi:**
- `enabled` — abilita WebUI Channel
- `port` — porta server WebSocket (predefinito 8080)
- `heartbeatInterval` — intervallo heartbeat in ms (predefinito 30000)

### Lato client

Il client WebSocket si connette a `ws://localhost:8080`.

Per cambiare l’URL modificare `public/websocket-client.js`:

```javascript
window.wsClient = new WebSocketClient('ws://localhost:8080');
```

## Utilizzo

### 1. Avvio applicazione

WebUI Channel si inizializza all’avvio:

```typescript
import { initializeBuiltinChannels } from './channels';

await initializeBuiltinChannels(taskAPI);
```

### 2. Ricezione notifiche attività

Il frontend registra automaticamente le notifiche di completamento nella chat:

```javascript
// già registrato in index.html
window.wsClient.on('task:complete', (event) => {
  showTaskNotification(event);
});
```

### 3. Invio comandi

```javascript
window.wsClient.sendCommand('restart-task', { taskId: 'task-123' });
```

## Formato messaggi

### Server → client

#### Completamento attività

```json
{
  "type": "task:complete",
  "data": {
    "taskId": "task-123",
    "taskName": "Elaborazione dati",
    "result": { "processed": 100 },
    "duration": 5000,
    "timestamp": 1234567890000
  }
}
```

#### Notifica generica

```json
{
  "type": "notification",
  "data": {
    "title": "Notifica di sistema",
    "content": "Operazione riuscita",
    "type": "success"
  }
}
```

#### Heartbeat

```json
{
  "type": "ping"
}
```

### Client → server

#### Comando

```json
{
  "type": "command",
  "data": {
    "command": "restart-task",
    "args": { "taskId": "task-123" }
  }
}
```

#### Risposta heartbeat

```json
{
  "type": "pong"
}
```

## Riferimento API

### WebSocketClient (frontend)

#### connect()

Apre la connessione WebSocket.

#### disconnect()

Chiude la connessione.

#### send(type, data)

Invia un messaggio generico.

#### sendCommand(command, args)

Scorciatoia per inviare un comando.

#### on(type, handler)

Registra un gestore messaggi.

#### off(type, handler)

Rimuove il gestore.

#### isConnected()

Restituisce true se connesso.

## Risoluzione problemi

### Connessione fallita

1. Verificare che il server WebSocket sia avviato
2. Controllare che la porta non sia occupata
3. Consultare errori nella console del browser

### Messaggi assenti

1. Verificare stato connessione WebSocket
2. Verificare invio eventi su EventBridge
3. Consultare log lato server

### Riconnessione automatica

Backoff esponenziale:
- 1ª tentativo: 1 s
- 2ª: 2 s
- 3ª: 4 s
- …
- massimo 10 tentativi

Oltre il massimo occorre ricaricare la pagina.

## Esempi

### Ricezione notifiche

```javascript
window.wsClient.on('task:complete', (event) => {
  const message = event.error 
    ? `Attività fallita: ${event.error}`
    : `Attività completata: ${event.result}`;
  showNotification(message);
});

window.wsClient.on('connection', (data) => {
  if (data.connected) {
    console.log('WebSocket connesso');
  } else {
    console.log('WebSocket disconnesso');
  }
});
```

### Invio comandi

```javascript
function restartTask(taskId) {
  if (!window.wsClient.isConnected()) {
    alert('WebSocket non connesso');
    return;
  }
  window.wsClient.sendCommand('restart-task', { taskId });
}

function cancelTask(taskId) {
  window.wsClient.sendCommand('cancel-task', { taskId });
}
```

## Prestazioni

1. **Batch messaggi** — per volumi elevati valutare il batching
2. **Intervallo heartbeat** — adattarlo alla rete
3. **Pool connessioni** — il server gestisce automaticamente più client

## Sicurezza

1. **Connessione locale** — scenario attuale limitato a localhost
2. **Nessuna autenticazione** — adatto allo sviluppo locale
3. **Validazione messaggi** — il server verifica il formato

## Roadmap

- [ ] TLS/WSS
- [ ] Meccanismi di autenticazione
- [ ] Connessioni remote controllate
- [ ] Compressione messaggi
- [ ] Coda persistente messaggi offline
