# Leitfaden zu Integrationstests

Dieses Dokument beschreibt, wie die Funktion „openclaw-compatible-channels“ manuell geprüft wird.

## Voraussetzungen

1. Abhängigkeiten: `npm install`  
2. API-Key in den Einstellungen  
3. App: `npm run dev`  

## Testszenarien

### Szenario 1: Cron-Ende → Chat

**Ziel**: Nach Cron-Ausführung erscheint eine Benachrichtigung im Chat.

**Schritte**:

1. App starten: `npm run dev`  
2. Browser-DevTools → Konsole  
3. WebSocket: Meldung in der Art `[WebSocket] connected` / erfolgreiche Verbindung (je nach Implementierung)  
4. Cron-Aufgabe anlegen (Cron-Tool oder API), z. B. jede Minute  
5. Bis zu einer Minute warten  
6. Im Chat soll eine Abschlussbenachrichtigung mit ID, Status, Dauer stehen  

**Erwartung**: Verbindung steht, Aufgabe lief, Benachrichtigung vollständig.

---

### Szenario 2: Hintergrundaufgabe → Chat

**Ziel**: Nicht-Cron-Aufgaben melden Abschluss im Chat.

**Schritte**:

1. Im Chat eine Aufgabe stellen, z. B. ein kleines Hello-World-Programm erzeugen  
2. Senden und auf Ende warten  
3. Abschlussbenachrichtigung prüfen  

**Erwartung**: Abschluss sichtbar, ggf. Kurzfassung des Ergebnisses.

---

### Szenario 3: Chatbefehl → Engine

**Ziel**: Befehle aus dem Chat erreichen die Engine.

**Schritte**:

1. Konsole öffnen  
2. Testbefehl:  
   ```javascript
   window.wsClient.sendCommand('test-command', { param: 'value' });
   ```  
3. Server-Logs prüfen  

**Erwartung**: Befehl ankommt, EventBridge feuert `command`.

---

### Szenario 4: WebSocket-Reconnect

**Ziel**: Nach Verbindungsabbruch automatischer Wiederaufbau.

**Schritte**:

1. App starten, Verbindung OK  
2. Backend stoppen  
3. Konsole: Verbindungsende und geplantes Reconnect-Intervall  
4. Backend erneut starten  
5. Erfolgreiche erneute Verbindung  

**Erwartung**: Disconnect erkannt, Backoff-Reconnect, wieder „connected“.

---

### Szenario 5: Mehrere Clients

**Ziel**: Mehrere Tabs erhalten Broadcasts.

**Schritte**:

1. Zwei Tabs mit der App  
2. In einem Tab Aufgabenende auslösen  
3. Beide Tabs müssen die Benachrichtigung zeigen  

**Erwartung**: Zwei aktive Clients, beide informiert.

---

### Szenario 6: OpenClaw-Feishu (mit Credentials)

**Ziel**: Feishu-Plugin sendet und empfängt.

**Voraussetzung**: OpenClaw-Feishu-Plugin installiert, `appId`/`appSecret` gesetzt.

**Schritte**:

1. Adapter laden (Pfade anpassen):  
   ```typescript
   import { createOpenClawAdapter } from './channels/openclaw-adapter/adapter';
   import feishuPlugin from '@openclaw/feishu-plugin';
   const adapter = createOpenClawAdapter(feishuPlugin, 'feishu');
   channelRegistry.register(adapter);
   await adapter.setup.initialize();
   ```  
2. Credentials setzen  
3. Aufgabenende auslösen → Nachricht in Feishu  
4. Von Feishu antworten → App empfängt  

**Erwartung**: Plugin initialisiert, Hinweise in beide Richtungen.

---

## Unit-Tests

```bash
npm test
```

Abdeckung u. a.: EventBridge, WebUIChannelPlugin, Konfiguration, Status.

---

## Fehlerbehebung

### WebSocket schlägt fehl

- Backend läuft?  
- Port 8080 frei?  
- Firewall?  

```bash
lsof -i :8080
```

Port ggf. in `config/channels.json` ändern.

### Keine Aufgabenbenachrichtigung

- WebSocket verbunden?  
- `notifyTaskComplete` aufgerufen?  
- Konsolenfehler?  

```javascript
console.log(window.wsClient.isConnected());
```

### Feishu-Plugin startet nicht

- Installation und Importpfade  
- Vollständige Konfiguration  
- Erreichbarkeit der Feishu-APIs  

---

## Lasttests (optional)

Viele `notifyTaskComplete`-Aufrufe in Schleife senden und Latenz/Speicher beobachten.

Langlauf: 24 h mit Heartbeat und stabiler Verbindung.

---

## Checkliste vor Release

- [ ] EventBridge-Unit-Tests grün  
- [ ] WebUIChannelPlugin-Unit-Tests grün  
- [ ] Cron → Chat  
- [ ] Hintergrund → Chat  
- [ ] Chatbefehl → Engine  
- [ ] Auto-Reconnect  
- [ ] Mehrere Clients  
- [ ] Feishu (falls genutzt)  
- [ ] Last/Soak nach Bedarf  

## Automatisierung (Ausblick)

End-to-End-Tests können später Cron + WebSocket + UI prüfen (Beispielstruktur im englischen Original).
