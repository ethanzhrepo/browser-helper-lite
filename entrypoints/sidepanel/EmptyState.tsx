import { ArrowRight, Bot, FileText, Languages, Plug, Sparkles, TextQuote } from 'lucide-react';
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

export function EmptyState({ hasModel, mode, onQuickAction, onExample }: {
  hasModel: boolean;
  mode: 'ask' | 'act';
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

  if (mode === 'act') {
    return (
      <div className="flex flex-1 animate-fade-in flex-col justify-center gap-5 overflow-y-auto px-4 py-6" data-testid="agent-empty">
        <div className="flex flex-col items-center gap-3 text-center">
          <Hero>
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-card brand-gradient">
              <Bot className="h-7 w-7" />
            </span>
          </Hero>
          <h2 className="text-lg font-semibold tracking-tight">{t('empty.act.title')}</h2>
          <p className="max-w-xs text-sm leading-relaxed text-muted">{t('empty.act.body')}</p>
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
          {AGENT_EXAMPLES.map((id) => (
            <Suggestion key={id} icon={Sparkles} onClick={() => onExample(t(`empty.act.examples.${id}`))}>
              {t(`empty.act.examples.${id}`)}
            </Suggestion>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 animate-fade-in flex-col justify-center gap-5 overflow-y-auto px-4 py-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <Hero>
          <BrandMark size="lg" />
        </Hero>
        <h2 className="text-lg font-semibold tracking-tight">{t('empty.title')}</h2>
      </div>
      <div className="mx-auto flex w-full max-w-sm flex-col gap-2">
        {QUICK_ACTIONS.map(({ id, icon }) => (
          <Suggestion key={id} icon={icon} onClick={() => onQuickAction(id)}>
            {t(`empty.actions.${id}`)}
          </Suggestion>
        ))}
      </div>
      <p className="text-center text-xs text-faint">{t('empty.tip')}</p>
    </div>
  );
}
