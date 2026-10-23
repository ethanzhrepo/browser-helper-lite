import { browser } from 'wxt/browser';

/**
 * A page's favicon through Chrome's local favicon service. Our pages may only
 * load images from the extension itself (see the CSP in wxt.config.ts), so
 * nothing in the side panel can make the browser contact another server.
 */
export function faviconUrl(pageUrl: string, size = 32): string {
  const url = new URL((browser.runtime.getURL as (path: string) => string)('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}
