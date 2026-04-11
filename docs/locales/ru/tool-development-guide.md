# Руководство по разработке инструментов

Спецификация реализации инструментов в squid: единый формат вывода, лимиты размера результата и поведение при больших ответах.

## Принципы

1. **Эффективность контекста** — крупные результаты автоматически выносятся на диск.  
2. **Единый формат ответа** — через `mapToolResultToToolResultBlockParam`.  
3. **Обратная совместимость** — существующие инструменты не ломаем без необходимости.  
4. **Тестируемость** — поведение должно проверяться автотестами.  

## Контракт `Tool`

Каждый инструмент реализует:

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

## Ключевые поля

### maxResultSizeChars

Порог, после которого результат сериализуется на диск, а в модель уходит превью.

**Рекомендации:**

- по умолчанию: `50000` (~50 KB);
- большие выборки (чтение файлов): `50000`;
- если размер контролируется самим инструментом: `Infinity` (отключить автоперсистентность).

### isConcurrencySafe и планирование в одном сообщении

`TaskExecutor` **группирует** подряд идущие `tool_call` в одном сообщении ассистента: если у соседних вызовов при текущих аргументах `isConcurrencySafe === true`, они выполняются параллельно (`Promise.all`), иначе — последовательно. Для `write_file` / `file_edit` даже при «безопасности для параллели» учитывайте **побочные эффекты** (конфликт путей); хост дополнительно валидирует пути записи внутри батча — в `isConcurrencySafe` отражайте реальную безопасность для конкретного `input`.

## Реализация mapToolResultToToolResultBlockParam

### Базовый шаблон

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

### Текст

```typescript
mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: content || `(${this.name} completed with no output)`,
  };
}
```

### Структурированные данные

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

### Ошибки

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

### Сложный пример (ReadFile)

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

## Персистентность (автоматика)

Разработчику **не нужно** вручную писать на диск:

1. Вызывается `mapToolResultToToolResultBlockParam`.  
2. Сравнивается размер с `maxResultSizeChars`.  
3. При превышении — запись в `~/.squid/sessions/<sessionId>/tool-results/<toolUseId>.txt`.  
4. В ответ подставляется превью.  

**Формат превью:**

```
<persisted-output>
Output too large (125.5 KB). Full output saved to: /path/to/file.txt

Preview (first 2.0 KB):
[первые 2000 байт]
...
</persisted-output>
```

## Полный пример (Grep)

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
    return {
      data: {
        matches,
        count: matches.length,
      },
    };
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

## Тестирование

### Модульные

```typescript
describe('GrepTool.mapToolResultToToolResultBlockParam', () => {
  it('formats matches', () => {
    const output: GrepOutput = {
      matches: [{ file: 'test.ts', line: 10, content: 'const foo = "bar"' }],
      count: 1,
    };
    const result = GrepTool.mapToolResultToToolResultBlockParam(output, 'test-id');
    expect(result.content).toContain('Found 1 matches');
    expect(result.content).toContain('test.ts:10');
  });

  it('handles empty', () => {
    const output: GrepOutput = { matches: [], count: 0 };
    const result = GrepTool.mapToolResultToToolResultBlockParam(output, 'test-id');
    expect(result.content).toBe('No matches found');
  });
});
```

### Персистентность

```typescript
describe('Tool result persistence', () => {
  it('persists large results', async () => {
    const result = await GrepTool.call({ pattern: 'test', path: '.' }, context);
    const processed = await processToolResultBlock(
      GrepTool,
      result.data,
      'test-id'
    );
    expect(processed.content).toContain('<persisted-output>');
  });
});
```

## Миграция существующего инструмента

1. Добавить `maxResultSizeChars`.  
2. Реализовать `mapToolResultToToolResultBlockParam`.  
3. Прогнать тесты: малый ответ без файла, большой — с превью.  

## FAQ

**Когда ставить `Infinity`?**  
Когда сам инструмент ограничивает размер (например `limit` у ReadFile).

**Обрабатывать ли ошибки в mapper?**  
Да, для ошибок из `call` выставляйте `is_error: true`.

**Тяжёлая форматизация?**  
Допустимо, но mapper вызывается часто — держите сложность разумной.

**Бинарные данные / картинки?**  
Персистентность ориентирована на текст; для изображений возвращайте массив image‑блоков — автосохранение текста может быть пропущено.

**Удаляются ли файлы превью автоматически?**  
Хранятся в `~/.squid/sessions/<sessionId>/tool-results/`. Рекомендуется периодическая очистка старых сессий или скрипт по TTL.

**Пример очистки:**

```bash
find ~/.squid/sessions -type d -mtime +7 -exec rm -rf {} \;
```

## Управление файлами превью

- **Путь:** `~/.squid/sessions/<sessionId>/tool-results/`  
- **Имена:** `<toolUseId>.txt` или `.json`  
- **Изоляция:** отдельный каталог на сессию  

### Стратегии

1. По времени — удалить сессии старше N дней.  
2. По суммарному размеру — удалять самые старые при превышении квоты.  
3. По завершении сессии — по желанию пользователя.  

### Мониторинг

Следите за размером `~/.squid/sessions/`, предупреждайте при нехватке места, логируйте сбои записи превью.

## Ссылки

- Референсная реализация в сопутствующем репозитории: `claude-code-main/src/utils/toolResultStorage.ts`  
- Тип `Tool`: `src/tools/base.ts`  
- Примеры: `src/tools/read-file.ts`, `src/tools/grep.ts`  

## История

- **2026-04-04**: первая версия спецификации  
