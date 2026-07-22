import * as Sentry from '@sentry/react'
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

Sentry.init({
  dsn: 'https://43aee5aca4f0a196f0e744e513b6eef8@o4511207947173888.ingest.us.sentry.io/4511207949402112',
  sendDefaultPii: false,
  integrations: [
    Sentry.browserTracingIntegration(),
  ],
  tracesSampleRate: 0.05,
  // Session replay is heavy on mobile scanners — only capture on errors via separate setup if needed
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
