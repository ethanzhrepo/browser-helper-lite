import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { ENABLE_CDP_DRIVER } from '../../src/shared/build-flags';
import { BrandMark } from '../../src/ui/Button';
import { Card, IconBadge, Section } from './Section';

const DESIGN_DOC_URL = 'https://github.com/ethanzhrepo/browser-helper-lite/blob/HEAD/docs/product-design.md';

export function AboutSection() {
  const { t } = useTranslation();
  const rows: [string, string][] = [[t('about.cdpDriver'), ENABLE_CDP_DRIVER ? t('about.enabled') : t('about.disabled')]];
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
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
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
