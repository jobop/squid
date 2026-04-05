import { eventBridge } from '../bridge/event-bridge';
import type { FeishuInboundAdapterPayload } from './types';

/**
 * 飞书入站 Adapter 单一入口：验签/解密通过后仅应调用此函数投递事件总线。
 */
export function submitFeishuInboundToEventBridge(payload: FeishuInboundAdapterPayload): void {
  eventBridge.emitChannelInbound({
    channelId: 'feishu',
    text: payload.text,
    chatId: payload.chatId,
    messageId: payload.messageId,
    senderOpenId: payload.senderOpenId,
    accountId: payload.accountId,
    raw: payload.raw,
  });
}
