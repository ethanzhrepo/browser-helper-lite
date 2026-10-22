import { useEffect, useState } from 'react';
import type { Settings } from '../shared/types';
import { loadSettings, watchSettings } from '../storage/settings';

/** Live settings; undefined until the first load completes. */
export function useSettings(): Settings | undefined {
  const [settings, setSettings] = useState<Settings>();
  useEffect(() => {
    let active = true;
    void loadSettings().then((loaded) => active && setSettings(loaded));
    const unwatch = watchSettings(setSettings);
    return () => {
      active = false;
      unwatch();
    };
  }, []);
  return settings;
}
