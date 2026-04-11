import { describe, expect, it } from 'vitest';
import {
  RoundContextCompactor,
  classifyToolRetention,
  loadRoundCompactOptionsFromEnv,
  type RoundToolRecord,
} from '../tasks/round-context-compactor';

describe('RoundContextCompactor', () => {
  it('保留当前轮的数据型工具结果，同时压缩上一轮过程型结果', () => {
    const compactor = new RoundContextCompactor();
    const readFileMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-read',
      content: 'READ_FILE_RESULT:' + 'a'.repeat(400),
    };
    const processMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-process',
      content: 'PROCESS_RESULT:' + 'b'.repeat(400),
    };
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'query' },
      readFileMessage,
      processMessage,
    ];
    const records: RoundToolRecord[] = [
      {
        round: 2,
        toolName: 'read_file',
        retention: classifyToolRetention('read_file'),
        messageRef: readFileMessage,
      },
      {
        round: 1,
        toolName: 'cron_list',
        retention: classifyToolRetention('cron_list'),
        messageRef: processMessage,
      },
    ];

    compactor.compact(messages, records, 2, { contextLimitTokens: 50 });

    expect(String(readFileMessage.content)).toContain('READ_FILE_RESULT:');
    expect(String(readFileMessage.content)).not.toContain('[tool_result_compacted:data]');
    expect(String(processMessage.content)).toContain('[tool_result_compacted:process]');
  });

  it('数据型工具在跨轮且压力高时可压缩为证据卡', () => {
    const compactor = new RoundContextCompactor();
    const readFileMessage: Record<string, unknown> = {
      role: 'tool',
      tool_call_id: 't-read-old',
      content: 'READ_FILE_OLD:' + 'x'.repeat(1200),
    };
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      { role: 'assistant', content: 'intermediate' },
      readFileMessage,
    ];
    const records: RoundToolRecord[] = [
      {
        round: 1,
        toolName: 'read_file',
        retention: classifyToolRetention('read_file'),
        messageRef: readFileMessage,
      },
    ];

    compactor.compact(messages, records, 3, { contextLimitTokens: 60 });

    expect(String(readFileMessage.content)).toContain('[tool_result_compacted:data]');
    expect(String(readFileMessage.content)).toContain('tool=read_file');
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
      SQUID_ROUND_COMPACT_DATA_MIN_AGE: '3',
      SQUID_ROUND_COMPACT_DATA_USAGE_THRESHOLD: '0.82',
      SQUID_ROUND_COMPACT_MAX_MESSAGES: '52',
      SQUID_ROUND_COMPACT_RECENT_MESSAGES: '31',
    } as NodeJS.ProcessEnv);

    expect(options.contextLimitTokens).toBe(120000);
    expect(options.compactUsageThreshold).toBe(0.66);
    expect(options.dataToolMinRoundAge).toBe(3);
    expect(options.dataToolCompactUsageThreshold).toBe(0.82);
    expect(options.maxMessages).toBe(52);
    expect(options.recentMessagesToKeep).toBe(31);
  });

  it('第一阶段：bash 统一按 data 分类', () => {
    expect(classifyToolRetention('bash')).toBe('data');
  });
});

