import { generateText } from 'ai';
import { browser, type Browser } from 'wxt/browser';
import { newBoundary, wrapUntrusted } from '../agent/injection';
import { policyFor } from '../agent/policy';
import type { PageExtraction } from '../browser/page-context';
import { resolveLocale } from '../i18n/resources';
import { createTranslator } from '../i18n/translator';
import { hasHostAccess, isRestrictedUrl } from '../permissions/hosts';
import { toErrorInfo } from '../providers/errors';
import { pickSlot, resolveModelRef } from '../providers/resolve';
import { isLoopbackHost } from '../providers/vendors';
import { searchApiKey } from '../search/keys';
import { deepseekFetch, fetchEndpoint, readsThroughDeepSeek } from '../search/search';
import type { WatchActionRequest, WatchActionResult } from '../shared/protocol';
import type { Settings, Usage } from '../shared/types';
import { db, newId } from '../storage/db';
import { loadSettings } from '../storage/settings';
import { challengeShown } from '../browser/captcha';
import { watchInPage, type PageCommand } from '../watch/page';
import {
  afterCheck,
  alarmMinutes,
  clampSeconds,
  isLive,
  isRushing,
  MAX_WATCHES,
  newWatch,
  parseVerdict,
  recheckAfterMs,
  RUSH_MINUTES,
  RUSH_SECONDS,
  textDigest,
  unchanged,
  WATCH_SYSTEM,
  watchAlarm,
  watchNotification,
  watchOfAlarm,
  watchOfNotification,
  type Watch,
  type WatchCheck,
  type WatchPart,
} from '../watch/watch';
import { isExtensionPage } from './trust';

const PAGE_CHARS = 40_000;
const LOAD_TIMEOUT_MS = 25_000;
const SETTLE_MS = 1500;
/** Session storage: the background tab of each live watch, and the tab group they sit in. */
const TABS_KEY = 'watchTabs';
const GROUP_KEY = 'watchGroup';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The checks of one watch never overlap. */
const checking = new Set<string>();

async function setAlarm(watch: Watch): Promise<void> {
  const minutes = alarmMinutes(watch);
  await browser.alarms.create(watchAlarm(watch.id), { delayInMinutes: minutes, periodInMinutes: minutes });
}

// ---- The tabs of live watches ----

async function liveTabs(): Promise<Record<string, number>> {
  return ((await browser.storage.session.get(TABS_KEY))[TABS_KEY] as Record<string, number> | undefined) ?? {};
}

async function setLiveTab(id: string, tabId: number | undefined): Promise<void> {
  const tabs = await liveTabs();
  if (tabId === undefined) delete tabs[id];
  else tabs[id] = tabId;
  await browser.storage.session.set({ [TABS_KEY]: tabs });
}

/** Closes the background tab a live watch kept open, if it has one. */
async function closeLiveTab(id: string): Promise<void> {
  const tabId = (await liveTabs())[id];
  if (tabId === undefined) return;
  // Forgotten first, so that closing it is not taken for the user closing it.
  await setLiveTab(id, undefined);
  await browser.tabs.remove(tabId).catch(() => undefined);
}

/** Live watches' tabs sit together in one collapsed group, out of the way and named for what they are. */
async function tuckAway(tabId: number, settings: Settings): Promise<void> {
  try {
    const known = (await browser.storage.session.get(GROUP_KEY))[GROUP_KEY] as number | undefined;
    const joined = known !== undefined && (await browser.tabs.group({ groupId: known, tabIds: [tabId] }).then(() => true, () => false));
    if (joined) return;
    const groupId = await browser.tabs.group({ tabIds: [tabId] });
    const t = await createTranslator(resolveLocale(settings.language, browser.i18n.getUILanguage()));
    await browser.tabGroups.update(groupId, { title: t('watch.groupTitle'), color: 'grey', collapsed: true });
    await browser.storage.session.set({ [GROUP_KEY]: groupId });
  } catch (error) {
    console.debug('Could not group the watch tab', error);
  }
}

async function loaded(tabId: number): Promise<void> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  while (Date.now() < deadline && (await browser.tabs.get(tabId)).status !== 'complete') await sleep(250);
  // Pages fill in prices and stock after they load.
  await sleep(SETTLE_MS);
}

// ---- Looking at the page ----

/** The watched page while it is being looked at. */
export interface PageSession {
  /** What the given pieces of the page say now. */
  probe(locators: string[]): Promise<(string | null)[]>;
  /** The page's text, for the model. */
  read(): Promise<{ title: string; content: string }>;
  /** Where the texts the model named are in the page. */
  locate(quotes: string[]): Promise<WatchPart[]>;
  /** Whether the page asks to prove that a person is there instead of showing what was asked for. */
  blocked(): Promise<boolean>;
  /** Keeps watching those pieces from inside the page (live watches). */
  live(parts: WatchPart[]): Promise<void>;
  /** Done looking: a tab opened for one look is closed. */
  done(): Promise<void>;
}

async function inPage<T>(tabId: number, command: PageCommand): Promise<T> {
  const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: watchInPage, args: [command] });
  return injection?.result as T;
}

function tabSession(watch: Watch, tabId: number, keep: boolean): PageSession {
  return {
    probe: (locators) => inPage<(string | null)[]>(tabId, { kind: 'probe', locators }),
    read: async () => {
      const [injection] = await browser.scripting.executeScript({ target: { tabId }, files: ['/extract-page.js'] });
      const page = injection?.result as PageExtraction | undefined;
      if (!page) throw new Error('The page could not be read.');
      return { title: page.title, content: page.markdown };
    },
    locate: (quotes) => inPage<WatchPart[]>(tabId, { kind: 'locate', quotes }),
    // Whether the page asks to prove that a person is there (a CAPTCHA to solve, a "checking your browser" page).
    blocked: async () => {
      const [injection] = await browser.scripting.executeScript({ target: { tabId }, func: challengeShown });
      // "Access denied" asks nothing of a person, but the page is not what is watched either.
      return injection?.result === true || /^access denied/i.test((await browser.tabs.get(tabId).catch(() => undefined))?.title ?? '');
    },
    live: async (parts) => {
      if (keep) await inPage(tabId, { kind: 'live', id: watch.id, parts, everySeconds: watch.everySeconds });
    },
    done: async () => {
      if (!keep) await browser.tabs.remove(tabId).catch(() => undefined);
    },
  };
}

/** A public page read through DeepSeek's Fetch API: there is no page to look into, so its whole text is what is compared. */
function fetchSession(watch: Watch, settings: Settings): PageSession {
  let page: Promise<{ title: string; content: string }> | undefined;
  const read = () =>
    (page ??= (async () => deepseekFetch(watch.url, { settings: settings.search, connections: settings.connections, apiKey: await searchApiKey('deepseek', settings) }))());
  const whole = async (): Promise<WatchPart[]> => [{ locator: '', text: textDigest((await read()).content) }];
  return {
    probe: async (locators) => {
      const [part] = await whole();
      return locators.map((locator) => (locator ? null : part!.text));
    },
    read,
    locate: whole,
    blocked: async () => false,
    live: async () => undefined,
    done: async () => undefined,
  };
}

/**
 * Opens the watched page to look at it. In a background tab where the
 * extension has access to the site: it is the user's browser, so the page is
 * what they would see, signed in. A live watch keeps its tab; the others
 * close it after the look. Without access to the site, DeepSeek's Fetch API
 * reads public pages when that is on. Nothing on the page is touched.
 */
async function openPage(watch: Watch, settings: Settings, { reload }: { reload: boolean }): Promise<PageSession | undefined> {
  const host = hostOf(watch.url);
  if (!host || isRestrictedUrl(watch.url)) throw new Error('Not a web page.');
  if (policyFor(host, settings.sitePolicies) === 'blocked') throw new Error(`${host} is blocked for the assistant.`);
  if (!(await hasHostAccess(watch.url))) {
    if (readsThroughDeepSeek(settings.search) && !isLoopbackHost(host) && (await hasHostAccess(fetchEndpoint(settings.search, settings.connections)))) {
      return fetchSession(watch, settings);
    }
    throw new Error(`The assistant has no access to ${host}.`);
  }
  const keep = isLive(watch, Date.now());
  // A tab kept from a faster pace or a rush that is over goes: from now on the page is opened for each look.
  if (!keep) await closeLiveTab(watch.id);
  if (keep) {
    const known = (await liveTabs())[watch.id];
    const tab = known === undefined ? undefined : await browser.tabs.get(known).catch(() => undefined);
    // Still on the watched site: a page that sends the tab elsewhere is opened again.
    if (tab?.id !== undefined && hostOf(tab.url ?? '') === host) {
      if (reload) {
        await browser.tabs.reload(tab.id);
        await loaded(tab.id);
      }
      return tabSession(watch, tab.id, true);
    }
    if (known !== undefined) await closeLiveTab(watch.id);
  }
  // Without a window there is nobody to tell, and nowhere to open a tab.
  if ((await browser.windows.getAll({ windowTypes: ['normal'] })).length === 0) return undefined;
  const tab = await browser.tabs.create({ url: watch.url, active: false });
  if (keep) {
    await setLiveTab(watch.id, tab.id!);
    await tuckAway(tab.id!, settings);
  }
  try {
    await loaded(tab.id!);
  } catch (error) {
    if (!keep) await browser.tabs.remove(tab.id!).catch(() => undefined);
    throw error;
  }
  return tabSession(watch, tab.id!, keep);
}

/** Asks the fast model (else the current one) whether the page shows that the condition holds, and which of its text that depends on. */
async function judge(page: { title: string; content: string }, watch: Watch, settings: Settings): Promise<{ met: boolean; note: string; quotes: string[]; usage?: Usage }> {
  const ref = pickSlot(settings, ['fast', 'chat']);
  if (!ref) throw new Error('No model is set.');
  const { model, providerOptions } = await resolveModelRef(settings, ref);
  const text = page.content.length > PAGE_CHARS ? page.content.slice(0, PAGE_CHARS) : page.content;
  const result = await generateText({
    model,
    instructions: WATCH_SYSTEM,
    prompt: `${wrapUntrusted('page', newBoundary(), { title: page.title.slice(0, 200), url: watch.url }, text)}\n\nCondition: ${watch.condition}\nToday's date: ${new Date().toISOString().slice(0, 10)}`,
    providerOptions,
    maxRetries: 1,
  });
  return { ...parseVerdict(result.text), usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } };
}

/**
 * Tells the user with a system notification. Its words are ours and the
 * condition the user approved; nothing a page or a model wrote is in it.
 */
async function notify(watch: Watch, settings: Settings, kind: WatchNotice): Promise<void> {
  if (!browser.notifications) return;
  const t = await createTranslator(resolveLocale(settings.language, browser.i18n.getUILanguage()));
  await browser.notifications
    .create(watchNotification(watch.id), {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: t(`watch.notification.${kind}Title`),
      message: t(`watch.notification.${kind}`, { site: hostOf(watch.url), condition: watch.condition.slice(0, 140) }),
      requireInteraction: kind === 'met',
    })
    .catch(() => undefined);
}

/** What the user is told about: the condition holds, the watch gave up, or the site stopped answering and the watch slowed down. */
export type WatchNotice = 'met' | 'failed' | 'slowed';

/** The site showed a CAPTCHA or a "checking your browser" page instead of its content. */
class BlockedError extends Error {
  constructor() {
    super('The site asks to verify that you are human.');
    this.name = 'BlockedError';
  }
}

export interface CheckDeps {
  open: (watch: Watch, settings: Settings, options: { reload: boolean }) => Promise<PageSession | undefined>;
  judge: (page: { title: string; content: string }, watch: Watch, settings: Settings) => Promise<{ met: boolean; note: string; quotes: string[]; usage?: Usage }>;
  notify: (watch: Watch, settings: Settings, kind: WatchNotice) => Promise<void>;
  /** A watch stopped: what was kept for it (a live watch's tab) goes. */
  release: (id: string) => Promise<void>;
  now: () => number;
}

const realDeps: CheckDeps = { open: openPage, judge, notify, release: closeLiveTab, now: () => Date.now() };

export interface CheckOptions {
  /** Load the page afresh (a timer tick, or the user asking); not when the open page itself reported a change. */
  reload?: boolean;
  /** Ask the model even when the text it depended on reads the same. */
  ask?: boolean;
}

/**
 * One look at one watch's page. The model is asked when there is no verdict
 * to go by yet, when the text the last verdict depended on has changed, when
 * that verdict is old, or when told to. Resolves with the watch as it is
 * afterwards (undefined when it is gone).
 */
export async function checkWatch(id: string, deps: CheckDeps = realDeps, { reload = true, ask = false }: CheckOptions = {}): Promise<Watch | undefined> {
  if (checking.has(id)) return db.watches.get(id);
  checking.add(id);
  try {
    const watch = await db.watches.get(id);
    if (!watch || watch.status !== 'active') {
      await browser.alarms.clear(watchAlarm(id));
      await deps.release(id);
      return watch;
    }
    const settings = await loadSettings();
    const at = deps.now();
    /** Stores the outcome, unless the watch was paused or deleted while the page was looked at. */
    const settle = async (change: (current: Watch) => Watch): Promise<Watch | undefined> => {
      const current = await db.watches.get(id);
      if (!current || current.status !== 'active') return current;
      const next = change(current);
      await db.watches.put(next);
      if (next.status !== 'active') {
        await browser.alarms.clear(watchAlarm(id));
        await deps.release(id);
        if (next.status === 'met' || next.status === 'failed') await deps.notify(next, settings, next.status);
      }
      return next;
    };
    if (at >= watch.expiresAt) return settle((current) => ({ ...current, status: 'expired' }));
    // The last look failed: the site is left alone for a while, unless the user asks for a look now.
    if (!ask && (watch.retryAt ?? 0) > at) return watch;

    let session: PageSession | undefined;
    try {
      session = await deps.open(watch, settings, { reload });
      // Nothing to look with right now (no window): try again next time.
      if (!session) return watch;
      if (await session.blocked()) throw new BlockedError();
      const probe = watch.probe;
      if (probe && !ask && at - probe.judgedAt < recheckAfterMs(watch)) {
        const now = await session.probe(probe.parts.map((part) => part.locator));
        if (unchanged(probe.parts, now)) {
          // What the verdict rested on reads the same: it still stands, and the model is not asked.
          await session.live(probe.parts);
          return await settle((current) => ({ ...current, checkedAt: at, failures: 0, retryAt: undefined }));
        }
      }
      const page = await session.read();
      const verdict = await deps.judge(page, watch, settings);
      const parts = await session.locate(verdict.quotes);
      const next = await settle((current) => afterCheck(current, { at, met: verdict.met, note: verdict.note }, verdict.usage, parts));
      if (next?.status === 'active') await session.live(parts);
      return next;
    } catch (error) {
      const message = toErrorInfo(error).message.slice(0, 200);
      const next = await settle((current) => afterCheck(current, { at, met: false, note: '', error: message }));
      // Stopped by a CAPTCHA, or in the middle of a rush: the watch goes on, slower, and the user should know why nothing is coming.
      if (next?.status === 'active' && (error instanceof BlockedError || isRushing(watch, at))) await deps.notify(next, settings, 'slowed');
      return next;
    } finally {
      await session?.done().catch(() => undefined);
    }
  } finally {
    checking.delete(id);
  }
}

/** Starts a watch and takes a first look. Throws when there are too many already. */
export async function createWatch(input: { url: string; title: string; condition: string; everySeconds: unknown }, deps: CheckDeps = realDeps): Promise<Watch> {
  const running = await db.watches.filter((watch) => watch.status === 'active' || watch.status === 'paused').count();
  if (running >= MAX_WATCHES) throw new Error(`There are already ${MAX_WATCHES} watches. Delete one first.`);
  const watch = newWatch({ id: newId(), ...input }, Date.now());
  await db.watches.put(watch);
  await setAlarm(watch);
  // The first look also finds what to compare from then on. Not waited for: the page takes a moment to load.
  void checkWatch(watch.id, deps).catch((error: unknown) => console.error('Watch check failed', error));
  return watch;
}

// ---- Rush ----

/** Watches being rushed by this service worker. */
const rushing = new Set<string>();

/**
 * Reloads a watch's page every few seconds until its rush is over. The
 * calls it makes keep the service worker awake meanwhile; should Chrome stop
 * it anyway, the watch's timer starts the rush again within half a minute.
 */
function rush(id: string): void {
  if (rushing.has(id)) return;
  rushing.add(id);
  const tick = async () => {
    const watch = await db.watches.get(id).catch(() => undefined);
    if (!watch || watch.status !== 'active' || !isRushing(watch, Date.now())) {
      rushing.delete(id);
      // The rush is over; a watch that looks less than once a minute lets its tab go.
      if (watch?.status === 'active' && !isLive(watch, Date.now())) await closeLiveTab(id);
      return;
    }
    const started = Date.now();
    await checkWatch(id).catch((error: unknown) => console.error('Watch check failed', error));
    setTimeout(() => void tick(), Math.max(500, RUSH_SECONDS * 1000 - (Date.now() - started)));
  };
  void tick();
}

async function act(request: WatchActionRequest): Promise<WatchActionResult> {
  try {
    const watch = await db.watches.get(request.id);
    if (!watch) return { ok: false };
    switch (request.action) {
      case 'check':
        // A look on request also works for a paused watch, and leaves it paused unless the condition is met.
        if (watch.status === 'paused') {
          await db.watches.put({ ...watch, status: 'active' });
          const checked = await checkWatch(watch.id, realDeps, { ask: true });
          if (checked?.status === 'active') await db.watches.update(watch.id, { status: 'paused' });
          await browser.alarms.clear(watchAlarm(watch.id));
          await closeLiveTab(watch.id);
        } else {
          await checkWatch(watch.id, realDeps, { ask: true });
        }
        break;
      case 'pause':
        if (watch.status === 'active') await db.watches.update(watch.id, { status: 'paused' });
        await browser.alarms.clear(watchAlarm(watch.id));
        await closeLiveTab(watch.id);
        break;
      case 'rush': {
        if (watch.status !== 'active') break;
        if (!request.on) {
          await db.watches.put({ ...watch, rushUntil: undefined });
          if (!isLive({ ...watch, rushUntil: undefined })) await closeLiveTab(watch.id);
          break;
        }
        // The user asks for it knowing the site may object: a wait after an earlier failure is lifted.
        await db.watches.put({ ...watch, rushUntil: Date.now() + RUSH_MINUTES * 60 * 1000, retryAt: undefined });
        rush(watch.id);
        break;
      }
      case 'resume': {
        // A watch that was met, failed or ran out starts over: the user asked for it again.
        const again: Watch = { ...watch, status: 'active', failures: 0, probe: undefined, retryAt: undefined, rushUntil: undefined, expiresAt: Math.max(watch.expiresAt, Date.now() + 24 * 60 * 60 * 1000) };
        await db.watches.put(again);
        await setAlarm(again);
        void checkWatch(watch.id).catch((error: unknown) => console.error('Watch check failed', error));
        break;
      }
      case 'interval': {
        const next: Watch = { ...watch, everySeconds: clampSeconds(request.seconds) };
        await db.watches.put(next);
        if (next.status !== 'active') break;
        await setAlarm(next);
        // Slower now: its page no longer stays open. Faster: the next look opens it.
        if (!isLive(next)) await closeLiveTab(watch.id);
        else void checkWatch(watch.id).catch((error: unknown) => console.error('Watch check failed', error));
        break;
      }
      case 'delete':
        await db.watches.delete(watch.id);
        await browser.alarms.clear(watchAlarm(watch.id));
        await closeLiveTab(watch.id);
        await browser.notifications?.clear(watchNotification(watch.id)).catch(() => undefined);
        break;
    }
    return { ok: true };
  } catch (error) {
    console.error('Watch action failed', error);
    return { ok: false };
  }
}

/** Erases every watch, its timer and its tab (Settings › Data › Erase everything). */
export async function clearWatches(): Promise<void> {
  for (const id of await db.watches.toCollection().primaryKeys()) {
    await browser.alarms.clear(watchAlarm(id));
    await closeLiveTab(id);
  }
  await db.watches.clear();
}

/** Every active watch has its timer, and no timer is left without one (after an update or a restart). */
async function syncAlarms(): Promise<void> {
  const watches = await db.watches.toArray();
  const alarms = new Set((await browser.alarms.getAll()).map((alarm) => alarm.name));
  for (const watch of watches) {
    if (watch.status === 'active' && !alarms.has(watchAlarm(watch.id))) await setAlarm(watch);
  }
  const active = new Set(watches.filter((watch) => watch.status === 'active').map((watch) => watchAlarm(watch.id)));
  for (const name of alarms) if (watchOfAlarm(name) && !active.has(name)) await browser.alarms.clear(name);
}

export function registerWatchService(): void {
  if (!browser.alarms) return;
  browser.alarms.onAlarm.addListener((alarm) => {
    const id = watchOfAlarm(alarm.name);
    if (!id) return;
    void db.watches.get(id).then((watch) => {
      // A rush that the service worker lost (Chrome stopped it) goes on from here.
      if (watch?.status === 'active' && isRushing(watch, Date.now())) rush(id);
      else void checkWatch(id).catch((error: unknown) => console.error('Watch check failed', error));
    });
  });
  void syncAlarms().catch((error: unknown) => console.warn('Could not restore the watch timers', error));
  void db.watches
    .toArray()
    .then((watches) => {
      for (const watch of watches) if (watch.status === 'active' && isRushing(watch, Date.now())) rush(watch.id);
    })
    .catch(() => undefined);

  browser.runtime.onMessage.addListener((message: WatchActionRequest | { type: 'watch.changed'; id: string }, sender: Browser.runtime.MessageSender, sendResponse) => {
    if (message?.type === 'watch.action') {
      if (!isExtensionPage(sender)) return undefined;
      void act(message).then(sendResponse);
      return true;
    }
    // A live watch's page says that what is watched reads differently. Only its own tab may say so; the page is then read by us.
    if (message?.type === 'watch.changed' && typeof message.id === 'string' && sender.tab?.id !== undefined) {
      const tabId = sender.tab.id;
      void liveTabs().then((tabs) => {
        if (tabs[message.id] === tabId) void checkWatch(message.id, realDeps, { reload: false, ask: true }).catch((error: unknown) => console.error('Watch check failed', error));
      });
    }
    return undefined;
  });

  // Closing a live watch's tab is the plain way to say "stop": the watch is paused, not opened again behind the user's back.
  browser.tabs.onRemoved.addListener((tabId, info) => {
    if (info.isWindowClosing) return;
    void liveTabs().then(async (tabs) => {
      const id = Object.keys(tabs).find((key) => tabs[key] === tabId);
      if (!id) return;
      await setLiveTab(id, undefined);
      const watch = await db.watches.get(id);
      if (watch?.status !== 'active') return;
      await db.watches.update(id, { status: 'paused' });
      await browser.alarms.clear(watchAlarm(id));
    });
  });

  // The notification opens the watched page: its own address, never one a page or a model gave.
  browser.notifications?.onClicked.addListener((notificationId) => {
    const id = watchOfNotification(notificationId);
    if (!id) return;
    void browser.notifications.clear(notificationId);
    void db.watches.get(id).then((watch) => {
      if (watch && /^https?:\/\//.test(watch.url)) void browser.tabs.create({ url: watch.url });
    });
  });
}
