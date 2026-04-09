import type { TaskAPI } from '../../../src/api/task-api';
import type { EventBridge, TaskCompleteEvent } from '../../../src/channels/bridge/event-bridge';
import type { ChannelPlugin, NotificationMessage } from '../../../src/channels/types';
import {
  loadGetUpdatesBufSync,
  loadWeixinPersonalChannelConfigSync,
  saveGetUpdatesBufSync,
  toWeixinPersonalConfigPublicView,
  validateWeixinPersonalChannelConfig,
} from './config-store';
import { rememberContextToken } from './context-token-cache';
import { ilinkGetUpdates, ilinkSendTextMessage, SESSION_EXPIRED_ERRCODE } from './ilink-api';
import { MessageItemType, MessageType } from './ilink-types';
import type { WeixinMessage } from './ilink-types';
import { pollWeixinPersonalQrLoginOnce, startWeixinPersonalQrLogin } from './ilink-login';
import { registerWeixinPersonalSquidBridge } from './squid-bridge';
import { isLikelyImageFile } from '../../shared/workspace-image-store';

const CHANNEL_ID = 'weixin-personal';

let allowedAllLogged = false;

function isUserAllowed(userId: string, allowed: string[] | undefined): boolean {
  if (!allowed || allowed.length === 0) {
    if (!allowedAllLogged) {
      allowedAllLogged = true;
      console.warn(
        '[WeixinPersonal] allowedUserIds 未配置：将处理所有私聊。生产建议在 ~/.squid/weixin-personal-channel.json 设置 allowedUserIds。'
      );
    }
    return true;
  }
  return allowed.some((a) => a.trim() === userId);
}

function extractTextFromWeixinMessage(msg: WeixinMessage): string {
  const items = msg.item_list ?? [];
  const parts: string[] = [];
  for (const it of items) {
    const itemType = typeof it.type === 'string' ? Number(it.type) : it.type;
    if (itemType === MessageItemType.TEXT && it.text_item?.text?.trim()) {
      parts.push(it.text_item.text.trim());
    }
  }
  return parts.join('\n').trim();
}

type WeixinInboundImageRef = {
  url?: string;
  fullUrl?: string;
  dataUrl?: string;
  base64?: string;
  fileName?: string;
  mimeType?: string;
  encryptQueryParam?: string;
  aesKeyBase64?: string;
  aesKeyHex?: string;
};

function pickDeepStringByKey(input: unknown, keys: string[]): string | undefined {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));
  const stack: unknown[] = [input];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const it of cur) stack.push(it);
      continue;
    }
    const obj = cur as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim() && keySet.has(k.toLowerCase())) {
        return v;
      }
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return undefined;
}

function pickDeepUrlLike(input: unknown): string | undefined {
  const stack: unknown[] = [input];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const it of cur) stack.push(it);
      continue;
    }
    const obj = cur as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim()) {
        const key = k.toLowerCase();
        const value = v.trim();
        if ((key.includes('url') || key.includes('uri') || key.includes('link')) && value.length > 6) {
          if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value;
        }
      }
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return undefined;
}

function extractImageRefsFromWeixinMessage(msg: WeixinMessage): WeixinInboundImageRef[] {
  const items = msg.item_list ?? [];
  const refs: WeixinInboundImageRef[] = [];
  for (const it of items) {
    const itemType = typeof it.type === 'string' ? Number(it.type) : it.type;
    const maybeImage =
      itemType === MessageItemType.IMAGE ||
      itemType === MessageItemType.FILE ||
      !!it.image_item ||
      !!it.file_item;
    if (!maybeImage) continue;
    const ii = (it.image_item || it.file_item || it) as Record<string, unknown>;
    const mimeType = pickDeepStringByKey(ii, ['mime_type', 'mimeType', 'content_type', 'contentType']);
    const fileName = pickDeepStringByKey(ii, ['file_name', 'filename', 'name', 'title']);
    const canBeImage =
      itemType === MessageItemType.IMAGE ||
      String(mimeType || '').toLowerCase().startsWith('image/') ||
      isLikelyImageFile(fileName) ||
      !!pickDeepStringByKey(ii, ['aeskey', 'aes_key']);
    if (!canBeImage) continue;
    refs.push({
      fullUrl: pickDeepStringByKey(ii, ['full_url', 'fullUrl']),
      url:
        pickDeepStringByKey(ii, [
          'image_url',
          'url',
          'download_url',
          'cdn_url',
          'media_url',
          'file_url',
          'pic_url',
          'source_url',
          'resource_url',
        ]) || pickDeepUrlLike(ii),
      dataUrl: pickDeepStringByKey(ii, ['data_url', 'dataUrl', 'data_uri', 'dataUri']),
      base64: pickDeepStringByKey(ii, ['base64', 'b64', 'image_base64', 'content_base64']),
      fileName,
      mimeType,
      encryptQueryParam: pickDeepStringByKey(ii, ['encrypt_query_param', 'encryptQueryParam']),
      aesKeyBase64: pickDeepStringByKey(ii, ['aes_key', 'aesKey']),
      aesKeyHex: pickDeepStringByKey(ii, ['aeskey']),
    });
  }
  return refs;
}

/**
 * 个人微信 iLink：长轮询 getUpdates；文本出站 sendMessage（需 context_token，由入站缓存）。
 */
export class WeixinPersonalChannelPlugin implements ChannelPlugin {
  id = CHANNEL_ID;

  meta = {
    name: '微信（个人）',
    description: 'iLink Bot 私聊：长轮询入站 + 文本回复（需 ClawBot 与腾讯灰度）',
    icon: '💬',
    category: 'third-party' as const,
  };

  capabilities = {
    outbound: { text: true, media: false, rich: false, streaming: false },
    inbound: { text: true, commands: true, interactive: true },
  };

  private pollAbort?: AbortController;
  private pollPromise?: Promise<void>;
  private taskCompleteHandler?: (event: TaskCompleteEvent) => void;
  private squidBridgeOff?: () => void;

  constructor(
    private readonly bridge: EventBridge,
    private readonly taskAPI?: TaskAPI
  ) {}

  extensionWebAuth = {
    startAuthLink: async () => {
      const r = await startWeixinPersonalQrLogin();
      if (!r.qrcodeUrl?.trim()) {
        throw new Error(r.message || '未获取到认证链接');
      }
      return { authUrl: r.qrcodeUrl.trim(), sessionKey: r.sessionKey };
    },
    pollAuthLogin: async (sessionKey: string) => {
      const r = await pollWeixinPersonalQrLoginOnce(sessionKey, { silent: true });
      return {
        status: r.status,
        message: r.message,
        authUrl: r.authUrl,
      };
    },
  };

  config = {
    get: <T>(key: string): T | undefined => {
      const all = toWeixinPersonalConfigPublicView(loadWeixinPersonalChannelConfigSync()) as Record<
        string,
        unknown
      >;
      return all[key] as T | undefined;
    },
    set: <T>(_key: string, _value: T): void => {},
    getAll: () => toWeixinPersonalConfigPublicView(loadWeixinPersonalChannelConfigSync()) as Record<string, unknown>,
    validate: () => validateWeixinPersonalChannelConfig(loadWeixinPersonalChannelConfigSync() ?? {}).ok,
  };

  outbound = {
    sendText: async (params: { content: string; title?: string }) => {
      const c = loadWeixinPersonalChannelConfigSync();
      const token = c?.botToken?.trim();
      const baseUrl = c?.baseUrl?.trim();
      const to = c?.allowedUserIds?.[0]?.trim();
      if (!token || !baseUrl) {
        return { success: false, error: '未配置 ~/.squid/weixin-personal-channel.json 的 botToken/baseUrl' };
      }
      if (!to) {
        return {
          success: false,
          error: '出站需指定 allowedUserIds 中至少一个用户 id（xxx@im.wechat）作为默认收件人',
        };
      }
      let text = params.content;
      if (params.title) text = `${params.title}\n\n${text}`;
      const ctx = undefined;
      const r = await ilinkSendTextMessage({ baseUrl, token, toUserId: to, text, contextToken: ctx });
      return r.ok ? { success: true } : { success: false, error: r.error };
    },
    sendNotification: async (message: NotificationMessage) => {
      const c = loadWeixinPersonalChannelConfigSync();
      const token = c?.botToken?.trim();
      const baseUrl = c?.baseUrl?.trim();
      const to = c?.allowedUserIds?.[0]?.trim();
      if (!token || !baseUrl) return { success: false, error: '未配置 botToken/baseUrl' };
      if (!to) return { success: false, error: '未配置 allowedUserIds[0] 作为默认收件人' };
      let text = message.content;
      if (message.title) text = `${message.title}\n\n${text}`;
      const r = await ilinkSendTextMessage({ baseUrl, token, toUserId: to, text });
      return r.ok ? { success: true } : { success: false, error: r.error };
    },
  };

  inbound = {
    onMessage: () => {
      console.warn('[WeixinPersonal] 入站由 setup 中长轮询处理；可订阅 eventBridge.onChannelInbound');
    },
  };

  status = {
    check: async () => {
      const c = loadWeixinPersonalChannelConfigSync();
      const v = validateWeixinPersonalChannelConfig(c ?? {});
      if (!v.ok) {
        return { healthy: false, message: v.errors.join('; ') };
      }
      const token = c!.botToken!.trim();
      const baseUrl = c!.baseUrl!.trim();
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12_000);
      try {
        const resp = await ilinkGetUpdates({
          baseUrl,
          token,
          get_updates_buf: '',
          timeoutMs: 8000,
        });
        clearTimeout(t);
        const bad =
          (resp.ret !== undefined && resp.ret !== 0) ||
          (resp.errcode !== undefined && resp.errcode !== 0);
        if (bad) {
          return {
            healthy: false,
            message: `getUpdates: ret=${resp.ret} errcode=${resp.errcode} ${resp.errmsg ?? ''}`,
          };
        }
        return { healthy: true, message: 'iLink getUpdates 可访问' };
      } catch (e: unknown) {
        clearTimeout(t);
        const msg = e instanceof Error ? e.message : String(e);
        return { healthy: false, message: `连通性检查失败: ${msg}` };
      }
    },
  };

  setup = {
    initialize: async () => {
      if (this.taskAPI) {
        this.squidBridgeOff = registerWeixinPersonalSquidBridge(this.taskAPI, this.bridge);
      }

      this.taskCompleteHandler = (event: TaskCompleteEvent) => {
        const c = loadWeixinPersonalChannelConfigSync();
        const token = c?.botToken?.trim();
        const baseUrl = c?.baseUrl?.trim();
        const to = c?.allowedUserIds?.[0]?.trim();
        if (!token || !baseUrl || !to) return;
        const text = event.error
          ? `❌ 任务失败\n任务: ${event.taskId}\n错误: ${event.error}`
          : `✅ 任务完成\n任务: ${event.taskId}`;
        void ilinkSendTextMessage({ baseUrl, token, toUserId: to, text }).catch((err) => {
          console.error('[WeixinPersonal] 任务完成通知发送失败:', err);
        });
      };
      this.bridge.onTaskComplete(this.taskCompleteHandler);

      const c = loadWeixinPersonalChannelConfigSync();
      if (!c?.botToken?.trim() || !c?.baseUrl?.trim()) {
        console.warn(
          '[WeixinPersonal] 未配置 botToken/baseUrl，跳过 getUpdates。请在渠道配置页使用「获取认证链接」完成登录，或运行 npm run weixin-personal:login'
        );
        return;
      }

      this.pollAbort = new AbortController();
      const signal = this.pollAbort.signal;
      this.pollPromise = this.runPollLoop(c.botToken.trim(), c.baseUrl.trim(), c.allowedUserIds, signal);
      this.pollPromise.catch((err) => {
        if (!signal.aborted) console.error('[WeixinPersonal] 长轮询异常退出:', err);
      });
    },
    cleanup: async () => {
      if (this.taskCompleteHandler) {
        this.bridge.offTaskComplete(this.taskCompleteHandler);
        this.taskCompleteHandler = undefined;
      }
      this.squidBridgeOff?.();
      this.squidBridgeOff = undefined;
      this.pollAbort?.abort();
      this.pollAbort = undefined;
      await this.pollPromise?.catch(() => {});
      this.pollPromise = undefined;
    },
  };

  private async runPollLoop(
    token: string,
    baseUrl: string,
    allowedUserIds: string[] | undefined,
    signal: AbortSignal
  ): Promise<void> {
    let getUpdatesBuf = loadGetUpdatesBufSync();
    let nextTimeoutMs = 35_000;
    let consecutiveFailures = 0;
    const MAX_FAIL = 3;

    while (!signal.aborted) {
      try {
        const resp = await ilinkGetUpdates({
          baseUrl,
          token,
          get_updates_buf: getUpdatesBuf,
          timeoutMs: nextTimeoutMs,
          signal,
        });

        if (resp.longpolling_timeout_ms != null && resp.longpolling_timeout_ms > 0) {
          nextTimeoutMs = resp.longpolling_timeout_ms;
        }

        const isApiError =
          (resp.ret !== undefined && resp.ret !== 0) ||
          (resp.errcode !== undefined && resp.errcode !== 0);
        if (isApiError) {
          const sessionExpired =
            resp.errcode === SESSION_EXPIRED_ERRCODE || resp.ret === SESSION_EXPIRED_ERRCODE;
          if (sessionExpired) {
            console.error(
              '[WeixinPersonal] 会话过期 (errcode -14)，请重新扫码登录并更新 ~/.squid/weixin-personal-channel.json'
            );
            consecutiveFailures = 0;
            await sleep(120_000, signal);
            continue;
          }
          consecutiveFailures++;
          console.error(
            `[WeixinPersonal] getUpdates 失败 ret=${resp.ret} errcode=${resp.errcode} ${resp.errmsg ?? ''} (${consecutiveFailures}/${MAX_FAIL})`
          );
          await sleep(consecutiveFailures >= MAX_FAIL ? 30_000 : 2000, signal);
          if (consecutiveFailures >= MAX_FAIL) consecutiveFailures = 0;
          continue;
        }

        consecutiveFailures = 0;

        if (resp.get_updates_buf != null && resp.get_updates_buf !== '') {
          saveGetUpdatesBufSync(resp.get_updates_buf);
          getUpdatesBuf = resp.get_updates_buf;
        }

        const list = resp.msgs ?? [];
        for (const full of list) {
          if (full.message_type !== MessageType.USER) continue;
          const from = full.from_user_id?.trim() ?? '';
          if (!from) continue;
          if (!isUserAllowed(from, allowedUserIds)) continue;

          const body = extractTextFromWeixinMessage(full);
          const media = extractImageRefsFromWeixinMessage(full);
          if (!body && media.length === 0) continue;

          rememberContextToken(from, full.context_token);

          this.bridge.emitChannelInbound({
            channelId: CHANNEL_ID,
            text: body,
            chatId: from,
            messageId: full.message_id != null ? String(full.message_id) : undefined,
            raw: { contextToken: full.context_token, media },
            timestamp: Date.now(),
          });
        }
      } catch (e: unknown) {
        if (signal.aborted) break;
        consecutiveFailures++;
        console.error('[WeixinPersonal] 轮询错误:', e);
        try {
          await sleep(consecutiveFailures >= MAX_FAIL ? 30_000 : 3000, signal);
        } catch {
          break;
        }
        if (consecutiveFailures >= MAX_FAIL) consecutiveFailures = 0;
      }
    }
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
      reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    signal.addEventListener('abort', onAbort);
  });
}
