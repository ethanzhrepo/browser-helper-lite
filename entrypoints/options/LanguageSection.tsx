import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { detectLocale, LOCALE_NATIVE_NAMES, LOCALES } from '../../src/i18n';
import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ipRegion } from '../../src/shared/ip-region';
import { REGION_CODES, regionName, type IpRegion } from '../../src/shared/region';
import { Button } from '../../src/ui/Button';
import type { LanguageSetting, Settings } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { Card, Field, inputClass, Section } from './Section';

export function LanguageSection({ settings }: { settings: Settings }) {
  const { t, i18n } = useTranslation();
  const detected = LOCALE_NATIVE_NAMES[detectLocale(browser.i18n.getUILanguage())];
  const options: { value: LanguageSetting; label: string }[] = [
    { value: 'auto', label: t('language.auto', { language: detected }) },
    ...LOCALES.map((locale) => ({ value: locale, label: LOCALE_NATIVE_NAMES[locale] })),
  ];

  const choose = (language: LanguageSetting) => void updateSettings((s) => ({ ...s, language }));
  const uiLanguage = i18n.language;
  // The country of the IP address, looked up only while the setting is "Automatic".
  const [fromIp, setFromIp] = useState<IpRegion | undefined>();
  const [looking, setLooking] = useState(false);
  const lookUp = (refresh: boolean) => {
    setLooking(true);
    void ipRegion({ refresh })
      .then(setFromIp, () => setFromIp(undefined))
      .finally(() => setLooking(false));
  };
  useEffect(() => {
    if (settings.region === 'auto') lookUp(false);
  }, [settings.region]);
  const regions = REGION_CODES.map((code) => ({ code, name: regionName(code, uiLanguage) })).sort((a, b) => a.name.localeCompare(b.name, uiLanguage));

  return (
    <Section title={t('language.title')} description={t('language.description')}>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map(({ value, label }) => {
          const checked = settings.language === value;
          return (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 shadow-soft transition-colors ${
                checked ? 'border-accent/40 bg-accent-soft' : 'border-line bg-surface hover:border-line-strong'
              } ${value === 'auto' ? 'sm:col-span-2' : ''}`}
            >
              <input
                type="radio"
                name="language"
                className="h-4 w-4 accent-[var(--accent)]"
                checked={checked}
                onChange={() => choose(value)}
              />
              <span className={`text-sm ${checked ? 'font-medium text-accent' : ''}`}>{label}</span>
            </label>
          );
        })}
      </div>
      <Card className="p-5">
        <Field label={t('language.region.title')} htmlFor="region" hint={t('language.region.hint')}>
          <select id="region" className={`${inputClass} sm:w-72`} value={settings.region} onChange={(e) => {
              // Read now: React puts a controlled list back to its value as soon as this returns.
              const region = e.target.value;
              void updateSettings((s) => ({ ...s, region }));
            }} data-testid="region">
            <option value="auto">{fromIp ? t('language.region.auto', { country: regionName(fromIp.code, uiLanguage) }) : t('language.region.autoUnknown')}</option>
            <option value="none">{t('language.region.none')}</option>
            {regions.map(({ code, name }) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        {settings.region === 'auto' && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted" data-testid="region-ip">
            <span>{fromIp ? t('language.region.found', { country: regionName(fromIp.code, uiLanguage) }) : looking ? t('language.region.looking') : t('language.region.notFound')}</span>
            <Button size="sm" variant="ghost" onClick={() => lookUp(true)} disabled={looking} data-testid="region-refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${looking ? 'animate-spin' : ''}`} />
              {t('language.region.refresh')}
            </Button>
          </div>
        )}
      </Card>
    </Section>
  );
}
