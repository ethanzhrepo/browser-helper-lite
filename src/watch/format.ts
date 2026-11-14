import type { TFunction } from 'i18next';

/** "every 5 s", "every 5 min", "every 2 h", "every day": how often a watch looks. */
export function formatInterval(t: TFunction, seconds: number): string {
  if (seconds < 60) return t('watch.interval.seconds', { n: seconds });
  if (seconds < 3600) return t('watch.interval.minutes', { n: Math.round(seconds / 60) });
  if (seconds < 86_400) return t('watch.interval.hours', { n: Math.round(seconds / 3600) });
  return t('watch.interval.day');
}
