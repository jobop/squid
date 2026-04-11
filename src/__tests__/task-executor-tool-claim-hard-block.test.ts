import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskExecutor } from '../tasks/executor';
import { SkillLoader } from '../skills/loader';
import { ToolRegistry } from '../tools/registry';

function createNoToolCallClaimResponse(claimText: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: claimText,
          },
        },
      ],
    }),
  };
}

describe('TaskExecutor tool-claim hard block', () => {
  const originalFetch = globalThis.fetch;
  let executor: TaskExecutor;

  beforeEach(() => {
    executor = new TaskExecutor(new SkillLoader(), new ToolRegistry());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('模型口头声称已验证但无 tool_call 时，应进入补救并最终硬拦截', async () => {
    vi.spyOn(executor as any, 'loadModelConfig').mockResolvedValue({
      provider: 'openai',
      apiKey: 'test-key',
      modelName: 'gpt-4o-mini',
      apiEndpoint: 'https://api.openai.com/v1',
    });

    const claimText = '我已经调用工具验证了这个命令，结果正常。';
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createNoToolCallClaimResponse(claimText))
      .mockResolvedValueOnce(createNoToolCallClaimResponse(claimText))
      .mockResolvedValueOnce(createNoToolCallClaimResponse(claimText));
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await executor.execute({
      mode: 'ask',
      instruction: '帮我验证一下这个命令是否可用',
      workspace: process.cwd(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.output).toContain('已阻断本轮结论');
    expect(result.output).toContain('tool_selection_missing');
    expect(result.output).not.toContain(claimText);

    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.body || '{}')
    ) as { messages?: Array<{ role?: string; content?: string }> };
    const secondRoundRemediationText = (secondBody.messages || [])
      .map((msg) => msg.content || '')
      .join('\n');
    expect(secondRoundRemediationText).toContain('禁止“只提不调”');
  });

});
