import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';
import { cronManager, type CronManagerStatus } from './cron-manager';

const CronStatusInputSchema = z.object({});
type CronStatusInput = z.infer<typeof CronStatusInputSchema>;

interface CronStatusOutput {
  success: boolean;
  status: CronManagerStatus;
}

export const CronStatusTool: Tool<typeof CronStatusInputSchema, CronStatusOutput> = {
  name: 'cron_status',
  description: '查看定时任务调度器状态（是否持久化、任务数、运行中任务数等）。',
  inputSchema: CronStatusInputSchema,
  maxResultSizeChars: 10000,

  async call(input: CronStatusInput, context: ToolContext): Promise<ToolResult<CronStatusOutput>> {
    return {
      data: {
        success: true,
        status: cronManager.getStatus(),
      },
    };
  },

  mapToolResultToToolResultBlockParam(
    content: CronStatusOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    const status = content.status;
    const lines: string[] = [];
    lines.push('Cron 调度器状态');
    lines.push(`- 持久化: ${status.enabled ? '已启用' : '未启用'}`);
    lines.push(`- 任务总数: ${status.totalTasks}`);
    lines.push(`- 运行中: ${status.runningTasks}`);
    if (status.nextWakeAt) {
      lines.push(`- 下次唤醒: ${status.nextWakeAt.toISOString()}`);
    }
    if (status.storagePath) {
      lines.push(`- 存储路径: ${status.storagePath}`);
    }
    if (status.lastRestoreAt) {
      lines.push(`- 最近恢复: ${status.lastRestoreAt.toISOString()}`);
    }
    if ((status.scheduledReplayCount ?? 0) > 0) {
      lines.push(`- 启动补跑计划: ${status.scheduledReplayCount}`);
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
