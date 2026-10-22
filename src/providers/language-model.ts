import { createAnthropic } from '@ai-sdk/anthropic';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
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
