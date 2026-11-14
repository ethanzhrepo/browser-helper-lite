import { BookOpenText, Hand, Sparkles, type LucideIcon } from 'lucide-react';
import { pickSlot } from '../../src/providers/resolve';
import { openOptions } from '../../src/ui/navigation';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ENABLE_CDP_DRIVER } from '../../src/shared/build-flags';
import type { AgentMode, AgentSettings, Settings } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
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
    const value = Math.min(Math.max(Math.round(Number(maxSteps)) || 30, 5), 100);
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
      </Card>
      <Card className="p-5">
        <Field label={t('agentSettings.maxSteps')} htmlFor="max-steps" hint={t('agentSettings.maxStepsHint')}>
          <input
            id="max-steps"
            type="number"
            min={5}
            max={100}
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
