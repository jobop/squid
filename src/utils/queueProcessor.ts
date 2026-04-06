/**
 * 会话级 drain：与 claude-code-main processQueueIfReady 对齐，每次最多执行一条队列命令。
 */

import type { TaskAPI } from '../api/task-api';
import { dequeue } from './messageQueueManager';

/**
 * 若该会话空闲且队列非空，出队一条并交给 TaskAPI 执行（executeTaskStream）。
 * 执行完成后 TaskAPI 的 finally 会再次调用本函数，形成链式 drain。
 */
export async function processConversationQueueIfReady(
  api: TaskAPI,
  conversationId: string
): Promise<void> {
  if (api.isConversationBusy(conversationId)) {
    return;
  }
  const cmd = dequeue(conversationId);
  if (!cmd) {
    return;
  }
  try {
    await api.runFromQueue(cmd);
  } catch (err) {
    console.error(
      `[queueProcessor] runFromQueue failed conversationId=%s:`,
      conversationId,
      err
    );
    await processConversationQueueIfReady(api, conversationId);
  }
}
