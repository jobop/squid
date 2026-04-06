/**
 * 按 conversationId 分桶的命令队列（与 claude-code-main 的「忙则入队、空闲 drain」对齐）
 */

import type { TaskMode } from '../tasks/types';

export type QueuePriority = 'now' | 'next' | 'later';

export type QueuedCommandSource = 'user' | 'cron' | 'channel' | string;

/**
 * 队列任务跑完后，由已注册的渠道 handler 按 `channelId` 决定是否回贴。
 * 核心只存结构与广播；新渠道在扩展内 `addChannelQueuedCompleteHandler` + 入队时带 `channelReply` 即可，勿再往 QueuedCommand 加字段。
 */
export interface ChannelQueueReply {
  channelId: string;
  /** 路由键（如 chat_id）；核心不解析，由各渠道桥接使用 */
  chatId: string;
}

export interface QueuedCommand {
  /** 路由键：同一会话内 FIFO + 优先级，不阻塞其它会话 */
  conversationId: string;
  value: string;
  priority?: QueuePriority;
  isMeta?: boolean;
  source?: QueuedCommandSource;
  taskId?: string;
  mode?: TaskMode;
  workspace?: string;
  expertId?: string;
  skill?: string;
  /** 若设置，队列执行完成后由 TaskAPI 向已注册的 channel 完成回调广播（见 addChannelQueuedCompleteHandler） */
  channelReply?: ChannelQueueReply;
}

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  now: 0,
  next: 1,
  later: 2,
};

/** conversationId -> queue */
const queues = new Map<string, QueuedCommand[]>();

type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

function notifySubscribers(): void {
  subscribers.forEach((cb) => cb());
}

function getBucket(conversationId: string): QueuedCommand[] {
  let q = queues.get(conversationId);
  if (!q) {
    q = [];
    queues.set(conversationId, q);
  }
  return q;
}

function findHighestPriorityIndex(bucket: QueuedCommand[]): number {
  if (bucket.length === 0) return -1;
  let bestIdx = 0;
  let bestP = PRIORITY_ORDER[bucket[0]!.priority ?? 'next'];
  for (let i = 1; i < bucket.length; i++) {
    const p = PRIORITY_ORDER[bucket[i]!.priority ?? 'next'];
    if (p < bestP) {
      bestP = p;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export function subscribeToCommandQueue(callback: Subscriber): () => void {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

/** 全量快照：各会话队列的浅拷贝（调试用 / 外部 store） */
export function getCommandQueueSnapshot(): Readonly<Record<string, readonly QueuedCommand[]>> {
  const out: Record<string, readonly QueuedCommand[]> = {};
  for (const [id, bucket] of queues) {
    if (bucket.length > 0) out[id] = [...bucket];
  }
  return out;
}

export function getConversationQueueLength(conversationId: string): number {
  return getBucket(conversationId).length;
}

export function getCommandQueueLength(): number {
  let n = 0;
  for (const bucket of queues.values()) n += bucket.length;
  return n;
}

export function hasCommandsInQueue(conversationId?: string): boolean {
  if (conversationId !== undefined) {
    return getBucket(conversationId).length > 0;
  }
  for (const bucket of queues.values()) {
    if (bucket.length > 0) return true;
  }
  return false;
}

export function enqueue(command: QueuedCommand): void {
  const cid = command.conversationId.trim();
  if (!cid) {
    console.warn('[messageQueueManager] enqueue skipped: empty conversationId');
    return;
  }
  const bucket = getBucket(cid);
  bucket.push({ ...command, conversationId: cid, priority: command.priority ?? 'next' });
  console.log(
    `[messageQueueManager] enqueue conversationId=%s source=%s priority=%s depth=%d`,
    cid,
    command.source ?? '(none)',
    command.priority ?? 'next',
    bucket.length
  );
  notifySubscribers();
}

export function enqueuePendingNotification(command: QueuedCommand): void {
  const cid = command.conversationId.trim();
  if (!cid) {
    console.warn('[messageQueueManager] enqueuePendingNotification skipped: empty conversationId');
    return;
  }
  const bucket = getBucket(cid);
  bucket.push({ ...command, conversationId: cid, priority: command.priority ?? 'later' });
  console.log(
    `[messageQueueManager] enqueuePendingNotification conversationId=%s source=%s depth=%d`,
    cid,
    command.source ?? '(none)',
    bucket.length
  );
  notifySubscribers();
}

export function peek(conversationId: string): QueuedCommand | undefined {
  const bucket = getBucket(conversationId);
  const idx = findHighestPriorityIndex(bucket);
  if (idx < 0) return undefined;
  return bucket[idx];
}

export function dequeue(conversationId: string): QueuedCommand | undefined {
  const bucket = getBucket(conversationId);
  const idx = findHighestPriorityIndex(bucket);
  if (idx < 0) return undefined;
  const [cmd] = bucket.splice(idx, 1);
  console.log(
    `[messageQueueManager] dequeue conversationId=%s source=%s remaining=%d`,
    conversationId,
    cmd?.source ?? '(none)',
    bucket.length
  );
  notifySubscribers();
  return cmd;
}

export function clearCommandQueue(conversationId?: string): void {
  if (conversationId !== undefined) {
    getBucket(conversationId).length = 0;
    queues.delete(conversationId);
  } else {
    queues.clear();
  }
  notifySubscribers();
}

export function resetCommandQueue(): void {
  clearCommandQueue();
}

export function recheckCommandQueue(): void {
  if (hasCommandsInQueue()) notifySubscribers();
}
