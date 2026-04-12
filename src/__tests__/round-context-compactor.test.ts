import { describe, expect, it } from 'vitest';
import {
  RoundContextCompactor,
  classifyToolRetention,
  loadRoundCompactOptionsFromEnv,
  type RoundToolRecord,
} from '../tasks/round-context-compactor';

describe('RoundContextCompactor', () => {
  it('非工具轮不会推进工具结果年龄', () => {
    const compactor = new RoundContextCompactor();
    const readFileMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-keep',
      content: 'READ_FILE_RESULT:' + 'a'.repeat(1800),
    };
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      readFileMessage,
    ];
    const records: RoundToolRecord[] = [
      {
        round: 2,
        toolName: 'read_file',
        toolCallId: 't-keep',
        retention: classifyToolRetention('read_file'),
        messageRef: readFileMessage,
      },
    ];

    // Simulate a non-tool text turn: current round still equals record round.
    compactor.compact(messages, records, 2, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
    });

    expect(String(readFileMessage.content)).toContain('READ_FILE_RESULT:');
    expect(String(readFileMessage.content)).not.toContain('[tool_result_compacted_v2]');
  });

  it('短输出超过2轮未引用后应压缩', () => {
    const compactor = new RoundContextCompactor();
    const processMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-short',
      content: 'SHORT_RESULT:' + 'b'.repeat(260),
    };
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      processMessage,
    ];
    const records: RoundToolRecord[] = [
      {
        round: 1,
        toolName: 'cron_list',
        toolCallId: 't-short',
        retention: classifyToolRetention('cron_list'),
        messageRef: processMessage,
      },
    ];

    compactor.compact(messages, records, 4, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
    });

    expect(String(processMessage.content)).toContain('[tool_result_compacted_v2]');
    expect(String(processMessage.content)).toContain('bucket=short');
  });

  it('长输出在10轮窗口内应保留，超过后压缩', () => {
    const compactor = new RoundContextCompactor();
    const longMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-long',
      content: 'LONG_RESULT:' + 'x'.repeat(8800),
    };
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      longMessage,
    ];
    const records: RoundToolRecord[] = [
      {
        round: 1,
        toolName: 'read_file',
        toolCallId: 't-long',
        retention: classifyToolRetention('read_file'),
        messageRef: longMessage,
      },
    ];

    compactor.compact(messages, records, 10, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
    });
    expect(String(longMessage.content)).toContain('LONG_RESULT:');
    expect(String(longMessage.content)).not.toContain('[tool_result_compacted_v2]');

    compactor.compact(messages, records, 11, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
    });

    expect(String(longMessage.content)).toContain('[tool_result_compacted_v2]');
    expect(String(longMessage.content)).toContain('bucket=long');
  });

  it('白名单数据工具即使短输出也按10轮保留', () => {
    const compactor = new RoundContextCompactor();
    const shortWebFetchMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-web-short',
      content: '# Web Fetch Result\nURL: https://example.com\nStatus: 200 OK\nBody: ok',
    };
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      shortWebFetchMessage,
    ];
    const records: RoundToolRecord[] = [
      {
        round: 1,
        toolName: 'web_fetch',
        toolCallId: 't-web-short',
        retention: classifyToolRetention('web_fetch'),
        messageRef: shortWebFetchMessage,
      },
    ];

    compactor.compact(messages, records, 10, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
    });
    expect(String(shortWebFetchMessage.content)).not.toContain('[tool_result_compacted_v2]');

    compactor.compact(messages, records, 11, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
    });
    expect(String(shortWebFetchMessage.content)).toContain('[tool_result_compacted_v2]');
    expect(String(shortWebFetchMessage.content)).toContain('bucket=long');
  });

  it('R0: 无效子调用直接删除且不留占位', () => {
    const compactor = new RoundContextCompactor();
    const validMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-valid',
      content: 'VALID_RESULT:' + 'ok'.repeat(120),
    };
    const invalidMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-invalid',
      content: '工具参数解析失败: invalid schema',
    };
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      validMessage,
      invalidMessage,
    ];
    const records: RoundToolRecord[] = [
      {
        round: 1,
        toolName: 'read_file',
        toolCallId: 't-valid',
        retention: classifyToolRetention('read_file'),
        messageRef: validMessage,
        isError: false,
      },
      {
        round: 1,
        toolName: 'read_file',
        toolCallId: 't-invalid',
        retention: classifyToolRetention('read_file'),
        messageRef: invalidMessage,
        isError: true,
      },
    ];

    compactor.compact(messages, records, 2, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
    });

    const allContent = messages.map((m) => String(m.content)).join('\n');
    expect(allContent).toContain('VALID_RESULT:');
    expect(allContent).not.toContain('invalid schema');
    expect(allContent).not.toContain('tool_result_dropped');
  });

  it('被后续参数引用的结果应续命并延迟压缩', () => {
    const compactor = new RoundContextCompactor();
    const shortMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-ref',
      content: 'items: doc_123 file_a.ts',
    };
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      shortMessage,
    ];
    const records: RoundToolRecord[] = [
      {
        round: 1,
        toolName: 'cron_list',
        toolCallId: 't-ref',
        retention: classifyToolRetention('cron_list'),
        messageRef: shortMessage,
      },
    ];

    compactor.compact(messages, records, 3, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
      referenceToolArguments: ['{"target":"doc_123"}'],
    });

    // Referenced in round 3, short bucket requires 2 rounds after last reference.
    expect(String(shortMessage.content)).toContain('doc_123');
    expect(String(shortMessage.content)).not.toContain('[tool_result_compacted_v2]');

    compactor.compact(messages, records, 5, {
      contextLimitTokens: 60,
      compactUsageThreshold: 0.01,
    });

    expect(String(shortMessage.content)).toContain('[tool_result_compacted_v2]');
  });

  it('超长消息窗口化时保留系统头和最近消息', () => {
    const compactor = new RoundContextCompactor();
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
    ];
    for (let i = 0; i < 20; i++) {
      messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `m-${i}` });
    }

    compactor.compact(messages, [], 1, {
      contextLimitTokens: 100000,
      maxMessages: 10,
      recentMessagesToKeep: 6,
    });

    expect(messages.length).toBe(8);
    expect(messages[0]?.role).toBe('system');
    expect(String(messages[1]?.content)).toContain('[round_context_windowed]');
    expect(String(messages[messages.length - 1]?.content)).toBe('m-19');
  });

  it('支持从环境变量加载轮间压缩阈值', () => {
    const options = loadRoundCompactOptionsFromEnv({
      SQUID_ROUND_COMPACT_CONTEXT_LIMIT_TOKENS: '120000',
      SQUID_ROUND_COMPACT_USAGE_THRESHOLD: '0.66',
      SQUID_ROUND_COMPACT_SHORT_KEEP_ROUNDS: '2',
      SQUID_ROUND_COMPACT_MID_KEEP_ROUNDS: '6',
      SQUID_ROUND_COMPACT_LONG_KEEP_ROUNDS: '12',
      SQUID_ROUND_COMPACT_MAX_MESSAGES: '52',
      SQUID_ROUND_COMPACT_RECENT_MESSAGES: '31',
    } as NodeJS.ProcessEnv);

    expect(options.contextLimitTokens).toBe(120000);
    expect(options.compactUsageThreshold).toBe(0.66);
    expect(options.shortKeepRounds).toBe(2);
    expect(options.midKeepRounds).toBe(6);
    expect(options.longKeepRounds).toBe(12);
    expect(options.maxMessages).toBe(52);
    expect(options.recentMessagesToKeep).toBe(31);
  });

  it('第一阶段：bash 统一按 data 分类', () => {
    expect(classifyToolRetention('bash')).toBe('data');
  });
});

