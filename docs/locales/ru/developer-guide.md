# Документация разработчика squid

Точка входа десктопа: **`src/bun/index.ts`** (Electrobun подключает его из `electrobun.config.ts` → `build.bun.entrypoint`). Фронтенд WebView: **`src/browser/`**. При изменении копируемых статических файлов синхронно правьте **`electrobun.config.ts`** → `build.copy` (CLI **не читает** `.js` конфиг). **В релизе должны быть** `public`, `config` (включая `channel-extensions.json`) и `extensions` — иначе расширения каналов не сканируются, в UI возможны «не зарегистрирован» или «нет web‑конфига».

## Архитектура

### Основные модули

```
src/
├── tasks/           # Задачи
│   ├── state-machine.ts      # Автомат ask/craft/plan
│   └── context-compressor.ts # Сжатие контекста
├── tools/           # Инструменты
│   ├── base.ts              # Типы инструментов
│   ├── read-file.ts
│   ├── write-file.ts
│   ├── glob.ts
│   └── grep.ts
├── models/          # Модели ИИ
│   ├── types.ts
│   ├── anthropic.ts
│   ├── openai.ts
│   ├── deepseek.ts
│   └── registry.ts
├── workspace/       # Рабочая область
│   ├── manager.ts
│   └── sandbox.ts
├── permissions/     # Права
│   ├── engine.ts
│   └── classifier.ts
├── skills/
│   ├── loader.ts
│   └── validator.ts
├── experts/
│   └── manager.ts
├── channels/        # Каналы (WebUI + динамические расширения)
├── claw/
│   ├── server.ts
│   └── task-handler.ts
├── utils/
│   └── messageQueueManager.ts # Очередь по conversationId (в т.ч. cron)
├── tools/           # в т.ч. cron-инструменты
│   ├── cron-manager.ts
│   ├── cron-create.ts
│   ├── cron-list.ts
│   ├── cron-status.ts
│   └── cron-runs.ts
└── ui/
    ├── main-layout.tsx
    └── task-wizard.tsx
```

### Принципы

1. **Типобезопасность**: TypeScript + Zod  
2. **Иммутабельность**: ограничения DeepImmutable для контекста  
3. **Модули**: узкая ответственность, явные интерфейсы  
4. **Расширяемость**: паттерн реестра  

### Система инструментов

Инструмент описывается типом, а не классом:

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

### Адаптеры моделей

Единый интерфейс провайдера:

```typescript
export interface ModelProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
}
```

## Расширение

### Новый инструмент

1. Файл в `src/tools/`
2. Схема входа (Zod)
3. Реализация типа `Tool`
4. Регистрация в реестре инструментов

Пример:

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
    return { data: 'result' };
  },
  isConcurrencySafe: () => true,
  isReadOnly: () => true
};
```

### Новый провайдер модели

1. Файл в `src/models/`
2. Реализация `ModelProvider`
3. Регистрация в `ModelRegistry`

Пример:

```typescript
import type { ModelProvider, ChatRequest, ChatResponse } from './types';

export class MyModelProvider implements ModelProvider {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    return { content: 'response' };
  }

  async *streamChat(request: ChatRequest) {
    yield { content: 'chunk' };
  }
}
```

### Новый skill

1. Markdown в `skills/`
2. YAML frontmatter
3. Системный промпт

Пример:

```markdown
---
name: my-skill
description: Skill description
allowed-tools:
  - read_file
  - write_file
---

You are a professional assistant skilled at...
```

### Новый эксперт

В `src/experts/types.ts`:

```typescript
export const myExpert: ExpertRole = {
  id: 'my-expert',
  name: 'Expert name',
  description: 'Expert description',
  systemPrompt: 'You are...'
};
```

## Тесты

```bash
npm test
npm run test:watch
```

Ручные шаги по каналам: [integration-testing.md](./integration-testing.md). Скрипты `test:integration`, `test:coverage` и т.д. — см. корневой `package.json`.

## Сборка и релиз

```bash
npm run dev
npm run build
npm run build:electron
npm run build:electron:release
```

## Вклад в проект

### Язык и i18n

1. Комментарии в новом/изменённом коде — на английском.  
2. System prompt / promptTemplate — на английском.  
3. Пользовательский текст — через i18n, без жёстких строк в бизнес‑логике.  
4. Новая документация — в `docs/locales/<locale>/`; без перевода — fallback на английский.

### Процесс

1. Fork  
2. Ветка фичи  
3. Коммиты  
4. Push  
5. Pull Request  

## Лицензия

MIT License
