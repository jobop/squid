import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  clearFeishuLastInboundReceiveTarget,
  clearFeishuTenantTokenCache,
  recordFeishuInboundChat,
  sendFeishuTextMessage,
} from '../channels/feishu';

describe('Feishu Lark client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearFeishuTenantTokenCache();
    clearFeishuLastInboundReceiveTarget();
  });

  it('tenant token 401 时发消息失败', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ msg: 'unauthorized' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await sendFeishuTextMessage(
      {
        appId: 'a',
        appSecret: 'b',
        defaultReceiveId: 'oc_x',
        defaultReceiveIdType: 'chat_id',
      },
      'hi',
      fetchMock as unknown as typeof fetch
    );

    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toMatch(/unauthorized|HTTP 401/i);
    }
  });

  it('无 defaultReceiveId 且无入站记录时发消息失败', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await sendFeishuTextMessage(
      { appId: 'a', appSecret: 'b' },
      'hi',
      fetchMock as unknown as typeof fetch
    );

    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toMatch(/defaultReceiveId|入站 chat_id/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('无 defaultReceiveId 但有最近入站 chat_id 时走发消息流程', async () => {
    recordFeishuInboundChat('oc_from_inbound', 'chat_id');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 0,
          tenant_access_token: 'tok',
          expire: 7200,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ code: 0 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const r = await sendFeishuTextMessage(
      { appId: 'a', appSecret: 'b' },
      'hi',
      fetchMock as unknown as typeof fetch
    );

    expect(r.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const msgCall = fetchMock.mock.calls[1];
    expect(String(msgCall[0])).toContain('im/v1/messages');
    const body = JSON.parse((msgCall[1] as { body: string }).body);
    expect(body.receive_id).toBe('oc_from_inbound');
  });
});
