# squid – Entwicklerhandbuch

Der Desktop-Laufzeit-Einstieg ist **`src/bun/index.ts`** (Electrobun verweist in `electrobun.config.ts` unter `build.bun.entrypoint` darauf). Der WebView-Frontend-Einstieg liegt unter **`src/browser/`**. Wenn sich die standardmäßig kopierten statischen Assets ändern, **`electrobun.config.ts`** (`build.copy`) pflegen – die CLI liest **keine** `.js`-Konfiguration. **Release-Pakete** müssen `public`, `config` (inkl. `channel-extensions.json`) und `extensions` enthalten, sonst werden Kanal-Erweiterungen nicht gefunden und die Kanalseite zeigt „nicht registriert“ oder fehlende Web-Konfiguration.

## Architektur

### Kernmodule

```
src/
├── tasks/           # Aufgabenverwaltung
│   ├── state-machine.ts      # Zustandsautomat (ask/craft/plan)
│   └── context-compressor.ts # Kontextkompression
├── tools/           # Werkzeugsystem
│   ├── base.ts              # Tool-Typen
│   ├── read-file.ts
│   ├── write-file.ts
│   ├── glob.ts
│   └── grep.ts
├── models/          # KI-Modelle
│   ├── types.ts
│   ├── anthropic.ts
│   ├── openai.ts
│   ├── deepseek.ts
│   └── registry.ts
├── workspace/
│   ├── manager.ts
│   └── sandbox.ts
├── permissions/
│   ├── engine.ts
│   └── classifier.ts
├── skills/
│   ├── loader.ts
│   └── validator.ts
├── experts/
│   └── manager.ts
├── channels/        # Kanäle (WebUI + Erweiterungslader)
├── claw/
│   ├── server.ts
│   └── task-handler.ts
├── utils/
│   └── messageQueueManager.ts # Konversations-Warteschlangen (inkl. Cron-Enqueue)
├── tools/           # inkl. Cron-Tools
│   ├── cron-manager.ts
│   ├── cron-create.ts
│   ├── cron-list.ts
│   ├── cron-status.ts
│   └── cron-runs.ts
└── ui/
    ├── main-layout.tsx
    └── task-wizard.tsx
```

### Prinzipien

1. **Typsicherheit**: TypeScript + Zod  
2. **Unveränderlichkeit**: DeepImmutable für Kontexte  
3. **Modularität**: klare Schnittstellen  
4. **Erweiterbarkeit**: Registry-Muster  

### Werkzeugsystem

Tools sind typbasiert statt klassisch vererbt:

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

### Modelladapter

Einheitliche Schnittstelle:

```typescript
export interface ModelProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
}
```

## Erweiterungen

### Neues Tool

1. Datei unter `src/tools/` anlegen  
2. Eingabe-Schema (Zod) definieren  
3. `Tool`-Typ implementieren  
4. In der Tool-Registry registrieren  

Minimalbeispiel:

```typescript
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './base';

const MyToolInputSchema = z.object({
  param: z.string()
});

export const MyTool: Tool<typeof MyToolInputSchema, string> = {
  name: 'my_tool',
  description: 'Short description',
  inputSchema: MyToolInputSchema,
  maxResultSizeChars: 10000,
  async call(input, context) {
    return { data: 'result' };
  },
  isConcurrencySafe: () => true,
  isReadOnly: () => true
};
```

### Neuer Modellanbieter

1. Datei unter `src/models/`  
2. `ModelProvider` implementieren  
3. in `ModelRegistry` registrieren  

### Neuer Skill

1. Markdown unter `skills/` mit YAML-Frontmatter  
2. Systemprompt im Body  

### Neuer Experte

Definition in `src/experts/types.ts`:

```typescript
export const myExpert: ExpertRole = {
  id: 'my-expert',
  name: 'Expert name',
  description: 'Expert description',
  systemPrompt: 'You are …'
};
```

## Tests

```bash
npm test
npm run test:watch
```

Manuelle Schritte für Kanäle: [integration-testing.md](./integration-testing.md). Weitere Skripte wie `test:integration` siehe `package.json`.

## Build und Release

```bash
npm run dev
npm run build
npm run build:electron
npm run build:electron:release
```

## Beitragsrichtlinien (i18n-Baseline)

1. Codekommentare: Englisch.  
2. System-/Prompt-Templates: Englisch.  
3. Nutzerstrings: i18n-Keys, keine Hardcodes in Geschäftslogik.  
4. Neue Doku: unter `docs/locales/<locale>/`, nicht übersetzte Seiten fallen auf Englisch zurück.

Workflow: Fork, Feature-Branch, Commits, Push, Pull Request.

## Lizenz

MIT License
