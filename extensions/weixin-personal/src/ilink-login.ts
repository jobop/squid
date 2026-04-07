/**
 * 扫码登录（逻辑参考 @tencent-weixin/openclaw-weixin src/auth/login-qr.ts，MIT）
 */
import { randomUUID } from 'node:crypto';
import { saveWeixinPersonalChannelConfigSync } from './config-store';
import type { WeixinPersonalChannelFileConfig } from './types';
import { ilinkApiGet } from './ilink-api';

const FIXED_QR_BASE = 'https://ilinkai.weixin.qq.com';
const DEFAULT_ILINK_BOT_TYPE = '3';
const QR_LONG_POLL_TIMEOUT_MS = 35_000;
const ACTIVE_LOGIN_TTL_MS = 5 * 60_000;
const MAX_QR_REFRESH_COUNT = 3;
const DEFAULT_LOGIN_DEADLINE_MS = 480_000;

type ActiveLogin = {
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  deadline: number;
  qrRefreshCount: number;
  currentApiBaseUrl?: string;
};

const activeLogins = new Map<string, ActiveLogin>();

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

function firstNonEmptyString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/**
 * 腾讯 iLink 各环境返回结构可能为扁平或包在 data/result 下，且存在 scanned / scaned 等拼写差异。
 */
function parseQrcodeStatusJson(raw: string): StatusResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[WeixinPersonal] get_qrcode_status 非 JSON，前 200 字:', raw.slice(0, 200));
    return { status: 'wait' };
  }

  const root =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  let merged: Record<string, unknown> = { ...root };
  const mergeNested = (key: string) => {
    const v = root[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      merged = { ...merged, ...(v as Record<string, unknown>) };
    }
  };
  mergeNested('data');
  mergeNested('result');
  mergeNested('info');

  const errRaw = merged.errcode ?? merged.ret ?? merged.error_code;
  if (typeof errRaw === 'number' && errRaw !== 0) {
    const em = firstNonEmptyString(merged, ['errmsg', 'err_msg', 'message']) ?? String(errRaw);
    console.warn('[WeixinPersonal] get_qrcode_status errcode=', errRaw, em);
  }

  const statusStr =
    firstNonEmptyString(merged, [
      'status',
      'login_status',
      'qr_status',
      'state',
      'scan_status',
      'qrcode_status',
    ]) ?? '';
  const sl = statusStr.toLowerCase().replace(/-/g, '_');

  const map: Record<string, StatusResponse['status']> = {
    wait: 'wait',
    waiting: 'wait',
    pending: 'wait',
    scaned: 'scaned',
    scanned: 'scaned',
    scan: 'scaned',
    confirmed: 'confirmed',
    confirm: 'confirmed',
    success: 'confirmed',
    ok: 'confirmed',
    expired: 'expired',
    timeout: 'expired',
    scaned_but_redirect: 'scaned_but_redirect',
    redirect: 'scaned_but_redirect',
  };

  let status = statusStr ? map[sl] : undefined;
  if (statusStr && !status) {
    console.warn(
      '[WeixinPersonal] get_qrcode_status 未识别 status=',
      JSON.stringify(statusStr),
      'body 前 400 字:',
      raw.slice(0, 400)
    );
    status = 'wait';
  }
  if (!status) status = 'wait';

  return {
    status,
    bot_token: firstNonEmptyString(merged, ['bot_token', 'ilink_bot_token', 'access_token']),
    ilink_bot_id: firstNonEmptyString(merged, ['ilink_bot_id', 'bot_id', 'ilinkBotId']),
    baseurl: firstNonEmptyString(merged, ['baseurl', 'base_url', 'baseUrl', 'api_base_url']),
    ilink_user_id: firstNonEmptyString(merged, ['ilink_user_id', 'user_id']),
    redirect_host: firstNonEmptyString(merged, ['redirect_host', 'redirectHost']),
  };
}

function isLoginFresh(login: ActiveLogin): boolean {
  return Date.now() - login.startedAt < ACTIVE_LOGIN_TTL_MS;
}

function purgeExpiredLogins(): void {
  for (const [id, login] of activeLogins) {
    if (!isLoginFresh(login)) activeLogins.delete(id);
  }
}

async function fetchQRCode(botType: string): Promise<QRCodeResponse> {
  const raw = await ilinkApiGet({
    baseUrl: FIXED_QR_BASE,
    endpoint: `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(botType)}`,
    label: 'fetchQRCode',
  });
  return JSON.parse(raw) as QRCodeResponse;
}

async function pollQRStatus(apiBaseUrl: string, qrcode: string): Promise<StatusResponse> {
  try {
    const raw = await ilinkApiGet({
      baseUrl: apiBaseUrl,
      endpoint: `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      timeoutMs: QR_LONG_POLL_TIMEOUT_MS,
      label: 'pollQRStatus',
    });
    return parseQrcodeStatusJson(raw);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' };
    }
    console.warn('[WeixinPersonal] pollQRStatus 网络错误，将重试:', err);
    return { status: 'wait' };
  }
}

export type WeixinQrStartResult = {
  qrcodeUrl?: string;
  message: string;
  sessionKey: string;
};

export async function startWeixinPersonalQrLogin(sessionKey?: string): Promise<WeixinQrStartResult> {
  purgeExpiredLogins();
  const key = sessionKey?.trim() || randomUUID();
  const existing = activeLogins.get(key);
  if (existing && isLoginFresh(existing) && existing.qrcodeUrl) {
    return {
      qrcodeUrl: existing.qrcodeUrl,
      message: '认证链接已就绪，请使用微信打开。',
      sessionKey: key,
    };
  }
  try {
    const qrResponse = await fetchQRCode(DEFAULT_ILINK_BOT_TYPE);
    const login: ActiveLogin = {
      sessionKey: key,
      qrcode: qrResponse.qrcode,
      qrcodeUrl: qrResponse.qrcode_img_content,
      startedAt: Date.now(),
      deadline: Date.now() + DEFAULT_LOGIN_DEADLINE_MS,
      qrRefreshCount: 1,
    };
    activeLogins.set(key, login);
    console.log('\n[WeixinPersonal] 请使用微信扫描以下链接完成登录:\n');
    console.log(qrResponse.qrcode_img_content);
    console.log('');
    return {
      qrcodeUrl: qrResponse.qrcode_img_content,
      message: '请使用微信打开控制台中的认证链接完成验证。',
      sessionKey: key,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { message: `发起登录失败: ${msg}`, sessionKey: key };
  }
}

export type WeixinQrPollResult = {
  status: 'pending' | 'success' | 'failed';
  message?: string;
  /** 刷新会话时的认证链接（与二维码图内容一致） */
  authUrl?: string;
};

/**
 * 单次推进扫码登录（供配置页轮询）；成功时写入 ~/.squid/weixin-personal-channel.json
 */
export async function pollWeixinPersonalQrLoginOnce(
  sessionKey: string,
  opts?: { silent?: boolean }
): Promise<WeixinQrPollResult> {
  const silent = Boolean(opts?.silent);
  const sk = sessionKey.trim();
  const activeLogin = activeLogins.get(sk);
  if (!activeLogin) {
    return { status: 'failed', message: '没有进行中的认证会话，请先获取认证链接。' };
  }
  if (!isLoginFresh(activeLogin)) {
    activeLogins.delete(sk);
    return { status: 'failed', message: '认证链接已过期，请重新开始。' };
  }
  if (Date.now() > activeLogin.deadline) {
    activeLogins.delete(sk);
    return { status: 'failed', message: '登录超时，请重试。' };
  }

  const currentBaseUrl = activeLogin.currentApiBaseUrl ?? FIXED_QR_BASE;
  const statusResponse = await pollQRStatus(currentBaseUrl, activeLogin.qrcode);

  switch (statusResponse.status) {
    case 'wait':
      return { status: 'pending', message: '等待扫码或请在手机上确认…' };
    case 'scaned':
      if (!silent) process.stdout.write('.');
      return { status: 'pending', message: '已扫码，请在手机上确认…' };
    case 'scaned_but_redirect': {
      const host = statusResponse.redirect_host;
      if (host) {
        activeLogin.currentApiBaseUrl = `https://${host}`;
        if (!silent) console.log(`\n[WeixinPersonal] IDC 调度，轮询切换到 ${host}`);
      }
      return { status: 'pending', message: '正在切换服务节点，请稍候…' };
    }
    case 'expired': {
      activeLogin.qrRefreshCount += 1;
      if (activeLogin.qrRefreshCount > MAX_QR_REFRESH_COUNT) {
        activeLogins.delete(sk);
        return { status: 'failed', message: '认证链接多次过期，请重新开始登录。' };
      }
      try {
        const qrResponse = await fetchQRCode(DEFAULT_ILINK_BOT_TYPE);
        activeLogin.qrcode = qrResponse.qrcode;
        activeLogin.qrcodeUrl = qrResponse.qrcode_img_content;
        activeLogin.startedAt = Date.now();
        if (!silent) {
          console.log('\n[WeixinPersonal] 新二维码:', qrResponse.qrcode_img_content, '\n');
        }
        return {
          status: 'pending',
          message: '认证链接已刷新，请重新打开或扫码。',
          authUrl: qrResponse.qrcode_img_content,
        };
      } catch (e) {
        activeLogins.delete(sk);
        const msg = e instanceof Error ? e.message : String(e);
        return { status: 'failed', message: `刷新认证链接失败: ${msg}` };
      }
    }
    case 'confirmed': {
      if (!statusResponse.ilink_bot_id || !statusResponse.bot_token) {
        activeLogins.delete(sk);
        return { status: 'failed', message: '登录确认但服务器未返回完整凭证。' };
      }
      activeLogins.delete(sk);
      const baseUrl = statusResponse.baseurl?.trim();
      if (!baseUrl) {
        return { status: 'failed', message: '登录成功但未返回 baseUrl，无法调用消息 API。' };
      }
      const cfg: WeixinPersonalChannelFileConfig = {
        botToken: statusResponse.bot_token,
        baseUrl,
        ilinkAccountId: statusResponse.ilink_bot_id,
      };
      saveWeixinPersonalChannelConfigSync(cfg);
      if (!silent) {
        console.log('\n[WeixinPersonal] 已保存 ~/.squid/weixin-personal-channel.json\n');
      }
      return { status: 'success', message: '与微信连接成功，凭证已保存。' };
    }
    default:
      return { status: 'pending', message: '等待微信侧状态…' };
  }
}

export type WeixinQrWaitResult = {
  connected: boolean;
  message: string;
};

export async function waitWeixinPersonalQrLogin(opts: {
  sessionKey: string;
  timeoutMs?: number;
}): Promise<WeixinQrWaitResult> {
  const timeoutMs = Math.max(opts.timeoutMs ?? DEFAULT_LOGIN_DEADLINE_MS, 1000);
  const deadline = Date.now() + timeoutMs;
  const login = activeLogins.get(opts.sessionKey);
  if (login) {
    login.deadline = Math.min(login.deadline, deadline);
    login.currentApiBaseUrl = login.currentApiBaseUrl ?? FIXED_QR_BASE;
  }

  while (Date.now() < deadline) {
    const r = await pollWeixinPersonalQrLoginOnce(opts.sessionKey, { silent: false });
    if (r.status === 'success') {
      return { connected: true, message: r.message ?? '与微信连接成功。' };
    }
    if (r.status === 'failed') {
      return { connected: false, message: r.message ?? '登录失败' };
    }
    await new Promise((r2) => setTimeout(r2, 1000));
  }

  activeLogins.delete(opts.sessionKey);
  return { connected: false, message: '登录超时，请重试。' };
}
