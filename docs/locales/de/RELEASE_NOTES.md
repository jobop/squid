# squid v0.1.0 – Release Notes

## Aktuelle Änderungen (2026-04-10)

### Bilderkennung für Kanal-Inbound vereinheitlicht

- Telegram / Feishu / WeChat Personal: eingehende Bilder laufen einheitlich über „Download in den Workspace + `mentions(file)`“.
- Bei Warteschlangen unter Last bleibt dieselbe `mentions`-Kette erhalten, damit Bilder im Queue-Pfad nicht verloren gehen.
- Gemeinsame Persistenz auf Erweiterungsseite: `extensions/shared/workspace-image-store.ts`.

### Kanal-Befehl zum Abbrechen: `/wtf`

- In `TaskAPI.executeTaskStream` neuer Befehl `/wtf`, semantisch wie Web-ESC: nur die laufende Aufgabe der aktuellen Sitzung abbrechen, **ohne** die Warteschlange zu leeren.
- `/wtf` wird **vor** der Busy-Prüfung ausgewertet, damit der Abbruch auch bei „Sitzung beschäftigt“ sofort greift.
- Brückentests für Telegram / Feishu / WeChat ergänzt; `/wtf` erreicht den einheitlichen Befehlzweig.

## Überblick

Erste öffentliche squid-Version: lokale KI-Desktop-Arbeitsumgebung auf Electrobun-Basis mit Mehrmodell-Chat, Aufgabenmodi, Skills und Experten, Zeitplänen sowie erweiterbaren Kanälen (Feishu / Telegram / WeChat usw., nach Aktivierung).

## Kernfunktionen

### Aufgaben und Workspace

- Modi Ask (lesend), Craft (automatische Tools), Plan (Planung und Bestätigung)
- Zustandsautomat und Persistenz für Aufgaben
- Arbeitsverzeichnis-Bindung und Pfad-Sandbox

### Modelle

- Anthropic Claude (je nach Einstellungen)
- OpenAI-kompatible Schnittstellen
- DeepSeek und weitere kompatible Endpunkte (je nach Adapter)
- Streaming und Token-Zählung (Implementierungsstand)
- Lokale verschlüsselte Speicherung von API-Keys

### Skills und Experten

- Mehrere eingebaute Skill-Vorlagen; Laden aus `~/.squid/skills` und Installation aus SkillHub u. Ä.
- Mehrere eingebaute Expertenrollen und Erweiterungspunkte

### Kanäle

- Eingebautes WebUI
- Erweiterungen: `extensions/` und `~/.squid/extensions`, deklarative Konfiguration und TaskAPI-Brücke

### Claw und Automatisierung

- Claw-HTTP-Fähigkeiten und Token-Design in `src/claw`; ob der Desktop-Claw standardmäßig startet, siehe `src/bun/index.ts`
- Zeitpläne mit node-cron und Ausführungshistorie

### Desktop-Shell

- Electrobun: Bun-Hauptprozess + System-WebView
- Hauptlayout, Einstellungen, Aufgaben- und Sitzungs-UI

## Tests

Letzte dokumentierte Automatisierung: 9 Testdateien, 31 bestandene Fälle (siehe [TEST_REPORT.md](./TEST_REPORT.md)). Vor einem Release `npm test` auf der Zielumgebung ausführen.

## Installation und Befehle (Quellcode)

```bash
git clone <repository-url>
cd squid
npm install
npm test          # optional
npm run dev       # Desktop-Entwicklung
npm run build     # tsc
npm run build:electron:release   # Stable-Desktop-Artefakte (Ausgabe artifacts/)
```

## Konfiguration

Erster Lauf: Modell-Keys in den **Einstellungen** speichern. Kanäle und Feishu: [QUICK_START.md](./QUICK_START.md), [channel-extensions.md](./channel-extensions.md).

**Build-Hinweis**: Electrobun liest **nur `electrobun.config.ts`**. Fehlt die Datei oder wird fälschlich `.js` genutzt, kopiert der Stable-Build ggf. kein `public` – die Oberfläche bleibt weiß.

## Dokumentationsindex

- [user-guide.md](./user-guide.md)
- [developer-guide.md](./developer-guide.md)
- [TEST_REPORT.md](./TEST_REPORT.md)
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)

## Sicherheit

- Workspace-Pfadprüfung und Tool-Berechtigungsklassen
- Lokale Verschlüsselung von Secrets
- Lokale HTTP-Dienste nicht ungesichert ins Internet stellen

## Bekannte Einschränkungen

- Teile der UI und Auswahllisten noch in Arbeit (Issues/Milestones)
- Öffentliche macOS-Builds ohne Signierung/Notarisierung können Gatekeeper auslösen; für Verteilung Developer-ID und Notarisierung empfohlen

## Roadmap (Planung)

- Skills- und Kanal-Ökosystem, Einstellungen und Observability ausbauen
- Performance und UX verbessern

## Lizenz

MIT License

---

**Releasedatum**: 2026-04-04 (wird mit der Repository-Pflege aktualisiert)  
**Version**: v0.1.0  
**Status**: In Wartung  
