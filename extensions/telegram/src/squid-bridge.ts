import { type TaskAPI } from '../../../src/api/task-api';
import { isTaskAPIConversationBusyError } from '../../../src/api/task-api-channel-errors';
import type { EventBridge, ChannelInboundEvent } from '../../../src/channels/bridge/event-bridge';
import { saveInboundImageToWorkspace } from '../../shared/workspace-image-store';
import { loadTelegramChannelConfigSync } from './config-store';
import {
  TELEGRAM_MAX_MESSAGE_CHARS,
  telegramDownloadFileById,
  telegramSendMessage,
} from './telegram-client';

function telegramConversationId(chatId: string): string {
  return `telegrambot_${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * Telegram inbound (channel:inbound) -> TaskAPI streaming ask -> reply to the same chat.
 * When conversation is busy, enqueue and reply via queued callback when completed.
 */
export function registerTelegramSquidBridge(
  taskAPI: TaskAPI,
  /** Must match the EventBridge used by plugin emit channel:inbound (host ctx.eventBridge). */
  bridge: EventBridge
): () => void {
  const offQueued = taskAPI.addChannelQueuedCompleteHandler((cmd, assistantText) => {
    if (cmd.channelReply?.channelId !== 'telegram') return;
    const chatId = cmd.channelReply.chatId?.trim();
    if (!chatId) return;
    const cfg = loadTelegramChannelConfigSync();
    const token = cfg?.botToken?.trim();
    if (!token) return;
    let body = assistantText.trim() || '(empty reply)';
    if (body.length > TELEGRAM_MAX_MESSAGE_CHARS) {
      body = `${body.slice(0, TELEGRAM_MAX_MESSAGE_CHARS)}\n...(truncated)`;
    }
    void telegramSendMessage(token, chatId, body, { apiBase: cfg?.apiBase }).then((sent) => {
      if (!sent.success) {
        console.error('[TelegramBridge] Failed to send queued task reply:', sent.error);
      } else {
        console.log('[TelegramBridge] Queued task reply sent chatId=%s', chatId);
      }
    });
  });

  const onInbound = (event: ChannelInboundEvent) => {
    if (event.channelId !== 'telegram') return;
    console.log(
      '[TelegramBridge] channel:inbound chatId=%s textLen=%d',
      event.chatId?.trim() || '(none)',
      event.text?.length ?? 0
    );
    void handleTelegramInbound(taskAPI, event).catch((err: unknown) => {
      console.error('[TelegramBridge] handleTelegramInbound error:', err);
    });
  };

  bridge.onChannelInbound(onInbound);
  return () => {
    offQueued();
    bridge.offChannelInbound(onInbound);
  };
}

type TelegramInboundMedia = {
  kind?: 'photo' | 'document';
  fileId?: string;
  fileName?: string;
  mimeType?: string;
};

function extractTelegramInboundMedia(event: ChannelInboundEvent): TelegramInboundMedia[] {
  const raw = event.raw as Record<string, unknown> | undefined;
  const media = raw?.media;
  if (!Array.isArray(media)) return [];
  return media
    .filter((it) => !!it && typeof it === 'object')
    .map((it) => it as TelegramInboundMedia)
    .filter((it) => typeof it.fileId === 'string' && it.fileId.trim());
}

async function handleTelegramInbound(taskAPI: TaskAPI, event: ChannelInboundEvent): Promise<void> {
  const text = event.text?.trim() || '';

  const chatId = event.chatId?.trim();
  if (!chatId) {
    console.warn('[TelegramBridge] Missing chatId, skipping');
    return;
  }

  const cfg = loadTelegramChannelConfigSync();
  if (!cfg?.botToken?.trim()) {
    console.warn('[TelegramBridge] botToken is not configured in ~/.squid/telegram-channel.json, skipping');
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

  const mentions: Array<{ type: 'file'; path: string; label?: string }> = [];
  const mediaRefs = extractTelegramInboundMedia(event);
  for (const media of mediaRefs) {
    const fileId = media.fileId?.trim();
    if (!fileId) continue;
    const downloaded = await telegramDownloadFileById(token, fileId, { apiBase: cfg.apiBase });
    if (!downloaded.ok) {
      console.warn('[TelegramBridge] Failed to download media fileId=%s error=%s', fileId, downloaded.error);
      continue;
    }
    const saved = await saveInboundImageToWorkspace({
      workspace,
      bytes: downloaded.bytes,
      channelId: 'telegram',
      mimeType: media.mimeType || downloaded.contentType,
      filenameHint: media.fileName || downloaded.filePath.split('/').pop(),
    });
    if (!saved.ok) {
      console.warn('[TelegramBridge] Failed to save media fileId=%s error=%s', fileId, saved.error);
      continue;
    }
    mentions.push({ type: 'file', path: saved.relativePath, label: saved.filename });
  }

  if (!text && mentions.length === 0) {
    console.warn('[TelegramBridge] Both text and recognizable images are empty, skipping');
    return;
  }
  const instruction = text || '请识别并描述用户发送的图片内容。';

  try {
    await taskAPI.prepareExternalConversation(conversationId, workspace);
  } catch (prepErr: unknown) {
    const msg = prepErr instanceof Error ? prepErr.message : String(prepErr);
    console.error('[TelegramBridge] prepareExternalConversation failed:', prepErr);
    const r = await telegramSendMessage(token, chatId, `❌ Failed to prepare conversation: ${msg}`, {
      apiBase: cfg.apiBase,
    });
    if (!r.success) console.error('[TelegramBridge] Failed to send error message:', r.error);
    return;
  }

  let full = '';
  try {
    await taskAPI.executeTaskStream(
      {
        mode: 'ask',
        workspace,
        instruction,
        mentions,
        conversationId,
      },
      (chunk) => {
        full += chunk;
      }
    );
  } catch (err: unknown) {
    if (isTaskAPIConversationBusyError(err)) {
      const pos = taskAPI.enqueueFromRequest(
        { mode: 'ask', workspace, instruction, mentions, conversationId },
        { source: 'channel', priority: 'next', channelReply: { channelId: 'telegram', chatId } }
      );
      const r = await telegramSendMessage(
        token,
        chatId,
        `⏳ Previous request is still running. This message has been queued (#${pos}) and will be replied to automatically when done.`,
        { apiBase: cfg.apiBase }
      );
      if (!r.success) console.error('[TelegramBridge] Failed to send queue notification:', r.error);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[TelegramBridge] executeTaskStream failed:', err);
    full = `❌ Execution failed: ${msg}`;
  }

  let body = full.trim() || '(empty reply)';
  if (body.length > TELEGRAM_MAX_MESSAGE_CHARS) {
    body = `${body.slice(0, TELEGRAM_MAX_MESSAGE_CHARS)}\n...(truncated)`;
  }

  const sent = await telegramSendMessage(token, chatId, body, { apiBase: cfg.apiBase });
  if (!sent.success) {
    console.error('[TelegramBridge] Failed to send reply:', sent.error);
  } else {
    console.log('[TelegramBridge] Reply sent chatId=%s', chatId);
  }
}
