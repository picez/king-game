import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App'
import { LangProvider } from './i18n'
import './ui/components/appThemeStore' // stamps <html data-app-theme> (Stage 42.0)

import { isAdminPath } from './net/admin'

// Admin panel (Stage 44.0) lives at /admin as its own lazy chunk + stylesheet.
const AdminApp = lazy(() => import('./admin/AdminApp'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdminPath(window.location.pathname)
      ? <Suspense fallback={null}><AdminApp /></Suspense>
      : (
        <LangProvider>
          <App />
        </LangProvider>
      )}
  </StrictMode>,
)

// The app-shell service worker is registered from the PWA hook (src/pwa/usePwa.ts,
// production only), which also wires the "update available" + offline UX. Registering
// there keeps a single source of truth for the SW lifecycle (no double register).
