import { History, Settings as SettingsIcon, SquarePen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { capturePage, captureSelection } from '../../src/browser/page-context';
import { SLASH_COMMANDS, type SlashCommand } from '../../src/chat/commands';
import { useChatSession } from '../../src/chat/useChatSession';
import { requestHostAccess } from '../../src/permissions/hosts';
import type { ContextKind, ContextSnapshot, Locale } from '../../src/shared/types';
import { IconButton } from '../../src/ui/Button';
import { openOptions } from '../../src/ui/navigation';
import { useActiveTab } from '../../src/ui/useActiveTab';
import { useSettings } from '../../src/ui/useSettings';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';
import { HistoryPanel } from './HistoryPanel';
import { MessageList } from './MessageList';
import { ModelPicker } from './ModelPicker';

export function App() {
  const { t, i18n } = useTranslation();
  const settings = useSettings();
  const { tab, access } = useActiveTab();
  const chatSlot = settings?.slots.chat?.modelId ? settings.slots.chat : undefined;
  const locale = i18n.language as Locale;
  const session = useChatSession({ chatSlot, locale });

  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [text, setText] = useState('');
  const [includePage, setIncludePage] = useState(false);
  const [selection, setSelection] = useState<ContextSnapshot>();
  const [notice, setNotice] = useState<string>();

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

  const send = async (prompt: string, contexts: ContextSnapshot[]) => {
    setNotice(undefined);
    setText('');
    setIncludePage(false);
    setSelection(undefined);
    await session.send({ text: prompt, contexts });
  };

  const handleSend = async () => {
    if (!chatSlot || session.streaming) return;
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
    if (selection) contexts.push(selection);
    await send(text.trim() || t('composer.defaultPrompt'), contexts);
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

  if (!settings) return null;

  const hasModel = Boolean(chatSlot);
  const showEmpty = session.messages.length === 0 && !session.streaming;

  return (
    <div className="flex h-screen flex-col bg-bg text-fg">
      <header className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <img src="/icon/32.png" alt="" className="mx-1 h-5 w-5" />
        {settings.connections.length > 0 ? (
          <ModelPicker settings={settings} />
        ) : (
          <span className="text-sm font-medium">Browser Helper</span>
        )}
        <div className="flex-1" />
        <IconButton
          label={t('header.newChat')}
          onClick={() => {
            session.reset();
            setView('chat');
          }}
        >
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
          currentId={session.conversation?.id}
          onOpen={(id) => {
            void session.open(id);
            setView('chat');
          }}
          onClose={() => setView('chat')}
        />
      ) : (
        <>
          {showEmpty ? (
            <EmptyState hasModel={hasModel} onQuickAction={(id) => void runQuickAction(id)} />
          ) : (
            <MessageList messages={session.messages} streaming={session.streaming} onRetry={session.retry} />
          )}
          {notice && (
            <div className="mx-3 mb-1 flex items-start gap-2 rounded-md bg-warning-soft px-3 py-2 text-xs" role="status">
              <span className="flex-1">{notice}</span>
              <button type="button" aria-label={t('common.dismiss')} onClick={() => setNotice(undefined)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Composer
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
            onSend={() => void handleSend()}
            onStop={session.stop}
            streaming={Boolean(session.streaming)}
            disabled={!hasModel}
          />
        </>
      )}
    </div>
  );
}
