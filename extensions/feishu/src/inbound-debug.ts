/** 飞书入站排查用日志（不含敏感正文全量，仅预览） */

export function feishuInboundTextPreview(s: string, max = 120): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (!t) return '(空)';
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** 解析失败时打印载荷形状，便于对照开放平台文档 */
export function feishuInboundDescribeRawPayload(data: unknown): string {
  if (data == null) return 'payload=null';
  if (typeof data !== 'object') return `payload=${typeof data}`;
  const o = data as Record<string, unknown>;
  const keys = Object.keys(o);
  const et = o.event_type ?? o.type;
  const msg = o.message as Record<string, unknown> | undefined;
  const mt = msg?.message_type;
  const st = (o.sender as Record<string, unknown> | undefined)?.sender_type;
  return `rootKeys=[${keys.slice(0, 28).join(',')}${keys.length > 28 ? '…' : ''}] event_type|type=${String(et)} message_type=${String(mt)} sender_type=${String(st)}`;
}
