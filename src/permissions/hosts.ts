import { browser } from 'wxt/browser';

const RESTRICTED_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'chrome-search://',
  'chrome-untrusted://',
  'devtools://',
  'edge://',
  'about:',
  'view-source:',
  'file://',
  'https://chromewebstore.google.com/',
  'https://chrome.google.com/webstore',
];

/** Pages Chrome never lets extensions read or script (§6). */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/**
 * Match pattern for a URL's host. Ports are left out on purpose: a pattern
 * without a port matches every port (e.g. a local Ollama on :11434).
 */
export function originPattern(url: string): string {
  const { protocol, hostname } = new URL(url);
  return `${protocol}//${hostname}/*`;
}

export const ALL_SITES_PATTERN = '<all_urls>';

export async function hasHostAccess(url: string): Promise<boolean> {
  return browser.permissions.contains({ origins: [originPattern(url)] });
}

/**
 * Must be called synchronously from a user gesture (a click handler), before
 * any `await`, or Chrome rejects the request.
 */
export function requestHostAccess(urlOrAll: string): Promise<boolean> {
  const origins = urlOrAll === ALL_SITES_PATTERN ? [ALL_SITES_PATTERN] : [originPattern(urlOrAll)];
  return browser.permissions.request({ origins });
}

export async function listGrantedOrigins(): Promise<string[]> {
  return (await browser.permissions.getAll()).origins ?? [];
}

export function revokeOrigin(pattern: string): Promise<boolean> {
  return browser.permissions.remove({ origins: [pattern] });
}
