import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { buildAssistantSystemPrompt } from '../../src/agent/prompt';
import { toolsFor } from '../../src/agent/tools';
import type { ResolvedModel } from '../../src/providers/resolve';
import { nativeSearch, parseDeepSeekWebSearch } from '../../src/search/native';
import {
  apiSearch,
  DEEPSEEK_OWN_KEY,
  deepseekConnection,
  deepseekFetch,
  fetchEndpoint,
  formatSearchResults,
  parseBrave,
  parseCloudflare,
  parseDeepSeek,
  parseExa,
  parseTavily,
  searchEndpoint,
} from '../../src/search/search';
import type { Connection } from '../../src/shared/types';
import { DEFAULT_SEARCH_SETTINGS, saveConnection } from '../../src/storage/settings';

const deepseek: Connection = {
  id: 'ds',
  vendor: 'deepseek',
  name: 'DeepSeek',
  baseURL: 'https://api.deepseek.com',
  models: ['deepseek-chat'],
  createdAt: 1,
  updatedAt: 1,
};

/** Answers with `body`; `statuses` gives the status of each call in turn (the last one repeats). */
function fakeFetch(body: unknown, ...statuses: number[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const status = statuses[Math.min(calls.length, statuses.length - 1)] ?? 200;
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

  it('keeps the site and the day of a DeepSeek result, and the summary at length', () => {
    const [result] = parseDeepSeek({
      results: [{ title: '', url: 'https://news.example/a', summary: 'x'.repeat(3000), site_name: 'Example News', date: '2026-06-01T00:00:00+00:00', authority: 3 }],
    });
    expect(result).toMatchObject({ title: 'Example News', site: 'Example News', date: '2026-06-01' });
    expect(result!.snippet.length).toBeGreaterThan(1000);
    expect(result!.snippet.length).toBeLessThanOrEqual(1201);
    expect(parseDeepSeek({ results: [{ title: 'T', url: 'https://t.example/', date: null, site_name: null }] })).toEqual([
      { title: 'T', url: 'https://t.example/', snippet: '' },
    ]);
  });

  it('keeps one DeepSeek result per page when it comes back in several languages', () => {
    const page = (url: string, title = 'sidePanel') => ({ title, url, summary: url });
    const results = parseDeepSeek({
      results: [
        page('https://developer.chrome.com/docs/sidePanel?trk=public_post&hl=zh-tw#1'),
        page('https://developer.chrome.com/docs/sidePanel?hl=it'),
        page('https://developer.chrome.com/docs/sidePanel'),
        page('https://www.tmtpost.com/8173434.html#1'),
        page('https://m.tmtpost.com/8173434.html'),
        // A different page: the parameter that tells them apart is kept.
        page('https://forum.example/thread?id=1&utm_source=x'),
        page('https://forum.example/thread?id=2'),
      ],
    });
    expect(results.map((r) => r.url)).toEqual([
      'https://developer.chrome.com/docs/sidePanel?trk=public_post&hl=zh-tw#1',
      'https://www.tmtpost.com/8173434.html#1',
      'https://forum.example/thread?id=1&utm_source=x',
      'https://forum.example/thread?id=2',
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
    // More than are kept, so duplicates can be dropped; the price is per search.
    expect(body).toEqual({ query: 'q'.repeat(128), count: 16 });
  });

  it('sends the user\'s question to DeepSeek only when given one, cut to 128 characters', async () => {
    const { impl, calls } = fakeFetch({ results: [] });
    const context = { settings: DEFAULT_SEARCH_SETTINGS, connections: [deepseek], apiKey: 'sk-ds', fetch: impl };
    await apiSearch('deepseek', '  braided   cable\n durability ', { ...context, question: `Are braided cables better?\n${'😀'.repeat(200)}` });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.query).toBe('braided cable durability');
    expect(Array.from(body.ori_question as string)).toHaveLength(128);
    expect(body.ori_question).toMatch(/^Are braided cables better\? 😀/);
    // Cut between characters, never inside one.
    expect(body.ori_question.isWellFormed()).toBe(true);
    // Nothing to search for: no request.
    expect(await apiSearch('deepseek', '   ', context)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('tries once more after a rate limit or a server error, not after a refusal', async () => {
    const context = { settings: DEFAULT_SEARCH_SETTINGS, connections: [deepseek], apiKey: 'sk-ds', retryDelay: 1 };
    const limited = fakeFetch({ results: [{ title: 'A', url: 'https://a.example/' }] }, 429, 200);
    expect(await apiSearch('deepseek', 'x', { ...context, fetch: limited.impl })).toHaveLength(1);
    expect(limited.calls).toHaveLength(2);
    const down = fakeFetch({ error: {} }, 500);
    await expect(apiSearch('deepseek', 'x', { ...context, fetch: down.impl })).rejects.toThrow(/HTTP 500/);
    expect(down.calls).toHaveLength(2);
    const broke = fakeFetch({ error: { message: 'Insufficient Balance' } }, 402);
    await expect(apiSearch('deepseek', 'x', { ...context, fetch: broke.impl })).rejects.toThrow(/HTTP 402/);
    expect(broke.calls).toHaveLength(1);
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
    for (const baseURL of ['https://api.deepseek.com/beta', 'https://api.deepseek.com/anthropic', 'https://api.deepseek.com/anthropic/v1']) {
      expect(searchEndpoint('deepseek', DEFAULT_SEARCH_SETTINGS, [{ ...deepseek, baseURL }])).toBe('https://api.deepseek.com/v1/tools/search');
    }
  });

  it('takes the DeepSeek key from a connection, or from the search settings', () => {
    const compatible: Connection = { ...deepseek, id: 'oc', vendor: 'openai-compatible', baseURL: 'https://api.deepseek.com/v1' };
    const other: Connection = { ...deepseek, id: 'kimi', vendor: 'openai-compatible', baseURL: 'https://api.moonshot.cn/v1' };
    // A DeepSeek address counts whichever vendor it was added as.
    expect(deepseekConnection(DEFAULT_SEARCH_SETTINGS, [other, compatible])?.id).toBe('oc');
    expect(deepseekConnection({ ...DEFAULT_SEARCH_SETTINGS, deepseekConnectionId: 'ds' }, [compatible, deepseek])?.id).toBe('ds');
    expect(deepseekConnection(DEFAULT_SEARCH_SETTINGS, [other])).toBeUndefined();
    // With its own key, search goes to DeepSeek itself, not to a connection's address.
    const own = { ...DEFAULT_SEARCH_SETTINGS, deepseekConnectionId: DEEPSEEK_OWN_KEY };
    const proxied = { ...deepseek, baseURL: 'https://proxy.example/v1' };
    expect(deepseekConnection(own, [proxied])).toBeUndefined();
    expect(searchEndpoint('deepseek', own, [proxied])).toBe('https://api.deepseek.com/v1/tools/search');
  });
});

describe('reading pages through DeepSeek', () => {
  const withDeepSeek = { ...DEFAULT_SEARCH_SETTINGS, provider: 'deepseek' as const };

  it('posts the address to the fetch tool with the search key', async () => {
    const { impl, calls } = fakeFetch({ title: 'Guide', content: '# Guide\n\nBraided lasts.' });
    const page = await deepseekFetch('https://g.example/guide?id=1', { settings: withDeepSeek, connections: [{ ...deepseek, baseURL: 'https://api.deepseek.com/v1' }], apiKey: 'sk-ds', fetch: impl });
    expect(page).toEqual({ title: 'Guide', content: '# Guide\n\nBraided lasts.' });
    expect(calls[0]!.url).toBe('https://api.deepseek.com/v1/tools/fetch');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ url: 'https://g.example/guide?id=1' });
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-ds');
    expect(fetchEndpoint({ ...withDeepSeek, deepseekConnectionId: DEEPSEEK_OWN_KEY }, [{ ...deepseek, baseURL: 'https://proxy.example' }])).toBe('https://api.deepseek.com/v1/tools/fetch');
  });

  it('fails when the page cannot be fetched, without trying again', async () => {
    const { impl, calls } = fakeFetch({ error: { message: 'failed to fetch URL' } }, 404);
    const context = { settings: withDeepSeek, connections: [deepseek], apiKey: 'sk-ds', fetch: impl, retryDelay: 1 };
    await expect(deepseekFetch('https://gone.example/', context)).rejects.toThrow(/HTTP 404/);
    expect(calls).toHaveLength(1);
    await expect(deepseekFetch('https://g.example/', { ...context, apiKey: undefined })).rejects.toThrow(/No API key/);
  });

  it('offers read_url only with DeepSeek search, and only while reading through it is on', () => {
    expect(Object.keys(toolsFor(DEFAULT_SEARCH_SETTINGS))).not.toContain('read_url');
    expect(Object.keys(toolsFor(withDeepSeek))).toContain('read_url');
    expect(Object.keys(toolsFor({ ...withDeepSeek, deepseekFetch: false }))).not.toContain('read_url');
    expect(Object.keys(toolsFor({ ...DEFAULT_SEARCH_SETTINGS, provider: 'tavily' }))).not.toContain('read_url');
    // The search syntax is described for DeepSeek only.
    expect(toolsFor(withDeepSeek).web_search.description).toContain('lang:en');
    expect(toolsFor(DEFAULT_SEARCH_SETTINGS).web_search.description).not.toContain('lang:en');
    const prompt = (readUrl: boolean) => buildAssistantSystemPrompt({ locale: 'en', now: new Date(0), mode: 'auto', readUrl });
    expect(prompt(true)).toContain('use read_url');
    expect(prompt(false)).not.toContain('read_url');
  });
});

describe("DeepSeek's own web search", () => {
  const answer = {
    choices: [
      {
        message: {
          content: ' 1. Lab test: braided cables last longer. ',
          annotations: [
            { type: 'url_citation', url_citation: { url: 'https://lab.example/test#1', title: 'Lab test' } },
            { type: 'url_citation', url_citation: { url: 'https://lab.example/test#1', title: 'Lab test' } },
          ],
          server_tool_calls: [
            {
              calls: [
                {
                  type: 'deepseek_web_search',
                  sources: [
                    { url: 'https://lab.example/test?hl=fr', title: 'Test de câbles' },
                    { url: 'https://shop.example/cables', title: '' },
                    { url: 'javascript:alert(1)', title: 'bad' },
                    ...Array.from({ length: 12 }, (_, i) => ({ url: `https://more.example/${i}`, title: `More ${i}` })),
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };

  it('lists the pages the answer cites first, each page once, eight at most', () => {
    const { text, sources } = parseDeepSeekWebSearch(answer);
    expect(text).toBe('1. Lab test: braided cables last longer.');
    expect(sources).toHaveLength(8);
    expect(sources.slice(0, 3)).toEqual([
      { title: 'Lab test', url: 'https://lab.example/test#1' },
      { title: 'https://shop.example/cables', url: 'https://shop.example/cables' },
      { title: 'More 0', url: 'https://more.example/0' },
    ]);
    // A failure after the answer began comes with status 200.
    expect(() => parseDeepSeekWebSearch({ error: { message: 'The model failed to generate a complete response.' } })).toThrow(/failed to generate/);
  });

  it('asks deepseek-flash to search, with thinking off, whatever model the conversation uses', async () => {
    fakeBrowser.reset();
    const connection: Connection = { ...deepseek, id: 'main', baseURL: 'https://api.deepseek.com/v1' };
    await saveConnection(connection, 'sk-main');
    const { impl, calls } = fakeFetch(answer);
    const main = { connection, ref: { connectionId: 'main', modelId: 'deepseek-v4-pro' } } as ResolvedModel;
    const text = await nativeSearch(main, 'braided cables', undefined, impl);
    expect(calls[0]!.url).toBe('https://api.deepseek.com/chat/completions');
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer sk-main');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' }, tools: [{ type: 'deepseek_web_search' }] });
    expect(body.messages[0].content).toContain('Query: braided cables');
    expect(text).toContain('Search results for "braided cables" (model\'s built-in search)');
    expect(text).toContain('Sources:\n[1] Lab test — https://lab.example/test#1\n[2] https://shop.example/cables — https://shop.example/cables');
  });
});

describe('formatSearchResults', () => {
  it('names the source and asks to verify', () => {
    const text = formatSearchResults('cables', [{ title: 'Guide', url: 'https://g.example/', snippet: 'Braided lasts.' }], 'DeepSeek');
    expect(text).toContain('Search results for "cables" (DeepSeek)');
    expect(text).toContain('1. Guide — https://g.example/\n   Braided lasts.');
    expect(formatSearchResults('q', [{ title: 'News', url: 'https://n.example/', snippet: 's', site: 'Example News', date: '2026-06-01' }])).toContain(
      '1. News — https://n.example/ (Example News, 2026-06-01)\n   s',
    );
    expect(formatSearchResults('none', [])).toBe('No results found for "none".');
  });
});
