import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel, Tool } from 'ai';
import type { Connection } from '../shared/types';
import { normalizeBaseURL } from './vendors';

/**
 * Builds an AI SDK language model for a connection. Runs in the service worker
 * only. `fetch` is injectable for tests.
 */
export function createLanguageModel(
  connection: Connection,
  apiKey: string | undefined,
  modelId: string,
  fetch?: typeof globalThis.fetch,
): LanguageModel {
  const baseURL = normalizeBaseURL(connection.baseURL);
  switch (connection.vendor) {
    case 'openai':
      return createOpenAI({ apiKey, baseURL, fetch })(modelId);
    case 'anthropic':
      return createAnthropic({
        apiKey,
        baseURL,
        fetch,
        headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
      })(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey, baseURL, fetch })(modelId);
    case 'deepseek':
      return createDeepSeek({ apiKey, baseURL, fetch })(modelId);
    case 'openai-compatible':
      return createOpenAICompatible({
        name: connection.presetId ?? 'openai-compatible',
        baseURL,
        apiKey: apiKey || undefined,
        includeUsage: true,
        fetch,
      })(modelId);
  }
}

/** Per-vendor options: never let OpenAI retain responses server-side. */
export function providerOptionsFor(connection: Connection) {
  if (connection.vendor === 'openai') return { openai: { store: false } };
  return undefined;
}

/**
 * The provider's own web search tool, for vendors whose API has one (§7.6).
 * The tool runs on the provider's side; the key is the name it must be given.
 */
export function createNativeSearchTool(connection: Connection, apiKey: string | undefined): { name: string; tool: Tool } | undefined {
  const baseURL = normalizeBaseURL(connection.baseURL);
  switch (connection.vendor) {
    case 'openai':
      return { name: 'web_search', tool: createOpenAI({ apiKey, baseURL }).tools.webSearch({}) as Tool };
    case 'anthropic':
      return { name: 'web_search', tool: createAnthropic({ apiKey, baseURL }).tools.webSearch_20250305({ maxUses: 3 }) as Tool };
    case 'google':
      return { name: 'google_search', tool: createGoogleGenerativeAI({ apiKey, baseURL }).tools.googleSearch({}) as Tool };
    default:
      return undefined;
  }
}
