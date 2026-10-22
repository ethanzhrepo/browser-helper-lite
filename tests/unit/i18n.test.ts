import { describe, expect, it } from 'vitest';
import { detectLocale, LOCALES, resolveLocale, resources } from '../../src/i18n';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function flatten(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
    (all, [key, child]) => ({ ...all, ...flatten(child, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

const variables = (text: string) => [...text.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();

describe('locale files', () => {
  const english = flatten(resources.en.translation);
  const englishBases = new Set(Object.keys(english).map((key) => key.replace(PLURAL_SUFFIX, '')));

  for (const locale of LOCALES) {
    const strings = flatten(resources[locale].translation);
    const bases = new Set(Object.keys(strings).map((key) => key.replace(PLURAL_SUFFIX, '')));

    it(`${locale} has exactly the English keys`, () => {
      expect([...bases].sort()).toEqual([...englishBases].sort());
    });

    it(`${locale} has no empty strings and an _other form for every plural`, () => {
      for (const [key, text] of Object.entries(strings)) {
        expect(text.trim(), key).not.toBe('');
        if (PLURAL_SUFFIX.test(key)) expect(strings[key.replace(PLURAL_SUFFIX, '_other')], key).toBeDefined();
      }
    });

    it(`${locale} uses the same interpolation variables as English`, () => {
      for (const [key, text] of Object.entries(strings)) {
        const englishKey = key in english ? key : key.replace(PLURAL_SUFFIX, '_other');
        expect(variables(text), key).toEqual(variables(english[englishKey] ?? ''));
      }
    });
  }
});

describe('locale detection', () => {
  it('maps browser languages to supported locales', () => {
    expect(detectLocale('zh-TW')).toBe('zh-CN');
    expect(detectLocale('fr-CA')).toBe('fr');
    expect(detectLocale('es-419')).toBe('es');
    expect(detectLocale('de-DE')).toBe('en');
  });

  it('prefers an explicit setting', () => {
    expect(resolveLocale('es', 'zh-CN')).toBe('es');
    expect(resolveLocale('auto', 'zh-CN')).toBe('zh-CN');
  });
});
