import { generateText } from 'ai';
import { ConfigError, HttpError } from '../providers/errors';
import { createNativeSearchTool } from '../providers/language-model';
import type { ResolvedModel } from '../providers/resolve';
import { keyedBaseURL } from '../providers/vendors';
import { getApiKey } from '../storage/settings';
import { deepseekBaseURL, deepseekConnections, pageKey } from './search';

const NATIVE_PROMPT = `Search the web for the query below. Reply with a numbered list of the 5 to 8 most relevant results: the page title, its URL, and one or two sentences with the facts that answer the query. Do not answer from memory.

Query: `;

const heading = (query: string) => `Search results for "${query}" (model's built-in search). Verify on the source before relying on them:`;

/** DeepSeek's web search runs with this model, whichever one the conversation uses. */
export const DEEPSEEK_SEARCH_MODEL = 'deepseek-flash';
const SOURCE_COUNT = 8;

interface Source {
  title: string;
  url: string;
}

/**
 * The answer and its sources from a chat completion that used DeepSeek's
 * `deepseek_web_search` tool. Pages the answer cites come first.
 */
export function parseDeepSeekWebSearch(body: unknown): { text: string; sources: Source[] } {
  const root = body as {
    error?: { message?: unknown };
    choices?: { message?: { content?: unknown; annotations?: unknown; server_tool_calls?: unknown } }[];
  };
  const message = root.choices?.[0]?.message;
  // A failure after the answer began comes with status 200 and an error in the body.
  if (!message) throw new Error(typeof root.error?.message === 'string' ? root.error.message : 'DeepSeek returned no answer.');
  const list = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null) : [];
  const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

  const sources: Source[] = [];
  const seen = new Set<string>();
  const add = (url: unknown, title: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url) || seen.has(pageKey(url))) return;
    seen.add(pageKey(url));
    sources.push({ url, title: text(title).slice(0, 200) || url });
  };
  for (const annotation of list(message.annotations)) {
    const citation = annotation.url_citation as { url?: unknown; title?: unknown } | undefined;
    add(citation?.url, citation?.title);
  }
  for (const step of list(message.server_tool_calls)) {
    for (const call of list(step.calls)) for (const source of list(call.sources)) add(source.url, source.title);
  }
  return { text: typeof message.content === 'string' ? message.content.trim() : '', sources: sources.slice(0, SOURCE_COUNT) };
}

/** DeepSeek searches on its side when the request declares its web search tool. Thinking is off: with it on, the tool turns into a long research run. */
async function deepseekWebSearch(main: ResolvedModel, apiKey: string | undefined, query: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!apiKey) throw new ConfigError('noKey', main.connection.name);
  const url = `${keyedBaseURL(deepseekBaseURL(main.connection), apiKey)}/chat/completions`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: DEEPSEEK_SEARCH_MODEL,
      thinking: { type: 'disabled' },
      tools: [{ type: 'deepseek_web_search' }],
      messages: [{ role: 'user', content: NATIVE_PROMPT + query }],
    }),
    signal,
  });
  if (!response.ok) throw new HttpError(response.status, await response.text().catch(() => ''), url);
  const { text, sources } = parseDeepSeekWebSearch(await response.json());
  return [heading(query), text, ...(sources.length ? ['Sources:', ...sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)] : [])].join('\n');
}

/** Searches with the current model's built-in web search (OpenAI, Anthropic, Gemini, DeepSeek). */
export async function nativeSearch(main: ResolvedModel, query: string, signal?: AbortSignal, fetchImpl?: typeof fetch): Promise<string> {
  const apiKey = await getApiKey(main.connection.id);
  if (deepseekConnections([main.connection]).length > 0) return deepseekWebSearch(main, apiKey, query, signal, fetchImpl);
  const search = createNativeSearchTool(main.connection, apiKey);
  if (!search) throw new ConfigError('noModel', `${main.connection.name} has no built-in web search. Choose another search provider.`);
  const result = await generateText({
    model: main.model,
    prompt: NATIVE_PROMPT + query,
    tools: { [search.name]: search.tool },
    providerOptions: main.providerOptions,
    abortSignal: signal,
    maxRetries: 1,
  });
  const sources = result.sources
    .filter((s): s is Extract<typeof s, { sourceType: 'url' }> => s.sourceType === 'url')
    .map((s, i) => `[${i + 1}] ${s.title ?? s.url} — ${s.url}`);
  return [heading(query), result.text.trim(), ...(sources.length ? ['Sources:', ...sources] : [])].join('\n');
}
