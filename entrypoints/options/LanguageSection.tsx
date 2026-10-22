import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { detectLocale, LOCALE_NATIVE_NAMES, LOCALES } from '../../src/i18n';
import type { LanguageSetting, Settings } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { Card, Section } from './Section';

export function LanguageSection({ settings }: { settings: Settings }) {
  const { t } = useTranslation();
  const detected = LOCALE_NATIVE_NAMES[detectLocale(browser.i18n.getUILanguage())];
  const options: { value: LanguageSetting; label: string }[] = [
    { value: 'auto', label: t('language.auto', { language: detected }) },
    ...LOCALES.map((locale) => ({ value: locale, label: LOCALE_NATIVE_NAMES[locale] })),
  ];

  const choose = (language: LanguageSetting) => void updateSettings((s) => ({ ...s, language }));

  return (
    <Section title={t('language.title')} description={t('language.description')}>
      <Card className="space-y-1 p-2">
        {options.map(({ value, label }) => (
          <label key={value} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-hover">
            <input
              type="radio"
              name="language"
              className="accent-[var(--accent)]"
              checked={settings.language === value}
              onChange={() => choose(value)}
            />
            <span className="text-sm">{label}</span>
          </label>
        ))}
      </Card>
    </Section>
  );
}
