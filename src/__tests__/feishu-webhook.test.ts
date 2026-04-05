import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBridge, CHANNEL_INBOUND_EVENT } from '../channels/bridge/event-bridge';
import * as feishuConfig from '../channels/feishu/config-store';
import { handleFeishuWebhookRequest } from '../channels/feishu/webhook-handler';

function signFeishuBody(rawBody: string, encryptKey: string) {
  const timestamp = '1711111111';
  const nonce = 'nonce-test';
  const signature = crypto
    .createHash('sha256')
    .update(timestamp + nonce + encryptKey + rawBody)
    .digest('hex');
  return {
    'content-type': 'application/json',
    'x-lark-request-timestamp': timestamp,
    'x-lark-request-nonce': nonce,
    'x-lark-signature': signature,
  } as Record<string, string>;
}

const baseCfg = {
  appId: 'cli_test',
  appSecret: 'secret',
  encryptKey: 'encrypt_key',
  verificationToken: 'verify_tok',
  defaultReceiveId: 'oc_test',
  defaultReceiveIdType: 'chat_id' as const,
};

describe('Feishu webhook', () => {
  beforeEach(() => {
    vi.spyOn(feishuConfig, 'loadFeishuChannelConfig').mockResolvedValue({ ...baseCfg });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('验签失败时不应 emit channel:inbound', async () => {
    const emitSpy = vi.spyOn(eventBridge, 'emit');
    const rawBody = JSON.stringify({ type: 'url_verification', challenge: 'c1', token: 'verify_tok' });
    const badHeaders = signFeishuBody(rawBody, 'wrong_key');

    const req = new Request('http://localhost/api/feishu/webhook', {
      method: 'POST',
      headers: badHeaders,
      body: rawBody,
    });

    const res = await handleFeishuWebhookRequest(req);
    expect(res.status).toBe(401);
    expect(emitSpy).not.toHaveBeenCalledWith(CHANNEL_INBOUND_EVENT, expect.anything());
  });

  it('合法 im.message.receive_v1 经 Adapter 投递 channel:inbound', async () => {
    const emitSpy = vi.spyOn(eventBridge, 'emit');
    const inner = {
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'oc_1',
          message_id: 'm1',
          content: JSON.stringify({ text: 'hello-feishu' }),
        },
        sender: { sender_id: { open_id: 'ou_1' } },
      },
    };
    const rawBody = JSON.stringify(inner);
    const headers = signFeishuBody(rawBody, baseCfg.encryptKey);

    const req = new Request('http://localhost/api/feishu/webhook', {
      method: 'POST',
      headers,
      body: rawBody,
    });

    const res = await handleFeishuWebhookRequest(req);
    expect(res.status).toBe(200);
    expect(emitSpy).toHaveBeenCalledWith(
      CHANNEL_INBOUND_EVENT,
      expect.objectContaining({
        channelId: 'feishu',
        text: 'hello-feishu',
        chatId: 'oc_1',
        messageId: 'm1',
        senderOpenId: 'ou_1',
      })
    );
  });
});
