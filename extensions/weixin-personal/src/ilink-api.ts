import { randomBytes } from 'node:crypto';
import {
  ILINK_APP_CLIENT_VERSION,
  ILINK_APP_ID,
  WEIXIN_SQUID_CHANNEL_VERSION,
} from './ilink-constants';
import type { GetUpdatesResp, SendMessageReq } from './ilink-types';
import { MessageItemType, MessageState, MessageType } from './ilink-types';

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function randomWechatUin(): string {
  const uint32 = randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function buildCommonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': ILINK_APP_ID,
    'iLink-App-ClientVersion': String(ILINK_APP_CLIENT_VERSION),
  };
}

function buildBaseInfo(): { channel_version?: string } {
  return { channel_version: WEIXIN_SQUID_CHANNEL_VERSION };
}

function buildHeaders(opts: { token?: string; body: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    AuthorizationType: 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(opts.body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
    ...buildCommonHeaders(),
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }
  return headers;
}

async function apiPostFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
  label: string;
  /** 与宿主 cleanup 共用：扩展卸载时立即中断 in-flight 请求，避免 cleanup 卡在长轮询上 */
  externalAbort?: AbortSignal;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildHeaders({ token: params.token, body: params.body });
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), params.timeoutMs);
  const ext = params.externalAbort;
  const onExtAbort = () => controller.abort();
  if (ext) {
    if (ext.aborted) controller.abort();
    else ext.addEventListener('abort', onExtAbort, { once: true });
  }
  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: hdrs,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(t);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    clearTimeout(t);
    throw err;
  } finally {
    ext?.removeEventListener('abort', onExtAbort);
  }
}

export async function ilinkGetUpdates(params: {
  baseUrl: string;
  token?: string;
  get_updates_buf: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<GetUpdatesResp> {
  const timeout = params.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiPostFetch({
      baseUrl: params.baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: JSON.stringify({
        get_updates_buf: params.get_updates_buf ?? '',
        base_info: buildBaseInfo(),
      }),
      token: params.token,
      timeoutMs: timeout,
      label: 'getUpdates',
      externalAbort: params.signal,
    });
    return JSON.parse(rawText) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ret: 0, msgs: [], get_updates_buf: params.get_updates_buf };
    }
    throw err;
  }
}

function generateClientId(): string {
  return `squid-wx-${randomBytes(8).toString('hex')}`;
}

export async function ilinkSendTextMessage(params: {
  baseUrl: string;
  token: string;
  toUserId: string;
  text: string;
  contextToken?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const clientId = generateClientId();
    const body: SendMessageReq = {
      msg: {
        from_user_id: '',
        to_user_id: params.toUserId,
        client_id: clientId,
        message_type: MessageType.BOT,
        message_state: MessageState.FINISH,
        item_list: params.text.trim()
          ? [{ type: MessageItemType.TEXT, text_item: { text: params.text } }]
          : undefined,
        context_token: params.contextToken,
      },
    };
    await apiPostFetch({
      baseUrl: params.baseUrl,
      endpoint: 'ilink/bot/sendmessage',
      body: JSON.stringify({ ...body, base_info: buildBaseInfo() }),
      token: params.token,
      timeoutMs: DEFAULT_API_TIMEOUT_MS,
      label: 'sendMessage',
    });
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** 会话过期等（与 openclaw-weixin session-guard 常见值一致） */
export const SESSION_EXPIRED_ERRCODE = -14;

/**
 * GET（扫码登录用，无 Bearer）
 */
export async function ilinkApiGet(params: {
  baseUrl: string;
  endpoint: string;
  timeoutMs?: number;
  label: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base);
  const hdrs = buildCommonHeaders();
  const timeoutMs = params.timeoutMs;
  const controller =
    timeoutMs != null && timeoutMs > 0 ? new AbortController() : undefined;
  const t =
    controller != null && timeoutMs != null
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined;
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: hdrs,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (t !== undefined) clearTimeout(t);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${params.label} ${res.status}: ${rawText}`);
    }
    return rawText;
  } catch (err) {
    if (t !== undefined) clearTimeout(t);
    throw err;
  }
}
