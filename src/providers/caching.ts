import type { JSONValue, ModelMessage, SystemModelMessage } from 'ai';

type Options = Record<string, Record<string, JSONValue>>;

/**
 * Prompt caching. A model call repeats most of the call before it: the
 * instructions, the tools, the conversation so far. Providers charge a
 * fraction for that repeated beginning when they have it cached.
 *
 * OpenAI, DeepSeek and Gemini cache a repeated beginning by themselves; all
 * they need is that it really repeats, byte for byte (see the runtime: only
 * the newest page view changes between steps). Anthropic caches up to marks
 * set in the request; the marks are set here. Other providers ignore them.
 */
const BREAKPOINT = { anthropic: { cacheControl: { type: 'ephemeral' as const } } };

/** The instructions as a message that ends a cached stretch: the tools and the instructions, the same in every call of a conversation. */
export function cachedInstructions(text: string): SystemModelMessage {
  return { role: 'system', content: text, providerOptions: BREAKPOINT };
}

/** Marks the message at `index` as the end of a cached stretch. The messages up to it must be the same in the next call. */
export function withBreakpoint(messages: ModelMessage[], index: number): ModelMessage[] {
  if (index < 0 || index >= messages.length) return messages;
  return messages.map((message, i) => (i === index ? ({ ...message, providerOptions: { ...message.providerOptions, ...BREAKPOINT } } as ModelMessage) : message));
}

/**
 * Options that help a provider find its cache. OpenAI routes calls with the
 * same key to the same machines, so a conversation's calls meet their cache.
 */
export function cacheOptions(options: Options | undefined, vendor: string, key: string): Options | undefined {
  if (vendor !== 'openai') return options;
  return { ...options, openai: { ...options?.openai, promptCacheKey: key.slice(0, 64) } };
}
