import { browser, type Browser } from 'wxt/browser';

/**
 * True for messages from our own pages (side panel, settings). The scripts we
 * inject into web pages can message the service worker too; they must never
 * reach privileged handlers, in case a page manages to compromise its
 * renderer. Chrome sets `sender.url` itself, so a page cannot forge it.
 */
export function isExtensionPage(sender: Browser.runtime.MessageSender | undefined): boolean {
  if (!sender || sender.id !== browser.runtime.id) return false;
  return (sender.url ?? '').startsWith(browser.runtime.getURL('/'));
}

/** API keys live in local storage, which content scripts can read by default. Keep it to our pages. */
export async function restrictStorage(): Promise<void> {
  await browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch((error: unknown) => {
    console.warn('Could not restrict storage access', error);
  });
}
