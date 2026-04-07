import { describe, it, expect, beforeEach } from 'vitest';
import { BashTool, backgroundTasks } from '../tools/bash';
import type { ToolContext } from '../tools/base';

describe('BashTool', () => {
  const mockContext: ToolContext = {
    workDir: process.cwd(),
    taskId: 'test-task',
    mode: 'craft'
  };

  beforeEach(() => {
    backgroundTasks.clear();
  });

  it('应该成功执行简单命令', async () => {
    const result = await BashTool.call(
      {
        command: 'echo "Hello World"'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.stdout.trim()).toBe('Hello World');
    expect(result.data.exitCode).toBe(0);
  });

  it('应该捕获命令失败', async () => {
    const result = await BashTool.call(
      {
        command: 'exit 1'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.exitCode).toBe(1);
  });

  it('应该捕获 stderr 输出', async () => {
    const result = await BashTool.call(
      {
        command: 'echo "error message" >&2'
      },
      mockContext
    );

    expect(result.data.stderr.trim()).toBe('error message');
  });

  it('应该支持超时控制', async () => {
    const result = await BashTool.call(
      {
        command: 'sleep 10',
        timeout: 100
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.stderr).toContain('超时');
  }, 10000);

  it('应该支持后台执行', async () => {
    const result = await BashTool.call(
      {
        command: 'echo "background task"',
        run_in_background: true
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.taskId).toBeDefined();
    expect(result.data.stdout).toContain('后台任务已启动');
    expect(backgroundTasks.has(result.data.taskId!)).toBe(true);
  });

  it('应该支持自定义工作目录', async () => {
    const result = await BashTool.call(
      {
        command: 'pwd',
        working_directory: '/tmp'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    // macOS 上 /tmp 实际是 /private/tmp 的符号链接
    expect(result.data.stdout.trim()).toMatch(/\/(private\/)?tmp/);
  });

  it('mapToolResultToToolResultBlockParam 应该正确格式化输出', () => {
    const output = {
      success: true,
      stdout: 'Hello World',
      stderr: '',
      exitCode: 0,
      command: 'echo "Hello World"'
    };

    const result = BashTool.mapToolResultToToolResultBlockParam(output, 'test-id');

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('test-id');
    expect(result.content).toContain('Command: echo "Hello World"');
    expect(result.content).toContain('Exit Code: 0');
    expect(result.content).toContain('Stdout:\nHello World');
  });

  it('应该正确标记为破坏性操作', () => {
    expect(BashTool.isConcurrencySafe()).toBe(false);
    expect(BashTool.isReadOnly()).toBe(false);
    expect(BashTool.isDestructive?.()).toBe(true);
  });
});
