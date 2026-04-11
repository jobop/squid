import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSearchTool } from '../tools/web-search';
import type { ToolContext } from '../tools/base';
import axios from 'axios';

// Mock axios
vi.mock('axios');

describe('WebSearchTool', () => {
  const mockContext: ToolContext = {
    workDir: process.cwd(),
    taskId: 'test-task',
    mode: 'craft'
  };

  /** 避免测试机 ~/.squid/config.json 里选了必应，导致 mock 的 DDG HTML 被必应解析器解析失败 */
  beforeEach(() => {
    vi.stubEnv('WEB_SEARCH_PROVIDER', 'duckduckgo');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('应该返回错误当查询为空', async () => {
    const result = await WebSearchTool.call(
      {
        query: ''
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('不能为空');
    expect(result.data.count).toBe(0);
  });

  it('应该成功解析搜索结果', async () => {
    const mockHtml = `
      <html>
        <body>
          <div class="result">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com">Example Title 1</a>
            <div class="result__snippet">This is a snippet 1</div>
            <div class="result__url">example.com</div>
          </div>
          <div class="result">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample2.com">Example Title 2</a>
            <div class="result__snippet">This is a snippet 2</div>
            <div class="result__url">example2.com</div>
          </div>
        </body>
      </html>
    `;

    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml });

    const result = await WebSearchTool.call(
      {
        query: 'test query'
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.count).toBe(2);
    expect(result.data.results).toHaveLength(2);
    expect(result.data.results[0].title).toBe('Example Title 1');
    expect(result.data.results[0].link).toBe('https://example.com');
    expect(result.data.results[0].snippet).toBe('This is a snippet 1');
  });

  it('应该限制结果数量', async () => {
    const mockHtml = `
      <html>
        <body>
          ${Array.from({ length: 20 }, (_, i) => `
            <div class="result">
              <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample${i}.com">Title ${i}</a>
              <div class="result__snippet">Snippet ${i}</div>
            </div>
          `).join('')}
        </body>
      </html>
    `;

    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml });

    const result = await WebSearchTool.call(
      {
        query: 'test query',
        max_results: 5
      },
      mockContext
    );

    expect(result.data.success).toBe(true);
    expect(result.data.count).toBe(5);
    expect(result.data.results).toHaveLength(5);
  });

  it('应该处理网络错误', async () => {
    vi.mocked(axios.get).mockRejectedValue(new Error('Network error'));

    const result = await WebSearchTool.call(
      {
        query: 'test query'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.error).toContain('Network error');
    expect(result.data.count).toBe(0);
  });

  it('应该处理空结果', async () => {
    const mockHtml = '<html><body></body></html>';

    vi.mocked(axios.get).mockResolvedValue({ data: mockHtml });

    const result = await WebSearchTool.call(
      {
        query: 'test query'
      },
      mockContext
    );

    expect(result.data.success).toBe(false);
    expect(result.data.count).toBe(0);
    expect(result.data.results).toHaveLength(0);
    expect(result.data.error).toMatch(/未解析到结果/);
  });

  it('mapToolResultToToolResultBlockParam 应该正确格式化输出', () => {
    const output = {
      success: true,
      query: 'test query',
      results: [
        {
          title: 'Example',
          link: 'https://example.com',
          snippet: 'Example snippet'
        }
      ],
      count: 1
    };

    const result = WebSearchTool.mapToolResultToToolResultBlockParam(output, 'test-id');

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe('test-id');
    expect(result.content).toContain('搜索查询: test query');
    expect(result.content).toContain('总结果: 1 条');
    expect(result.content).toContain('1. Example');
    expect(result.content).toContain('链接: https://example.com');
  });

  it('应该正确标记为只读操作', () => {
    expect(WebSearchTool.isConcurrencySafe()).toBe(true);
    expect(WebSearchTool.isReadOnly()).toBe(true);
    expect(WebSearchTool.isDestructive?.()).toBe(false);
  });
});
