import { describe, expect, it } from 'vitest';
import {
  readWebSearchProviderRawFromSquidConfigRoot,
  setWebSearchProviderInSquidConfig
} from '../tools-config';

describe('tools-config webSearch', () => {
  it('reads tools.webSearch.provider first', () => {
    expect(
      readWebSearchProviderRawFromSquidConfigRoot({
        tools: { webSearch: { provider: 'bing' } },
        webSearchProvider: 'duckduckgo',
      })
    ).toBe('bing');
  });

  it('falls back to legacy top-level then model', () => {
    expect(readWebSearchProviderRawFromSquidConfigRoot({ webSearchProvider: 'bing' })).toBe('bing');
    expect(
      readWebSearchProviderRawFromSquidConfigRoot({
        model: { webSearchProvider: 'bing' },
      })
    ).toBe('bing');
  });

  it('setWebSearchProvider merges tools and strips legacy keys', () => {
    const cfg: Record<string, unknown> = {
      tools: { otherTool: { x: 1 }, webSearch: { extra: 'keep' } },
      webSearchProvider: 'duckduckgo',
      model: { webSearchProvider: 'bing', name: 'x' },
    };
    setWebSearchProviderInSquidConfig(cfg, 'bing');
    expect(cfg.tools).toEqual({
      otherTool: { x: 1 },
      webSearch: { extra: 'keep', provider: 'bing' },
    });
    expect(cfg.webSearchProvider).toBeUndefined();
    expect((cfg.model as Record<string, unknown>).webSearchProvider).toBeUndefined();
    expect((cfg.model as Record<string, unknown>).name).toBe('x');
  });
});
