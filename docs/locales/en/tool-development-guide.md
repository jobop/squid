# Tool development guide

This document defines squid tool conventions so every tool follows the same pattern, optimizes context usage, and keeps UX predictable.

## Principles

1. **Context efficiency** — large outputs persist automatically instead of flooding the model window.  
2. **Uniform output** — every tool maps results through the same helper into API blocks.  
3. **Backward compatibility** — new rules should not break existing tools.  
4. **Testability** — behavior should be observable in unit tests.  

## Required interface

Each tool must satisfy:

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

## Key properties

### `maxResultSizeChars`

Threshold for automatic persistence. When mapped output exceeds this size, the platform writes the full payload to disk and returns a preview snippet.

**Suggested values**

- Default tools: `50000` (~50 KB)  
- Large-output tools (e.g. search): `50000`  
- Self-limiting tools: `Infinity` to skip persistence  

**Examples**

```typescript
export const ReadFileTool: Tool = {
  name: 'read_file',
  maxResultSizeChars: Infinity, // ReadFile already caps output
  // ...
};

export const GrepTool: Tool = {
  name: 'grep',
  maxResultSizeChars: 50000,
  // ...
};
```

### `isConcurrencySafe` and batching

`TaskExecutor` **partitions** tool calls within a single assistant turn: consecutive calls whose `isConcurrencySafe` is true for the **current arguments** are grouped and executed with `Promise.all`; otherwise they run sequentially. Even if `write_file` / `file_edit` declare concurrency safety, consider **in-batch side effects** (colliding paths). The host performs intra-batch path validation—implement `isConcurrencySafe` honestly for the provided `input`.

## Implementing `mapToolResultToToolResultBlockParam`

This method converts tool output into the Anthropic-compatible `tool_result` block.

### Baseline pattern

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

### Plain text

```typescript
mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: content || `(${this.name} completed with no output)`,
  };
}
```

### Structured JSON

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

### Errors

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

### Rich example (`ReadFile`)

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

## Persistence pipeline

Tool authors **do not** manually persist. The executor:

1. Calls `mapToolResultToToolResultBlockParam`  
2. Measures serialized size against `maxResultSizeChars`  
3. When too large, writes to `~/.squid/sessions/<sessionId>/tool-results/<toolUseId>.txt`  
4. Replaces the inline payload with a preview block  

**Preview template**

```text
<persisted-output>
Output too large (125.5 KB). Full output saved to: /path/to/file.txt

Preview (first 2.0 KB):
[first 2000 bytes]
...
</persisted-output>
```

## Full example (`GrepTool`)

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
      ...content.matches.map(m => 
        `${m.file}:${m.line}: ${m.content}`
      ),
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

## Testing guidance

### Unit tests

Exercise mapping for empty, typical, and oversized payloads.

```typescript
describe('GrepTool.mapToolResultToToolResultBlockParam', () => {
  it('formats matches', () => {
    const output: GrepOutput = {
      matches: [
        { file: 'test.ts', line: 10, content: 'const foo = "bar"' },
      ],
      count: 1,
    };
    
    const result = GrepTool.mapToolResultToToolResultBlockParam(
      output,
      'test-id'
    );
    
    expect(result.content).toContain('Found 1 matches');
    expect(result.content).toContain('test.ts:10');
  });

  it('handles empty output', () => {
    const output: GrepOutput = { matches: [], count: 0 };
    
    const result = GrepTool.mapToolResultToToolResultBlockParam(
      output,
      'test-id'
    );
    
    expect(result.content).toBe('No matches found');
  });
});
```

### Persistence integration

```typescript
describe('Tool result persistence', () => {
  it('persists large results', async () => {
    const largeContent = 'x'.repeat(60000);
    
    const result = await GrepTool.call(
      { pattern: 'test', path: '.' },
      context
    );
    
    const processed = await processToolResultBlock(
      GrepTool,
      result.data,
      'test-id'
    );
    
    expect(processed.content).toContain('<persisted-output>');
    expect(processed.content).toContain('Full output saved to:');
  });
});
```

## Migrating legacy tools

### Step 1: add `maxResultSizeChars`

```typescript
export const MyTool: Tool = {
  // ...
  maxResultSizeChars: 50000,
};
```

### Step 2: implement the mapper

```typescript
export const MyTool: Tool = {
  // ...
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };
  },
};
```

### Step 3: verify

- Small payloads inline  
- Large payloads persisted with preview  
- Formatting matches expectations  

## FAQ

**When is `Infinity` appropriate?**  
When the tool already bounds output (e.g. `read_file` line limits).

**Should the mapper set `is_error`?**  
Yes—surface failures from `call` using `is_error: true`.

**Can mapping be expensive?**  
Yes, but keep it proportional; it runs on every invocation.

**Binary or image payloads?**  
Persistence is text-oriented; return image blocks in the mapper when required—the platform skips text persistence for those blocks.

**Are persisted files cleaned automatically?**  
Files live under `~/.squid/sessions/<sessionId>/tool-results/`. Prune manually or via housekeeping scripts (example: delete sessions older than seven days).

```bash
find ~/.squid/sessions -type d -mtime +7 -exec rm -rf {} \;
```

## Persistence housekeeping

### Storage layout

- Path: `~/.squid/sessions/<sessionId>/tool-results/`  
- Files: `<toolUseId>.txt` or `.json`  
- Isolation: one directory tree per session  

### Strategies

1. **Time-based retention** — drop sessions older than *N* days.  
2. **Size-based retention** — when total usage exceeds a cap, delete oldest sessions.  
3. **Session teardown** — optionally wipe tool results when a session ends.

### Monitoring

- Track directory growth under `~/.squid/sessions/`  
- Alert on low disk space  
- Log persistence failures for investigation  

## References

- Reference implementation: `claude-code-main/src/utils/toolResultStorage.ts` (sibling repo)  
- Tool definitions: `src/tools/base.ts`  
- Examples: `src/tools/read-file.ts`, `src/tools/grep.ts`  

## Changelog

- **2026-04-04**: initial publication of the tool authoring standard  
