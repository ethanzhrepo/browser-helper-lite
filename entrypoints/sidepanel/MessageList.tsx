import { AlertTriangle, ArrowDown, ArrowUp, Brain, Check, ChevronRight, Copy, FileText, Pencil, RotateCcw, Settings2, Square, TextQuote } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ACTIVE_STATUSES, type AgentClientMessage, type AgentTask } from '../../src/agent/types';
import type { ContextSnapshot, ErrorInfo, MessageRecord, Usage } from '../../src/shared/types';
import { Button, IconButton } from '../../src/ui/Button';
import { errorSummary, isSettingsError } from '../../src/ui/errors';
import { Markdown } from '../../src/ui/Markdown';
import { openOptions } from '../../src/ui/navigation';
import { AgentRunView } from './AgentRunView';

/** After which message each turn's view goes: its anchor, or a later answer to one of its questions. */
function turnPositions(messages: MessageRecord[], tasks: AgentTask[]): Map<string, AgentTask[]> {
  const ids = new Set(messages.map((m) => m.id));
  const positions = new Map<string, AgentTask[]>();
  for (const task of tasks) {
    let after = task.anchorMessageId && ids.has(task.anchorMessageId) ? task.anchorMessageId : undefined;
    for (const message of messages) {
      if (message.role === 'user' && message.taskId === task.id && (!after || message.id > after)) after = message.id;
    }
    if (after) positions.set(after, [...(positions.get(after) ?? []), task].sort((a, b) => a.createdAt - b.createdAt));
  }
  return positions;
}

export function MessageList({ messages, tasks, pendingTaskId, canChange, onRetry, onRegenerate, onEdit, onAgentSend }: {
  messages: MessageRecord[];
  tasks: Record<string, AgentTask>;
  /** A request was sent and its turn has not reported back yet. */
  pendingTaskId?: string;
  /** A model is set and nothing is running: replies can be redone and requests edited. */
  canChange: boolean;
  /** Another reply after one that failed or was stopped. */
  onRetry: () => void;
  /** Replaces the last reply with a new one. */
  onRegenerate: () => void;
  /** Sends a request again with new text; it and everything after it is replaced. */
  onEdit: (message: MessageRecord, text: string) => void;
  onAgentSend: (message: AgentClientMessage) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [away, setAway] = useState(false);

  // Follow new content unless the user has scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, tasks, pendingTaskId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 240);
  };

  const toLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const conversationId = messages[0]?.conversationId;
  const conversationTasks = Object.values(tasks).filter((task) => task.conversationId === conversationId);
  const active = conversationTasks.some((task) => ACTIVE_STATUSES.includes(task.status));
  const last = messages.at(-1);
  const idle = canChange && !active && !pendingTaskId;
  const positions = turnPositions(messages, conversationTasks);
  const replied = new Set(messages.filter((m) => m.role === 'assistant' && m.taskId).map((m) => m.taskId));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3.5 pb-2 pt-5" data-testid="message-list">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {messages.map((message) => (
            <Fragment key={message.id}>
              {message.role === 'user' ? (
                <UserMessage message={message} onEdit={idle ? (text) => onEdit(message, text) : undefined} />
              ) : (
                <AssistantMessage
                  content={message.content}
                  reasoning={message.reasoning}
                  modelId={message.model?.modelId}
                  usage={message.usage}
                  aborted={message.status === 'aborted'}
                  error={message.status === 'error' ? message.error : undefined}
                  // A reply that failed or was stopped stays and gets another try; a finished one is replaced.
                  redo={idle && message.id === last?.id ? (message.status === 'done' ? { kind: 'regenerate', run: onRegenerate } : { kind: 'retry', run: onRetry }) : undefined}
                />
              )}
              {positions.get(message.id)?.map((task) => (
                <TurnView key={task.id} task={task} replied={replied.has(task.id)} onSend={onAgentSend} />
              ))}
            </Fragment>
          ))}
          {pendingTaskId && !tasks[pendingTaskId] && <AssistantMessage content="" streaming />}
        </div>
      </div>
      {away && (
        <button
          type="button"
          onClick={toLatest}
          aria-label={t('message.toLatest')}
          title={t('message.toLatest')}
          data-testid="to-latest"
          className="absolute bottom-2 left-1/2 flex h-8 w-8 -translate-x-1/2 animate-fade-in items-center justify-center rounded-full border border-line bg-surface text-muted shadow-card transition-colors hover:text-fg"
        >
          <ArrowDown className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/** A turn in progress: its tool steps, then the reply as it streams in. */
function TurnView({ task, replied, onSend }: { task: AgentTask; replied: boolean; onSend: (message: AgentClientMessage) => void }) {
  const active = ACTIVE_STATUSES.includes(task.status);
  const hasActions = task.steps.some((step) => step.actions.length > 0);
  return (
    <>
      {hasActions && <AgentRunView task={task} onSend={onSend} />}
      {!replied && (task.draft || (active && !task.waiting)) && (
        // A finished turn without a stored reply was cut off (e.g. the extension restarted).
        <AssistantMessage content={task.draft} modelId={task.model.modelId} streaming={active} aborted={!active && task.status !== 'done'} />
      )}
    </>
  );
}

function ContextChip({ context }: { context: ContextSnapshot }) {
  const { t } = useTranslation();
  const Icon = context.kind === 'page' ? FileText : TextQuote;
  const label = context.kind === 'page' ? context.title || context.url : `“${context.content.slice(0, 60)}”`;
  return (
    <a
      href={context.url}
      target="_blank"
      rel="noreferrer"
      title={context.url}
      className="flex max-w-[85%] items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted shadow-soft transition-colors hover:border-line-strong hover:text-fg"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-accent" />
      <span className="truncate">{label}</span>
      {context.truncated && <span className="shrink-0 text-faint">· {t('message.truncated')}</span>}
    </a>
  );
}

function UserMessage({ message, onEdit }: { message: MessageRecord; onEdit?: (text: string) => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string>();
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || draft === undefined) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [draft]);

  const submit = () => {
    const text = (draft ?? '').trim();
    if (!text || !onEdit) return;
    setDraft(undefined);
    onEdit(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(undefined);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="group flex animate-fade-in flex-col items-end gap-1.5" data-testid="user-message">
      {message.contexts?.map((context) => <ContextChip key={`${context.kind}-${context.capturedAt}`} context={context} />)}
      {draft === undefined ? (
        <>
          <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-sm leading-relaxed text-fg">
            {message.content}
          </div>
          {onEdit && (
            <IconButton
              label={t('common.edit')}
              onClick={() => setDraft(message.content)}
              data-testid="edit-message"
              className="-mt-1 h-7 w-7 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </>
      ) : (
        <div className="w-full rounded-2xl border border-accent/40 bg-surface p-2 shadow-soft">
          <textarea
            ref={editorRef}
            autoFocus
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            data-testid="edit-input"
            className="block w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-relaxed text-fg outline-none"
          />
          <div className="mt-1 flex items-center gap-1.5">
            <span className="mr-auto pl-1.5 text-xs text-faint">{t('message.editHint')}</span>
            <Button size="sm" variant="ghost" onClick={() => setDraft(undefined)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={submit} disabled={!draft.trim()} data-testid="edit-send">
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />
              {t('composer.send')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 1234 → "1.2k": enough to see what a reply cost. */
function compact(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(count >= 10_000 ? 0 : 1)}k` : String(count);
}

function AssistantMessage({ content, reasoning, modelId, usage, streaming, aborted, error, redo }: {
  content: string;
  reasoning?: string;
  modelId?: string;
  usage?: Usage;
  streaming?: boolean;
  aborted?: boolean;
  error?: ErrorInfo;
  redo?: { kind: 'retry' | 'regenerate'; run: () => void };
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const used = (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0);
  const tokens = used > 0 ? t('message.tokens', { input: compact(usage?.inputTokens ?? 0), output: compact(usage?.outputTokens ?? 0) }) : '';

  return (
    <div className="group flex animate-fade-in flex-col gap-2 text-sm text-fg" data-testid="assistant-message">
      {reasoning && (
        <details className="group/reasoning rounded-xl bg-subtle px-3 py-2 text-xs text-muted" open={streaming && !content}>
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium select-none [&::-webkit-details-marker]:hidden">
            <Brain className="h-3.5 w-3.5" />
            {t('message.reasoning')}
            <ChevronRight className="h-3.5 w-3.5 transition-transform group-open/reasoning:rotate-90" />
          </summary>
          <div className="mt-2 whitespace-pre-wrap leading-relaxed">{reasoning}</div>
        </details>
      )}
      {content && <Markdown text={content} streaming={streaming} />}
      {streaming && !content && !reasoning && (
        <div className="flex gap-1 py-1.5" aria-label={t('message.thinking')}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" style={{ animationDelay: `${i * 180}ms` }} />
          ))}
        </div>
      )}
      {error && <ErrorCard error={error} />}
      {aborted && (
        <p className="flex items-center gap-1 text-xs text-faint">
          <Square className="h-3 w-3" />
          {t('message.stopped')}
        </p>
      )}
      {!streaming && (
        <div className="-ml-1.5 flex items-center gap-0.5 text-xs text-faint">
          {content && (
            <IconButton label={copied ? t('message.copied') : t('message.copy')} onClick={() => void copy()} className="h-7 w-7">
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            </IconButton>
          )}
          {redo && (
            <IconButton label={t(`message.${redo.kind}`)} onClick={redo.run} className="h-7 w-7" data-testid={redo.kind}>
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
          )}
          <span className="ml-1 flex min-w-0 gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            {modelId && <span className="truncate">{modelId}</span>}
            {tokens && (
              <span className="shrink-0 tabular-nums" title={t('message.tokensHint')} data-testid="usage">
                {tokens}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

function ErrorCard({ error }: { error: ErrorInfo }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3" role="alert">
      <p className="flex items-start gap-2 font-medium text-danger">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        {errorSummary(t, error)}
      </p>
      {error.message && <p className="mt-1.5 break-all pl-6 font-mono text-[11px] leading-relaxed text-muted">{error.message}</p>}
      {isSettingsError(error) && (
        <Button size="sm" className="ml-6 mt-2.5" onClick={() => openOptions('providers')}>
          <Settings2 className="h-3.5 w-3.5" />
          {t('common.openSettings')}
        </Button>
      )}
    </div>
  );
}
