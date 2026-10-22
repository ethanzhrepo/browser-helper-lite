import i18next, { type TFunction } from 'i18next';
import type { Locale } from '../shared/types';
import { resources } from './resources';

/** Standalone translator for the service worker (no React, no DOM). */
export async function createTranslator(locale: Locale): Promise<TFunction> {
  const instance = i18next.createInstance();
  await instance.init({ resources, lng: locale, fallbackLng: 'en', interpolation: { escapeValue: false } });
  return instance.t.bind(instance);
}
