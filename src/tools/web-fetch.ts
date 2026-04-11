import { z } from 'zod';
import type { Tool, ToolResult, ToolContext } from './base';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';
import { fetchURL } from './web-fetch-utils';
import {
  READ_TOOL_RESULT_MAX_CHARS,
  WEB_FETCH_PREVIEW_CHARS,
  truncateWithEllipsis,
} from './tool-output-format';

// 输入 schema
const WebFetchInputSchema = z.object({
  url: z.string().url().describe('要获取内容的 URL'),
  prompt: z.string().describe('对获取内容的处理提示（简化版本暂不使用）'),
});

// 输出类型
export interface WebFetchOutput {
  url: string;
  content: string;
  bytes: number;
  code: number;
  codeText: string;
  contentType: string;
  durationMs: number;
}

export const WebFetchTool: Tool<typeof WebFetchInputSchema, WebFetchOutput> = {
  name: 'web_fetch',
  description: `获取指定 URL 的网页内容并转换为 Markdown 格式。

用法：
- url: 要获取的网页 URL（必须是 http 或 https）
- prompt: 对内容的处理提示（当前版本直接返回完整内容）

特性：
- 自动将 HTML 转换为 Markdown
- 15 分钟缓存，避免重复请求
- 30 秒超时保护
- 支持最大 10MB 内容

限制：
- 不支持需要认证的页面
- 不支持二进制内容（PDF、图片等）`,

  inputSchema: WebFetchInputSchema,
  maxResultSizeChars: READ_TOOL_RESULT_MAX_CHARS,

  async call(input, context): Promise<ToolResult<WebFetchOutput>> {
    const startTime = Date.now();

    try {
      const { url } = input;

      // 获取网页内容
      const result = await fetchURL(url, context.abortSignal);

      const output: WebFetchOutput = {
        url,
        content: result.content,
        bytes: result.bytes,
        code: result.code,
        codeText: result.codeText,
        contentType: result.contentType,
        durationMs: Date.now() - startTime,
      };

      return { data: output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // 返回错误信息
      return {
        data: {
          url: input.url,
          content: '',
          bytes: 0,
          code: 0,
          codeText: 'Error',
          contentType: '',
          durationMs: Date.now() - startTime,
        },
        error: `Failed to fetch URL: ${errorMessage}`,
      };
    }
  },

  mapToolResultToToolResultBlockParam(
    output: WebFetchOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    // 如果有错误，返回错误信息
    if (!output.content && output.code === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: `Failed to fetch ${output.url}`,
        is_error: true,
      };
    }

    const preview = truncateWithEllipsis(output.content, WEB_FETCH_PREVIEW_CHARS);
    const truncated = output.content.length > preview.length;
    const summary = [
      '# Web Fetch Result',
      '',
      `URL: ${output.url}`,
      `Status: ${output.code} ${output.codeText}`,
      `Content-Type: ${output.contentType}`,
      `Size: ${formatBytes(output.bytes)}`,
      `Duration: ${output.durationMs}ms`,
      `Content chars: ${output.content.length}${truncated ? ' (truncated)' : ''}`,
      '',
      'Preview:',
      preview,
      truncated ? '\n...[truncated, use more specific URL or follow-up fetch if needed]' : '',
    ].join('\n');

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: summary,
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false,
};

/**
 * 格式化字节数
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
