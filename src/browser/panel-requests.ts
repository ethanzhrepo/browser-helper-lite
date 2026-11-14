import { browser } from 'wxt/browser';
import type { ContextSnapshot } from '../shared/types';

/**
 * Something started outside the side panel (the page's right-click menu) for
 * the panel of one tab to pick up. Kept in session storage under the tab's
 * id, because the panel may still be opening when the request is made.
 */
export type PanelRequest =
  /** Attach the selected text and wait for the question. */
  | { kind: 'selection'; context: ContextSnapshot; at: number }
  /** Summarize the page; `context` is missing when the page could not be read from the menu. */
  | { kind: 'summarize'; context?: ContextSnapshot; at: number };

const PREFIX = 'panelRequest:';
const keyFor = (tabId: number) => `${PREFIX}${tabId}`;

/** Older requests are dropped: the panel never opened for them. */
const MAX_AGE_MS = 60_000;

export async function queuePanelRequest(tabId: number, request: PanelRequest): Promise<void> {
  await browser.storage.session.set({ [keyFor(tabId)]: request });
}

/** Removes and returns the tab's pending request, if a fresh one exists. */
export async function takePanelRequest(tabId: number): Promise<PanelRequest | undefined> {
  const key = keyFor(tabId);
  const request = (await browser.storage.session.get(key))[key] as PanelRequest | undefined;
  if (!request) return undefined;
  await browser.storage.session.remove(key);
  return Date.now() - request.at <= MAX_AGE_MS ? request : undefined;
}

/** Calls `listener` whenever a request is queued for the tab. */
export function watchPanelRequests(tabId: number, listener: () => void): () => void {
  const key = keyFor(tabId);
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'session' && changes[key]?.newValue) listener();
  };
  browser.storage.onChanged.addListener(onChanged);
  return () => browser.storage.onChanged.removeListener(onChanged);
}
