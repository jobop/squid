import { WSClient, EventDispatcher, LoggerLevel, Domain } from '@larksuiteoapi/node-sdk';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { submitFeishuInboundToEventBridge } from './inbound-adapter';
import { feishuInboundDescribeRawPayload } from './inbound-debug';
import { parseFeishuImReceiveForInbound } from './message-inbound';
import type { FeishuChannelFileConfig } from './types';

export type FeishuWsInboundHandle = { stop: () => void };

/** SDK 拉取长连接网关配置时写死 timeout:15000，弱网下易失败；用独立 axios 实例抬升超时 */
const FEISHU_WS_GATEWAY_TIMEOUT_MS = 60_000;

function createFeishuWsHttpInstance() {
  const inst = axios.create();
  inst.interceptors.request.use((req: InternalAxiosRequestConfig) => {
    if (req.headers) {
      req.headers['User-Agent'] = 'oapi-node-sdk/1.0.0';
    }
    if (typeof req.timeout === 'number' && req.timeout < FEISHU_WS_GATEWAY_TIMEOUT_MS) {
      req.timeout = FEISHU_WS_GATEWAY_TIMEOUT_MS;
    } else if (req.timeout === undefined) {
      req.timeout = FEISHU_WS_GATEWAY_TIMEOUT_MS;
    }
    return req;
  }, undefined);
  inst.interceptors.response.use(
    (resp) => {
      if (resp.config['$return_headers']) {
        return { data: resp.data, headers: resp.headers };
      }
      return resp.data;
    },
    (err) => Promise.reject(err)
  );
  return inst;
}

let cachedFeishuWsHttp: ReturnType<typeof createFeishuWsHttpInstance> | null = null;
function getFeishuWsHttpInstance() {
  if (!cachedFeishuWsHttp) {
    cachedFeishuWsHttp = createFeishuWsHttpInstance();
  }
  return cachedFeishuWsHttp;
}

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
      console.log('[FeishuInbound][WS] 收到 im.message.receive_v1 回调');
      const payload = parseFeishuImReceiveForInbound(data);
      if (!payload) {
        console.warn(
          '[FeishuInbound][WS] 解析未通过（无有效文本或结构不符），',
          feishuInboundDescribeRawPayload(data)
        );
        return;
      }
      console.log(
        '[FeishuInbound][WS] 解析成功 → 投递总线 chatId=%s messageId=%s senderOpenId=%s textPreview=%s',
        payload.chatId ?? '(无)',
        payload.messageId ?? '(无)',
        payload.senderOpenId ?? '(无)',
        JSON.stringify(payload.text.slice(0, 80) + (payload.text.length > 80 ? '…' : ''))
      );
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

  const domain = resolveDomain(cfg);
  const domainLabel = cfg.feishuDomain === 'lark' ? 'lark（国际版 open.larksuite.com 系）' : 'feishu（国内 open.feishu.cn 系）';
  console.log(
    `[FeishuWS] 正在建立飞书事件长连接… 域=${domainLabel}；网关 HTTP 超时=${FEISHU_WS_GATEWAY_TIMEOUT_MS}ms。若反复 timeout：检查网络/代理/防火墙，或改 feishu-channel.json 中 feishuDomain 为 lark|feishu，或改用 connectionMode: webhook。`
  );

  const wsClient = new WSClient({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    domain,
    httpInstance: getFeishuWsHttpInstance(),
    loggerLevel: LoggerLevel.info,
    autoReconnect: true,
  });

  void wsClient.start({ eventDispatcher }).catch((err) => {
    console.error('[FeishuWS] 长连接启动失败:', err);
  });

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
