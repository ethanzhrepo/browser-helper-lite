import { Bot, Eye, MessageSquare, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { suggestChatModel } from '../../src/providers/suggest';
import type { Capability, Settings, SlotAssignment } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { Card, Field, IconBadge, inputClass, Section } from './Section';

const SLOTS: Capability[] = ['chat', 'fast', 'agent', 'vision'];

const SLOT_ICONS: Record<Capability, LucideIcon> = {
  chat: MessageSquare,
  fast: Zap,
  agent: Bot,
  vision: Eye,
};

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
      {SLOTS.map((id) => (
        <SlotCard key={id} capability={id} settings={settings} />
      ))}
    </Section>
  );
}

function SlotCard({ capability, settings }: { capability: Capability; settings: Settings }) {
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
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <IconBadge icon={SLOT_ICONS[capability]} />
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{t(`slots.${capability}.title`)}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">{t(`slots.${capability}.description`)}</p>
        </div>
      </div>
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
