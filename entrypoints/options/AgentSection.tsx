import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ENABLE_CDP_DRIVER } from '../../src/shared/build-flags';
import type { AgentSettings, SearchEngineSetting, Settings } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { Card, Field, inputClass, Section } from './Section';

const ENGINES: SearchEngineSetting[] = ['google', 'bing', 'duckduckgo', 'custom'];

function saveAgent(patch: Partial<AgentSettings>) {
  void updateSettings((s) => ({ ...s, agent: { ...s.agent, ...patch } }));
}

function Toggle({ id, checked, disabled, onChange, label, hint }: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label htmlFor={id} className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        id={id}
        type="checkbox"
        className="mt-1 accent-[var(--accent)]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function AgentSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const agent = settings.agent;
  const [maxSteps, setMaxSteps] = useState(String(agent.maxSteps));
  const [customUrl, setCustomUrl] = useState(agent.customSearchUrl);

  useEffect(() => setMaxSteps(String(agent.maxSteps)), [agent.maxSteps]);

  const commitMaxSteps = () => {
    const value = Math.min(Math.max(Math.round(Number(maxSteps)) || 30, 5), 100);
    setMaxSteps(String(value));
    if (value !== agent.maxSteps) saveAgent({ maxSteps: value });
  };

  return (
    <Section title={t('agentSettings.title')} description={t('agentSettings.description')}>
      <Card className="space-y-4">
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
      <Card className="grid gap-4 sm:grid-cols-2">
        <Field label={t('agentSettings.maxSteps')} htmlFor="max-steps" hint={t('agentSettings.maxStepsHint')}>
          <input
            id="max-steps"
            type="number"
            min={5}
            max={100}
            className={inputClass}
            value={maxSteps}
            onChange={(e) => setMaxSteps(e.target.value)}
            onBlur={commitMaxSteps}
          />
        </Field>
        <Field label={t('agentSettings.searchEngine')} htmlFor="search-engine">
          <select
            id="search-engine"
            className={inputClass}
            value={agent.searchEngine}
            onChange={(e) => saveAgent({ searchEngine: e.target.value as SearchEngineSetting })}
          >
            {ENGINES.map((engine) => (
              <option key={engine} value={engine}>
                {t(`agentSettings.engines.${engine}`)}
              </option>
            ))}
          </select>
        </Field>
        {agent.searchEngine === 'custom' && (
          <div className="sm:col-span-2">
            <Field label={t('agentSettings.customSearchUrl')} htmlFor="custom-search" hint={t('agentSettings.customSearchUrlHint')}>
              <input
                id="custom-search"
                className={inputClass}
                value={customUrl}
                placeholder="https://search.example.com/?q=%s"
                spellCheck={false}
                onChange={(e) => setCustomUrl(e.target.value)}
                onBlur={() => saveAgent({ customSearchUrl: customUrl.trim() })}
              />
            </Field>
          </div>
        )}
      </Card>
    </Section>
  );
}
