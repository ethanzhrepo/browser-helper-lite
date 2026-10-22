import { FileText, Languages, Plug, TextQuote } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { SlashCommand } from '../../src/chat/commands';
import { Button } from '../../src/ui/Button';
import { openOptions } from '../../src/ui/navigation';

const QUICK_ACTIONS: { id: SlashCommand['id']; icon: typeof FileText }[] = [
  { id: 'summarize', icon: FileText },
  { id: 'translate', icon: Languages },
  { id: 'explain', icon: TextQuote },
];

export function EmptyState({ hasModel, onQuickAction }: {
  hasModel: boolean;
  onQuickAction: (id: SlashCommand['id']) => void;
}) {
  const { t } = useTranslation();

  if (!hasModel) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center" data-testid="setup-card">
        <img src="/icon/128.png" alt="" className="h-14 w-14" />
        <h2 className="text-base font-semibold">{t('empty.setupTitle')}</h2>
        <p className="max-w-xs text-sm text-muted">{t('empty.setupBody')}</p>
        <Button variant="primary" onClick={() => openOptions('providers')}>
          <Plug className="h-4 w-4" />
          {t('empty.setupAction')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
      <img src="/icon/128.png" alt="" className="h-12 w-12" />
      <h2 className="text-base font-semibold">{t('empty.title')}</h2>
      <div className="flex w-full max-w-xs flex-col gap-2">
        {QUICK_ACTIONS.map(({ id, icon: Icon }) => (
          <Button key={id} onClick={() => onQuickAction(id)} className="justify-start">
            <Icon className="h-4 w-4 text-muted" />
            {t(`empty.actions.${id}`)}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted">{t('empty.tip')}</p>
    </div>
  );
}
