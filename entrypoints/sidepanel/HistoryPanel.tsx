import { ArrowLeft, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationRecord } from '../../src/shared/types';
import { deleteConversation, listConversations } from '../../src/storage/db';
import { IconButton } from '../../src/ui/Button';

export function HistoryPanel({ currentId, onOpen, onClose }: {
  currentId?: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void listConversations().then(setConversations);
  }, []);

  const remove = async (id: string) => {
    await deleteConversation(id);
    setConversations((list) => list.filter((c) => c.id !== id));
  };

  const formatter = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' });
  const q = query.trim().toLowerCase();
  const visible = conversations.filter((c) => !q || c.title.toLowerCase().includes(q));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('history.search')}
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </div>
      </div>
      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-3">
        {visible.length === 0 && <li className="px-2 py-10 text-center text-sm text-faint">{t('history.empty')}</li>}
        {visible.map((conversation) => (
          <li
            key={conversation.id}
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
              <div className="mt-0.5 text-xs text-faint">{formatter.format(conversation.updatedAt)}</div>
            </button>
            <IconButton
              label={t('common.delete')}
              onClick={() => void remove(conversation.id)}
              className="mr-1 opacity-0 focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
