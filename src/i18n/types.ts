export const SUPPORTED_LOCALES = ['en', 'zh', 'ja', 'ru', 'it', 'fr', 'de'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  if (!value) {
    return DEFAULT_LOCALE;
  }
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
