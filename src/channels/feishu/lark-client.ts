import type { FeishuChannelFileConfig, FeishuReceiveIdType } from './types';

const TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal';
const MESSAGES_URL = 'https://open.feishu.cn/open-apis/im/v1/messages';

type TokenCache = { token: string; expiresAtMs: number };
let tokenCache: TokenCache | null = null;

/** 测试用：清空内存中的 tenant token */
export function clearFeishuTenantTokenCache(): void {
  tokenCache = null;
}

export async function getTenantAccessToken(
  cfg: Pick<FeishuChannelFileConfig, 'appId' | 'appSecret'>,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; token: string } | { ok: false; error: string; status?: number }> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 30_000) {
    return { ok: true, token: tokenCache.token };
  }

  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: cfg.appId,
      app_secret: cfg.appSecret,
    }),
  });

  const status = res.status;
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: '解析 token 响应失败', status };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: typeof body.msg === 'string' ? body.msg : `HTTP ${status}`,
      status,
    };
  }

  const code = body.code;
  if (code !== 0 && code !== undefined) {
    return {
      ok: false,
      error: typeof body.msg === 'string' ? body.msg : `业务码 ${String(code)}`,
      status,
    };
  }

  const token = body.tenant_access_token;
  if (typeof token !== 'string' || !token) {
    return { ok: false, error: '响应缺少 tenant_access_token', status };
  }

  const expireSec = typeof body.expire === 'number' ? body.expire : 7200;
  tokenCache = {
    token,
    expiresAtMs: now + Math.max(60, expireSec - 120) * 1000,
  };

  return { ok: true, token };
}

export async function sendFeishuTextMessageTo(
  cfg: FeishuChannelFileConfig,
  text: string,
  receiveId: string,
  receiveIdType: FeishuReceiveIdType = 'chat_id',
  fetchImpl: typeof fetch = fetch
): Promise<{ success: true } | { success: false; error: string }> {
  const tokenRes = await getTenantAccessToken(cfg, fetchImpl);
  if (!tokenRes.ok) {
    return { success: false, error: tokenRes.error };
  }

  const rid = receiveId.trim();
  if (!rid) {
    return { success: false, error: 'receiveId 为空' };
  }

  const url = `${MESSAGES_URL}?receive_id_type=${encodeURIComponent(receiveIdType)}`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenRes.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: rid,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { success: false, error: '解析发消息响应失败' };
  }

  if (!res.ok) {
    return {
      success: false,
      error: typeof body.msg === 'string' ? body.msg : `HTTP ${res.status}`,
    };
  }

  if (body.code !== 0 && body.code !== undefined) {
    return {
      success: false,
      error: typeof body.msg === 'string' ? body.msg : `业务码 ${String(body.code)}`,
    };
  }

  return { success: true };
}

export async function sendFeishuTextMessage(
  cfg: FeishuChannelFileConfig,
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ success: true } | { success: false; error: string }> {
  const receiveId = cfg.defaultReceiveId?.trim();
  const receiveIdType = cfg.defaultReceiveIdType ?? 'chat_id';
  if (!receiveId) {
    return { success: false, error: '未配置 defaultReceiveId' };
  }
  return sendFeishuTextMessageTo(cfg, text, receiveId, receiveIdType, fetchImpl);
}
