import { browser } from 'wxt/browser';

/**
 * The side panel belongs to the tab it was opened on, like Claude in Chrome:
 * it shows only there, and each tab gets its own (§4.7). There is no global
 * panel; a panel's URL names its tab.
 */
const TAB_PARAM = 'tab';

/**
 * Opens the side panel on a tab. Chrome only opens one during a user gesture
 * (a click on the toolbar button, a notification, the panel or the page
 * overlay), so call this synchronously from the handler. For the same reason
 * both calls go out at once: awaiting the first would lose the gesture.
 */
export function openPanel(tabId: number): Promise<void> {
  void browser.sidePanel
    .setOptions({ tabId, path: `sidepanel.html?${TAB_PARAM}=${tabId}`, enabled: true })
    .catch(() => undefined);
  return browser.sidePanel.open({ tabId });
}

/** The tab a panel page belongs to, or undefined for the panel opened as a page (in tests). */
export function panelTabOf(url: string | undefined): number | undefined {
  if (!url) return undefined;
  const id = Number(new URL(url).searchParams.get(TAB_PARAM));
  return Number.isInteger(id) && id > 0 ? id : undefined;
}
