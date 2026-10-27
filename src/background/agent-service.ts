import type { TFunction } from 'i18next';
import { browser, type Browser } from 'wxt/browser';
import { z } from 'zod';
import { AgentRunner } from '../agent/runtime';
import { openPanel, panelTabOf } from '../browser/side-panel';
import {
  ACTIVE_STATUSES,
  AGENT_PORT_NAME,
  type AgentClientMessage,
  type AgentServerMessage,
  type AgentTask,
  type OverlayMessage,
} from '../agent/types';
import { LOCALES, resolveLocale, resources } from '../i18n/resources';
import { createTranslator } from '../i18n/translator';
import { pickSlot } from '../providers/resolve';
import type { Locale, Settings } from '../shared/types';
import { appendMessage, db, getMessages, getTasks, markInterruptedTasks, saveTask } from '../storage/db';
import { loadSettings, updateSettings, watchSettings } from '../storage/settings';
import { linkTab, unlinkTab } from '../storage/tab-conversations';
import { isExtensionPage } from './trust';

const runners = new Map<string, AgentRunner>();
const ports = new Set<Browser.runtime.Port>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
let keepalive: ReturnType<typeof setInterval> | undefined;

/**
 * An MV3 service worker sleeps after ~30 s without events, which would kill a
 * task that is waiting for the user. Calling an extension API resets that timer.
 */
function updateKeepalive() {
  if (runners.size > 0 && !keepalive) {
    keepalive = setInterval(() => void browser.runtime.getPlatformInfo(), 20_000);
  } else if (runners.size === 0 && keepalive) {
    clearInterval(keepalive);
    keepalive = undefined;
  }
}

function broadcast(task: AgentTask) {
  const message: AgentServerMessage = { type: 'task', task };
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      ports.delete(port);
    }
  }
}

/** Streaming updates are frequent; the stored copy is written at most twice a second. */
function persist(task: AgentTask, { now = false } = {}) {
  const pending = saveTimers.get(task.id);
  if (now) {
    clearTimeout(pending);
    saveTimers.delete(task.id);
    return saveTask(structuredClone(task));
  }
  if (!pending) {
    saveTimers.set(
      task.id,
      setTimeout(() => {
        saveTimers.delete(task.id);
        void saveTask(structuredClone(task));
      }, 500),
    );
  }
  return Promise.resolve();
}

/** Each open side panel keeps a port to us, and its URL names its tab (§4.7). */
const hasPanel = (tabId: number) => [...ports].some((port) => panelTabOf(port.sender?.url) === tabId);

/** A side panel opened or closed: the overlay on its tab drops or shows its "Open panel" button. */
function refreshOverlays(port: Browser.runtime.Port) {
  const tabId = panelTabOf(port.sender?.url);
  if (tabId === undefined) return;
  for (const runner of runners.values()) if (runner.currentTabId === tabId) void runner.refreshOverlay();
}

function runnerForTab(tabId: number | undefined): AgentRunner | undefined {
  if (tabId === undefined) return undefined;
  return [...runners.values()].find((runner) => runner.tabs.has(tabId));
}

const notificationId = (taskId: string) => `agent-${taskId}`;

async function notifyWaiting(task: AgentTask, settings: Settings, t: TFunction) {
  const waiting = task.waiting;
  if (!waiting || !settings.agent.notifications || !browser.notifications) return;
  // Hand-offs always notify (the user may be elsewhere); other waits only when no panel is open.
  if (waiting.kind !== 'handoff' && ports.size > 0) return;
  // Fixed wording: model-written text (which a page may have shaped) never appears as a system notification.
  const message =
    waiting.kind === 'handoff'
      ? t(`agent.handoff.${waiting.reason}`, { site: waiting.site })
      : waiting.kind === 'question'
        ? t('agent.notification.question')
        : waiting.kind === 'approval'
          ? t('agent.notification.approval', { site: waiting.site, target: waiting.target })
          : t('agent.notification.permission', { origin: waiting.origin });
  await browser.notifications
    .create(notificationId(task.id), {
      type: 'basic',
      iconUrl: browser.runtime.getURL('/icon/128.png'),
      title: t(`agent.notification.title.${waiting.kind}`),
      message,
      requireInteraction: true,
    })
    .catch(() => undefined);
}

/** Stores the turn's reply: the final answer, or what was streamed before a stop or an error. */
async function finishTask(runner: AgentRunner, t: TFunction) {
  const task = runner.task;
  await browser.notifications?.clear(notificationId(task.id)).catch(() => undefined);
  const partial = task.draft.trim();
  const content =
    task.status === 'done'
      ? (task.result?.summary ?? '')
      : task.status === 'stopped'
        ? partial || (task.steps.length > 0 ? t('agent.stoppedSummary') : '')
        : partial;
  task.draft = '';
  await appendMessage({
    conversationId: task.conversationId,
    role: 'assistant',
    content,
    reasoning: runner.reasoning || undefined,
    status: task.status === 'failed' ? 'error' : task.status === 'stopped' ? 'aborted' : 'done',
    error: task.status === 'failed' ? task.error : undefined,
    model: task.model,
    usage: task.usage,
    taskId: task.id,
  });
}

async function startTask(message: Extract<AgentClientMessage, { type: 'start' }>) {
  if (runners.has(message.taskId)) return;
  const settings = await loadSettings();
  const locale: Locale = resolveLocale(settings.language, browser.i18n.getUILanguage());
  const t = await createTranslator(locale);
  const history = await getMessages(message.conversationId);
  const tabId =
    message.tabId ?? (await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []))[0]?.id ?? -1;
  const now = Date.now();
  const task: AgentTask = {
    id: message.taskId,
    conversationId: message.conversationId,
    goal: (history.findLast((m) => m.role === 'user')?.content ?? '').slice(0, 300),
    anchorMessageId: message.anchorMessageId,
    status: 'running',
    steps: [],
    draft: '',
    usage: {},
    model: pickSlot(settings, ['chat']) ?? { connectionId: '', modelId: '' },
    mode: settings.agent.mode,
    startTabId: tabId,
    maxSteps: settings.agent.maxSteps,
    createdAt: now,
    updatedAt: now,
  };

  // The tab the request was made in shows this conversation from now on.
  await linkTab(tabId, task.conversationId);
  const runner = new AgentRunner(task, settings, locale, history, {
    t,
    onTabOpened: (openedTabId) => linkTab(openedTabId, task.conversationId),
    hasPanel,
    update: (next) => {
      broadcast(next);
      void persist(next);
    },
    onWaiting: (next) => void notifyWaiting(next, settings, t),
    saveSitePolicy: async (host, policy) => {
      await updateSettings((s) => ({ ...s, sitePolicies: { ...s.sitePolicies, [host]: policy } }));
    },
  });
  runners.set(task.id, runner);
  updateKeepalive();
  try {
    await runner.run();
    await finishTask(runner, t);
    await persist(runner.task, { now: true });
    // Sent after the reply is stored, so the panel can reload it.
    broadcast(runner.task);
  } finally {
    runners.delete(task.id);
    updateKeepalive();
  }
}

/** Titles our tab groups may have, in every UI language. */
const GROUP_TITLES = new Set(LOCALES.map((locale) => resources[locale].translation.agent.groupTitle));

/** A new chat puts the tabs grouped by this conversation back as they were (M1.5 A4). */
async function releaseTabs(conversationId: string) {
  const tasks = await getTasks(conversationId);
  if (tasks.some((task) => ACTIVE_STATUSES.includes(task.status))) return;
  for (const task of tasks) {
    for (const tabId of task.groupedTabs ?? []) {
      const tab = await browser.tabs.get(tabId).catch(() => undefined);
      if (!tab || tab.groupId === undefined || tab.groupId < 0) continue;
      const group = await browser.tabGroups.get(tab.groupId).catch(() => undefined);
      if (group?.title && GROUP_TITLES.has(group.title)) await browser.tabs.ungroup(tabId).catch(() => undefined);
    }
  }
}

async function closeTabs(taskId: string) {
  const task = runners.get(taskId)?.task ?? (await db.tasks.get(taskId));
  if (!task) return;
  const tabs = (task.openedTabs ?? []).filter((id) => id !== task.startTabId);
  await Promise.all(tabs.map((id) => browser.tabs.remove(id).catch(() => undefined)));
}

function handleClientMessage(message: AgentClientMessage, port: Browser.runtime.Port) {
  switch (message.type) {
    case 'start':
      void startTask(message);
      return;
    case 'subscribe':
      for (const runner of runners.values()) port.postMessage({ type: 'task', task: runner.task } satisfies AgentServerMessage);
      return;
    case 'release':
      void releaseTabs(message.conversationId);
      return;
    case 'closeTabs':
      void closeTabs(message.taskId);
      return;
    case 'ping':
      return;
  }
  const runner = runners.get(message.taskId);
  if (!runner) return;
  switch (message.type) {
    case 'pause':
      runner.pause('user');
      break;
    case 'resume':
      runner.resume();
      break;
    case 'stop':
      runner.stop();
      break;
    case 'takeOver':
      void runner.takeOver();
      break;
    case 'respond':
      runner.respond(message.response);
      break;
  }
}

export function registerAgentService(): void {
  // Zod's JIT uses eval, which MV3 forbids; skip the attempt (and its CSP report).
  z.config({ jitless: true });
  void markInterruptedTasks();

  browser.runtime.onConnect.addListener((port: Browser.runtime.Port) => {
    if (port.name !== AGENT_PORT_NAME) return;
    // Starting turns and approving actions is for our own pages only, never for scripts in web pages.
    if (!isExtensionPage(port.sender)) {
      port.disconnect();
      return;
    }
    ports.add(port);
    refreshOverlays(port);
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      refreshOverlays(port);
    });
    port.onMessage.addListener((message: AgentClientMessage) => handleClientMessage(message, port));
  });

  // A closed tab's conversation stays in the history; only the link goes.
  browser.tabs.onRemoved.addListener((tabId) => void unlinkTab(tabId));

  // Switching the mode (or a site policy) applies to running turns at once.
  watchSettings((settings) => {
    for (const runner of runners.values()) runner.applySettings(settings);
  });

  browser.runtime.onMessage.addListener((message: OverlayMessage, sender) => {
    if (message?.type !== 'agent.overlay') return undefined;
    const runner = runnerForTab(sender.tab?.id);
    if (!runner) return undefined;
    if (message.action === 'stop') runner.stop();
    else if (message.action === 'continue') runner.overlayContinue();
    // Synchronously, while Chrome still counts the click on the overlay as a user gesture.
    else if (message.action === 'panel') openPanel(sender.tab!.id!).catch(() => undefined);
    else if (message.action === 'interference') runner.pause('interference');
    return undefined;
  });

  browser.notifications?.onClicked.addListener((id) => {
    const runner = [...runners.values()].find((r) => notificationId(r.task.id) === id);
    if (!runner) return;
    const tabId = runner.currentTabId;
    void browser.notifications.clear(id);
    // The click lets us open the side panel there, if it is not open yet.
    openPanel(tabId).catch(() => undefined);
    void browser.tabs.get(tabId).then(async (tab) => {
      await browser.windows.update(tab.windowId, { focused: true });
      await browser.tabs.update(tabId, { active: true });
    });
  });
}
