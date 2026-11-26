import { browser, type Browser } from 'wxt/browser';
import type { PageExtraction } from '../browser/page-context';
import { CdpDriver } from './drivers/cdp';
import type { OverlayState, PageAgentApi, PageResult, TargetPoint, Viewport } from './page/types';
import { COMPACT_JPEG_QUALITY, COMPACT_SCREEN_EDGE, fitScreenshot } from './screenshot';
import type { TabInfo } from './prompt';

/** An error the agent should see and can recover from (bad index, covered element…). */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionError';
  }
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type InvokeResult = { status: 'missing' } | { status: 'ok'; value: unknown } | { status: 'thrown'; message: string };

/** Serialized into the page by scripting.executeScript, so it must be self-contained. */
function invokePageAgent(method: string, args: unknown[]): InvokeResult {
  const api = (globalThis as unknown as Record<symbol, Record<string, (...a: unknown[]) => unknown> | undefined>)[
    Symbol.for('browser-helper-agent')
  ];
  if (typeof api?.[method] !== 'function') return { status: 'missing' };
  try {
    return { status: 'ok', value: api[method]!(...args) };
  } catch (error) {
    return { status: 'thrown', message: error instanceof Error ? error.message : String(error) };
  }
}

/** A screenshot of a tab's viewport and what is needed to turn its pixels back into page coordinates. */
export interface Screen {
  /** JPEG, base64. */
  image: string;
  width: number;
  height: number;
  /** CSS pixels per image pixel. */
  scale: number;
  /** The viewport when it was taken: coordinates are stale once this changes. */
  viewport: Viewport;
  tabId: number;
  url: string;
}

export function unwrap<T>(result: PageResult<T>): T {
  if (!result.ok) throw new ActionError(result.error);
  return result.value;
}

type ApiMethod = keyof PageAgentApi;
type ApiArgs<M extends ApiMethod> = Parameters<PageAgentApi[M]>;
type ApiReturn<M extends ApiMethod> = ReturnType<PageAgentApi[M]>;

/**
 * The agent's hands in the browser: which tab it works in, how it reaches the
 * page script, and which driver performs input (§7.4).
 */
export type GroupStatus = 'running' | 'waiting' | 'finished';

const GROUP_COLORS: Record<GroupStatus, `${Browser.tabGroups.Color}`> = {
  running: 'green',
  waiting: 'yellow',
  finished: 'grey',
};

const NO_GROUP = -1;
/** How long a picture of a tab behind others may take with the debugger, before the tab is brought to the front for it. */
const HIDDEN_SHOT_MS = 2500;

/**
 * The agent's hands in the browser: which tab it works in, how it reaches the
 * page script, and which driver performs input (§7.4).
 */
export class AgentBrowser {
  currentTabId: number;
  readonly tabs = new Set<number>();
  /** Tabs this turn moved into its group, and tabs it opened. */
  readonly groupedTabs = new Set<number>();
  readonly openedTabs = new Set<number>();
  private groupId: number | undefined;
  private groupStatus: GroupStatus | undefined;
  private cdp: CdpDriver | undefined;
  private usedInput = false;
  private overlay: OverlayState = { mode: 'hidden', message: '', stopLabel: '' };

  constructor(
    readonly startTabId: number,
    private readonly options: {
      groupTitle: string;
      onDebuggerDetached: (reason: string) => void;
      /** A tab the agent opened (or a page opened for it); it belongs to the same conversation. */
      onTabOpened?: (tabId: number) => Promise<void>;
      /** Whether the side panel is open on a tab; where it is not, the overlay offers to open it. */
      hasPanel?: (tabId: number) => boolean;
      panelLabel?: string;
      /**
       * Why the agent must not touch a page at this address (a browser page, a
       * site the user blocked, or one without site access); undefined when it may.
       */
      pageProblem?: (url: string) => Promise<string | undefined>;
    },
  ) {
    this.currentTabId = startTabId;
    this.tabs.add(startTabId);
  }

  /** The input driver, once the turn has operated a page. */
  get driver(): 'cdp' | 'dom' | undefined {
    if (!this.usedInput) return undefined;
    return this.cdp ? 'cdp' : 'dom';
  }

  /**
   * Prefers the CDP driver. The debugger attaches on the first input event, so
   * turns that only read never show Chrome's debugging bar.
   */
  init(useCdp: boolean): void {
    if (!useCdp || !browser.debugger) return;
    this.cdp = new CdpDriver((_tabId, reason) => {
      // Closing one tab only detaches that target; keep CDP alive for any other tabs.
      if (reason === 'target_closed') return;
      const cdp = this.cdp;
      this.cdp = undefined;
      void cdp?.detachAll();
      this.options.onDebuggerDetached(reason);
    });
  }

  private dropCdp(error: unknown) {
    console.warn('CDP driver unavailable, using DOM events', error);
    void this.cdp?.detachAll();
    this.cdp = undefined;
  }

  /**
   * Every way of reaching a page goes through here first. Input sent through
   * the debugger is not held back by Chrome's site permissions, so the check
   * cannot be left to Chrome.
   */
  private async assertAllowed(tabId: number): Promise<void> {
    const check = this.options.pageProblem;
    if (!check) return;
    const tab = await browser.tabs.get(tabId).catch(() => undefined);
    const problem = await check(tab?.url ?? '');
    if (problem) throw new ActionError(problem);
  }

  /** Runs input through CDP when available; if CDP fails, falls back to DOM events for good. */
  private async input(viaCdp: (cdp: CdpDriver) => Promise<void>, viaDom: () => Promise<void>): Promise<void> {
    await this.assertAllowed(this.currentTabId);
    this.usedInput = true;
    const cdp = this.cdp;
    if (cdp) {
      try {
        await this.asAgent(() => viaCdp(cdp));
        return;
      } catch (error) {
        if (error instanceof ActionError) throw error;
        this.dropCdp(error);
      }
    }
    await viaDom();
  }

  async dispose(): Promise<void> {
    await this.setOverlay({ mode: 'hidden', message: '', stopLabel: '' });
    await this.cdp?.detachAll();
    this.cdp = undefined;
  }

  // ---- Page script ----

  async call<M extends ApiMethod>(tabId: number, method: M, ...args: ApiArgs<M>): Promise<ApiReturn<M>> {
    await this.assertAllowed(tabId);
    return this.callUnchecked(tabId, method, ...args);
  }

  /** Only for taking our own overlay off a page, which must work on a site the user has just blocked. */
  private async callUnchecked<M extends ApiMethod>(tabId: number, method: M, ...args: ApiArgs<M>): Promise<ApiReturn<M>> {
    const invoke = async () => {
      const [injection] = await browser.scripting.executeScript({
        target: { tabId },
        func: invokePageAgent,
        args: [method, args as unknown[]],
      });
      return injection?.result as InvokeResult | undefined;
    };
    let result = await invoke();
    if (!result || result.status === 'missing') {
      await browser.scripting.executeScript({ target: { tabId }, files: ['/agent-page.js'] });
      result = await invoke();
    }
    if (!result || result.status === 'missing') throw new ActionError('Could not reach the page script.');
    if (result.status === 'thrown') throw new ActionError(result.message);
    return result.value as ApiReturn<M>;
  }

  page<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<ApiReturn<M>> {
    return this.call(this.currentTabId, method, ...args);
  }

  /** Best-effort page call for cosmetic things (overlay, cursor). */
  private async quiet<M extends ApiMethod>(method: M, ...args: ApiArgs<M>): Promise<void> {
    await this.page(method, ...args).catch(() => undefined);
  }

  async setOverlay(state: OverlayState): Promise<void> {
    this.overlay = state;
    await this.showOverlay();
  }

  /** Re-applies the overlay after navigation wiped it, or the side panel opened or closed. */
  async refreshOverlay(): Promise<void> {
    if (this.overlay.mode !== 'hidden') await this.showOverlay();
  }

  private async showOverlay(): Promise<void> {
    if (this.overlay.mode === 'hidden') return this.hideOverlay(this.currentTabId);
    const { hasPanel, panelLabel } = this.options;
    const offerPanel = hasPanel && !hasPanel(this.currentTabId);
    await this.quiet('setOverlay', { ...this.overlay, panelLabel: offerPanel ? panelLabel : undefined });
  }

  private async hideOverlay(tabId: number): Promise<void> {
    await this.callUnchecked(tabId, 'setOverlay', { mode: 'hidden', message: '', stopLabel: '' }).catch(() => undefined);
  }

  // ---- Tabs ----

  async currentTab(): Promise<Browser.tabs.Tab> {
    try {
      return await browser.tabs.get(this.currentTabId);
    } catch {
      // The tab was closed: fall back to another of the agent's tabs.
      this.tabs.delete(this.currentTabId);
      for (const id of this.tabs) {
        try {
          const tab = await browser.tabs.get(id);
          this.currentTabId = id;
          return tab;
        } catch {
          this.tabs.delete(id);
        }
      }
      throw new Error('All of the agent’s tabs were closed.');
    }
  }

  async otherTabs(): Promise<TabInfo[]> {
    const infos: TabInfo[] = [];
    for (const id of this.tabs) {
      if (id === this.currentTabId) continue;
      try {
        const tab = await browser.tabs.get(id);
        infos.push({ id, title: tab.title ?? '', url: tab.url ?? '' });
      } catch {
        this.tabs.delete(id);
      }
    }
    return infos;
  }

  /**
   * Puts a tab into the turn's tab group (M1.5 A4). A tab already in one of
   * the user's groups stays there; an earlier turn's group is reused.
   */
  private async joinGroup(tabId: number, { respectUserGroups }: { respectUserGroups: boolean }): Promise<void> {
    try {
      const tab = await browser.tabs.get(tabId);
      if (tab.groupId !== undefined && tab.groupId !== NO_GROUP) {
        if (tab.groupId === this.groupId) return;
        const group = await browser.tabGroups.get(tab.groupId);
        if (group.title === this.options.groupTitle) {
          this.groupId ??= tab.groupId;
          if (this.groupId === tab.groupId) return void (await this.paintGroup());
        }
        if (respectUserGroups) return;
      }
      if (this.groupId === undefined) {
        this.groupId = await browser.tabs.group({ tabIds: [tabId], createProperties: { windowId: tab.windowId } });
      } else {
        await browser.tabs.group({ groupId: this.groupId, tabIds: [tabId] });
      }
      this.groupedTabs.add(tabId);
      await this.paintGroup();
    } catch {
      // Grouping is cosmetic (pinned tabs, for one, cannot be grouped).
    }
  }

  private async paintGroup(): Promise<void> {
    if (this.groupId === undefined) return;
    await browser.tabGroups
      .update(this.groupId, { title: this.options.groupTitle, color: GROUP_COLORS[this.groupStatus ?? 'running'] })
      .catch(() => undefined);
  }

  /** Called when the turn first operates a page: groups the tab it works in. */
  async engage(): Promise<void> {
    await this.joinGroup(this.currentTabId, { respectUserGroups: true });
  }

  /** Group color shows the turn's state: green working, yellow needs you, grey finished. */
  async setGroupStatus(status: GroupStatus): Promise<void> {
    if (status === this.groupStatus) return;
    this.groupStatus = status;
    await this.paintGroup();
  }

  private async adopt(tabId: number): Promise<void> {
    this.tabs.add(tabId);
    this.openedTabs.add(tabId);
    // Tabs the agent opens always go into its group.
    await this.joinGroup(tabId, { respectUserGroups: false });
  }

  /** The tab in front, in the window the assistant works in. */
  async frontTab(): Promise<Browser.tabs.Tab | undefined> {
    const current = await browser.tabs.get(this.currentTabId).catch(() => undefined);
    if (!current) return undefined;
    if (current.active) return current;
    return (await browser.tabs.query({ active: true, windowId: current.windowId }).catch(() => []))[0];
  }

  /**
   * Whether the user is looking at the assistant's work: the tab in front, in
   * the window it works in, is one of its tabs. Only then does a tab it opens
   * or turns to come to the front. A user who went to another tab is left
   * there, and the work goes on behind.
   */
  async followed(): Promise<boolean> {
    const front = await this.frontTab();
    return front?.id !== undefined && this.tabs.has(front.id);
  }

  /** Makes a tab the one the assistant works in; it comes to the front when the user is following (or `show` says so). */
  async switchTo(tabId: number, show?: boolean): Promise<void> {
    if (!this.tabs.has(tabId)) throw new ActionError(`Tab ${tabId} is not one of your tabs.`);
    const activate = show ?? (await this.followed());
    await this.hideOverlay(this.currentTabId);
    this.currentTabId = tabId;
    if (activate) await browser.tabs.update(tabId, { active: true }).catch(() => undefined);
    await this.refreshOverlay();
  }

  /**
   * Opens a tab for the agent, in its own window, behind the tab in front. A
   * `scratch` tab (e.g. for a search) is closed again soon and not grouped.
   * `show` brings it to the front, when the user is following.
   */
  async openTab(url: string, { show = true, scratch = false } = {}): Promise<number> {
    const opener = await browser.tabs.get(this.currentTabId).catch(() => undefined);
    const activate = show && (await this.followed());
    // Opened in the background and linked to the conversation first, so the side
    // panel keeps showing this conversation when the tab comes to the front.
    const tab = await browser.tabs.create({
      url,
      active: false,
      // Next to the tab it works in: not in whatever window the user is using now.
      windowId: opener?.windowId,
      openerTabId: opener?.id,
      index: opener ? opener.index + 1 : undefined,
    });
    await this.options.onTabOpened?.(tab.id!).catch(() => undefined);
    if (scratch) this.tabs.add(tab.id!);
    else await this.adopt(tab.id!);
    if (activate) await browser.tabs.update(tab.id!, { active: true }).catch(() => undefined);
    return tab.id!;
  }

  async closeTab(tabId: number): Promise<void> {
    if (!this.tabs.has(tabId)) throw new ActionError(`Tab ${tabId} is not one of your tabs.`);
    if (tabId === this.startTabId) throw new ActionError('The tab the task started in cannot be closed.');
    // Asked before it is gone: closing the tab in front puts another one there.
    const followed = this.currentTabId === tabId && (await this.followed());
    await browser.tabs.remove(tabId).catch(() => undefined);
    this.tabs.delete(tabId);
    if (this.currentTabId === tabId) await this.switchTo(this.startTabId, followed);
  }

  async navigate(url: string): Promise<void> {
    await browser.tabs.update(this.currentTabId, { url });
    await this.waitForSettle();
  }

  async goBack(): Promise<void> {
    await browser.tabs.goBack(this.currentTabId).catch(() => {
      throw new ActionError('There is no previous page in this tab.');
    });
    await this.waitForSettle();
  }

  /** Waits for loading to finish, then a short moment for scripts to render. */
  async waitForSettle(tabId = this.currentTabId, timeoutMs = 10_000): Promise<void> {
    await sleep(300);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tab = await browser.tabs.get(tabId).catch(() => undefined);
      if (!tab || tab.status === 'complete') break;
      await sleep(200);
    }
    await sleep(400);
  }

  /**
   * Runs an input action and follows a tab it opens (links with
   * target=_blank). Returns the new tab's id, if any.
   */
  private async followNewTabs(action: () => Promise<void>): Promise<number | undefined> {
    const created: number[] = [];
    const onCreated = (tab: Browser.tabs.Tab) => {
      if (tab.id === undefined || tab.openerTabId !== this.currentTabId) return;
      created.push(tab.id);
      void this.options.onTabOpened?.(tab.id).catch(() => undefined);
    };
    browser.tabs.onCreated.addListener(onCreated);
    try {
      await action();
      await sleep(350);
    } finally {
      browser.tabs.onCreated.removeListener(onCreated);
    }
    const newTab = created.at(-1);
    if (newTab !== undefined) {
      await this.adopt(newTab);
      await this.switchTo(newTab);
    }
    return newTab;
  }

  /** Trusted CDP input would look like user input to the page script; flag it as ours. */
  private async asAgent(action: () => Promise<void>): Promise<void> {
    await this.quiet('setActing', true);
    try {
      await action();
    } finally {
      await this.quiet('setActing', false);
    }
  }

  /** Where the pointer last went, in CSS pixels of the viewport; taken once, for the replay. */
  private lastPoint: { x: number; y: number } | undefined;

  takePoint(): { x: number; y: number } | undefined {
    const point = this.lastPoint;
    this.lastPoint = undefined;
    return point;
  }

  private notePoint(x: number, y: number): void {
    this.lastPoint = { x: Math.round(x), y: Math.round(y) };
  }

  /** The viewport as it is, with its pixel ratio, for the replay. Never brings the tab forward and never attaches the debugger. */
  async frame(tabId = this.currentTabId): Promise<{ raw: string; pixelRatio: number } | undefined> {
    await this.assertAllowed(tabId);
    const { pixelRatio } = await this.call(tabId, 'viewport');
    const raw = await this.capture(await browser.tabs.get(tabId), false);
    return raw ? { raw, pixelRatio } : undefined;
  }

  private async pointAt(index: number, click: boolean): Promise<TargetPoint> {
    const point = unwrap(await this.page('locate', index));
    if (point.occludedBy) {
      throw new ActionError(`Element [${index}] is covered by ${point.occludedBy}. Close or move past the covering element first.`);
    }
    this.notePoint(point.x, point.y);
    await this.quiet('moveCursor', { x: point.x, y: point.y, click });
    await sleep(380);
    return point;
  }

  // ---- Actions ----

  async click(index: number): Promise<number | undefined> {
    const point = await this.pointAt(index, true);
    const tabId = this.currentTabId;
    // Right before the button goes down, the target must still be under the pointer: a page could
    // slide something else there while the pointer moves.
    const recheck = async () => {
      const now = unwrap(await this.page('locate', index));
      if (now.occludedBy) throw new ActionError(`Element [${index}] is covered by ${now.occludedBy}. Look at the page again.`);
      if (Math.abs(now.x - point.x) > 4 || Math.abs(now.y - point.y) > 4) throw new ActionError(`Element [${index}] moved. Look at the page again.`);
    };
    return this.followNewTabs(() =>
      this.input(
        (cdp) => cdp.click(tabId, point.x, point.y, recheck),
        async () => void unwrap(await this.page('domClick', index)),
      ),
    );
  }

  async hover(index: number): Promise<void> {
    const point = await this.pointAt(index, false);
    const tabId = this.currentTabId;
    await this.input(
      (cdp) => cdp.moveTo(tabId, point.x, point.y),
      async () => void unwrap(await this.page('domHover', index)),
    );
  }

  async type(index: number, text: string, { clear, submit }: { clear: boolean; submit: boolean }): Promise<number | undefined> {
    const tabId = this.currentTabId;
    await this.input(
      async (cdp) => {
        unwrap(await this.page('focus', index));
        if (clear) unwrap(await this.page('selectText', index));
        await cdp.insertText(tabId, text);
      },
      async () => void unwrap(await this.page('domType', { index, text, clear })),
    );
    if (!submit) return undefined;
    return this.followNewTabs(() => this.press('Enter'));
  }

  async press(keys: string): Promise<void> {
    const tabId = this.currentTabId;
    await this.input(
      (cdp) => cdp.press(tabId, keys),
      async () => void unwrap(await this.page('domPress', keys)),
    );
  }

  /**
   * Clicks a point of the viewport (CSS pixels), for things the page view has
   * no number for. `recheck` runs right before the button goes down and may
   * throw to cancel.
   */
  async clickAt(x: number, y: number, recheck: () => Promise<void>): Promise<number | undefined> {
    this.notePoint(x, y);
    await this.quiet('moveCursor', { x, y, click: true });
    await sleep(380);
    const tabId = this.currentTabId;
    return this.followNewTabs(() =>
      this.input(
        (cdp) => cdp.click(tabId, x, y, recheck),
        async () => {
          await recheck();
          unwrap(await this.page('domClickAt', { x, y }));
        },
      ),
    );
  }

  /**
   * The viewport as the model gets it: a JPEG scaled to CSS pixels, with
   * numbered boxes on the elements of the latest page view.
   *
   * `activate: false` never disturbs the user: the tab stays where it is and
   * the debugger is not attached for it, so this resolves undefined when the
   * tab is hidden and the debugger is not already in use.
   */
  async screen({ activate, compact = false }: { activate: boolean; compact?: boolean }, tabId = this.currentTabId): Promise<Screen | undefined> {
    await this.assertAllowed(tabId);
    let tab = await browser.tabs.get(tabId);
    // The user's tab, when they are looking at something else: it is put back after the picture is taken.
    let back: number | undefined;
    // Without the debugger, Chrome only takes a picture of the tab in front, so an asked-for look brings the tab there.
    const toFront = async () => {
      const front = await this.frontTab();
      if (front?.id !== undefined && !this.tabs.has(front.id)) back = front.id;
      tab = (await browser.tabs.update(tabId, { active: true })) ?? tab;
      // Chrome takes a moment to put the tab on screen; a capture before that shows the tab that was in front.
      for (let i = 0; i < 20 && !(await this.call(tabId, 'shown').catch(() => true)); i++) await sleep(75);
    };
    // With the debugger in use, the picture is first tried where the tab is, behind the others.
    if (activate && !tab.active && !(this.cdp && this.usedInput)) await toFront();
    let raw: string | undefined;
    let viewport: Awaited<ReturnType<typeof this.viewportOf>>;
    try {
      viewport = await this.viewportOf(tabId);
      await this.call(tabId, 'highlight', true).catch(() => undefined);
      await sleep(150);
      raw = await this.capture(tab, activate);
      // A hidden tab is not always drawn: when the debugger gave nothing in time, the tab comes to the front after all.
      if (!raw && activate && !tab.active) {
        await toFront();
        raw = await this.capture(tab, activate);
      }
    } finally {
      await this.call(tabId, 'highlight', false).catch(() => undefined);
      if (back !== undefined) await browser.tabs.update(back, { active: true }).catch(() => undefined);
    }
    if (!raw) return undefined;
    const fit = compact
      ? await fitScreenshot(raw, viewport.pixelRatio, { maxEdge: COMPACT_SCREEN_EDGE, quality: COMPACT_JPEG_QUALITY })
      : await fitScreenshot(raw, viewport.pixelRatio);
    return { ...fit, viewport, tabId, url: tab.url ?? '' };
  }

  private viewportOf(tabId: number) {
    return this.call(tabId, 'viewport');
  }

  private async capture(tab: Browser.tabs.Tab, activate: boolean): Promise<string | undefined> {
    const tabId = tab.id!;
    // Only reuse an attached debugger; attaching just for a screenshot would show Chrome's debugging bar.
    if (this.cdp && this.usedInput) {
      try {
        if (tab.active) return await this.cdp.screenshot(tabId);
        // Behind other tabs Chrome may never draw the page: the picture is given a moment, no more.
        const pending = this.cdp.screenshot(tabId);
        // Prevent an unhandled rejection if the timeout wins the race before screenshot fails.
        pending.catch(() => undefined);
        const shot = await Promise.race([pending, sleep(HIDDEN_SHOT_MS).then(() => undefined)]);
        if (shot) return shot;
      } catch (error) {
        this.dropCdp(error);
      }
    }
    if (!tab.active) return undefined;
    const visible = async () => {
      const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
      return dataUrl.slice(dataUrl.indexOf(',') + 1);
    };
    try {
      return await visible().catch(async (error: unknown) => {
        // Chrome allows two captures a second. A view's own screenshot and a replay picture can come closer together than that.
        if (!/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/.test(String(error))) throw error;
        await sleep(600);
        return visible();
      });
    } catch (error) {
      if (!activate) return undefined;
      // captureVisibleTab needs access to all sites; the debugger works with a single site.
      if (this.cdp) return await this.cdp.screenshot(tabId);
      throw error;
    }
  }

  /** The whole page as Markdown (same extractor as the chat's page attachment). */
  async pageMarkdown(tabId = this.currentTabId): Promise<PageExtraction> {
    await this.assertAllowed(tabId);
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, files: ['/extract-page.js'] });
    const page = injection?.result as PageExtraction | undefined;
    if (!page) throw new ActionError('Could not read the page.');
    return page;
  }
}
