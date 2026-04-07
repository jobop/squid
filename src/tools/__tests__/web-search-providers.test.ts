import { describe, expect, it } from 'vitest';
import { parseBingCnHtml, parseDuckDuckGoHtml, normalizeWebSearchProvider } from '../web-search-providers';

describe('normalizeWebSearchProvider', () => {
  it('defaults to duckduckgo', () => {
    expect(normalizeWebSearchProvider(undefined)).toBe('duckduckgo');
    expect(normalizeWebSearchProvider('')).toBe('duckduckgo');
    expect(normalizeWebSearchProvider('unknown')).toBe('duckduckgo');
  });
  it('accepts bing and duckduckgo', () => {
    expect(normalizeWebSearchProvider('bing')).toBe('bing');
    expect(normalizeWebSearchProvider('BING')).toBe('bing');
    expect(normalizeWebSearchProvider('duckduckgo')).toBe('duckduckgo');
  });
});

describe('parseDuckDuckGoHtml', () => {
  it('extracts title, link, snippet from minimal HTML', () => {
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">Example Title</a>
        <a class="result__snippet">A short description here.</a>
      </div>
    `;
    const r = parseDuckDuckGoHtml(html, 5);
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Example Title');
    expect(r[0].link).toBe('https://example.com/page');
    expect(r[0].snippet).toContain('short description');
  });
});

describe('parseBingCnHtml', () => {
  it('extracts from li.b_algo structure', () => {
    const html = `
      <ol id="b_results">
        <li class="b_algo">
          <h2><a href="/ck/a?...">Bing Result</a></h2>
          <div class="b_caption"><p>Caption text for the result.</p></div>
        </li>
      </ol>
    `;
    const r = parseBingCnHtml(html, 5);
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0].title).toContain('Bing');
    expect(r[0].link).toMatch(/^https?:\/\//);
    expect(r[0].snippet).toContain('Caption');
  });
});
