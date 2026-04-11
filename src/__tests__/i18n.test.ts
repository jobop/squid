import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  getStoredLocale,
  setStoredLocale,
  translate,
  type StorageLike,
} from '../i18n';

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('i18n locale handling', () => {
  it('uses english as the default locale', () => {
    const storage = new MemoryStorage();
    expect(getStoredLocale(storage)).toBe(DEFAULT_LOCALE);
  });

  it('falls back to english for unsupported locale values', () => {
    const storage = new MemoryStorage();
    storage.setItem('squid.locale', 'es');
    expect(getStoredLocale(storage)).toBe(DEFAULT_LOCALE);
  });

  it('persists and restores supported locale values', () => {
    const storage = new MemoryStorage();
    const saved = setStoredLocale('ja', storage);
    expect(saved).toBe('ja');
    expect(getStoredLocale(storage)).toBe('ja');
  });

  it('falls back to english copy for missing translation keys', () => {
    expect(translate('de', 'settings.language.help')).toBeTypeOf('string');
    expect(translate('zh', 'chat.send')).toBe('发送');
  });
});
