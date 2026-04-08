import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentTool } from '../tools/agent';
import type { ToolContext } from '../tools/base';
import { executeWithUnifiedStack } from '../tools/unified-executor';

vi.mock('../tools/unified-executor', () => {
  return {
    executeWithUnifiedStack: vi.fn()
  };
});

describe('AgentTool', () => {
  const mockContext: ToolContext = {
    workDir: process.cwd(),
    taskId: 'test-task',
    mode: 'craft'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('应该返回配置错误', async () => {
    vi.mocked(executeWithUnifiedStack).mockResolvedValue({
      success: false,
      error: '请先在设置页面配置 API Key',
      errorType: 'config',
      duration: 5,
      metadata: {
        executor: 'TaskExecutor',
        mode: 'craft',
        workspace: mockContext.workDir,
        timeoutMs: 300000
      }
    });

    const result = await AgentTool.call(
      {
        instruction: 'Test task'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('配置');
    expect(result.data.errorType).toBe('config');
  });

  it('应该成功执行子代理任务', async () => {
    vi.mocked(executeWithUnifiedStack).mockResolvedValue({
      success: true,
      output: 'Task completed successfully',
      duration: 120,
      metadata: {
        executor: 'TaskExecutor',
        mode: 'craft',
        workspace: mockContext.workDir,
        timeoutMs: 300000
      }
    });

    const result = await AgentTool.call(
      {
        instruction: 'Analyze the code'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.result).toBe('Task completed successfully');
    expect(result.data.instruction).toBe('Analyze the code');
    expect(result.data.duration).toBeGreaterThanOrEqual(0);
    expect(vi.mocked(executeWithUnifiedStack)).toHaveBeenCalledWith({
      instruction: 'Analyze the code',
      workspace: mockContext.workDir,
      mode: mockContext.mode,
      timeoutMs: 300000
    });
  });

  it('应该支持自定义超时', async () => {
    vi.mocked(executeWithUnifiedStack).mockResolvedValue({
      success: false,
      error: '子任务执行超时（100ms）',
      errorType: 'timeout',
      duration: 100,
      metadata: {
        executor: 'TaskExecutor',
        mode: 'craft',
        workspace: mockContext.workDir,
        timeoutMs: 100
      }
    });

    const result = await AgentTool.call(
      {
        instruction: 'Quick task',
        timeout: 100
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('超时');
    expect(result.data.errorType).toBe('timeout');
    expect(vi.mocked(executeWithUnifiedStack)).toHaveBeenCalledWith({
      instruction: 'Quick task',
      workspace: mockContext.workDir,
      mode: mockContext.mode,
      timeoutMs: 100
    });
  });

  it('应该处理 API 错误', async () => {
    vi.mocked(executeWithUnifiedStack).mockResolvedValue({
      success: false,
      error: 'API Error',
      errorType: 'execution',
      duration: 10,
      metadata: {
        executor: 'TaskExecutor',
        mode: 'craft',
        workspace: mockContext.workDir,
        timeoutMs: 300000
      }
    });

    const result = await AgentTool.call(
      {
        instruction: 'Test task'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('API Error');
    expect(result.data.errorType).toBe('execution');
  });

  it('mapToolResultToToolResultBlockParam 应该正确格式化输出', () => {
    const output = {
      success: true,
      result: 'Task completed',
      instruction: 'Test instruction',
      duration: 1500
    };

    const result = AgentTool.mapToolResultToToolResultBlockParam(output, 'test-id');

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('test-id');
    expect(result.content).toContain('子代理任务: Test instruction');
    expect(result.content).toContain('执行时间: 1500ms');
    expect(result.content).toContain('Task completed');
  });

  it('mapToolResultToToolResultBlockParam 应该正确格式化错误', () => {
    const output = {
      success: false,
      instruction: 'Test instruction',
      error: 'Execution failed'
    };

    const result = AgentTool.mapToolResultToToolResultBlockParam(output, 'test-id');

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('test-id');
    expect(result.content).toBe('Execution failed');
    expect(result.is_error).toBe(true);
  });

  it('应该正确标记工具属性', () => {
    expect(AgentTool.isConcurrencySafe()).toBe(false);
    expect(AgentTool.isReadOnly()).toBe(false);
    expect(AgentTool.isDestructive?.()).toBe(false);
  });
});
