import { describe, it, expect, vi } from 'vitest';
import {
  attachRequestAbortHandler,
  cancelStreamForConversation,
} from '../bun/task-execute-stream-route';

describe('task-execute-stream-route helpers', () => {
  it('request signal abort 时应调用 abortConversation', () => {
    const controller = new AbortController();
    const api = {
      abortConversation: vi.fn().mockReturnValue(true),
    };

    const detach = attachRequestAbortHandler(controller.signal, api, 'tid_1');
    controller.abort();

    expect(api.abortConversation).toHaveBeenCalledTimes(1);
    expect(api.abortConversation).toHaveBeenCalledWith('tid_1');
    detach();
  });

  it('detach 后 signal abort 不应再触发 abortConversation', () => {
    const controller = new AbortController();
    const api = {
      abortConversation: vi.fn().mockReturnValue(true),
    };

    const detach = attachRequestAbortHandler(controller.signal, api, 'tid_2');
    detach();
    controller.abort();

    expect(api.abortConversation).not.toHaveBeenCalled();
  });

  it('cancelStreamForConversation 应透传 abortConversation 返回值', () => {
    const apiTrue = {
      abortConversation: vi.fn().mockReturnValue(true),
    };
    const apiFalse = {
      abortConversation: vi.fn().mockReturnValue(false),
    };

    expect(cancelStreamForConversation(apiTrue, 'tid_a')).toBe(true);
    expect(apiTrue.abortConversation).toHaveBeenCalledWith('tid_a');
    expect(cancelStreamForConversation(apiFalse, 'tid_b')).toBe(false);
    expect(apiFalse.abortConversation).toHaveBeenCalledWith('tid_b');
  });
});
