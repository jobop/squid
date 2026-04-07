import { type TaskAPI } from '../../../src/api/task-api';
import { isTaskAPIConversationBusyError } from '../../../src/api/task-api-channel-errors';
import type { EventBridge, ChannelInboundEvent } from '../../../src/channels/bridge/event-bridge';
import { loadWeixinPersonalChannelConfigSync } from './config-store';
import { getContextTokenForPeer } from './context-token-cache';
import { ilinkSendTextMessage } from './ilink-api';

const CHANNEL_ID = 'weixin-personal';
const WEIXIN_REPLY_MAX_CHARS = 4000;

function weixinConversationId(chatId: string): string {
  return `weixinpersonal_${chatId.replace(/[^a-zA-Z0-9_@.-]/g, '_')}`;
}

export function registerWeixinPersonalSquidBridge(taskAPI: TaskAPI, bridge: EventBridge): () => void {
  const offQueued = taskAPI.addChannelQueuedCompleteHandler((cmd, assistantText) => {
    if (cmd.channelReply?.channelId !== CHANNEL_ID) return;
    const chatId = cmd.channelReply.chatId?.trim();
    if (!chatId) return;
    const cfg = loadWeixinPersonalChannelConfigSync();
    const token = cfg?.botToken?.trim();
    const baseUrl = cfg?.baseUrl?.trim();
    if (!token || !baseUrl) return;
    const ctxTok = getContextTokenForPeer(chatId);
    let body = assistantText.trim() || '(空回复)';
    if (body.length > WEIXIN_REPLY_MAX_CHARS) {
      body = `${body.slice(0, WEIXIN_REPLY_MAX_CHARS)}\n…(已截断)`;
    }
    void ilinkSendTextMessage({
      baseUrl,
      token,
      toUserId: chatId,
      text: body,
      contextToken: ctxTok,
    }).then((sent) => {
      if (!sent.ok) {
        console.error('[WeixinPersonalBridge] 排队任务回复发送失败:', sent.error);
      } else {
        console.log('[WeixinPersonalBridge] 排队任务回复已发送 chatId=%s', chatId);
      }
    });
  });

  const onInbound = (event: ChannelInboundEvent) => {
    if (event.channelId !== CHANNEL_ID) return;
    console.log(
      '[WeixinPersonalBridge] channel:inbound chatId=%s textLen=%d',
      event.chatId?.trim() || '(无)',
      event.text?.length ?? 0
    );
    void handleWeixinPersonalInbound(taskAPI, event).catch((err: unknown) => {
      console.error('[WeixinPersonalBridge] handleWeixinPersonalInbound 异常:', err);
    });
  };

  bridge.onChannelInbound(onInbound);
  return () => {
    offQueued();
    bridge.offChannelInbound(onInbound);
  };
}

async function handleWeixinPersonalInbound(taskAPI: TaskAPI, event: ChannelInboundEvent): Promise<void> {
  const text = event.text?.trim();
  if (!text) {
    console.warn('[WeixinPersonalBridge] 文本为空，跳过');
    return;
  }

  const chatId = event.chatId?.trim();
  if (!chatId) {
    console.warn('[WeixinPersonalBridge] 缺少 chatId，跳过');
    return;
  }

  const cfg = loadWeixinPersonalChannelConfigSync();
  const token = cfg?.botToken?.trim();
  const baseUrl = cfg?.baseUrl?.trim();
  if (!token || !baseUrl) {
    console.warn('[WeixinPersonalBridge] 未配置 ~/.squid/weixin-personal-channel.json');
    return;
  }

  let workspace: string;
  try {
    const ws = await taskAPI.getWorkspaceConfig();
    workspace = ws.workspace?.trim() || process.cwd();
  } catch {
    workspace = process.cwd();
  }

  const conversationId = weixinConversationId(chatId);
  const ctxTok = getContextTokenForPeer(chatId);

  try {
    await taskAPI.prepareExternalConversation(conversationId, workspace);
  } catch (prepErr: unknown) {
    const msg = prepErr instanceof Error ? prepErr.message : String(prepErr);
    console.error('[WeixinPersonalBridge] prepareExternalConversation 失败:', prepErr);
    const r = await ilinkSendTextMessage({
      baseUrl,
      token,
      toUserId: chatId,
      text: `❌ 会话准备失败：${msg}`,
      contextToken: ctxTok,
    });
    if (!r.ok) console.error('[WeixinPersonalBridge] 发送错误说明失败:', r.error);
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
        { source: 'channel', priority: 'next', channelReply: { channelId: CHANNEL_ID, chatId } }
      );
      const r = await ilinkSendTextMessage({
        baseUrl,
        token,
        toUserId: chatId,
        text: `⏳ 上一条仍在处理中，本条已加入队列（序号 ${pos}），完成后将自动回复。`,
        contextToken: ctxTok,
      });
      if (!r.ok) console.error('[WeixinPersonalBridge] 发送排队提示失败:', r.error);
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[WeixinPersonalBridge] executeTaskStream 失败:', err);
    full = `❌ 执行失败：${msg}`;
  }

  let body = full.trim() || '(空回复)';
  if (body.length > WEIXIN_REPLY_MAX_CHARS) {
    body = `${body.slice(0, WEIXIN_REPLY_MAX_CHARS)}\n…(已截断)`;
  }

  const sent = await ilinkSendTextMessage({
    baseUrl,
    token,
    toUserId: chatId,
    text: body,
    contextToken: ctxTok,
  });
  if (!sent.ok) {
    console.error('[WeixinPersonalBridge] 回复发送失败:', sent.error);
  } else {
    console.log('[WeixinPersonalBridge] 回复已发送 chatId=%s', chatId);
  }
}
