import type { Vendor } from '../shared/types';

/** Preferred chat model patterns per vendor, best first. */
const PREFERENCES: Record<Vendor, RegExp[]> = {
  openai: [/^gpt-\d+(\.\d+)?-mini$/, /^gpt-\d+(\.\d+)?$/, /^gpt-4o-mini$/, /^gpt-/],
  anthropic: [/^claude-sonnet/, /sonnet/, /^claude-/],
  google: [/^gemini-[\d.]+-flash$/, /^gemini-.*flash/, /^gemini-/],
  deepseek: [/^deepseek-chat$/, /^deepseek-/],
  'openai-compatible': [],
};

/**
 * Picks a sensible default chat model from a connection's model list so a
 * first-time user can start chatting right after adding a key.
 */
export function suggestChatModel(vendor: Vendor, models: string[]): string | undefined {
  // Newest versions sort last alphabetically, so look at the list in reverse.
  const sorted = [...models].sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const pattern of PREFERENCES[vendor]) {
    const match = sorted.find((id) => pattern.test(id) && !/(preview|exp|audio|search|realtime|nano)/.test(id));
    if (match) return match;
  }
  return models[0];
}
