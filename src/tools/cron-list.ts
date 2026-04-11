import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';
import { cronManager, type CronTask, type CronManagerStatus } from './cron-manager';

const CronListInputSchema = z.object({});

type CronListInput = z.infer<typeof CronListInputSchema>;

interface CronListOutput {
  success: boolean;
  tasks: CronTask[];
  count: number;
  status: CronManagerStatus;
}

export const CronListTool: Tool<typeof CronListInputSchema, CronListOutput> = {
  name: 'cron_list',
  description: '列出所有定时任务。',
  inputSchema: CronListInputSchema,
  maxResultSizeChars: 50000,

  async call(
    input: CronListInput,
    context: ToolContext
  ): Promise<ToolResult<CronListOutput>> {
    const tasks = cronManager.listTasks();
    const status = cronManager.getStatus();

    return {
      data: {
        success: true,
        tasks,
        count: tasks.length,
        status,
      }
    };
  },

  mapToolResultToToolResultBlockParam(
    content: CronListOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (content.count === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: '当前没有定时任务'
      };
    }

    const persistenceLabel = content.status.enabled ? '已启用' : '未启用';
    let output = `共有 ${content.count} 个定时任务（持久化: ${persistenceLabel}）\n`;
    if (content.status.storagePath) {
      output += `存储路径: ${content.status.storagePath}\n`;
    }
    if (content.status.lastRestoreAt) {
      output += `最近恢复: ${content.status.lastRestoreAt.toISOString()}\n`;
    }
    if ((content.status.scheduledReplayCount ?? 0) > 0) {
      output += `启动补跑计划: ${content.status.scheduledReplayCount}\n`;
    }
    output += '\n';

    content.tasks.forEach((task, index) => {
      output += `${index + 1}. 任务 ID: ${task.id}\n`;
      output += `   表达式: ${task.expression}\n`;
      output += `   内容: ${task.content}\n`;
      output += `   创建时间: ${task.createdAt.toISOString()}\n`;

      if (task.lastRun) {
        output += `   上次运行: ${task.lastRun.toISOString()}\n`;
      }
      if (task.nextRun) {
        output += `   下次运行: ${task.nextRun.toISOString()}\n`;
      }
      if (task.runningAtMs) {
        output += `   运行标记: ${task.runningAtMs.toISOString()}\n`;
      }
      if (task.lastStatus) {
        output += `   上次状态: ${task.lastStatus}\n`;
      }
      if (task.lastError) {
        output += `   上次错误: ${task.lastError}\n`;
      }
      if (typeof task.consecutiveErrors === 'number' && task.consecutiveErrors > 0) {
        output += `   连续失败: ${task.consecutiveErrors}\n`;
      }

      output += `   状态: ${task.isRunning ? '运行中' : '等待中'}\n\n`;
    });

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.trim()
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false
};
