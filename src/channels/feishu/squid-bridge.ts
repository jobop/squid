import type { TaskAPI } from '../../api/task-api';
import { eventBridge, type ChannelInboundEvent } from '../bridge/event-bridge';
import { loadFeishuChannelConfigSync } from './config-store';
import { sendFeishuTextMessageTo } from './lark-client';

const FEISHU_REPLY_MAX_CHARS = 18000;

function feishuConversationId(chatId: string): string {
  return `feishubot_${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * 将飞书入站（channel:inbound）接到 TaskAPI：执行 ask 流式任务后把回复发回同一 chat。
 * @returns 取消订阅函数
 */
export function registerFeishuSquidBridge(taskAPI: TaskAPI): () => void {
  const busyChats = new Set<string>();

  const onInbound = (event: ChannelInboundEvent) => {
    if (event.channelId !== 'feishu') return;
    void handleFeishuInbound(taskAPI, event, busyChats);
  };

  eventBridge.onChannelInbound(onInbound);
  return () => eventBridge.offChannelInbound(onInbound);
}

async function handleFeishuInbound(
  taskAPI: TaskAPI,
  event: ChannelInboundEvent,
  busyChats: Set<string>
): Promise<void> {
  const text = event.text?.trim();
  if (!text) return;

  const chatId = event.chatId?.trim();
  if (!chatId) {
    console.warn('[FeishuBridge] 缺少 chatId，跳过');
    return;
  }

  const cfg = loadFeishuChannelConfigSync();
  if (!cfg?.appId?.trim() || !cfg.appSecret?.trim()) {
    console.warn('[FeishuBridge] 未配置 feishu-channel.json，跳过');
    return;
  }

  if (busyChats.has(chatId)) {
    const r = await sendFeishuTextMessageTo(
      cfg,
      '⏳ 上一条消息仍在处理中，请稍后再发。',
      chatId,
      'chat_id'
    );
    if (!r.success) console.error('[FeishuBridge] 发送忙提示失败:', r.error);
    return;
  }

  busyChats.add(chatId);
  try {
    let workspace: string;
    try {
      const ws = await taskAPI.getWorkspaceConfig();
      workspace = ws.workspace?.trim() || process.cwd();
    } catch {
      workspace = process.cwd();
    }

    const conversationId = feishuConversationId(chatId);
    await taskAPI.prepareExternalConversation(conversationId, workspace);

    let modelConfigOk = true;
    try {
      const mc = await taskAPI.getModelConfig();
      if (!mc?.apiKey?.trim()) modelConfigOk = false;
    } catch {
      modelConfigOk = false;
    }
    if (!modelConfigOk) {
      const r = await sendFeishuTextMessageTo(
        cfg,
        '⚠️ 请先在 squid 设置中配置模型 API Key，再向我发消息。',
        chatId,
        'chat_id'
      );
      if (!r.success) console.error('[FeishuBridge] 发送提示失败:', r.error);
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
    } catch (err: any) {
      const msg = err?.message || String(err);
      full = `❌ 执行失败：${msg}`;
    }

    let body = full.trim() || '(空回复)';
    if (body.length > FEISHU_REPLY_MAX_CHARS) {
      body = `${body.slice(0, FEISHU_REPLY_MAX_CHARS)}\n…(已截断)`;
    }

    const sent = await sendFeishuTextMessageTo(cfg, body, chatId, 'chat_id');
    if (!sent.success) {
      console.error('[FeishuBridge] 回复发送失败:', sent.error);
    }
  } finally {
    busyChats.delete(chatId);
  }
}
