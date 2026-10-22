import { useTranslation } from 'react-i18next';
import { browser } from 'wxt/browser';
import { detectLocale, LOCALE_NATIVE_NAMES, LOCALES } from '../../src/i18n';
import type { LanguageSetting, Settings } from '../../src/shared/types';
import { updateSettings } from '../../src/storage/settings';
import { Section } from './Section';

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
    </Section>
  );
}
