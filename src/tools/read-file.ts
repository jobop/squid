import { readFile } from 'fs/promises';
import type { Tool, ToolResult } from './base';
import { resolveSafeWorkspacePath } from './workspace-path';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';

const ReadFileInputSchema = z.object({
  file_path: z
    .string()
    .describe(
      '相对工作区的路径，例如 hello.py。禁止把绝对路径改成点号链（如 .Users.xxx.xxx）；需要时用 hello.all 这类短路径。'
    ),
});

export const ReadFileTool: Tool<typeof ReadFileInputSchema, string> = {
  name: 'read_file',
  description: '读取文件内容',
  inputSchema: ReadFileInputSchema,
  maxResultSizeChars: Infinity, // 不限制大小，返回完整内容

  async call(input, context): Promise<ToolResult<string>> {
    try {
      const resolved = await resolveSafeWorkspacePath(context.workDir, input.file_path);
      if (!resolved.ok) {
        return { data: '', error: resolved.error };
      }
      const content = await readFile(resolved.abs, 'utf-8');
      return { data: content };
    } catch (error) {
      return { data: '', error: (error as Error).message };
    }
  },

  mapToolResultToToolResultBlockParam(
    content: string,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content || content.trim() === '') {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: '(read_file completed with no output)',
      };
    }

    // 返回完整内容，不截断
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content,
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false
};

