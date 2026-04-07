import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { Tool, ToolResult } from './base';
import { resolveSafeWorkspacePath } from './workspace-path';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';

const WriteFileInputSchema = z.object({
  file_path: z
    .string()
    .describe(
      '相对工作区的路径，例如 hello.all、notes/out.txt、.squid/plan.md。禁止把 /Users/... 等绝对路径改成点号链（如 .Users.xxx.xxx）。'
    ),
  content: z.string()
});

export const WriteFileTool: Tool<typeof WriteFileInputSchema, string> = {
  name: 'write_file',
  description:
    '写入文件内容。file_path 必须为相对工作区的路径（如 hello.all），勿使用点号代替斜杠拼出类似 .Users.xxx 的路径。Plan 模式下通常仅允许写入 .squid/plan*.md（以系统提示为准）。',
  inputSchema: WriteFileInputSchema,
  maxResultSizeChars: 1000,

  async call(input, context): Promise<ToolResult<string>> {
    try {
      const resolved = await resolveSafeWorkspacePath(context.workDir, input.file_path);
      if (!resolved.ok) {
        return { data: '', error: resolved.error };
      }
      const filePath = resolved.abs;
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, input.content, 'utf-8');
      return { data: `File written: ${input.file_path}` };
    } catch (error) {
      return { data: '', error: (error as Error).message };
    }
  },

  mapToolResultToToolResultBlockParam(
    content: string,
    toolUseID: string
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: content || '(write_file completed with no output)',
    };
  },

  /** 与分区器批内路径不相交校验配合；空路径视为不安全 */
  isConcurrencySafe: (input) =>
    typeof input?.file_path === 'string' && input.file_path.trim().length > 0,
  isReadOnly: () => false,
  isDestructive: () => true
};

