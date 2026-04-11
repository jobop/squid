# squid Developer Guide

The desktop runtime entry is **`src/bun/index.ts`** (Electrobun references it from `electrobun.config.ts` → `build.bun.entrypoint`). The WebView front end lives under **`src/browser/`**. When changing which static assets ship, update **`electrobun.config.ts`** `build.copy`—the CLI **does not** read a `.js` config file. **Release bundles must include `public`, `config` (with `channel-extensions.json`), and `extensions`** or channel scanning fails and the Channels page may show “unregistered” / “no extension web configuration”.

## Architecture

### Core modules

```
src/
├── tasks/           # Task management
│   ├── state-machine.ts      # ask / craft / plan
│   └── context-compressor.ts # Context compression
├── tools/           # Tooling system
│   ├── base.ts              # Tool types
│   ├── read-file.ts
│   ├── write-file.ts
│   ├── glob.ts
│   └── grep.ts
├── models/          # AI models
│   ├── types.ts
│   ├── anthropic.ts
│   ├── openai.ts
│   ├── deepseek.ts
│   └── registry.ts
├── workspace/       # Workspace
│   ├── manager.ts
│   └── sandbox.ts
├── permissions/     # Permissions
│   ├── engine.ts
│   └── classifier.ts
├── skills/          # Skills
│   ├── loader.ts
│   └── validator.ts
├── experts/         # Experts
│   └── manager.ts
├── channels/        # Channels (built-in WebUI + extension loader)
├── claw/            # Remote control
│   ├── server.ts
│   └── task-handler.ts
├── utils/           # Queues and helpers
│   └── messageQueueManager.ts # Per-conversation queue (includes cron enqueue)
├── tools/           # Tools (includes cron tools)
│   ├── cron-manager.ts
│   ├── cron-create.ts
│   ├── cron-list.ts
│   ├── cron-status.ts
│   └── cron-runs.ts
└── ui/              # UI
    ├── main-layout.tsx
    └── task-wizard.tsx
```

### Design principles

1. **Type safety**: TypeScript + Zod at boundaries  
2. **Immutability**: `DeepImmutable` constraints on shared context  
3. **Modularity**: single-purpose modules with explicit interfaces  
4. **Extensibility**: registries for tools, models, channels  

### Tool system

Tools are structural types, not a class hierarchy:

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

### Model adapters

All providers implement:

```typescript
export interface ModelProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
}
```

## Extension guide

### Add a tool

1. Create `src/tools/<name>.ts`  
2. Define the Zod input schema  
3. Implement the `Tool` type  
4. Register in the tool registry  

Example:

```typescript
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './base';

const MyToolInputSchema = z.object({
  param: z.string()
});

export const MyTool: Tool<typeof MyToolInputSchema, string> = {
  name: 'my_tool',
  description: 'What this tool does',
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

### Add a model provider

1. Add `src/models/<provider>.ts`  
2. Implement `ModelProvider`  
3. Register in `ModelRegistry`  

Example:

```typescript
import type { ModelProvider, ChatRequest, ChatResponse } from './types';

export class MyModelProvider implements ModelProvider {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // call remote API
    return { content: 'response' };
  }

  async *streamChat(request: ChatRequest) {
    yield { content: 'chunk' };
  }
}
```

### Add a skill

1. Create Markdown under `skills/`  
2. Add YAML front matter  
3. Author the system prompt body  

Example:

```markdown
---
name: my-skill
description: What this skill does
allowed-tools:
  - read_file
  - write_file
---

You are a specialist assistant who ...
```

### Add an expert

Extend `src/experts/types.ts`:

```typescript
export const myExpert: ExpertRole = {
  id: 'my-expert',
  name: 'Display name',
  description: 'Short description',
  systemPrompt: 'You are ...'
};
```

## Testing

```bash
npm test
npm run test:watch
```

Manual channel/integration steps: [integration-testing.md](./integration-testing.md). Additional scripts such as `test:integration` or `test:coverage` follow root `package.json`.

## Build and release

```bash
# Desktop dev (Electrobun)
npm run dev

# TypeScript compile
npm run build

# Desktop bundle (default dev channel; see build/)
npm run build:electron

# Stable release build (outputs artifacts/ for CI uploads)
npm run build:electron:release
```

## Contributing

### Language and prompt baseline (i18n)

1. New or updated code comments: **English**.  
2. New or updated system prompts / `promptTemplate`: **English**.  
3. User-visible strings: prefer i18n keys—avoid hard-coded literals in business logic.  
4. New documentation should land under `docs/locales/<locale>/`; untranslated pages fall back to English.

### Git workflow

1. Fork the repository  
2. Create a feature branch  
3. Commit changes  
4. Push the branch  
5. Open a pull request  

## License

MIT License
