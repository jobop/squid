import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BriefTool } from '../tools/brief';
import type { ToolContext } from '../tools/base';

// Mock Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn()
      }
    }))
  };
});

describe('BriefTool', () => {
  const mockContext: ToolContext = {
    workDir: process.cwd(),
    taskId: 'test-task',
    mode: 'craft'
  };

  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('应该返回错误当未配置 API 密钥', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const result = await BriefTool.call(
      {
        content: 'Test content'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('not configured');
  });

  it('应该成功生成简短摘要', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'This is a brief summary.' }]
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate }
    }) as any);

    const result = await BriefTool.call(
      {
        content: 'Long content to summarize...',
        type: 'brief'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.summary).toBe('This is a brief summary.');
    expect(result.data.type).toBe('brief');
    expect(mockCreate).toHaveBeenCalled();
  });

  it('应该支持详细摘要类型', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Detailed summary with more information.' }]
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate }
    }) as any);

    const result = await BriefTool.call(
      {
        content: 'Content to summarize',
        type: 'detailed'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.type).toBe('detailed');
  });

  it('应该支持要点列表类型', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '- Point 1\n- Point 2\n- Point 3' }]
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate }
    }) as any);

    const result = await BriefTool.call(
      {
        content: 'Content to summarize',
        type: 'bullet_points'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.type).toBe('bullet_points');
  });

  it('应该支持自定义提示', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'Custom summary' }]
    });

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate }
    }) as any);

    const result = await BriefTool.call(
      {
        content: 'Content',
        prompt: 'Custom prompt for summarization'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.stringContaining('Custom prompt for summarization')
          })
        ])
      })
    );
  });

  it('应该处理 API 错误', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const mockCreate = vi.fn().mockRejectedValue(new Error('API Error'));

    vi.mocked(Anthropic).mockImplementation(() => ({
      messages: { create: mockCreate }
    }) as any);

    const result = await BriefTool.call(
      {
        content: 'Content'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('API Error');
  });

  it('mapToolResultToToolResultBlockParam 应该正确格式化输出', () => {
    const output = {
      success: true,
      summary: 'Test summary',
      type: 'brief'
    };

    const result = BriefTool.mapToolResultToToolResultBlockParam(output, 'test-id');

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('test-id');
    expect(result.content).toContain('Summary type: brief');
    expect(result.content).toContain('Test summary');
  });

  it('应该正确标记为只读操作', () => {
    expect(BriefTool.isConcurrencySafe()).toBe(true);
    expect(BriefTool.isReadOnly()).toBe(true);
    expect(BriefTool.isDestructive?.()).toBe(false);
  });
});
