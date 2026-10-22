import { Check, ChevronsUpDown, Search, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Settings } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { openOptions } from '../../src/ui/navigation';

/** Header dropdown that switches the chat slot's model (§4.1). */
export function ModelPicker({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const slot = settings.slots.chat;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const choose = (connectionId: string, modelId: string) => {
    void updateSettings((s) => ({ ...s, slots: { ...s.slots, chat: { ...s.slots.chat, connectionId, modelId } } }));
    setOpen(false);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const groups = settings.connections
    .map((connection) => {
      // A model id typed by hand in settings may be missing from the fetched list.
      const manual = slot?.connectionId === connection.id && slot.modelId && !connection.models.includes(slot.modelId);
      const models = manual ? [slot.modelId, ...connection.models] : connection.models;
      return { connection, models: models.filter((m) => !q || m.toLowerCase().includes(q)) };
    })
    .filter((group) => group.models.length > 0);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex h-8 max-w-full items-center gap-1.5 rounded-lg px-2 text-sm font-semibold tracking-tight transition-colors hover:bg-hover"
      >
        <span className="truncate">{slot?.modelId || t('model.choose')}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1.5 w-72 max-w-[calc(100vw-1rem)] animate-fade-in overflow-hidden rounded-xl border border-line bg-surface shadow-float">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
            <Search className="h-4 w-4 text-faint" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('model.search')}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
            />
          </div>
          <div className="max-h-80 overflow-y-auto p-1" role="listbox">
            {groups.length === 0 && <p className="px-3 py-2 text-sm text-muted">{t('model.none')}</p>}
            {groups.map(({ connection, models }) => (
              <div key={connection.id}>
                <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{connection.name}</div>
                {models.map((modelId) => {
                  const selected = slot?.connectionId === connection.id && slot.modelId === modelId;
                  return (
                    <button
                      key={modelId}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => choose(connection.id, modelId)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-hover ${selected ? 'bg-accent-soft font-medium text-accent' : ''}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{modelId}</span>
                      {selected && <Check className="h-4 w-4 text-accent" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => openOptions('models')}
            className="flex w-full items-center gap-2 border-t border-line px-3.5 py-2.5 text-sm text-muted hover:bg-hover hover:text-fg"
          >
            <Settings2 className="h-4 w-4" />
            {t('model.manage')}
          </button>
        </div>
      )}
    </div>
  );
}
