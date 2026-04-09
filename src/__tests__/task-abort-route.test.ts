import { describe, it, expect, vi } from 'vitest';
import { handleAbortTaskRoute } from '../bun/task-abort-route';

describe('handleAbortTaskRoute', () => {
  it('缺少 conversationId 时返回 400', () => {
    const api = {
      abortConversation: vi.fn(),
    };

    const result = handleAbortTaskRoute(api, {});
    expect(result.status).toBe(400);
    expect(result.payload.success).toBe(false);
    expect(result.payload.error).toContain('conversationId');
    expect(api.abortConversation).not.toHaveBeenCalled();
  });

  it('conversationId 为空白时返回 400', () => {
    const api = {
      abortConversation: vi.fn(),
    };

    const result = handleAbortTaskRoute(api, { conversationId: '   ' });
    expect(result.status).toBe(400);
    expect(result.payload.success).toBe(false);
    expect(api.abortConversation).not.toHaveBeenCalled();
  });

  it('有效 conversationId 时返回 aborted=true', () => {
    const api = {
      abortConversation: vi.fn().mockReturnValue(true),
    };

    const result = handleAbortTaskRoute(api, { conversationId: 'tid_1' });
    expect(result.status).toBe(200);
    expect(result.payload).toEqual({
      success: true,
      aborted: true,
      conversationId: 'tid_1',
    });
    expect(api.abortConversation).toHaveBeenCalledWith('tid_1');
  });

  it('有效 conversationId 时返回 aborted=false', () => {
    const api = {
      abortConversation: vi.fn().mockReturnValue(false),
    };

    const result = handleAbortTaskRoute(api, { conversationId: 'tid_2' });
    expect(result.status).toBe(200);
    expect(result.payload).toEqual({
      success: true,
      aborted: false,
      conversationId: 'tid_2',
    });
    expect(api.abortConversation).toHaveBeenCalledWith('tid_2');
  });
});
