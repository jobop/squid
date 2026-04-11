import { describe, expect, it, vi } from 'vitest';
import { SaveMemoryTool } from '../tools/save-memory';

describe('SaveMemoryTool dedup', () => {
  const mockContext = {
    workDir: process.cwd(),
    taskId: 'test-task',
    mode: 'ask',
  } as any;

  it('type+name 精确匹配时应更新而不是新增', async () => {
    const tool = new SaveMemoryTool();
    const listMock = vi.fn().mockResolvedValue([
      {
        id: 'user_profile_1',
        metadata: {
          name: 'User Profile',
          description: 'basic profile memory',
          type: 'user',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
        content: 'old content',
      },
    ]);
    const updateMock = vi.fn().mockResolvedValue({
      id: 'user_profile_1',
    });
    const createMock = vi.fn();
    (tool as any).memoryManager = {
      list: listMock,
      update: updateMock,
      create: createMock,
    };

    const result = await tool.call(
      {
        type: 'user',
        name: ' user   profile ',
        description: 'updated profile memory',
        content: 'new content',
      },
      mockContext
    );

    expect(result.error).toBeUndefined();
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    expect(result.data.id).toBe('user_profile_1');
    expect(result.data.message).toContain('deduplicated by type+name');
  });

  it('description 近似匹配时应复用已有记忆', async () => {
    const tool = new SaveMemoryTool();
    const listMock = vi.fn().mockResolvedValue([
      {
        id: 'project_skillhub_2',
        metadata: {
          name: 'skillhub setup note',
          description: 'startup auto install skillhub cli and templates',
          type: 'project',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
        content: 'keep this memory',
      },
    ]);
    const updateMock = vi.fn();
    const createMock = vi.fn();
    (tool as any).memoryManager = {
      list: listMock,
      update: updateMock,
      create: createMock,
    };

    const result = await tool.call(
      {
        type: 'project',
        name: 'another name',
        description: 'auto install skillhub cli templates on startup',
        content: 'another content',
      },
      mockContext
    );

    expect(result.error).toBeUndefined();
    expect(updateMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(result.data.id).toBe('project_skillhub_2');
    expect(result.data.message).toContain('deduplicated by similar description');
  });
});

