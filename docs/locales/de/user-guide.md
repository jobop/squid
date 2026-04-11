# squid – Benutzerhandbuch

Beschreibt die wichtigsten Desktop-Funktionen. Bei Abweichungen gilt die jeweilige App-Version und der Quellcode.

## Installation und Start

**Quellcode**

```bash
cd squid
npm install
npm run dev
```

`npm run build` kompiliert TypeScript; `npm start` startet `node dist/main.js` und entspricht nicht dem Electrobun-Desktop-Alltag – für die Oberfläche `npm run dev` nutzen.

**Release-Pakete**  
Plattform-Artefakte installieren; macOS-Hinweise siehe [README.md](./README.md).

## Einstellungen

Erster Start:

1. Seitenleiste **Einstellungen** öffnen.  
2. **Anthropic / OpenAI / kompatible Endpunkte**: Keys, Modell, Base URL.  
3. Speichern → `~/.squid/config.json`.  

Weitere Gruppen (Kanäle, Darstellung) je nach aktueller Oberfläche.

## Aufgaben und Sitzungen

### Modi

| Modus | Einsatz |
|-------|---------|
| Ask | Beratung, Analyse, möglichst wenige Dateiänderungen |
| Craft | Automatische Tools, Dateien im Workspace können geändert werden |
| Plan | Komplexe Aufgaben: zuerst Plan, dann schrittweise Umsetzung |

### Ablauf (Überblick)

1. **Neue Aufgabe** o. Ä. wählen.  
2. Modus, Modell und **Arbeitsverzeichnis** (vertrauenswürdig) setzen.  
3. Optional Skills/Experten.  
4. Natürlichsprachliche Anweisung absenden.  

Pfade außerhalb des Workspace werden in der Regel von der Sandbox abgelehnt.

## Skills

- Vorgefertigte und installierte Skills in der Aufgabe oder den Einstellungen wählen.  
- Inhalt unter `~/.squid/skills/`.  
- Tencent SkillHub: [tencent-skillhub.md](./tencent-skillhub.md).

## Experten

Rollenvorlagen für Stil und Fachgrenzen; Verwaltung im Experten-Bereich der App. Umfang eigener Experten je nach Version.

## Zeitpläne

1. Seite **Zeitpläne** öffnen.  
2. Neuen Eintrag mit Cron, Inhalt für das Modell und Optionen anlegen.  
3. Läuft nur, **während die App aktiv ist**; nach Schließen Pause.

Vorlagen (Tagesbericht, Repo-Check …) falls vorhanden im Assistenten wählbar.

## Kanäle (Channels)

- **WebUI**: Haupt-Chat und Aufgaben, eingebaute Anbindung an die Engine.  
- **Erweiterungen**: Feishu, Telegram, WeChat Personal usw. unter `extensions/` bzw. `~/.squid/extensions/` mit `channel-plugin.json`; Aktivierung und Formulare: [channel-extensions.md](./channel-extensions.md).

Feishu benötigt Open-Platform-App, Ereignisabonnement (WebSocket oder Webhook) und lokale Datei `~/.squid/feishu-channel.json`. Im Webhook-Modus muss die Callback-URL vom Netz erreichbar sein – Details in [QUICK_START.md](./QUICK_START.md) und `extensions/feishu`.

## Gedächtnis

Langzeitgedächtnis in der dedizierten Ansicht; Speicherort unter `~/.squid` (Implementierungsdetail). Tests können per Umgebungsvariable ein anderes Verzeichnis erzwingen (Entwicklerdoku).

## Claw und lokale API (fortgeschritten)

- Eingebettete **lokale HTTP-API** für Aufgaben und Streaming; nicht ungesichert exponieren.  
- Zusätzliche Claw-Dienste unter `src/claw`; ob sie im Standard-Desktop-Start aktiv sind, siehe `src/bun/index.ts`. Token und Routing im Code/Tests nachlesen.

## Daten und Backup

| Pfad | Inhalt |
|------|--------|
| `~/.squid/config.json` | Hauptkonfiguration inkl. Modell-Keys |
| `~/.squid/skills/` | Skills |
| `~/.squid/channel-extensions.json` | Nutzer-Kanal-Erweiterungen |
| `~/.squid/extensions/` | Nutzer-Erweiterungswurzel |

Gesamtes `~/.squid` sichern; keine Secrets ins Repository.

## FAQ

**Standardmodell wechseln?**  
In den Einstellungen oder pro Aufgabe überschreiben.

**Dateien außerhalb des Workspace?**  
Standard nein (Sandbox).

**Deinstallieren / Umziehen?**  
App beenden, `~/.squid` sichern oder löschen; auf neuem Rechner Verzeichnis wiederherstellen und App installieren.

## Weitere Dokumentation

- [QUICK_START.md](./QUICK_START.md)  
- [developer-guide.md](./developer-guide.md)  
- [tool-development-guide.md](./tool-development-guide.md)  
- [TEST_REPORT.md](./TEST_REPORT.md)  
