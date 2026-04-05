import { parseJsonObject } from './webhook-security';
import type { FeishuInboundAdapterPayload } from './types';

export function parseTextFromFeishuContent(contentJson: string): string | null {
  const o = parseJsonObject(contentJson);
  if (!o) return null;
  const text = o.text;
  return typeof text === 'string' ? text : null;
}

/**
 * 统一解析 im.message.receive_v1（HTTP 2.0 整包 / 仅 event 体 / 长连接 SDK 回调）
 */
export function parseFeishuImReceiveForInbound(data: unknown): FeishuInboundAdapterPayload | null {
  if (!data || typeof data !== 'object') return null;
  let body = data as Record<string, unknown>;

  const header = body.header as Record<string, unknown> | undefined;
  if (header && typeof body.event === 'object' && body.event !== null) {
    if (header.event_type !== 'im.message.receive_v1') return null;
    body = body.event as Record<string, unknown>;
  }

  const message = body.message as Record<string, unknown> | undefined;
  const sender = body.sender as Record<string, unknown> | undefined;
  if (!message || !sender) return null;
  if (sender.sender_type === 'app') return null;

  const mt = message.message_type;
  if (mt !== undefined && mt !== 'text') return null;

  const contentStr = message.content;
  if (typeof contentStr !== 'string') return null;
  const text = parseTextFromFeishuContent(contentStr);
  if (!text) return null;

  const senderId = sender.sender_id as Record<string, unknown> | undefined;
  const openId =
    senderId && typeof senderId.open_id === 'string' ? senderId.open_id : undefined;

  return {
    text,
    chatId: typeof message.chat_id === 'string' ? message.chat_id : undefined,
    messageId: typeof message.message_id === 'string' ? message.message_id : undefined,
    senderOpenId: openId,
    raw: body as Record<string, unknown>,
  };
}
