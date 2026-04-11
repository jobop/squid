import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';
import { cronManager, type CronRunLogPageResult } from './cron-manager';

const CronRunsInputSchema = z.object({
  task_id: z.string().optional().describe('可选：按任务 ID 过滤'),
  limit: z.number().int().min(1).max(200).optional().describe('分页大小，默认 50'),
  offset: z.number().int().min(0).optional().describe('分页偏移，默认 0'),
  status: z.enum(['all', 'ok', 'error', 'skipped']).optional().describe('状态过滤，默认 all'),
});

type CronRunsInput = z.infer<typeof CronRunsInputSchema>;

interface CronRunsOutput {
  success: boolean;
  page: CronRunLogPageResult;
}

export const CronRunsTool: Tool<typeof CronRunsInputSchema, CronRunsOutput> = {
  name: 'cron_runs',
  description: '查看定时任务运行记录（支持 task_id、状态、分页过滤）。',
  inputSchema: CronRunsInputSchema,
  maxResultSizeChars: 50000,

  async call(input: CronRunsInput, context: ToolContext): Promise<ToolResult<CronRunsOutput>> {
    const page = await cronManager.getRuns({
      taskId: input.task_id,
      limit: input.limit,
      offset: input.offset,
      status: input.status,
    });
    return {
      data: {
        success: true,
        page,
      },
    };
  },

  mapToolResultToToolResultBlockParam(
    content: CronRunsOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    const { page } = content;
    if (page.total === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: '暂无运行记录',
      };
    }
    const lines: string[] = [];
    lines.push(`运行记录: total=${page.total}, offset=${page.offset}, limit=${page.limit}`);
    for (const entry of page.entries) {
      lines.push(
        `- [${entry.status}] ${entry.taskId} trigger=${entry.trigger} ts=${entry.ts} duration=${entry.durationMs}ms`
      );
      if (entry.error) {
        lines.push(`  error: ${entry.error}`);
      }
    }
    if (page.nextOffset != null) {
      lines.push(`nextOffset=${page.nextOffset}`);
    }
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: lines.join('\n'),
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false,
};
