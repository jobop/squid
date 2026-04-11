# squid

squid ist eine **lokal betriebene KI-Desktop-Arbeitsumgebung**: Sie führen im Anwendungsfenster Dialoge mit Modellen, verwalten mehrere Sitzungen, weisen jeder Sitzung ein Arbeitsverzeichnis zu und können in den Einstellungen Anthropic, OpenAI oder kompatible Endpunkte anbinden. Fähigkeiten (Skills), Gedächtnis, zeitgesteuerte Aufgaben sowie Kanäle wie Feishu, Telegram oder WeChat (nach Aktivierung und Konfiguration in der App) arbeiten auf derselben Aufgabenpipeline. Konfiguration und Daten liegen standardmäßig unter **`~/.squid`** im Benutzerverzeichnis.

**Version**: 0.1.0  
**Lizenz**: MIT

---

## Was Sie mit squid tun können

- **Mehrfach-Chat**: Gespräche als Threads; pro Sitzung ein gebundenes Arbeitsverzeichnis für projektbezogene Fragen oder Dateizugriff innerhalb der erlaubten Grenzen.
- **Aufgabenmodi**: In der Oberfläche **Ask** (Beratung und überwiegend schreibgeschützte Analyse), **Craft** (Werkzeugketten mit Ausführung), **Plan** (Planung und Zerlegung) usw.; genaues Verhalten siehe In-App-Hilfe.
- **Modelle und Schlüssel**: API-Keys, Modellnamen und benutzerdefinierte Basis-URLs in den **Einstellungen**; Secrets nur lokal, nicht im Repository.
- **Skills**: Skills im App-Browser installieren und verwalten (u. a. Tencent SkillHub); installierte Inhalte unter `~/.squid/skills`.
- **Experten und Gedächtnis**: Vorgefertigte oder eigene „Experten“ für Stil und Grenzen; Langzeitgedächtnis separat einsehbar und pflegbar.
- **Zeitpläne**: Cron-basierte lokale Trigger, Inhalte gehen an das Modell, mit Ausführungsprotokoll.
- **Kanäle**: Neben der Haupt-Oberfläche optionale Erweiterungen (Feishu, Telegram, WeChat usw.) mit Konfiguration in den Kanaleinstellungen; teils Login oder Webhook nötig, siehe `docs` und jeweilige Kanalhinweise.

---

## Installation und Start

**Aus dem Quellcode (Entwickler oder eigener Build)**

- **Node.js** (empfohlen 22 LTS) und **npm**; die Desktop-Shell nutzt **Electrobun**, unterstützt macOS 14+, Windows 11+ und die in der Electrobun-Dokumentation genannten Linux-Umgebungen.
- Nach dem Klonen im Projektstamm:

```bash
cd squid
npm install
npm run dev
```

**Release-Pakete**

- Falls GitHub-Releases o. Ä. bereitstehen: passendes Artefakt installieren oder entpacken und starten. Nicht signierte/nicht notarierte macOS-Builds können beim ersten Start blockiert werden; Freigabe unter „Datenschutz & Sicherheit“ nach Bedarf.

---

## Erste Schritte

1. **Einstellungen** öffnen, Modell und ggf. Kanäle konfigurieren und speichern.  
2. Im Chat-Bereich das **Arbeitsverzeichnis** wählen (keine nicht vertrauenswürdigen Pfade als Workspace).  
3. **Neue Sitzung** mit kurzer Anfrage testen; Skills, Zeitpläne oder Kanäle bei Bedarf danach.

Ausführlichere Oberflächenbeschreibung: **[QUICK_START.md](./QUICK_START.md)** und **[user-guide.md](./user-guide.md)**.  
Mehrsprachige Dokumentation (u. a. EN/JA/RU/IT/FR/DE): **[docs/index.html](../../index.html)** mit Sprachumschaltung.

---

## Wo Daten liegen

| Pfad | Bedeutung |
|------|-----------|
| `~/.squid/config.json` | Hauptkonfiguration inkl. Modell-Keys und Teilen der Feature-Schalter |
| `~/.squid/skills/` | Installierte Skill-Dateien |
| Weitere JSON unter `~/.squid` | Kanal-Erweiterungen, Gedächtnis usw. (entstehen bei Nutzung) |

Bitte selbst sichern; keine Secrets in öffentliche Repos pushen. Für WeChat-Personal u. Ä. kann aus dem Quellverzeichnis **`npm run weixin-personal:login`** nötig sein – siehe Erweiterungsdokumentation.

---

## Sicherheitshinweise

- Datei- und Befehlsfähigkeiten sind durch **Arbeitsverzeichnis** und eingebaute Regeln begrenzt; keine sensiblen Systemverzeichnisse als Standard-Workspace.  
- Die App stellt lokal nur Dienste für UI↔Hauptprozess bereit; normalerweise kein bewusstes Öffnen ins LAN/Internet – bei Port-Weiterleitung oder Reverse-Proxy selbst Authentifizierung und Zugriffskontrolle sicherstellen.

---

## Entwicklung aus dem Quellcode (Kurz)

squid nutzt **Electrobun**: Hauptprozess und lokaler Dienst laufen auf Bun-Seite, die Oberfläche in der System-WebView. Beim Arbeiten im **geklonten Repository** kann **`SQUID_ROOT`** auf den Repository-Stamm zeigen, damit `config/channel-extensions.json` gefunden wird; Endnutzer von Installationspaketen brauchen das in der Regel nicht. Architektur, Erweiterungen und Tool-Konventionen: **[developer-guide.md](./developer-guide.md)** und **[tool-development-guide.md](./tool-development-guide.md)**.

---

## Weitere Dokumentation

| Dokument | Zielgruppe |
|----------|------------|
| [QUICK_START.md](./QUICK_START.md) | Schnell produktiv werden |
| [user-guide.md](./user-guide.md) | Systematische Funktionsübersicht |
| [developer-guide.md](./developer-guide.md) | Mitentwicklung und Erweiterungen |
| [tool-development-guide.md](./tool-development-guide.md) | Eingebaute Tools anpassen oder neu schreiben |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | Versionshinweise |
| [TEST_REPORT.md](./TEST_REPORT.md) | Tests und Qualität |

---

## Lizenz

Dieses Projekt steht unter der **MIT License**.
