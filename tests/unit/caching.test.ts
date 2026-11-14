import { generateText, type JSONValue, type ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { currentTabNote } from '../../src/agent/prompt';
import { buildHistory } from '../../src/chat/prompt';
import { cachedInstructions, cacheOptions, withBreakpoint } from '../../src/providers/caching';
import { createLanguageModel } from '../../src/providers/language-model';
import { VENDORS } from '../../src/providers/vendors';
import type { Connection, MessageRecord, Vendor } from '../../src/shared/types';

/** The body of the request a vendor's adapter would send for a conversation with cache marks. */
async function requestBody(vendor: Vendor, modelId: string, providerOptions?: Record<string, Record<string, JSONValue>>) {
  let body: Record<string, unknown> | undefined;
  const fetchMock = async (_input: string | URL | Request, init?: RequestInit) => {
    body ??= JSON.parse(String(init?.body));
    return new Response('{"error":{"message":"stop"}}', { status: 400, headers: { 'content-type': 'application/json' } });
  };
  const connection: Connection = { id: 'c', vendor, name: vendor, baseURL: VENDORS[vendor].defaultBaseURL, models: [], createdAt: 0, updatedAt: 0 };
  const messages: ModelMessage[] = [
    { role: 'user', content: 'first request' },
    { role: 'assistant', content: 'first reply' },
    { role: 'user', content: 'second request' },
  ];
  await generateText({
    model: createLanguageModel(connection, 'test-key', modelId, fetchMock as typeof fetch),
    instructions: cachedInstructions('You are Browser Helper.'),
    messages: withBreakpoint(messages, 1),
    providerOptions,
    maxRetries: 0,
  }).catch(() => undefined);
  return body!;
}

describe('prompt caching', () => {
  it('marks the instructions and the repeated part of the conversation for Anthropic', async () => {
    const body = (await requestBody('anthropic', 'claude-sonnet-4-5')) as {
      system: { text: string; cache_control?: unknown }[];
      messages: { role: string; content: { text: string; cache_control?: unknown }[] }[];
    };
    expect(body.system).toEqual([{ type: 'text', text: 'You are Browser Helper.', cache_control: { type: 'ephemeral' } }]);
    // The mark is on the message that ends the repeated part, and nowhere else.
    expect(body.messages.map((message) => message.content.map((part) => Boolean(part.cache_control)))).toEqual([[false], [true], [false]]);
  });

  it('sends nothing unusual to providers that cache by themselves, and gives OpenAI the conversation as cache key', async () => {
    const openai = await requestBody('openai', 'gpt-5-mini', cacheOptions({ openai: { store: false } }, 'openai', 'conversation-1'));
    expect(openai).toMatchObject({ prompt_cache_key: 'conversation-1', store: false });
    expect(JSON.stringify(openai)).not.toContain('cache_control');
    const deepseek = await requestBody('deepseek', 'deepseek-chat', cacheOptions(undefined, 'deepseek', 'conversation-1'));
    expect(JSON.stringify(deepseek)).not.toMatch(/cache_control|prompt_cache_key/);
    expect((deepseek as { messages: { role: string; content: string }[] }).messages[0]).toEqual({ role: 'system', content: 'You are Browser Helper.' });
    // Only OpenAI takes the key.
    expect(cacheOptions(undefined, 'anthropic', 'k')).toBeUndefined();
    expect(cacheOptions({ openai: { store: false } }, 'openai', 'k'.repeat(100))!.openai!.promptCacheKey).toHaveLength(64);
  });

  it('leaves the messages alone when the mark has nowhere to go', () => {
    const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }];
    expect(withBreakpoint(messages, -1)).toBe(messages);
    expect(withBreakpoint(messages, 5)).toBe(messages);
    expect(withBreakpoint(messages, 0)[0]).toMatchObject({ role: 'user', content: 'hi', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } });
    expect(messages[0]!.providerOptions).toBeUndefined();
  });

  it('renders earlier requests the same in every later call, so the beginning of a conversation repeats', () => {
    const message = (id: string, role: 'user' | 'assistant', content: string, tab?: { title: string; url: string }): MessageRecord => ({
      id,
      conversationId: 'c',
      role,
      content,
      status: 'done',
      createdAt: 0,
      updatedAt: 0,
      ...(tab ? { tab } : {}),
    });
    const shop = { title: 'Shop', url: 'https://shop.example/' };
    const news = { title: 'News', url: 'https://news.example/' };
    // As the runtime does it: earlier requests carry the tab they were sent from; the latest gets the tab as it is now.
    const render = (messages: MessageRecord[], current: { title: string; url: string }) => {
      const turns = buildHistory(messages, (m, latest) => (latest || !m.tab ? undefined : currentTabNote(m.tab, true)));
      turns.at(-1)!.content += `\n\n${currentTabNote(current, true)}`;
      return turns;
    };
    const first = [message('1', 'user', 'Find a cable', shop)];
    const second = [...first, message('2', 'assistant', 'Found one.'), message('3', 'user', 'And the news?', news)];
    const third = [...second, message('4', 'assistant', 'Here it is.'), message('5', 'user', 'Thanks', news)];
    const [a, b, c] = [render(first, shop), render(second, news), render(third, news)];
    expect(a[0]!.content).toBe('Find a cable\n\n<current_tab title="Shop" url="https://shop.example/"/>');
    // What was sent for a turn is the beginning of what is sent for the next.
    expect(b.slice(0, 1)).toEqual(a);
    expect(c.slice(0, 3)).toEqual(b);
    expect(c[2]!.content).toContain('<current_tab title="News"');
  });
});
