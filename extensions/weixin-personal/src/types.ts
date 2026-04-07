/** ~/.squid/weixin-personal-channel.json */
export interface WeixinPersonalChannelFileConfig {
  /** iLink bot token (Bearer 值，不含前缀) */
  botToken?: string;
  /** 消息 API 根 URL，登录后由服务端返回 */
  baseUrl?: string;
  /** 可选：ilink bot id，展示用 */
  ilinkAccountId?: string;
  /** 仅处理这些用户 id（如 xxx@im.wechat）；空则处理全部 */
  allowedUserIds?: string[];
}
