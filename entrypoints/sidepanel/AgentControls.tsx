import { Hand, Pause, Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentClientMessage, AgentTask } from '../../src/agent/types';
import { Button } from '../../src/ui/Button';

const DOT: Record<string, string> = {
  running: 'bg-accent animate-pulse-dot',
  waiting: 'bg-warning animate-pulse-dot',
  paused: 'bg-faint',
};

/** Floating control bar above the composer while a task is active (§4.1). */
export function AgentControls({ task, onSend }: { task: AgentTask; onSend: (message: AgentClientMessage) => void }) {
  const { t } = useTranslation();
  const send = (type: 'pause' | 'resume' | 'stop' | 'takeOver') => onSend({ type, taskId: task.id });

  return (
    <div
      className="flex animate-fade-in items-center gap-1 rounded-xl border border-line bg-surface p-1 pl-3 shadow-card"
      data-testid="agent-controls"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[task.status] ?? 'bg-faint'}`} title={t(`agent.status.${task.status}`)} />
      <span className="mr-auto min-w-0 truncate pl-1 text-xs font-medium tabular-nums text-muted">
        {t('agent.controls.progress', { step: task.steps.length, max: task.maxSteps })}
      </span>
      {task.status === 'paused' ? (
        <Button size="sm" variant="soft" onClick={() => send('resume')}>
          <Play className="h-3.5 w-3.5" />
          {t('agent.controls.resume')}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => send('pause')} disabled={task.status !== 'running'}>
          <Pause className="h-3.5 w-3.5" />
          {t('agent.controls.pause')}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => send('takeOver')} disabled={task.status === 'paused'}>
        <Hand className="h-3.5 w-3.5" />
        {t('agent.controls.takeOver')}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => send('stop')} className="hover:bg-danger-soft hover:text-danger">
        <Square className="h-3 w-3" />
        {t('agent.controls.stop')}
      </Button>
    </div>
  );
}
