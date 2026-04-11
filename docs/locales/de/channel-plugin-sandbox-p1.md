# Channel-Erweiterungen: P1-Sandbox-Richtung (Skizze, nicht implementiert)

P0 bietet nur **vertrauenswürdige Pfade + Manifest-Validierung + isoliertes Scheitern einzelner Plugins**; Erweiterungscode teilt sich den Adressraum mit dem Hauptprozess. Nachfolgend optionale Weiterentwicklung für Reviews und Priorisierung.

## Ziel

Unter Beibehaltung der **`ChannelPlugin`-Semantik** riskante Ein-/Ausgangslogik aus dem Hauptprozess herausziehen und die Angriffsfläche verkleinern.

## Option A: Subprozess-Adapter

- Hauptprozess behält einen dünnen **RPC-Client**; Erweiterungslogik in einem Node/Bun-**Child-Prozess**, Nachrichten per `stdio` oder lokalem Socket als JSON.
- `ChannelPlugin.outbound.sendText` usw. werden im Hauptprozess serialisiert; im Kindprozess ruft die echte SDK auf.
- **Vorteile**: OS-Isolation, teilweise Ressourcenlimits (plattformabhängig).  
- **Nachteile**: Latenz, Deploy-Komplexität, Lebenszyklus beim Beenden der Desktop-App synchronisieren.

## Option B: Worker-Threads

- Reine Berechnung oder netzwerkfreie Prüfungen in `worker_threads` (sofern Bun-Unterstützung ausreicht).
- **Einschränkung**: Viele IM-SDKs brauchen Main-Thread oder native Module – oft bleibt Option A.

## Option C: V8-Isolate / `isolated-vm`-Klasse

- Leichte Isolation im selben Prozess; **Bun-Kompatibilität** und Node-API-Verfügbarkeit prüfen.
- Geeignet für **stark eingeschränkte** Skripte, nicht für große offizielle SDKs direkt.

## Schnittstellen-Skizze (RPC)

```text
Hauptprozess                    Erweiterungs-Subprozess
  |  spawn(channel-plugin.json)    |
  |----------------init----------->|
  |<-------------ready--------------|
  |  outbound.sendText(payload) --> |
  |<------------- result ----------|
```

Umschlag: `correlationId`, `channelId`, `method`, `payload`; Fehler mit `code` + `message` (ohne sensible Details).

## Akzeptanzkriterien (zukünftig)

- Subprozess-Absturz reißt den Hauptprozess nicht mit; beim Beenden SIGTERM mit Timeout, danach SIGKILL.  
- Pro-Erweiterung: RPC-Timeout und Kontingente (Nachrichtengröße, QPS) konfigurierbar.

Aktueller Meilenstein bleibt P0-Dokumentation und Konfiguration; Umsetzung dieser Seite erfordert separates OpenSpec-/Design-Review.
