import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentTask, StepShot } from '../../src/agent/types';
import { getShots } from '../../src/storage/db';
import { IconButton } from '../../src/ui/Button';
import { actionLabel } from './AgentRunView';

/** How long a picture stays while playing. */
const FRAME_MS = 1800;

/**
 * A finished task, picture by picture: the page before each step with a ring
 * where the assistant clicked, and what it did there. The pictures are small
 * screenshots kept on this device (Settings › Agent).
 */
export function ReplayView({ task, onClose }: { task: AgentTask; onClose: () => void }) {
  const { t } = useTranslation();
  const [shots, setShots] = useState<StepShot[]>();
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(true);
  const count = shots?.length ?? 0;

  useEffect(() => {
    void getShots(task.id).then(setShots);
  }, [task.id]);

  // Plays to the last picture and stops there.
  useEffect(() => {
    if (!playing || count === 0) return;
    if (at >= count - 1) return setPlaying(false);
    const timer = setTimeout(() => setAt((index) => Math.min(index + 1, count - 1)), FRAME_MS);
    return () => clearTimeout(timer);
  }, [playing, at, count]);

  const keys = useRef({ count, onClose });
  keys.current = { count, onClose };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const last = keys.current.count - 1;
      if (event.key === 'Escape') keys.current.onClose();
      else if (event.key === 'ArrowRight') setAt((index) => Math.min(index + 1, last));
      else if (event.key === 'ArrowLeft') setAt((index) => Math.max(index - 1, 0));
      else if (event.key === ' ') setPlaying((now) => !now);
      else return;
      if (event.key.startsWith('Arrow')) setPlaying(false);
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  const shot = shots?.[at];
  const step = shot && task.steps.find((s) => s.index === shot.step);
  const go = (index: number) => {
    setPlaying(false);
    setAt(Math.max(0, Math.min(index, count - 1)));
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg text-fg" role="dialog" aria-label={t('agent.replay.title')} data-testid="replay">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <h2 className="text-sm font-semibold tracking-tight">{t('agent.replay.title')}</h2>
        {count > 0 && (
          <span className="text-xs tabular-nums text-faint" data-testid="replay-position">
            {at + 1} / {count}
          </span>
        )}
        <span className="flex-1" />
        <IconButton label={t('common.dismiss')} onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {shot ? (
          <figure className="mx-auto max-w-3xl space-y-2.5">
            <div className="relative overflow-hidden rounded-xl border border-line bg-surface shadow-soft">
              {/* Our own screenshot, as a data URL: nothing is loaded. */}
              <img src={`data:image/jpeg;base64,${shot.image}`} alt="" className="block w-full" data-testid="replay-frame" />
              {step?.actions
                .filter((action) => action.point)
                .map((action) => (
                  <span
                    key={action.id}
                    data-testid="replay-point"
                    className="pointer-events-none absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-pulse-dot rounded-full border-[3px] border-danger bg-danger/15 ring-2 ring-white"
                    // The picture shows `cssWidth` CSS pixels across, at the same scale down.
                    style={{
                      left: `${(action.point!.x / shot.cssWidth) * 100}%`,
                      top: `${((action.point!.y / shot.cssWidth) * shot.width * 100) / shot.height}%`,
                    }}
                  />
                ))}
            </div>
            <figcaption className="space-y-1 px-0.5 text-sm" data-testid="replay-caption">
              <p className="truncate text-xs text-faint">{shot.url}</p>
              {step ? (
                <>
                  {step.thought && <p className="leading-relaxed text-muted">{step.thought}</p>}
                  <ul className="space-y-0.5">
                    {step.actions.map((action) => (
                      <li key={action.id} className={action.status === 'done' ? '' : 'text-faint line-through'}>
                        {actionLabel(t, action)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-muted">{t('agent.replay.end')}</p>
              )}
            </figcaption>
          </figure>
        ) : (
          shots && <p className="py-10 text-center text-sm text-faint">{t('agent.replay.empty')}</p>
        )}
      </div>

      {count > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-1 border-t border-line bg-surface py-2">
          <IconButton label={t('agent.replay.previous')} onClick={() => go(at - 1)} disabled={at === 0}>
            <ChevronLeft className="h-4 w-4" />
          </IconButton>
          <IconButton
            label={playing ? t('agent.replay.pause') : t('agent.replay.play')}
            onClick={() => {
              // From the end, play starts over.
              if (!playing && at >= count - 1) setAt(0);
              setPlaying(!playing);
            }}
            data-testid="replay-play"
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </IconButton>
          <IconButton label={t('agent.replay.next')} onClick={() => go(at + 1)} disabled={at >= count - 1} data-testid="replay-next">
            <ChevronRight className="h-4 w-4" />
          </IconButton>
        </div>
      )}
    </div>
  );
}
