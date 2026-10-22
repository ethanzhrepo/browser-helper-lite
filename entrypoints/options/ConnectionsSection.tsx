import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findPreset, VENDORS } from '../../src/providers/vendors';
import type { Connection, Settings } from '../../src/shared/types';
import { deleteConnection } from '../../src/storage/settings';
import { Button, IconButton } from '../../src/ui/Button';
import { ConnectionForm } from './ConnectionForm';
import { Card, Section } from './Section';

/** Colored monogram per vendor (no logos). */
const VENDOR_COLORS: Record<Connection['vendor'], string> = {
  openai: '#10a37f',
  anthropic: '#c96442',
  google: '#3b82f6',
  deepseek: '#4f6bed',
  'openai-compatible': '#5f6b73',
};

function Monogram({ connection }: { connection: Connection }) {
  const initial = (connection.name.trim()[0] ?? '?').toUpperCase();
  return (
    <span
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold text-white shadow-soft"
      style={{ background: VENDOR_COLORS[connection.vendor] }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

export function vendorLabel(connection: Pick<Connection, 'vendor' | 'presetId'>): string {
  const preset = connection.vendor === 'openai-compatible' ? findPreset(connection.presetId) : undefined;
  return preset && preset.id !== 'custom' ? preset.label : VENDORS[connection.vendor].label;
}

export function ConnectionsSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  // 'new' shows the empty form; a connection id edits that connection in place.
  const [editing, setEditing] = useState<string | null>(settings.connections.length === 0 ? 'new' : null);

  const remove = async (connection: Connection) => {
    if (window.confirm(t('connections.confirmDelete', { name: connection.name }))) {
      await deleteConnection(connection.id);
    }
  };

  return (
    <Section
      title={t('connections.title')}
      description={t('connections.description')}
      actions={
        editing !== 'new' && (
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" />
            {t('connections.add')}
          </Button>
        )
      }
    >
      {editing === 'new' && (
        <ConnectionForm settings={settings} onDone={() => setEditing(null)} />
      )}
      {settings.connections.map((connection) =>
        editing === connection.id ? (
          <ConnectionForm
            key={connection.id}
            settings={settings}
            initial={connection}
            onDone={() => setEditing(null)}
          />
        ) : (
          <Card key={connection.id} className="flex items-center gap-3.5 transition-shadow hover:shadow-card">
            <Monogram connection={connection} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[15px] font-semibold tracking-tight">{connection.name}</span>
                <span className="rounded-md bg-subtle px-1.5 py-px text-[11px] text-muted">{vendorLabel(connection)}</span>
              </div>
              <div className="mt-0.5 truncate font-mono text-xs text-faint">{connection.baseURL}</div>
            </div>
            <span
              className={`hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium sm:inline ${
                connection.models.length > 0 ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'
              }`}
              title={connection.models.length > 0 ? undefined : t('connections.noModelList')}
            >
              {connection.models.length > 0
                ? t('connections.modelCount', { count: connection.models.length })
                : t('connections.noModels')}
            </span>
            <IconButton label={t('common.edit')} onClick={() => setEditing(connection.id)}>
              <Pencil className="h-4 w-4" />
            </IconButton>
            <IconButton label={t('common.delete')} onClick={() => void remove(connection)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </Card>
        ),
      )}
      {settings.connections.length === 0 && editing !== 'new' && (
        <Card className="py-8 text-center text-sm text-muted">{t('connections.empty')}</Card>
      )}
    </Section>
  );
}
