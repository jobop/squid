/**
 * 扩展配置页 Auth 链接认证：校验 manifest + 调用已加载插件的 extensionWebAuth。
 */
import type { ChannelRegistry } from './registry';
import type { ChannelWebConfigForm } from './extensions/types';
import type { ChannelPlugin } from './types';

/** 配置页 Auth 进行中时跳过热重载，避免 unload 导致轮询 503、内存会话与注册表脱节 */
const extensionAuthPendingUntil = new Map<string, number>();
const DEFAULT_AUTH_PENDING_TTL_MS = 15 * 60_000;

export function markExtensionAuthPending(channelId: string, ttlMs = DEFAULT_AUTH_PENDING_TTL_MS): void {
  const id = channelId.trim();
  if (!id) return;
  extensionAuthPendingUntil.set(id, Date.now() + ttlMs);
}

export function clearExtensionAuthPending(channelId: string): void {
  extensionAuthPendingUntil.delete(channelId.trim());
}

export function hasExtensionAuthPending(): boolean {
  const now = Date.now();
  for (const [id, until] of [...extensionAuthPendingUntil.entries()]) {
    if (until <= now) extensionAuthPendingUntil.delete(id);
  }
  return extensionAuthPendingUntil.size > 0;
}

export function isAuthLinkAuthUi(form: ChannelWebConfigForm | null | undefined): boolean {
  return form?.authUi?.type === 'auth_link';
}

export async function runExtensionAuthStart(params: {
  channelId: string;
  form: ChannelWebConfigForm | null;
  registry: ChannelRegistry;
}): Promise<
  | { ok: true; authUrl: string; sessionKey: string }
  | { ok: false; error: string; status: number }
> {
  const { channelId, form, registry } = params;
  if (!channelId.trim()) {
    return { ok: false, error: '缺少 channelId', status: 400 };
  }
  if (!isAuthLinkAuthUi(form)) {
    return { ok: false, error: '该渠道未声明 Auth 链接认证（configForm.authUi.type=auth_link）', status: 400 };
  }
  const plugin = registry.get(channelId) as ChannelPlugin | undefined;
  if (!plugin) {
    return {
      ok: false,
      error: '扩展未加载，请先在「渠道扩展」中启用该扩展后重试',
      status: 503,
    };
  }
  const auth = plugin.extensionWebAuth;
  if (!auth) {
    return { ok: false, error: '该渠道未实现 extensionWebAuth', status: 503 };
  }
  try {
    const { authUrl, sessionKey } = await auth.startAuthLink();
    const url = authUrl?.trim() ?? '';
    const sk = sessionKey?.trim() ?? '';
    if (!url) {
      return { ok: false, error: '未获取到认证链接', status: 502 };
    }
    if (!sk) {
      return { ok: false, error: '未获取到 sessionKey', status: 502 };
    }
    markExtensionAuthPending(channelId);
    return { ok: true, authUrl: url, sessionKey: sk };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 502 };
  }
}

export async function runExtensionAuthPoll(params: {
  channelId: string;
  sessionKey: string;
  form: ChannelWebConfigForm | null;
  registry: ChannelRegistry;
}): Promise<
  | { ok: true; status: 'pending' | 'success' | 'failed'; message?: string; authUrl?: string }
  | { ok: false; error: string; status: number }
> {
  const { channelId, sessionKey, form, registry } = params;
  const sk = sessionKey?.trim() ?? '';
  if (!channelId.trim() || !sk) {
    return { ok: false, error: '缺少 channelId 或 sessionKey', status: 400 };
  }
  if (!isAuthLinkAuthUi(form)) {
    return { ok: false, error: '该渠道未声明 Auth 链接认证', status: 400 };
  }
  const plugin = registry.get(channelId) as ChannelPlugin | undefined;
  if (!plugin?.extensionWebAuth) {
    clearExtensionAuthPending(channelId);
    return { ok: false, error: '扩展未加载或未实现 extensionWebAuth', status: 503 };
  }
  try {
    const r = await plugin.extensionWebAuth.pollAuthLogin(sk);
    if (r.status === 'success' || r.status === 'failed') {
      clearExtensionAuthPending(channelId);
    }
    return {
      ok: true,
      status: r.status,
      message: r.message,
      authUrl: r.authUrl?.trim() || undefined,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg, status: 502 };
  }
}
