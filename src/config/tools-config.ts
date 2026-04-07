import type { WebSearchProviderId } from '../tools/web-search-providers';

/**
 * 工具相关配置统一挂在 config.json 的 `tools` 下，便于扩展其他工具。
 * 联网搜索：tools.webSearch.provider = 'duckduckgo' | 'bing'
 */

export function readWebSearchProviderRawFromSquidConfigRoot(root: Record<string, unknown>): string | undefined {
  const tools = root.tools;
  if (tools && typeof tools === 'object' && !Array.isArray(tools)) {
    const ws = (tools as Record<string, unknown>).webSearch;
    if (ws && typeof ws === 'object' && !Array.isArray(ws)) {
      const p = (ws as Record<string, unknown>).provider;
      if (typeof p === 'string' && p.trim()) return p;
    }
  }
  if (typeof root.webSearchProvider === 'string' && root.webSearchProvider.trim()) {
    return root.webSearchProvider;
  }
  const model = root.model;
  if (model && typeof model === 'object' && model !== null) {
    const m = model as Record<string, unknown>;
    if (typeof m.webSearchProvider === 'string' && m.webSearchProvider.trim()) {
      return m.webSearchProvider;
    }
  }
  return undefined;
}

/** 写入 tools.webSearch.provider，并移除历史遗留的顶层 / model 字段 */
export function setWebSearchProviderInSquidConfig(
  existingConfig: Record<string, unknown>,
  provider: WebSearchProviderId
): void {
  let tools: Record<string, unknown> = {};
  const prev = existingConfig.tools;
  if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
    tools = { ...(prev as Record<string, unknown>) };
  }
  const prevWs = tools.webSearch;
  const wsMerged =
    prevWs && typeof prevWs === 'object' && !Array.isArray(prevWs)
      ? { ...(prevWs as Record<string, unknown>) }
      : {};
  wsMerged.provider = provider;
  tools.webSearch = wsMerged;
  existingConfig.tools = tools;

  delete existingConfig.webSearchProvider;

  const model = existingConfig.model;
  if (model && typeof model === 'object' && model !== null && 'webSearchProvider' in model) {
    const m = { ...(model as Record<string, unknown>) };
    delete m.webSearchProvider;
    existingConfig.model = m;
  }
}
