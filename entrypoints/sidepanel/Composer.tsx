import { ArrowUp, Check, FileText, Plus, Square, TextQuote, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActiveTab } from '../../src/browser/page-context';
import { matchCommands, type SlashCommand } from '../../src/chat/commands';
import type { ContextKind, ContextSnapshot } from '../../src/shared/types';
import type { PageAccess } from '../../src/ui/useActiveTab';

type MenuItem = { kind: 'command'; command: SlashCommand } | { kind: 'mention'; target: ContextKind };

const MENTION_TARGETS: ContextKind[] = ['page', 'selection'];
const MAX_TEXTAREA_HEIGHT = 200;

const preview = (text: string, length = 40) => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);

export function Composer(props: {
  text: string;
  onTextChange: (text: string) => void;
  tab?: ActiveTab;
  access: PageAccess;
  includePage: boolean;
  onTogglePage: () => void;
  selection?: ContextSnapshot;
  onRemoveSelection: () => void;
  onCommand: (command: SlashCommand) => void;
  onMention: (target: ContextKind) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const { text, onTextChange, streaming, disabled } = props;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissedFor, setDismissedFor] = useState<string>();

  // Grow with the content up to a limit.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [text]);

  const beforeCaret = text.slice(0, caret);
  const commandQuery = /^\/(\S*)$/.exec(text)?.[1];
  const mentionQuery = /(?:^|\s)@(\S*)$/.exec(beforeCaret)?.[1];
  const commandLabel = (command: SlashCommand) => t(`commands.${command.id}.label`);
  const mentionLabel = (target: ContextKind) => t(`mentions.${target}`);

  let items: MenuItem[] = [];
  if (dismissedFor !== text) {
    if (commandQuery !== undefined) {
      items = matchCommands(commandQuery, commandLabel).map((command) => ({ kind: 'command', command }));
    } else if (mentionQuery !== undefined) {
      const q = mentionQuery.toLowerCase();
      items = MENTION_TARGETS.filter((target) => !q || target.startsWith(q) || mentionLabel(target).toLowerCase().includes(q)).map(
        (target) => ({ kind: 'mention', target }),
      );
    }
  }
  const menuOpen = items.length > 0;

  useEffect(() => setActiveIndex(0), [commandQuery, mentionQuery]);

  const select = (item: MenuItem) => {
    if (item.kind === 'command') {
      props.onCommand(item.command);
    } else {
      const remaining = beforeCaret.replace(/@\S*$/, '') + text.slice(caret);
      onTextChange(remaining);
      props.onMention(item.target);
    }
    textareaRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Never act while an IME (e.g. Chinese input) is composing.
    if (event.nativeEvent.isComposing) return;
    if (menuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((index) => (index + step + items.length) % items.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const item = items[activeIndex] ?? items[0];
        if (item) select(item);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedFor(text);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!streaming && !disabled) props.onSend();
    }
  };

  const canSend = !disabled && (text.trim() || props.selection || props.includePage);

  return (
    <div className="border-t border-line bg-bg p-3">
      <div className="relative mx-auto max-w-3xl">
        {menuOpen && (
          <div
            role="listbox"
            className="absolute bottom-full left-0 right-0 z-10 mb-2 overflow-hidden rounded-lg border border-line bg-bg py-1 shadow-lg"
          >
            {items.map((item, index) => (
              <button
                key={item.kind === 'command' ? item.command.id : item.target}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(item)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${index === activeIndex ? 'bg-hover' : ''}`}
              >
                {item.kind === 'command' ? (
                  <>
                    <span className="font-mono text-muted">/</span>
                    <span className="font-medium">{commandLabel(item.command)}</span>
                    <span className="truncate text-xs text-muted">{t(`commands.${item.command.id}.description`)}</span>
                  </>
                ) : (
                  <>
                    {item.target === 'page' ? <FileText className="h-4 w-4 text-muted" /> : <TextQuote className="h-4 w-4 text-muted" />}
                    <span>{mentionLabel(item.target)}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-line bg-bg focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15">
          <div className="flex flex-wrap gap-1.5 px-2.5 pt-2.5">
            <PageChip tab={props.tab} access={props.access} included={props.includePage} onToggle={props.onTogglePage} />
            {props.selection && (
              <span className="flex max-w-full items-center gap-1 rounded-md border border-line bg-subtle px-2 py-1 text-xs">
                <TextQuote className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="truncate">“{preview(props.selection.content)}”</span>
                <button type="button" aria-label={t('composer.removeSelection')} onClick={props.onRemoveSelection} className="text-muted hover:text-fg">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
          </div>
          <textarea
            ref={textareaRef}
            data-testid="composer-input"
            rows={1}
            value={text}
            disabled={disabled}
            placeholder={disabled ? t('composer.placeholderNoModel') : t('composer.placeholder')}
            onChange={(e) => {
              onTextChange(e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            className="block w-full resize-none bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted"
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="px-1 text-xs text-muted">{t('composer.hint')}</span>
            {streaming ? (
              <button
                type="button"
                onClick={props.onStop}
                aria-label={t('composer.stop')}
                title={t('composer.stop')}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-bg"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="send-button"
                onClick={props.onSend}
                disabled={!canSend}
                aria-label={t('composer.send')}
                title={t('composer.send')}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-on-accent disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PageChip({ tab, access, included, onToggle }: {
  tab?: ActiveTab;
  access: PageAccess;
  included: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  if (!tab || access === 'none' || access === 'restricted') {
    return (
      <span className="flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-1 text-xs text-muted">
        <FileText className="h-3.5 w-3.5" />
        {t('context.unavailable')}
      </span>
    );
  }
  const title = tab.title || tab.url;
  return (
    <button
      type="button"
      data-testid="page-chip"
      aria-pressed={included}
      onClick={onToggle}
      title={access === 'missing' ? t('context.needsAccess') : t('context.includeHint')}
      className={`flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
        included ? 'border-accent/40 bg-accent-soft text-accent' : 'border-line text-muted hover:bg-hover hover:text-fg'
      }`}
    >
      {tab.favIconUrl ? <img src={tab.favIconUrl} alt="" className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{title}</span>
      {included ? <Check className="h-3.5 w-3.5 shrink-0" /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
