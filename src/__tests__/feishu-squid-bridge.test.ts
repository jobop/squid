import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBridge } from '../channels/bridge/event-bridge';
import * as configStore from '../../extensions/feishu/src/config-store';
import * as larkClient from '../../extensions/feishu/src/lark-client';
import { registerFeishuSquidBridge } from '../channels/feishu';

describe('Feishu squid bridge', () => {
  const sendSpy = vi.spyOn(larkClient, 'sendFeishuTextMessageTo');

  const taskAPI = {
    getWorkspaceConfig: vi.fn().mockResolvedValue({ workspace: '/tmp' }),
    prepareExternalConversation: vi.fn().mockResolvedValue(undefined),
    executeTaskStream: vi.fn().mockImplementation(async (_req: unknown, onChunk: (c: string) => void) => {
      onChunk('reply-from-squid');
    }),
  };

  beforeEach(() => {
    vi.spyOn(configStore, 'loadFeishuChannelConfigSync').mockReturnValue({
      appId: 'cli_x',
      appSecret: 'sec',
      defaultReceiveId: 'oc_default',
      defaultReceiveIdType: 'chat_id',
    });
    sendSpy.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('channel:inbound 应调用 executeTaskStream 并向同一 chat 发回复', async () => {
    const off = registerFeishuSquidBridge(taskAPI as any);
    try {
      eventBridge.emitChannelInbound({
        channelId: 'feishu',
        text: '你好',
        chatId: 'oc_bridge_test',
      });

      await vi.waitFor(
        () => {
          expect(taskAPI.executeTaskStream).toHaveBeenCalled();
          expect(sendSpy).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      expect(taskAPI.prepareExternalConversation).toHaveBeenCalledWith(
        'feishubot_oc_bridge_test',
        '/tmp'
      );
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({ appId: 'cli_x' }),
        'reply-from-squid',
        'oc_bridge_test',
        'chat_id'
      );
    } finally {
      off();
    }
  });
});
