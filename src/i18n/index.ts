import { resources, type TranslationKey } from './resources';
import { DEFAULT_LOCALE, normalizeLocale, SUPPORTED_LOCALES, type Locale } from './types';

const STORAGE_KEY = 'squid.locale';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function getLocaleDisplayName(locale: Locale): string {
  const names: Record<Locale, string> = {
    en: 'English',
    zh: '中文',
    ja: '日本語',
    ru: 'Русский',
    it: 'Italiano',
    fr: 'Francais',
    de: 'Deutsch',
  };
  return names[locale];
}

function safeStorage(input?: StorageLike): StorageLike | undefined {
  if (input) return input;
  if (typeof window === 'undefined') return undefined;
  return window.localStorage;
}

export function getStoredLocale(storage?: StorageLike): Locale {
  const store = safeStorage(storage);
  const raw = store?.getItem(STORAGE_KEY);
  return normalizeLocale(raw);
}

export function setStoredLocale(locale: string, storage?: StorageLike): Locale {
  const normalized = normalizeLocale(locale);
  const store = safeStorage(storage);
  store?.setItem(STORAGE_KEY, normalized);
  return normalized;
}

export function translate(locale: Locale, key: TranslationKey): string {
  return resources[locale][key] ?? resources[DEFAULT_LOCALE][key];
}

export function resolveLocale(input: string | null | undefined): Locale {
  return normalizeLocale(input);
}

export function applyDocumentLanguage(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}

export { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale, type TranslationKey };
