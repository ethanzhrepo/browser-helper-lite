import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import es from '../locales/es.json';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import zhCN from '../locales/zh-CN.json';
import type { LanguageSetting, Locale } from '../shared/types';

export const LOCALES: Locale[] = ['zh-CN', 'en', 'fr', 'es'];

/** Each language named in itself, for the language picker. */
export const LOCALE_NATIVE_NAMES: Record<Locale, string> = {
  'zh-CN': '简体中文',
  en: 'English',
  fr: 'Français',
  es: 'Español',
};

export const resources = {
  'zh-CN': { translation: zhCN },
  en: { translation: en },
  fr: { translation: fr },
  es: { translation: es },
} as const;

export function detectLocale(uiLanguage: string): Locale {
  const language = uiLanguage.toLowerCase();
  if (language.startsWith('zh')) return 'zh-CN';
  if (language.startsWith('fr')) return 'fr';
  if (language.startsWith('es')) return 'es';
  return 'en';
}

export function resolveLocale(setting: LanguageSetting, uiLanguage: string): Locale {
  return setting === 'auto' ? detectLocale(uiLanguage) : setting;
}

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
