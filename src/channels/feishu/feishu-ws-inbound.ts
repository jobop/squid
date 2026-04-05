import { WSClient, EventDispatcher, LoggerLevel, Domain } from '@larksuiteoapi/node-sdk';
import { submitFeishuInboundToEventBridge } from './inbound-adapter';
import { parseFeishuImReceiveForInbound } from './message-inbound';
import type { FeishuChannelFileConfig } from './types';

export type FeishuWsInboundHandle = { stop: () => void };

function resolveDomain(cfg: FeishuChannelFileConfig): Domain | string {
  if (cfg.feishuDomain === 'lark') return Domain.Lark;
  return Domain.Feishu;
}

/**
 * 飞书事件订阅「长连接」：本机主动连飞书 WebSocket，无需公网 Webhook / 穿透。
 * 需在开放平台将事件接收方式设为长连接，并订阅 im.message.receive_v1。
 */
export function startFeishuWebSocketInbound(cfg: FeishuChannelFileConfig): FeishuWsInboundHandle {
  const eventDispatcher = new EventDispatcher({
    encryptKey: cfg.encryptKey?.trim() ?? '',
    verificationToken: cfg.verificationToken?.trim() ?? '',
    loggerLevel: LoggerLevel.info,
  });

  eventDispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      const payload = parseFeishuImReceiveForInbound(data);
      if (!payload) return;
      submitFeishuInboundToEventBridge({
        text: payload.text,
        chatId: payload.chatId,
        messageId: payload.messageId,
        senderOpenId: payload.senderOpenId,
        raw: payload.raw,
      });
    },
    'im.message.message_read_v1': async () => {},
  });

  const wsClient = new WSClient({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    domain: resolveDomain(cfg),
    loggerLevel: LoggerLevel.info,
    autoReconnect: true,
  });

  void wsClient.start({ eventDispatcher }).catch((err) => {
    console.error('[FeishuWS] 长连接启动失败:', err);
  });

  console.log('[FeishuWS] 正在建立飞书事件长连接（WebSocket）…');

  return {
    stop: () => {
      try {
        wsClient.close();
        console.log('[FeishuWS] 长连接已关闭');
      } catch (e) {
        console.error('[FeishuWS] close 异常:', e);
      }
    },
  };
}
