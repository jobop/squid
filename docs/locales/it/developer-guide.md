# Documentazione per sviluppatori squid

Il punto di ingresso del runtime desktop è **`src/bun/index.ts`** (Electrobun lo referenzia in `electrobun.config.ts` come `build.bun.entrypoint`). Il frontend WebView parte da **`src/browser/`**. Quando si modificano le risorse statiche copiate di default, aggiornare anche **`electrobun.config.ts`** (`build.copy`): la CLI **non legge** file di configurazione `.js`. Le build di rilascio devono includere `public`, `config` (con `channel-extensions.json`) ed **`extensions`**, altrimenti le estensioni canale non vengono trovate e la pagina Canali mostra «non registrato» o messaggi su configurazione Web mancante.

## Architettura

### Moduli principali

```
src/
├── tasks/           # Gestione attività
│   ├── state-machine.ts      # Macchina a stati (ask/craft/plan)
│   └── context-compressor.ts # Compressione contesto
├── tools/           # Sistema strumenti
│   ├── base.ts              # Definizioni tipo
│   ├── read-file.ts         # Lettura file
│   ├── write-file.ts        # Scrittura file
│   ├── glob.ts              # Pattern file
│   └── grep.ts              # Ricerca contenuto
├── models/          # Modelli AI
│   ├── types.ts             # Definizioni interfaccia
│   ├── anthropic.ts         # Adattatore Anthropic
│   ├── openai.ts            # Adattatore OpenAI
│   ├── deepseek.ts          # Adattatore DeepSeek
│   └── registry.ts          # Registry modelli
├── workspace/       # Area di lavoro
│   ├── manager.ts           # Gestione directory
│   └── sandbox.ts           # Sandbox percorsi
├── permissions/     # Permessi
│   ├── engine.ts            # Motore regole
│   └── classifier.ts        # Classificazione strumenti
├── skills/          # Skill
│   ├── loader.ts            # Caricamento skill
│   └── validator.ts         # Validazione permessi
├── experts/         # Esperti
│   └── manager.ts           # Gestione esperti
├── channels/        # Canali (WebUI integrato + caricamento estensioni)
├── claw/            # Controllo remoto
│   ├── server.ts            # Server HTTP
│   └── task-handler.ts      # Elaborazione attività
├── utils/           # Code e utilità
│   └── messageQueueManager.ts # Coda per conversazione (incluso cron in coda)
├── tools/           # Sistema strumenti (inclusi strumenti Cron)
│   ├── cron-manager.ts      # Pianificazione e persistenza Cron
│   ├── cron-create.ts       # Strumento creazione Cron
│   ├── cron-list.ts         # Strumento elenco Cron
│   ├── cron-status.ts       # Strumento stato pianificatore
│   └── cron-runs.ts         # Strumento log esecuzioni
└── ui/              # Interfaccia utente
    ├── main-layout.tsx      # Layout principale
    └── task-wizard.tsx      # Procedura attività
```

### Principi di progetto

1. **Type safety**: TypeScript + Zod
2. **Immutabilità**: vincoli DeepImmutable sul contesto
3. **Modularità**: responsabilità singole, interfacce chiare
4. **Estensibilità**: pattern registry per le estensioni

### Sistema strumenti

Gli strumenti sono definiti come tipi, non tramite ereditarietà da classi:

```typescript
export type Tool<Input, Output> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  maxResultSizeChars: number;
  call(input: Input, context: ToolContext): Promise<ToolResult<Output>>;
  isConcurrencySafe(input: Input): boolean;
  isReadOnly(input: Input): boolean;
  isDestructive?(input: Input): boolean;
};
```

### Adattatori modello

Tutti i fornitori implementano la stessa interfaccia:

```typescript
export interface ModelProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
}
```

## Guida alle estensioni

### Aggiungere uno strumento

1. Creare un file in `src/tools/`
2. Definire lo schema di input (Zod)
3. Implementare il tipo `Tool`
4. Registrarlo nel registry strumenti

Esempio:

```typescript
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './base';

const MyToolInputSchema = z.object({
  param: z.string()
});

export const MyTool: Tool<typeof MyToolInputSchema, string> = {
  name: 'my_tool',
  description: 'Tool description',
  inputSchema: MyToolInputSchema,
  maxResultSizeChars: 10000,
  async call(input, context) {
    // implementation
    return { data: 'result' };
  },
  isConcurrencySafe: () => true,
  isReadOnly: () => true
};
```

### Aggiungere un fornitore modello

1. Creare un file in `src/models/`
2. Implementare `ModelProvider`
3. Registrarlo in `ModelRegistry`

Esempio:

```typescript
import type { ModelProvider, ChatRequest, ChatResponse } from './types';

export class MyModelProvider implements ModelProvider {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // call model API
    return { content: 'response' };
  }

  async *streamChat(request: ChatRequest) {
    // streaming
    yield { content: 'chunk' };
  }
}
```

### Aggiungere una skill

1. Creare un file Markdown in `skills/`
2. Aggiungere frontmatter YAML
3. Scrivere il prompt di sistema

Esempio:

```markdown
---
name: my-skill
description: Skill description
allowed-tools:
  - read_file
  - write_file
---

You are a professional assistant skilled at ...
```

### Aggiungere un esperto

In `src/experts/types.ts` aggiungere la definizione:

```typescript
export const myExpert: ExpertRole = {
  id: 'my-expert',
  name: 'Expert name',
  description: 'Expert description',
  systemPrompt: 'You are a ...'
};
```

## Test

```bash
npm test
npm run test:watch
```

Passi manuali per integrazione e canali: [integration-testing.md](../../integration-testing.md). Eventuali script `test:integration`, `test:coverage`, ecc. sono definiti nel `package.json` alla radice.

## Build e rilascio

```bash
# Sviluppo desktop (Electrobun)
npm run dev

# Compilazione TypeScript
npm run build

# Pacchettizzazione desktop (canale dev predefinito, output in build/)
npm run build:electron

# Build release canale stabile (output artifacts/, per upload CI su Release)
npm run build:electron:release
```

## Linee guida per i contributi (i18n di base)

1. Commenti nel codice nuovo o modificato: **inglese**.
2. System prompt / `promptTemplate` nuovi o modificati: **inglese**.
3. Testo visibile all’utente: preferire chiavi i18n, evitare stringhe hard-coded nella logica di business.
4. Nuova documentazione: struttura `docs/locales/<locale>/`; le pagine non tradotte tornano all’inglese.

Flusso GitHub classico:

1. Fork del repository
2. Branch feature
3. Commit delle modifiche
4. Push del branch
5. Pull Request

## Licenza

MIT License
