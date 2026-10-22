import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { suggestChatModel } from '../../src/providers/suggest';
import type { Capability, Settings, SlotAssignment } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { Card, Field, inputClass, Section } from './Section';

const SLOTS: { id: Capability; fromMilestone?: string }[] = [
  { id: 'chat' },
  { id: 'fast' },
  { id: 'agent', fromMilestone: 'M1' },
  { id: 'vision', fromMilestone: 'M1' },
];

async function saveSlot(capability: Capability, slot: SlotAssignment | undefined) {
  await updateSettings((settings) => {
    const slots = { ...settings.slots };
    if (slot) slots[capability] = slot;
    else delete slots[capability];
    return { ...settings, slots };
  });
}

export function SlotsSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  return (
    <Section title={t('slots.title')} description={t('slots.description')}>
      {settings.connections.length === 0 && (
        <Card className="text-sm text-muted">
          {t('slots.noConnections')}{' '}
          <a href="#providers" className="text-accent underline">
            {t('slots.addConnection')}
          </a>
        </Card>
      )}
      {SLOTS.map(({ id, fromMilestone }) => (
        <SlotCard key={id} capability={id} settings={settings} fromMilestone={fromMilestone} />
      ))}
    </Section>
  );
}

function SlotCard({ capability, settings, fromMilestone }: {
  capability: Capability;
  settings: Settings;
  fromMilestone?: string;
}) {
  const { t } = useTranslation();
  const slot = settings.slots[capability];
  const connection = settings.connections.find((c) => c.id === slot?.connectionId);
  const [modelId, setModelId] = useState(slot?.modelId ?? '');

  useEffect(() => setModelId(slot?.modelId ?? ''), [slot?.modelId]);

  const changeConnection = (connectionId: string) => {
    const next = settings.connections.find((c) => c.id === connectionId);
    if (!next) {
      void saveSlot(capability, undefined);
      return;
    }
    const keep = next.models.includes(modelId) ? modelId : undefined;
    const suggested = capability === 'chat' || capability === 'fast' ? suggestChatModel(next.vendor, next.models) : undefined;
    void saveSlot(capability, { ...slot, connectionId, modelId: keep ?? suggested ?? '' });
  };

  const commitModel = () => {
    if (slot && modelId.trim() !== slot.modelId) void saveSlot(capability, { ...slot, modelId: modelId.trim() });
  };

  const listId = `models-${capability}`;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{t(`slots.${capability}.title`)}</h3>
        {fromMilestone && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
            {t('slots.fromMilestone', { milestone: fromMilestone })}
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-muted">{t(`slots.${capability}.description`)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('slots.connection')} htmlFor={`connection-${capability}`}>
          <select
            id={`connection-${capability}`}
            className={inputClass}
            value={slot?.connectionId ?? ''}
            onChange={(e) => changeConnection(e.target.value)}
          >
            <option value="">{t('slots.notSet')}</option>
            {settings.connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={t('slots.model')}
          htmlFor={`model-${capability}`}
          hint={connection && connection.models.length === 0 ? t('slots.typeModelId') : undefined}
        >
          <input
            id={`model-${capability}`}
            className={inputClass}
            list={listId}
            value={modelId}
            disabled={!slot}
            spellCheck={false}
            placeholder={t('slots.modelPlaceholder')}
            onChange={(e) => setModelId(e.target.value)}
            onBlur={commitModel}
            onKeyDown={(e) => e.key === 'Enter' && commitModel()}
          />
          <datalist id={listId}>
            {connection?.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </Field>
      </div>
    </Card>
  );
}
