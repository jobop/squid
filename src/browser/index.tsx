// Electrobun frontend entry point
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MainLayout } from '../ui/main-layout';
import { applyDocumentLanguage, getStoredLocale } from '../i18n';

const root = document.getElementById('root');
if (root) {
  applyDocumentLanguage(getStoredLocale());
  createRoot(root).render(<MainLayout />);
}
