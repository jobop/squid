import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { eventBridge } from '../channels/bridge/event-bridge';
import * as configStore from '../../extensions/feishu/src/config-store';
import * as larkClient from '../../extensions/feishu/src/lark-client';
import {
  bindFeishuExtensionEventBridge,
  getFeishuExtensionEventBridge,
} from '../../extensions/feishu/src/feishu-host-bridge';
import { registerFeishuSquidBridge } from '../../extensions/feishu/src/squid-bridge';

describe('Feishu squid bridge', () => {
  const sendSpy = vi.spyOn(larkClient, 'sendFeishuTextMessageTo');
  const downloadSpy = vi.spyOn(larkClient, 'downloadFeishuMessageResource');

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
    bindFeishuExtensionEventBridge(eventBridge);
    vi.spyOn(configStore, 'loadFeishuChannelConfigSync').mockReturnValue({
      appId: 'cli_x',
      appSecret: 'sec',
      defaultReceiveId: 'oc_default',
      defaultReceiveIdType: 'chat_id',
    });
    sendSpy.mockResolvedValue({ success: true });
    downloadSpy.mockResolvedValue({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
      fileName: 'inbound.png',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('channel:inbound 应调用 executeTaskStream 并向同一 chat 发回复', async () => {
    const off = registerFeishuSquidBridge(taskAPI as any);
    try {
      getFeishuExtensionEventBridge().emitChannelInbound({
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

  it('image 入站应下载并附加 file mention', async () => {
    const off = registerFeishuSquidBridge(taskAPI as any);
    try {
      getFeishuExtensionEventBridge().emitChannelInbound({
        channelId: 'feishu',
        text: '',
        chatId: 'oc_bridge_media',
        messageId: 'mid_001',
        raw: { media: [{ kind: 'image', resourceKey: 'img_key_001' }] },
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

  it('收到 /wtf 时应透传给 TaskAPI 统一命令分支', async () => {
    const off = registerFeishuSquidBridge(taskAPI as any);
    try {
      getFeishuExtensionEventBridge().emitChannelInbound({
        channelId: 'feishu',
        text: '/wtf',
        chatId: 'oc_bridge_stop',
      });

      await vi.waitFor(
        () => {
          expect(taskAPI.executeTaskStream).toHaveBeenCalled();
        },
        { timeout: 3000 }
      );

      const req = taskAPI.executeTaskStream.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(req.instruction).toBe('/wtf');
    } finally {
      off();
    }
  });
});
