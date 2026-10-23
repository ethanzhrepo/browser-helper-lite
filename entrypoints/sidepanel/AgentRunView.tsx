import {
  Ban,
  Check,
  ChevronDown,
  CircleAlert,
  Hand,
  KeyRound,
  Loader2,
  MessageCircleQuestion,
  Minus,
  Pause,
  ShieldAlert,
  ShieldX,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
  const className = 'mt-[3px] h-3.5 w-3.5 shrink-0';
  switch (status) {
    case 'running':
      return <Loader2 className={`${className} animate-spin text-accent`} />;
    case 'awaiting':
      return <Hand className={`${className} text-warning`} />;
    case 'done':
      return <Check className={`${className} text-success`} strokeWidth={2.5} />;
    case 'error':
      return <X className={`${className} text-danger`} strokeWidth={2.5} />;
    case 'rejected':
      return <Ban className={`${className} text-danger`} />;
    case 'skipped':
      return <Minus className={`${className} text-faint`} />;
  }
}

const STATUS_STYLE: Record<AgentTask['status'], { icon: typeof Check; tone: string; spin?: boolean }> = {
  running: { icon: Loader2, tone: 'bg-accent-soft text-accent', spin: true },
  waiting: { icon: Hand, tone: 'bg-warning-soft text-warning' },
  paused: { icon: Pause, tone: 'bg-subtle text-muted' },
  done: { icon: Check, tone: 'bg-success-soft text-success' },
  failed: { icon: CircleAlert, tone: 'bg-danger-soft text-danger' },
  stopped: { icon: Square, tone: 'bg-subtle text-muted' },
};

export function AgentRunView({ task, onSend }: { task: AgentTask; onSend: (message: AgentClientMessage) => void }) {
  const { t } = useTranslation();
  const active = task.status === 'running' || task.status === 'paused' || task.status === 'waiting';
  // Runs that were already finished when shown start collapsed; live runs stay open.
  const [open, setOpen] = useState(active);
  const expanded = open || active;
  const actionCount = task.steps.reduce((n, step) => n + step.actions.length, 0);
  const status = STATUS_STYLE[task.status];
  const StatusIcon = status.icon;
  const openedTabs = task.openedTabs?.length ?? 0;

  return (
    <div
      className="animate-fade-in overflow-hidden rounded-xl border border-line bg-surface text-sm shadow-soft"
      data-testid="agent-run"
      data-status={task.status}
    >
      {task.status === 'running' && <div className="h-0.5 progress-shimmer" aria-hidden />}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={active}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left enabled:hover:bg-subtle/60"
        aria-expanded={expanded}
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${status.tone}`}>
          <StatusIcon className={`h-3.5 w-3.5 ${status.spin ? 'animate-spin' : ''}`} strokeWidth={2.25} />
        </span>
        <span className="font-semibold tracking-tight">{t(`agent.status.${task.status}`)}</span>
        <span className="text-xs text-faint">{t('agent.actionCount', { count: actionCount })}</span>
        <span className="ml-auto" />
        {task.driver && (
          <span
            className="rounded-md border border-line px-1.5 py-px font-mono text-[10px] tracking-wide text-faint uppercase"
            title={t('agent.driverHint')}
            data-testid="driver-badge"
          >
            {task.driver}
          </span>
        )}
        {!active && <ChevronDown className={`h-4 w-4 text-faint transition-transform ${expanded ? 'rotate-180' : ''}`} />}
      </button>

      {expanded && task.steps.length > 0 && (
        <ol className="relative mx-3 mb-3 ml-[23px] space-y-3 border-l border-line pl-4">
          {task.steps.map((step, i) => {
            const current = active && i === task.steps.length - 1;
            const failed = step.actions.some((a) => a.status === 'error' || a.status === 'rejected');
            return (
              <li key={step.index} className="relative">
                <span
                  className={`absolute -left-[21px] top-[5px] h-2.5 w-2.5 rounded-full ring-4 ring-surface ${
                    current ? 'bg-accent animate-pulse-dot' : failed ? 'bg-danger' : 'bg-line-strong'
                  }`}
                />
                {step.thought && <p className="mb-1 line-clamp-3 text-xs leading-relaxed text-muted">{step.thought}</p>}
                <div className="space-y-1">
                  {step.actions.map((action) => (
                    <div
                      key={action.id}
                      className="flex items-start gap-2"
                      data-testid="agent-action"
                      data-tool={action.tool}
                      data-status={action.status}
                    >
                      <ActionIcon status={action.status} />
                      <div className="min-w-0 leading-snug">
                        <span
                          className={`break-words text-[13px] ${
                            action.status === 'awaiting' ? 'font-medium text-fg' : action.status === 'skipped' ? 'text-faint' : 'text-fg'
                          }`}
                        >
                          {actionLabel(t, action)}
                        </span>
                        {action.tool === 'web_search' && action.target && (
                          <span className="ml-1.5 rounded bg-subtle px-1 py-px text-[10px] text-faint">{action.target}</span>
                        )}
                        {(action.status === 'error' || action.status === 'rejected') && action.result && (
                          <p className="mt-0.5 text-xs text-muted">{clip(action.result, 160)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {step.actions.length === 0 && current && (
                    <div className="flex items-center gap-2 text-xs text-faint">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('agent.thinking')}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {task.injection && (
        <div className="space-y-1 border-t border-danger/20 bg-danger-soft px-3.5 py-2.5 text-xs" data-testid="injection-warning" role="alert">
          <p className="flex items-center gap-1.5 font-semibold text-danger">
            <ShieldX className="h-3.5 w-3.5 shrink-0" />
            {t(task.injection.hidden ? 'agent.injection.titleHidden' : 'agent.injection.title')}
          </p>
          <p className="leading-relaxed text-fg">{t('agent.injection.body')}</p>
          <p className="break-words font-mono text-[11px] leading-relaxed text-muted">“{task.injection.excerpt}”</p>
        </div>
      )}
      {!active && openedTabs > 0 && expanded && (
        <div className="flex justify-end border-t border-line px-3 py-2">
          <Button size="sm" variant="ghost" onClick={() => onSend({ type: 'closeTabs', taskId: task.id })}>
            <XCircle className="h-3.5 w-3.5" />
            {t('agent.closeTabs', { count: openedTabs })}
          </Button>
        </div>
      )}
      {task.status === 'paused' && (
        <p className="flex items-center gap-2 border-t border-line bg-subtle/60 px-3.5 py-2.5 text-xs text-muted">
          <Pause className="h-3.5 w-3.5 shrink-0" />
          {t(`agent.overlay.paused.${task.pauseReason ?? 'user'}`)}
        </p>
      )}
      {task.waiting && <WaitingCard task={task} waiting={task.waiting} onSend={onSend} />}
    </div>
  );
}

function CardShell({ tone, icon, title, children, testId }: {
  tone: 'accent' | 'warning' | 'danger';
  icon: typeof Check;
  title: string;
  children: ReactNode;
  testId: string;
}) {
  const Icon = icon;
  const tones = {
    accent: { box: 'bg-accent-soft/60', badge: 'bg-accent text-on-accent' },
    warning: { box: 'bg-warning-soft', badge: 'bg-warning text-white' },
    danger: { box: 'bg-danger-soft', badge: 'bg-danger text-white' },
  }[tone];
  return (
    <div className={`animate-fade-in space-y-2.5 border-t border-line px-3.5 py-3.5 ${tones.box}`} data-testid={testId} role="alertdialog">
      <p className="flex items-center gap-2 font-semibold tracking-tight">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tones.badge}`}>
          <Icon className="h-3 w-3" strokeWidth={2.5} />
        </span>
        {title}
      </p>
      {children}
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
    // Trusting a whole site makes no sense when the page itself is the problem.
    const suspicious = waiting.reason === 'injection' || waiting.reason === 'exfiltration';
    const high = waiting.risk >= 3 || suspicious;
    // Site-wide trust makes no sense for these; high-risk steps are approved one at a time (§8.1).
    const canAllowSite = waiting.risk < 3 && !suspicious && waiting.reason !== 'newSite';
    const canAllowTask = waiting.risk < 3 && waiting.reason !== 'exfiltration';
    const typed = action?.tool === 'type' ? String(action.args.text ?? '') : '';
    const fullUrl = action?.tool === 'navigate' || action?.tool === 'open_tab' ? String(action.args.url ?? '') : '';
    return (
      <CardShell
        tone={high ? 'danger' : 'accent'}
        icon={ShieldAlert}
        title={suspicious ? t('agent.approval.titleSuspicious') : high ? t('agent.approval.titleHigh') : t('agent.approval.title')}
        testId="approval-card"
      >
        <div className="space-y-1">
          <p className="text-xs text-muted">{t('agent.approval.body', { site: waiting.site })}</p>
          <p className="rounded-lg border border-line bg-surface px-3 py-2 font-medium leading-snug shadow-soft">
            {actionLabel(t, action ?? { id: '', tool: waiting.tool, args: {}, target: waiting.target, risk: waiting.risk, status: 'awaiting' })}
          </p>
          {/* The whole text or address, so nothing is approved unseen. */}
          {(typed || fullUrl) && (
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded-lg bg-subtle px-3 py-2 font-mono text-[11px] leading-relaxed text-muted" data-testid="approval-detail">
              {clip(typed || fullUrl, 1000)}
            </p>
          )}
          <p className="text-xs text-muted">{t(`agent.approval.reason.${waiting.reason}`)}</p>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="primary" onClick={() => decide('allowOnce')}>
            {t('agent.approval.allowOnce')}
          </Button>
          <Button variant="danger" onClick={() => decide('deny')}>
            {t('agent.approval.deny')}
          </Button>
          {canAllowTask && (
            <Button onClick={() => decide('allowTask')} className={canAllowSite ? '' : 'col-span-2'}>
              {t('agent.approval.allowTask')}
            </Button>
          )}
          {canAllowSite && <Button onClick={() => decide('allowSite')}>{t('agent.approval.allowSite')}</Button>}
        </div>
      </CardShell>
    );
  }

  if (waiting.kind === 'permission') {
    // requestHostAccess must run inside the click handler to keep the user gesture.
    const grant = (pattern: string) =>
      void requestHostAccess(pattern).then((granted) => respond({ kind: 'permission', granted }));
    return (
      <CardShell tone="accent" icon={KeyRound} title={t('agent.permission.title')} testId="permission-card">
        <p className="break-all text-[13px] leading-relaxed">{t('agent.permission.body', { origin: waiting.origin })}</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="primary" onClick={() => grant(waiting.url)}>
            {t('agent.permission.allowSite')}
          </Button>
          <Button variant="danger" onClick={() => respond({ kind: 'permission', granted: false })}>
            {t('agent.permission.deny')}
          </Button>
          <Button onClick={() => grant(ALL_SITES_PATTERN)} className="col-span-2">
            {t('agent.permission.allowAll')}
          </Button>
        </div>
      </CardShell>
    );
  }

  if (waiting.kind === 'handoff') {
    return (
      <CardShell tone="warning" icon={Hand} title={t(`agent.handoff.title.${waiting.reason}`)} testId="handoff-card">
        <p className="text-[13px] leading-relaxed">{waiting.message || t(`agent.handoff.${waiting.reason}`, { site: waiting.site })}</p>
        {waiting.reason === 'captcha' && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            {t('agent.handoff.autoResume')}
          </p>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="primary" onClick={() => respond({ kind: 'continue' })}>
            {t('agent.handoff.done')}
          </Button>
          <Button variant="danger" onClick={() => onSend({ type: 'stop', taskId: task.id })}>
            {t('agent.controls.stop')}
          </Button>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell tone="accent" icon={MessageCircleQuestion} title={t('agent.question.title')} testId="question-card">
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{waiting.question}</p>
      <p className="text-xs text-muted">{t('agent.question.hint')}</p>
      <p className="text-xs text-muted">{t('agent.question.noSecrets')}</p>
    </CardShell>
  );
}
