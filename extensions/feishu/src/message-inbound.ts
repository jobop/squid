import { parseJsonObject } from './webhook-security';
import type { FeishuInboundAdapterPayload } from './types';

export function parseTextFromFeishuContent(contentJson: string): string | null {
  const o = parseJsonObject(contentJson);
  if (!o) return null;
  const text = o.text;
  return typeof text === 'string' ? text : null;
}

/** 从 post 类型消息的 content JSON 中抽取可读文本（富文本/多段） */
function parseTextFromFeishuPostContent(contentJson: string): string | null {
  const o = parseJsonObject(contentJson);
  if (!o) return null;
  const parts: string[] = [];
  if (typeof o.title === 'string' && o.title.trim()) {
    parts.push(o.title.trim());
  }
  const rows = o.content;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (!cell || typeof cell !== 'object') continue;
        const c = cell as Record<string, unknown>;
        if (c.tag === 'text' && typeof c.text === 'string' && c.text.trim()) {
          parts.push(c.text.trim());
        }
      }
    }
  }
  const joined = parts.join('\n').trim();
  return joined || null;
}

/**
 * 按 message_type 从 message.content 取入站展示文本（text / post；其它类型忽略）
 */
export function extractInboundTextFromFeishuMessage(message: Record<string, unknown>): string | null {
  const mt = message.message_type;
  const contentStr = message.content;
  if (typeof contentStr !== 'string') return null;

  if (mt === 'text' || mt === undefined) {
    const t = parseTextFromFeishuContent(contentStr);
    if (t) return t;
    if (mt === undefined) {
      return parseTextFromFeishuPostContent(contentStr);
    }
    return null;
  }

  if (mt === 'post') {
    return parseTextFromFeishuPostContent(contentStr);
  }

  return null;
}

function extractInboundMediaFromFeishuMessage(message: Record<string, unknown>): NonNullable<FeishuInboundAdapterPayload['media']> {
  const mt = String(message.message_type || '').trim();
  const contentStr = message.content;
  if (typeof contentStr !== 'string') return [];
  const content = parseJsonObject(contentStr);
  if (!content) return [];

  if (mt === 'image') {
    const key = typeof content.image_key === 'string' ? content.image_key.trim() : '';
    if (!key) return [];
    return [{ kind: 'image', resourceKey: key }];
  }

  if (mt === 'file') {
    const key = typeof content.file_key === 'string' ? content.file_key.trim() : '';
    const fileName = typeof content.file_name === 'string' ? content.file_name : undefined;
    const mimeType = typeof content.mime_type === 'string' ? content.mime_type : undefined;
    if (!key) return [];
    return [{ kind: 'file', resourceKey: key, fileName, mimeType }];
  }

  return [];
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
  } else {
    // 长连接 SDK：摊平后根上有 event_type；不要用 body.type 过滤（载荷里常有其它语义 type，易误杀）
    const et = typeof body.event_type === 'string' ? body.event_type : undefined;
    if (et !== undefined && et !== 'im.message.receive_v1') {
      return null;
    }
  }

  const message = body.message as Record<string, unknown> | undefined;
  const sender = body.sender as Record<string, unknown> | undefined;
  if (!message || !sender) return null;
  if (sender.sender_type === 'app') return null;

  const text = extractInboundTextFromFeishuMessage(message);
  const media = extractInboundMediaFromFeishuMessage(message);
  if (!text && media.length === 0) {
    if (process.env.FEISHU_DEBUG_INBOUND === '1') {
      console.warn(
        '[FeishuInbound] 无法从 message 解析文本/媒体，message_type=',
        message.message_type,
        'keys=',
        Object.keys(message)
      );
    }
    return null;
  }

  const senderId = sender.sender_id as Record<string, unknown> | undefined;
  const openId =
    senderId && typeof senderId.open_id === 'string' ? senderId.open_id : undefined;

  return {
    text: text ?? '',
    chatId: typeof message.chat_id === 'string' ? message.chat_id : undefined,
    messageId: typeof message.message_id === 'string' ? message.message_id : undefined,
    senderOpenId: openId,
    media,
    raw: body as Record<string, unknown>,
  };
}
