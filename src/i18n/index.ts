import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '../shared/types';
import { resources } from './resources';

export { detectLocale, LOCALE_NATIVE_NAMES, LOCALES, resolveLocale, resources } from './resources';

export async function initI18n(locale: Locale): Promise<typeof i18next> {
  await i18next.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
  });
  document.documentElement.lang = locale;
  return i18next;
}

export async function changeLocale(locale: Locale): Promise<void> {
  if (i18next.language === locale) return;
  await i18next.changeLanguage(locale);
  document.documentElement.lang = locale;
}
