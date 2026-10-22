import { ArrowRight, FileText, Languages, Plug, Sparkles, TextQuote } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { SlashCommand } from '../../src/chat/commands';
import { BrandMark, Button } from '../../src/ui/Button';
import { openOptions } from '../../src/ui/navigation';

const QUICK_ACTIONS: { id: SlashCommand['id']; icon: typeof FileText }[] = [
  { id: 'summarize', icon: FileText },
  { id: 'translate', icon: Languages },
  { id: 'explain', icon: TextQuote },
];

const AGENT_EXAMPLES = ['plans', 'compare', 'process'] as const;

/** Brand mark with a soft glow behind it. */
function Hero({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex items-center justify-center">
      <div className="absolute h-24 w-24 rounded-full opacity-25 blur-2xl brand-gradient" aria-hidden />
      <div className="relative">{children}</div>
    </div>
  );
}

function Suggestion({ icon: Icon, children, onClick }: { icon: typeof FileText; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left text-sm shadow-soft transition-all hover:-translate-y-px hover:border-accent/30 hover:shadow-card"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1 leading-snug text-fg">{children}</span>
      <ArrowRight className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
    </button>
  );
}

export function EmptyState({ hasModel, onQuickAction, onExample }: {
  hasModel: boolean;
  onQuickAction: (id: SlashCommand['id']) => void;
  onExample: (text: string) => void;
}) {
  const { t } = useTranslation();

  if (!hasModel) {
    return (
      <div className="flex flex-1 animate-fade-in flex-col items-center justify-center gap-4 px-8 text-center" data-testid="setup-card">
        <Hero>
          <BrandMark size="lg" />
        </Hero>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">{t('empty.setupTitle')}</h2>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted">{t('empty.setupBody')}</p>
        </div>
        <Button variant="primary" onClick={() => openOptions('providers')}>
          <Plug className="h-4 w-4" />
          {t('empty.setupAction')}
        </Button>
      </div>
    );
  }

  return (
    // my-auto centers the content when it fits and lets it scroll from the top when it does not.
    <div className="flex flex-1 animate-fade-in flex-col overflow-y-auto px-4 py-6" data-testid="empty-state">
      <div className="my-auto flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <Hero>
            <BrandMark size="lg" />
          </Hero>
          <h2 className="text-lg font-semibold tracking-tight">{t('empty.title')}</h2>
          <p className="max-w-xs text-sm leading-relaxed text-muted">{t('empty.body')}</p>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
          {QUICK_ACTIONS.map(({ id, icon }) => (
            <Suggestion key={id} icon={icon} onClick={() => onQuickAction(id)}>
              {t(`empty.actions.${id}`)}
            </Suggestion>
          ))}
          <p className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-faint">{t('empty.tasksTitle')}</p>
          {AGENT_EXAMPLES.map((id) => (
            <Suggestion key={id} icon={Sparkles} onClick={() => onExample(t(`empty.examples.${id}`))}>
              {t(`empty.examples.${id}`)}
            </Suggestion>
          ))}
        </div>
        <p className="text-center text-xs text-faint">{t('empty.tip')}</p>
      </div>
    </div>
  );
}
