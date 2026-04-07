import * as cheerio from 'cheerio';

export interface SearchHit {
  title: string;
  link: string;
  snippet: string;
}

export function parseDuckDuckGoHtml(html: string, maxResults: number): SearchHit[] {
  const $ = cheerio.load(html);
  const results: SearchHit[] = [];
  $('.result').each((_index, element) => {
    if (results.length >= maxResults) {
      return false;
    }
    const $result = $(element);
    const $title = $result.find('.result__a');
    const $snippet = $result.find('.result__snippet');
    const title = $title.text().trim();
    const snippet = $snippet.text().trim();
    let link = $title.attr('href') || '';
    if (link.startsWith('//duckduckgo.com/l/?') || link.startsWith('/l/?')) {
      const urlMatch = link.match(/uddg=([^&]+)/);
      if (urlMatch) {
        link = decodeURIComponent(urlMatch[1]);
      }
    }
    if (title && link) {
      results.push({
        title,
        link,
        snippet: snippet || '无摘要',
      });
    }
  });
  return results;
}

/**
 * 解析必应中文网页结果（cn.bing.com）。页面结构可能调整，若零条结果可换 DuckDuckGo 或走代理。
 */
export function parseBingCnHtml(html: string, maxResults: number): SearchHit[] {
  const $ = cheerio.load(html);
  const results: SearchHit[] = [];

  $('li.b_algo').each((_i, el) => {
    if (results.length >= maxResults) {
      return false;
    }
    const $li = $(el);
    const $a = $li.find('h2 a').first();
    const title = $a.text().trim();
    let link = ($a.attr('href') || '').trim();
    if (!link) {
      const cite = $li.find('cite').first().text().trim();
      if (cite.startsWith('http')) link = cite;
    }
    const snippet =
      $li.find('.b_caption p').first().text().trim() ||
      $li.find('.b_algoSlug, .b_snippet').first().text().trim() ||
      '';
    if (title && link) {
      if (link.startsWith('//')) link = 'https:' + link;
      else if (link.startsWith('/')) link = 'https://cn.bing.com' + link;
      results.push({
        title,
        link,
        snippet: snippet || '无摘要',
      });
    }
  });

  return results;
}

export type WebSearchProviderId = 'duckduckgo' | 'bing';

export function normalizeWebSearchProvider(raw: unknown): WebSearchProviderId {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return v === 'bing' ? 'bing' : 'duckduckgo';
}
