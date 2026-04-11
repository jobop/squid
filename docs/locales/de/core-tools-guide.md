# Leitfaden zu den Kern-Tools

Dieses Dokument beschreibt zehn zentrale Tools in squid: Nutzung und Einschränkungen.

## 1. FileEditTool (`file_edit`)

**Zweck**: Präzises Ersetzen von Dateiinhalten per exakter String-Suche.

**Eingaben**:
- `file_path` (string): Zieldatei
- `old_string` (string): zu ersetzender Text
- `new_string` (string): neuer Text
- `replace_all` (boolean, optional): alle Treffer ersetzen (Standard: false)

**Beispiel**:
```typescript
{
  file_path: "src/index.ts",
  old_string: "const port = 3000",
  new_string: "const port = 8080"
}
```

**Einschränkungen**:
- Mehrere Treffer ohne `replace_all=true` führen zu einem Fehler
- Keine regulären Ausdrücke, nur exakte Strings

---

## 2. BashTool (`bash`)

**Zweck**: Bash-Befehle ausführen, mit Timeout und optional im Hintergrund.

**Eingaben**:
- `command` (string): Bash-Befehl
- `working_directory` (string, optional): Arbeitsverzeichnis
- `timeout` (number, optional): Timeout in ms (Standard 30000)
- `run_in_background` (boolean, optional): Hintergrundausführung

**Beispiel**:
```typescript
{
  command: "npm install",
  working_directory: "/path/to/project",
  timeout: 60000
}
```

**Einschränkungen**:
- Keine interaktiven Befehle
- Hintergrundjobs werden nicht persistiert
- Als destruktiv markiert, erfordert Vertrauen des Nutzers

---

## 3. PowerShellTool (`powershell`)

**Zweck**: PowerShell-Befehle (nur Windows).

**Eingaben**:
- `command` (string)
- `working_directory` (string, optional)
- `timeout` (number, optional, Standard 30000)
- `run_in_background` (boolean, optional)

**Beispiel**:
```typescript
{
  command: "Get-Process | Where-Object {$_.CPU -gt 100}",
  timeout: 10000
}
```

**Einschränkungen**:
- Nur unter Windows
- Auf Nicht-Windows-Fehler

---

## 4. WebSearchTool (`web_search`)

**Zweck**: Websuche über DuckDuckGo, Ergebnisliste.

**Eingaben**:
- `query` (string): Suchbegriff
- `max_results` (number, optional, Standard 10, Maximum 10)

**Beispiel**:
```typescript
{
  query: "TypeScript best practices",
  max_results: 5
}
```

**Einschränkungen**:
- Abhängig von der HTML-Struktur von DuckDuckGo (kann bei Layoutänderungen brechen)
- Kein API-Key, Qualität kann hinter kostenpflichtigen APIs zurückbleiben
- Maximal 10 Treffer

---

## 5. Cron-Toolgruppe

### 5.1 CronCreateTool (`cron_create`)

**Zweck**: Zeitplan anlegen.

**Eingaben**:
- `cron_expression` (string): Cron-Ausdruck (z. B. `"0 * * * *"` stündlich)
- `task_content` (string): Beschreibung des auszuführenden Inhalts

**Beispiel**:
```typescript
{
  cron_expression: "0 9 * * *",
  task_content: "Tägliches Backup um 9:00"
}
```

### 5.2 CronDeleteTool (`cron_delete`)

**Zweck**: Zeitplan löschen.

**Eingabe**: `task_id` (string)

### 5.3 CronListTool (`cron_list`)

**Zweck**: Alle Zeitpläne auflisten.

**Eingaben**: keine

**Einschränkungen**:
- Speicherung im Speicher, nach Neustart weg (Persistenz ggf. später)

---

## 6. SkillTool (`skill`)

**Zweck**: Registrierten Skill (vordefinierte Aufgabenvorlage) aufrufen.

**Eingaben**:
- `skill_name` (string): Name des Skills
- `args` (string, optional): Argumente

**Beispiel**:
```typescript
{
  skill_name: "code-review",
  args: "src/components/Button.tsx"
}
```

**Einschränkungen**:
- Nur Skills mit `user-invocable: true`
- Skill-Dateien unter `~/.squid/skills/`
- Ausführung braucht Modellkonfiguration (`~/.squid/config.json`)
- Kann weitere Tool-Aufrufe auslösen

---

## 7. BriefTool (`brief`)

**Zweck**: Inhalte zusammenfassen, mehrere Stile.

**Eingaben**:
- `content` (string): Ausgangstext
- `prompt` (string, optional): eigener Hinweis
- `type` (enum, optional): `brief` | `detailed` | `bullet_points`

**Beispiel**:
```typescript
{
  content: "Langer Artikeltext …",
  type: "bullet_points"
}
```

**Einschränkungen**:
- Erwartet `ANTHROPIC_API_KEY` in der Umgebung (laut Originaldoku)
- Inhalte über 50000 Zeichen werden gekürzt
- Externe API, ggf. Kosten

---

## 8. AgentTool (`agent`)

**Zweck**: Unter-Agent für komplexe Aufgaben mit eigenem Kontext.

**Eingaben**:
- `instruction` (string): Aufgabe
- `timeout` (number, optional, Standard 300000 ms = 5 Minuten)

**Beispiel**:
```typescript
{
  instruction: "Alle TypeScript-Dateien im Projekt auf mögliche Performanceprobleme prüfen",
  timeout: 600000
}
```

**Einschränkungen**:
- Modellkonfiguration nötig
- Standard-Timeout 5 Minuten, überschreibbar
- Läuft über die gemeinsame Ausführungskette, liefert strukturierte Metadaten (Executor, Modus, Workspace, Dauer)

---

## Tool-Metadaten

Jedes Tool kann folgende Eigenschaften haben:

- **isConcurrencySafe**: parallelisierbar
- **isReadOnly**: nur lesend
- **isDestructive**: kann Systemzustand ändern

## Ergebnis-Persistenz

Alle Tools implementieren `mapToolResultToToolResultBlockParam`:

- Überschreitet die Ausgabe `maxResultSizeChars`, wird sie auf die Platte geschrieben
- In den Kontext kommt eine Vorschau

## Sicherheit

1. **BashTool / PowerShellTool**: beliebige Systembefehle – mit Vorsicht nutzen  
2. **FileEditTool**: schreibt direkt in Dateien – idealerweise mit Versionskontrolle  
3. **BriefTool / AgentTool**: externe APIs, Keys schützen  
4. **WebSearchTool**: geparster Inhalt kann Schadcode enthalten – validieren  

## Tests

Umfassende Unit-Tests für Normalfälle, Grenzen, Fehler und Schnittstellenkonformität.

```bash
npm test -- file-edit.test.ts bash.test.ts powershell.test.ts web-search.test.ts cron-tools.test.ts skill.test.ts brief.test.ts agent.test.ts
```
