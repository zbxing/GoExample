import { dictionaries, type Dictionary } from '@/lib/i18n/dictionaries';
import { siteConfig } from '@/lib/config/site';
import type { LocaleCode } from '@/lib/types/management';

export function getDictionary(locale: LocaleCode): Dictionary {
  return dictionaries[locale] ?? dictionaries[siteConfig.defaultLocale];
}

export function isLocaleCode(value: string): value is LocaleCode {
  return siteConfig.locales.includes(value as LocaleCode);
}

export function translate(
  dictionary: Dictionary,
  path: string,
  variables?: Record<string, string | number>,
): string {
  const result = path
    .split('.')
    .reduce<unknown>((current, key) => (current && typeof current === 'object' ? current[key as keyof typeof current] : undefined), dictionary);

  if (typeof result !== 'string') {
    return path;
  }

  if (!variables) {
    return result;
  }

  return result.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = variables[key];
    return value === undefined ? match : String(value);
  });
}
