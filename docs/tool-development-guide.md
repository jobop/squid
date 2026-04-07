# 工具开发指南

本文档定义了 squid 中工具的实现规范，确保所有工具遵循统一的模式，优化上下文使用和用户体验。

## 核心原则

1. **上下文效率优先** - 大结果自动持久化，避免消耗过多上下文
2. **统一输出格式** - 所有工具通过映射方法返回标准格式
3. **向后兼容** - 新规范不破坏现有工具
4. **可测试性** - 每个工具的行为应该可验证

## 工具接口定义

每个工具必须实现以下接口：

```typescript
interface Tool<Input extends z.ZodType = z.ZodType, Output = unknown, P = any> {
  // 基础属性
  name: string;
  description: string;
  inputSchema: Input;
  
  // 结果大小控制
  maxResultSizeChars: number;
  
  // 核心方法
  call(
    input: z.infer<Input>,
    context: ToolContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;
  
  // 结果映射方法（新增）
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string
  ): ToolResultBlockParam;
  
  // 权限和安全
  isConcurrencySafe(input: z.infer<Input>): boolean;
  isReadOnly(input: z.infer<Input>): boolean;
  isDestructive?(input: z.infer<Input>): boolean;
}
```

## 关键属性说明

### maxResultSizeChars

定义工具结果的持久化阈值。当结果超过此大小时，系统会自动将其保存到磁盘并返回预览。

**推荐值：**
- 默认工具：`50000` (约 50KB)
- 大输出工具（如文件读取）：`50000`
- 自控制大小的工具：`Infinity` (禁用持久化)

**示例：**
```typescript
export const ReadFileTool: Tool = {
  name: 'read_file',
  maxResultSizeChars: Infinity, // ReadFile 自己控制大小，不需要持久化
  // ...
};

export const GrepTool: Tool = {
  name: 'grep',
  maxResultSizeChars: 50000, // 使用默认阈值
  // ...
};
```

### isConcurrencySafe 与同轮编排

TaskExecutor 对同一条助手消息内的多个 `tool_call` 会按顺序做 **分区**：相邻且在 **当前参数** 下 `isConcurrencySafe` 均为真的调用合并为一段并 `Promise.all`；否则分段顺序执行。`write_file` / `file_edit` 等写类工具若声明为可并发，仍须考虑 **批内副作用**（例如目标路径是否冲突）；宿主会对写路径做批内校验，实现时请在 `isConcurrencySafe` 中如实反映「在此 input 下与其它调用并行是否安全」。

## 实现 mapToolResultToToolResultBlockParam

这是最重要的新增方法，负责将工具的输出转换为 API 标准格式。

### 基本模式

```typescript
mapToolResultToToolResultBlockParam(
  content: Output,
  toolUseID: string
): ToolResultBlockParam {
  // 处理空结果
  if (!content) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `(${this.name} completed with no output)`,
    };
  }
  
  // 返回格式化的结果
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: this.formatOutput(content),
  };
}
```

### 文本结果示例

```typescript
// 简单文本输出
mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: content || `(${this.name} completed with no output)`,
  };
}
```

### 结构化结果示例

```typescript
// JSON 或结构化数据
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

### 错误结果示例

```typescript
// 错误处理
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

### 复杂格式化示例（ReadFile）

```typescript
mapToolResultToToolResultBlockParam(
  content: { path: string; content: string; lines: number },
  toolUseID: string
) {
  // 添加文件元信息
  const header = `File: ${content.path} (${content.lines} lines)\n\n`;
  
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: header + content.content,
  };
}
```

## 持久化系统集成

工具开发者**不需要**手动处理持久化。系统会自动：

1. 调用 `mapToolResultToToolResultBlockParam` 获取格式化结果
2. 检查结果大小是否超过 `maxResultSizeChars`
3. 如果超过，自动持久化到 `~/.squid/sessions/<sessionId>/tool-results/<toolUseId>.txt`
4. 替换结果内容为预览消息

**预览消息格式：**
```
<persisted-output>
Output too large (125.5 KB). Full output saved to: /path/to/file.txt

Preview (first 2.0 KB):
[前 2000 字节的内容]
...
</persisted-output>
```

## 完整工具示例

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
    // 实现搜索逻辑
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

    // 格式化匹配结果
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

## 测试指南

### 单元测试

测试映射方法的各种场景：

```typescript
describe('GrepTool.mapToolResultToToolResultBlockParam', () => {
  it('should format matches correctly', () => {
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

  it('should handle empty results', () => {
    const output: GrepOutput = { matches: [], count: 0 };
    
    const result = GrepTool.mapToolResultToToolResultBlockParam(
      output,
      'test-id'
    );
    
    expect(result.content).toBe('No matches found');
  });
});
```

### 集成测试

测试持久化行为：

```typescript
describe('Tool result persistence', () => {
  it('should persist large results', async () => {
    const largeContent = 'x'.repeat(60000); // 超过 50K 阈值
    
    const result = await GrepTool.call(
      { pattern: 'test', path: '.' },
      context
    );
    
    const mapped = GrepTool.mapToolResultToToolResultBlockParam(
      result.data,
      'test-id'
    );
    
    // 系统应该持久化这个结果
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

## 迁移现有工具

### 步骤 1：添加 maxResultSizeChars

```typescript
export const MyTool: Tool = {
  // ... 现有属性
  maxResultSizeChars: 50000, // 添加这一行
};
```

### 步骤 2：实现映射方法

```typescript
export const MyTool: Tool = {
  // ... 现有属性
  
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: typeof content === 'string' ? content : JSON.stringify(content),
    };
  },
};
```

### 步骤 3：测试

运行工具并验证：
- 小结果正常返回
- 大结果被持久化并返回预览
- 格式化符合预期

## 常见问题

### Q: 什么时候应该设置 maxResultSizeChars 为 Infinity？

A: 当工具自己已经控制了输出大小时。例如 ReadFile 工具有 `limit` 参数，用户可以控制读取的行数，所以不需要额外的持久化。

### Q: 映射方法应该处理错误吗？

A: 是的。如果工具的 `call` 方法返回错误信息，映射方法应该设置 `is_error: true`。

### Q: 可以在映射方法中做复杂的格式化吗？

A: 可以，但要注意性能。映射方法会在每次工具调用时执行，应该保持高效。

### Q: 如何处理二进制或图片数据？

A: 持久化系统只支持文本内容。如果工具返回图片，应该在映射方法中返回包含 image 块的数组，系统会自动跳过持久化。

### Q: 持久化的文件会自动清理吗？

A: 持久化文件存储在 `~/.squid/sessions/<sessionId>/tool-results/` 目录中。建议定期清理：
- **手动清理**: 删除旧会话目录
- **自动清理**: 可以实现定期清理脚本，删除超过 7 天的会话目录
- **磁盘空间**: 监控 `~/.squid/sessions/` 目录大小，超过阈值时清理最旧的会话

**清理脚本示例**:
```bash
# 删除 7 天前的会话
find ~/.squid/sessions -type d -mtime +7 -exec rm -rf {} \;
```

## 持久化文件管理

### 存储位置
- **路径**: `~/.squid/sessions/<sessionId>/tool-results/`
- **文件命名**: `<toolUseId>.txt` 或 `<toolUseId>.json`
- **会话隔离**: 每个会话有独立的目录

### 清理策略

**推荐的清理策略**:

1. **按时间清理** - 删除超过 N 天的会话
   ```typescript
   // 示例：清理 7 天前的会话
   const RETENTION_DAYS = 7;
   const cutoffDate = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
   ```

2. **按大小清理** - 当总大小超过阈值时清理最旧的
   ```typescript
   // 示例：保持总大小在 1GB 以下
   const MAX_TOTAL_SIZE = 1024 * 1024 * 1024; // 1GB
   ```

3. **会话结束时清理** - 可选择在会话结束时立即清理
   ```typescript
   // 用户可以选择保留或删除
   ```

### 监控和告警

建议实现以下监控：
- 定期检查 `~/.squid/sessions/` 目录大小
- 当磁盘空间不足时发出警告
- 记录持久化失败的次数

## 参考资源

- **claude-code-main 实现**: `/Users/myidd007/My project/yaoc/claude-code-main/src/utils/toolResultStorage.ts`
- **Tool 接口定义**: `src/tools/base.ts`
- **示例工具**: `src/tools/read-file.ts`, `src/tools/grep.ts`

## 更新日志

- **2026-04-04**: 初始版本，定义工具实现规范
