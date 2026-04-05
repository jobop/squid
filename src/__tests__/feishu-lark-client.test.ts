import { describe, it, expect, vi, afterEach } from 'vitest';
import { clearFeishuTenantTokenCache, sendFeishuTextMessage } from '../channels/feishu/lark-client';

describe('Feishu Lark client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearFeishuTenantTokenCache();
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
});
