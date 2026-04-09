import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('/wtf 在无运行任务时应返回提示且不调用 executor', async () => {
    const abortSpy = vi.spyOn(api, 'abortConversation');
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '/wtf',
        conversationId: 'tid_wtf_idle',
      },
      (c) => chunks.push(c)
    );
    expect(abortSpy).toHaveBeenCalledWith('tid_wtf_idle');
    expect(executeStreamSpy).not.toHaveBeenCalled();
    expect(chunks.join('')).toContain('没有可中断');
  });

  it('会话忙时 /wtf 应即时中断且不抛 busy', async () => {
    const conversationId = 'tid_wtf_busy';
    const runAbortController = new AbortController();
    (api as any).runningConversations.add(conversationId);
    (api as any).runningConversationAbortControllers.set(conversationId, runAbortController);

    const chunks: string[] = [];
    await expect(
      api.executeTaskStream(
        {
          mode: 'ask',
          workspace: process.cwd(),
          instruction: '/wtf',
          conversationId,
        },
        (c) => chunks.push(c)
      )
    ).resolves.toBeUndefined();

    expect(runAbortController.signal.aborted).toBe(true);
    expect(executeStreamSpy).not.toHaveBeenCalled();
    expect(chunks.join('')).toContain('已中断当前生成');
  });

  it('mentions skill 存在时应构造显式技能前缀并传给 executor', async () => {
    vi.spyOn((api as any).skillLoader, 'listSkillSummaries').mockResolvedValue([
      {
        name: 'github',
        description: 'GitHub skill',
        userInvocable: true,
        filePath: 'github/SKILL.md',
        rootDir: '/tmp',
      },
      {
        name: 'list-skills',
        description: 'List skills',
        userInvocable: true,
        filePath: 'list/SKILL.md',
        rootDir: '/tmp',
      },
    ]);
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '帮我检查这个仓库',
        mentions: [
          { type: 'skill', name: 'github' },
          { type: 'skill', name: 'list-skills', args: 'verbose' },
        ],
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

  it('mentions 包含 skill 时应通过统一管线注入技能前缀', async () => {
    vi.spyOn((api as any).skillLoader, 'listSkillSummaries').mockResolvedValue([
      {
        name: 'github',
        description: 'GitHub skill',
        userInvocable: true,
        filePath: 'github/SKILL.md',
        rootDir: '/tmp',
      },
    ]);
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '请调用技能处理',
        mentions: [{ type: 'skill', name: 'github', args: 'verbose' }],
      },
      (c) => chunks.push(c)
    );

    expect(executeStreamSpy).toHaveBeenCalledTimes(1);
    const req = executeStreamSpy.mock.calls[0]?.[0] as { instruction: string };
    expect(req.instruction).toContain('## User Selected Skills');
    expect(req.instruction).toContain('- github (args: verbose)');
    expect(req.instruction).toContain('请调用技能处理');
  });

  it('mentions 引用不存在 skill 时应报错且不调用 executor', async () => {
    vi.spyOn((api as any).skillLoader, 'listSkillSummaries').mockResolvedValue([]);
    await expect(
      api.executeTaskStream(
        {
          mode: 'ask',
          workspace: process.cwd(),
          instruction: '尝试调用不存在技能',
          mentions: [{ type: 'skill', name: 'missing-skill' }],
        },
        () => {}
      )
    ).rejects.toThrow(/技能引用不可用/);
    expect(executeStreamSpy).not.toHaveBeenCalled();
  });

  it('mentions 文件有效时应注入文件前缀并传给 executor', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'squid-mention-test-'));
    try {
      await mkdir(join(ws, 'src'), { recursive: true });
      await writeFile(join(ws, 'src', 'main.ts'), 'export const ok = true;\n', 'utf-8');
      const chunks: string[] = [];
      await api.executeTaskStream(
        {
          mode: 'ask',
          workspace: ws,
          instruction: '请阅读我提到的文件',
          mentions: [{ type: 'file', path: 'src/main.ts' }],
        },
        (c) => chunks.push(c)
      );

      expect(executeStreamSpy).toHaveBeenCalledTimes(1);
      const req = executeStreamSpy.mock.calls[0]?.[0] as { instruction: string };
      expect(req.instruction).toContain('## User Mentioned Files');
      expect(req.instruction).toContain('- src/main.ts');
      expect(req.instruction).toContain('请阅读我提到的文件');
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it('粘贴图片 attachments 应传递给 executor', async () => {
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '请描述这张图',
        attachments: [
          {
            type: 'image',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAJUb9JkAAAAASUVORK5CYII=',
            source: 'paste',
            name: 'clipboard.png',
          },
        ],
      },
      (c) => chunks.push(c)
    );

    expect(executeStreamSpy).toHaveBeenCalledTimes(1);
    const req = executeStreamSpy.mock.calls[0]?.[0] as { attachments?: Array<{ source?: string; mimeType?: string }> };
    expect(Array.isArray(req.attachments)).toBe(true);
    expect(req.attachments?.length).toBe(1);
    expect(req.attachments?.[0]?.mimeType).toBe('image/png');
    expect(req.attachments?.[0]?.source).toBe('paste');
  });

  it('mentions 中的图片文件应自动转为 image attachment', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'squid-mention-image-'));
    try {
      await mkdir(join(ws, 'assets'), { recursive: true });
      await writeFile(
        join(ws, 'assets', 'icon.png'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
      );
      await api.executeTaskStream(
        {
          mode: 'ask',
          workspace: ws,
          instruction: '请结合图片分析',
          mentions: [{ type: 'file', path: 'assets/icon.png' }],
        },
        () => {}
      );

      expect(executeStreamSpy).toHaveBeenCalledTimes(1);
      const req = executeStreamSpy.mock.calls[0]?.[0] as { attachments?: Array<{ source?: string; path?: string }> };
      expect(req.attachments?.length).toBe(1);
      expect(req.attachments?.[0]?.source).toBe('mention');
      expect(req.attachments?.[0]?.path).toBe('assets/icon.png');
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });

  it('attachments dataUrl 非法时应报错且不调用 executor', async () => {
    await expect(
      api.executeTaskStream(
        {
          mode: 'ask',
          workspace: process.cwd(),
          instruction: '请分析图片',
          attachments: [
            {
              type: 'image',
              mimeType: 'image/png',
              dataUrl: 'invalid-data-url',
            },
          ],
        },
        () => {}
      )
    ).rejects.toThrow(/dataUrl 格式非法/);
    expect(executeStreamSpy).not.toHaveBeenCalled();
  });

  it('mentions 文件无效时应报错且不调用 executor', async () => {
    const ws = await mkdtemp(join(tmpdir(), 'squid-mention-invalid-'));
    try {
      await expect(
        api.executeTaskStream(
          {
            mode: 'ask',
            workspace: ws,
            instruction: '读取不存在文件',
            mentions: [{ type: 'file', path: 'no/such/file.ts' }],
          },
          () => {}
        )
      ).rejects.toThrow(/不存在或不可访问/);
      expect(executeStreamSpy).not.toHaveBeenCalled();
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
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

  it('expertId 与 mentions skill 同时存在时，专家前缀应在技能前缀之前', async () => {
    vi.spyOn((api as any).skillLoader, 'listSkillSummaries').mockResolvedValue([
      {
        name: 'github',
        description: 'GitHub skill',
        userInvocable: true,
        filePath: 'github/SKILL.md',
        rootDir: '/tmp',
      },
    ]);
    const chunks: string[] = [];
    await api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '检查当前项目',
        expertId: 'software-engineer',
        mentions: [{ type: 'skill', name: 'github' }],
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

  it('abortConversation 后应中断 executeTaskStream 并释放 busy 状态', async () => {
    executeStreamSpy.mockImplementationOnce(async (request: any) => {
      const signal = request.abortSignal as AbortSignal | undefined;
      expect(signal).toBeDefined();
      await new Promise<void>((_resolve, reject) => {
        if (!signal) {
          reject(new Error('missing abort signal'));
          return;
        }
        if (signal.aborted) {
          const err = new Error('aborted') as Error & { name: string };
          err.name = 'AbortError';
          reject(err);
          return;
        }
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          const err = new Error('aborted') as Error & { name: string };
          err.name = 'AbortError';
          reject(err);
        };
        signal.addEventListener('abort', onAbort);
      });
    });

    const chunks: string[] = [];
    const conversationId = 'tid_abort_test';
    const runPromise = api.executeTaskStream(
      {
        mode: 'ask',
        workspace: process.cwd(),
        instruction: '这条消息会被中断',
        conversationId,
      },
      (c) => chunks.push(c)
    );

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(api.isConversationBusy(conversationId)).toBe(true);
    expect(api.abortConversation(conversationId)).toBe(true);

    await runPromise;

    expect(executeStreamSpy).toHaveBeenCalledTimes(1);
    expect(chunks.join('')).toContain('已中断当前生成');
    expect(api.isConversationBusy(conversationId)).toBe(false);
    expect(api.abortConversation(conversationId)).toBe(false);
  });

  it('abortConversation 对空会话和未知会话应返回 false', () => {
    expect(api.abortConversation('')).toBe(false);
    expect(api.abortConversation('   ')).toBe(false);
    expect(api.abortConversation('unknown_conversation')).toBe(false);
  });
});
