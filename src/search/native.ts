import { generateText } from 'ai';
import { ConfigError } from '../providers/errors';
import { createNativeSearchTool } from '../providers/language-model';
import type { ResolvedModel } from '../providers/resolve';
import { getApiKey } from '../storage/settings';

const NATIVE_PROMPT = `Search the web for the query below. Reply with a numbered list of the 5 to 8 most relevant results: the page title, its URL, and one or two sentences with the facts that answer the query. Do not answer from memory.

Query: `;

/** Searches with the current model's built-in web search (OpenAI, Anthropic, Gemini). */
export async function nativeSearch(main: ResolvedModel, query: string, signal?: AbortSignal): Promise<string> {
  const apiKey = await getApiKey(main.connection.id);
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
  return [`Search results for "${query}" (model's built-in search). Verify on the source before relying on them:`, result.text.trim(), ...(sources.length ? ['Sources:', ...sources] : [])].join('\n');
}
