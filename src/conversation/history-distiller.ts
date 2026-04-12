export interface AssistantHistoryDistillOptions {
  minCharsToDistill?: number;
  maxStoredChars?: number;
  maxFactLines?: number;
}

export interface AssistantHistoryDistillResult {
  content: string;
  compacted: boolean;
  originalChars: number;
  storedChars: number;
}

const DEFAULT_MIN_CHARS_TO_DISTILL = 900;
const DEFAULT_MAX_STORED_CHARS = 800;
const DEFAULT_MAX_FACT_LINES = 8;

function clampPositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3)}...`;
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function stripCodeBlocksToSingle(text: string): string {
  let count = 0;
  return text.replace(/```[\s\S]*?```/g, (block) => {
    count += 1;
    if (count === 1) {
      const compactBlock = block.split('\n').slice(0, 10).join('\n');
      return compactBlock.length === block.length ? compactBlock : `${compactBlock}\n...`;
    }
    return '';
  });
}

function looksLikeFactLine(line: string): boolean {
  if (!line) return false;
  if (line.length > 180) return false;
  if (/https?:\/\//i.test(line)) return true;
  if (/`[^`]+`/.test(line)) return true;
  if (/[A-Za-z0-9_-]+\s*[:=]\s*\S+/.test(line)) return true;
  if (/v?\d+\.\d+(\.\d+)?/.test(line)) return true;
  if (/\/[\w./-]+/.test(line)) return true;
  if (/^[\-*]\s+/.test(line)) return true;
  return false;
}

function extractOutcome(lines: string[]): string {
  const preferred = lines.find((line) =>
    /(成功|失败|完成|已处理|error|failed|success|completed|done|blocked|无法)/i.test(line)
  );
  if (preferred) return preferred;
  return lines[0] ?? '已生成较长回复，历史中保留关键信息。';
}

function extractNextStep(lines: string[]): string | undefined {
  const askLine = lines.find((line) => /(\?|？)/.test(line));
  if (askLine) return askLine;
  const actionLine = lines.find((line) =>
    /(下一步|接下来|建议|可以继续|please|next step|you can|should)/i.test(line)
  );
  return actionLine;
}

function extractFacts(lines: string[], maxFactLines: number): string[] {
  const dedup = new Set<string>();
  const facts: string[] = [];
  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!looksLikeFactLine(line)) continue;
    if (dedup.has(line)) continue;
    dedup.add(line);
    facts.push(line);
    if (facts.length >= maxFactLines) break;
  }
  return facts;
}

function renderCompactedContent(
  outcome: string,
  facts: string[],
  nextStep: string | undefined,
  originalChars: number,
  maxStoredChars: number
): string {
  const sections: string[] = [];
  sections.push(`[assistant_history_compacted] original_chars=${originalChars}`);
  sections.push(`Outcome: ${outcome}`);
  if (facts.length > 0) {
    sections.push('Key facts:');
    for (const fact of facts) {
      sections.push(`- ${fact}`);
    }
  }
  if (nextStep) {
    sections.push(`Next step: ${nextStep}`);
  }
  return truncate(sections.join('\n'), maxStoredChars);
}

export function loadAssistantHistoryDistillOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): AssistantHistoryDistillOptions {
  return {
    minCharsToDistill: clampPositiveInteger(
      env.SQUID_ASSISTANT_HISTORY_DISTILL_MIN_CHARS,
      DEFAULT_MIN_CHARS_TO_DISTILL
    ),
    maxStoredChars: clampPositiveInteger(
      env.SQUID_ASSISTANT_HISTORY_DISTILL_MAX_CHARS,
      DEFAULT_MAX_STORED_CHARS
    ),
    maxFactLines: clampPositiveInteger(
      env.SQUID_ASSISTANT_HISTORY_DISTILL_MAX_FACT_LINES,
      DEFAULT_MAX_FACT_LINES
    ),
  };
}

export function distillAssistantHistoryContent(
  content: string,
  options: AssistantHistoryDistillOptions = {}
): AssistantHistoryDistillResult {
  const minCharsToDistill = options.minCharsToDistill ?? DEFAULT_MIN_CHARS_TO_DISTILL;
  const maxStoredChars = options.maxStoredChars ?? DEFAULT_MAX_STORED_CHARS;
  const maxFactLines = options.maxFactLines ?? DEFAULT_MAX_FACT_LINES;
  const originalChars = content.length;

  if (!content || originalChars < minCharsToDistill) {
    return {
      content,
      compacted: false,
      originalChars,
      storedChars: originalChars,
    };
  }

  const normalized = stripCodeBlocksToSingle(content)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const lines = normalized
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter(Boolean);

  if (lines.length <= 6) {
    const truncated = truncate(normalized, maxStoredChars);
    return {
      content: truncated,
      compacted: truncated.length < originalChars,
      originalChars,
      storedChars: truncated.length,
    };
  }

  const outcome = extractOutcome(lines);
  const facts = extractFacts(lines, maxFactLines);
  const nextStep = extractNextStep(lines);
  const compacted = renderCompactedContent(outcome, facts, nextStep, originalChars, maxStoredChars);

  return {
    content: compacted,
    compacted: compacted.length < originalChars,
    originalChars,
    storedChars: compacted.length,
  };
}

