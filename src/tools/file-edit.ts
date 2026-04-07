import { readFile, writeFile } from 'fs/promises';
import type { Tool, ToolResult, ToolContext } from './base';
import { resolveSafeWorkspacePath } from './workspace-path';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';

const FileEditInputSchema = z.object({
  file_path: z
    .string()
    .describe(
      '要编辑的文件路径（相对工作区）。勿使用 .Users.xxx 这类点号链代替绝对路径。Plan 模式下通常仅允许编辑 .squid/plan*.md（以系统提示为准）。'
    ),
  old_string: z.string().describe('要替换的旧字符串'),
  new_string: z.string().describe('替换后的新字符串'),
  replace_all: z.boolean().optional().describe('是否替换所有匹配项（默认 false）')
});

type FileEditInput = z.infer<typeof FileEditInputSchema>;

interface FileEditOutput {
  success: boolean;
  message: string;
  replacements: number;
  filePath: string;
}

export const FileEditTool: Tool<typeof FileEditInputSchema, FileEditOutput> = {
  name: 'file_edit',
  description: '精确替换文件内容。使用字符串匹配查找并替换文件中的内容。',
  inputSchema: FileEditInputSchema,
  maxResultSizeChars: 50000,

  async call(
    input: FileEditInput,
    context: ToolContext
  ): Promise<ToolResult<FileEditOutput>> {
    try {
      const resolved = await resolveSafeWorkspacePath(context.workDir, input.file_path);
      if (!resolved.ok) {
        return {
          data: {
            success: false,
            message: resolved.error,
            replacements: 0,
            filePath: input.file_path,
          },
          error: resolved.error,
        };
      }
      const filePath = resolved.abs;

      // 读取文件内容
      const content = await readFile(filePath, 'utf-8');

      // 查找所有匹配项
      const matches = content.split(input.old_string).length - 1;

      if (matches === 0) {
        return {
          data: {
            success: false,
            message: `未找到匹配的字符串: "${input.old_string}"`,
            replacements: 0,
            filePath: input.file_path
          }
        };
      }

      // 如果找到多处匹配且未设置 replace_all，返回错误
      if (matches > 1 && !input.replace_all) {
        return {
          data: {
            success: false,
            message: `找到 ${matches} 处匹配，请提供更精确的字符串或设置 replace_all=true`,
            replacements: 0,
            filePath: input.file_path
          }
        };
      }

      // 执行替换
      const newContent = input.replace_all
        ? content.replaceAll(input.old_string, input.new_string)
        : content.replace(input.old_string, input.new_string);

      // 写回文件
      await writeFile(filePath, newContent, 'utf-8');

      return {
        data: {
          success: true,
          message: `成功替换 ${input.replace_all ? matches : 1} 处内容`,
          replacements: input.replace_all ? matches : 1,
          filePath: input.file_path
        }
      };
    } catch (error) {
      return {
        data: {
          success: false,
          message: `文件编辑失败: ${(error as Error).message}`,
          replacements: 0,
          filePath: input.file_path
        },
        error: (error as Error).message
      };
    }
  },

  mapToolResultToToolResultBlockParam(
    content: FileEditOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: JSON.stringify(content, null, 2)
    };
  },

  /** 与分区器批内路径不相交校验配合 */
  isConcurrencySafe: (input) =>
    typeof input?.file_path === 'string' && input.file_path.trim().length > 0,
  isReadOnly: () => false,
  isDestructive: () => true // 修改文件是破坏性操作
};

