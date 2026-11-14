import { browser, type Browser } from 'wxt/browser';
import { capturePage, SELECTION_CHAR_LIMIT, truncate } from '../browser/page-context';
import { queuePanelRequest } from '../browser/panel-requests';
import { openPanel } from '../browser/side-panel';
import { resolveLocale } from '../i18n/resources';
import { createTranslator } from '../i18n/translator';
import { loadSettings, watchSettings } from '../storage/settings';

const ASK_SELECTION = 'ask-selection';
const SUMMARIZE_PAGE = 'summarize-page';
const WEB_PAGES = ['http://*/*', 'https://*/*'];

let building: Promise<void> = Promise.resolve();
let builtFor: string | undefined;

/** (Re)creates the menu entries in the interface language. One build at a time: Chrome rejects duplicate ids. */
function buildMenus(): Promise<void> {
  building = building
    .then(async () => {
      const locale = resolveLocale((await loadSettings()).language, browser.i18n.getUILanguage());
      if (builtFor === locale) return;
      const t = await createTranslator(locale);
      await browser.contextMenus.removeAll();
      browser.contextMenus.create({ id: ASK_SELECTION, title: t('menu.askSelection'), contexts: ['selection'], documentUrlPatterns: WEB_PAGES });
      browser.contextMenus.create({ id: SUMMARIZE_PAGE, title: t('menu.summarize'), contexts: ['page'], documentUrlPatterns: WEB_PAGES });
      builtFor = locale;
    })
    .catch((error: unknown) => console.warn('Could not build the context menu', error));
  return building;
}

function onClicked(info: Browser.contextMenus.OnClickData, tab?: Browser.tabs.Tab) {
  if (tab?.id === undefined) return;
  const tabId = tab.id;
  // First and synchronously: Chrome only opens the panel while the click still counts as a user gesture.
  openPanel(tabId).catch(() => undefined);
  const at = Date.now();
  if (info.menuItemId === ASK_SELECTION) {
    const { text, truncated } = truncate((info.selectionText ?? '').trim(), SELECTION_CHAR_LIMIT);
    if (!text) return;
    const context = { kind: 'selection' as const, title: tab.title ?? '', url: info.pageUrl ?? tab.url ?? '', content: text, truncated, capturedAt: at };
    void queuePanelRequest(tabId, { kind: 'selection', context, at });
  } else if (info.menuItemId === SUMMARIZE_PAGE) {
    // The click lets us read this tab once (activeTab), even on a site without site access.
    void capturePage(tabId)
      .catch(() => undefined)
      .then((context) => queuePanelRequest(tabId, { kind: 'summarize', context, at }));
  }
}

/** "Ask about the selection" and "Summarize this page" in the page's right-click menu. */
export function registerContextMenus(): void {
  if (!browser.contextMenus) return;
  browser.contextMenus.onClicked.addListener(onClicked);
  // Menus survive restarts, but not updates or a changed language; rebuilding is cheap.
  void buildMenus();
  watchSettings(() => {
    void buildMenus();
  });
}
