import { BookOpenText, Hand, Sparkles, Trash2, type LucideIcon } from 'lucide-react';
import { IconButton } from '../../src/ui/Button';
import { pickSlot } from '../../src/providers/resolve';
import { openOptions } from '../../src/ui/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ENABLE_CDP_DRIVER } from '../../src/shared/build-flags';
import type { AgentMode, AgentSettings, Settings } from '../../src/shared/types';
import { DEFAULT_MAX_STEPS, MAX_MAX_STEPS, MIN_MAX_STEPS, updateSettings } from '../../src/storage/settings';
import { Card, ChoiceCard, Field, inputClass, Section, Toggle } from './Section';

const MODES: { id: AgentMode; icon: LucideIcon }[] = [
  { id: 'query', icon: BookOpenText },
  { id: 'auto', icon: Sparkles },
  { id: 'manual', icon: Hand },
];

const SCREENSHOT_READERS: AgentSettings['screenshots'][] = ['auto', 'main', 'vision'];

function saveAgent(patch: Partial<AgentSettings>) {
  void updateSettings((s) => ({ ...s, agent: { ...s.agent, ...patch } }));
}

export function AgentSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const agent = settings.agent;
  const [maxSteps, setMaxSteps] = useState(String(agent.maxSteps));

  useEffect(() => setMaxSteps(String(agent.maxSteps)), [agent.maxSteps]);

  const commitMaxSteps = () => {
    const value = Math.min(Math.max(Math.round(Number(maxSteps)) || DEFAULT_MAX_STEPS, MIN_MAX_STEPS), MAX_MAX_STEPS);
    setMaxSteps(String(value));
    if (value !== agent.maxSteps) saveAgent({ maxSteps: value });
  };

  return (
    <Section title={t('agentSettings.title')} description={t('agentSettings.description')}>
      <div className="space-y-2" role="radiogroup" aria-label={t('agentSettings.mode')}>
        <h3 className="text-[13px] font-medium">{t('agentSettings.mode')}</h3>
        {MODES.map(({ id, icon }) => (
          <ChoiceCard
            key={id}
            name="mode"
            value={id}
            checked={agent.mode === id}
            onChange={() => saveAgent({ mode: id })}
            icon={icon}
            title={t(`composer.modes.${id}`)}
            description={t(`composer.modes.${id}Hint`)}
            testId={`settings-mode-${id}`}
          />
        ))}
        <p className="text-xs text-muted">{t('agentSettings.modeHint')}</p>
      </div>
      <Card className="divide-y divide-line p-0 [&>*]:px-5 [&>*]:py-4">
        <Toggle
          id="use-cdp"
          checked={ENABLE_CDP_DRIVER && agent.useCdp}
          disabled={!ENABLE_CDP_DRIVER}
          onChange={(useCdp) => saveAgent({ useCdp })}
          label={t('agentSettings.useCdp')}
          hint={ENABLE_CDP_DRIVER ? t('agentSettings.useCdpHint') : t('agentSettings.cdpUnavailable')}
        />
        <Toggle
          id="notifications"
          checked={agent.notifications}
          onChange={(notifications) => saveAgent({ notifications })}
          label={t('agentSettings.notifications')}
          hint={t('agentSettings.notificationsHint')}
        />
      </Card>
      <Card className="divide-y divide-line p-0 [&>*]:px-5 [&>*]:py-4">
        <div>
          <Field label={t('agentSettings.screenshots')} htmlFor="screenshots" hint={t('agentSettings.screenshotsHint')}>
            <select
              id="screenshots"
              className={`${inputClass} sm:w-64`}
              value={agent.screenshots}
              onChange={(e) => saveAgent({ screenshots: e.target.value as AgentSettings['screenshots'] })}
            >
              {SCREENSHOT_READERS.map((reader) => (
                <option key={reader} value={reader}>
                  {t(`agentSettings.screenshotReaders.${reader}`)}
                </option>
              ))}
            </select>
          </Field>
          {agent.screenshots === 'vision' && !pickSlot(settings, ['vision']) && (
            <button type="button" onClick={() => openOptions('models')} className="mt-2 text-xs text-accent underline" data-testid="set-vision-model">
              {t('agentSettings.setVisionModel')}
            </button>
          )}
        </div>
        <Toggle
          id="auto-screenshot"
          checked={agent.autoScreenshot}
          onChange={(autoScreenshot) => saveAgent({ autoScreenshot })}
          label={t('agentSettings.autoScreenshot')}
          hint={t('agentSettings.autoScreenshotHint')}
        />
        <Toggle
          id="record-steps"
          checked={agent.recordSteps}
          onChange={(recordSteps) => saveAgent({ recordSteps })}
          label={t('agentSettings.recordSteps')}
          hint={t('agentSettings.recordStepsHint')}
        />
      </Card>
      <Card className="p-5">
        <div className="space-y-3" data-testid="saved-commands">
        <div>
          <h3 className="text-sm font-medium">{t('agentSettings.commands.title')}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{t('agentSettings.commands.hint')}</p>
        </div>
        {settings.commands.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {settings.commands.map((command) => (
              <li key={command.id} className="flex items-center gap-2 py-1.5 pl-3 pr-1.5">
                <span className="shrink-0 font-mono text-xs font-medium text-accent">/{command.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted" title={command.prompt}>
                  {command.prompt}
                </span>
                <IconButton
                  label={t('common.delete')}
                  onClick={() => void updateSettings((s) => ({ ...s, commands: s.commands.filter((c) => c.id !== command.id) }))}
                  className="h-7 w-7"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        </div>
      </Card>
      <Card className="p-5">
        <Field label={t('agentSettings.maxSteps')} htmlFor="max-steps" hint={t('agentSettings.maxStepsHint', { min: MIN_MAX_STEPS, max: MAX_MAX_STEPS, usual: DEFAULT_MAX_STEPS })}>
          <input
            id="max-steps"
            type="number"
            min={MIN_MAX_STEPS}
            max={MAX_MAX_STEPS}
            className={`${inputClass} sm:w-40`}
            value={maxSteps}
            onChange={(e) => setMaxSteps(e.target.value)}
            onBlur={commitMaxSteps}
          />
        </Field>
      </Card>
    </Section>
  );
}
