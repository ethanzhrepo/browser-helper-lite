import {
  Ban,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Hand,
  KeyRound,
  Loader2,
  Minus,
  Pause,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ALL_SITES_PATTERN, requestHostAccess } from '../../src/permissions/hosts';
import type { AgentAction, AgentClientMessage, AgentTask, ApprovalDecision, WaitReason } from '../../src/agent/types';
import { Button } from '../../src/ui/Button';

const clip = (text: string, limit = 60) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

export function actionLabel(t: TFunction, action: AgentAction): string {
  const a = action.args;
  const target = action.target ?? (a.index !== undefined ? `[${String(a.index)}]` : '');
  const values: Record<string, string> = {
    target,
    url: clip(String(a.url ?? ''), 70),
    text: clip(String(a.text ?? ''), 40),
    keys: String(a.keys ?? ''),
    option: String(a.option ?? ''),
    query: clip(String(a.query ?? ''), 60),
    question: clip(String(a.question ?? ''), 60),
    tab: String(a.tab_id ?? ''),
    seconds: String(a.seconds ?? ''),
    direction: a.direction === 'up' ? t('agent.directions.up') : t('agent.directions.down'),
  };
  const key = `agent.actions.${action.tool}`;
  return t(key, { ...values, defaultValue: action.tool });
}

function ActionIcon({ status }: { status: AgentAction['status'] }) {
  const className = 'mt-0.5 h-3.5 w-3.5 shrink-0';
  switch (status) {
    case 'running':
      return <Loader2 className={`${className} animate-spin text-accent`} />;
    case 'awaiting':
      return <Hand className={`${className} text-accent`} />;
    case 'done':
      return <Check className={`${className} text-success`} />;
    case 'error':
      return <X className={`${className} text-danger`} />;
    case 'rejected':
      return <Ban className={`${className} text-danger`} />;
    case 'skipped':
      return <Minus className={`${className} text-muted`} />;
  }
}

export function AgentRunView({ task, onSend }: { task: AgentTask; onSend: (message: AgentClientMessage) => void }) {
  const { t } = useTranslation();
  const active = task.status === 'running' || task.status === 'paused' || task.status === 'waiting';
  const [open, setOpen] = useState(true);
  const expanded = open || active;
  const actionCount = task.steps.reduce((n, step) => n + step.actions.length, 0);

  return (
    <div className="rounded-lg border border-line bg-bg text-sm" data-testid="agent-run" data-status={task.status}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={expanded}
      >
        {task.status === 'running' ? (
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
        ) : task.status === 'paused' ? (
          <Pause className="h-4 w-4 text-muted" />
        ) : task.status === 'waiting' ? (
          <Hand className="h-4 w-4 text-accent" />
        ) : task.status === 'failed' ? (
          <CircleAlert className="h-4 w-4 text-danger" />
        ) : (
          <Bot className="h-4 w-4 text-muted" />
        )}
        <span className="font-medium">{t(`agent.status.${task.status}`)}</span>
        <span className="text-xs text-muted">· {t('agent.actionCount', { count: actionCount })}</span>
        <span className="ml-auto rounded bg-subtle px-1.5 py-0.5 text-[10px] uppercase text-muted" title={t('agent.driverHint')}>
          {task.driver}
        </span>
        {!active && (expanded ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />)}
      </button>

      {expanded && task.steps.length > 0 && (
        <ol className="space-y-2 border-t border-line px-3 py-2">
          {task.steps.map((step) => (
            <li key={step.index} className="space-y-1">
              {step.thought && <p className="line-clamp-3 text-xs text-muted">{step.thought}</p>}
              {step.actions.map((action) => (
                <div key={action.id} className="flex items-start gap-1.5" data-testid="agent-action" data-tool={action.tool} data-status={action.status}>
                  <ActionIcon status={action.status} />
                  <div className="min-w-0">
                    <span className="break-words">{actionLabel(t, action)}</span>
                    {(action.status === 'error' || action.status === 'rejected') && action.result && (
                      <p className="text-xs text-muted">{clip(action.result, 160)}</p>
                    )}
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ol>
      )}

      {task.status === 'paused' && (
        <p className="border-t border-line px-3 py-2 text-xs text-muted">{t(`agent.overlay.paused.${task.pauseReason ?? 'user'}`)}</p>
      )}
      {task.waiting && <WaitingCard task={task} waiting={task.waiting} onSend={onSend} />}
    </div>
  );
}

function WaitingCard({ task, waiting, onSend }: {
  task: AgentTask;
  waiting: WaitReason;
  onSend: (message: AgentClientMessage) => void;
}) {
  const { t } = useTranslation();
  const respond = (response: Extract<AgentClientMessage, { type: 'respond' }>['response']) =>
    onSend({ type: 'respond', taskId: task.id, response });

  if (waiting.kind === 'approval') {
    const decide = (decision: ApprovalDecision) => respond({ kind: 'approval', decision });
    const action = task.steps.flatMap((step) => step.actions).find((a) => a.id === waiting.actionId);
    return (
      <div className="space-y-2 border-t border-line bg-accent-soft/50 px-3 py-3" data-testid="approval-card" role="alertdialog">
        <p className="flex items-center gap-1.5 font-medium">
          <ShieldAlert className={`h-4 w-4 ${waiting.risk >= 3 ? 'text-danger' : 'text-accent'}`} />
          {waiting.risk >= 3 ? t('agent.approval.titleHigh') : t('agent.approval.title')}
        </p>
        <p>
          {t('agent.approval.body', { site: waiting.site })}{' '}
          <strong>
            {actionLabel(t, action ?? { id: '', tool: waiting.tool, args: {}, target: waiting.target, risk: waiting.risk, status: 'awaiting' })}
          </strong>
        </p>
        <p className="text-xs text-muted">{t(`agent.approval.reason.${waiting.reason}`)}</p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="primary" onClick={() => decide('allowOnce')}>
            {t('agent.approval.allowOnce')}
          </Button>
          <Button onClick={() => decide('allowTask')}>{t('agent.approval.allowTask')}</Button>
          {waiting.risk < 3 && <Button onClick={() => decide('allowSite')}>{t('agent.approval.allowSite')}</Button>}
          <Button variant="danger" onClick={() => decide('deny')}>
            {t('agent.approval.deny')}
          </Button>
        </div>
      </div>
    );
  }

  if (waiting.kind === 'permission') {
    // requestHostAccess must run inside the click handler to keep the user gesture.
    const grant = (pattern: string) =>
      void requestHostAccess(pattern).then((granted) => respond({ kind: 'permission', granted }));
    return (
      <div className="space-y-2 border-t border-line bg-accent-soft/50 px-3 py-3" data-testid="permission-card" role="alertdialog">
        <p className="flex items-center gap-1.5 font-medium">
          <KeyRound className="h-4 w-4 text-accent" />
          {t('agent.permission.title')}
        </p>
        <p className="break-all">{t('agent.permission.body', { origin: waiting.origin })}</p>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="primary" onClick={() => grant(waiting.url)}>
            {t('agent.permission.allowSite')}
          </Button>
          <Button onClick={() => grant(ALL_SITES_PATTERN)}>{t('agent.permission.allowAll')}</Button>
          <Button variant="danger" onClick={() => respond({ kind: 'permission', granted: false })}>
            {t('agent.permission.deny')}
          </Button>
        </div>
      </div>
    );
  }

  if (waiting.kind === 'handoff') {
    return (
      <div className="space-y-2 border-t border-line bg-warning-soft px-3 py-3" data-testid="handoff-card" role="alertdialog">
        <p className="flex items-center gap-1.5 font-medium">
          <Hand className="h-4 w-4" />
          {t(`agent.handoff.title.${waiting.reason}`)}
        </p>
        <p>{waiting.message || t(`agent.handoff.${waiting.reason}`, { site: waiting.site })}</p>
        {waiting.reason === 'captcha' && <p className="text-xs text-muted">{t('agent.handoff.autoResume')}</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button variant="primary" onClick={() => respond({ kind: 'continue' })}>
            {t('agent.handoff.done')}
          </Button>
          <Button variant="danger" onClick={() => onSend({ type: 'stop', taskId: task.id })}>
            {t('agent.controls.stop')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1 border-t border-line bg-accent-soft/50 px-3 py-3" data-testid="question-card">
      <p className="font-medium">{t('agent.question.title')}</p>
      <p className="whitespace-pre-wrap">{waiting.question}</p>
      <p className="text-xs text-muted">{t('agent.question.hint')}</p>
    </div>
  );
}
