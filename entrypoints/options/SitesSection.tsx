import { Globe } from 'lucide-react';
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
import type { Settings } from '../../src/shared/types';
import { Button } from '../../src/ui/Button';
import { Card, Section } from './Section';

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
      {origins.length === 0 && <Card className="text-sm text-muted">{t('sites.none')}</Card>}
      {origins.map((origin) => (
        <Card key={origin} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-sm">
              {origin === ALL_SITES_PATTERN ? t('sites.allSites') : origin}
            </div>
            {usedBy.has(origin) && (
              <div className="text-xs text-muted">{t('sites.usedByConnection', { name: usedBy.get(origin) })}</div>
            )}
          </div>
          <Button variant="danger" onClick={() => void revokeOrigin(origin).then(refresh)}>
            {t('sites.revoke')}
          </Button>
        </Card>
      ))}
      <p className="text-xs text-muted">{t('sites.policiesComing')}</p>
    </Section>
  );
}
