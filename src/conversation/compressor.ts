// Conversation history compressor with 4-layer progressive strategy
import type { Message } from './manager';

const DEFAULT_CONTEXT_LIMIT_TOKENS = 28_000;
const DEFAULT_MICROCOMPACT_THRESHOLD = 0.50;
const DEFAULT_TRUNCATE_THRESHOLD = 0.60;
const DEFAULT_PARTIAL_COMPACT_THRESHOLD = 0.72;
const DEFAULT_FULL_COMPACT_THRESHOLD = 0.82;

const KEEP_RECENT_MESSAGES = 20;
const KEEP_RECENT_AFTER_COMPACT = 10;

export interface ConversationCompressionOptions {
  contextLimitTokens?: number;
  microcompactThreshold?: number;
  truncateThreshold?: number;
  partialCompactThreshold?: number;
  fullCompactThreshold?: number;
}

export interface CompressionResult {
  messages: Message[];
  compressed: boolean;
  strategy: 'none' | 'microcompact' | 'truncate' | 'partial' | 'full';
  tokensSaved: number;
}

export class ConversationCompressor {
  private readonly modelContextLimit: number;
  private readonly microcompactThreshold: number;
  private readonly truncateThreshold: number;
  private readonly partialCompactThreshold: number;
  private readonly fullCompactThreshold: number;

  constructor(options: ConversationCompressionOptions = {}) {
    this.modelContextLimit = options.contextLimitTokens ?? DEFAULT_CONTEXT_LIMIT_TOKENS;
    this.microcompactThreshold = options.microcompactThreshold ?? DEFAULT_MICROCOMPACT_THRESHOLD;
    this.truncateThreshold = options.truncateThreshold ?? DEFAULT_TRUNCATE_THRESHOLD;
    this.partialCompactThreshold =
      options.partialCompactThreshold ?? DEFAULT_PARTIAL_COMPACT_THRESHOLD;
    this.fullCompactThreshold = options.fullCompactThreshold ?? DEFAULT_FULL_COMPACT_THRESHOLD;
  }

  // Estimate token count (rough approximation: 1 token ≈ 4 characters)
  private estimateTokens(messages: Message[]): number {
    let total = 0;
    for (const msg of messages) {
      total += Math.ceil(msg.content.length / 4);
    }
    return total;
  }

  // Layer 1: Microcompact - Remove redundant content
  private microcompact(messages: Message[]): Message[] {
    const result: Message[] = [];
    let toolCallCount = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      // Keep recent 5 tool calls, remove older ones
      if (msg.role === 'tool' || msg.content.includes('tool_result')) {
        toolCallCount++;
        if (toolCallCount > 5) {
          continue; // Skip old tool results
        }
      }

      // Remove thinking blocks (if any)
      let content = msg.content;
      if (content.includes('<thinking>')) {
        content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '[思考过程已省略]');
      }

      // Truncate very long file contents
      if (content.length > 10000 && content.includes('```')) {
        content = content.substring(0, 10000) + '\n...[内容已截断]';
      }

      result.unshift({ ...msg, content });
    }

    return result;
  }

  // Layer 2: Smart Truncation - Keep recent messages only
  private truncate(messages: Message[]): Message[] {
    if (messages.length <= KEEP_RECENT_MESSAGES) {
      return messages;
    }

    const truncated = messages.slice(-KEEP_RECENT_MESSAGES);

    // Add truncation marker at the beginning
    return [
      {
        role: 'system',
        content: '[早期对话已截断，以下是最近的对话内容]',
        timestamp: truncated[0].timestamp
      },
      ...truncated
    ];
  }

  // Layer 3: Partial Compact - Summarize middle section (requires AI)
  private async partialCompact(
    messages: Message[],
    aiSummarizeFn?: (messages: Message[]) => Promise<string>
  ): Promise<Message[]> {
    if (messages.length <= 30 || !aiSummarizeFn) {
      return this.truncate(messages);
    }

    const keepStart = 10;
    const keepEnd = 20;
    const middleSection = messages.slice(keepStart, -keepEnd);

    try {
      const summary = await aiSummarizeFn(middleSection);

      return [
        ...messages.slice(0, keepStart),
        {
          role: 'system',
          content: `[中间对话摘要]\n${summary}`,
          timestamp: middleSection[0].timestamp
        },
        ...messages.slice(-keepEnd)
      ];
    } catch (error) {
      console.error('Partial compact failed, falling back to truncation:', error);
      return this.truncate(messages);
    }
  }

  // Layer 4: Full Compact - Comprehensive summary (requires AI)
  private async fullCompact(
    messages: Message[],
    aiSummarizeFn?: (messages: Message[]) => Promise<string>
  ): Promise<Message[]> {
    if (messages.length <= KEEP_RECENT_AFTER_COMPACT || !aiSummarizeFn) {
      return this.truncate(messages);
    }

    const oldMessages = messages.slice(0, -KEEP_RECENT_AFTER_COMPACT);
    const recentMessages = messages.slice(-KEEP_RECENT_AFTER_COMPACT);

    try {
      const summary = await aiSummarizeFn(oldMessages);

      return [
        {
          role: 'system',
          content: `[对话历史摘要]\n\n${summary}\n\n---\n以下是最近的对话：`,
          timestamp: oldMessages[0].timestamp
        },
        ...recentMessages
      ];
    } catch (error) {
      console.error('Full compact failed, falling back to truncation:', error);
      return this.truncate(messages);
    }
  }

  // Main compression method with progressive strategy
  async compress(
    messages: Message[],
    aiSummarizeFn?: (messages: Message[]) => Promise<string>
  ): Promise<CompressionResult> {
    const initialTokens = this.estimateTokens(messages);
    const usage = initialTokens / this.modelContextLimit;

    let result = messages;
    let strategy: CompressionResult['strategy'] = 'none';

    // Layer 1: Microcompact
    if (usage > this.microcompactThreshold) {
      result = this.microcompact(result);
      strategy = 'microcompact';

      const newUsage = this.estimateTokens(result) / this.modelContextLimit;
      if (newUsage < this.truncateThreshold) {
        return {
          messages: result,
          compressed: true,
          strategy,
          tokensSaved: initialTokens - this.estimateTokens(result)
        };
      }
    }

    // Layer 2: Smart Truncation
    if (usage > this.truncateThreshold) {
      result = this.truncate(result);
      strategy = 'truncate';

      const newUsage = this.estimateTokens(result) / this.modelContextLimit;
      if (newUsage < this.partialCompactThreshold) {
        return {
          messages: result,
          compressed: true,
          strategy,
          tokensSaved: initialTokens - this.estimateTokens(result)
        };
      }
    }

    // Layer 3: Partial Compact
    if (usage > this.partialCompactThreshold && aiSummarizeFn) {
      result = await this.partialCompact(result, aiSummarizeFn);
      strategy = 'partial';

      const newUsage = this.estimateTokens(result) / this.modelContextLimit;
      if (newUsage < this.fullCompactThreshold) {
        return {
          messages: result,
          compressed: true,
          strategy,
          tokensSaved: initialTokens - this.estimateTokens(result)
        };
      }
    }

    // Layer 4: Full Compact
    if (usage > this.fullCompactThreshold && aiSummarizeFn) {
      result = await this.fullCompact(result, aiSummarizeFn);
      strategy = 'full';
    }

    return {
      messages: result,
      compressed: strategy !== 'none',
      strategy,
      tokensSaved: initialTokens - this.estimateTokens(result)
    };
  }

  // Manual compression trigger
  async manualCompress(
    messages: Message[],
    aiSummarizeFn?: (messages: Message[]) => Promise<string>
  ): Promise<CompressionResult> {
    // Force full compact for manual trigger
    const result = await this.fullCompact(messages, aiSummarizeFn);
    const initialTokens = this.estimateTokens(messages);

    return {
      messages: result,
      compressed: true,
      strategy: 'full',
      tokensSaved: initialTokens - this.estimateTokens(result)
    };
  }

  // Get current usage percentage
  getUsagePercentage(messages: Message[]): number {
    const tokens = this.estimateTokens(messages);
    return (tokens / this.modelContextLimit) * 100;
  }

  getEstimatedTokens(messages: Message[]): number {
    return this.estimateTokens(messages);
  }

  getAutoCompressTriggerPercentage(): number {
    return this.microcompactThreshold * 100;
  }
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFraction(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : fallback;
}

export function loadConversationCompressionOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ConversationCompressionOptions {
  const microRaw = parseFraction(
    env.SQUID_CONV_MICRO_THRESHOLD,
    DEFAULT_MICROCOMPACT_THRESHOLD
  );
  const truncateRaw = parseFraction(env.SQUID_CONV_TRUNCATE_THRESHOLD, DEFAULT_TRUNCATE_THRESHOLD);
  const partialRaw = parseFraction(
    env.SQUID_CONV_PARTIAL_THRESHOLD,
    DEFAULT_PARTIAL_COMPACT_THRESHOLD
  );
  const fullRaw = parseFraction(env.SQUID_CONV_FULL_THRESHOLD, DEFAULT_FULL_COMPACT_THRESHOLD);

  const microcompactThreshold = microRaw;
  const truncateThreshold = truncateRaw > microcompactThreshold ? truncateRaw : microcompactThreshold;
  const partialCompactThreshold =
    partialRaw > truncateThreshold ? partialRaw : truncateThreshold;
  const fullCompactThreshold =
    fullRaw > partialCompactThreshold ? fullRaw : partialCompactThreshold;

  return {
    contextLimitTokens: parsePositiveInteger(
      env.SQUID_CONV_CONTEXT_LIMIT_TOKENS,
      DEFAULT_CONTEXT_LIMIT_TOKENS
    ),
    microcompactThreshold,
    truncateThreshold,
    partialCompactThreshold,
    fullCompactThreshold,
  };
}
