import { ArrowUpCircle, Check, Copy, Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { ENABLE_CDP_DRIVER } from '../../src/shared/build-flags';
import type { Settings } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { BrandMark, Button, IconButton } from '../../src/ui/Button';
import { useUpdateState } from '../../src/ui/useUpdate';
import { availableUpdate, checkForUpdate, REPO_URL, updatedByChrome } from '../../src/updates/check';
import { Card, IconBadge, Section, Toggle } from './Section';

const DESIGN_DOC_URL = `${REPO_URL}/blob/HEAD/docs/product-design.md`;
const INSTALL_COMMAND = /win/i.test(navigator.platform)
  ? 'irm https://raw.githubusercontent.com/ethanzhrepo/browser-helper-lite/main/scripts/install.ps1 | iex'
  : 'curl -fsSL https://raw.githubusercontent.com/ethanzhrepo/browser-helper-lite/main/scripts/install.sh | sh';

/** The key that opens the side panel, as set under chrome://extensions/shortcuts. */
function useShortcut(): string | undefined {
  const [shortcut, setShortcut] = useState<string>();
  useEffect(() => {
    void browser.commands?.getAll().then((commands) => setShortcut(commands.find((c) => c.name === '_execute_action')?.shortcut || ''));
  }, []);
  return shortcut;
}

function Updates({ settings }: { settings: Settings }) {
  const { t, i18n } = useTranslation();
  const state = useUpdateState();
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const update = availableUpdate(state, browser.runtime.getManifest().version);

  const check = async () => {
    setChecking(true);
    await checkForUpdate();
    setChecking(false);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(INSTALL_COMMAND);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const status = checking
    ? t('about.checking')
    : update
      ? t('about.updateAvailable', { version: update.version })
      : state?.failed
        ? t('about.checkFailed')
        : state
          ? t('about.upToDate', { time: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(state.checkedAt) })
          : t('about.neverChecked');

  return (
    <Card className="divide-y divide-line p-0 [&>*]:px-5 [&>*]:py-4" >
      <div className="space-y-3" data-testid="update-status">
        <div className="flex items-center gap-3">
          <IconBadge icon={ArrowUpCircle} className={update ? '' : 'bg-subtle text-muted'} />
          <p className={`min-w-0 flex-1 text-sm ${update ? 'font-semibold' : ''}`}>{status}</p>
          {update && (
            <a href={update.url} target="_blank" rel="noreferrer" className="shrink-0 text-sm text-accent underline">
              {t('about.releaseNotes')}
            </a>
          )}
          <Button onClick={() => void check()} disabled={checking}>
            {t('about.checkNow')}
          </Button>
        </div>
        {update && (
          <div className="space-y-1.5">
            <p className="text-sm text-muted">{t('about.updateSteps')}</p>
            <div className="flex items-center gap-1 rounded-lg bg-subtle py-1 pl-3 pr-1">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">{INSTALL_COMMAND}</code>
              <IconButton label={copied ? t('message.copied') : t('message.copy')} onClick={() => void copy()} className="h-7 w-7">
                {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              </IconButton>
            </div>
          </div>
        )}
      </div>
      <Toggle
        id="check-updates"
        checked={settings.checkUpdates}
        onChange={(checkUpdates) => void updateSettings((s) => ({ ...s, checkUpdates }))}
        label={t('about.autoCheck')}
        hint={t('about.autoCheckHint')}
      />
    </Card>
  );
}

export function AboutSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const shortcut = useShortcut();
  return (
    <Section title={t('about.title')}>
      <Card className="p-5">
        <div className="mb-4 flex items-center gap-3">
          <BrandMark size="lg" />
          <div>
            <p className="text-base font-semibold tracking-tight">Browser Helper Lite</p>
            <p className="text-sm text-muted">{t('about.version')} {browser.runtime.getManifest().version}</p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
          <dt className="text-muted">{t('about.cdpDriver')}</dt>
          <dd>{ENABLE_CDP_DRIVER ? t('about.enabled') : t('about.disabled')}</dd>
          {shortcut !== undefined && (
            <>
              <dt className="text-muted">{t('about.shortcut')}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {shortcut ? <kbd className="rounded-md border border-line bg-subtle px-1.5 py-0.5 font-sans text-xs">{shortcut}</kbd> : <span className="text-faint">{t('about.shortcutNone')}</span>}
                <button
                  type="button"
                  onClick={() => void browser.tabs.create({ url: 'chrome://extensions/shortcuts' })}
                  className="text-accent underline"
                >
                  {t('about.shortcutChange')}
                </button>
              </dd>
            </>
          )}
        </dl>
      </Card>
      {/* Chrome updates store installs by itself. */}
      {!updatedByChrome() && <Updates settings={settings} />}
      <Card className="flex items-start gap-3 p-5 text-sm">
        <IconBadge icon={Lock} className="bg-success-soft text-success" />
        <div className="space-y-1.5 leading-relaxed">
          <p>{t('about.privacy')}</p>
          <p className="text-muted">{t('about.keys')}</p>
        </div>
      </Card>
      <a href={DESIGN_DOC_URL} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent underline">
        {t('about.designDoc')}
      </a>
    </Section>
  );
}
