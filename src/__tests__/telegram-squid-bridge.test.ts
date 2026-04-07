import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBridge } from '../channels/bridge/event-bridge';
import * as configStore from '../../extensions/telegram/src/config-store';
import * as tgClient from '../../extensions/telegram/src/telegram-client';
import { registerTelegramSquidBridge } from '../channels/telegram';

describe('Telegram squid bridge', () => {
  const sendSpy = vi.spyOn(tgClient, 'telegramSendMessage');

  const taskAPI = {
    getWorkspaceConfig: vi.fn().mockResolvedValue({ workspace: '/tmp' }),
    prepareExternalConversation: vi.fn().mockResolvedValue(undefined),
    executeTaskStream: vi.fn().mockImplementation(async (_req: unknown, onChunk: (c: string) => void) => {
      onChunk('reply-from-squid');
    }),
    setChannelQueuedCompleteHandler: vi.fn(),
    addChannelQueuedCompleteHandler: vi.fn(() => () => {}),
    enqueueFromRequest: vi.fn().mockReturnValue(1),
  };

  beforeEach(() => {
    vi.spyOn(configStore, 'loadTelegramChannelConfigSync').mockReturnValue({
      botToken: '123:ABC',
      apiBase: 'https://api.telegram.org',
    });
    sendSpy.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('channel:inbound 应调用 executeTaskStream 并向同一 chat 发回复', async () => {
    const off = registerTelegramSquidBridge(taskAPI as any, eventBridge);
    try {
      eventBridge.emitChannelInbound({
        channelId: 'telegram',
        text: '你好',
        chatId: '999001',
      });

      await vi.waitFor(
        () => {
          expect(taskAPI.executeTaskStream).toHaveBeenCalled();
          expect(sendSpy).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      expect(taskAPI.prepareExternalConversation).toHaveBeenCalledWith(
        'telegrambot_999001',
        '/tmp'
      );
      expect(sendSpy).toHaveBeenCalledWith(
        '123:ABC',
        '999001',
        'reply-from-squid',
        expect.objectContaining({ apiBase: 'https://api.telegram.org' })
      );
    } finally {
      off();
    }
  });
});
