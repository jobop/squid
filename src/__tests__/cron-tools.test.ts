import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CronCreateTool } from '../tools/cron-create';
import { CronDeleteTool } from '../tools/cron-delete';
import { CronListTool } from '../tools/cron-list';
import { CronStatusTool } from '../tools/cron-status';
import { CronRunsTool } from '../tools/cron-runs';
import { cronManager } from '../tools/cron-manager';
import type { ToolContext } from '../tools/base';

describe('Cron Tools', () => {
  const mockContext: ToolContext = {
    workDir: process.cwd(),
    taskId: 'test-task',
    mode: 'craft'
  };

  beforeEach(() => {
    cronManager.clear();
  });

  afterEach(() => {
    cronManager.clear();
  });

  describe('CronCreateTool', () => {
    it('应该成功创建定时任务', async () => {
      const result = await CronCreateTool.call(
        {
          cron_expression: '0 * * * *',
          task_content: 'Test task'
        },
        mockContext
      );

      expect(result.data.success).toBe(true);
      expect(result.data.taskId).toBeDefined();
      expect(result.data.expression).toBe('0 * * * *');
      expect(result.data.content).toBe('Test task');
    });

    it('应该拒绝无效的 cron 表达式', async () => {
      const result = await CronCreateTool.call(
        {
          cron_expression: 'invalid',
          task_content: 'Test task'
        },
        mockContext
      );

      expect(result.data.success).toBe(false);
      expect(result.data.message).toContain('无效的 cron 表达式');
    });

    it('mapToolResultToToolResultBlockParam 应该正确格式化输出', () => {
      const output = {
        success: true,
        taskId: 'test-id',
        expression: '0 * * * *',
        content: 'Test task',
        message: '定时任务创建成功，任务 ID: test-id'
      };

      const result = CronCreateTool.mapToolResultToToolResultBlockParam(output, 'tool-id');

      expect(result.type).toBe('tool_result');
      expect(result.tool_use_id).toBe('tool-id');
      expect(result.content).toContain('✓');
      expect(result.content).toContain('test-id');
      expect(result.content).toContain('0 * * * *');
    });
  });

  describe('CronDeleteTool', () => {
    it('应该成功删除存在的任务', async () => {
      // 先创建一个任务
      const createResult = await CronCreateTool.call(
        {
          cron_expression: '0 * * * *',
          task_content: 'Test task'
        },
        mockContext
      );

      const taskId = createResult.data.taskId!;

      // 删除任务
      const deleteResult = await CronDeleteTool.call(
        {
          task_id: taskId
        },
        mockContext
      );

      expect(deleteResult.data.success).toBe(true);
      expect(deleteResult.data.message).toContain('已删除');
    });

    it('应该返回错误当任务不存在', async () => {
      const result = await CronDeleteTool.call(
        {
          task_id: 'nonexistent-id'
        },
        mockContext
      );

      expect(result.data.success).toBe(false);
      expect(result.data.message).toContain('不存在');
    });
  });

  describe('CronListTool', () => {
    it('应该返回空列表当没有任务', async () => {
      const result = await CronListTool.call({}, mockContext);

      expect(result.data.success).toBe(true);
      expect(result.data.count).toBe(0);
      expect(result.data.tasks).toHaveLength(0);
    });

    it('应该列出所有任务', async () => {
      // 创建两个任务
      await CronCreateTool.call(
        {
          cron_expression: '0 * * * *',
          task_content: 'Task 1'
        },
        mockContext
      );

      await CronCreateTool.call(
        {
          cron_expression: '30 * * * *',
          task_content: 'Task 2'
        },
        mockContext
      );

      // 列出任务
      const result = await CronListTool.call({}, mockContext);

      expect(result.data.success).toBe(true);
      expect(result.data.count).toBe(2);
      expect(result.data.tasks).toHaveLength(2);
      expect(result.data.tasks[0].expression).toBe('0 * * * *');
      expect(result.data.tasks[1].expression).toBe('30 * * * *');
    });

    it('mapToolResultToToolResultBlockParam 应该正确格式化空列表', () => {
      const output = {
        success: true,
        tasks: [],
        count: 0,
        status: {
          enabled: false,
          totalTasks: 0,
          runningTasks: 0
        }
      };

      const result = CronListTool.mapToolResultToToolResultBlockParam(output, 'tool-id');

      expect(result.type).toBe('tool_result');
      expect(result.content).toContain('没有定时任务');
    });

    it('mapToolResultToToolResultBlockParam 应该正确格式化任务列表', () => {
      const output = {
        success: true,
        tasks: [
          {
            id: 'task-1',
            expression: '0 * * * *',
            content: 'Test task',
            createdAt: new Date('2024-01-01'),
            isRunning: false
          }
        ],
        count: 1,
        status: {
          enabled: true,
          totalTasks: 1,
          runningTasks: 0,
          storagePath: '/tmp/cron-jobs.json',
          lastRestoreAt: new Date('2024-01-01')
        }
      };

      const result = CronListTool.mapToolResultToToolResultBlockParam(output, 'tool-id');

      expect(result.type).toBe('tool_result');
      expect(result.content).toContain('共有 1 个定时任务');
      expect(result.content).toContain('task-1');
      expect(result.content).toContain('0 * * * *');
    });
  });

  describe('CronStatusTool', () => {
    it('应该返回调度器状态', async () => {
      const result = await CronStatusTool.call({}, mockContext);
      expect(result.data.success).toBe(true);
      expect(typeof result.data.status.totalTasks).toBe('number');
      expect(typeof result.data.status.runningTasks).toBe('number');
    });
  });

  describe('CronRunsTool', () => {
    it('没有记录时返回空分页', async () => {
      const result = await CronRunsTool.call({}, mockContext);
      expect(result.data.success).toBe(true);
      expect(result.data.page.total).toBe(0);
      expect(result.data.page.entries).toHaveLength(0);
    });
  });

  describe('Tool Properties', () => {
    it('CronCreateTool 应该正确标记属性', () => {
      expect(CronCreateTool.isConcurrencySafe()).toBe(true);
      expect(CronCreateTool.isReadOnly()).toBe(false);
      expect(CronCreateTool.isDestructive?.()).toBe(false);
    });

    it('CronDeleteTool 应该正确标记属性', () => {
      expect(CronDeleteTool.isConcurrencySafe()).toBe(true);
      expect(CronDeleteTool.isReadOnly()).toBe(false);
      expect(CronDeleteTool.isDestructive?.()).toBe(true);
    });

    it('CronListTool 应该正确标记属性', () => {
      expect(CronListTool.isConcurrencySafe()).toBe(true);
      expect(CronListTool.isReadOnly()).toBe(true);
      expect(CronListTool.isDestructive?.()).toBe(false);
    });

    it('CronStatusTool 应该正确标记属性', () => {
      expect(CronStatusTool.isConcurrencySafe()).toBe(true);
      expect(CronStatusTool.isReadOnly()).toBe(true);
      expect(CronStatusTool.isDestructive?.()).toBe(false);
    });

    it('CronRunsTool 应该正确标记属性', () => {
      expect(CronRunsTool.isConcurrencySafe()).toBe(true);
      expect(CronRunsTool.isReadOnly()).toBe(true);
      expect(CronRunsTool.isDestructive?.()).toBe(false);
    });
  });
});
