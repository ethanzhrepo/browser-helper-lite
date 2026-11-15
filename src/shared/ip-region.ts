import { browser } from 'wxt/browser';
import { IP_REGION_LOOKUP } from './build-flags';
import { isRegionCode, type IpRegion } from './region';

/**
 * The country of the user's IP address, for Settings › Language ›
 * Automatic. Asked of a service that answers with the country code alone:
 * api.country.is, and Cloudflare's trace page when that one does not answer.
 * The service sees the user's IP address, as any site does; nothing else is
 * sent (no cookies, no referrer). The answer is kept for 12 hours, so a
 * request does not wait for it.
 */
export const IP_REGION_KEY = 'region:ip';
export const IP_REGION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** When a new look-up fails, an older answer is still used for this long. */
const STALE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const LOOKUP_MS = 4000;

export const IP_REGION_SERVICES: { url: string; read: (text: string) => string | undefined }[] = [
  { url: 'https://api.country.is/', read: (text) => (JSON.parse(text) as { country?: string }).country },
  { url: 'https://www.cloudflare.com/cdn-cgi/trace', read: (text) => /^loc=([A-Z]{2})$/m.exec(text)?.[1] },
];

/** Asks the services in turn; undefined when none could place the address. */
export async function lookUpIpRegion(fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  for (const service of IP_REGION_SERVICES) {
    try {
      const response = await fetchImpl(service.url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: AbortSignal.timeout(LOOKUP_MS) });
      if (!response.ok) continue;
      const code = service.read(await response.text())?.toUpperCase();
      // "XX" and "T1" stand for unknown and Tor.
      if (isRegionCode(code)) return code;
    } catch {
      // The next one.
    }
  }
  return undefined;
}

/**
 * The country of the IP address: the kept answer while it is fresh,
 * otherwise a new look-up (an older answer when that fails). `refresh` looks
 * up whatever is kept. Test builds never look up; they use what a test kept.
 */
export async function ipRegion({ refresh = false, now = Date.now(), lookUp = IP_REGION_LOOKUP, fetchImpl }: { refresh?: boolean; now?: number; lookUp?: boolean; fetchImpl?: typeof fetch } = {}): Promise<IpRegion | undefined> {
  const kept = (await browser.storage.local.get(IP_REGION_KEY))[IP_REGION_KEY] as IpRegion | undefined;
  const valid = kept && isRegionCode(kept.code) && typeof kept.at === 'number' ? kept : undefined;
  if (!lookUp || (!refresh && valid && now - valid.at < IP_REGION_MAX_AGE_MS)) return valid;
  const code = await lookUpIpRegion(fetchImpl);
  if (code) {
    const fresh = { code, at: now };
    await browser.storage.local.set({ [IP_REGION_KEY]: fresh });
    return fresh;
  }
  return valid && now - valid.at < STALE_MAX_AGE_MS ? valid : undefined;
}
