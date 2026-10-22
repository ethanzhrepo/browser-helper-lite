import { ArrowUp, Bot, Check, FileText, MessageSquare, Plus, Square, TextQuote, X } from 'lucide-react';
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

export type ComposerMode = 'ask' | 'act';

export function Composer(props: {
  mode: ComposerMode;
  onModeChange: (mode: ComposerMode) => void;
  /** Replaces the default placeholder, e.g. while the agent asks a question. */
  placeholder?: string;
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
  // Commands and attachments belong to Ask mode; the agent reads pages itself.
  if (dismissedFor !== text && props.mode === 'ask') {
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

  const canSend = !disabled && (props.mode === 'act' ? text.trim() : text.trim() || props.selection || props.includePage);

  const act = props.mode === 'act';

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      {menuOpen && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 right-0 z-10 mb-2 animate-fade-in overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-float"
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
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${index === activeIndex ? 'bg-hover' : ''}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent">
                {item.kind === 'command' ? (
                  <span className="font-mono text-xs font-semibold">/</span>
                ) : item.target === 'page' ? (
                  <FileText className="h-3.5 w-3.5" />
                ) : (
                  <TextQuote className="h-3.5 w-3.5" />
                )}
              </span>
              {item.kind === 'command' ? (
                <span className="min-w-0">
                  <span className="block font-medium">{commandLabel(item.command)}</span>
                  <span className="block truncate text-xs text-muted">{t(`commands.${item.command.id}.description`)}</span>
                </span>
              ) : (
                <span className="font-medium">{mentionLabel(item.target)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 1px frame: neutral in Ask mode, brand gradient in Act mode. */}
      <div
        className={`rounded-2xl p-px shadow-card transition-colors ${act ? 'brand-border' : 'bg-line focus-within:bg-accent/45'}`}
        data-mode={props.mode}
      >
        <div className="rounded-[15px] bg-surface">
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {act ? (
              <TargetChip tab={props.tab} />
            ) : (
              <PageChip tab={props.tab} access={props.access} included={props.includePage} onToggle={props.onTogglePage} />
            )}
            {!act && props.selection && (
              <span className="flex max-w-full animate-fade-in items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft py-1 pl-2.5 pr-1.5 text-xs text-accent">
                <TextQuote className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">“{preview(props.selection.content)}”</span>
                <button
                  type="button"
                  aria-label={t('composer.removeSelection')}
                  onClick={props.onRemoveSelection}
                  className="rounded-full p-0.5 hover:bg-accent-soft-strong"
                >
                  <X className="h-3 w-3" />
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
            placeholder={
              disabled
                ? t('composer.placeholderNoModel')
                : (props.placeholder ?? (act ? t('composer.placeholderAct') : t('composer.placeholder')))
            }
            onChange={(e) => {
              onTextChange(e.target.value);
              setCaret(e.target.selectionStart);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onKeyDown={onKeyDown}
            className="block min-h-[44px] w-full resize-none bg-transparent px-3.5 py-2.5 text-sm leading-relaxed text-fg outline-none placeholder:text-faint"
          />
          <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
            <div className="flex rounded-lg bg-subtle p-0.5 text-xs" role="radiogroup" aria-label={t('composer.mode')}>
              {(['ask', 'act'] as const).map((mode) => {
                const checked = props.mode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    data-testid={`mode-${mode}`}
                    onClick={() => props.onModeChange(mode)}
                    title={t(`composer.modes.${mode}Hint`)}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-all ${
                      checked ? 'bg-surface text-fg shadow-soft' : 'text-muted hover:text-fg'
                    }`}
                  >
                    {mode === 'ask' ? (
                      <MessageSquare className={`h-3.5 w-3.5 ${checked ? 'text-accent' : ''}`} />
                    ) : (
                      <Bot className={`h-3.5 w-3.5 ${checked ? 'text-accent' : ''}`} />
                    )}
                    {t(`composer.modes.${mode}`)}
                  </button>
                );
              })}
            </div>
            {streaming ? (
              <button
                type="button"
                onClick={props.onStop}
                aria-label={t('composer.stop')}
                title={t('composer.stop')}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-fg text-surface transition-opacity hover:opacity-85"
              >
                <Square className="h-3 w-3 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                data-testid="send-button"
                onClick={props.onSend}
                disabled={!canSend}
                aria-label={t('composer.send')}
                title={t('composer.send')}
                className="flex h-8 w-8 items-center justify-center rounded-full text-white shadow-soft transition-all brand-gradient hover:brightness-110 disabled:bg-none disabled:bg-subtle disabled:text-faint disabled:shadow-none"
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
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
      <span className="flex items-center gap-1.5 rounded-full px-1 py-1 text-xs text-faint">
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
      className={`flex max-w-full items-center gap-1.5 rounded-full border py-1 pl-2 pr-2.5 text-xs transition-colors ${
        included
          ? 'border-accent/25 bg-accent-soft text-accent'
          : 'border-line bg-surface text-muted hover:border-line-strong hover:text-fg'
      }`}
    >
      {tab.favIconUrl ? (
        <img src={tab.favIconUrl} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="truncate">{title}</span>
      {included ? <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} /> : <Plus className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

function TargetChip({ tab }: { tab?: ActiveTab }) {
  const { t } = useTranslation();
  return (
    <span
      className="flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-2 pr-2.5 text-xs text-accent"
      data-testid="target-chip"
    >
      <Bot className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{tab ? t('composer.actOn', { title: tab.title || tab.url }) : t('composer.actNewTab')}</span>
    </span>
  );
}
