import { History, Info, Plug, Settings as SettingsIcon, SquarePen, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { ACTIVE_STATUSES, type AgentTask } from '../../src/agent/types';
import { useAgentTasks } from '../../src/agent/useAgentTasks';
import { capturePage, captureSelection, type ActiveTab } from '../../src/browser/page-context';
import { openPanel, panelTabOf } from '../../src/browser/side-panel';
import { SLASH_COMMANDS, type SlashCommand } from '../../src/chat/commands';
import { useConversation } from '../../src/chat/useConversation';
import { useTabConversation } from '../../src/chat/useTabConversation';
import { isRestrictedUrl, requestHostAccess } from '../../src/permissions/hosts';
import type { AgentMode, ContextKind, ContextSnapshot, ErrorInfo, Locale } from '../../src/shared/types';
import { newId } from '../../src/storage/db';
import { DEFAULT_VOICE_SETTINGS, updateSettings } from '../../src/storage/settings';
import { linkTab, unlinkTab } from '../../src/storage/tab-conversations';
import { Button, IconButton } from '../../src/ui/Button';
import { errorSummary } from '../../src/ui/errors';
import { openOptions } from '../../src/ui/navigation';
import { useActiveTab } from '../../src/ui/useActiveTab';
import { useSettings } from '../../src/ui/useSettings';
import { useWindowTabs } from '../../src/ui/useWindowTabs';
import { useVoiceInput, type VoiceProblem } from '../../src/voice/useVoiceInput';
import { AgentControls } from './AgentControls';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { HistoryPanel } from './HistoryPanel';
import { MessageList } from './MessageList';
import { ModelSwitcher } from './ModelSwitcher';
import { OtherTasksBar } from './OtherTasksBar';

/** A side panel belongs to one tab (§4.7); opened as a page (in tests), the panel follows the active tab. */
const ownTab = panelTabOf(location.href) !== undefined;

export function App() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const { tab, access } = useActiveTab();
  const chatSlot = settings?.slots.chat?.modelId ? settings.slots.chat : undefined;
  const locale = i18n.language as Locale;
  const conversation = useConversation();
  const agent = useAgentTasks(conversation.conversation?.id, () => void conversation.reload());
  const activeTask = Object.values(agent.tasks).find(
    (task) => task.conversationId === conversation.conversation?.id && ACTIVE_STATUSES.includes(task.status),
  );
  const question = activeTask?.waiting?.kind === 'question' ? activeTask : undefined;

  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [text, setText] = useState('');
  const [includePage, setIncludePage] = useState(false);
  const [selection, setSelection] = useState<ContextSnapshot>();
  const [notice, setNotice] = useState<string>();
  const [pendingTaskId, setPendingTaskId] = useState<string>();
  /** Pages of other tabs attached with @. */
  const [tabContexts, setTabContexts] = useState<ContextSnapshot[]>([]);
  const windowTabs = useWindowTabs();

  // The request's turn has reported back.
  useEffect(() => {
    if (pendingTaskId && agent.tasks[pendingTaskId]) setPendingTaskId(undefined);
  }, [agent.tasks, pendingTaskId]);

  // One chat per tab: the panel shows its tab's conversation.
  const currentTab = useRef(tab);
  currentTab.current = tab;
  const tabConversation = useTabConversation({
    tabId: tab?.id,
    currentId: conversation.conversation?.id,
    busy: Boolean(activeTask) || Boolean(pendingTaskId),
    open: async (id) => {
      setPendingTaskId(undefined);
      await conversation.open(id);
    },
    reset: () => {
      setPendingTaskId(undefined);
      conversation.reset();
    },
  });

  // Another tab's panel may have continued this conversation while this one was hidden.
  const reload = conversation.reload;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  // What you typed stays with its tab (for the panel opened as a page, which follows tabs).
  const drafts = useRef(new Map<number, string>());
  const draftTab = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (tab?.id === draftTab.current) return;
    if (draftTab.current !== undefined) drafts.current.set(draftTab.current, text);
    draftTab.current = tab?.id;
    setText(tab ? (drafts.current.get(tab.id) ?? '') : '');
    setSelection(undefined);
    setTabContexts([]);
  }, [tab?.id]);

  // A page toggle only applies to the tab it was turned on for.
  useEffect(() => setIncludePage(false), [tab?.id, tab?.url]);

  /**
   * Resolves true when the active page may be read. When access is missing it
   * asks Chrome right away, so it must be called synchronously from a click or
   * key handler (before any await).
   */
  const ensureAccess = (): Promise<boolean> => {
    if (!tab || access === 'none' || access === 'restricted') return Promise.resolve(false);
    if (access === 'granted') return Promise.resolve(true);
    return requestHostAccess(tab.url);
  };

  const accessNotice = () => setNotice(access === 'missing' ? t('context.accessDenied') : t('context.unavailable'));

  const attachPage = async () => {
    if (await ensureAccess()) setIncludePage(true);
    else accessNotice();
  };

  const attachSelection = async (fallbackToPage: boolean) => {
    if (!tab || !(await ensureAccess())) return accessNotice();
    try {
      const snapshot = await captureSelection(tab);
      if (snapshot) setSelection(snapshot);
      else if (fallbackToPage) setIncludePage(true);
      else setNotice(t('context.noSelection'));
    } catch (error) {
      console.error(error);
      setNotice(t('context.captureFailed'));
    }
  };

  const commandPrompt = (id: SlashCommand['id']) => t(`commands.${id}.prompt`, { language: t('languageName') });

  const applyCommand = (command: SlashCommand) => {
    setText(commandPrompt(command.id));
    if (command.attach === 'page') void attachPage();
    else void attachSelection(command.attach === 'selectionOrPage');
  };

  const applyMention = (target: ContextKind) => {
    if (target === 'page') void attachPage();
    else void attachSelection(false);
  };

  /** @-mention of another tab: attach its page. Called from the menu's click or key handler. */
  const attachTab = (target: ActiveTab) => {
    // Asks for site access within the user's gesture; resolves at once when it is already granted.
    const access = isRestrictedUrl(target.url) ? Promise.resolve(false) : requestHostAccess(target.url);
    void access.then(async (granted) => {
      if (!granted) return setNotice(t('context.accessDenied'));
      try {
        const page = await capturePage(target.id);
        setTabContexts((previous) => [...previous.filter((c) => c.url !== page.url), page]);
      } catch (error) {
        console.error(error);
        setNotice(t('context.captureFailed'));
      }
    });
  };

  /** Stores the request and starts the assistant's turn in the background. */
  const send = async (prompt: string, contexts: ContextSnapshot[]) => {
    setNotice(undefined);
    setText('');
    setIncludePage(false);
    setSelection(undefined);
    setTabContexts([]);
    const taskId = newId();
    setPendingTaskId(taskId);
    const { conversationId, message } = await conversation.appendUser({ text: prompt, contexts, taskId });
    // This tab shows the conversation from now on (the service links it too).
    if (tab) await linkTab(tab.id, conversationId);
    agent.send({ type: 'start', taskId, conversationId, anchorMessageId: message.id, tabId: tab?.id });
    // You switched tabs while it was being sent: show that tab's chat.
    if (currentTab.current?.id !== tab?.id) tabConversation.resync();
  };

  /** Answers the assistant's question; the answer is part of the conversation. */
  const answer = async (reply: string) => {
    if (!question) return;
    setText('');
    await conversation.appendUser({ text: reply, taskId: question.id });
    agent.send({ type: 'respond', taskId: question.id, response: { kind: 'answer', text: reply } });
  };

  const handleSend = async (typed = text) => {
    const prompt = typed.trim();
    if (question) return prompt ? answer(prompt) : undefined;
    if (!chatSlot || activeTask || pendingTaskId) return;
    const contexts: ContextSnapshot[] = [];
    if (includePage && tab) {
      try {
        contexts.push(await capturePage(tab.id));
      } catch (error) {
        console.error(error);
        setNotice(t('context.captureFailed'));
        return;
      }
    }
    contexts.push(...tabContexts);
    if (selection) contexts.push(selection);
    if (!prompt && contexts.length === 0) return;
    await send(prompt || t('composer.defaultPrompt'), contexts);
  };

  /** A new reply to the same request, after an error or a stop. */
  const retry = () => {
    const current = conversation.conversation;
    const last = conversation.messages.at(-1);
    if (!current || !last || activeTask) return;
    const taskId = newId();
    setPendingTaskId(taskId);
    agent.send({ type: 'start', taskId, conversationId: current.id, anchorMessageId: last.id, tabId: tab?.id });
  };

  /** Empty-state shortcuts: attach what the command needs and send at once. */
  const runQuickAction = async (id: SlashCommand['id']) => {
    const command = SLASH_COMMANDS.find((c) => c.id === id)!;
    if (!tab || !(await ensureAccess())) return accessNotice();
    try {
      const contexts: ContextSnapshot[] = [];
      if (command.attach !== 'page') {
        const snapshot = await captureSelection(tab);
        if (snapshot) contexts.push(snapshot);
        else if (command.attach === 'selection') return setNotice(t('context.noSelection'));
      }
      if (contexts.length === 0) contexts.push(await capturePage(tab.id));
      await send(commandPrompt(id), contexts);
    } catch (error) {
      console.error(error);
      setNotice(t('context.captureFailed'));
    }
  };

  const newChat = () => {
    const previous = conversation.conversation;
    // Tabs this conversation grouped go back to how they were (M1.5 A4).
    if (previous) agent.send({ type: 'release', conversationId: previous.id });
    if (tab) void unlinkTab(tab.id);
    conversation.reset();
    setPendingTaskId(undefined);
    setView('chat');
  };

  /** A conversation opened from the history continues in this tab. */
  const openFromHistory = (id: string) => {
    if (tab) void linkTab(tab.id, id);
    setPendingTaskId(undefined);
    void conversation.open(id);
    setView('chat');
  };

  /** A turn of another tab's conversation: go to its tab, which shows that conversation. */
  const showTask = (task: AgentTask) => {
    const tabId = task.tabId ?? task.startTabId;
    // This panel stays with its own tab; that tab gets its panel (we are in a click, which Chrome needs).
    if (ownTab) openPanel(tabId).catch(() => undefined);
    else void conversation.open(task.conversationId);
    void browser.tabs
      .get(tabId)
      .then(async (target) => {
        await browser.tabs.update(tabId, { active: true });
        await browser.windows.update(target.windowId, { focused: true });
      })
      .catch(() => undefined);
  };

  const voiceProblem = (problem: VoiceProblem, error?: ErrorInfo) =>
    setNotice(problem === 'transcribe' && error ? errorSummary(t, error) : t(`voice.problems.${problem}`));

  // Spoken text is added after what was already typed.
  const typedBeforeVoice = useRef('');
  const withTyped = (spoken: string) => (typedBeforeVoice.current ? `${typedBeforeVoice.current} ${spoken}` : spoken);
  const voice = useVoiceInput({
    voice: settings?.voice ?? DEFAULT_VOICE_SETTINGS,
    locale,
    onText: (spoken) => setText(withTyped(spoken)),
    onDone: (spoken) => {
      if (spoken && settings?.voice.autoSend) void handleSend(withTyped(spoken));
    },
    onProblem: voiceProblem,
  });
  const toggleVoice = () => {
    if (voice.state === 'idle') typedBeforeVoice.current = text.trim();
    voice.toggle();
  };

  if (!settings) return null;

  const hasModel = Boolean(chatSlot);
  const showEmpty = conversation.messages.length === 0 && !pendingTaskId;
  const busy = Boolean((activeTask && !question) || pendingTaskId);
  const otherTasks = Object.values(agent.tasks).filter(
    (task) => task.conversationId !== conversation.conversation?.id && ACTIVE_STATUSES.includes(task.status),
  );

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      {/* Chrome draws the extension's name above the panel, so the header leads with the model. */}
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        {settings.connections.length > 0 ? (
          <ModelSwitcher settings={settings} />
        ) : (
          <Button size="sm" variant="soft" onClick={() => openOptions('providers')}>
            <Plug className="h-3.5 w-3.5" />
            {t('empty.setupAction')}
          </Button>
        )}
        <div className="flex-1" />
        <IconButton label={t('header.newChat')} onClick={newChat}>
          <SquarePen className="h-4 w-4" />
        </IconButton>
        <IconButton label={t('header.history')} onClick={() => setView(view === 'history' ? 'chat' : 'history')}>
          <History className="h-4 w-4" />
        </IconButton>
        <IconButton label={t('header.settings')} onClick={() => openOptions()}>
          <SettingsIcon className="h-4 w-4" />
        </IconButton>
      </header>

      {view === 'history' ? (
        <HistoryPanel
          currentId={conversation.conversation?.id}
          onOpen={openFromHistory}
          onClose={() => setView('chat')}
        />
      ) : (
        <>
          {showEmpty ? (
            <EmptyState hasModel={hasModel} onQuickAction={(id) => void runQuickAction(id)} onExample={setText} />
          ) : (
            <MessageList
              messages={conversation.messages}
              tasks={agent.tasks}
              pendingTaskId={pendingTaskId}
              onRetry={retry}
              onAgentSend={agent.send}
            />
          )}
          <div className="shrink-0 space-y-2 px-3 pb-3 pt-1">
            {notice && (
              <div
                className="flex animate-fade-in items-start gap-2 rounded-xl border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-fg"
                role="status"
              >
                <Info className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
                <span className="flex-1 leading-relaxed">{notice}</span>
                <button type="button" aria-label={t('common.dismiss')} onClick={() => setNotice(undefined)} className="text-muted hover:text-fg">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <OtherTasksBar tasks={otherTasks} onShow={showTask} />
            {activeTask && (activeTask.steps.length > 0 || activeTask.waiting) && (
              <AgentControls task={activeTask} onSend={agent.send} />
            )}
            <Composer
              mode={settings.agent.mode}
              onModeChange={(mode: AgentMode) => void updateSettings((s) => ({ ...s, agent: { ...s.agent, mode } }))}
              placeholder={question ? t('composer.placeholderAnswer') : undefined}
              text={text}
              onTextChange={setText}
              tab={tab}
              access={access}
              includePage={includePage}
              onTogglePage={() => (includePage ? setIncludePage(false) : void attachPage())}
              selection={selection}
              onRemoveSelection={() => setSelection(undefined)}
              onCommand={applyCommand}
              onMention={applyMention}
              otherTabs={windowTabs}
              onMentionTab={attachTab}
              tabContexts={tabContexts}
              onRemoveTabContext={(url) => setTabContexts((previous) => previous.filter((c) => c.url !== url))}
              onSend={() => void handleSend()}
              onStop={() => activeTask && agent.send({ type: 'stop', taskId: activeTask.id })}
              busy={busy}
              disabled={!hasModel}
              voice={{ state: voice.state, level: voice.level, toggle: toggleVoice }}
            />
          </div>
        </>
      )}
    </div>
  );
}
