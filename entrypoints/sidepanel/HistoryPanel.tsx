import { ArrowLeft, Search, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationRecord } from '../../src/shared/types';
import { deleteConversation, listConversations, purgeConversation, restoreConversation, searchMessages } from '../../src/storage/db';
import { IconButton } from '../../src/ui/Button';

/** How long a deleted conversation can be brought back. */
const UNDO_MS = 6000;
const SEARCH_DELAY_MS = 180;

export function HistoryPanel({ currentId, onOpen, onClose, onDeleted }: {
  currentId?: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  /** A conversation was deleted: stop its turn and stop showing it. */
  onDeleted: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [query, setQuery] = useState('');
  /** Passages found in messages, by conversation. */
  const [passages, setPassages] = useState(new Map<string, string>());
  const [undo, setUndo] = useState<ConversationRecord>();
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);

  useEffect(() => {
    void listConversations().then(setConversations);
  }, []);

  // Messages are searched too, a moment after you stop typing.
  const q = query.trim().toLowerCase();
  useEffect(() => {
    if (!q) return setPassages(new Map());
    let stale = false;
    const timer = setTimeout(() => void searchMessages(q).then((found) => !stale && setPassages(found)), SEARCH_DELAY_MS);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [q]);

  /** Erases the conversation whose undo time is over (or is cut short). */
  const finish = () => {
    const last = pending.current;
    if (!last) return;
    clearTimeout(last.timer);
    pending.current = undefined;
    void purgeConversation(last.id);
  };

  // Leaving the history ends the undo time.
  useEffect(() => finish, []);

  // Escape goes back to the chat.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const remove = async (conversation: ConversationRecord) => {
    finish();
    await deleteConversation(conversation.id);
    onDeleted(conversation.id);
    setConversations((list) => list.filter((c) => c.id !== conversation.id));
    setUndo(conversation);
    pending.current = {
      id: conversation.id,
      timer: setTimeout(() => {
        finish();
        setUndo(undefined);
      }, UNDO_MS),
    };
  };

  const restore = async () => {
    const last = pending.current;
    if (!last || !undo) return;
    clearTimeout(last.timer);
    pending.current = undefined;
    setUndo(undefined);
    if (await restoreConversation(last.id)) setConversations(await listConversations());
  };

  const formatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const visible = conversations.filter((c) => !q || c.title.toLowerCase().includes(q) || passages.has(c.id));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-testid="history-panel">
      <div className="flex items-center gap-1 px-2.5 pt-2.5">
        <IconButton label={t('common.back')} onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <h2 className="text-sm font-semibold tracking-tight">{t('history.title')}</h2>
      </div>
      <div className="px-3.5 pt-2">
        <div className="flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 shadow-soft focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15">
          <Search className="h-4 w-4 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('history.search')}
            data-testid="history-search"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {visible.length === 0 && (
          <li className="px-2 py-10 text-center text-sm text-faint">{q ? t('history.noMatches') : t('history.empty')}</li>
        )}
        {visible.map((conversation) => {
          const passage = q ? passages.get(conversation.id) : undefined;
          return (
            <li
              key={conversation.id}
              data-testid="history-item"
              className={`group flex items-center rounded-xl transition-colors hover:bg-surface hover:shadow-soft ${
                conversation.id === currentId ? 'bg-accent-soft hover:bg-accent-soft' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onOpen(conversation.id)}
                className="min-w-0 flex-1 px-3 py-2.5 text-left"
                aria-current={conversation.id === currentId ? 'true' : undefined}
              >
                <div className={`truncate text-sm ${conversation.id === currentId ? 'font-semibold text-accent' : 'text-fg'}`}>
                  {conversation.title || t('history.untitled')}
                </div>
                {passage && <div className="mt-0.5 truncate text-xs text-muted">{passage}</div>}
                <div className="mt-0.5 text-xs text-faint">{formatter.format(conversation.updatedAt)}</div>
              </button>
              <IconButton
                label={t('common.delete')}
                onClick={() => void remove(conversation)}
                className="mr-1 opacity-0 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </li>
          );
        })}
      </ul>
      {undo && (
        <div
          role="status"
          data-testid="history-undo"
          className="absolute inset-x-3 bottom-3 flex animate-fade-in items-center gap-2 rounded-xl bg-fg py-1.5 pl-3.5 pr-1.5 text-sm text-surface shadow-float"
        >
          <span className="min-w-0 flex-1 truncate">{t('history.deleted')}</span>
          <button
            type="button"
            onClick={() => void restore()}
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 font-medium hover:bg-surface/15"
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t('history.undo')}
          </button>
        </div>
      )}
    </div>
  );
}
