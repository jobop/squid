import { describe, expect, it } from 'vitest';
import {
  buildToolConsistencyRemediationMessage,
  checkToolInvocationConsistency,
  detectToolClaimSignals,
} from '../tool-invocation-consistency';

describe('tool-invocation-consistency', () => {
  it('应识别中文工具声明信号', () => {
    const signals = detectToolClaimSignals('我已经调用工具验证过这个命令了。');
    expect(signals.length).toBeGreaterThan(0);
  });

  it('应识别英文工具声明信号', () => {
    const signals = detectToolClaimSignals('I already ran the tool and verified the result.');
    expect(signals.length).toBeGreaterThan(0);
  });

  it('声明已执行工具但无 tool call 时返回 warning', () => {
    const result = checkToolInvocationConsistency({
      assistantText: '我已经调用工具验证完成。',
      selectedTools: [],
      executedTools: [],
    });
    expect(result.status).toBe('warning');
    expect(result.reason).toBe('tool_selection_missing');
    expect(buildToolConsistencyRemediationMessage(result)).toContain('禁止“只提不调”');
  });

  it('声明且至少一个工具成功时返回 ok', () => {
    const result = checkToolInvocationConsistency({
      assistantText: 'I already ran the bash tool.',
      selectedTools: [{ toolName: 'bash', toolCallId: 'tool_1' }],
      executedTools: [{ toolName: 'bash', toolCallId: 'tool_1', status: 'ok' }],
    });
    expect(result.status).toBe('ok');
    expect(result.selectedToolNames).toEqual(['bash']);
  });

  it('声明且所有工具失败时返回 warning', () => {
    const result = checkToolInvocationConsistency({
      assistantText: '我已执行工具并完成。',
      selectedTools: [
        { toolName: 'web_search', toolCallId: 'tool_1' },
        { toolName: 'bash', toolCallId: 'tool_2' },
      ],
      executedTools: [
        { toolName: 'web_search', toolCallId: 'tool_1', status: 'failed', errorPreview: 'timeout' },
        { toolName: 'bash', toolCallId: 'tool_2', status: 'failed', errorPreview: 'permission denied' },
      ],
    });
    expect(result.status).toBe('warning');
    expect(result.reason).toBe('tool_execution_failed');
    expect(buildToolConsistencyRemediationMessage(result)).toContain('失败工具');
  });
});
