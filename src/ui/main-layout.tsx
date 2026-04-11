import { useMemo, useState } from 'react';
import {
  applyDocumentLanguage,
  getLocaleDisplayName,
  getStoredLocale,
  setStoredLocale,
  SUPPORTED_LOCALES,
  translate,
  type Locale,
} from '../i18n';
import { SettingsPage, type Settings } from './settings-page';

export function MainLayout() {
  const [locale, setLocale] = useState<Locale>(() => getStoredLocale());

  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  const localeOptions = useMemo(
    () => SUPPORTED_LOCALES.map((item) => ({ value: item, label: getLocaleDisplayName(item) })),
    []
  );

  const handleLocaleChange = (nextLocale: Locale) => {
    const persisted = setStoredLocale(nextLocale);
    setLocale(persisted);
    applyDocumentLanguage(persisted);
  };

  const handleSaveSettings = (settings: Settings) => {
    if (settings.language) {
      handleLocaleChange(settings.language);
    }
  };

  return (
    <div className="main-layout">
      <aside className="sidebar">
        <nav className="sidebar-nav">
          <a href="#tasks">{t('nav.tasks')}</a>
          <a href="#skills">{t('nav.skills')}</a>
          <a href="#experts">{t('nav.experts')}</a>
          <a href="#claw">{t('nav.remoteControl')}</a>
          <a href="#scheduler">{t('nav.scheduler')}</a>
          <a href="#settings">{t('nav.settings')}</a>
        </nav>
      </aside>

      <main className="content-area">
        <section className="chat-panel">
          <div className="chat-header">
            <h2>{t('chat.title')}</h2>
          </div>
          <div className="chat-messages"></div>
          <div className="chat-input">
            <textarea placeholder={t('chat.placeholder')}></textarea>
            <button>{t('chat.send')}</button>
          </div>
        </section>

        <section className="result-panel">
          <div className="result-header">
            <h2>{t('result.title')}</h2>
          </div>
          <div className="result-tabs">
            <button>{t('result.tabs.artifacts')}</button>
            <button>{t('result.tabs.files')}</button>
            <button>{t('result.tabs.changes')}</button>
            <button>{t('result.tabs.preview')}</button>
          </div>
          <div className="result-content"></div>
        </section>

        <section className="result-panel">
          <SettingsPage
            onSave={handleSaveSettings}
            locale={locale}
            onLocaleChange={handleLocaleChange}
            t={t}
            localeOptions={localeOptions}
          />
        </section>
      </main>
    </div>
  );
}
