# Schnellstart squid

Dieses Dokument richtet sich an Endnutzer: squid lokal installieren und starten, Modell konfigurieren, dann mit Dialog und Aufgaben beginnen. Architektur und Erweiterungen: [developer-guide.md](./developer-guide.md).

## Produktpositionierung

squid ist eine **lokal betriebene KI-Desktop-Arbeitsumgebung** für:

- Code lesen, reviewen und leicht anpassen im gewählten Arbeitsverzeichnis (je nach Aufgabenmodus und Sandbox)
- Aufgaben mit Skills und Experten, z. B. Dokumentation strukturieren oder recherchieren
- Zeitpläne mit Cron lokal auslösen
- Optionale **Kanal-Erweiterungen** (Feishu, Telegram, WeChat usw., jeweils mit eigener Konfiguration, siehe [channel-extensions.md](./channel-extensions.md))

## Umgebung und Start

**Aus dem Quellcode (empfohlen für Entwickler)**

- Node.js 22 LTS und npm; Electrobun-CLI wird bei `npm run dev` plattformabhängig vorbereitet.
- Im Projektstamm muss **`electrobun.config.ts`** existieren (Electrobun liest nur diesen Dateinamen).

```bash
cd squid
npm install
npm run dev
```

**Release-Pakete**

Von GitHub Releases o. Ä. das passende Artefakt installieren. Unter macOS können nicht signierte/nicht notarierte Builds beim ersten Start blockiert werden; siehe [README.md](./README.md) im Repository.

## API-Schlüssel konfigurieren

Mindestens einen Modellanbieter in den App-**Einstellungen** hinterlegen und speichern (Secrets landen in `~/.squid/config.json`):

| Anbieter | Hinweis |
|----------|---------|
| Anthropic | API-Key in der [Anthropic Console](https://console.anthropic.com/) |
| OpenAI | API-Key auf der [OpenAI Platform](https://platform.openai.com/) |
| Kompatible Endpunkte | Eigene Base-URL und Modellname (Protokoll muss zur App passen) |

## Erster Arbeitsablauf

1. Nach dem Start die Seitenleiste **Einstellungen** öffnen und Modelloptionen speichern.  
2. Im Chat- oder Aufgabenbereich das **Arbeitsverzeichnis** wählen (keine nicht vertrauenswürdigen Pfade als Wurzel).  
3. **Neue Sitzung oder Aufgabe** anlegen und Modus wählen:  
   - **Ask**: überwiegend lesend/analysierend, standardmäßig keine aggressiven Dateiänderungen (Verhalten je Version).  
   - **Craft**: Werkzeugketten dürfen Dateien im Workspace ändern.  
   - **Plan**: Planung und schrittweise Vorgehensweise bei komplexen Anforderungen.  
4. Optional **Skills** oder **Experten** auswählen.

## Kanäle und Feishu (optional)

- In der Seitenleiste **Kanäle** den Status von WebUI und Erweiterungen prüfen.  
- Feishu liegt unter `extensions/feishu/`; ob es in `config/channel-extensions.json` standardmäßig aktiv ist, hängt vom Repository ab. Nutzerseitige Aktivierung: `~/.squid/channel-extensions.json`.  
- Eigene Erweiterungen: `~/.squid/extensions/<Ordner>/`, Details in [channel-extensions.md](./channel-extensions.md).

Bot-Einrichtung bei Feishu, Long-Polling/Webhook und Felder in `~/.squid/feishu-channel.json`: siehe In-App-Texte und [user-guide.md](./user-guide.md).

## Beispielaufgaben

**Code-Review (Ask)**

```text
Modus: Ask
Arbeitsverzeichnis: <Ihr Projektpfad>
Anweisung: Hauptmodule unter src beschreiben und Hinweise zu Lesbarkeit sowie offensichtlichen Mängeln geben.
```

**Dokumentation in Serie (Craft)**

```text
Modus: Craft
Arbeitsverzeichnis: <Projektpfad>
Anweisung: Für die öffentlichen APIs im angegebenen Verzeichnis Markdown-Entwürfe erzeugen.
```

**Zeitplan**

Auf der Seite **Zeitpläne** einen Eintrag mit Cron-Ausdruck und dem Inhalt anlegen, der nach dem Trigger an das Modell geht; ohne laufende App findet keine Ausführung statt.

## Skills und Experten

- **Skills**: in der Oberfläche aus installierten Skills wählen; Dateien unter `~/.squid/skills/` (inkl. Installationen aus SkillHub o. Ä.).  
- **Experten**: Systemrolle und Grenzen anpassen; Verwaltung auf den zugehörigen App-Seiten.

## Häufige Fragen

**Liegen Keys nur lokal?**  
Ja. `~/.squid` nicht in Git committen; regelmäßig sichern.

**Ändern Aufgaben Dateien?**  
Abhängig von Modus und Tool-Richtlinien: Ask eher lesend; Craft kann schreiben; Plan erklärt zuerst. UI-Hinweise beachten.

**Grenzen des Arbeitsverzeichnisses?**  
Datei-Tools sind in der Regel auf das gebundene Workspace-Verzeichnis beschränkt (Sandbox/Permissions).

**Laufende Aufgabe abbrechen?**  
Stop-/Abort-Steuerung in Aufgaben- oder Sitzungsansicht (Bezeichnung je nach UI).

**Laufen Zeitpläne bei geschlossener App?**  
Nein; Scheduling braucht einen laufenden Prozess.

## Weiterlesen

| Dokument | Inhalt |
|----------|--------|
| [user-guide.md](./user-guide.md) | Funktionen und Oberfläche |
| [developer-guide.md](./developer-guide.md) | Verzeichnisstruktur und Erweiterungen |
| [tool-development-guide.md](./tool-development-guide.md) | Konventionen für eingebaute Tools |
| [TEST_REPORT.md](./TEST_REPORT.md) | Überblick über automatisierte Tests |

Feedback und Beiträge über Issues und Pull Requests im Repository.
