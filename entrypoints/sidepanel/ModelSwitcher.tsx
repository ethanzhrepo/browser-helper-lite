import { Check, ChevronDown, ChevronsUpDown, Search, Settings2, Star } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Connection, Settings } from '../../src/shared/types';
import { toggleFavoriteModel, updateSettings } from '../../src/storage/settings';
import { openOptions } from '../../src/ui/navigation';
import { VendorMark } from '../../src/ui/VendorMark';

/** Connections with few models show them all; bigger lists show favorites first. */
const SMALL_LIST = 12;

interface Group {
  connection: Connection;
  models: string[];
  /** Models left out of the compact list. */
  hidden: number;
}

/**
 * Header switcher for the current model (M1.5 A2): "Provider · model", grouped
 * by connection, with search and starred favorites.
 */
export function ModelSwitcher({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const slot = settings.slots.chat;
  const current = settings.connections.find((c) => c.id === slot?.connectionId);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (connectionId: string, modelId: string) => {
    void updateSettings((s) => ({ ...s, slots: { ...s.slots, chat: { ...s.slots.chat, connectionId, modelId } } }));
    setOpen(false);
    setQuery('');
  };

  const q = query.trim().toLowerCase();
  const groups: Group[] = settings.connections
    .map((connection) => {
      const selected = slot?.connectionId === connection.id ? slot.modelId : undefined;
      // A model id typed by hand in settings may be missing from the fetched list.
      const all = selected && !connection.models.includes(selected) ? [selected, ...connection.models] : connection.models;
      if (q) return { connection, models: all.filter((m) => m.toLowerCase().includes(q) || connection.name.toLowerCase().includes(q)), hidden: 0 };
      if (showAll || expanded.has(connection.id)) return { connection, models: all, hidden: 0 };
      const favorites = connection.favoriteModels?.filter((m) => all.includes(m)) ?? [];
      let models: string[];
      if (favorites.length > 0) models = favorites;
      else if (all.length <= SMALL_LIST) models = all;
      else models = [];
      if (selected && !models.includes(selected)) models = [selected, ...models];
      return { connection, models, hidden: all.length - models.length };
    })
    .filter((group) => group.models.length > 0 || group.hidden > 0);

  const label = current && slot?.modelId ? slot.modelId : t('model.choose');

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        data-testid="model-switcher"
        onClick={() => {
          // Each opening starts from the compact list.
          setExpanded(new Set());
          setShowAll(false);
          setQuery('');
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={current ? `${current.name} · ${slot?.modelId ?? ''}` : undefined}
        className="flex h-8 max-w-full items-center gap-2 rounded-lg pl-1.5 pr-2 text-sm transition-colors hover:bg-hover"
      >
        {current && <VendorMark connection={current} size="sm" />}
        <span className="flex min-w-0 items-baseline gap-1.5 truncate">
          {current && <span className="hidden shrink-0 text-muted min-[340px]:inline">{current.name} ·</span>}
          <span className="truncate font-semibold tracking-tight">{label}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-80 max-w-[calc(100vw-1rem)] animate-fade-in overflow-hidden rounded-xl border border-line bg-surface shadow-float">
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
          <div className="max-h-[22rem] overflow-y-auto p-1" role="listbox">
            {groups.length === 0 && <p className="px-3 py-2 text-sm text-muted">{t('model.none')}</p>}
            {groups.map(({ connection, models, hidden }) => (
              <div key={connection.id} className="pb-1">
                <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
                  <VendorMark connection={connection} size="xs" />
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-faint">{connection.name}</span>
                </div>
                {models.map((modelId) => {
                  const selected = slot?.connectionId === connection.id && slot.modelId === modelId;
                  const favorite = connection.favoriteModels?.includes(modelId) ?? false;
                  return (
                    <div
                      key={modelId}
                      className={`group/model flex items-center rounded-lg hover:bg-hover ${selected ? 'bg-accent-soft' : ''}`}
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => choose(connection.id, modelId)}
                        className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2.5 text-left text-sm ${selected ? 'font-medium text-accent' : ''}`}
                      >
                        <span className="min-w-0 flex-1 truncate">{modelId}</span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-accent" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleFavoriteModel(connection.id, modelId)}
                        aria-label={favorite ? t('model.unfavorite') : t('model.favorite')}
                        title={favorite ? t('model.unfavorite') : t('model.favorite')}
                        aria-pressed={favorite}
                        className={`mx-1 rounded-md p-1 transition-opacity hover:bg-surface ${
                          favorite ? 'text-warning' : 'text-faint opacity-0 group-hover/model:opacity-100 focus-visible:opacity-100'
                        }`}
                      >
                        <Star className={`h-3.5 w-3.5 ${favorite ? 'fill-current' : ''}`} />
                      </button>
                    </div>
                  );
                })}
                {hidden > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(new Set(expanded).add(connection.id))}
                    className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-muted hover:bg-hover hover:text-fg"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                    {t('model.showMore', { count: hidden })}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center border-t border-line">
            <button
              type="button"
              onClick={() => setShowAll(!showAll)}
              className="flex-1 px-3.5 py-2.5 text-left text-xs text-muted hover:bg-hover hover:text-fg"
            >
              {showAll ? t('model.showFavorites') : t('model.showAll')}
            </button>
            <button
              type="button"
              onClick={() => openOptions('providers')}
              className="flex items-center gap-1.5 border-l border-line px-3.5 py-2.5 text-xs text-muted hover:bg-hover hover:text-fg"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t('model.manage')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
