import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { findPreset, VENDORS } from '../../src/providers/vendors';
import type { Connection, Settings } from '../../src/shared/types';
import { deleteConnection } from '../../src/storage/settings';
import { Button, IconButton } from '../../src/ui/Button';
import { ConnectionForm } from './ConnectionForm';
import { Card, Section } from './Section';

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
          <Card key={connection.id} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{connection.name}</span>
                <span className="text-xs text-muted">{vendorLabel(connection)}</span>
              </div>
              <div className="truncate text-xs text-muted">{connection.baseURL}</div>
              <div className="mt-1 text-xs text-muted">
                {connection.models.length > 0
                  ? t('connections.modelCount', { count: connection.models.length })
                  : t('connections.noModelList')}
              </div>
            </div>
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
        <Card className="text-sm text-muted">{t('connections.empty')}</Card>
      )}
    </Section>
  );
}
