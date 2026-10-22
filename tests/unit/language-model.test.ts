import { generateText } from 'ai';
import { describe, expect, it } from 'vitest';
import { createLanguageModel } from '../../src/providers/language-model';
import { VENDORS } from '../../src/providers/vendors';
import type { Connection, Vendor } from '../../src/shared/types';

/** Captures the first request each vendor adapter makes, then fails it. */
async function captureRequest(vendor: Vendor, baseURL: string, modelId: string) {
  let captured: { url: string; headers: Headers } | undefined;
  const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
    captured ??= { url: String(input), headers: new Headers(init?.headers) };
    return new Response('{"error":{"message":"stop"}}', { status: 400, headers: { 'content-type': 'application/json' } });
  };
  const connection: Connection = { id: 'c', vendor, name: vendor, baseURL, models: [], createdAt: 0, updatedAt: 0 };
  await generateText({
    model: createLanguageModel(connection, 'test-key', modelId, fetchMock as typeof fetch),
    prompt: 'hi',
    maxRetries: 0,
  }).catch(() => undefined);
  return captured!;
}

describe('createLanguageModel wiring', () => {
  it('OpenAI uses the Responses API with a bearer key', async () => {
    const { url, headers } = await captureRequest('openai', VENDORS.openai.defaultBaseURL, 'gpt-5-mini');
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(headers.get('authorization')).toBe('Bearer test-key');
  });

  it('Anthropic sends the key and the direct-browser-access header', async () => {
    const { url, headers } = await captureRequest('anthropic', VENDORS.anthropic.defaultBaseURL, 'claude-sonnet-4-5');
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(headers.get('x-api-key')).toBe('test-key');
    expect(headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
  });

  it('Gemini calls generateContent with the API key header', async () => {
    const { url, headers } = await captureRequest('google', VENDORS.google.defaultBaseURL, 'gemini-2.5-flash');
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(headers.get('x-goog-api-key')).toBe('test-key');
  });

  it('DeepSeek posts chat completions to its default endpoint', async () => {
    const { url, headers } = await captureRequest('deepseek', VENDORS.deepseek.defaultBaseURL, 'deepseek-chat');
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(headers.get('authorization')).toBe('Bearer test-key');
  });

  it('OpenAI-compatible endpoints append /chat/completions to the base URL', async () => {
    const { url } = await captureRequest('openai-compatible', 'https://dashscope.aliyuncs.com/compatible-mode/v1/', 'qwen-plus');
    expect(url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  });
});
