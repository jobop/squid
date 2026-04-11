import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';

export const READ_TOOL_RESULT_MAX_CHARS = 12_000;
export const READ_FILE_PREVIEW_HEAD_CHARS = 1_600;
export const READ_FILE_PREVIEW_TAIL_CHARS = 500;
export const WEB_FETCH_PREVIEW_CHARS = 1_500;
export const WEB_SEARCH_TOP_K = 3;
export const WEB_SEARCH_SNIPPET_CHARS = 140;
export const GREP_TOP_K = 20;
export const GREP_LINE_CHARS = 200;

export function truncateWithEllipsis(text: string, maxChars: number): string {
  if (!text || maxChars <= 0) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

export function buildHeadTailPreview(
  text: string,
  headChars: number,
  tailChars: number
): { preview: string; truncated: boolean } {
  if (!text) return { preview: '', truncated: false };
  if (text.length <= headChars + tailChars + 40) {
    return { preview: text, truncated: false };
  }
  const head = text.slice(0, headChars);
  const tail = text.slice(text.length - tailChars);
  return {
    preview: `${head}\n\n...[truncated ${text.length - headChars - tailChars} chars]...\n\n${tail}`,
    truncated: true,
  };
}

export function contentCharLength(content: ToolResultBlockParam['content']): number {
  if (!content) return 0;
  if (typeof content === 'string') return content.length;
  return JSON.stringify(content).length;
}
