import { loadFeishuChannelConfig } from './config-store';
import { submitFeishuInboundToEventBridge } from './inbound-adapter';
import type { FeishuChannelFileConfig } from './types';
import { parseFeishuImReceiveForInbound } from './message-inbound';
import {
  decryptFeishuEncryptField,
  isFeishuWebhookSignatureValid,
  parseJsonObject,
} from './webhook-security';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function headersFromRequest(req: Request): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  req.headers.forEach((v, k) => {
    out[k.toLowerCase()] = v;
  });
  return out;
}

function unwrapFeishuPayload(
  outer: Record<string, unknown>,
  cfg: FeishuChannelFileConfig
): Record<string, unknown> | null {
  const enc = outer.encrypt;
  if (typeof enc === 'string' && enc.length > 0) {
    const key = cfg.encryptKey?.trim();
    if (!key) {
      return null;
    }
    try {
      const plain = decryptFeishuEncryptField(key, enc);
      return parseJsonObject(plain);
    } catch {
      return null;
    }
  }
  return outer;
}

/**
 * 飞书事件订阅 HTTP 处理（POST）。验签失败返回 401，不调用 Adapter。
 */
export async function handleFeishuWebhookRequest(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const headers = headersFromRequest(req);
  const cfg = await loadFeishuChannelConfig();

  if (!cfg?.appId?.trim()) {
    return new Response(JSON.stringify({ error: 'feishu channel not configured' }), {
      status: 503,
      headers: jsonHeaders,
    });
  }

  if (
    !isFeishuWebhookSignatureValid({
      headers,
      rawBody,
      encryptKey: cfg.encryptKey,
    })
  ) {
    return new Response('Invalid signature', {
      status: 401,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const outer = parseJsonObject(rawBody);
  if (!outer) {
    return new Response('Invalid JSON', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  const inner = unwrapFeishuPayload(outer, cfg);
  if (inner === null) {
    return new Response(JSON.stringify({ error: 'cannot decrypt event' }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  if (inner.type === 'url_verification') {
    const challenge = inner.challenge;
    if (typeof challenge !== 'string') {
      return new Response(JSON.stringify({ error: 'missing challenge' }), {
        status: 400,
        headers: jsonHeaders,
      });
    }
    const token = inner.token;
    const expectTok = cfg.verificationToken?.trim();
    if (expectTok && token !== expectTok) {
      return new Response(JSON.stringify({ error: 'verification token mismatch' }), {
        status: 403,
        headers: jsonHeaders,
      });
    }
    return new Response(JSON.stringify({ challenge }), { status: 200, headers: jsonHeaders });
  }

  const inbound = parseFeishuImReceiveForInbound(inner);
  if (inbound) {
    submitFeishuInboundToEventBridge({
      text: inbound.text,
      chatId: inbound.chatId,
      messageId: inbound.messageId,
      senderOpenId: inbound.senderOpenId,
      raw: inbound.raw,
    });
  }

  return new Response('{}', { status: 200, headers: jsonHeaders });
}
