import { Check, Mic, MicOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { Button } from '../../src/ui/Button';

type Status = 'asking' | 'granted' | 'denied';

/**
 * Side panels cannot show Chrome's microphone prompt, so voice input opens
 * this tab once (M1.5 C7). The permission then covers the side panel too.
 */
export function MicPermission() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('asking');

  const ask = async () => {
    setStatus('asking');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setStatus('granted');
    } catch {
      setStatus('denied');
    }
  };

  useEffect(() => {
    document.title = t('voice.permission.title');
    void ask();
  }, []);

  useEffect(() => {
    if (status !== 'granted') return;
    const timer = setTimeout(() => {
      void browser.tabs.getCurrent().then((tab) => {
        if (tab?.id !== undefined) void browser.tabs.remove(tab.id);
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [status]);

  const Icon = status === 'granted' ? Check : status === 'denied' ? MicOff : Mic;
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-6 text-fg">
      <div className="w-full max-w-sm animate-fade-in rounded-2xl border border-line bg-surface p-7 text-center shadow-card" data-testid="mic-permission">
        <span
          className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${
            status === 'denied' ? 'bg-danger-soft text-danger' : status === 'granted' ? 'bg-success-soft text-success' : 'bg-accent-soft text-accent'
          }`}
        >
          <Icon className="h-7 w-7" />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">{t(`voice.permission.${status}Title`)}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{t(`voice.permission.${status}Body`)}</p>
        {status === 'denied' && (
          <Button variant="primary" className="mt-5" onClick={() => void ask()}>
            {t('voice.permission.retry')}
          </Button>
        )}
      </div>
    </div>
  );
}
