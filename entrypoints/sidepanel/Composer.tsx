import {
  ArrowUp,
  BookOpenText,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Hand,
  Loader2,
  Mic,
  Plus,
  Sparkles,
  Square,
  TextQuote,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ActiveTab } from '../../src/browser/page-context';
import { matchCommands, type SlashCommand } from '../../src/chat/commands';
import type { AgentMode, ContextKind, ContextSnapshot } from '../../src/shared/types';
import type { PageAccess } from '../../src/ui/useActiveTab';
import type { VoiceState } from '../../src/voice/useVoiceInput';

type MenuItem =
  | { kind: 'command'; command: SlashCommand }
  | { kind: 'mention'; target: ContextKind }
  | { kind: 'tab'; tab: ActiveTab };

const MAX_TAB_MENTIONS = 6;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const MENTION_TARGETS: ContextKind[] = ['page', 'selection'];
const MAX_TEXTAREA_HEIGHT = 200;

const preview = (text: string, length = 40) => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);

const MODES: { id: AgentMode; icon: LucideIcon }[] = [
  { id: 'query', icon: BookOpenText },
  { id: 'auto', icon: Sparkles },
  { id: 'manual', icon: Hand },
];

export function Composer(props: {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
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
  /** Other tabs of the window, offered after @. */
  otherTabs: ActiveTab[];
  onMentionTab: (tab: ActiveTab) => void;
  /** Pages of other tabs attached with @. */
  tabContexts: ContextSnapshot[];
  onRemoveTabContext: (url: string) => void;
  onSend: () => void;
  onStop: () => void;
  /** A reply is in progress: the send button becomes a stop button. */
  busy: boolean;
  disabled: boolean;
  voice: { state: VoiceState; level: number; toggle: () => void };
}) {
  const { t } = useTranslation();
  const { text, onTextChange, busy, disabled } = props;
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
      items = [
        ...MENTION_TARGETS.filter((target) => !q || target.startsWith(q) || mentionLabel(target).toLowerCase().includes(q)).map(
          (target): MenuItem => ({ kind: 'mention', target }),
        ),
        ...props.otherTabs
          .filter((tab) => tab.id !== props.tab?.id && (!q || `${tab.title} ${tab.url}`.toLowerCase().includes(q)))
          .slice(0, MAX_TAB_MENTIONS)
          .map((tab): MenuItem => ({ kind: 'tab', tab })),
      ];
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
      if (item.kind === 'mention') props.onMention(item.target);
      else props.onMentionTab(item.tab);
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
      if (canSend) props.onSend();
    }
  };

  const canSend = !disabled && !busy && Boolean(text.trim() || props.selection || props.includePage || props.tabContexts.length > 0);
  const listening = props.voice.state === 'listening';

  return (
    <div className="relative mx-auto w-full max-w-3xl">
      {menuOpen && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 right-0 z-10 mb-2 animate-fade-in overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-float"
        >
          {items.map((item, index) => (
            <Fragment key={item.kind === 'command' ? item.command.id : item.kind === 'mention' ? item.target : `tab-${item.tab.id}`}>
              {item.kind === 'tab' && items[index - 1]?.kind !== 'tab' && (
                <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{t('mentions.otherTabs')}</p>
              )}
              <button
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
                  ) : item.kind === 'tab' ? (
                    item.tab.favIconUrl ? <img src={item.tab.favIconUrl} alt="" className="h-3.5 w-3.5 rounded-sm" /> : <Globe className="h-3.5 w-3.5" />
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
                ) : item.kind === 'tab' ? (
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{item.tab.title || item.tab.url}</span>
                    <span className="block truncate text-xs text-muted">{hostOf(item.tab.url)}</span>
                  </span>
                ) : (
                  <span className="font-medium">{mentionLabel(item.target)}</span>
                )}
              </button>
            </Fragment>
          ))}
        </div>
      )}

      {/* 1px frame: neutral, brand gradient while a reply is in progress. */}
      <div
        className={`rounded-2xl p-px shadow-card transition-colors ${busy ? 'brand-border' : 'bg-line focus-within:bg-accent/45'}`}
        data-mode={props.mode}
      >
        <div className="rounded-[15px] bg-surface">
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            <PageChip tab={props.tab} access={props.access} included={props.includePage} onToggle={props.onTogglePage} />
            {props.tabContexts.map((context) => (
              <span
                key={context.url}
                data-testid="tab-context-chip"
                className="flex max-w-full animate-fade-in items-center gap-1.5 rounded-full border border-accent/25 bg-accent-soft py-1 pl-2.5 pr-1.5 text-xs text-accent"
              >
                <Globe className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{preview(context.title || context.url)}</span>
                <button
                  type="button"
                  aria-label={t('composer.removeAttachment')}
                  onClick={() => props.onRemoveTabContext(context.url)}
                  className="rounded-full p-0.5 hover:bg-accent-soft-strong"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {props.selection && (
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
                : listening
                  ? t('voice.listening')
                  : (props.placeholder ?? t('composer.placeholder'))
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
            <ModePicker mode={props.mode} onChange={props.onModeChange} />
            <div className="flex items-center gap-1.5">
              <MicButton {...props.voice} disabled={disabled} />
              {busy ? (
                <button
                  type="button"
                  data-testid="stop-button"
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
    </div>
  );
}

/** Query / Auto / Manual (M1.5 B6), remembered globally. */
function ModePicker({ mode, onChange }: { mode: AgentMode; onChange: (mode: AgentMode) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const current = MODES.find((m) => m.id === mode) ?? MODES[1]!;
  const Icon = current.icon;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        data-testid="mode-picker"
        data-mode={mode}
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t(`composer.modes.${mode}Hint`)}
        className="flex h-7 items-center gap-1.5 rounded-lg bg-subtle px-2.5 text-xs font-medium text-fg transition-colors hover:bg-hover"
      >
        <Icon className="h-3.5 w-3.5 text-accent" />
        {t(`composer.modes.${mode}`)}
        <ChevronDown className={`h-3 w-3 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-20 mb-2 w-72 max-w-[calc(100vw-2rem)] animate-fade-in overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-float"
        >
          {MODES.map(({ id, icon: ModeIcon }) => {
            const checked = id === mode;
            return (
              <button
                key={id}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                data-testid={`mode-option-${id}`}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left ${checked ? 'bg-accent-soft' : 'hover:bg-hover'}`}
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${checked ? 'bg-accent text-on-accent' : 'bg-subtle text-muted'}`}>
                  <ModeIcon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{t(`composer.modes.${id}`)}</span>
                  <span className="block text-xs leading-relaxed text-muted">{t(`composer.modes.${id}Hint`)}</span>
                </span>
                {checked && <Check className="mt-1 h-4 w-4 shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MicButton({ state, level, toggle, disabled }: { state: VoiceState; level: number; toggle: () => void; disabled: boolean }) {
  const { t } = useTranslation();
  const listening = state === 'listening';
  const label = listening ? t('voice.stop') : state === 'transcribing' ? t('voice.transcribing') : t('voice.start');
  return (
    <button
      type="button"
      data-testid="mic-button"
      data-state={state}
      onClick={toggle}
      disabled={disabled || state === 'transcribing'}
      aria-label={label}
      title={label}
      aria-pressed={listening}
      className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-colors disabled:opacity-45 ${
        listening ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-fg'
      }`}
    >
      {listening && (
        <span
          className="absolute inset-0 rounded-full border-2 border-accent/50 transition-transform duration-100"
          style={{ transform: `scale(${1 + level * 0.45})` }}
          aria-hidden
        />
      )}
      {state === 'transcribing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
    </button>
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
