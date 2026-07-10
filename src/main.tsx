import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './App.css'
import App from './App'
import { LangProvider } from './i18n'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </StrictMode>,
)

// The app-shell service worker is registered from the PWA hook (src/pwa/usePwa.ts,
// production only), which also wires the "update available" + offline UX. Registering
// there keeps a single source of truth for the SW lifecycle (no double register).
