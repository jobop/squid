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

  it('/new 应仅清空会话消息且不调用 executor', async () => {
    const clearSpy = vi
      .spyOn(api, 'clearThreadMessages')
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
    expect(clearSpy).toHaveBeenCalledWith('tid_new');
    expect(executeStreamSpy).not.toHaveBeenCalled();
    expect(chunks.join('')).toContain('已清空当前会话');
  });

  it('/reset 应调用 newSessionClearAll 且不调用 executor', async () => {
    const resetSpy = vi
      .spyOn(api, 'newSessionClearAll')
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
    expect(resetSpy).toHaveBeenCalledWith('tid_reset');
    expect(executeStreamSpy).not.toHaveBeenCalled();
    expect(chunks.join('')).toContain('长期记忆');
  });

  it('selectedSkills 存在时应构造显式技能前缀并传给 executor', async () => {
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '帮我检查这个仓库',
        selectedSkills: [{ name: 'github' }, { name: 'list-skills', args: 'verbose' }],
      },
      (c) => chunks.push(c)
    );

    expect(executeStreamSpy).toHaveBeenCalledTimes(1);
    const req = executeStreamSpy.mock.calls[0]?.[0] as { instruction: string };
    expect(req.instruction).toContain('## User Selected Skills');
    expect(req.instruction).toContain('- github');
    expect(req.instruction).toContain('- list-skills (args: verbose)');
    expect(req.instruction).toContain('## User Instruction');
    expect(req.instruction).toContain('帮我检查这个仓库');
  });

  it('expertId 有效时应注入专家前缀并传给 executor', async () => {
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '帮我优化一个页面',
        expertId: 'software-engineer',
      },
      (c) => chunks.push(c)
    );

    expect(executeStreamSpy).toHaveBeenCalledTimes(1);
    const req = executeStreamSpy.mock.calls[0]?.[0] as { instruction: string };
    expect(req.instruction).toContain('## User Selected Expert');
    expect(req.instruction).toContain('- name: 软件工程师');
    expect(req.instruction).toContain('- role: 全栈开发专家');
    expect(req.instruction).toContain('## User Instruction');
    expect(req.instruction).toContain('帮我优化一个页面');
  });

  it('expertId 无效时不应注入专家前缀', async () => {
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '帮我优化一个页面',
        expertId: 'expert-not-exists',
      },
      (c) => chunks.push(c)
    );

    expect(executeStreamSpy).toHaveBeenCalledTimes(1);
    const req = executeStreamSpy.mock.calls[0]?.[0] as { instruction: string };
    expect(req.instruction).not.toContain('## User Selected Expert');
    expect(req.instruction).toBe('帮我优化一个页面');
  });

  it('expertId 与 selectedSkills 同时存在时，专家前缀应在技能前缀之前', async () => {
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '检查当前项目',
        expertId: 'software-engineer',
        selectedSkills: [{ name: 'github' }],
      },
      (c) => chunks.push(c)
    );

    expect(executeStreamSpy).toHaveBeenCalledTimes(1);
    const req = executeStreamSpy.mock.calls[0]?.[0] as { instruction: string };
    const expertIdx = req.instruction.indexOf('## User Selected Expert');
    const skillsIdx = req.instruction.indexOf('## User Selected Skills');
    expect(expertIdx).toBeGreaterThanOrEqual(0);
    expect(skillsIdx).toBeGreaterThan(expertIdx);
    expect(req.instruction).toContain('- github');
    expect(req.instruction).toContain('## User Instruction');
  });

  it('startInNewThread=true 时应忽略 currentConversationId 并新建线程', async () => {
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '旧线程首条消息',
      },
      (c) => chunks.push(c)
    );
    const oldId = (api as any).currentConversationId as string;
    expect(oldId).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 2));

    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '新线程首条消息',
        startInNewThread: true,
      },
      (c) => chunks.push(c)
    );

    const newId = (api as any).currentConversationId as string;
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(oldId);
  });

  it('队列路径下 startInNewThread=true 也不应复用 currentConversationId', async () => {
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '队列旧线程消息',
      },
      (c) => chunks.push(c)
    );
    const oldId = (api as any).currentConversationId as string;
    expect(oldId).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 2));

    await api.runFromQueue({
      conversationId: '__squid_default_conversation__',
      value: '队列新线程消息',
      mode: 'ask',
      workspace: process.cwd(),
      startInNewThread: true,
      source: 'user',
    });

    const newId = (api as any).currentConversationId as string;
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(oldId);
  });

  it('startInNewThread=true 时队列分桶键应唯一，避免共享默认会话桶', () => {
    const id1 = api.resolveConversationIdForQueue({
      mode: 'ask',
      workspace: process.cwd(),
      instruction: 'first',
      startInNewThread: true,
    });
    const id2 = api.resolveConversationIdForQueue({
      mode: 'ask',
      workspace: process.cwd(),
      instruction: 'second',
      startInNewThread: true,
    });

    expect(id1).toMatch(/^__squid_new_thread__:/);
    expect(id2).toMatch(/^__squid_new_thread__:/);
    expect(id1).not.toBe(id2);
    expect(id1).not.toBe('__squid_default_conversation__');
    expect(id2).not.toBe('__squid_default_conversation__');
  });
});
