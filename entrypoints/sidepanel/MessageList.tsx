import { AlertTriangle, Check, Copy, FileText, RotateCcw, Settings2, TextQuote } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StreamingReply } from '../../src/chat/useChatSession';
import type { ContextSnapshot, ErrorInfo, MessageRecord } from '../../src/shared/types';
import { Button, IconButton } from '../../src/ui/Button';
import { errorSummary, isSettingsError } from '../../src/ui/errors';
import { Markdown } from '../../src/ui/Markdown';
import { openOptions } from '../../src/ui/navigation';

export function MessageList({ messages, streaming, onRetry }: {
  messages: MessageRecord[];
  streaming?: StreamingReply;
  onRetry: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow new content unless the user has scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const last = messages.at(-1);
  const canRetry = !streaming && last?.role === 'assistant' && last.status !== 'done';

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-4" data-testid="message-list">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {messages.map((message) =>
          message.role === 'user' ? (
            <UserMessage key={message.id} message={message} />
          ) : (
            <AssistantMessage
              key={message.id}
              content={message.content}
              reasoning={message.reasoning}
              modelId={message.model?.modelId}
              aborted={message.status === 'aborted'}
              error={message.status === 'error' ? message.error : undefined}
              onRetry={canRetry && message.id === last?.id ? onRetry : undefined}
            />
          ),
        )}
        {streaming && (
          <AssistantMessage
            content={streaming.content}
            reasoning={streaming.reasoning}
            modelId={streaming.model.modelId}
            streaming
          />
        )}
      </div>
    </div>
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
      className="flex max-w-full items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-1 text-xs text-muted hover:text-fg"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
      {context.truncated && <span className="shrink-0">· {t('message.truncated')}</span>}
    </a>
  );
}

function UserMessage({ message }: { message: MessageRecord }) {
  return (
    <div className="flex flex-col items-end gap-1.5" data-testid="user-message">
      {message.contexts?.map((context) => <ContextChip key={`${context.kind}-${context.capturedAt}`} context={context} />)}
      <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-subtle px-3.5 py-2 text-sm">
        {message.content}
      </div>
    </div>
  );
}

function AssistantMessage({ content, reasoning, modelId, streaming, aborted, error, onRetry }: {
  content: string;
  reasoning?: string;
  modelId?: string;
  streaming?: boolean;
  aborted?: boolean;
  error?: ErrorInfo;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group flex flex-col gap-2 text-sm" data-testid="assistant-message">
      {reasoning && (
        <details className="rounded-md border border-line px-3 py-2 text-xs text-muted" open={streaming && !content}>
          <summary className="cursor-pointer select-none">{t('message.reasoning')}</summary>
          <div className="mt-2 whitespace-pre-wrap">{reasoning}</div>
        </details>
      )}
      {content && <Markdown text={content} />}
      {streaming && !content && !reasoning && (
        <div className="flex gap-1 py-1" aria-label={t('message.thinking')}>
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </div>
      )}
      {error && <ErrorCard error={error} />}
      {aborted && <p className="text-xs text-muted">{t('message.stopped')}</p>}
      {!streaming && (
        <div className="flex items-center gap-1 text-xs text-muted">
          {modelId && <span className="mr-1 truncate">{modelId}</span>}
          {content && (
            <IconButton label={copied ? t('message.copied') : t('message.copy')} onClick={() => void copy()} className="h-7 w-7">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </IconButton>
          )}
          {onRetry && (
            <IconButton label={t('message.retry')} onClick={onRetry} className="h-7 w-7">
              <RotateCcw className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
      )}
    </div>
  );
}

function ErrorCard({ error }: { error: ErrorInfo }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2" role="alert">
      <p className="flex items-center gap-1.5 font-medium text-danger">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {errorSummary(t, error)}
      </p>
      {error.message && <p className="mt-1 break-all font-mono text-xs text-muted">{error.message}</p>}
      {isSettingsError(error) && (
        <Button className="mt-2" onClick={() => openOptions('providers')}>
          <Settings2 className="h-4 w-4" />
          {t('common.openSettings')}
        </Button>
      )}
    </div>
  );
}
