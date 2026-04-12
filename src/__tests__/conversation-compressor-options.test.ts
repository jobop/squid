import { describe, expect, it } from 'vitest';
import {
  ConversationCompressor,
  loadConversationCompressionOptionsFromEnv,
} from '../conversation/compressor';
import type { Message } from '../conversation/manager';

describe('conversation-compressor options', () => {
  it('should load compressor options from env', () => {
    const opts = loadConversationCompressionOptionsFromEnv({
      SQUID_CONV_CONTEXT_LIMIT_TOKENS: '30000',
      SQUID_CONV_MICRO_THRESHOLD: '0.45',
      SQUID_CONV_TRUNCATE_THRESHOLD: '0.55',
      SQUID_CONV_PARTIAL_THRESHOLD: '0.7',
      SQUID_CONV_FULL_THRESHOLD: '0.8',
    } as NodeJS.ProcessEnv);

    expect(opts.contextLimitTokens).toBe(30000);
    expect(opts.microcompactThreshold).toBe(0.45);
    expect(opts.truncateThreshold).toBe(0.55);
    expect(opts.partialCompactThreshold).toBe(0.7);
    expect(opts.fullCompactThreshold).toBe(0.8);
  });

  it('should expose micro threshold as auto trigger percentage', () => {
    const compressor = new ConversationCompressor({
      contextLimitTokens: 1000,
      microcompactThreshold: 0.5,
      truncateThreshold: 0.6,
      partialCompactThreshold: 0.72,
      fullCompactThreshold: 0.82,
    });

    expect(compressor.getAutoCompressTriggerPercentage()).toBe(50);
  });

  it('should compact when usage passes micro threshold', async () => {
    const compressor = new ConversationCompressor({
      contextLimitTokens: 200,
      microcompactThreshold: 0.5,
      truncateThreshold: 0.6,
      partialCompactThreshold: 0.72,
      fullCompactThreshold: 0.82,
    });

    const messages: Message[] = [
      { role: 'system', content: 'system', timestamp: '2026-01-01T00:00:00.000Z' },
      { role: 'assistant', content: 'a'.repeat(420), timestamp: '2026-01-01T00:00:01.000Z' },
      { role: 'assistant', content: 'b'.repeat(420), timestamp: '2026-01-01T00:00:02.000Z' },
    ];

    const result = await compressor.compress(messages);
    expect(result.compressed).toBe(true);
    expect(result.strategy).not.toBe('none');
  });
});

