import { useEffect, useRef, useState } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { getActiveTab, type ActiveTab } from '../browser/page-context';
import { hasHostAccess, isRestrictedUrl } from '../permissions/hosts';

export type PageAccess = 'none' | 'restricted' | 'missing' | 'granted';

/** Tracks the active tab of the side panel's window and whether we may read it. */
export function useActiveTab(): { tab?: ActiveTab; access: PageAccess } {
  const [tab, setTab] = useState<ActiveTab>();
  const [access, setAccess] = useState<PageAccess>('none');
  const tabIdRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const next = await getActiveTab();
      if (disposed) return;
      tabIdRef.current = next?.id;
      setTab(next);
      if (!next) setAccess('none');
      else if (isRestrictedUrl(next.url)) setAccess('restricted');
      else setAccess((await hasHostAccess(next.url)) ? 'granted' : 'missing');
    };
    const onUpdated = (_id: number, change: Browser.tabs.OnUpdatedInfo, updated: Browser.tabs.Tab) => {
      const relevant = updated.active || updated.id === tabIdRef.current;
      if (relevant && (change.url || change.title || change.favIconUrl || change.status === 'complete')) {
        void refresh();
      }
    };
    const onChange = () => void refresh();

    void refresh();
    browser.tabs.onActivated.addListener(onChange);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.permissions.onAdded.addListener(onChange);
    browser.permissions.onRemoved.addListener(onChange);
    return () => {
      disposed = true;
      browser.tabs.onActivated.removeListener(onChange);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.permissions.onAdded.removeListener(onChange);
      browser.permissions.onRemoved.removeListener(onChange);
    };
  }, []);

  return { tab, access };
}
