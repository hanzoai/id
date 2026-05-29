import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { registerProvider } from '@hanzo/id-idv'
import { createStubProvider } from '@hanzo/id-idv/providers/stub'
import './app.css'

// Default IDV provider — replace at boot via env-driven config.
registerProvider(createStubProvider())

/**
 * Load the runtime tenant catalog before mounting.
 * `/config.json` is templated by hanzoai/spa at pod startup from
 * `SPA_IAM_TENANT_CONFIG_JSON` (and other SPA_* env vars). Absence is fine —
 * the SPA falls back to hostname-derived defaults.
 */
async function loadCatalog(): Promise<void> {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' })
    if (!res.ok) return
    const cfg = await res.json()
    const raw = cfg?.iamTenantConfigJson
    if (typeof raw === 'string' && raw.length > 0) {
      ;(window as unknown as { __ID_CATALOG__?: string }).__ID_CATALOG__ = raw
    }
  } catch {
    // Catalog is optional. Hostname-derived defaults will be used.
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('#root missing')

loadCatalog().then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
