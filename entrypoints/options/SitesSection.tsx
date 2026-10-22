import { Globe, Plus, Shield, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import {
  ALL_SITES_PATTERN,
  listGrantedOrigins,
  originPattern,
  requestHostAccess,
  revokeOrigin,
} from '../../src/permissions/hosts';
import type { Settings, SitePolicy } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { Button, IconButton } from '../../src/ui/Button';
import { Card, IconBadge, inputClass, Section } from './Section';

const POLICIES: SitePolicy[] = ['blocked', 'readOnly', 'confirmEach', 'confirmRisky', 'auto'];

/** "https://www.Example.com/path" → "www.example.com". */
export function normalizeHost(input: string): string {
  const trimmed = input.trim().toLowerCase();
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname.replace(/^\*\./, '');
  } catch {
    return '';
  }
}

function setPolicy(host: string, policy: SitePolicy | undefined) {
  void updateSettings((s) => {
    const sitePolicies = { ...s.sitePolicies };
    if (policy) sitePolicies[host] = policy;
    else delete sitePolicies[host];
    return { ...s, sitePolicies };
  });
}

function SitePolicies({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const [host, setHost] = useState('');
  const [policy, setNewPolicy] = useState<SitePolicy>('readOnly');
  const entries = Object.entries(settings.sitePolicies).sort(([a], [b]) => a.localeCompare(b));

  const add = () => {
    const normalized = normalizeHost(host);
    if (!normalized) return;
    setPolicy(normalized, policy);
    setHost('');
  };

  const policySelect = (value: SitePolicy, onChange: (next: SitePolicy) => void, id?: string) => (
    <select id={id} className={`${inputClass} sm:w-56`} value={value} onChange={(e) => onChange(e.target.value as SitePolicy)}>
      {POLICIES.map((p) => (
        <option key={p} value={p}>
          {t(`sites.policies.${p}`)}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-3 pt-6" data-testid="site-policies">
      <div className="flex items-start gap-3">
        <IconBadge icon={Shield} />
        <div>
          <h3 className="text-[15px] font-semibold tracking-tight">{t('sites.policiesTitle')}</h3>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">{t('sites.policiesDescription')}</p>
        </div>
      </div>
      <Card className="divide-y divide-line p-0">
        {entries.length === 0 && <p className="px-4 py-4 text-sm text-faint">{t('sites.noPolicies')}</p>}
        {entries.map(([site, value]) => (
          <div key={site} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-sm">{site}</span>
            {policySelect(value, (next) => setPolicy(site, next))}
            <IconButton label={t('common.delete')} onClick={() => setPolicy(site, undefined)}>
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2 bg-subtle/50 px-4 py-3">
          <input
            aria-label={t('sites.hostLabel')}
            className={`${inputClass} min-w-0 flex-1`}
            placeholder="rogers.com"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          {policySelect(policy, setNewPolicy, 'new-policy')}
          <Button onClick={add} disabled={!normalizeHost(host)}>
            <Plus className="h-4 w-4" />
            {t('sites.addPolicy')}
          </Button>
        </div>
      </Card>
      <p className="text-xs text-muted">{t('sites.defaultPolicy')}</p>
    </div>
  );
}

export function SitesSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const [origins, setOrigins] = useState<string[]>([]);

  const refresh = useCallback(() => void listGrantedOrigins().then(setOrigins), []);

  useEffect(() => {
    refresh();
    browser.permissions.onAdded.addListener(refresh);
    browser.permissions.onRemoved.addListener(refresh);
    return () => {
      browser.permissions.onAdded.removeListener(refresh);
      browser.permissions.onRemoved.removeListener(refresh);
    };
  }, [refresh]);

  // Origins granted for model APIs, labelled with the connection that uses them.
  const usedBy = new Map<string, string>();
  for (const connection of settings.connections) {
    try {
      usedBy.set(originPattern(connection.baseURL), connection.name);
    } catch {
      // Ignore malformed URLs.
    }
  }

  const allSites = origins.includes(ALL_SITES_PATTERN);

  return (
    <Section
      title={t('sites.title')}
      description={t('sites.description')}
      actions={
        !allSites && (
          <Button onClick={() => void requestHostAccess(ALL_SITES_PATTERN)}>
            <Globe className="h-4 w-4" />
            {t('sites.allowAll')}
          </Button>
        )
      }
    >
      <Card className="divide-y divide-line p-0">
        {origins.length === 0 && <p className="px-4 py-4 text-sm text-faint">{t('sites.none')}</p>}
        {origins.map((origin) => (
          <div key={origin} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-subtle text-muted">
              <Globe className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-sm">{origin === ALL_SITES_PATTERN ? t('sites.allSites') : origin}</div>
              {usedBy.has(origin) && (
                <div className="text-xs text-faint">{t('sites.usedByConnection', { name: usedBy.get(origin) })}</div>
              )}
            </div>
            <Button size="sm" variant="danger" onClick={() => void revokeOrigin(origin).then(refresh)}>
              {t('sites.revoke')}
            </Button>
          </div>
        ))}
      </Card>
      <SitePolicies settings={settings} />
    </Section>
  );
}
