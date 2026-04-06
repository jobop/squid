import { feishuInboundTextPreview } from './inbound-debug';
import { getFeishuExtensionEventBridge } from './feishu-host-bridge';
import type { FeishuInboundAdapterPayload } from './types';
import { recordFeishuInboundChat } from './last-inbound-chat';

/**
 * 飞书入站 Adapter 单一入口：验签/解密通过后仅应调用此函数投递事件总线。
 */
export function submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload): void {
  console.log(
    '[FeishuInbound] emit channel:inbound chatId=%s messageId=%s text=%s',
    payload.chatId?.trim() || '(无)',
    payload.messageId?.trim() || '(无)',
    JSON.stringify(feishuInboundTextPreview(payload.text ?? '', 160))
  );
  if (payload.chatId?.trim()) {
    recordFeishuInboundChat(payload.chatId, 'chat_id');
  }
  getFeishuExtensionEventBridge().emitChannelInbound({
    channelId: 'feishu',
    text: payload.text,
    chatId: payload.chatId,
    messageId: payload.messageId,
    senderOpenId: payload.senderOpenId,
    accountId: payload.accountId,
    raw: payload.raw,
  });
}
