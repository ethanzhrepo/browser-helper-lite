import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { changeLocale, initI18n, resolveLocale } from '../i18n';
import { loadSettings, watchSettings } from '../storage/settings';
import './styles.css';

/** Shared startup for extension pages: load the locale, then render. */
export async function mountPage(element: ReactNode): Promise<void> {
  const uiLanguage = browser.i18n.getUILanguage();
  const settings = await loadSettings();
  await initI18n(resolveLocale(settings.language, uiLanguage));
  watchSettings((next) => void changeLocale(resolveLocale(next.language, uiLanguage)));

  createRoot(document.getElementById('root')!).render(<StrictMode>{element}</StrictMode>);
}
