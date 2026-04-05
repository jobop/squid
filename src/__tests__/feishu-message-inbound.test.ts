import { describe, it, expect } from 'vitest';
import { parseFeishuImReceiveForInbound } from '../channels/feishu/message-inbound';

describe('parseFeishuImReceiveForInbound', () => {
  it('解析 2.0 整包', () => {
    const r = parseFeishuImReceiveForInbound({
      schema: '2.0',
      header: { event_type: 'im.message.receive_v1' },
      event: {
        message: {
          chat_id: 'oc_1',
          message_id: 'm1',
          message_type: 'text',
          content: JSON.stringify({ text: 'hi' }),
        },
        sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
      },
    });
    expect(r?.text).toBe('hi');
    expect(r?.chatId).toBe('oc_1');
    expect(r?.senderOpenId).toBe('ou_1');
  });

  it('解析 SDK 扁平 event 体', () => {
    const r = parseFeishuImReceiveForInbound({
      message: {
        chat_id: 'oc_2',
        message_id: 'm2',
        message_type: 'text',
        content: JSON.stringify({ text: 'flat' }),
      },
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_2' } },
    });
    expect(r?.text).toBe('flat');
    expect(r?.chatId).toBe('oc_2');
  });

  it('忽略机器人自身消息', () => {
    const r = parseFeishuImReceiveForInbound({
      message: {
        chat_id: 'oc_1',
        message_id: 'm1',
        message_type: 'text',
        content: JSON.stringify({ text: 'x' }),
      },
      sender: { sender_type: 'app', sender_id: {} },
    });
    expect(r).toBeNull();
  });
});
