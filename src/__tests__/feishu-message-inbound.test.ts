import { describe, it, expect } from 'vitest';
import { parseFeishuImReceiveForInbound } from '../channels/feishu';

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

  it('摊平载荷根上存在无关 type 字段时仍解析（不误判事件类型）', () => {
    const r = parseFeishuImReceiveForInbound({
      schema: '2.0',
      event_type: 'im.message.receive_v1',
      type: 'message',
      message: {
        chat_id: 'oc_flat',
        message_id: 'mflat',
        message_type: 'text',
        content: JSON.stringify({ text: 'from-ws-flat' }),
      },
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_f' } },
    });
    expect(r?.text).toBe('from-ws-flat');
    expect(r?.chatId).toBe('oc_flat');
  });

  it('post 类型消息抽取正文', () => {
    const postContent = JSON.stringify({
      title: '标题',
      content: [[{ tag: 'text', text: '正文行' }]],
    });
    const r = parseFeishuImReceiveForInbound({
      message: {
        chat_id: 'oc_p',
        message_id: 'mp',
        message_type: 'post',
        content: postContent,
      },
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_p' } },
    });
    expect(r?.text).toContain('标题');
    expect(r?.text).toContain('正文行');
  });
});
