import { browser, type Browser } from 'wxt/browser';
import type { ContextSnapshot } from '../shared/types';

export interface ActiveTab {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

/** Result of entrypoints/extract-page.ts, injected into the page. */
export interface PageExtraction {
  title: string;
  url: string;
  lang: string;
  markdown: string;
  method: 'readability' | 'innerText';
  /** The page describes a product in its metadata; its figures lead the Markdown. */
  product?: boolean;
  /** A sample of the text a person cannot see, which was left out (checked for injected instructions). */
  hiddenText?: string;
}

/** True when the tab shows a product a shop sells: its metadata says so. Needs access to the site; false when the page cannot be asked. */
export async function isProductPage(tabId: number): Promise<boolean> {
  try {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      func: () =>
        Boolean(document.querySelector('[itemtype*="schema.org/Product" i], meta[property="og:type" i][content*="product" i], meta[property="product:price:amount" i]')) ||
        [...document.querySelectorAll('script[type="application/ld+json"]')].some((script) => /"@type"\s*:\s*(?:\[[^\]]*)?"Product"/i.test(script.textContent ?? '')),
    });
    return injection?.result === true;
  } catch {
    return false;
  }
}

/** Character budgets per attachment (roughly 15k and 5k tokens). */
export const PAGE_CHAR_LIMIT = 60_000;
export const SELECTION_CHAR_LIMIT = 20_000;

const toActiveTab = (tab: Browser.tabs.Tab | undefined): ActiveTab | undefined =>
  tab?.id === undefined ? undefined : { id: tab.id, title: tab.title ?? '', url: tab.url ?? '', favIconUrl: tab.favIconUrl };

export async function getTab(tabId: number): Promise<ActiveTab | undefined> {
  return toActiveTab(await browser.tabs.get(tabId).catch(() => undefined));
}

/**
 * The active tab of the window hosting the calling extension page. When the
 * panel itself is open as a tab (in tests), the most recently used other tab
 * of the window is the target instead.
 */
export async function getActiveTab(): Promise<ActiveTab | undefined> {
  const ownOrigin = new URL(browser.runtime.getURL('/')).origin;
  const isOwnPage = (url?: string) => Boolean(url?.startsWith(ownOrigin));
  let [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (isOwnPage(tab?.url)) {
    const others = await browser.tabs.query({ currentWindow: true });
    tab = others
      .filter((candidate) => !isOwnPage(candidate.url))
      .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  }
  return toActiveTab(tab);
}

export function truncate(text: string, limit: number): { text: string; truncated: boolean } {
  return text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text, truncated: false };
}

export async function capturePage(tabId: number): Promise<ContextSnapshot> {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    files: ['/extract-page.js'],
  });
  const page = injection?.result as PageExtraction | undefined;
  if (!page) throw new Error('Page extraction returned no result');
  const { text, truncated } = truncate(page.markdown, PAGE_CHAR_LIMIT);
  return { kind: 'page', title: page.title, url: page.url, content: text, truncated, capturedAt: Date.now() };
}

/** Current text selection in any frame of the tab, or undefined when nothing is selected. */
export async function captureSelection(tab: ActiveTab): Promise<ContextSnapshot | undefined> {
  const injections = await browser.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => window.getSelection()?.toString() ?? '',
  });
  const selected = injections.map((injection) => String(injection.result ?? '').trim()).find(Boolean);
  if (!selected) return undefined;
  const { text, truncated } = truncate(selected, SELECTION_CHAR_LIMIT);
  return { kind: 'selection', title: tab.title, url: tab.url, content: text, truncated, capturedAt: Date.now() };
}
