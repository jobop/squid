import { describe, expect, it } from 'vitest';
import {
  mergeOpenAIStreamToolCallDelta,
  normalizeOpenAIMessageToolCalls,
  type NormalizedOpenAIToolCall,
} from '../openai-tool-call-normalizer';

describe('openai-tool-call-normalizer', () => {
  it('应兼容 legacy function_call 格式', () => {
    const calls = normalizeOpenAIMessageToolCalls({
      content: '...',
      function_call: {
        name: 'bash',
        arguments: '{"command":"pwd"}',
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.function.name).toBe('bash');
    expect(calls[0]?.function.arguments).toBe('{"command":"pwd"}');
  });

  it('stream tool_call 缺少 index 时也应被合并', () => {
    const calls: Array<NormalizedOpenAIToolCall | undefined> = [];

    mergeOpenAIStreamToolCallDelta(calls, {
      id: 'call_1',
      function: { name: 'bash' },
    });
    mergeOpenAIStreamToolCallDelta(calls, {
      function: { arguments: '{"command":"' },
    });
    mergeOpenAIStreamToolCallDelta(calls, {
      function: { arguments: 'pwd"}' },
    });

    const resolved = calls.filter(Boolean) as NormalizedOpenAIToolCall[];
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.id).toBe('call_1');
    expect(resolved[0]?.function.name).toBe('bash');
    expect(resolved[0]?.function.arguments).toBe('{"command":"pwd"}');
  });
});
