import { type TaskAPI } from '../../../src/api/task-api';
import { isTaskAPIConversationBusyError } from '../../../src/api/task-api-channel-errors';
import type { EventBridge, ChannelInboundEvent } from '../../../src/channels/bridge/event-bridge';
import { saveInboundImageToWorkspace } from '../../shared/workspace-image-store';
import { createDecipheriv } from 'node:crypto';
import { loadWeixinPersonalChannelConfigSync } from './config-store';
import { getContextTokenForPeer } from './context-token-cache';
import { ilinkDownloadImageByUrl, ilinkSendTextMessage } from './ilink-api';

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

type WeixinInboundMedia = {
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

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType?: string } | null {
  const m = String(dataUrl).match(/^data:([^;,]+)?;base64,(.+)$/);
  if (!m?.[2]) return null;
  try {
    return {
      bytes: new Uint8Array(Buffer.from(m[2], 'base64')),
      mimeType: m[1] || undefined,
    };
  } catch {
    return null;
  }
}

function decodeBase64(base64: string): Uint8Array | null {
  try {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch {
    return null;
  }
}

function extractWeixinInboundMedia(event: ChannelInboundEvent): WeixinInboundMedia[] {
  const raw = event.raw as Record<string, unknown> | undefined;
  const media = raw?.media;
  if (!Array.isArray(media)) return [];
  return media
    .filter((it) => !!it && typeof it === 'object')
    .map((it) => it as WeixinInboundMedia);
}

function parseWeixinAesKey(media: WeixinInboundMedia): Buffer | null {
  const hex = String(media.aesKeyHex || '').trim();
  if (hex && /^[0-9a-fA-F]{32}$/.test(hex)) {
    return Buffer.from(hex, 'hex');
  }
  const b64 = String(media.aesKeyBase64 || '').trim();
  if (!b64) return null;
  const decoded = Buffer.from(b64, 'base64');
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex');
  }
  return null;
}

function decryptWeixinMedia(bytes: Uint8Array, key: Buffer): Uint8Array {
  const decipher = createDecipheriv('aes-128-ecb', key, null);
  return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(bytes)), decipher.final()]));
}

async function handleWeixinPersonalInbound(taskAPI: TaskAPI, event: ChannelInboundEvent): Promise<void> {
  const text = event.text?.trim() || '';

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

  const mentions: Array<{ type: 'file'; path: string; label?: string }> = [];
  const mediaRefs = extractWeixinInboundMedia(event);
  if (mediaRefs.length > 0) {
    console.log('[WeixinPersonalBridge] 收到媒体引用数量=%d chatId=%s', mediaRefs.length, chatId);
  }
  for (const media of mediaRefs) {
    let bytes: Uint8Array | undefined;
    let mimeType = media.mimeType;
    if (media.dataUrl) {
      const r = decodeDataUrl(media.dataUrl);
      if (r) {
        bytes = r.bytes;
        mimeType = mimeType || r.mimeType;
      }
    }
    if (!bytes && media.base64) {
      const r = decodeBase64(media.base64);
      if (r) bytes = r;
    }
    if (!bytes && (media.fullUrl || media.url)) {
      const url = media.fullUrl || media.url;
      const downloaded = await ilinkDownloadImageByUrl({
        baseUrl,
        token,
        url,
      });
      if (downloaded.ok) {
        const key = parseWeixinAesKey(media);
        if (key) {
          try {
            bytes = decryptWeixinMedia(downloaded.bytes, key);
          } catch (error) {
            console.warn('[WeixinPersonalBridge] 媒体解密失败，将尝试原始内容: %s', String(error));
            bytes = downloaded.bytes;
          }
        } else {
          bytes = downloaded.bytes;
        }
        mimeType = mimeType || downloaded.contentType;
      }
    }
    if (!bytes) continue;
    const saved = await saveInboundImageToWorkspace({
      workspace,
      bytes,
      channelId: CHANNEL_ID,
      mimeType,
      filenameHint: media.fileName,
    });
    if (!saved.ok) {
      console.warn('[WeixinPersonalBridge] 媒体落盘失败: %s', saved.error);
      continue;
    }
    mentions.push({ type: 'file', path: saved.relativePath, label: saved.filename });
  }
  if (mediaRefs.length > 0 && mentions.length === 0) {
    console.warn('[WeixinPersonalBridge] 收到媒体但未成功落盘，raw media=%j', mediaRefs);
  }
  if (!text && mentions.length === 0) {
    console.warn('[WeixinPersonalBridge] 文本与可识别图片均为空，跳过');
    return;
  }
  const instruction = text || '请识别并描述用户发送的图片内容。';

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
