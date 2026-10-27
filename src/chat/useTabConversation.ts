import { useCallback, useEffect, useRef } from 'react';
import { conversationForTab, watchTabConversation } from '../storage/tab-conversations';

/** The service worker links a tab it just opened a moment after the tab appears. */
const LINK_GRACE_MS = 400;

/**
 * One chat per tab: show the conversation linked to the panel's tab, or a new
 * chat; for the panel opened as a page, again whenever the active tab changes.
 * Returns `resync`, to check again after something may have raced a switch.
 */
export function useTabConversation({ tabId, currentId, busy, open, reset }: {
  tabId: number | undefined;
  currentId: string | undefined;
  /** A turn of the current conversation is running (it may have just opened this tab). */
  busy: boolean;
  open: (conversationId: string) => Promise<void>;
  reset: () => void;
}): { resync: () => void } {
  const latest = useRef({ tabId, currentId, busy, open, reset });
  latest.current = { tabId, currentId, busy, open, reset };
  const generation = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const sync = useCallback(() => {
    const tab = latest.current.tabId;
    clearTimeout(retry.current);
    if (tab === undefined) return;
    const run = ++generation.current;
    const show = (linked: string | undefined) => {
      const now = latest.current;
      if (run !== generation.current || now.tabId !== tab || linked === now.currentId) return;
      if (linked) void now.open(linked);
      else now.reset();
    };
    void conversationForTab(tab).then((linked) => {
      const now = latest.current;
      // Only a running turn opens tabs, and while it runs nothing can be sent, so waiting is safe.
      if (linked || !now.currentId || !now.busy) return show(linked);
      retry.current = setTimeout(() => void conversationForTab(tab).then(show), LINK_GRACE_MS);
    });
  }, []);

  useEffect(() => {
    sync();
    if (tabId === undefined) return;
    // E.g. the agent opened this tab for the conversation.
    const unwatch = watchTabConversation(tabId, (linked) => {
      const now = latest.current;
      if (linked && linked !== now.currentId) void now.open(linked);
    });
    return () => {
      generation.current++;
      clearTimeout(retry.current);
      unwatch();
    };
  }, [tabId, sync]);

  return { resync: sync };
}
