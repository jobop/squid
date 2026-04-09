import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBridge } from '../channels/bridge/event-bridge';
import * as configStore from '../../extensions/telegram/src/config-store';
import * as tgClient from '../../extensions/telegram/src/telegram-client';
import { registerTelegramSquidBridge } from '../../extensions/telegram/src/squid-bridge';

describe('Telegram squid bridge', () => {
  const sendSpy = vi.spyOn(tgClient, 'telegramSendMessage');
  const downloadSpy = vi.spyOn(tgClient, 'telegramDownloadFileById');

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
    downloadSpy.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      filePath: 'photos/pic.jpg',
      contentType: 'image/jpeg',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  it('纯图片入站应转为 file mention 并执行', async () => {
    const off = registerTelegramSquidBridge(taskAPI as any, eventBridge);
    try {
      eventBridge.emitChannelInbound({
        channelId: 'telegram',
        text: '',
        chatId: '999002',
        raw: { media: [{ kind: 'photo', fileId: 'tg-file-1' }] },
      });

      await vi.waitFor(
        () => {
          expect(downloadSpy).toHaveBeenCalledWith(
            '123:ABC',
            'tg-file-1',
            expect.objectContaining({ apiBase: 'https://api.telegram.org' })
          );
          expect(taskAPI.executeTaskStream).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const req = taskAPI.executeTaskStream.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(req.instruction).toBe('请识别并描述用户发送的图片内容。');
      expect(req.mentions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'file', path: expect.stringMatching(/^\.squid\/attachments\//) }),
        ])
      );
    } finally {
      off();
    }
  });
});
