import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskExecutor } from '../tasks/executor';
import { SkillLoader } from '../skills/loader';
import { ToolRegistry } from '../tools/registry';

describe('TaskExecutor image attachments', () => {
  let executor: TaskExecutor;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    executor = new TaskExecutor(new SkillLoader(), new ToolRegistry());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('openai 请求应将图片附件序列化为 image_url content blocks', async () => {
    vi.spyOn(executor as any, 'loadModelConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-key',
      modelName: 'gpt-4o',
      apiEndpoint: 'https://api.openai.com/v1',
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'ok',
            },
          },
        ],
      }),
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await executor.execute({
      mode: 'ask',
      instruction: '请描述这张图',
      workspace: process.cwd(),
      attachments: [
        {
          type: 'image',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,ZmFrZQ==',
          source: 'paste',
        },
      ],
    });

    expect(result.error).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: unknown }> };
    const lastMessage = payload.messages[payload.messages.length - 1]!;
    expect(lastMessage.role).toBe('user');
    expect(Array.isArray(lastMessage.content)).toBe(true);
    const contentBlocks = lastMessage.content as Array<Record<string, unknown>>;
    expect(contentBlocks[0]?.type).toBe('text');
    expect(contentBlocks[1]?.type).toBe('image_url');
  });

  it('anthropic provider 遇到图片附件应明确报错', async () => {
    vi.spyOn(executor as any, 'loadModelConfig').mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'test-key',
      modelName: 'claude-3-5-sonnet-20241022',
      apiEndpoint: 'https://api.anthropic.com/v1',
    });
    await expect(
      executor.execute({
        mode: 'ask',
        instruction: '请分析图片',
        workspace: process.cwd(),
        attachments: [
          {
            type: 'image',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,ZmFrZQ==',
            source: 'paste',
          },
        ],
      })
    ).resolves.toMatchObject({
      error: expect.stringContaining('暂不支持图片输入'),
    });
  });
});
