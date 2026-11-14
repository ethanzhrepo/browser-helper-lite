import { ArrowLeft, BellRing, CircleAlert, Eye, Loader2, Pause, Play, RefreshCw, Trash2, Zap } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import type { WatchActionRequest } from '../../src/shared/protocol';
import { db } from '../../src/storage/db';
import { IconButton } from '../../src/ui/Button';
import { formatInterval } from '../../src/watch/format';
import { isRushing, RUSH_MINUTES, RUSH_SECONDS, WATCH_INTERVALS, type Watch } from '../../src/watch/watch';

const REFRESH_MS = 4000;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** The pages the assistant keeps an eye on: what it looks for, what it last saw, and the switches to pause or delete each. */
export function WatchPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [watches, setWatches] = useState<Watch[]>();
  const [busy, setBusy] = useState<string>();

  const load = useCallback(async () => {
    setWatches((await db.watches.toArray()).sort((a, b) => b.createdAt - a.createdAt));
  }, []);

  // Checks happen in the background; the list follows them.
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const act = async (watch: Watch, action: 'check' | 'pause' | 'resume' | 'delete' | { seconds: number } | { rush: boolean }) => {
    setBusy(watch.id);
    try {
      const request: WatchActionRequest =
        typeof action === 'string'
          ? { type: 'watch.action', id: watch.id, action }
          : 'rush' in action
            ? { type: 'watch.action', id: watch.id, action: 'rush', on: action.rush }
            : { type: 'watch.action', id: watch.id, action: 'interval', seconds: action.seconds };
      await browser.runtime.sendMessage(request);
      await load();
    } finally {
      setBusy(undefined);
    }
  };

  const time = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="watch-panel">
      <div className="flex items-center gap-1 px-2.5 pt-2.5">
        <IconButton label={t('common.back')} onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </IconButton>
        <h2 className="text-sm font-semibold tracking-tight">{t('watch.title')}</h2>
      </div>
      <ul className="flex-1 space-y-2 overflow-y-auto px-3.5 py-3">
        {watches?.length === 0 && (
          <li className="px-2 py-10 text-center text-sm leading-relaxed text-faint">
            <Eye className="mx-auto mb-2 h-5 w-5" />
            {t('watch.empty')}
          </li>
        )}
        {watches?.map((watch) => {
          const last = watch.history.at(-1);
          const looked = Math.max(watch.checkedAt ?? 0, last?.at ?? 0);
          const paces = [...new Set([...WATCH_INTERVALS, watch.everySeconds])].sort((a, b) => a - b);
          const running = watch.status === 'active';
          const now = Date.now();
          const rushed = running && isRushing(watch, now);
          const waiting = running && (watch.retryAt ?? 0) > now;
          const clock = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' });
          const Icon = watch.status === 'met' ? BellRing : watch.status === 'failed' ? CircleAlert : Eye;
          const tone = watch.status === 'met' ? 'text-success' : watch.status === 'failed' ? 'text-danger' : running ? 'text-accent' : 'text-faint';
          return (
            <li key={watch.id} className="rounded-xl border border-line bg-surface p-3 shadow-soft" data-testid="watch-item" data-status={watch.status}>
              <div className="flex items-start gap-2">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">{watch.condition}</p>
                  <a href={watch.url} target="_blank" rel="noreferrer noopener" title={watch.url} className="block truncate text-xs text-muted hover:text-fg">
                    {watch.title || hostOf(watch.url)} · {hostOf(watch.url)}
                  </a>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted" data-testid="watch-state">
                <span className={`font-medium ${tone}`}>{t(`watch.status.${watch.status}`)}</span>
                {running && <> · {formatInterval(t, watch.everySeconds)}</>}
                {rushed && <span className="font-medium text-warning"> · {t('watch.rush.on', { time: clock.format(watch.rushUntil) })}</span>}
                {waiting && <span className="text-warning"> · {t('watch.retry', { time: clock.format(watch.retryAt) })}</span>}
                {last && (
                  <>
                    {' · '}
                    {time.format(looked)}
                    {/* What the model saw, or why the check failed: plain text from a page, shown as text. */}
                    {(last.error || last.note) && <span className="block break-words text-faint">{last.error ? t('watch.checkFailed', { error: last.error }) : last.note}</span>}
                  </>
                )}
              </p>
              <div className="-mb-1 -mr-1 mt-1 flex items-center justify-end">
                {(running || watch.status === 'paused') && (
                  <select
                    value={watch.everySeconds}
                    onChange={(event) => void act(watch, { seconds: Number(event.target.value) })}
                    disabled={Boolean(busy)}
                    aria-label={t('watch.pace')}
                    title={t('watch.pace')}
                    data-testid="watch-pace"
                    className="mr-auto rounded-md border border-line bg-surface px-1.5 py-1 text-[11px] text-muted outline-none focus:border-accent/50"
                  >
                    {paces.map((seconds) => (
                      <option key={seconds} value={seconds}>
                        {formatInterval(t, seconds)}
                      </option>
                    ))}
                  </select>
                )}
                {busy === watch.id && <Loader2 className="mr-1 mt-2 h-3.5 w-3.5 animate-spin text-faint" />}
                {running && (
                  <IconButton
                    label={rushed ? t('watch.rush.stop') : t('watch.rush.start', { minutes: RUSH_MINUTES })}
                    // Reloading a page every few seconds is what sites take for a bot: the user says yes knowing that.
                    onClick={() => (rushed || window.confirm(t('watch.rush.confirm', { minutes: RUSH_MINUTES, seconds: RUSH_SECONDS }))) && void act(watch, { rush: !rushed })}
                    disabled={Boolean(busy)}
                    className={`h-7 w-7 ${rushed ? 'text-warning' : ''}`}
                    aria-pressed={rushed}
                    data-testid="watch-rush"
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </IconButton>
                )}
                {(running || watch.status === 'paused') && (
                  <IconButton label={t('watch.checkNow')} onClick={() => void act(watch, 'check')} disabled={Boolean(busy)} className="h-7 w-7" data-testid="watch-check">
                    <RefreshCw className="h-3.5 w-3.5" />
                  </IconButton>
                )}
                {running ? (
                  <IconButton label={t('watch.pause')} onClick={() => void act(watch, 'pause')} disabled={Boolean(busy)} className="h-7 w-7">
                    <Pause className="h-3.5 w-3.5" />
                  </IconButton>
                ) : (
                  <IconButton label={t('watch.resume')} onClick={() => void act(watch, 'resume')} disabled={Boolean(busy)} className="h-7 w-7">
                    <Play className="h-3.5 w-3.5" />
                  </IconButton>
                )}
                <IconButton label={t('common.delete')} onClick={() => void act(watch, 'delete')} disabled={Boolean(busy)} className="h-7 w-7">
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="px-4 pb-3 text-[11px] leading-relaxed text-faint">{t('watch.footnote')}</p>
    </div>
  );
}
