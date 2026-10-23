import { browser } from 'wxt/browser';

/**
 * Which conversation each tab shows (one chat per tab). Tab ids only live as
 * long as the browser session, so the links go in session storage: one key
 * per tab, so the panel and the service worker never overwrite each other.
 */
const PREFIX = 'tabConversation:';
const keyFor = (tabId: number) => `${PREFIX}${tabId}`;

export async function conversationForTab(tabId: number): Promise<string | undefined> {
  const key = keyFor(tabId);
  return (await browser.storage.session.get(key))[key] as string | undefined;
}

export async function linkTab(tabId: number, conversationId: string): Promise<void> {
  if (tabId < 0) return;
  await browser.storage.session.set({ [keyFor(tabId)]: conversationId });
}

export async function unlinkTab(tabId: number): Promise<void> {
  await browser.storage.session.remove(keyFor(tabId));
}

/** Calls `listener` when the conversation linked to `tabId` changes. */
export function watchTabConversation(tabId: number, listener: (conversationId: string | undefined) => void): () => void {
  const key = keyFor(tabId);
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    // A removed key has no newValue (some implementations report null).
    if (area === 'session' && key in changes) listener((changes[key]!.newValue as string | null | undefined) ?? undefined);
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
