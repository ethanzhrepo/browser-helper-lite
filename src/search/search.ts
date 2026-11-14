import type { SearchResult } from '../agent/page/types';
import { ConfigError, HttpError } from '../providers/errors';
import { keyedBaseURL, normalizeBaseURL } from '../providers/vendors';
import type { Connection, Locale, SearchProviderId, SearchSettings } from '../shared/types';

type FetchLike = typeof fetch;

export const API_SEARCH_PROVIDERS: Exclude<SearchProviderId, 'browser' | 'native'>[] = ['deepseek', 'cloudflare', 'tavily', 'brave', 'exa'];

/** Where each provider's API key comes from, and where to get one. */
export const SEARCH_KEY_URLS: Partial<Record<SearchProviderId, string>> = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  cloudflare: 'https://dash.cloudflare.com/profile/api-tokens',
  tavily: 'https://app.tavily.com/home',
  brave: 'https://api-dashboard.search.brave.com/app/keys',
  exa: 'https://dashboard.exa.ai/api-keys',
};

const RESULT_COUNT = 8;
const SNIPPET_CHARS = 400;

/** `deepseekConnectionId` when DeepSeek search has a key of its own instead of a connection's. */
export const DEEPSEEK_OWN_KEY = 'search-key';
/** DeepSeek limits `query` and `ori_question` to 128 characters. */
export const DEEPSEEK_QUERY_CHARS = 128;
/** Its summaries are written for models and run to a few thousand characters. */
const DEEPSEEK_SUMMARY_CHARS = 1200;
/** More than are kept: the same page often comes back several times, once per language. The price is per search, not per result. */
const DEEPSEEK_COUNT = 16;

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
    ...results.map((r, i) => {
      const about = [r.site, r.date].filter(Boolean).join(', ');
      return `${i + 1}. ${r.title} — ${r.url}${about ? ` (${about})` : ''}${r.snippet ? `\n   ${r.snippet}` : ''}`;
    }),
  ].join('\n');
}

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** Keeps results that have a URL, with a short single-line snippet. */
function normalize(items: unknown, pick: (item: Record<string, unknown>) => SearchResult, snippetChars = SNIPPET_CHARS): SearchResult[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map(pick)
    .filter((r) => /^https?:\/\//.test(r.url))
    .map((r) => ({
      title: clip(r.title || r.url, 200),
      url: r.url,
      snippet: clip(r.snippet, snippetChars),
      ...(r.site ? { site: clip(r.site, 60) } : {}),
      ...(r.date ? { date: r.date } : {}),
    }))
    .slice(0, RESULT_COUNT);
}

/** Query parameters that pick a language or track a visit: the page is the same without them. */
const SAME_PAGE_PARAMS = /^(?:hl|lang|locale|language|authuser|trk|spm|scm|utm_\w+|;hl)$/i;

/** One address for every language and tracking variant of a page. */
export function pageKey(address: string): string {
  try {
    const url = new URL(address);
    const kept = [...url.searchParams].filter(([name]) => !SAME_PAGE_PARAMS.test(name)).map(([name, value]) => `${name}=${value}`);
    return `${url.host.replace(/^(?:www|m)\./, '')}${url.pathname.replace(/\/$/, '')}?${kept.sort().join('&')}`;
  } catch {
    return address;
  }
}

/** "2026-06-01T00:00:00+00:00" → "2026-06-01". */
function day(value: unknown): string | undefined {
  return /^\d{4}-\d{2}-\d{2}/.exec(str(value))?.[0];
}

/** Whitespace collapsed and cut to a number of characters (not UTF-16 units, which could split one in half). */
export function clipChars(text: string, limit: number): string {
  return Array.from(text.replace(/\s+/g, ' ').trim()).slice(0, limit).join('').trim();
}

// ---- Response parsers (exported for tests) ----

/**
 * DeepSeek /v1/tools/search: `summary` is written for models, `snippet` for people.
 * Results come ordered by `rerank_score`; that order is kept.
 */
export function parseDeepSeek(body: unknown): SearchResult[] {
  const root = body as { results?: unknown; data?: { results?: unknown } };
  const items = root.results ?? root.data?.results;
  const seen = new Set<string>();
  const pages = (Array.isArray(items) ? items : []).filter((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false;
    const key = pageKey(str((item as { url?: unknown }).url));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return normalize(
    pages,
    (r) => ({
      title: str(r.title) || str(r.site_name),
      url: str(r.url),
      snippet: str(r.summary) || str(r.snippet) || str(r.content),
      site: str(r.site_name),
      date: day(r.date),
    }),
    DEEPSEEK_SUMMARY_CHARS,
  );
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
  /** What the user asked, for providers that use it to understand the search (DeepSeek's `ori_question`). */
  question?: string;
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** Wait before the one retry; tests shorten it. */
  retryDelay?: number;
}

/** Connections to DeepSeek's API, whichever vendor they were added as. */
export function deepseekConnections(connections: Connection[]): Connection[] {
  return connections.filter((c) => {
    if (c.vendor === 'deepseek') return true;
    try {
      return new URL(normalizeBaseURL(c.baseURL)).hostname.toLowerCase() === 'api.deepseek.com';
    } catch {
      return false;
    }
  });
}

/** The connection whose key DeepSeek search uses; none when search has a key of its own. */
export function deepseekConnection(settings: SearchSettings, connections: Connection[]): Connection | undefined {
  if (settings.deepseekConnectionId === DEEPSEEK_OWN_KEY) return undefined;
  const deepseek = deepseekConnections(connections);
  return deepseek.find((c) => c.id === settings.deepseekConnectionId) ?? deepseek[0];
}

/** Where DeepSeek's API starts. The chat endpoints live under /v1, /beta or /anthropic; the tools do not. */
export function deepseekBaseURL(connection: Connection | undefined): string {
  return normalizeBaseURL(connection?.baseURL || 'https://api.deepseek.com').replace(/\/(?:v1|beta|anthropic(?:\/v1)?)$/, '');
}

/** DeepSeek's Fetch API: it reads a public page on DeepSeek's side and returns it as Markdown. */
export function fetchEndpoint(settings: SearchSettings, connections: Connection[]): string {
  return `${deepseekBaseURL(deepseekConnection(settings, connections))}/v1/tools/fetch`;
}

/** True when the assistant may read pages through DeepSeek: its search is in use and reading was not turned off. */
export function readsThroughDeepSeek(settings: SearchSettings): boolean {
  return settings.provider === 'deepseek' && settings.deepseekFetch;
}

export interface FetchedPage {
  title: string;
  /** Markdown. */
  content: string;
}

/** Reads one public page with DeepSeek's Fetch API. */
export async function deepseekFetch(pageUrl: string, context: Omit<SearchRequestContext, 'question'>): Promise<FetchedPage> {
  const url = fetchEndpoint(context.settings, context.connections);
  if (!context.apiKey) throw new ConfigError('noKey', 'No API key for DeepSeek.');
  keyedBaseURL(url, context.apiKey);
  const body = (await request(
    context.fetch ?? fetch,
    url,
    json({ url: pageUrl }, { Authorization: `Bearer ${context.apiKey}` }, context.signal),
    context.retryDelay,
  )) as { title?: unknown; content?: unknown };
  return { title: str(body.title), content: str(body.content) };
}

/** The URL a provider's request goes to (also used to ask for host access). */
export function searchEndpoint(provider: SearchProviderId, settings: SearchSettings, connections: Connection[]): string | undefined {
  switch (provider) {
    case 'deepseek':
      return `${deepseekBaseURL(deepseekConnection(settings, connections))}/v1/tools/search`;
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

const RETRY_DELAY_MS = 800;

function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
  });
}

/** A search only reads, so a timeout, a rate limit or a server error is tried once more. */
async function request(fetchImpl: FetchLike, url: string, init: RequestInit, retryDelay = RETRY_DELAY_MS): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchImpl(url, init);
    if (response.ok) return response.json();
    const error = new HttpError(response.status, await response.text().catch(() => ''), url);
    const passing = response.status === 408 || response.status === 429 || response.status >= 500;
    if (!passing || attempt > 0) throw error;
    await pause(retryDelay, init.signal);
  }
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
    case 'deepseek': {
      const question = clipChars(context.question ?? '', DEEPSEEK_QUERY_CHARS);
      const body = { query: clipChars(query, DEEPSEEK_QUERY_CHARS), count: DEEPSEEK_COUNT, ...(question ? { ori_question: question } : {}) };
      if (!body.query) return [];
      return parseDeepSeek(await request(fetchImpl, url, json(body, bearer, signal), context.retryDelay));
    }
    case 'cloudflare': {
      if (!settings.cloudflare.accountId.trim()) throw new ConfigError('noKey', 'Cloudflare account ID is missing.');
      const body = {
        query: query.slice(0, 1024),
        provider: settings.cloudflare.source,
        limit: RESULT_COUNT,
        options: { gateway: { id: settings.cloudflare.gatewayId.trim() || 'default' } },
      };
      return parseCloudflare(await request(fetchImpl, url, json(body, bearer, signal), context.retryDelay));
    }
    case 'tavily':
      return parseTavily(await request(fetchImpl, url, json({ query, max_results: RESULT_COUNT, search_depth: 'basic' }, bearer, signal), context.retryDelay));
    case 'brave':
      return parseBrave(
        await request(fetchImpl, `${url}?q=${encodeURIComponent(query)}&count=${RESULT_COUNT}`, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
          signal,
        }, context.retryDelay),
      );
    case 'exa':
      return parseExa(
        await request(fetchImpl, url, json({ query, numResults: RESULT_COUNT, contents: { highlights: true } }, { 'x-api-key': apiKey }, signal), context.retryDelay),
      );
    default:
      throw new Error(`${provider} is not an API search provider.`);
  }
}
