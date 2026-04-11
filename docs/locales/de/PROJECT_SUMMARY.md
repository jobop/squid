# Projektüberblick squid

Dieses Dokument fasst Funktionsumfang und Modulgrenzen zusammen (Produkt- und Technikreviews); bei Abweichungen gilt der Quellcode.

## Positionierung

squid: **lokal priorisierte** KI-Desktop-Arbeitsumgebung (Electrobun + Bun + System-WebView). Daten standardmäßig unter `~/.squid`.

## Implementierte Fähigkeiten (Kurz)

### Aufgaben und Kontext

- Aufgabenmodell und Ask / Craft / Plan-Zustandsautomat  
- Kontextkompression und Aufgabenpersistenz  
- Berechtigungen und Risikoklassifikation von Tools  

### Modelle

- Adapter und Registry für Anthropic, OpenAI, DeepSeek usw. (siehe `src/models`)  
- Streaming, Token-Zählung, verschlüsselte Speicherung von Secrets  

### Workspace und Tools

- Arbeitsverzeichnis-Bindung, Pfad-Sandbox  
- ReadFile, WriteFile, Glob, Grep sowie einheitliche Tool-Ergebnisabbildung und Größenlimits  

### Skills und Experten

- Skill-YAML, Loader, Whitelist und Hooks  
- Eingebaute Skills und Expertenvorlagen; Teile der UI noch in Entwicklung  

### Claw und Scheduling

- Claw-HTTP-Dienst und Aufgabenverarbeitung (`src/claw`); ob der Desktop-Claw standardmäßig startet, siehe `src/bun/index.ts`  
- Zeitpläne mit node-cron, Ausführungshistorie, E-Mail-Benachrichtigungen (falls konfiguriert)  

### Kanäle

- Channel-Registry, eingebautes WebUI  
- Erweiterungen: `extensions/` + Benutzerverzeichnis, deklaratives Manifest und TaskAPI-Brücke  
- EventBridge, WebSocket-Anbindung an die UI (siehe u. a. [webui-channel.md](./webui-channel.md))  

### Desktop und Frontend

- React-Hauptoberfläche, Einstellungen, Aufgaben- und Sitzungs-UI  
- Lokale HTTP-API (`Bun.serve` im Hauptprozess für die UI)  

### Qualität

- Vitest-Unit- und integrationsnahe Tests (siehe [TEST_REPORT.md](./TEST_REPORT.md))  
- Nutzer- und Entwicklerdokumentation unter `docs/`  

## Tests und Qualitätssicherung

Letzte dokumentierte Archivierung: 9 Testdateien, 31 bestandene Fälle (TEST_REPORT). Vor dem Merge lokal `npm test` ausführen.

## Sicherheit (Kurz)

- Pfad-Sandbox und schreibgeschützte/destruktive Tool-Markierungen  
- Lokaler Schutz von Secrets (u. a. AES-256-GCM, siehe `secure-storage`)  
- Claw-Token und Berechtigungsengine (falls genutzt)  

## Performance (Kurz)

- LRU, virtuelles Scrollen, Lazy Loading, Streaming, Kontextkompression (modulspezifisch)  

## Dokumentation

| Dokument | Zweck |
|----------|--------|
| [QUICK_START.md](./QUICK_START.md) | Schnelleinstieg |
| [user-guide.md](./user-guide.md) | Funktionsbeschreibung |
| [developer-guide.md](./developer-guide.md) | Architektur und Erweiterungen |
| [tool-development-guide.md](./tool-development-guide.md) | Tool-Entwicklungsrichtlinien |
| [TEST_REPORT.md](./TEST_REPORT.md) | Testbericht |

## Versionsstand

Die Versionsnummer steht in `package.json`; Release-Hinweise: [RELEASE_NOTES.md](./RELEASE_NOTES.md).
