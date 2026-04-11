import type { TaskAPI } from '../../../src/api/task-api';
import type { EventBridge, TaskCompleteEvent } from '../../../src/channels/bridge/event-bridge';
import type {
  ChannelPlugin,
  NotificationMessage,
} from '../../../src/channels/types';
import {
  loadTelegramChannelConfigSync,
  toTelegramConfigPublicView,
  validateTelegramChannelConfig,
} from './config-store';
import { registerTelegramSquidBridge } from './squid-bridge';
import { telegramGetUpdates, telegramSendMessage } from './telegram-client';
import { isLikelyImageFile } from '../../shared/workspace-image-store';

let allowedAllLogged = false;

function isChatAllowed(
  chatIdStr: string,
  allowed: string[] | undefined
): boolean {
  if (!allowed || allowed.length === 0) {
    if (!allowedAllLogged) {
      allowedAllLogged = true;
      console.warn(
        '[Telegram] allowedChatIds is not configured: all chats will be processed. In production, set allowedChatIds in ~/.squid/telegram-channel.json.'
      );
    }
    return true;
  }
  return allowed.some((a) => a.trim() === chatIdStr);
}

type TelegramInboundMediaRef = {
  kind: 'photo' | 'document';
  fileId: string;
  fileName?: string;
  mimeType?: string;
};

function pickTelegramInboundMedia(message: {
  photo?: Array<{ file_id: string; file_size?: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string };
}): TelegramInboundMediaRef[] {
  const refs: TelegramInboundMediaRef[] = [];
  const photos = Array.isArray(message.photo) ? message.photo : [];
  if (photos.length > 0) {
    const best = [...photos]
      .filter((p) => typeof p.file_id === 'string' && p.file_id.trim())
      .sort((a, b) => (b.file_size || 0) - (a.file_size || 0))[0];
    if (best?.file_id) {
      refs.push({ kind: 'photo', fileId: best.file_id });
    }
  }

  const doc = message.document;
  if (doc?.file_id) {
    const mime = String(doc.mime_type || '').toLowerCase();
    const isImage = mime.startsWith('image/') || isLikelyImageFile(doc.file_name);
    if (isImage) {
      refs.push({
        kind: 'document',
        fileId: doc.file_id,
        fileName: doc.file_name,
        mimeType: doc.mime_type,
      });
    }
  }
  return refs;
}

/**
 * Telegram Bot: inbound via long-polling getUpdates; outbound via Bot API sendMessage.
 */
export class TelegramChannelPlugin implements ChannelPlugin {
  id = 'telegram';

  meta = {
    name: 'Telegram',
    description: 'Telegram Bot (long-poll inbound + sendMessage outbound)',
    icon: '✈️',
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

  config = {
    get: <T>(key: string): T | undefined => {
      const all = toTelegramConfigPublicView(loadTelegramChannelConfigSync()) as Record<string, unknown>;
      return all[key] as T | undefined;
    },
    set: <T>(_key: string, _value: T): void => {
      /* Credentials are persisted to ~/.squid/telegram-channel.json */
    },
    getAll: () => toTelegramConfigPublicView(loadTelegramChannelConfigSync()) as Record<string, unknown>,
    validate: () => validateTelegramChannelConfig(loadTelegramChannelConfigSync() ?? {}).ok,
  };

  outbound = {
    sendText: async (params: { content: string; title?: string }) => {
      const c = loadTelegramChannelConfigSync();
      const token = c?.botToken?.trim();
      const chatId = c?.defaultChatId?.trim();
      if (!token) {
        return { success: false, error: 'botToken is not configured in ~/.squid/telegram-channel.json' };
      }
      if (!chatId) {
        return {
          success: false,
          error: 'defaultChatId is required for outbound messages (targeted notification routing from inbound context is not implemented yet)',
        };
      }
      let text = params.content;
      if (params.title) {
        text = `**${params.title}**\n\n${text}`;
      }
      return telegramSendMessage(token, chatId, text, { apiBase: c?.apiBase });
    },
    sendNotification: async (message: NotificationMessage) => {
      const c = loadTelegramChannelConfigSync();
      const token = c?.botToken?.trim();
      const chatId = c?.defaultChatId?.trim();
      if (!token) {
        return { success: false, error: 'botToken is not configured' };
      }
      if (!chatId) {
        return { success: false, error: 'defaultChatId is not configured' };
      }
      let text = message.content;
      if (message.title) {
        text = `${message.title}\n\n${text}`;
      }
      return telegramSendMessage(token, chatId, text, { apiBase: c?.apiBase });
    },
  };

  inbound = {
    onMessage: () => {
      console.warn('[Telegram] Inbound messages are handled by long polling in setup; subscribe to eventBridge.onChannelInbound if needed');
    },
  };

  status = {
    check: async () => {
      const c = loadTelegramChannelConfigSync();
      if (!c?.botToken?.trim()) {
        return { healthy: false, message: 'botToken is not configured in ~/.squid/telegram-channel.json' };
      }
      const v = validateTelegramChannelConfig(c);
      if (!v.ok) {
        return { healthy: false, message: v.errors.join('; ') };
      }
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await telegramGetUpdates(c.botToken, 0, {
          apiBase: c.apiBase,
          signal: ctrl.signal,
          timeout: 1,
        });
        clearTimeout(t);
        if (!r.ok) {
          return { healthy: false, message: r.error };
        }
        return { healthy: true, message: 'Bot API reachable' };
      } catch (e: unknown) {
        clearTimeout(t);
        const msg = e instanceof Error ? e.message : String(e);
        return { healthy: false, message: `Connectivity check failed: ${msg}` };
      }
    },
  };

  setup = {
    initialize: async () => {
      if (this.taskAPI) {
        this.squidBridgeOff = registerTelegramSquidBridge(this.taskAPI, this.bridge);
      }

      this.taskCompleteHandler = (event: TaskCompleteEvent) => {
        const c = loadTelegramChannelConfigSync();
        const token = c?.botToken?.trim();
        const chatId = c?.defaultChatId?.trim();
        if (!token || !chatId) return;
        const text = event.error
          ? `❌ Task failed\nTask: ${event.taskId}\nError: ${event.error}`
          : `✅ Task completed\nTask: ${event.taskId}`;
        void telegramSendMessage(token, chatId, text, { apiBase: c?.apiBase }).catch((err) => {
          console.error('[Telegram] Failed to send task completion notification:', err);
        });
      };
      this.bridge.onTaskComplete(this.taskCompleteHandler);

      const c = loadTelegramChannelConfigSync();
      if (!c?.botToken?.trim()) {
        console.warn('[Telegram] botToken is not configured, skipping getUpdates long polling');
        return;
      }

      this.pollAbort = new AbortController();
      const signal = this.pollAbort.signal;
      this.pollPromise = this.runPollLoop(c.botToken, c.apiBase, c.allowedChatIds, signal);
      this.pollPromise.catch((err) => {
        if (!signal.aborted) {
          console.error('[Telegram] Long-polling exited unexpectedly:', err);
        }
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
    botToken: string,
    apiBase: string | undefined,
    allowedChatIds: string[] | undefined,
    signal: AbortSignal
  ): Promise<void> {
    let offset = 0;
    while (!signal.aborted) {
      try {
        const r = await telegramGetUpdates(botToken, offset, {
          apiBase,
          signal,
          timeout: 25,
        });
        if (!r.ok) {
          console.error('[Telegram] getUpdates:', r.error);
          try {
            await sleep(5000, signal);
          } catch {
            break;
          }
          continue;
        }
        for (const u of r.result) {
          offset = u.update_id + 1;
          const msg = u.message;
          if (!msg) continue;
          if (msg.from?.is_bot) continue;
          const chatId = msg.chat?.id;
          if (chatId === undefined) continue;
          const chatIdStr = String(chatId);
          if (!isChatAllowed(chatIdStr, allowedChatIds)) continue;
          const text = String(msg.text || msg.caption || '').trim();
          const media = pickTelegramInboundMedia(msg);
          if (!text && media.length === 0) continue;

          this.bridge.emitChannelInbound({
            channelId: 'telegram',
            text,
            chatId: chatIdStr,
            messageId: String(msg.message_id),
            raw: { update_id: u.update_id, chat_type: msg.chat?.type, media },
          });
        }
      } catch (e: unknown) {
        if (signal.aborted) break;
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Telegram] Polling error:', msg);
        try {
          await sleep(3000, signal);
        } catch {
          break;
        }
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
