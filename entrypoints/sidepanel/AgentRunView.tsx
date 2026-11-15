import {
  Ban,
  BookmarkPlus,
  Check,
  ChevronDown,
  CircleAlert,
  Hand,
  KeyRound,
  Loader2,
  MessageCircleQuestion,
  Minus,
  Pause,
  Play,
  ShieldAlert,
  ShieldX,
  Square,
  X,
  XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { commandFrom, commandName, outlineOf } from '../../src/agent/outline';
import { ALL_SITES_PATTERN, requestHostAccess } from '../../src/permissions/hosts';
import { newId } from '../../src/storage/db';
import { updateSettings } from '../../src/storage/settings';
import { formatInterval } from '../../src/watch/format';
import { clampSeconds, LIVE_BELOW_SECONDS, WATCH_INTERVALS } from '../../src/watch/watch';
import type { AgentAction, AgentClientMessage, AgentTask, ApprovalDecision, WaitReason } from '../../src/agent/types';
import { Button } from '../../src/ui/Button';
import { ReplayView } from './ReplayView';

const clip = (text: string, limit = 60) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

const hostOf = (url: unknown): string => {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

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
    condition: clip(String(a.condition ?? ''), 120),
    name: String(a.name ?? ''),
    path: String(a.path ?? ''),
    stage: clip(String(a.stage ?? ''), 60),
    site: hostOf(a.url),
    x: String(Math.round(Number(a.x ?? 0))),
    y: String(Math.round(Number(a.y ?? 0))),
    direction: a.direction === 'up' ? t('agent.directions.up') : t('agent.directions.down'),
  };
  // A key press says what it lands on, when something has the focus.
  const key = action.tool === 'press' && action.target ? 'agent.actions.pressOn' : `agent.actions.${action.tool}`;
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

const OPENING = new Set(['navigate', 'open_tab', 'read_url']);
const READING = new Set(['read_page', 'extract', 'look', 'view_page']);

/**
 * What the run is doing, in words a person cares about: what it searches for,
 * which site it is on. Waiting, clicking and scrolling are all "working on
 * the site"; the steps themselves are under the details.
 */
export function activityLabel(t: TFunction, task: AgentTask): string {
  const step = task.steps.at(-1);
  const action = step?.actions.at(-1);
  if (!action) return t('agent.thinking');
  if (action.tool === 'web_search') return t('agent.activity.search', { query: clip(String(action.args.query ?? ''), 50) });
  if (action.tool === 'research_pages') return t('agent.activity.research', { progress: action.target ?? '' }).trim();
  const site = OPENING.has(action.tool) ? hostOf(action.args.url) : hostOf(step?.url);
  if (OPENING.has(action.tool) && site) return t('agent.activity.open', { site });
  if (READING.has(action.tool)) return t('agent.activity.read');
  return site ? t('agent.activity.act', { site }) : t('agent.activity.actHere');
}

/** A finished run in a few words: how often it searched and how many sites it used. */
export function runSummary(t: TFunction, task: AgentTask): string {
  const actions = task.steps.flatMap((step) => step.actions).filter((action) => action.status === 'done');
  const searches = actions.filter((action) => action.tool === 'web_search').length;
  const sites = new Set(
    [...task.steps.filter((step) => step.actions.some((a) => a.tool !== 'web_search' && a.tool !== 'ask_user')).map((step) => hostOf(step.url)), ...actions.filter((a) => OPENING.has(a.tool)).map((a) => hostOf(a.args.url))].filter(Boolean),
  ).size;
  return [searches > 0 ? t('agent.summary.searches', { count: searches }) : '', sites > 0 ? t('agent.summary.sites', { count: sites }) : ''].filter(Boolean).join(' · ');
}

/** Saves a finished task as a command to run again by name. A command with the same name is replaced. */
function SaveCommand({ task, request }: { task: AgentTask; request: string }) {
  const { t } = useTranslation();
  const [name, setName] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const save = async () => {
    const clean = commandName(name ?? '');
    if (!clean) return;
    const command = commandFrom(task, request, clean, newId(), Date.now());
    await updateSettings((s) => ({ ...s, commands: [...s.commands.filter((c) => c.name !== clean), command] }));
    setName(undefined);
    setSaved(clean);
  };

  if (saved) {
    return (
      <span className="mr-auto flex items-center gap-1 px-1 text-xs text-success" role="status" data-testid="command-saved">
        <Check className="h-3.5 w-3.5 shrink-0" />
        {t('agent.save.saved', { name: saved })}
      </span>
    );
  }
  if (name === undefined) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setName(commandName(request.split('\n')[0]!.slice(0, 16)))} data-testid="save-command">
        <BookmarkPlus className="h-3.5 w-3.5" />
        {t('agent.save.button')}
      </Button>
    );
  }
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <span className="font-mono text-xs text-faint">/</span>
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && setName(undefined)}
        aria-label={t('agent.save.name')}
        placeholder={t('agent.save.name')}
        data-testid="command-name"
        className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-xs outline-none focus:border-accent/50"
      />
      <Button size="sm" variant="primary" type="submit" disabled={!commandName(name)}>
        {t('common.save')}
      </Button>
    </form>
  );
}

export function AgentRunView({ task, request, onSend }: {
  task: AgentTask;
  /** The request this turn answers, to save it as a command. */
  request?: string;
  onSend: (message: AgentClientMessage) => void;
}) {
  const { t } = useTranslation();
  const active = task.status === 'running' || task.status === 'paused' || task.status === 'waiting';
  // The steps (click, wait, scroll…) stay out of the way until asked for.
  const [open, setOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const canReplay = !active && task.steps.some((step) => step.shot);
  // A task that did something and finished can be kept, to run again by name.
  const canSave = task.status === 'done' && Boolean(request?.trim()) && outlineOf(task).length > 0;
  const actionCount = task.steps.reduce((n, step) => n + step.actions.length, 0);
  const status = STATUS_STYLE[task.status];
  const StatusIcon = status.icon;
  const openedTabs = task.openedTabs?.length ?? 0;
  const about = active ? activityLabel(t, task) : runSummary(t, task);
  const thought = active ? task.steps.at(-1)?.thought : undefined;

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
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-subtle/60"
        aria-expanded={open}
        title={t('agent.details')}
        data-testid="run-details"
      >
        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${status.tone}`}>
          <StatusIcon className={`h-3.5 w-3.5 ${status.spin ? 'animate-spin' : ''}`} strokeWidth={2.25} />
        </span>
        <span className="shrink-0 font-semibold tracking-tight">{t(`agent.status.${task.status}`)}</span>
        {active && task.stage && (
          <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent" data-testid="run-stage">
            {task.stage.step ? `${task.stage.step}${task.stage.of ? `/${task.stage.of}` : ''} ` : ''}
            {task.stage.name}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted" data-testid="run-activity">
          {about}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {thought && !open && <p className="-mt-1 line-clamp-2 px-3 pb-2.5 pl-[46px] text-xs leading-relaxed text-muted">{thought}</p>}

      {task.steps.length > 0 && (
        // Kept in the page while closed, so opening it is instant and nothing is re-read.
        <div hidden={!open} data-testid="run-steps">
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
                        {(action.tool === 'web_search' || action.tool === 'read_url' || action.tool === 'research_pages') && action.target && (
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
        <p className="flex items-center gap-2 px-3.5 pb-2.5 text-[11px] text-faint">
          {t('agent.actionCount', { count: actionCount })}
          {task.driver && (
            <span className="rounded-md border border-line px-1.5 py-px font-mono text-[10px] tracking-wide uppercase" title={t('agent.driverHint')} data-testid="driver-badge">
              {task.driver}
            </span>
          )}
        </p>
        </div>
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
      {!active && (openedTabs > 0 || canReplay || canSave) && (
        <div className="flex flex-wrap items-center justify-end gap-1 border-t border-line px-3 py-2">
          {canSave && <SaveCommand task={task} request={request!} />}
          {canReplay && (
            <Button size="sm" variant="ghost" onClick={() => setReplaying(true)} data-testid="replay-open">
              <Play className="h-3.5 w-3.5" />
              {t('agent.replay.open')}
            </Button>
          )}
          {openedTabs > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onSend({ type: 'closeTabs', taskId: task.id })}>
              <XCircle className="h-3.5 w-3.5" />
              {t('agent.closeTabs', { count: openedTabs })}
            </Button>
          )}
        </div>
      )}
      {/* Over the whole panel, not inside this card. */}
      {replaying && createPortal(<ReplayView task={task} onClose={() => setReplaying(false)} />, document.body)}
      {task.status === 'paused' && (
        <p className="flex items-center gap-2 border-t border-line bg-subtle/60 px-3.5 py-2.5 text-xs text-muted">
          <Pause className="h-3.5 w-3.5 shrink-0" />
          {t(`agent.overlay.paused.${task.pauseReason ?? 'user'}`)}
        </p>
      )}
      {task.waiting && (
        <WaitingCard key={task.waiting.kind === 'approval' ? task.waiting.actionId : task.waiting.kind} task={task} waiting={task.waiting} onSend={onSend} />
      )}
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

/** Approvals are ignored this long after a card appears. */
const APPROVAL_ARM_MS = 500;

const IS_MAC = /mac/i.test(navigator.platform);

/** A key hint on a button. */
function Key({ children }: { children: ReactNode }) {
  return <kbd className="ml-1.5 rounded border border-current/25 px-1 font-sans text-[10px] font-medium leading-4 opacity-70">{children}</kbd>;
}

/**
 * Enter and Escape answer the card that is showing. Not while you are writing
 * something, and not while a button or a link has the focus: there the key
 * already means something else.
 */
function useCardKeys(keys: { enter?: (event: KeyboardEvent) => boolean; escape?: () => void }) {
  const latest = useRef(keys);
  latest.current = keys;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const focused = document.activeElement;
      const writing = (focused instanceof HTMLTextAreaElement || focused instanceof HTMLInputElement) && focused.value !== '';
      const onControl = focused instanceof HTMLButtonElement || focused instanceof HTMLAnchorElement || focused instanceof HTMLSelectElement;
      if (writing || (focused as HTMLElement | null)?.isContentEditable) return;
      let handled = false;
      if (event.key === 'Escape' && latest.current.escape) {
        latest.current.escape();
        handled = true;
      } else if (event.key === 'Enter' && !event.shiftKey && !event.altKey && !onControl && latest.current.enter) {
        handled = latest.current.enter(event);
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Capture: before the message box sees the key.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}

function WaitingCard({ task, waiting, onSend }: {
  task: AgentTask;
  waiting: WaitReason;
  onSend: (message: AgentClientMessage) => void;
}) {
  const { t } = useTranslation();
  // Allow buttons wake up shortly after a card appears, so a click meant for the previous card cannot approve this one.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), APPROVAL_ARM_MS);
    return () => clearTimeout(timer);
  }, []);
  const respond = (response: Extract<AgentClientMessage, { type: 'respond' }>['response']) =>
    onSend({ type: 'respond', taskId: task.id, response });

  const approval = waiting.kind === 'approval' ? waiting : undefined;
  // A watch: how often to look is the user's to say, on the card.
  const watched = approval?.reason === 'watch' ? task.steps.flatMap((step) => step.actions).find((a) => a.id === approval.actionId) : undefined;
  const [everySeconds, setEverySeconds] = useState(() => clampSeconds(watched?.args.every_seconds));
  const highRisk = Boolean(approval) && (approval!.risk >= 3 || ['injection', 'exfiltration', 'secret'].includes(approval!.reason));
  const grantSite = () => {
    if (waiting.kind !== 'permission') return;
    // requestHostAccess must run inside the click or key handler to keep the user gesture.
    void requestHostAccess(waiting.url).then((granted) => respond({ kind: 'permission', granted }));
  };
  useCardKeys({
    enter: (event) => {
      if (approval) {
        // A high-risk step takes a deliberate key combination, never a stray Enter.
        if (!armed || (highRisk && !(event.metaKey || event.ctrlKey))) return false;
        respond({ kind: 'approval', actionId: approval.actionId, decision: 'allowOnce', ...(watched ? { everySeconds } : {}) });
      } else if (waiting.kind === 'permission') grantSite();
      else if (waiting.kind === 'handoff') respond({ kind: 'continue' });
      else return false;
      return true;
    },
    escape:
      approval
        ? () => respond({ kind: 'approval', actionId: approval.actionId, decision: 'deny' })
        : waiting.kind === 'permission'
          ? () => respond({ kind: 'permission', granted: false })
          : undefined,
  });

  if (waiting.kind === 'approval') {
    const decide = (decision: ApprovalDecision) => respond({ kind: 'approval', actionId: waiting.actionId, decision, ...(watched ? { everySeconds } : {}) });
    const paces = [...new Set([...WATCH_INTERVALS, everySeconds])].sort((a, b) => a - b);
    const action = task.steps.flatMap((step) => step.actions).find((a) => a.id === waiting.actionId);
    // Trusting a whole site makes no sense when the page itself is the problem.
    const suspicious = waiting.reason === 'injection' || waiting.reason === 'exfiltration' || waiting.reason === 'secret';
    const high = waiting.risk >= 3 || suspicious;
    // Site-wide trust makes no sense for these; high-risk steps are approved one at a time (§8.1).
    const oneByOne = waiting.reason === 'exfiltration' || waiting.reason === 'secret' || waiting.reason === 'sensitivePage';
    // Nor for clicks on drawn content: each task's are judged by eye.
    const canAllowSite = waiting.risk < 3 && !suspicious && !oneByOne && !['newSite', 'download', 'unseen', 'watch', 'social'].includes(waiting.reason);
    const canAllowTask = waiting.risk < 3 && !oneByOne && waiting.reason !== 'watch';
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
          {/* Where a click by coordinates lands. Our own screenshot, as a data URL: nothing is loaded. */}
          {waiting.preview?.startsWith('data:image/jpeg;base64,') && (
            <figure className="overflow-hidden rounded-lg border border-line bg-surface" data-testid="approval-preview">
              <img src={waiting.preview} alt="" className="block w-full" />
              <figcaption className="px-3 py-1.5 text-[11px] text-muted">{t('agent.approval.preview')}</figcaption>
            </figure>
          )}
          {/* "Press Enter" alone does not say what happens: name the form it sends. */}
          {waiting.submits !== undefined && (
            <p className="rounded-lg bg-subtle px-3 py-2 text-xs leading-relaxed text-fg" data-testid="approval-submits">
              {waiting.submits ? t('agent.approval.submits', { button: clip(waiting.submits, 80) }) : t('agent.approval.submitsForm')}
            </p>
          )}
          {watched && (
            <label className="flex items-center justify-between gap-3 rounded-lg bg-subtle px-3 py-2 text-xs">
              <span className="font-medium text-fg">{t('watch.pace')}</span>
              <select
                value={everySeconds}
                onChange={(event) => setEverySeconds(Number(event.target.value))}
                data-testid="watch-pace"
                className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-fg outline-none focus:border-accent/50"
              >
                {paces.map((seconds) => (
                  <option key={seconds} value={seconds}>
                    {formatInterval(t, seconds)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-muted">
            {t(`agent.approval.reason.${waiting.reason}`)}
            {watched && everySeconds < LIVE_BELOW_SECONDS && <> {t('watch.liveHint')}</>}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="primary" disabled={!armed} onClick={() => decide('allowOnce')}>
            {t('agent.approval.allowOnce')}
            <Key>{high ? `${IS_MAC ? '⌘' : 'Ctrl'} ↵` : '↵'}</Key>
          </Button>
          <Button variant="danger" onClick={() => decide('deny')}>
            {t('agent.approval.deny')}
            <Key>Esc</Key>
          </Button>
          {canAllowTask && (
            <Button disabled={!armed} onClick={() => decide('allowTask')} className={canAllowSite ? '' : 'col-span-2'}>
              {t('agent.approval.allowTask')}
            </Button>
          )}
          {canAllowSite && (
            <Button disabled={!armed} onClick={() => decide('allowSite')}>
              {t('agent.approval.allowSite')}
            </Button>
          )}
        </div>
      </CardShell>
    );
  }

  if (waiting.kind === 'permission') {
    return (
      <CardShell tone="accent" icon={KeyRound} title={t('agent.permission.title')} testId="permission-card">
        <p className="break-all text-[13px] leading-relaxed">{t('agent.permission.body', { origin: waiting.origin })}</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="primary" onClick={grantSite}>
            {t('agent.permission.allowSite')}
            <Key>↵</Key>
          </Button>
          <Button variant="danger" onClick={() => respond({ kind: 'permission', granted: false })}>
            {t('agent.permission.deny')}
            <Key>Esc</Key>
          </Button>
          {/* After an injection attempt, access is granted one site at a time. */}
          {!task.injection && (
            <Button
              onClick={() => void requestHostAccess(ALL_SITES_PATTERN).then((granted) => respond({ kind: 'permission', granted }))}
              className="col-span-2"
            >
              {t('agent.permission.allowAll')}
            </Button>
          )}
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
            <Key>↵</Key>
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
