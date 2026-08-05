import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Analytics } from './analytics'
import { registerProvider } from '@hanzo/id-idv'
import { createStubProvider } from '@hanzo/id-idv/providers/stub'
import './app.css'

// Default IDV provider — replace at boot via env-driven config.
registerProvider(createStubProvider())

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')
createRoot(root).render(
  <StrictMode>
    {/*
      Telemetry wraps App rather than living inside it: the pageview must be
      recorded for the arrival itself, including the loads where `/config.json`
      or the brand package fails and App renders nothing but an error. Those are
      exactly the visits worth counting.
    */}
    <Analytics>
      <App />
    </Analytics>
  </StrictMode>,
)
