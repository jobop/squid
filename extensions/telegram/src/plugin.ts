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

let allowedAllLogged = false;

function isChatAllowed(
  chatIdStr: string,
  allowed: string[] | undefined
): boolean {
  if (!allowed || allowed.length === 0) {
    if (!allowedAllLogged) {
      allowedAllLogged = true;
      console.warn(
        '[Telegram] allowedChatIds 未配置：将处理所有对话。生产环境建议在 ~/.squid/telegram-channel.json 中设置 allowedChatIds。'
      );
    }
    return true;
  }
  return allowed.some((a) => a.trim() === chatIdStr);
}

/**
 * Telegram Bot：长轮询 getUpdates 入站；出站走 Bot API sendMessage。
 */
export class TelegramChannelPlugin implements ChannelPlugin {
  id = 'telegram';

  meta = {
    name: 'Telegram',
    description: 'Telegram Bot（长轮询入站 + sendMessage 出站）',
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
      /* 凭证写入 ~/.squid/telegram-channel.json */
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
        return { success: false, error: '未配置 ~/.squid/telegram-channel.json 的 botToken' };
      }
      if (!chatId) {
        return { success: false, error: '出站需配置 defaultChatId（或通过对话入站后仅能通过通知管理器带目标，当前未实现）' };
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
        return { success: false, error: '未配置 botToken' };
      }
      if (!chatId) {
        return { success: false, error: '未配置 defaultChatId' };
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
      console.warn('[Telegram] 入站由 setup 中长轮询处理；亦可订阅 eventBridge.onChannelInbound');
    },
  };

  status = {
    check: async () => {
      const c = loadTelegramChannelConfigSync();
      if (!c?.botToken?.trim()) {
        return { healthy: false, message: '未配置 ~/.squid/telegram-channel.json 的 botToken' };
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
        return { healthy: true, message: 'Bot API 可访问' };
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
        this.squidBridgeOff = registerTelegramSquidBridge(this.taskAPI, this.bridge);
      }

      this.taskCompleteHandler = (event: TaskCompleteEvent) => {
        const c = loadTelegramChannelConfigSync();
        const token = c?.botToken?.trim();
        const chatId = c?.defaultChatId?.trim();
        if (!token || !chatId) return;
        const text = event.error
          ? `❌ 任务失败\n任务: ${event.taskId}\n错误: ${event.error}`
          : `✅ 任务完成\n任务: ${event.taskId}`;
        void telegramSendMessage(token, chatId, text, { apiBase: c?.apiBase }).catch((err) => {
          console.error('[Telegram] 任务完成通知发送失败:', err);
        });
      };
      this.bridge.onTaskComplete(this.taskCompleteHandler);

      const c = loadTelegramChannelConfigSync();
      if (!c?.botToken?.trim()) {
        console.warn('[Telegram] 未配置 botToken，跳过 getUpdates 长轮询');
        return;
      }

      this.pollAbort = new AbortController();
      const signal = this.pollAbort.signal;
      this.pollPromise = this.runPollLoop(c.botToken, c.apiBase, c.allowedChatIds, signal);
      this.pollPromise.catch((err) => {
        if (!signal.aborted) {
          console.error('[Telegram] 长轮询异常退出:', err);
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
          if (!msg?.text?.trim()) continue;
          if (msg.from?.is_bot) continue;
          const chatId = msg.chat?.id;
          if (chatId === undefined) continue;
          const chatIdStr = String(chatId);
          if (!isChatAllowed(chatIdStr, allowedChatIds)) continue;

          this.bridge.emitChannelInbound({
            channelId: 'telegram',
            text: msg.text,
            chatId: chatIdStr,
            messageId: String(msg.message_id),
            raw: { update_id: u.update_id, chat_type: msg.chat?.type },
          });
        }
      } catch (e: unknown) {
        if (signal.aborted) break;
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[Telegram] 轮询错误:', msg);
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
