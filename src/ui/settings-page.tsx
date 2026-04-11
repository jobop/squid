import { useState } from 'react';
import type { Locale, TranslationKey } from '../i18n';

export interface SettingsPageProps {
  onSave: (settings: Settings) => void;
  locale: Locale;
  onLocaleChange: (nextLocale: Locale) => void;
  t: (key: TranslationKey) => string;
  localeOptions: Array<{ value: Locale; label: string }>;
}

export interface Settings {
  apiKeys: {
    anthropic?: string;
    openai?: string;
    deepseek?: string;
  };
  clawToken?: string;
  email?: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
  language?: Locale;
}

export function SettingsPage({
  onSave,
  locale,
  onLocaleChange,
  t,
  localeOptions,
}: SettingsPageProps) {
  const [settings, setSettings] = useState<Settings>({ apiKeys: {}, language: locale });

  return (
    <div className="settings-page">
      <h2>{t('settings.title')}</h2>

      <section className="settings-section">
        <h3>{t('settings.language')}</h3>
        <div className="form-group">
          <label>{t('settings.language')}</label>
          <select
            value={locale}
            onChange={(e) => {
              const nextLocale = e.target.value as Locale;
              onLocaleChange(nextLocale);
              setSettings((prev) => ({ ...prev, language: nextLocale }));
            }}
          >
            {localeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <small>{t('settings.language.help')}</small>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t('settings.apiKeys')}</h3>
        <div className="form-group">
          <label>Anthropic API Key</label>
          <input
            type="password"
            value={settings.apiKeys.anthropic || ''}
            onChange={(e) => setSettings({
              ...settings,
              apiKeys: { ...settings.apiKeys, anthropic: e.target.value }
            })}
          />
        </div>
        <div className="form-group">
          <label>OpenAI API Key</label>
          <input
            type="password"
            value={settings.apiKeys.openai || ''}
            onChange={(e) => setSettings({
              ...settings,
              apiKeys: { ...settings.apiKeys, openai: e.target.value }
            })}
          />
        </div>
        <div className="form-group">
          <label>DeepSeek API Key</label>
          <input
            type="password"
            value={settings.apiKeys.deepseek || ''}
            onChange={(e) => setSettings({
              ...settings,
              apiKeys: { ...settings.apiKeys, deepseek: e.target.value }
            })}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3>{t('settings.clawToken')}</h3>
        <div className="form-group">
          <label>Token</label>
          <input
            type="password"
            value={settings.clawToken || ''}
            onChange={(e) => setSettings({ ...settings, clawToken: e.target.value })}
          />
          <button>{t('settings.generateToken')}</button>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t('settings.emailConfig')}</h3>
        <div className="form-group">
          <label>{t('settings.smtpHost')}</label>
          <input
            type="text"
            value={settings.email?.host || ''}
            onChange={(e) => setSettings({
              ...settings,
              email: { ...settings.email!, host: e.target.value }
            })}
          />
        </div>
        <div className="form-group">
          <label>{t('settings.port')}</label>
          <input
            type="number"
            value={settings.email?.port || 587}
            onChange={(e) => setSettings({
              ...settings,
              email: { ...settings.email!, port: parseInt(e.target.value) }
            })}
          />
        </div>
        <div className="form-group">
          <label>{t('settings.username')}</label>
          <input
            type="text"
            value={settings.email?.user || ''}
            onChange={(e) => setSettings({
              ...settings,
              email: { ...settings.email!, user: e.target.value }
            })}
          />
        </div>
        <div className="form-group">
          <label>{t('settings.password')}</label>
          <input
            type="password"
            value={settings.email?.pass || ''}
            onChange={(e) => setSettings({
              ...settings,
              email: { ...settings.email!, pass: e.target.value }
            })}
          />
        </div>
      </section>

      <button onClick={() => onSave(settings)}>{t('settings.save')}</button>
    </div>
  );
}
