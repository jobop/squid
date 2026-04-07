import { type TaskAPI } from '../../../src/api/task-api';
import { isTaskAPIConversationBusyError } from '../../../src/api/task-api-channel-errors';
import type { ChannelInboundEvent } from '../../../src/channels/bridge/event-bridge';
import { loadFeishuChannelConfigSync } from './config-store';
import { getFeishuExtensionEventBridge } from './feishu-host-bridge';
import { sendFeishuTextMessageTo } from './lark-client';

const FEISHU_REPLY_MAX_CHARS = 18000;

function feishuConversationId(chatId: string): string {
  return `feishubot_${chatId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/**
 * 将飞书入站（channel:inbound）接到 TaskAPI：执行 ask 流式任务后把回复发回同一 chat。
 * 会话忙时入队（与 claude bridge enqueue 对齐），完成后由 TaskAPI 广播给已注册的 channel 队列回调。
 * @returns 取消订阅函数
 */
export function registerFeishuSquidBridge(taskAPI: TaskAPI): () => void {
  const offQueued = taskAPI.addChannelQueuedCompleteHandler((cmd, assistantText) => {
    if (cmd.channelReply?.channelId !== 'feishu') return;
    const chatId = cmd.channelReply.chatId?.trim();
    if (!chatId) return;
    const cfg = loadFeishuChannelConfigSync();
    if (!cfg?.appId?.trim() || !cfg?.appSecret?.trim()) return;
    let body = assistantText.trim() || '(空回复)';
    if (body.length > FEISHU_REPLY_MAX_CHARS) {
      body = `${body.slice(0, FEISHU_REPLY_MAX_CHARS)}\n…(已截断)`;
    }
    void sendFeishuTextMessageTo(cfg, body, chatId, 'chat_id').then((sent) => {
      if (!sent.success) {
        console.error('[FeishuBridge] 排队任务回复发送失败:', sent.error);
      } else {
        console.log('[FeishuBridge] 排队任务回复已发送 chatId=%s', chatId);
      }
    });
  });

  const onInbound = (event: ChannelInboundEvent) => {
    if (event.channelId !== 'feishu') return;
    console.log(
      '[FeishuBridge] 收到 channel:inbound chatId=%s textLen=%d',
      event.chatId?.trim() || '(无)',
      event.text?.length ?? 0
    );
    void handleFeishuInbound(taskAPI, event).catch((err: unknown) => {
      console.error('[FeishuBridge] handleFeishuInbound 异常（此前可能未回飞书）:', err);
    });
  };

  /** 与 submitFeishuInboundToEventBridge 使用同一实例（宿主 bind 的 ctx.eventBridge），避免动态 import 扩展时与静态 import 的 eventBridge 分裂 */
  const bridge = getFeishuExtensionEventBridge();
  bridge.onChannelInbound(onInbound);
  return () => {
    offQueued();
    bridge.offChannelInbound(onInbound);
  };
}

async function handleFeishuInbound(taskAPI: TaskAPI, event: ChannelInboundEvent): Promise<void> {
  const text = event.text?.trim();
  if (!text) {
    console.warn('[FeishuBridge] 文本为空，跳过');
    return;
  }

  const chatId = event.chatId?.trim();
  if (!chatId) {
    console.warn('[FeishuBridge] 缺少 chatId，跳过');
    return;
  }

  const cfg = loadFeishuChannelConfigSync();
  if (!cfg?.appId?.trim() || !cfg?.appSecret?.trim()) {
    console.warn('[FeishuBridge] 未配置 feishu-channel.json，跳过');
    return;
  }

  let workspace: string;
  try {
    const ws = await taskAPI.getWorkspaceConfig();
    workspace = ws.workspace?.trim() || process.cwd();
  } catch {
    workspace = process.cwd();
  }

  const conversationId = feishuConversationId(chatId);
  console.log('[FeishuBridge] 开始处理 conversationId=%s workspace=%s', conversationId, workspace);

  try {
    await taskAPI.prepareExternalConversation(conversationId, workspace);
  } catch (prepErr: unknown) {
    const msg = prepErr instanceof Error ? prepErr.message : String(prepErr);
    console.error('[FeishuBridge] prepareExternalConversation 失败:', prepErr);
    const r = await sendFeishuTextMessageTo(cfg, `❌ 会话准备失败：${msg}`, chatId, 'chat_id');
    if (!r.success) console.error('[FeishuBridge] 发送错误说明失败:', r.error);
    return;
  }

  let full = '';
  try {
    console.log('[FeishuBridge] 调用 TaskAPI.executeTaskStream（LLM 配置与 Channel 无关）…');
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
    console.log('[FeishuBridge] executeTaskStream 结束，聚合长度=%d', full.length);
  } catch (err: unknown) {
    if (isTaskAPIConversationBusyError(err)) {
      const pos = taskAPI.enqueueFromRequest(
        { mode: 'ask', workspace, instruction: text, conversationId },
        { source: 'channel', priority: 'next', channelReply: { channelId: 'feishu', chatId } }
      );
      const r = await sendFeishuTextMessageTo(
        cfg,
        `⏳ 上一条仍在处理中，本条已加入队列（序号 ${pos}），完成后将自动回复。`,
        chatId,
        'chat_id'
      );
      if (!r.success) console.error('[FeishuBridge] 发送排队提示失败:', r.error);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[FeishuBridge] executeTaskStream 失败:', err);
    full = `❌ 执行失败：${msg}`;
  }

  let body = full.trim() || '(空回复)';
  if (body.length > FEISHU_REPLY_MAX_CHARS) {
    body = `${body.slice(0, FEISHU_REPLY_MAX_CHARS)}\n…(已截断)`;
  }

  console.log('[FeishuBridge] 正在发回飞书，正文长度=%d', body.length);
  const sent = await sendFeishuTextMessageTo(cfg, body, chatId, 'chat_id');
  if (!sent.success) {
    console.error('[FeishuBridge] 回复发送失败:', sent.error);
  } else {
    console.log('[FeishuBridge] 回复已发送到飞书 chatId=%s', chatId);
  }
}
