/**
 * 飞书 Channel — 配置与入站载荷类型（P0）
 */

export type FeishuReceiveIdType = 'chat_id' | 'open_id' | 'user_id' | 'union_id';

/** 默认 `websocket`：本机长连接连飞书，无需公网 URL；`webhook` 为可选兼容 */
export type FeishuConnectionMode = 'websocket' | 'webhook';

export interface FeishuChannelFileConfig {
  appId: string;
  appSecret: string;
  connectionMode?: FeishuConnectionMode;
  /** 国际版 Lark 选 `lark`，国内飞书默认 `feishu` */
  feishuDomain?: 'feishu' | 'lark';
  /** 事件订阅 Encrypt Key；配置后 Webhook 将校验签名并对 encrypt 字段解密 */
  encryptKey?: string;
  /** 事件订阅 Verification Token（URL 验证等可选校验） */
  verificationToken?: string;
  /** 出站默认接收方（如群 chat_id） */
  defaultReceiveId?: string;
  defaultReceiveIdType?: FeishuReceiveIdType;
}

/**
 * Adapter 入站 API 载荷（投递 EventBridge 前统一形状）
 */
export interface FeishuInboundAdapterPayload {
  text: string;
  chatId?: string;
  messageId?: string;
  senderOpenId?: string;
  accountId?: string;
  raw?: Record<string, unknown>;
}
