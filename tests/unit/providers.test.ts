import { APICallError, RetryError } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { HttpError, toErrorInfo } from '../../src/providers/errors';
import { fetchModelList, filterChatModels } from '../../src/providers/model-list';
import { suggestChatModel } from '../../src/providers/suggest';

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

describe('fetchModelList', () => {
  it('lists OpenAI-style models with a bearer token and drops non-chat models', async () => {
    const fetchMock = jsonFetch({ data: [{ id: 'gpt-5-mini' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }] });
    const models = await fetchModelList('openai-compatible', 'https://api.example.com/v1/', 'sk-test', fetchMock);
    expect(models).toEqual(['gpt-5-mini']);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/v1/models');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('omits the Authorization header for keyless local servers', async () => {
    const fetchMock = jsonFetch({ data: [{ id: 'llama3' }] });
    await fetchModelList('openai-compatible', 'http://localhost:11434/v1', undefined, fetchMock);
    expect(fetchMock.mock.calls[0]![1]?.headers).toEqual({});
  });

  it('sends Anthropic headers including direct browser access', async () => {
    const fetchMock = jsonFetch({ data: [{ id: 'claude-sonnet-4-5' }] });
    await fetchModelList('anthropic', 'https://api.anthropic.com/v1', 'key', fetchMock);
    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('key');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });

  it('keeps only Gemini models that support generateContent', async () => {
    const fetchMock = jsonFetch({
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    const models = await fetchModelList('google', 'https://generativelanguage.googleapis.com/v1beta', 'key', fetchMock);
    expect(models).toEqual(['gemini-2.5-flash']);
    expect((fetchMock.mock.calls[0]![1]?.headers as Record<string, string>)['x-goog-api-key']).toBe('key');
  });

  it('throws an HttpError carrying the status', async () => {
    const fetchMock = jsonFetch({ error: 'bad key' }, 401);
    await expect(fetchModelList('openai', 'https://api.openai.com/v1', 'bad', fetchMock)).rejects.toMatchObject({
      status: 401,
    });
  });
});

describe('filterChatModels', () => {
  it('dedupes and sorts', () => {
    expect(filterChatModels(['b', 'a', 'b', 'tts-1'])).toEqual(['a', 'b']);
  });
});

describe('toErrorInfo', () => {
  const apiError = (statusCode?: number, cause?: unknown) =>
    new APICallError({ message: 'failed', url: 'https://x', requestBodyValues: {}, statusCode, cause });

  it('maps HTTP statuses to error codes', () => {
    expect(toErrorInfo(apiError(401)).code).toBe('auth');
    expect(toErrorInfo(apiError(404)).code).toBe('notFound');
    expect(toErrorInfo(apiError(429)).code).toBe('rateLimit');
    expect(toErrorInfo(apiError(503))).toMatchObject({ code: 'server', status: 503 });
    expect(toErrorInfo(new HttpError(403, '', 'https://x')).code).toBe('forbidden');
  });

  it('treats fetch failures as network errors', () => {
    expect(toErrorInfo(new TypeError('Failed to fetch')).code).toBe('network');
    expect(toErrorInfo(apiError(undefined, new TypeError('Failed to fetch'))).code).toBe('network');
  });

  it('unwraps retry errors', () => {
    const retry = new RetryError({ message: 'retried', reason: 'maxRetriesExceeded', errors: [apiError(429)] });
    expect(toErrorInfo(retry).code).toBe('rateLimit');
  });
});

describe('suggestChatModel', () => {
  it('prefers the newest mid-tier model per vendor', () => {
    expect(suggestChatModel('openai', ['gpt-4o', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o3'])).toBe('gpt-5-mini');
    expect(suggestChatModel('anthropic', ['claude-haiku-4-5', 'claude-sonnet-4', 'claude-sonnet-4-5'])).toBe('claude-sonnet-4-5');
    expect(suggestChatModel('google', ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.5-pro'])).toBe('gemini-2.5-flash');
    expect(suggestChatModel('deepseek', ['deepseek-reasoner', 'deepseek-chat'])).toBe('deepseek-chat');
    expect(suggestChatModel('openai-compatible', ['qwen-plus', 'qwen-max'])).toBe('qwen-plus');
  });
});
