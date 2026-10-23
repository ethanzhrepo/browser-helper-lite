import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { ActiveTab } from '../browser/page-context';
import { isRestrictedUrl } from '../permissions/hosts';

const MAX_TABS = 20;

/** Readable tabs of the panel's window, most recently used first (for @-mentions). */
export function useWindowTabs(): ActiveTab[] {
  const [tabs, setTabs] = useState<ActiveTab[]>([]);

  useEffect(() => {
    const ownOrigin = new URL(browser.runtime.getURL('/')).origin;
    let disposed = false;
    const refresh = async () => {
      const all = await browser.tabs.query({ currentWindow: true });
      if (disposed) return;
      setTabs(
        all
          .filter((t) => t.id !== undefined && t.url && !t.url.startsWith(ownOrigin) && !isRestrictedUrl(t.url))
          .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
          .slice(0, MAX_TABS)
          .map((t) => ({ id: t.id!, title: t.title ?? '', url: t.url ?? '', favIconUrl: t.favIconUrl })),
      );
    };
    const onUpdated = (_id: number, change: { url?: string; title?: string; status?: string }) => {
      if (change.url || change.title || change.status === 'complete') void refresh();
    };
    const onChange = () => void refresh();
    void refresh();
    browser.tabs.onCreated.addListener(onChange);
    browser.tabs.onRemoved.addListener(onChange);
    browser.tabs.onActivated.addListener(onChange);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      disposed = true;
      browser.tabs.onCreated.removeListener(onChange);
      browser.tabs.onRemoved.removeListener(onChange);
      browser.tabs.onActivated.removeListener(onChange);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return tabs;
}
