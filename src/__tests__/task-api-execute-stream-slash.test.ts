import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskExecutor } from '../tasks/executor';
import { TaskAPI } from '../api/task-api';

describe('TaskAPI.executeTaskStream slash commands', () => {
  let api: TaskAPI;
  let executeStreamSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    api = new TaskAPI();
    executeStreamSpy = vi
      .spyOn(TaskExecutor.prototype, 'executeStream')
      .mockResolvedValue(undefined as unknown as void);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('/reset 应清空会话且不调用 executor', async () => {
    const clearSpy = vi
      .spyOn(api, 'clearThreadMessages')
      .mockResolvedValue({ success: true, threadId: 'tid_reset' });
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '/reset',
        conversationId: 'tid_reset',
      },
      (c) => chunks.push(c)
    );
    expect(clearSpy).toHaveBeenCalledWith('tid_reset');
    expect(executeStreamSpy).not.toHaveBeenCalled();
    expect(chunks.join('')).toContain('已清空当前会话');
  });

  it('/new 应调用 newSessionClearAll 且不调用 executor', async () => {
    const newSpy = vi
      .spyOn(api, 'newSessionClearAll')
      .mockResolvedValue({ success: true, threadId: 'tid_new' });
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '/new',
        conversationId: 'tid_new',
      },
      (c) => chunks.push(c)
    );
    expect(newSpy).toHaveBeenCalledWith('tid_new');
    expect(executeStreamSpy).not.toHaveBeenCalled();
    expect(chunks.join('')).toContain('长期记忆');
  });
});
