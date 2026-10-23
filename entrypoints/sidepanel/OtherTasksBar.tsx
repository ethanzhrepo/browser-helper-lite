import { ArrowRight, Hand, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { AgentTask } from '../../src/agent/types';

const clip = (text: string, limit = 48) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text);

/**
 * Turns of other tabs' conversations keep running while you look elsewhere;
 * this bar says so, and takes you there when one needs you.
 */
export function OtherTasksBar({ tasks, onShow }: { tasks: AgentTask[]; onShow: (task: AgentTask) => void }) {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;
  // The ones waiting for you first.
  const sorted = [...tasks].sort((a, b) => Number(Boolean(b.waiting)) - Number(Boolean(a.waiting)));
  return (
    <div className="space-y-1.5" data-testid="other-tasks">
      {sorted.map((task) => {
        const waiting = Boolean(task.waiting) || task.status === 'paused';
        return (
          <button
            key={task.id}
            type="button"
            onClick={() => onShow(task)}
            data-testid="other-task"
            data-status={task.status}
            className={`flex w-full animate-fade-in items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
              waiting ? 'border-warning/30 bg-warning-soft hover:border-warning/50' : 'border-line bg-surface hover:border-line-strong'
            }`}
          >
            {waiting ? <Hand className="h-3.5 w-3.5 shrink-0 text-warning" /> : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />}
            <span className="min-w-0 flex-1 truncate">
              {t(waiting ? 'tasks.waiting' : 'tasks.running', { title: clip(task.goal) })}
            </span>
            <span className="flex shrink-0 items-center gap-0.5 font-medium text-accent">
              {t('tasks.show')}
              <ArrowRight className="h-3 w-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
