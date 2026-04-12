type GenericMessage = Record<string, any>;

type ToolRetentionClass = 'data' | 'process';
type TokenBucket = 'short' | 'mid' | 'long';
type ToolPolicyTag = 'always_keep' | 'always_compact' | 'normal';

export interface RoundToolRecord {
  round: number;
  toolName: string;
  toolCallId?: string;
  rawArguments?: string;
  retention: ToolRetentionClass;
  messageRef: GenericMessage;
  blockIndex?: number;
  compacted?: boolean;
  pruned?: boolean;
  isError?: boolean;
  lastReferencedRound?: number;
  tokenBucket?: TokenBucket;
  policyTag?: ToolPolicyTag;
  anchors?: string[];
}

interface CompactOptions {
  contextLimitTokens?: number;
  compactUsageThreshold?: number;
  shortKeepRounds?: number;
  midKeepRounds?: number;
  longKeepRounds?: number;
  maxMessages?: number;
  recentMessagesToKeep?: number;
  referenceAssistantText?: string;
  referenceToolArguments?: string[];
  aiSummarizeFn?: (messages: GenericMessage[]) => Promise<string>;
}
export type RoundCompactOptions = CompactOptions;

const DEFAULT_CONTEXT_LIMIT_TOKENS = 100_000;
const DEFAULT_COMPACT_USAGE_THRESHOLD = 0.70;
const DEFAULT_SHORT_KEEP_ROUNDS = 2;
const DEFAULT_MID_KEEP_ROUNDS = 5;
const DEFAULT_LONG_KEEP_ROUNDS = 10;
const DEFAULT_MAX_MESSAGES = 44;
const DEFAULT_RECENT_MESSAGES_TO_KEEP = 28;
const LAYER3_WINDOW_USAGE_THRESHOLD = 0.95;
const SHORT_OUTPUT_TOKENS = 500;
const LONG_OUTPUT_TOKENS = 2000;

const DATA_BEARING_TOOLS = new Set(['bash', 'read_file', 'grep', 'web_search', 'web_fetch']);
const DATA_LONG_KEEP_TOOLS = new Set(['read_file', 'grep', 'web_search', 'web_fetch']);
const ALWAYS_KEEP_TOOLS = new Set([
  'rag_retrieve',
  'vector_search',
  'database_query',
  'read_file_large',
  'api_fetch_data',
]);
const ALWAYS_COMPACT_TOOLS = new Set(['list_dir', 'ping', 'status', 'git_diff_short', 'ls']);

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

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const typed = block as Record<string, unknown>;
      if (typeof typed.content === 'string') {
        parts.push(typed.content);
      } else if (typeof typed.text === 'string') {
        parts.push(typed.text);
      }
    }
    if (parts.length > 0) return parts.join('\n');
  }
  try {
    return JSON.stringify(content ?? '');
  } catch {
    return '';
  }
}

function normalizeToolName(toolName: string): string {
  return (toolName || '').trim().toLowerCase();
}

function classifyPolicyTag(toolName: string): ToolPolicyTag {
  const normalized = normalizeToolName(toolName);
  if (ALWAYS_KEEP_TOOLS.has(normalized)) return 'always_keep';
  if (ALWAYS_COMPACT_TOOLS.has(normalized)) return 'always_compact';
  return 'normal';
}

function bucketByTokens(tokenCount: number): TokenBucket {
  if (tokenCount < SHORT_OUTPUT_TOKENS) return 'short';
  if (tokenCount >= LONG_OUTPUT_TOKENS) return 'long';
  return 'mid';
}

function shouldForceLongBucket(toolName: string, policyTag: ToolPolicyTag): boolean {
  if (policyTag === 'always_keep') return true;
  return DATA_LONG_KEEP_TOOLS.has(normalizeToolName(toolName));
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

function removeRecordContentFromMessages(messages: GenericMessage[], record: RoundToolRecord): void {
  if (record.blockIndex === undefined) {
    const idx = messages.indexOf(record.messageRef);
    if (idx >= 0) messages.splice(idx, 1);
    return;
  }

  const content = record.messageRef.content;
  if (!Array.isArray(content)) return;
  if (record.blockIndex < 0 || record.blockIndex >= content.length) return;
  content.splice(record.blockIndex, 1);
}

function buildCompactedContent(
  record: RoundToolRecord,
  source: string,
  tokenCount: number,
  bucket: TokenBucket
): string {
  const previewChars = bucket === 'long' ? 900 : bucket === 'mid' ? 520 : 260;
  const preview = truncateMiddle(source, previewChars);
  const header = `[tool_result_compacted_v2] tool=${record.toolName} round=${record.round} bucket=${bucket} original_tokens=${tokenCount}`;
  return `${header}\n${preview}`;
}

function ensureMessageIncluded(messages: GenericMessage[], messageRef: GenericMessage): boolean {
  return messages.includes(messageRef);
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

function parseAnchorTokens(text: string): string[] {
  if (!text) return [];
  const set = new Set<string>();
  const patterns = [
    /\bdoc[_-]\d+\b/gi,
    /\b[a-z0-9_.-]+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|txt|py|java|go|rs|sh)\b/gi,
    /\b[a-z_]+[_-]id[:=]\s*[a-z0-9_-]+\b/gi,
    /\/[A-Za-z0-9._/-]{3,}/g,
  ];
  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const hit = (match[0] || '').trim();
      if (hit.length >= 3) set.add(hit);
    }
  }
  return Array.from(set).slice(0, 16);
}

function isExplicitlyEmptyPayload(text: string): boolean {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  return trimmed === '[]' || trimmed === '{}' || trimmed === 'null' || trimmed === '""';
}

function isDataTool(toolName: string): boolean {
  const normalized = normalizeToolName(toolName);
  return DATA_BEARING_TOOLS.has(normalized) || classifyPolicyTag(toolName) === 'always_keep';
}

function isRecordReferenced(
  record: RoundToolRecord,
  referenceAssistantText: string,
  referenceToolArguments: string[]
): boolean {
  const anchors = record.anchors || [];
  if (!anchors.length) return false;
  const haystacks = [referenceAssistantText, ...referenceToolArguments].filter(Boolean).join('\n');
  if (!haystacks) return false;
  return anchors.some((anchor) => haystacks.includes(anchor));
}

function keepRoundsFor(record: RoundToolRecord, options: CompactOptions): number {
  const shortKeepRounds = options.shortKeepRounds ?? DEFAULT_SHORT_KEEP_ROUNDS;
  const midKeepRounds = options.midKeepRounds ?? DEFAULT_MID_KEEP_ROUNDS;
  const longKeepRounds = options.longKeepRounds ?? DEFAULT_LONG_KEEP_ROUNDS;
  const policyTag = record.policyTag ?? 'normal';
  const bucket = record.tokenBucket ?? 'short';

  if (policyTag === 'always_keep') return longKeepRounds;
  if (policyTag === 'always_compact') return shortKeepRounds;
  if (bucket === 'long') return longKeepRounds;
  if (bucket === 'mid') return midKeepRounds;
  return shortKeepRounds;
}

export function classifyToolRetention(toolName: string): ToolRetentionClass {
  return DATA_BEARING_TOOLS.has(normalizeToolName(toolName)) ? 'data' : 'process';
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
    shortKeepRounds: parsePositiveInteger(
      env.SQUID_ROUND_COMPACT_SHORT_KEEP_ROUNDS,
      DEFAULT_SHORT_KEEP_ROUNDS
    ),
    midKeepRounds: parsePositiveInteger(
      env.SQUID_ROUND_COMPACT_MID_KEEP_ROUNDS,
      DEFAULT_MID_KEEP_ROUNDS
    ),
    longKeepRounds: parsePositiveInteger(
      env.SQUID_ROUND_COMPACT_LONG_KEEP_ROUNDS,
      DEFAULT_LONG_KEEP_ROUNDS
    ),
    maxMessages: parsePositiveInteger(env.SQUID_ROUND_COMPACT_MAX_MESSAGES, DEFAULT_MAX_MESSAGES),
    recentMessagesToKeep: parsePositiveInteger(
      env.SQUID_ROUND_COMPACT_RECENT_MESSAGES,
      DEFAULT_RECENT_MESSAGES_TO_KEEP
    ),
  };
}

export class RoundContextCompactor {
  async compact(
    messages: GenericMessage[],
    records: RoundToolRecord[],
    currentRound: number,
    options: CompactOptions = {}
  ): Promise<void> {
    const contextLimitTokens = options.contextLimitTokens ?? DEFAULT_CONTEXT_LIMIT_TOKENS;
    const compactUsageThreshold = options.compactUsageThreshold ?? DEFAULT_COMPACT_USAGE_THRESHOLD;
    const recentMessagesToKeep = options.recentMessagesToKeep ?? DEFAULT_RECENT_MESSAGES_TO_KEEP;

    const referenceAssistantText = options.referenceAssistantText || '';
    const referenceToolArguments = options.referenceToolArguments || [];

    for (const record of records) {
      if (record.compacted || record.pruned) continue;
      if (!ensureMessageIncluded(messages, record.messageRef)) continue;

      const original = extractContentFromRecord(record);
      const tokenCount = estimateTokens([{ role: 'tool', content: original }]);
      const policyTag = classifyPolicyTag(record.toolName);
      const bucket = shouldForceLongBucket(record.toolName, policyTag)
        ? 'long'
        : bucketByTokens(tokenCount);
      if (!record.anchors || record.anchors.length === 0) {
        record.anchors = parseAnchorTokens(original);
      }
      record.tokenBucket = bucket;
      record.policyTag = policyTag;

      if (isRecordReferenced(record, referenceAssistantText, referenceToolArguments)) {
        record.lastReferencedRound = currentRound;
      }
    }

    // R0: remove invalid subcalls directly (no placeholder).
    for (const record of records) {
      if (record.compacted || record.pruned) continue;
      if (!ensureMessageIncluded(messages, record.messageRef)) continue;
      const original = extractContentFromRecord(record);
      const referenced = typeof record.lastReferencedRound === 'number' && record.lastReferencedRound > record.round;
      const invalidByError = record.isError === true;
      const invalidByEmptyData = isDataTool(record.toolName) && isExplicitlyEmptyPayload(original) && !referenced;
      if ((invalidByError || invalidByEmptyData) && !referenced) {
        removeRecordContentFromMessages(messages, record);
        record.pruned = true;
      }
    }

    for (const record of records) {
      if (record.compacted || record.pruned) continue;
      if (!ensureMessageIncluded(messages, record.messageRef)) continue;
      const original = extractContentFromRecord(record);
      if (!original) continue;

      const keepRounds = keepRoundsFor(record, options);
      const baseRound = Math.max(record.round, record.lastReferencedRound ?? record.round);
      const age = currentRound - baseRound;
      if (age < keepRounds) continue;

      const tokenCount = record.tokenBucket
        ? estimateTokens([{ role: 'tool', content: original }])
        : estimateTokens([{ role: 'tool', content: original }]);
      const bucket = record.tokenBucket ?? bucketByTokens(tokenCount);
      const compacted = buildCompactedContent(record, original, tokenCount, bucket);
      setContentToRecord(record, compacted);
      record.compacted = true;
    }

    const usageAfterRoundLayer = estimateTokens(messages) / contextLimitTokens;
    if (usageAfterRoundLayer < compactUsageThreshold) {
      return;
    }

    const summarized = await this.applyUsageSummary(
      messages,
      recentMessagesToKeep,
      options.aiSummarizeFn
    );
    if (!summarized) {
      return;
    }
    const usageAfterSummary = estimateTokens(messages) / contextLimitTokens;
    if (usageAfterSummary < LAYER3_WINDOW_USAGE_THRESHOLD) {
      return;
    }

    this.applyWindow(messages, recentMessagesToKeep, contextLimitTokens, LAYER3_WINDOW_USAGE_THRESHOLD);
  }

  private async applyUsageSummary(
    messages: GenericMessage[],
    recentMessagesToKeep: number,
    aiSummarizeFn?: (messages: GenericMessage[]) => Promise<string>
  ): Promise<boolean> {
    if (messages.length <= 2) return false;
    if (!aiSummarizeFn) return false;
    const keepRecent = Math.max(2, recentMessagesToKeep);
    const hasSystemHead =
      typeof messages[0]?.role === 'string' && String(messages[0].role) === 'system';
    const summaryStart = hasSystemHead ? 1 : 0;
    const summaryEnd = Math.max(summaryStart + 1, messages.length - keepRecent);
    if (summaryEnd <= summaryStart) return false;

    const source = messages.slice(summaryStart, summaryEnd);
    if (source.length < 2) return false;
    const sourceChars = source.reduce((acc, msg) => acc + contentToText(msg.content).length + 16, 0);
    if (sourceChars <= 0) return false;

    const briefLine = (msg: GenericMessage, maxChars = 180): string => {
      const role = typeof msg.role === 'string' ? msg.role : 'unknown';
      const text = truncateMiddle(contentToText(msg.content), maxChars).replace(/\s+/g, ' ').trim();
      return `[${role}] ${text}`;
    };
    const summaryHeader = `[round_context_summary] summarized_messages=${source.length}`;
    const llmInput = source.map((msg) => ({
      role: typeof msg.role === 'string' ? msg.role : 'unknown',
      content: truncateMiddle(contentToText(msg.content), 3200),
    }));

    let llmSummary = '';
    try {
      llmSummary = (await aiSummarizeFn(llmInput)).trim();
    } catch {
      return false;
    }
    if (!llmSummary) return false;

    const maxSummaryChars = Math.max(240, Math.min(1200, Math.floor(sourceChars * 0.45)));
    let summaryText =
      llmSummary.length > maxSummaryChars
        ? `${summaryHeader}\n\n${truncateMiddle(llmSummary, Math.max(80, maxSummaryChars - summaryHeader.length - 2))}`
        : `${summaryHeader}\n\n${llmSummary}`;

    // Hard guard: summary must be shorter than original segment.
    if (summaryText.length >= sourceChars) {
      const fallback = source.slice(-3).map((msg) => briefLine(msg, 72)).join(' | ');
      summaryText = `${summaryHeader}\n[summary_compacted] ${truncateMiddle(fallback, Math.max(80, Math.floor(sourceChars * 0.35)))}`;
    }
    const sourcePreview = truncateMiddle(
      source
        .map((msg) => `[${String(msg.role || 'unknown')}] ${contentToText(msg.content)}`)
        .join('\n'),
      3000
    );
    const summaryPreview = truncateMiddle(summaryText, 3000);
    const summaryRatio = (summaryText.length / Math.max(sourceChars, 1)).toFixed(3);
    const usedFallback = summaryText.includes('[summary_compacted]');
    console.log(
      `[RoundCompactor][Layer2] beforeChars=${sourceChars} afterChars=${summaryText.length} ratio=${summaryRatio} fallback=${usedFallback}`
    );
    console.log(`[RoundCompactor][Layer2][beforePreview]\n${sourcePreview}`);
    console.log(`[RoundCompactor][Layer2][afterPreview]\n${summaryPreview}`);

    const summaryMessage: GenericMessage = {
      role: 'system',
      content: summaryText,
    };

    const next = hasSystemHead
      ? [messages[0], summaryMessage, ...messages.slice(summaryEnd)]
      : [summaryMessage, ...messages.slice(summaryEnd)];
    messages.splice(0, messages.length, ...next);
    return true;
  }

  private applyWindow(
    messages: GenericMessage[],
    recentMessagesToKeep: number,
    contextLimitTokens: number,
    targetUsage: number
  ): void {
    const hasSystemHead =
      typeof messages[0]?.role === 'string' && String(messages[0].role) === 'system';
    const floorSize = hasSystemHead ? 1 : 0;
    const removeAt = hasSystemHead ? 1 : 0;
    let droppedCount = 0;

    while (
      messages.length > floorSize &&
      estimateTokens(messages) / contextLimitTokens >= targetUsage
    ) {
      messages.splice(removeAt, 1);
      droppedCount += 1;
    }

    if (droppedCount <= 0) return;

    const marker: GenericMessage = {
      role: 'system',
      content: `[round_context_windowed] Omitted ${droppedCount} earlier intermediate messages to satisfy usage threshold.`,
    };
    messages.splice(hasSystemHead ? 1 : 0, 0, marker);
  }
}

