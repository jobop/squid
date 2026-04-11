# Guida allo sviluppo degli strumenti

Definisce le convenzioni di implementazione degli strumenti in squid: pattern unificato, uso efficiente del contesto e coerenza dell’esperienza utente.

## Principi

1. **Efficienza del contesto** — output grandi persistiti automaticamente per non saturare il contesto  
2. **Formato di output uniforme** — tutti gli strumenti espongono il mapping verso il formato standard API  
3. **Compatibilità** — le nuove regole non devono rompere gli strumenti esistenti  
4. **Testabilità** — il comportamento di ogni strumento deve essere verificabile  

## Interfaccia strumento

Ogni strumento deve implementare:

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

## Proprietà chiave

### maxResultSizeChars

Soglia oltre la quale il risultato viene persistito su disco con anteprima nel contesto.

**Valori consigliati:**
- Predefinito: `50000` (~50 KB)  
- Strumenti ad output molto grande (es. lettura file): `50000`  
- Strumenti che controllano già la dimensione: `Infinity` (disabilita persistenza automatica tramite soglia)

### isConcurrencySafe e orchestrazione nella stessa mossa

Il `TaskExecutor` **partiziona** sequenzialmente le `tool_call` dello stesso messaggio assistente: chiamate consecutive con `isConcurrencySafe` vero sugli **input correnti** vengono raggruppate ed eseguite con `Promise.all`; altrimenti si esegue a segmenti in ordine. Per strumenti di scrittura (`write_file`, `file_edit`, …) dichiarati concorrenti valutare **effetti collaterali intra-batch** (percorsi in conflitto); l’host valida i percorsi di scrittura nel batch. In `isConcurrencySafe` riflettere onestamente se, per l’`input` dato, il parallelismo con altre chiamate è sicuro.

## Implementare mapToolResultToToolResultBlockParam

Metodo centrale per convertire l’output dello strumento nel formato standard API.

### Schema base

```typescript
mapToolResultToToolResultBlockParam(
  content: Output,
  toolUseID: string
): ToolResultBlockParam {
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

### Output testuale

```typescript
mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: content || `(${this.name} completed with no output)`,
  };
}
```

### Output strutturato

```typescript
mapToolResultToToolResultBlockParam(
  content: { matches: string[]; count: number },
  toolUseID: string
) {
  const formatted = `Found ${content.count} matches:\n${content.matches.join('\n')}`;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: formatted,
  };
}
```

### Errori

```typescript
mapToolResultToToolResultBlockParam(
  content: { error: string } | string,
  toolUseID: string
) {
  const isError = typeof content === 'object' && 'error' in content;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: isError ? content.error : content,
    is_error: isError,
  };
}
```

### Formattazione complessa (ReadFile)

```typescript
mapToolResultToToolResultBlockParam(
  content: { path: string; content: string; lines: number },
  toolUseID: string
) {
  const header = `File: ${content.path} (${content.lines} lines)\n\n`;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: header + content.content,
  };
}
```

## Integrazione persistenza

Lo sviluppatore dello strumento **non** deve gestire manualmente la persistenza. Il sistema:

1. Chiama `mapToolResultToToolResultBlockParam`  
2. Verifica la dimensione rispetto a `maxResultSizeChars`  
3. Se supera, salva in `~/.squid/sessions/<sessionId>/tool-results/<toolUseId>.txt`  
4. Sostituisce il contenuto con un messaggio di anteprima  

**Formato anteprima:**

```
<persisted-output>
Output too large (125.5 KB). Full output saved to: /path/to/file.txt

Preview (first 2.0 KB):
[primi 2000 byte]
...
</persisted-output>
```

## Esempio completo (Grep)

```typescript
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';

const GrepInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

type GrepInput = z.infer<typeof GrepInputSchema>;
type GrepOutput = {
  matches: Array<{ file: string; line: number; content: string }>;
  count: number;
};

export const GrepTool: Tool<typeof GrepInputSchema, GrepOutput> = {
  name: 'grep',
  description: 'Search for patterns in files',
  inputSchema: GrepInputSchema,
  maxResultSizeChars: 50000,

  async call(
    input: GrepInput,
    context: ToolContext
  ): Promise<ToolResult<GrepOutput>> {
    const matches = await searchFiles(input.pattern, input.path);
    return { data: { matches, count: matches.length } };
  },

  mapToolResultToToolResultBlockParam(
    content: GrepOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content || content.count === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: 'No matches found',
      };
    }
    const formatted = [
      `Found ${content.count} matches:`,
      '',
      ...content.matches.map(m => `${m.file}:${m.line}: ${m.content}`),
    ].join('\n');
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: formatted,
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false,
};
```

## Test

### Unit test

Verificare formattazione, vuoti ed errori per `mapToolResultToToolResultBlockParam`.

### Integrazione persistenza

Verificare che output molto grandi producano il wrapper `<persisted-output>` dopo `processToolResultBlock` (o equivalente nel proprio harness).

## Migrazione strumenti esistenti

1. Aggiungere `maxResultSizeChars` (es. `50000`).  
2. Implementare `mapToolResultToToolResultBlockParam`.  
3. Eseguire test su output piccoli/grandi e formattazione.

## FAQ

**Quando usare `maxResultSizeChars: Infinity`?**  
Quando lo strumento limita già l’output (es. ReadFile con `limit`).

**Il mapping deve gestire gli errori?**  
Sì: impostare `is_error: true` quando `call` restituisce un errore da mostrare al modello.

**Prestazioni della formattazione?**  
Il mapping viene eseguito a ogni chiamata: mantenerlo efficiente.

**Dati binari o immagini?**  
La persistenza testuale non si applica allo stesso modo; per immagini usare blocchi `image` nell’output: il sistema può saltare la persistenza testuale.

**Pulizia automatica dei file persistiti?**  
I file stanno in `~/.squid/sessions/<sessionId>/tool-results/`. Opzioni:
- pulizia manuale delle sessioni vecchie  
- script pianificato (es. eliminare directory sessione più vecchie di 7 giorni)  
- monitoraggio dimensione `~/.squid/sessions/`  

Esempio shell:

```bash
find ~/.squid/sessions -type d -mtime +7 -exec rm -rf {} \;
```

## Gestione file persistiti

- **Percorso:** `~/.squid/sessions/<sessionId>/tool-results/`  
- **Nome file:** `<toolUseId>.txt` o `.json`  
- **Isolamento:** una directory per sessione  

Strategie consigliate: retention per tempo, per dimensione totale, o pulizia a chiusura sessione (secondo prodotto).

## Riferimenti

- **Implementazione di riferimento (claude-code-main):** `claude-code-main/src/utils/toolResultStorage.ts` (nel worktree `yaoc` accanto a `squid`)  
- **Definizione tipo Tool:** `src/tools/base.ts`  
- **Esempi:** `src/tools/read-file.ts`, `src/tools/grep.ts`  

## Registro modifiche documento

- **2026-04-04:** versione iniziale con specifiche strumento  
