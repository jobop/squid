/**
 * 与 @tencent-weixin/openclaw-weixin 对齐的 iLink 客户端标识（见该包 package.json / api.ts）。
 */
export const ILINK_APP_ID = 'bot';

/** squid 扩展自有版本号，写入每条请求的 base_info.channel_version */
export const WEIXIN_SQUID_CHANNEL_VERSION = '1.0.0';

function buildClientVersion(version: string): number {
  const parts = version.split('.').map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

export const ILINK_APP_CLIENT_VERSION = buildClientVersion(WEIXIN_SQUID_CHANNEL_VERSION);
