import { readFile, readdir } from 'fs/promises';
import { join } from 'path';
import type { Tool, ToolResult } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';
import {
  GREP_LINE_CHARS,
  GREP_TOP_K,
  READ_TOOL_RESULT_MAX_CHARS,
  truncateWithEllipsis,
} from './tool-output-format';

const GrepInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  filePattern: z.string().optional()
});

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export const GrepTool: Tool<typeof GrepInputSchema, GrepMatch[]> = {
  name: 'grep',
  description: '文件内容搜索',
  inputSchema: GrepInputSchema,
  maxResultSizeChars: READ_TOOL_RESULT_MAX_CHARS,

  async call(input, context): Promise<ToolResult<GrepMatch[]>> {
    try {
      const searchDir = input.path || context.workDir;
      const regex = new RegExp(input.pattern, 'gi');
      const matches: GrepMatch[] = [];

      async function searchDirectory(dir: string) {
        const entries = await readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(dir, entry.name);

          if (entry.isDirectory()) {
            await searchDirectory(fullPath);
          } else if (entry.isFile()) {
            try {
              const content = await readFile(fullPath, 'utf-8');
              const lines = content.split('\n');

              lines.forEach((line, idx) => {
                if (regex.test(line)) {
                  matches.push({
                    file: entry.name,
                    line: idx + 1,
                    content: line.trim()
                  });
                }
              });
            } catch {
              // Skip files that can't be read
            }
          }
        }
      }

      await searchDirectory(searchDir);
      return { data: matches };
    } catch (error) {
      return { data: [], error: (error as Error).message };
    }
  },

  mapToolResultToToolResultBlockParam(
    content: GrepMatch[],
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content || content.length === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: 'No matches found',
      };
    }

    const shown = content.slice(0, GREP_TOP_K);
    const formatted = [
      `Found ${content.length} matches (showing ${shown.length}):`,
      '',
      ...shown.map(m => `${m.file}:${m.line}: ${truncateWithEllipsis(m.content, GREP_LINE_CHARS)}`),
      ...(content.length > shown.length
        ? ['', `... ${content.length - shown.length} more matches omitted`]
        : []),
    ].join('\n');

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: formatted,
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false
};
