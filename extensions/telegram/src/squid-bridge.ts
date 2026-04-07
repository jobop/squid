import { type TaskAPI } from '../../../src/api/task-api';
import { isTaskAPIConversationBusyError } from '../../../src/api/task-api-channel-errors';
import type { EventBridge, ChannelInboundEvent } from '../../../src/channels/bridge/event-bridge';
import { loadTelegramChannelConfigSync } from './config-store';
import { TELEGRAM_MAX_MESSAGE_CHARS, telegramSendMessage } from './telegram-client';

function telegramConversationId(chatId: string): string {
  return `telegrambot_${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Telegram 入站（channel:inbound）→ TaskAPI 流式 ask → 同 chat 回贴。
 * 会话忙时入队，完成后由 `channelReply.channelId === 'telegram'` 的队列回调回贴。
 */
export function registerTelegramSquidBridge(
  taskAPI: TaskAPI,
  /** 须与插件 emit channel:inbound 使用的 EventBridge 一致（宿主 ctx.eventBridge） */
  bridge: EventBridge
): () => void {
  const offQueued = taskAPI.addChannelQueuedCompleteHandler((cmd, assistantText) => {
    if (cmd.channelReply?.channelId !== 'telegram') return;
    const chatId = cmd.channelReply.chatId?.trim();
    if (!chatId) return;
    const cfg = loadTelegramChannelConfigSync();
    const token = cfg?.botToken?.trim();
    if (!token) return;
    let body = assistantText.trim() || '(空回复)';
    if (body.length > TELEGRAM_MAX_MESSAGE_CHARS) {
      body = `${body.slice(0, TELEGRAM_MAX_MESSAGE_CHARS)}\n…(已截断)`;
    }
    void telegramSendMessage(token, chatId, body, { apiBase: cfg?.apiBase }).then((sent) => {
      if (!sent.success) {
        console.error('[TelegramBridge] 排队任务回复发送失败:', sent.error);
      } else {
        console.log('[TelegramBridge] 排队任务回复已发送 chatId=%s', chatId);
      }
    });
  });

  const onInbound = (event: ChannelInboundEvent) => {
    if (event.channelId !== 'telegram') return;
    console.log(
      '[TelegramBridge] channel:inbound chatId=%s textLen=%d',
      event.chatId?.trim() || '(无)',
      event.text?.length ?? 0
    );
    void handleTelegramInbound(taskAPI, event).catch((err: unknown) => {
      console.error('[TelegramBridge] handleTelegramInbound 异常:', err);
    });
  };

  bridge.onChannelInbound(onInbound);
  return () => {
    offQueued();
    bridge.offChannelInbound(onInbound);
  };
}

async function handleTelegramInbound(taskAPI: TaskAPI, event: ChannelInboundEvent): Promise<void> {
  const text = event.text?.trim();
  if (!text) {
    console.warn('[TelegramBridge] 文本为空，跳过');
    return;
  }

  const chatId = event.chatId?.trim();
  if (!chatId) {
    console.warn('[TelegramBridge] 缺少 chatId，跳过');
    return;
  }

  const cfg = loadTelegramChannelConfigSync();
  if (!cfg?.botToken?.trim()) {
    console.warn('[TelegramBridge] 未配置 ~/.squid/telegram-channel.json 的 botToken，跳过');
    return;
  }
  const token = cfg.botToken.trim();

  let workspace: string;
  try {
    const ws = await taskAPI.getWorkspaceConfig();
    workspace = ws.workspace?.trim() || process.cwd();
  } catch {
    workspace = process.cwd();
  }

  const conversationId = telegramConversationId(chatId);
  console.log('[TelegramBridge] conversationId=%s workspace=%s', conversationId, workspace);

  try {
    await taskAPI.prepareExternalConversation(conversationId, workspace);
  } catch (prepErr: unknown) {
    const msg = prepErr instanceof Error ? prepErr.message : String(prepErr);
    console.error('[TelegramBridge] prepareExternalConversation 失败:', prepErr);
    const r = await telegramSendMessage(token, chatId, `❌ 会话准备失败：${msg}`, {
      apiBase: cfg.apiBase,
    });
    if (!r.success) console.error('[TelegramBridge] 发送错误说明失败:', r.error);
    return;
  }

  let full = '';
  try {
    await taskAPI.executeTaskStream(
      {
        mode: 'ask',
        workspace,
        instruction: text,
        conversationId,
      },
      (chunk) => {
        full += chunk;
      }
    );
  } catch (err: unknown) {
    if (isTaskAPIConversationBusyError(err)) {
      const pos = taskAPI.enqueueFromRequest(
        { mode: 'ask', workspace, instruction: text, conversationId },
        { source: 'channel', priority: 'next', channelReply: { channelId: 'telegram', chatId } }
      );
      const r = await telegramSendMessage(
        token,
        chatId,
        `⏳ 上一条仍在处理中，本条已加入队列（序号 ${pos}），完成后将自动回复。`,
        { apiBase: cfg.apiBase }
      );
      if (!r.success) console.error('[TelegramBridge] 发送排队提示失败:', r.error);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[TelegramBridge] executeTaskStream 失败:', err);
    full = `❌ 执行失败：${msg}`;
  }

  let body = full.trim() || '(空回复)';
  if (body.length > TELEGRAM_MAX_MESSAGE_CHARS) {
    body = `${body.slice(0, TELEGRAM_MAX_MESSAGE_CHARS)}\n…(已截断)`;
  }

  const sent = await telegramSendMessage(token, chatId, body, { apiBase: cfg.apiBase });
  if (!sent.success) {
    console.error('[TelegramBridge] 回复发送失败:', sent.error);
  } else {
    console.log('[TelegramBridge] 回复已发送 chatId=%s', chatId);
  }
}
