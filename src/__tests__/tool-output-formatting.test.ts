import { describe, expect, it } from 'vitest';
import { ReadFileTool } from '../tools/read-file';
import { GrepTool } from '../tools/grep';
import { WebFetchTool } from '../tools/web-fetch';
import { WriteFileTool } from '../tools/write-file';
import { FileEditTool } from '../tools/file-edit';
import { WebSearchTool } from '../tools/web-search';

describe('tool output formatting', () => {
  it('read_file 应在长内容时返回截断预览', () => {
    const longContent = `line-0\n${'x'.repeat(5000)}\nline-end`;
    const block = ReadFileTool.mapToolResultToToolResultBlockParam(
      longContent,
      'tool-read'
    );
    const content = String(block.content);
    expect(content).toContain('[read_file] File content preview');
    expect(content).toContain('[truncated');
  });

  it('grep 应限制展示条数并标注省略数量', () => {
    const matches = Array.from({ length: 30 }, (_, i) => ({
      file: 'demo.ts',
      line: i + 1,
      content: `match-${i}`,
    }));
    const block = GrepTool.mapToolResultToToolResultBlockParam(matches, 'tool-grep');
    const content = String(block.content);
    expect(content).toContain('Found 30 matches (showing 20)');
    expect(content).toContain('more matches omitted');
  });

  it('web_fetch 应返回摘要预览而非全量正文', () => {
    const block = WebFetchTool.mapToolResultToToolResultBlockParam(
      {
        url: 'https://example.com',
        content: 'a'.repeat(4000),
        bytes: 4000,
        code: 200,
        codeText: 'OK',
        contentType: 'text/html',
        durationMs: 12,
      },
      'tool-fetch'
    );
    const content = String(block.content);
    expect(content).toContain('Content chars: 4000 (truncated)');
    expect(content).toContain('Preview:');
    expect(content).toContain('[truncated');
  });

  it('web_search 应仅展示前若干条结果', () => {
    const block = WebSearchTool.mapToolResultToToolResultBlockParam(
      {
        success: true,
        query: 'q',
        count: 6,
        results: Array.from({ length: 6 }, (_, i) => ({
          title: `title-${i}`,
          link: `https://example.com/${i}`,
          snippet: `snippet-${i}`,
        })),
      },
      'tool-search'
    );
    const content = String(block.content);
    expect(content).toContain('总结果: 6 条（展示前 3 条）');
    expect(content).toContain('其余 3 条已省略');
  });

  it('write_file 成功应返回极简信息', () => {
    const block = WriteFileTool.mapToolResultToToolResultBlockParam(
      'File written: notes/demo.md',
      'tool-write'
    );
    expect(String(block.content)).toBe('OK: wrote notes/demo.md');
  });

  it('file_edit 失败应标记 is_error 并返回失败原因', () => {
    const block = FileEditTool.mapToolResultToToolResultBlockParam(
      {
        success: false,
        message: '未找到匹配',
        replacements: 0,
        filePath: 'a.txt',
      },
      'tool-edit'
    );
    expect(block.is_error).toBe(true);
    expect(String(block.content)).toContain('FAILED: 未找到匹配');
  });
});
