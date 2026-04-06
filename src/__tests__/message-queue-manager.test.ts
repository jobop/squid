import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearCommandQueue,
  dequeue,
  enqueue,
  enqueuePendingNotification,
  getConversationQueueLength,
  peek,
} from '../utils/messageQueueManager';

describe('messageQueueManager (per-conversation)', () => {
  beforeEach(() => {
    clearCommandQueue();
  });

  it('同一会话内 later 让位于 next', () => {
    const cid = 'conv-a';
    enqueuePendingNotification({
      conversationId: cid,
      value: 'later-1',
      source: 'cron',
    });
    enqueue({
      conversationId: cid,
      value: 'next-1',
      source: 'user',
    });
    expect(peek(cid)?.value).toBe('next-1');
    expect(dequeue(cid)?.value).toBe('next-1');
    expect(dequeue(cid)?.value).toBe('later-1');
  });

  it('不同会话互不阻塞（独立深度）', () => {
    enqueue({ conversationId: 'a', value: '1', source: 'user' });
    enqueue({ conversationId: 'b', value: '2', source: 'user' });
    expect(getConversationQueueLength('a')).toBe(1);
    expect(getConversationQueueLength('b')).toBe(1);
    expect(dequeue('a')?.value).toBe('1');
    expect(dequeue('b')?.value).toBe('2');
  });
});
