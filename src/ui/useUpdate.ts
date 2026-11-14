import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { availableUpdate, loadUpdateState, watchUpdateState, type UpdateState } from '../updates/check';

/** What the last update check found, kept current while the page is open. */
export function useUpdateState(): UpdateState | undefined {
  const [state, setState] = useState<UpdateState>();
  useEffect(() => {
    let active = true;
    void loadUpdateState().then((loaded) => active && setState(loaded));
    const unwatch = watchUpdateState(setState);
    return () => {
      active = false;
      unwatch();
    };
  }, []);
  return state;
}

/** The newer release to tell the user about, unless they closed the notice for it. */
export function useUpdateNotice(): { version: string; url: string } | undefined {
  const state = useUpdateState();
  const update = availableUpdate(state, browser.runtime.getManifest().version);
  return update && state?.dismissed !== update.version ? update : undefined;
}
