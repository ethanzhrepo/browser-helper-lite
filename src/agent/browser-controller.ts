import { browser, type Browser } from 'wxt/browser';
import type { PageExtraction } from '../browser/page-context';
import { CdpDriver } from './drivers/cdp';
import type { OverlayState, PageAgentApi, PageResult, TargetPoint } from './page/types';
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
      this.cdp = undefined;
      this.options.onDebuggerDetached(reason);
    });
  }

  private dropCdp(error: unknown) {
    console.warn('CDP driver unavailable, using DOM events', error);
    void this.cdp?.detachAll();
    this.cdp = undefined;
  }

  /** Runs input through CDP when available; if CDP fails, falls back to DOM events for good. */
  private async input(viaCdp: (cdp: CdpDriver) => Promise<void>, viaDom: () => Promise<void>): Promise<void> {
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
    await this.quiet('setOverlay', state);
  }

  /** Re-applies the overlay after navigation wiped it. */
  async refreshOverlay(): Promise<void> {
    if (this.overlay.mode !== 'hidden') await this.quiet('setOverlay', this.overlay);
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

  async switchTo(tabId: number, activate = true): Promise<void> {
    if (!this.tabs.has(tabId)) throw new ActionError(`Tab ${tabId} is not one of your tabs.`);
    const hidden: OverlayState = { mode: 'hidden', message: '', stopLabel: '' };
    await this.call(this.currentTabId, 'setOverlay', hidden).catch(() => undefined);
    this.currentTabId = tabId;
    if (activate) await browser.tabs.update(tabId, { active: true });
    await this.refreshOverlay();
  }

  /** Opens a tab for the agent. A `scratch` tab (e.g. for a search) is closed again soon and not grouped. */
  async openTab(url: string, { active = true, scratch = false } = {}): Promise<number> {
    const opener = await browser.tabs.get(this.currentTabId).catch(() => undefined);
    // Opened in the background and linked to the conversation first, so the side
    // panel keeps showing this conversation when the tab comes to the front.
    const tab = await browser.tabs.create({
      url,
      active: false,
      openerTabId: opener?.id,
      index: opener ? opener.index + 1 : undefined,
    });
    await this.options.onTabOpened?.(tab.id!).catch(() => undefined);
    if (scratch) this.tabs.add(tab.id!);
    else await this.adopt(tab.id!);
    if (active) await browser.tabs.update(tab.id!, { active: true });
    return tab.id!;
  }

  async closeTab(tabId: number): Promise<void> {
    if (!this.tabs.has(tabId)) throw new ActionError(`Tab ${tabId} is not one of your tabs.`);
    if (tabId === this.startTabId) throw new ActionError('The tab the task started in cannot be closed.');
    await browser.tabs.remove(tabId).catch(() => undefined);
    this.tabs.delete(tabId);
    if (this.currentTabId === tabId) await this.switchTo(this.startTabId);
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

  private async pointAt(index: number, click: boolean): Promise<TargetPoint> {
    const point = unwrap(await this.page('locate', index));
    if (point.occludedBy) {
      throw new ActionError(`Element [${index}] is covered by ${point.occludedBy}. Close or move past the covering element first.`);
    }
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

  /** Viewport screenshot (JPEG, base64) with numbered element boxes drawn on it. */
  async screenshot(tabId = this.currentTabId): Promise<string> {
    // Hidden tabs may not render, so bring the agent's tab to the front first.
    const tab = await browser.tabs.update(tabId, { active: true });
    await this.call(tabId, 'highlight', true).catch(() => undefined);
    await sleep(150);
    try {
      // Only reuse an attached debugger; attaching just for a screenshot would show Chrome's debugging bar.
      if (this.cdp && this.usedInput) {
        try {
          return await this.cdp.screenshot(tabId);
        } catch (error) {
          this.dropCdp(error);
        }
      }
      try {
        const dataUrl = await browser.tabs.captureVisibleTab(tab!.windowId, { format: 'jpeg', quality: 70 });
        return dataUrl.slice(dataUrl.indexOf(',') + 1);
      } catch (error) {
        // captureVisibleTab needs access to all sites; the debugger works with a single site.
        if (this.cdp) return await this.cdp.screenshot(tabId);
        throw error;
      }
    } finally {
      await this.call(tabId, 'highlight', false).catch(() => undefined);
    }
  }

  /** The whole page as Markdown (same extractor as the chat's page attachment). */
  async pageMarkdown(tabId = this.currentTabId): Promise<PageExtraction> {
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, files: ['/extract-page.js'] });
    const page = injection?.result as PageExtraction | undefined;
    if (!page) throw new ActionError('Could not read the page.');
    return page;
  }
}
