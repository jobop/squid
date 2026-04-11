type GenericMessage = Record<string, any>;

type ToolRetentionClass = 'data' | 'process';

export interface RoundToolRecord {
  round: number;
  toolName: string;
  retention: ToolRetentionClass;
  messageRef: GenericMessage;
  blockIndex?: number;
  compacted?: boolean;
}

interface CompactOptions {
  contextLimitTokens?: number;
  compactUsageThreshold?: number;
  dataToolMinRoundAge?: number;
  dataToolCompactUsageThreshold?: number;
  maxMessages?: number;
  recentMessagesToKeep?: number;
}
export type RoundCompactOptions = CompactOptions;

const DEFAULT_CONTEXT_LIMIT_TOKENS = 100_000;
const DEFAULT_COMPACT_USAGE_THRESHOLD = 0.70;
const DEFAULT_DATA_TOOL_MIN_ROUND_AGE = 2;
const DEFAULT_DATA_TOOL_COMPACT_USAGE_THRESHOLD = 0.78;
const DEFAULT_MAX_MESSAGES = 44;
const DEFAULT_RECENT_MESSAGES_TO_KEEP = 28;

const DATA_BEARING_TOOLS = new Set([
  'bash',
  'read_file',
  'grep',
  'web_search',
  'web_fetch',
]);

function estimateTokens(messages: GenericMessage[]): number {
  let totalChars = 0;
  for (const message of messages) {
    const role = typeof message.role === 'string' ? message.role : '';
    totalChars += role.length;
    const content = message.content;
    if (typeof content === 'string') {
      totalChars += content.length;
      continue;
    }
    try {
      totalChars += JSON.stringify(content ?? '').length;
    } catch {
      totalChars += 0;
    }
  }
  return Math.ceil(totalChars / 4);
}

function truncateMiddle(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) return text;
  if (maxChars < 12) return text.slice(0, maxChars);
  const head = Math.floor((maxChars - 3) / 2);
  const tail = maxChars - 3 - head;
  return `${text.slice(0, head)}...${text.slice(text.length - tail)}`;
}

function extractContentFromRecord(record: RoundToolRecord): string {
  const content = record.messageRef.content;
  if (record.blockIndex === undefined) {
    return typeof content === 'string' ? content : JSON.stringify(content ?? '');
  }
  if (!Array.isArray(content)) return '';
  const block = content[record.blockIndex];
  if (!block || typeof block !== 'object') return '';
  if (typeof block.content === 'string') return block.content;
  try {
    return JSON.stringify(block.content ?? '');
  } catch {
    return '';
  }
}

function setContentToRecord(record: RoundToolRecord, nextContent: string): void {
  if (record.blockIndex === undefined) {
    record.messageRef.content = nextContent;
    return;
  }
  const content = record.messageRef.content;
  if (!Array.isArray(content)) return;
  const block = content[record.blockIndex];
  if (!block || typeof block !== 'object') return;
  block.content = nextContent;
}

function buildCompactedContent(record: RoundToolRecord, source: string): string {
  const previewChars = record.retention === 'data' ? 700 : 260;
  const preview = truncateMiddle(source, previewChars);
  const header = `[tool_result_compacted:${record.retention}] tool=${record.toolName} round=${record.round} original_chars=${source.length}`;
  return `${header}\n${preview}`;
}

function ensureMessageIncluded(messages: GenericMessage[], messageRef: GenericMessage): boolean {
  return messages.includes(messageRef);
}

export function classifyToolRetention(toolName: string): ToolRetentionClass {
  return DATA_BEARING_TOOLS.has((toolName || '').trim().toLowerCase()) ? 'data' : 'process';
}

function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFraction(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : fallback;
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadRoundCompactOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): RoundCompactOptions {
  return {
    contextLimitTokens: parsePositiveInteger(
      env.SQUID_ROUND_COMPACT_CONTEXT_LIMIT_TOKENS,
      DEFAULT_CONTEXT_LIMIT_TOKENS
    ),
    compactUsageThreshold: parseFraction(
      env.SQUID_ROUND_COMPACT_USAGE_THRESHOLD,
      DEFAULT_COMPACT_USAGE_THRESHOLD
    ),
    dataToolMinRoundAge: parsePositiveInteger(
      env.SQUID_ROUND_COMPACT_DATA_MIN_AGE,
      DEFAULT_DATA_TOOL_MIN_ROUND_AGE
    ),
    dataToolCompactUsageThreshold: parseFraction(
      env.SQUID_ROUND_COMPACT_DATA_USAGE_THRESHOLD,
      DEFAULT_DATA_TOOL_COMPACT_USAGE_THRESHOLD
    ),
    maxMessages: parsePositiveInteger(env.SQUID_ROUND_COMPACT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES),
    recentMessagesToKeep: parsePositiveInteger(
      env.SQUID_ROUND_COMPACT_RECENT_MESSAGES,
      DEFAULT_RECENT_MESSAGES_TO_KEEP
    ),
  };
}

export class RoundContextCompactor {
  compact(
    messages: GenericMessage[],
    records: RoundToolRecord[],
    currentRound: number,
    options: CompactOptions = {}
  ): void {
    const contextLimitTokens = options.contextLimitTokens ?? DEFAULT_CONTEXT_LIMIT_TOKENS;
    const compactUsageThreshold = options.compactUsageThreshold ?? DEFAULT_COMPACT_USAGE_THRESHOLD;
    const dataToolMinRoundAge = options.dataToolMinRoundAge ?? DEFAULT_DATA_TOOL_MIN_ROUND_AGE;
    const dataToolCompactUsageThreshold =
      options.dataToolCompactUsageThreshold ?? DEFAULT_DATA_TOOL_COMPACT_USAGE_THRESHOLD;
    const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;
    const recentMessagesToKeep = options.recentMessagesToKeep ?? DEFAULT_RECENT_MESSAGES_TO_KEEP;

    const usage = estimateTokens(messages) / contextLimitTokens;
    if (usage < compactUsageThreshold && messages.length <= maxMessages) {
      return;
    }

    for (const record of records) {
      if (record.compacted) continue;
      if (!ensureMessageIncluded(messages, record.messageRef)) continue;
      const age = currentRound - record.round;
      if (age <= 0) continue;

      if (record.retention === 'data') {
        if (age < dataToolMinRoundAge) continue;
        if (usage < dataToolCompactUsageThreshold) continue;
      }

      const original = extractContentFromRecord(record);
      if (!original) continue;
      const compacted = buildCompactedContent(record, original);
      setContentToRecord(record, compacted);
      record.compacted = true;
    }

    if (messages.length <= maxMessages) {
      return;
    }

    this.applyWindow(messages, recentMessagesToKeep);
  }

  private applyWindow(messages: GenericMessage[], recentMessagesToKeep: number): void {
    if (messages.length <= recentMessagesToKeep + 1) return;
    const systemHead = messages[0];
    const tail = messages.slice(-recentMessagesToKeep);
    const keptTail = tail.filter((msg) => msg !== systemHead);
    const droppedCount = messages.length - (1 + keptTail.length);
    if (droppedCount <= 0) return;

    if (typeof systemHead?.role === 'string' && systemHead.role === 'system') {
      const marker: GenericMessage = {
        role: 'system',
        content: `[round_context_windowed] Omitted ${droppedCount} earlier intermediate messages to control context size.`,
      };
      messages.splice(0, messages.length, systemHead, marker, ...keptTail);
      return;
    }

    messages.splice(0, messages.length, systemHead, ...keptTail);
  }
}

