/**
 * Agent / Task 执行过程的可查询日志（内存环形缓冲），供 Web UI 与排障使用。
 * 不记录 API Key；指令与工具结果会做截断。
 */

const MAX_ENTRIES = 800;

export type AgentLogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface AgentLogEntry {
  id: string;
  ts: number;
  level: AgentLogLevel;
  category: string;
  message: string;
  meta?: Record<string, unknown>;
}

let seq = 0;
const buffer: AgentLogEntry[] = [];

function nextId(): string {
  seq += 1;
  return `${Date.now()}-${seq}`;
}

export function truncateText(s: string, max = 400): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function appendAgentLog(
  category: string,
  level: AgentLogLevel,
  message: string,
  meta?: Record<string, unknown>
): void {
  buffer.push({
    id: nextId(),
    ts: Date.now(),
    level,
    category,
    message,
    meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
  });
  while (buffer.length > MAX_ENTRIES) {
    buffer.shift();
  }
}

export function getAgentLogs(options?: { limit?: number; since?: number }): {
  entries: AgentLogEntry[];
  total: number;
} {
  const limit = Math.min(Math.max(options?.limit ?? 300, 1), MAX_ENTRIES);
  const since = options?.since;
  let slice = since != null ? buffer.filter((e) => e.ts > since) : [...buffer];
  if (slice.length > limit) {
    slice = slice.slice(-limit);
  }
  return { entries: slice, total: buffer.length };
}

export function clearAgentLogs(): void {
  buffer.length = 0;
}
