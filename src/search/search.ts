import type { SearchResult } from '../agent/page/types';
import { ConfigError, HttpError } from '../providers/errors';
import { keyedBaseURL, normalizeBaseURL } from '../providers/vendors';
import type { Connection, Locale, SearchProviderId, SearchSettings } from '../shared/types';

type FetchLike = typeof fetch;

export const API_SEARCH_PROVIDERS: Exclude<SearchProviderId, 'browser' | 'native'>[] = ['deepseek', 'cloudflare', 'tavily', 'brave', 'exa'];

/** Where each provider's API key comes from, and where to get one. */
export const SEARCH_KEY_URLS: Partial<Record<SearchProviderId, string>> = {
  cloudflare: 'https://dash.cloudflare.com/profile/api-tokens',
  tavily: 'https://app.tavily.com/home',
  brave: 'https://api-dashboard.search.brave.com/app/keys',
  exa: 'https://dashboard.exa.ai/api-keys',
};

const RESULT_COUNT = 8;
const SNIPPET_CHARS = 400;

const HL: Record<Locale, string> = { 'zh-CN': 'zh-CN', en: 'en', fr: 'fr', es: 'es' };

/** Results page URL for browser search (a background tab reads it). */
export function buildSearchUrl(search: Pick<SearchSettings, 'engine' | 'customUrl'>, query: string, locale: Locale): string {
  const q = encodeURIComponent(query);
  switch (search.engine) {
    case 'bing':
      return `https://www.bing.com/search?q=${q}`;
    case 'duckduckgo':
      return `https://html.duckduckgo.com/html/?q=${q}`;
    case 'custom':
      if (search.customUrl.includes('%s')) return search.customUrl.replace('%s', q);
      return `https://www.google.com/search?q=${q}&hl=${HL[locale]}`;
    default:
      return `https://www.google.com/search?q=${q}&hl=${HL[locale]}`;
  }
}

export function formatSearchResults(query: string, results: SearchResult[], source?: string): string {
  if (results.length === 0) return `No results found for "${query}".`;
  return [
    `Search results for "${query}"${source ? ` (${source})` : ''}. Verify on the source before relying on them:`,
    ...results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`),
  ].join('\n');
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** Keeps results that have a URL, with a short single-line snippet. */
function normalize(items: unknown, pick: (item: Record<string, unknown>) => SearchResult): SearchResult[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(pick)
    .filter((r) => /^https?:\/\//.test(r.url))
    .map((r) => ({ title: clip(r.title || r.url, 200), url: r.url, snippet: clip(r.snippet, SNIPPET_CHARS) }))
    .slice(0, RESULT_COUNT);
}

// ---- Response parsers (exported for tests) ----

/** DeepSeek /v1/tools/search: `summary` is written for models, `snippet` for people. */
export function parseDeepSeek(body: unknown): SearchResult[] {
  const root = body as { results?: unknown; data?: { results?: unknown } };
  return normalize(root.results ?? root.data?.results, (r) => ({
    title: str(r.title),
    url: str(r.url),
    snippet: str(r.summary) || str(r.snippet) || str(r.content),
  }));
}

/** Cloudflare AI Search (web): parsed loosely, the API is in beta. */
export function parseCloudflare(body: unknown): SearchResult[] {
  const root = body as { result?: unknown; results?: unknown };
  const result = root.result as { results?: unknown; data?: unknown } | unknown[] | undefined;
  const items = Array.isArray(result) ? result : (result?.results ?? result?.data ?? root.results);
  return normalize(items, (r) => ({
    title: str(r.title),
    url: str(r.url) || str(r.link),
    snippet: str(r.snippet) || str(r.description) || str(r.content) || str(r.text),
  }));
}

export function parseTavily(body: unknown): SearchResult[] {
  return normalize((body as { results?: unknown }).results, (r) => ({ title: str(r.title), url: str(r.url), snippet: str(r.content) }));
}

export function parseBrave(body: unknown): SearchResult[] {
  return normalize((body as { web?: { results?: unknown } }).web?.results, (r) => ({
    title: str(r.title),
    url: str(r.url),
    snippet: str(r.description).replace(/<\/?strong>/g, ''),
  }));
}

export function parseExa(body: unknown): SearchResult[] {
  return normalize((body as { results?: unknown }).results, (r) => ({
    title: str(r.title),
    url: str(r.url),
    snippet: str(r.summary) || (Array.isArray(r.highlights) ? r.highlights.map(str).join(' … ') : '') || str(r.text),
  }));
}

// ---- Requests ----

export interface SearchRequestContext {
  settings: SearchSettings;
  connections: Connection[];
  /** API key of the provider (or of the DeepSeek connection). */
  apiKey?: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
}

export function deepseekConnection(settings: SearchSettings, connections: Connection[]): Connection | undefined {
  const deepseek = connections.filter((c) => c.vendor === 'deepseek');
  return deepseek.find((c) => c.id === settings.deepseekConnectionId) ?? deepseek[0];
}

/** The URL a provider's request goes to (also used to ask for host access). */
export function searchEndpoint(provider: SearchProviderId, settings: SearchSettings, connections: Connection[]): string | undefined {
  switch (provider) {
    case 'deepseek': {
      const connection = deepseekConnection(settings, connections);
      const base = normalizeBaseURL(connection?.baseURL || 'https://api.deepseek.com').replace(/\/v1$/, '');
      return `${base}/v1/tools/search`;
    }
    case 'cloudflare':
      return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(settings.cloudflare.accountId.trim())}/ai/websearch/`;
    case 'tavily':
      return 'https://api.tavily.com/search';
    case 'brave':
      return 'https://api.search.brave.com/res/v1/web/search';
    case 'exa':
      return 'https://api.exa.ai/search';
    default:
      return undefined;
  }
}

async function request(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetchImpl(url, init);
  if (!response.ok) throw new HttpError(response.status, await response.text().catch(() => ''), url);
  return response.json();
}

const json = (body: unknown, headers: Record<string, string>, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
  signal,
});

/** Runs a search with an API provider. */
export async function apiSearch(provider: SearchProviderId, query: string, context: SearchRequestContext): Promise<SearchResult[]> {
  const { settings, apiKey, signal } = context;
  const fetchImpl = context.fetch ?? fetch;
  const url = searchEndpoint(provider, settings, context.connections);
  if (!url) throw new Error(`${provider} is not an API search provider.`);
  if (!apiKey) throw new ConfigError('noKey', `No API key for ${provider} search.`);
  keyedBaseURL(url, apiKey);
  const bearer = { Authorization: `Bearer ${apiKey}` };

  switch (provider) {
    case 'deepseek':
      // The query is limited to 128 characters.
      return parseDeepSeek(await request(fetchImpl, url, json({ query: query.slice(0, 128), count: RESULT_COUNT }, bearer, signal)));
    case 'cloudflare': {
      if (!settings.cloudflare.accountId.trim()) throw new ConfigError('noKey', 'Cloudflare account ID is missing.');
      const body = {
        query: query.slice(0, 1024),
        provider: settings.cloudflare.source,
        limit: RESULT_COUNT,
        options: { gateway: { id: settings.cloudflare.gatewayId.trim() || 'default' } },
      };
      return parseCloudflare(await request(fetchImpl, url, json(body, bearer, signal)));
    }
    case 'tavily':
      return parseTavily(await request(fetchImpl, url, json({ query, max_results: RESULT_COUNT, search_depth: 'basic' }, bearer, signal)));
    case 'brave':
      return parseBrave(
        await request(fetchImpl, `${url}?q=${encodeURIComponent(query)}&count=${RESULT_COUNT}`, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
          signal,
        }),
      );
    case 'exa':
      return parseExa(
        await request(fetchImpl, url, json({ query, numResults: RESULT_COUNT, contents: { highlights: true } }, { 'x-api-key': apiKey }, signal)),
      );
    default:
      throw new Error(`${provider} is not an API search provider.`);
  }
}
