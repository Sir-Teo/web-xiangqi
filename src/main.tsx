import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './selectControls.css'
import App from './App.tsx'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { QaForcedRenderError } from './components/QaForcedRenderError'
import { cleanupLegacyRuntimeStorage } from './utils/serviceWorkerCleanup'

void cleanupLegacyRuntimeStorage()

const forceErrorBoundary = import.meta.env.DEV &&
  new URLSearchParams(window.location.search).has('qa-error-boundary')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      {forceErrorBoundary ? <QaForcedRenderError /> : <App />}
    </AppErrorBoundary>
  </StrictMode>,
)
