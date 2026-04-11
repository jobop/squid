# Guida ai test di integrazione

Questo documento descrive come verificare le funzionalità «openclaw-compatible-channels».

## Prerequisiti

1. Dipendenze installate: `npm install`
2. API Key configurata (pagina Impostazioni)
3. Applicazione avviata: `npm run dev`

## Scenari di test

### Scenario 1: notifica completamento attività pianificata nella chat

**Obiettivo:** al termine di un’attività Cron la notifica compare nella chat.

**Passi:**

1. Avviare l’app
   ```bash
   npm run dev
   ```

2. Aprire gli strumenti sviluppatore del browser e la Console

3. Verificare la connessione WebSocket  
   Atteso: messaggio tipo `[WebSocket] connected` (testo esatto dipende dall’implementazione)

4. Creare un’attività pianificata (strumento cron o API)
   ```typescript
   const result = cronManager.createTask('*/1 * * * *', 'Stampa ora corrente'); // ogni minuto
   console.log(result);
   ```

5. Attendere l’esecuzione (entro 1 minuto)

6. Verificare la chat  
   Atteso: messaggio di notifica completamento con ID attività, stato, durata, ecc.

**Risultato atteso:**
- WebSocket connesso
- Attività eseguita
- Notifica visibile in chat con informazioni complete

---

### Scenario 2: notifica completamento attività in background nella chat

**Obiettivo:** le attività in background (non Cron) al termine notificano la chat.

**Passi:**

1. Nella chat inserire un compito, ad es.
   ```
   Genera un programma Hello World
   ```

2. Inviare e attendere il completamento

3. Verificare la notifica di completamento in chat

**Risultato atteso:**
- Esecuzione completata
- Notifica in chat con il risultato

---

### Scenario 3: invio comando dalla chat al motore

**Obiettivo:** i comandi inviati dalla chat raggiungono il motore.

**Passi:**

1. Aprire la Console degli strumenti sviluppatore

2. Inviare un comando di prova
   ```javascript
   window.wsClient.sendCommand('test-command', { param: 'value' });
   ```

3. Verificare nei log server la ricezione del comando

**Risultato atteso:**
- Invio riuscito
- Il server riceve il comando
- EventBridge emette l’evento comando

---

### Scenario 4: riconnessione automatica WebSocket

**Obiettivo:** dopo una disconnessione il client si riconnette.

**Passi:**

1. Avviare l’app e verificare WebSocket connesso

2. Interrompere il backend (simulazione disconnessione)

3. Osservare la Console  
   Atteso: messaggi di chiusura connessione e tentativi di riconnessione dopo N secondi

4. Riavviare il backend

5. Verificare riconnessione riuscita

**Risultato atteso:**
- Rilevamento disconnessione
- Tentativi automatici di riconnessione
- Riconnessione OK

---

### Scenario 5: più client connessi

**Obiettivo:** più schede browser ricevono le stesse notifiche.

**Passi:**

1. Aprire la prima scheda sull’app
2. Aprire una seconda scheda sulla stessa app
3. In una delle due attivare il completamento di un’attività
4. Verificare che entrambe ricevano la notifica

**Risultato atteso:**
- Entrambi i client connessi
- Entrambi ricevono la notifica
- Nei log server compaiono due connessioni client

---

### Scenario 6: integrazione plugin Feishu OpenClaw (richiede credenziali)

**Obiettivo:** il plugin Feishu invia e riceve messaggi.

**Prerequisiti:**
- Plugin Feishu OpenClaw installato
- appId e appSecret Feishu configurati

**Passi:**

1. Caricare il plugin
   ```typescript
   import { createOpenClawAdapter } from './channels/openclaw-adapter/adapter';
   import feishuPlugin from '@openclaw/feishu-plugin';
   
   const adapter = createOpenClawAdapter(feishuPlugin, 'feishu');
   channelRegistry.register(adapter);
   await adapter.setup.initialize();
   ```

2. Impostare le credenziali
   ```typescript
   adapter.config.set('appId', 'your-app-id');
   adapter.config.set('appSecret', 'your-app-secret');
   ```

3. Attivare il completamento di un’attività

4. Verificare la notifica su Feishu

5. Inviare un messaggio da Feishu

6. Verificare la ricezione nell’app

**Risultato atteso:**
- Plugin caricato e inizializzato
- Notifiche attività inviate a Feishu
- Messaggi Feishu inoltrati all’app

---

## Test unitari

```bash
npm test
```

Copertura indicativa:
- invio e sottoscrizione eventi EventBridge
- funzionalità base WebUIChannelPlugin
- gestione configurazione
- controllo stato

---

## Risoluzione problemi

### WebSocket non si connette

**Sintomo:** errori di connessione in Console.

**Verifiche:**
1. Backend in esecuzione
2. Porta 8080 libera
3. Firewall

**Azioni:**
```bash
lsof -i :8080
# Modificare la porta se necessario in config/channels.json
```

### Notifica attività assente

**Sintomo:** attività completata ma nessun messaggio in chat.

**Verifiche:**
1. WebSocket connesso
2. Chiamate EventBridge corrette
3. Errori in Console

**Azioni:**
```javascript
console.log(window.wsClient.isConnected()); // dovrebbe essere true
// test manuale se disponibile nell’ambiente
```

### Caricamento plugin Feishu fallito

**Sintomo:** errore in fase di init.

**Verifiche:**
1. Installazione plugin
2. Configurazione completa
3. Raggiungibilità API Feishu

**Azioni:**
```bash
npm install @openclaw/feishu-plugin
# adapter.config.validate() se esposto
```

---

## Test di prestazioni

### Throughput messaggi

```javascript
for (let i = 0; i < 1000; i++) {
  eventBridge.notifyTaskComplete(`task-${i}`, { result: i });
}
// Verificare: consegna, latenza, memoria
```

### Stabilità connessione

Eseguire l’app per molte ore e monitorare heartbeat, riconnessioni e uso memoria.

---

## Checklist pre-rilascio

- [ ] Test unitari EventBridge OK
- [ ] Test unitari WebUIChannelPlugin OK
- [ ] Notifica Cron in chat
- [ ] Notifica attività background in chat
- [ ] Comando da chat al motore
- [ ] Riconnessione automatica WebSocket
- [ ] Più client
- [ ] Integrazione Feishu (se in uso)
- [ ] Test prestazioni
- [ ] Test stabilità prolungata

---

## Automazione futura

```typescript
// Esempio E2E
describe('E2E', () => {
  it('dovrebbe notificare la chat al completamento Cron', async () => {
    // avvio app, creazione cron, attesa, assert WebSocket/UI
  });
});
```
