import { Download, Eraser, Lock, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildBackup,
  clearData,
  decryptBackup,
  downloadBackup,
  readBackupFile,
  restoreBackup,
  serializeBackup,
  type Backup,
  type EncryptedBackup,
} from '../../src/storage/backup';
import { MIN_PASSWORD_LENGTH, WrongPasswordError } from '../../src/storage/backup-crypto';
import { Button } from '../../src/ui/Button';
import { Card, IconBadge, inputClass, Section, Toggle } from './Section';

type Note = { tone: 'ok' | 'error'; text: string };
/** The card a note belongs to: it is shown there, next to what it is about. */
type Place = 'export' | 'import' | 'erase';

/** Backup, restore and erase: everything this extension stores stays on this device unless you export it. */
export function DataSection() {
  const { t } = useTranslation();
  const [includeChats, setIncludeChats] = useState(true);
  const [encrypt, setEncrypt] = useState(true);
  const [includeKeys, setIncludeKeys] = useState(true);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  /** An encrypted file waiting for its password. */
  const [locked, setLocked] = useState<{ name: string; file: EncryptedBackup }>();
  const [unlock, setUnlock] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note & { at: Place }>();
  const fileRef = useRef<HTMLInputElement>(null);

  const say = (at: Place, next: Note | undefined) => setNote(next && { ...next, at });

  const run = async (at: Place, work: () => Promise<Note | undefined>) => {
    setBusy(true);
    setNote(undefined);
    try {
      say(at, await work());
    } catch (error) {
      console.error(error);
      say(at, { tone: 'error', text: t('data.failed') });
    } finally {
      setBusy(false);
    }
  };

  const exportAll = (event: FormEvent) => {
    event.preventDefault();
    if (encrypt && password.length < MIN_PASSWORD_LENGTH) return say('export', { tone: 'error', text: t('data.passwordShort', { min: MIN_PASSWORD_LENGTH }) });
    if (encrypt && password !== again) return say('export', { tone: 'error', text: t('data.passwordMismatch') });
    void run('export', async () => {
      // Keys leave this browser only inside an encrypted file.
      const backup = await buildBackup({ includeKeys: encrypt && includeKeys, includeConversations: includeChats });
      downloadBackup(await serializeBackup(backup, encrypt ? password : undefined), backup.exportedAt);
      setPassword('');
      setAgain('');
      return undefined;
    });
  };

  /** Asks before anything is replaced, then applies the backup. */
  const restore = async (backup: Backup): Promise<Note | undefined> => {
    const conversations = backup.conversations?.length ?? 0;
    const question = backup.settings ? t('data.importConfirm', { count: conversations }) : t('data.importConfirmChats', { count: conversations });
    if (!window.confirm(question)) return undefined;
    const summary = await restoreBackup(backup);
    return { tone: 'ok', text: t('data.importDone', { count: summary.conversations }) };
  };

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // So choosing the same file again fires a change.
    event.target.value = '';
    if (!file) return;
    setLocked(undefined);
    setUnlock('');
    void run('import', async () => {
      let read;
      try {
        read = readBackupFile(await file.text());
      } catch {
        return { tone: 'error', text: t('data.importInvalid') };
      }
      if ('backup' in read) return restore(read.backup);
      // Encrypted: the password is asked for next.
      setLocked({ name: file.name, file: read.encrypted });
      return undefined;
    });
  };

  const importLocked = (event: FormEvent) => {
    event.preventDefault();
    if (!locked || !unlock) return;
    void run('import', async () => {
      let backup;
      try {
        backup = await decryptBackup(locked.file, unlock);
      } catch (error) {
        return { tone: 'error', text: t(error instanceof WrongPasswordError ? 'data.wrongPassword' : 'data.importInvalid') };
      }
      setLocked(undefined);
      setUnlock('');
      return restore(backup);
    });
  };

  const erase = (scope: 'conversations' | 'everything') => {
    if (!window.confirm(t(scope === 'everything' ? 'data.resetConfirm' : 'data.clearConfirm'))) return;
    void run('erase', async () =>
      (await clearData(scope)) ? { tone: 'ok', text: t(scope === 'everything' ? 'data.resetDone' : 'data.clearDone') } : { tone: 'error', text: t('data.failed') },
    );
  };

  const noteAt = (at: Place) =>
    note?.at === at && (
      <p role="status" data-testid="data-note" className={`text-sm ${note.tone === 'ok' ? 'text-success' : 'text-danger'}`}>
        {note.text}
      </p>
    );

  return (
    <Section title={t('data.title')} description={t('data.description')}>
      <Card className="p-5">
        <form className="space-y-4" onSubmit={exportAll}>
          <div className="flex items-start gap-3">
            <IconBadge icon={Download} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-semibold tracking-tight">{t('data.exportTitle')}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-muted">{t('data.exportHint')}</p>
            </div>
            <Button type="submit" disabled={busy} data-testid="export-data">
              {t('data.export')}
            </Button>
          </div>
          <Toggle id="include-chats" checked={includeChats} onChange={setIncludeChats} label={t('data.includeChats')} />
          <Toggle id="encrypt-backup" checked={encrypt} onChange={setEncrypt} label={t('data.encrypt')} hint={t('data.encryptHint')} />
          {encrypt && (
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                type="password"
                className={inputClass}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('data.password')}
                aria-label={t('data.password')}
                autoComplete="new-password"
                data-testid="export-password"
              />
              <input
                type="password"
                className={inputClass}
                value={again}
                onChange={(e) => setAgain(e.target.value)}
                placeholder={t('data.passwordAgain')}
                aria-label={t('data.passwordAgain')}
                autoComplete="new-password"
                data-testid="export-password-again"
              />
            </div>
          )}
          <Toggle
            id="include-keys"
            checked={encrypt && includeKeys}
            disabled={!encrypt}
            onChange={setIncludeKeys}
            label={t('data.includeKeys')}
            hint={t(encrypt ? 'data.includeKeysHint' : 'data.keysNeedPassword')}
          />
          {noteAt('export')}
        </form>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <IconBadge icon={Upload} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight">{t('data.importTitle')}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{t('data.importHint')}</p>
          </div>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={importFile} data-testid="import-file" />
          <Button onClick={() => fileRef.current?.click()} disabled={busy}>
            {t('data.import')}
          </Button>
        </div>
        {locked && (
          <form className="space-y-2 border-t border-line pt-4" onSubmit={importLocked} data-testid="import-locked">
            <label htmlFor="import-password" className="flex items-center gap-1.5 text-sm font-medium">
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="min-w-0 break-all">{t('data.importEncrypted', { name: locked.name })}</span>
            </label>
            <div className="flex gap-2">
              <input
                id="import-password"
                type="password"
                autoFocus
                className={`${inputClass} min-w-0 flex-1`}
                value={unlock}
                onChange={(e) => setUnlock(e.target.value)}
                placeholder={t('data.password')}
                autoComplete="off"
                data-testid="import-password"
              />
              <Button type="submit" disabled={busy || !unlock} data-testid="import-unlock">
                {t('data.importOpen')}
              </Button>
              <Button variant="ghost" onClick={() => setLocked(undefined)} disabled={busy}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        )}
        {noteAt('import')}
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
      {noteAt('erase')}
    </Section>
  );
}
