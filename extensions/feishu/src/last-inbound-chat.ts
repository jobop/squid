import type { FeishuReceiveIdType } from './types';

/** 最近一次飞书入站会话，用于未配置 defaultReceiveId 时的出站回退 */
let last: { receiveId: string; receiveIdType: FeishuReceiveIdType } | null = null;

export function recordFeishuInboundChat(
  chatId: string,
  receiveIdType: FeishuReceiveIdType = 'chat_id'
): void {
  const id = chatId.trim();
  if (!id) return;
  last = { receiveId: id, receiveIdType };
}

export function getFeishuLastInboundReceiveTarget(): {
  receiveId: string;
  receiveIdType: FeishuReceiveIdType;
} | null {
  return last;
}

/** 测试用 */
export function clearFeishuLastInboundReceiveTarget(): void {
  last = null;
}
