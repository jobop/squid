# Leitfaden zur Tool-Entwicklung

Dieses Dokument definiert die Implementierungsregeln für Tools in squid: einheitliches Muster, kontrollierte Kontextgröße und gute Testbarkeit.

## Grundprinzipien

1. **Kontexteffizienz** – große Ergebnisse automatisch persistieren  
2. **Einheitliches Ausgabeformat** – Mapping in den API-Standard  
3. **Abwärtskompatibilität** – bestehende Tools nicht brechen  
4. **Testbarkeit** – Verhalten pro Tool überprüfbar  

## Tool-Schnittstelle

Jedes Tool muss u. a. folgende Elemente bereitstellen:

```typescript
interface Tool<Input extends z.ZodType = z.ZodType, Output = unknown, P = any> {
  name: string;
  description: string;
  inputSchema: Input;
  maxResultSizeChars: number;
  call(
    input: z.infer<Input>,
    context: ToolContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string
  ): ToolResultBlockParam;
  isConcurrencySafe(input: z.infer<Input>): boolean;
  isReadOnly(input: z.infer<Input>): boolean;
  isDestructive?(input: z.infer<Input>): boolean;
}
```

## Wichtige Attribute

### `maxResultSizeChars`

Schwellwert für automatische Persistenz. Darüber hinaus: Speichern auf Platte und Vorschau zurück an das Modell.

**Empfehlung:**

- Standard: `50000`  
- Tools mit kontrollierter Ausgabe: ggf. `Infinity`, wenn die Größe ohnehin begrenzt ist  

### `isConcurrencySafe` und Batch-Ausführung

Der `TaskExecutor` partitioniert mehrere `tool_call`s **in derselben** Assistentennachricht: aufeinanderfolgende Aufrufe, die bei **aktuellen Parametern** beide `isConcurrencySafe === true` liefern, werden in einem Block per `Promise.all` ausgeführt; sonst sequentiell. Schreib-Tools müssen **Nebenwirkungen** (z. B. gleicher Pfad) berücksichtigen; der Host prüft Schreibpfade innerhalb eines Batches – `isConcurrencySafe` muss ehrlich zum parallelen Einsatz mit anderen Aufrufen passen.

## `mapToolResultToToolResultBlockParam`

Wandelt die Tool-Ausgabe in `ToolResultBlockParam` um.

### Grundmuster

```typescript
mapToolResultToToolResultBlockParam(content, toolUseID): ToolResultBlockParam {
  if (!content) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `(${this.name} completed with no output)`,
    };
  }
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: this.formatOutput(content),
  };
}
```

### Text, strukturierte Daten, Fehler

Siehe englische Referenzimplementierungen in `src/tools/grep.ts` u. a.: leere Treffer, JSON-formatierte Listen, `is_error: true` bei Fehlerobjekten.

## Persistenz-Integration

Der Tool-Autor muss Persistenz **nicht** manuell auslösen:

1. `mapToolResultToToolResultBlockParam` aufrufen  
2. serialisierte Größe prüfen  
3. bei Überschreitung in `~/.squid/sessions/<sessionId>/tool-results/<toolUseId>.txt` schreiben  
4. Platzhalter-`<persisted-output>`-Vorschau liefern  

## Vollständiges Beispiel (Grep)

Siehe `src/tools/grep.ts` im Repository – enthält `call`, Mapping, `isConcurrencySafe` / `isReadOnly` / `isDestructive`.

## Tests

- Mapping: leer, typische Treffer, große Ergebnisse  
- Persistenz: künstlich >50k Zeichen, erwarte `<persisted-output>` im verarbeiteten Block  

## Migration bestehender Tools

1. `maxResultSizeChars` setzen  
2. `mapToolResultToToolResultBlockParam` implementieren  
3. `npm test` für betroffene Dateien  

## FAQ

**Wann `Infinity`?** Wenn das Tool die Ausgabegröße selbst begrenzt (z. B. ReadFile mit `limit`).

**Fehler im Mapping?** Ja – `is_error: true`, wenn `call` fehlschlägt oder ein Fehlerobjekt zurückkommt.

**Aufwändige Formatierung?** Erlaubt, sollte aber schnell bleiben.

**Binär-/Bilddaten?** Persistenz ist textorientiert; Bilder als spezielle Blöcke behandeln (System kann Persistenz überspringen).

**Aufräumen persistierter Dateien?** Unter `~/.squid/sessions/…` – manuell oder per Skript (z. B. `find … -mtime +7`), Monitoring der Verzeichnisgröße empfohlen.

## Referenzen

- Referenzimplementierung: `claude-code-main/src/utils/toolResultStorage.ts` (Schwesterverzeichnis im Arbeitsbereich, falls vorhanden)  
- Tool-Typ: `src/tools/base.ts`  
- Beispiele: `src/tools/read-file.ts`, `src/tools/grep.ts`  

## Changelog (Doku)

- **2026-04-04**: Erste Fassung der Tool-Richtlinien  
