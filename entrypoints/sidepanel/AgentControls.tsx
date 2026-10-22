import { Hand, Pause, Play, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentClientMessage, AgentTask } from '../../src/agent/types';
import { Button } from '../../src/ui/Button';

/** Control bar shown above the composer while a task is active (§4.1). */
export function AgentControls({ task, onSend }: { task: AgentTask; onSend: (message: AgentClientMessage) => void }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const tokens = (task.usage.inputTokens ?? 0) + (task.usage.outputTokens ?? 0);
  const send = (type: 'pause' | 'resume' | 'stop' | 'takeOver') => onSend({ type, taskId: task.id });

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-subtle px-3 py-2" data-testid="agent-controls">
      {task.status === 'paused' ? (
        <Button onClick={() => send('resume')} className="px-2 py-1">
          <Play className="h-3.5 w-3.5" />
          {t('agent.controls.resume')}
        </Button>
      ) : (
        <Button onClick={() => send('pause')} disabled={task.status !== 'running'} className="px-2 py-1">
          <Pause className="h-3.5 w-3.5" />
          {t('agent.controls.pause')}
        </Button>
      )}
      <Button onClick={() => send('stop')} className="px-2 py-1">
        <Square className="h-3.5 w-3.5" />
        {t('agent.controls.stop')}
      </Button>
      <Button onClick={() => send('takeOver')} disabled={task.status === 'paused'} className="px-2 py-1">
        <Hand className="h-3.5 w-3.5" />
        {t('agent.controls.takeOver')}
      </Button>
      <span className="ml-auto text-xs text-muted">
        {t('agent.controls.progress', { step: task.steps.length, max: task.maxSteps })}
        {tokens > 0 && ` · ${t('agent.controls.tokens', { count: tokens, formatted: number.format(tokens) })}`}
      </span>
    </div>
  );
}
