import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBridge } from '../channels/bridge/event-bridge';
import * as configStore from '../../extensions/weixin-personal/src/config-store';
import * as ilinkApi from '../../extensions/weixin-personal/src/ilink-api';
import { registerWeixinPersonalSquidBridge } from '../../extensions/weixin-personal/src/squid-bridge';

describe('Weixin personal squid bridge', () => {
  const sendSpy = vi.spyOn(ilinkApi, 'ilinkSendTextMessage');
  const downloadSpy = vi.spyOn(ilinkApi, 'ilinkDownloadImageByUrl');

  const taskAPI = {
    getWorkspaceConfig: vi.fn().mockResolvedValue({ workspace: '/tmp' }),
    prepareExternalConversation: vi.fn().mockResolvedValue(undefined),
    executeTaskStream: vi.fn().mockImplementation(async (_req: unknown, onChunk: (c: string) => void) => {
      onChunk('reply-from-squid');
    }),
    addChannelQueuedCompleteHandler: vi.fn(() => () => {}),
    enqueueFromRequest: vi.fn().mockReturnValue(1),
  };

  beforeEach(() => {
    vi.spyOn(configStore, 'loadWeixinPersonalChannelConfigSync').mockReturnValue({
      botToken: 'wx_token',
      baseUrl: 'https://wx.example.com',
      allowedUserIds: ['u1@im.wechat'],
    });
    sendSpy.mockResolvedValue({ ok: true });
    downloadSpy.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/jpeg',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('纯图片入站应转为 mention 并执行', async () => {
    const off = registerWeixinPersonalSquidBridge(taskAPI as any, eventBridge);
    try {
      eventBridge.emitChannelInbound({
        channelId: 'weixin-personal',
        text: '',
        chatId: 'u1@im.wechat',
        raw: { media: [{ url: '/media/abc.jpg', mimeType: 'image/jpeg', fileName: 'abc.jpg' }] },
      });

      await vi.waitFor(
        () => {
          expect(downloadSpy).toHaveBeenCalled();
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
