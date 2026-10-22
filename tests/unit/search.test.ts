import { describe, expect, it } from 'vitest';
import {
  apiSearch,
  formatSearchResults,
  parseBrave,
  parseCloudflare,
  parseDeepSeek,
  parseExa,
  parseTavily,
  searchEndpoint,
} from '../../src/search/search';
import type { Connection } from '../../src/shared/types';
import { DEFAULT_SEARCH_SETTINGS } from '../../src/storage/settings';

const deepseek: Connection = {
  id: 'ds',
  vendor: 'deepseek',
  name: 'DeepSeek',
  baseURL: 'https://api.deepseek.com',
  models: ['deepseek-chat'],
  createdAt: 1,
  updatedAt: 1,
};

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('search response parsers', () => {
  it('prefers DeepSeek summaries written for models', () => {
    const results = parseDeepSeek({
      results: [
        { title: 'A', url: 'https://a.example/', snippet: 'short', summary: 'Longer summary for models.', rerank_score: 2.1 },
        { title: 'B', url: 'https://b.example/', snippet: 'only a snippet' },
        { title: 'No URL', url: '' },
      ],
    });
    expect(results).toEqual([
      { title: 'A', url: 'https://a.example/', snippet: 'Longer summary for models.' },
      { title: 'B', url: 'https://b.example/', snippet: 'only a snippet' },
    ]);
  });

  it('accepts several shapes of the Cloudflare response', () => {
    const item = { title: 'CF', url: 'https://cf.example/', description: 'desc' };
    for (const body of [{ result: { results: [item] } }, { result: [item] }, { results: [item] }]) {
      expect(parseCloudflare(body)).toEqual([{ title: 'CF', url: 'https://cf.example/', snippet: 'desc' }]);
    }
  });

  it('parses Tavily, Brave and Exa', () => {
    expect(parseTavily({ results: [{ title: 'T', url: 'https://t.example/', content: 'c' }] })[0]!.snippet).toBe('c');
    expect(parseBrave({ web: { results: [{ title: 'B', url: 'https://b.example/', description: 'a <strong>bold</strong> word' }] } })[0]!.snippet).toBe(
      'a bold word',
    );
    expect(parseExa({ results: [{ title: 'E', url: 'https://e.example/', highlights: ['one', 'two'] }] })[0]!.snippet).toBe('one … two');
  });

  it('clips long snippets and keeps at most eight results', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `R${i}`, url: `https://r${i}.example/`, content: 'x'.repeat(1000) }));
    const results = parseTavily({ results: many });
    expect(results).toHaveLength(8);
    expect(results[0]!.snippet.length).toBeLessThanOrEqual(401);
  });
});

describe('apiSearch', () => {
  it('calls the DeepSeek search tool with the connection key', async () => {
    const { impl, calls } = fakeFetch({ results: [{ title: 'A', url: 'https://a.example/', summary: 's' }] });
    const results = await apiSearch('deepseek', 'q'.repeat(200), {
      settings: DEFAULT_SEARCH_SETTINGS,
      connections: [deepseek],
      apiKey: 'sk-ds',
      fetch: impl,
    });
    expect(results).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.deepseek.com/v1/tools/search');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-ds');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.query).toHaveLength(128);
    expect(body.count).toBe(8);
  });

  it('builds the Cloudflare request from the account, gateway and source', async () => {
    const { impl, calls } = fakeFetch({ success: true, result: { results: [] } });
    const settings = { ...DEFAULT_SEARCH_SETTINGS, cloudflare: { accountId: 'acc 1', gatewayId: 'gw', source: 'exa' as const } };
    await apiSearch('cloudflare', 'news', { settings, connections: [], apiKey: 'cf-token', fetch: impl });
    expect(calls[0]!.url).toBe('https://api.cloudflare.com/client/v4/accounts/acc%201/ai/websearch/');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ query: 'news', provider: 'exa', limit: 8, options: { gateway: { id: 'gw' } } });
  });

  it('sends the Brave key as a header on a GET request', async () => {
    const { impl, calls } = fakeFetch({ web: { results: [] } });
    await apiSearch('brave', 'a b', { settings: DEFAULT_SEARCH_SETTINGS, connections: [], apiKey: 'brave-key', fetch: impl });
    expect(calls[0]!.url).toBe('https://api.search.brave.com/res/v1/web/search?q=a%20b&count=8');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Subscription-Token']).toBe('brave-key');
  });

  it('fails clearly without a key or on HTTP errors', async () => {
    const { impl } = fakeFetch({ error: 'unauthorized' }, 401);
    await expect(apiSearch('tavily', 'x', { settings: DEFAULT_SEARCH_SETTINGS, connections: [] })).rejects.toThrow(/No API key/);
    await expect(apiSearch('tavily', 'x', { settings: DEFAULT_SEARCH_SETTINGS, connections: [], apiKey: 'k', fetch: impl })).rejects.toThrow(/HTTP 401/);
  });

  it('derives the DeepSeek endpoint from the connection base URL', () => {
    expect(searchEndpoint('deepseek', DEFAULT_SEARCH_SETTINGS, [{ ...deepseek, baseURL: 'https://api.deepseek.com/v1/' }])).toBe(
      'https://api.deepseek.com/v1/tools/search',
    );
    expect(searchEndpoint('browser', DEFAULT_SEARCH_SETTINGS, [])).toBeUndefined();
  });
});

describe('formatSearchResults', () => {
  it('names the source and asks to verify', () => {
    const text = formatSearchResults('cables', [{ title: 'Guide', url: 'https://g.example/', snippet: 'Braided lasts.' }], 'DeepSeek');
    expect(text).toContain('Search results for "cables" (DeepSeek)');
    expect(text).toContain('1. Guide — https://g.example/\n   Braided lasts.');
    expect(formatSearchResults('none', [])).toBe('No results found for "none".');
  });
});
