import type { Vendor } from '../shared/types';
import { HttpError } from './errors';
import { normalizeBaseURL } from './vendors';

type FetchLike = typeof fetch;

/** Ids that are clearly not chat models (embeddings, audio, images, moderation…). */
const NON_CHAT_MODEL = /(embed|tts|whisper|dall-e|davinci|babbage|moderation|transcribe|image|audio|realtime|rerank|speech)/i;

export function filterChatModels(ids: string[]): string[] {
  return [...new Set(ids)].filter((id) => !NON_CHAT_MODEL.test(id)).sort((a, b) => a.localeCompare(b));
}

export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Required by Anthropic for requests that carry a browser Origin header.
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>): Promise<unknown> {
  const response = await fetchImpl(url, { headers });
  if (!response.ok) {
    throw new HttpError(response.status, await response.text().catch(() => ''), url);
  }
  return response.json();
}

/** Lists the chat-capable model ids a connection exposes. */
export async function fetchModelList(
  vendor: Vendor,
  baseURL: string,
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<string[]> {
  const base = normalizeBaseURL(baseURL);
  switch (vendor) {
    case 'anthropic': {
      const body = (await getJson(fetchImpl, `${base}/models?limit=1000`, anthropicHeaders(apiKey ?? ''))) as {
        data?: { id: string }[];
      };
      return filterChatModels((body.data ?? []).map((m) => m.id));
    }
    case 'google': {
      const body = (await getJson(fetchImpl, `${base}/models?pageSize=1000`, {
        'x-goog-api-key': apiKey ?? '',
      })) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
      return filterChatModels(
        (body.models ?? [])
          .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m) => m.name.replace(/^models\//, '')),
      );
    }
    default: {
      const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
      const body = (await getJson(fetchImpl, `${base}/models`, headers)) as { data?: { id: string }[] };
      return filterChatModels((body.data ?? []).map((m) => m.id));
    }
  }
}
