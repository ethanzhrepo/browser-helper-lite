import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { ENABLE_CDP_DRIVER } from '../../src/shared/build-flags';
import { Card, Section } from './Section';

const DESIGN_DOC_URL = 'https://github.com/ethanzhrepo/browser-helper-lite/blob/HEAD/docs/product-design.md';

export function AboutSection() {
  const { t } = useTranslation();
  const rows: [string, string][] = [
    [t('about.version'), browser.runtime.getManifest().version],
    [t('about.cdpDriver'), ENABLE_CDP_DRIVER ? t('about.enabled') : t('about.disabled')],
  ];
  return (
    <Section title={t('about.title')}>
      <Card>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card className="space-y-2 text-sm">
        <p>{t('about.privacy')}</p>
        <p className="text-muted">{t('about.keys')}</p>
      </Card>
      <a href={DESIGN_DOC_URL} target="_blank" rel="noreferrer" className="inline-block text-sm text-accent underline">
        {t('about.designDoc')}
      </a>
    </Section>
  );
}
