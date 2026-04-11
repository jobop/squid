import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileEditTool } from '../tools/file-edit';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import type { ToolContext } from '../tools/base';

describe('FileEditTool', () => {
  const testDir = join(process.cwd(), 'test-temp-file-edit');
  const testFile = 'test.txt';
  const testFilePath = join(testDir, testFile);

  const mockContext: ToolContext = {
    workDir: testDir,
    taskId: 'test-task',
    mode: 'craft'
  };

  beforeEach(async () => {
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('应该成功替换单个匹配项', async () => {
    await writeFile(testFilePath, 'Hello World\nHello Universe', 'utf-8');

    const result = await FileEditTool.call(
      {
        file_path: testFile,
        old_string: 'Hello World',
        new_string: 'Hi World'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.replacements).toBe(1);

    const content = await readFile(testFilePath, 'utf-8');
    expect(content).toBe('Hi World\nHello Universe');
  });

  it('应该检测到多处匹配并返回错误（未设置 replace_all）', async () => {
    await writeFile(testFilePath, 'Hello World\nHello Universe\nHello Again', 'utf-8');

    const result = await FileEditTool.call(
      {
        file_path: testFile,
        old_string: 'Hello',
        new_string: 'Hi'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.message).toContain('找到 3 处匹配');
    expect(result.data.replacements).toBe(0);
  });

  it('应该替换所有匹配项（设置 replace_all=true）', async () => {
    await writeFile(testFilePath, 'Hello World\nHello Universe\nHello Again', 'utf-8');

    const result = await FileEditTool.call(
      {
        file_path: testFile,
        old_string: 'Hello',
        new_string: 'Hi',
        replace_all: true
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.replacements).toBe(3);

    const content = await readFile(testFilePath, 'utf-8');
    expect(content).toBe('Hi World\nHi Universe\nHi Again');
  });

  it('应该返回错误当未找到匹配项', async () => {
    await writeFile(testFilePath, 'Hello World', 'utf-8');

    const result = await FileEditTool.call(
      {
        file_path: testFile,
        old_string: 'Goodbye',
        new_string: 'Hi'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.message).toContain('未找到匹配的字符串');
    expect(result.data.replacements).toBe(0);
  });

  it('应该返回错误当文件不存在', async () => {
    const result = await FileEditTool.call(
      {
        file_path: 'nonexistent.txt',
        old_string: 'Hello',
        new_string: 'Hi'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('mapToolResultToToolResultBlockParam 应该正确格式化输出', () => {
    const output = {
      success: true,
      message: '成功替换 1 处内容',
      replacements: 1,
      filePath: 'test.txt'
    };

    const result = FileEditTool.mapToolResultToToolResultBlockParam(output, 'test-id');

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('test-id');
    expect(result.content).toContain('OK: replacements=1 file=test.txt');
  });

  it('应该正确标记并发安全（依路径）与破坏性操作', () => {
    expect(FileEditTool.isConcurrencySafe()).toBe(false);
    expect(
      FileEditTool.isConcurrencySafe({
        file_path: 'x.ts',
        old_string: 'a',
        new_string: 'b',
      })
    ).toBe(true);
    expect(FileEditTool.isReadOnly()).toBe(false);
    expect(FileEditTool.isDestructive?.()).toBe(true);
  });
});
