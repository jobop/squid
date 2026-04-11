# Channel-Erweiterungen (dynamisches Laden)

## P0-Vertrauensmodell (Pflichtlektüre)

Erweiterungen werden per Bun-**dynamischem `import()`** im **gleichen Prozess** wie der Hauptprozess geladen – **keine** Speicher-Sandbox. Nur **vertrauenswürdige**, nachvollziehbare Erweiterungen installieren und konfigurieren. Ohne konfigurierte `roots` werden keine Erweiterungen geladen; **Feishu** liegt im Repo unter `extensions/feishu/` und wird typischerweise über `config/channel-extensions.json` mit `enabled: ["feishu"]` geladen (Kanalseite zeigt Quelle „Erweiterung“).

Priorität und Konflikte:

- **Eingebaut** ist nur WebUI; **Feishu** und andere Erweiterungen registriert der Loader. Erweiterungen **dürfen** keine bereits registrierte gleiche `id` **überschreiben** (eingebautes `webui` vor Erweiterungen); bei Konflikt wird übersprungen und in `GET /api/channels` unter `errors` protokolliert.
- Deklarieren zwei Pakete dieselbe `id`, gilt **wer zuerst erfolgreich registriert**, der andere wird übersprungen.

## Paketstruktur

Jedes Plugin in einem Unterverzeichnis; der Elternpfad steht in `roots`:

```text
<root>/
  my-plugin/
    channel-plugin.json
    plugin.ts        # oder .js, gemäß main
```

### channel-plugin.json

| Feld | Bedeutung |
|------|-----------|
| `id` | Eindeutige ID, muss mit `ChannelPlugin.id` aus der Fabrik übereinstimmen |
| `name` | Anzeigename |
| `version` | Versionsstring |
| `main` | ESM-Eintrag relativ zum Plugin-Verzeichnis, kein absoluter Pfad und kein `..` |
| `capabilities` / `permissions` | optional, reserviert |

### Einstiegsmodul

**Standardexport** oder benannter Export **`createChannelPlugin`**: Fabrik, die `ChannelPlugin` oder `Promise<ChannelPlugin>` zurückgibt.

Schnittstelle: `src/channels/types.ts` (`config`, `outbound`, `status` Pflicht; `setup` für Long-Lived-Verbindungen empfohlen).

## Konfiguration

Zwei Quellen werden zusammengeführt (beide vorhanden: `roots` mergen; **`enabled` hat Vorrang in `~/.squid/channel-extensions.json`**):

1. `squid/config/channel-extensions.json` (eigen anlegen, Vorlage `config/channel-extensions.example.json`)
2. `~/.squid/channel-extensions.json`

Felder:

- **`roots`**: `string[]`, jeder Eintrag ist ein **Elternpfad** mit mehreren Plugin-Unterverzeichnissen. Absolut oder relativ zum **squid-Repository-Stamm**.
- **`enabled`** (optional): fehlt oder `null` → alle validierten Kandidaten laden; `[]` → keine Erweiterungen; nicht leere Liste → **nur** die genannten `id`.

### Benutzerverzeichnis `~/.squid/extensions` (ohne Eintrag in roots)

Existiert **`~/.squid/extensions`**, wird es **automatisch** als zusätzliche Scan-Wurzel mit den `roots` zusammengeführt (fehlendes Verzeichnis: still ignorieren). Eigene Plugins z. B. unter `~/.squid/extensions/my-plugin/channel-plugin.json`. Das Laden bleibt an **`enabled`** gebunden (bei Standard nur `feishu` muss die eigene `id` in `~/.squid/channel-extensions.json` oder Projekt-`enabled` stehen).

Nach Konfigurationsänderungen den **Host-Prozess neu starten**.

## Beispiel

Im Repo liegt `extensions/example-echo-channel/`. In `config/channel-extensions.json`:

```json
{
  "roots": ["extensions"],
  "enabled": ["echo-demo"]
}
```

Nach Neustart erscheint in der Seitenleiste „Kanäle“ eine Zeile mit Quelle „Erweiterung“ für `echo-demo`.

## API

- `GET /api/channels` liefert `{ "channels": [...], "errors": [...] }`. Jeder Kanal hat `source`: `"builtin"` | `"extension"`. `errors` enthält nicht-fatale Ladefehler (ohne Secrets).

## Lokales Debugging

1. Unter `roots` Unterverzeichnis und `channel-plugin.json` anlegen.  
2. Bei TypeScript-Einstieg sicherstellen, dass **Bun** lädt (Desktop-Backend).  
3. Konsole `[ChannelExtensions]` und orangefarbene UI-Hinweiszeile prüfen.

## Sitzung beschäftigt: Warteschlange und Antwort (ohne weitere `QueuedCommand`-Felder)

Wie bei Feishu / Telegram sollen neue Kanäle bei **Enqueue nach Abschluss die Assistentenantwort in dieselbe Konversation** zurücksenden:

1. In **`setup.initialize`**: Wenn der Fabrikkontext **`ctx.taskAPI`** enthält (Host ruft `initializeBuiltinChannels(taskAPI)`), **`registerXxxSquidBridge(ctx.taskAPI)`** (oder gleichwertig) aufrufen; in der Brücke **`taskAPI.addChannelQueuedCompleteHandler(...)`** und nur bei `cmd.channelReply?.channelId === '<Ihre channel id>'` antworten; in **`setup.cleanup`** die von der Brücke zurückgegebene Deinstallationsfunktion aufrufen. Der Host muss **nicht** pro Kanal `import registerXxxSquidBridge` duplizieren.
2. Bei beschäftigter Sitzung **`enqueueFromRequest(..., { channelReply: { channelId: '<wie oben>', chatId: '<Routing-Schlüssel>' } })`**. `chatId` ist der zentrale String; Semantik legt der Kanal fest.

Typen: **`ChannelQueueReply`** in `src/utils/messageQueueManager.ts`. Keine weiteren `xxxChatId`-Felder im Kern hinzufügen.

## Verhältnis zu eingebauten Beiträgen

- **Eingebaut**: Weiterhin PRs in `src/channels` und Registrierung in `initializeBuiltinChannels`.  
- **Erweiterungen**: für private oder experimentelle Kanäle ohne Kern-Registry; Sicherheitsverantwortung bei Deployment und Quelle der Erweiterung.
