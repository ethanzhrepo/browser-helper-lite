import { Download, Eraser, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { buildBackup, clearData, downloadBackup, parseBackup, restoreBackup } from '../../src/storage/backup';
import { Button } from '../../src/ui/Button';
import { Card, IconBadge, Section, Toggle } from './Section';

type Note = { tone: 'ok' | 'error'; text: string };

/** Backup, restore and erase: everything this extension stores stays on this device unless you export it. */
export function DataSection() {
  const { t } = useTranslation();
  const [includeKeys, setIncludeKeys] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>();
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (work: () => Promise<Note | undefined>) => {
    setBusy(true);
    setNote(undefined);
    try {
      setNote(await work());
    } catch (error) {
      console.error(error);
      setNote({ tone: 'error', text: t('data.failed') });
    } finally {
      setBusy(false);
    }
  };

  const exportAll = () =>
    run(async () => {
      downloadBackup(await buildBackup({ includeKeys }));
      return undefined;
    });

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // So choosing the same file again fires a change.
    event.target.value = '';
    if (!file) return;
    void run(async () => {
      let backup;
      try {
        backup = parseBackup(await file.text());
      } catch {
        return { tone: 'error', text: t('data.importInvalid') };
      }
      const conversations = backup.conversations?.length ?? 0;
      const question = backup.settings ? t('data.importConfirm', { count: conversations }) : t('data.importConfirmChats', { count: conversations });
      if (!window.confirm(question)) return undefined;
      const summary = await restoreBackup(backup);
      return { tone: 'ok', text: t('data.importDone', { count: summary.conversations }) };
    });
  };

  const erase = (scope: 'conversations' | 'everything') => {
    if (!window.confirm(t(scope === 'everything' ? 'data.resetConfirm' : 'data.clearConfirm'))) return;
    void run(async () =>
      (await clearData(scope)) ? { tone: 'ok', text: t(scope === 'everything' ? 'data.resetDone' : 'data.clearDone') } : { tone: 'error', text: t('data.failed') },
    );
  };

  return (
    <Section title={t('data.title')} description={t('data.description')}>
      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <IconBadge icon={Download} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight">{t('data.exportTitle')}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{t('data.exportHint')}</p>
          </div>
          <Button onClick={() => void exportAll()} disabled={busy} data-testid="export-data">
            {t('data.export')}
          </Button>
        </div>
        <Toggle id="include-keys" checked={includeKeys} onChange={setIncludeKeys} label={t('data.includeKeys')} hint={t('data.includeKeysHint')} />
      </Card>

      <Card className="flex items-start gap-3 p-5">
        <IconBadge icon={Upload} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-tight">{t('data.importTitle')}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">{t('data.importHint')}</p>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={importFile} data-testid="import-file" />
        <Button onClick={() => fileRef.current?.click()} disabled={busy}>
          {t('data.import')}
        </Button>
      </Card>

      <Card className="divide-y divide-line p-0 [&>*]:px-5 [&>*]:py-4">
        <div className="flex items-start gap-3">
          <IconBadge icon={Trash2} className="bg-danger-soft text-danger" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight">{t('data.clearTitle')}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{t('data.clearHint')}</p>
          </div>
          <Button variant="danger" onClick={() => erase('conversations')} disabled={busy} data-testid="clear-conversations">
            {t('data.clear')}
          </Button>
        </div>
        <div className="flex items-start gap-3">
          <IconBadge icon={Eraser} className="bg-danger-soft text-danger" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight">{t('data.resetTitle')}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{t('data.resetHint')}</p>
          </div>
          <Button variant="danger" onClick={() => erase('everything')} disabled={busy} data-testid="reset-everything">
            {t('data.reset')}
          </Button>
        </div>
      </Card>

      {note && (
        <p role="status" data-testid="data-note" className={`text-sm ${note.tone === 'ok' ? 'text-success' : 'text-danger'}`}>
          {note.text}
        </p>
      )}
    </Section>
  );
}
