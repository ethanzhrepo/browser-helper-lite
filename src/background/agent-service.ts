import type { TFunction } from 'i18next';
import { browser, type Browser } from 'wxt/browser';
import { z } from 'zod';
import { AgentRunner } from '../agent/runtime';
import {
  AGENT_PORT_NAME,
  type AgentClientMessage,
  type AgentServerMessage,
  type AgentTask,
  type OverlayMessage,
} from '../agent/types';
import { resolveLocale } from '../i18n/resources';
import { createTranslator } from '../i18n/translator';
import { pickSlot } from '../providers/resolve';
import type { Locale, Settings } from '../shared/types';
import { appendMessage, markInterruptedTasks, saveTask } from '../storage/db';
import { loadSettings, updateSettings } from '../storage/settings';

const runners = new Map<string, AgentRunner>();
const ports = new Set<Browser.runtime.Port>();
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
  const message =
    waiting.kind === 'handoff'
      ? waiting.message || t(`agent.handoff.${waiting.reason}`, { site: waiting.site })
      : waiting.kind === 'question'
        ? waiting.question
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

async function finishTask(task: AgentTask, t: TFunction) {
  await browser.notifications?.clear(notificationId(task.id)).catch(() => undefined);
  const summary =
    task.result?.summary ??
    (task.status === 'stopped' ? t('agent.stoppedSummary') : t('agent.failedSummary', { message: task.error?.message ?? '' }));
  await appendMessage({
    conversationId: task.conversationId,
    role: 'assistant',
    content: summary,
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
  const now = Date.now();
  const model = pickSlot(settings, ['agent', 'chat']);
  const task: AgentTask = {
    id: message.taskId,
    conversationId: message.conversationId,
    goal: message.goal,
    status: 'running',
    steps: [],
    usage: {},
    driver: 'dom',
    model: model ?? { connectionId: '', modelId: '' },
    startTabId: message.tabId,
    maxSteps: settings.agent.maxSteps,
    createdAt: now,
    updatedAt: now,
  };

  const runner = new AgentRunner(task, settings, locale, {
    t,
    update: (next) => {
      broadcast(next);
      void saveTask(structuredClone(next));
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
    await finishTask(runner.task, t);
    broadcast(runner.task);
  } finally {
    runners.delete(task.id);
    updateKeepalive();
  }
}

function handleClientMessage(message: AgentClientMessage, port: Browser.runtime.Port) {
  if (message.type === 'start') {
    void startTask(message);
    return;
  }
  if (message.type === 'subscribe') {
    for (const runner of runners.values()) port.postMessage({ type: 'task', task: runner.task } satisfies AgentServerMessage);
    return;
  }
  if (message.type === 'ping') return;
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
    ports.add(port);
    port.onDisconnect.addListener(() => ports.delete(port));
    port.onMessage.addListener((message: AgentClientMessage) => handleClientMessage(message, port));
  });

  browser.runtime.onMessage.addListener((message: OverlayMessage, sender) => {
    if (message?.type !== 'agent.overlay') return undefined;
    const runner = runnerForTab(sender.tab?.id);
    if (!runner) return undefined;
    if (message.action === 'stop') runner.stop();
    else if (message.action === 'continue') runner.overlayContinue();
    else if (message.action === 'interference') runner.pause('interference');
    return undefined;
  });

  browser.notifications?.onClicked.addListener((id) => {
    const runner = [...runners.values()].find((r) => notificationId(r.task.id) === id);
    if (!runner) return;
    const tabId = runner.currentTabId;
    void browser.notifications.clear(id);
    void browser.tabs.get(tabId).then(async (tab) => {
      await browser.windows.update(tab.windowId, { focused: true });
      await browser.tabs.update(tabId, { active: true });
    });
  });
}
