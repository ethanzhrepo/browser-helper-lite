import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import type { InstalledSkill } from './skills';
import { listInstalledSkills } from './store';

/** The installed skills, as they are stored now (also when another page or the background changes them). */
export function useInstalledSkills(): InstalledSkill[] {
  const [skills, setSkills] = useState<InstalledSkill[]>([]);
  useEffect(() => {
    const subscription = liveQuery(listInstalledSkills).subscribe({ next: setSkills, error: () => undefined });
    return () => subscription.unsubscribe();
  }, []);
  return skills;
}
