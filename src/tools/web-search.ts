import axios from 'axios';
import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { z } from 'zod';
import { readWebSearchProviderRawFromSquidConfigRoot } from '../config/tools-config';
import {
  parseBingCnHtml,
  parseDuckDuckGoHtml,
  type WebSearchProviderId,
  normalizeWebSearchProvider,
} from './web-search-providers';

const WebSearchInputSchema = z.object({
  query: z.string().describe('搜索查询'),
  max_results: z.number().optional().describe('最大结果数量（默认 10）')
});

type WebSearchInput = z.infer<typeof WebSearchInputSchema>;

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

interface WebSearchOutput {
  success: boolean;
  query: string;
  results: SearchResult[];
  count: number;
  error?: string;
  provider?: WebSearchProviderId;
}

/** 可用环境变量 WEB_SEARCH_TIMEOUT_MS（5000–120000）覆盖 */
const WEB_SEARCH_TIMEOUT_MS = (() => {
  const raw = process.env.WEB_SEARCH_TIMEOUT_MS;
  if (raw != null && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 5000 && n <= 120_000) return Math.floor(n);
  }
  return 55_000;
})();

async function resolveWebSearchProvider(): Promise<WebSearchProviderId> {
  const env = process.env.WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  if (env === 'bing' || env === 'duckduckgo') {
    return env;
  }
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const { homedir } = await import('os');
    const configPath = join(homedir(), '.squid', 'config.json');
    const content = await readFile(configPath, 'utf-8');
    const root = JSON.parse(content) as Record<string, unknown>;
    return normalizeWebSearchProvider(readWebSearchProviderRawFromSquidConfigRoot(root));
  } catch {
    return 'duckduckgo';
  }
}

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};

export const WebSearchTool: Tool<typeof WebSearchInputSchema, WebSearchOutput> = {
  name: 'web_search',
  description:
    '联网搜索网页（设置 → 工具设置 → 联网搜索；配置存于 config.json 的 tools.webSearch.provider）。可选 DuckDuckGo 或必应中国站；仅 HTML 抓取，无官方 API。',
  inputSchema: WebSearchInputSchema,
  maxResultSizeChars: 50000,

  async call(
    input: WebSearchInput,
    _context: ToolContext
  ): Promise<ToolResult<WebSearchOutput>> {
    try {
      const maxResults = Math.min(input.max_results || 10, 10);

      if (!input.query || input.query.trim() === '') {
        return {
          data: {
            success: false,
            query: input.query,
            results: [],
            count: 0,
            error: '搜索查询不能为空'
          }
        };
      }

      const provider = await resolveWebSearchProvider();

      let searchUrl: string;
      let parse: (html: string, n: number) => SearchResult[];

      if (provider === 'bing') {
        searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(input.query)}&ensearch=0`;
        parse = parseBingCnHtml;
      } else {
        searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(input.query)}`;
        parse = parseDuckDuckGoHtml;
      }

      const response = await axios.get(searchUrl, {
        headers: DEFAULT_HEADERS,
        timeout: WEB_SEARCH_TIMEOUT_MS,
        validateStatus: (s) => s >= 200 && s < 400
      });

      const results = parse(typeof response.data === 'string' ? response.data : String(response.data), maxResults);

      if (results.length === 0) {
        return {
          data: {
            success: false,
            query: input.query,
            results: [],
            count: 0,
            provider,
            error:
              provider === 'bing'
                ? '未解析到结果（必应页面结构可能变更、需验证页或网络限制）。可尝试改为 DuckDuckGo 或配置代理。'
                : '未解析到结果（DuckDuckGo 页面结构可能变更或网络不可达）。可尝试改为必应或配置代理。'
          }
        };
      }

      return {
        data: {
          success: true,
          query: input.query,
          results,
          count: results.length,
          provider
        }
      };
    } catch (error) {
      return {
        data: {
          success: false,
          query: input.query,
          results: [],
          count: 0,
          error: `搜索失败: ${(error as Error).message}`
        },
        error: (error as Error).message
      };
    }
  },

  mapToolResultToToolResultBlockParam(
    content: WebSearchOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content.success) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: `搜索失败: ${content.error || '未知错误'}`,
        is_error: true
      };
    }

    const src =
      content.provider === 'bing' ? '必应（cn.bing.com）' : 'DuckDuckGo';
    let output = `搜索源: ${src}\n搜索查询: ${content.query}\n找到 ${content.count} 条结果\n\n`;

    content.results.forEach((result, index) => {
      output += `${index + 1}. ${result.title}\n`;
      output += `   链接: ${result.link}\n`;
      output += `   摘要: ${result.snippet}\n\n`;
    });

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: output.trim()
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false
};
