import { useEffect, useMemo, useState } from 'react'
import { loadBrand, parseCatalog, resolveTenant, idBrandLabel, type BrandContract, type TenantConfig } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Portal } from './pages/Portal'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Forgot } from './pages/Forgot'
import { Callback } from './pages/Callback'
import { Onboarding } from './pages/Onboarding'
import { DeviceApproval } from './pages/DeviceApproval'

/**
 * Top-level wiring. Resolves tenant + brand once on mount, then routes via
 * `window.location.pathname`. No router lib needed — this app is 5 pages,
 * `<a href>` is enough. Adding paths is a switch case.
 */
export function App() {
  const [tenant, setTenant] = useState<TenantConfig | null>(null)
  const [brand, setBrand] = useState<BrandContract | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function boot() {
      // The runtime serves the per-host tenant catalog at /config.json
      // (templated from SPA_IAM_TENANT_CONFIG_JSON by the static server). Read
      // it from there — NOT a `window.__ID_CATALOG__` global, which the runtime
      // never injects (relying on it silently dropped every catalog-only host,
      // e.g. osage.id, to the bundled Hanzo default). Fall back to the inlined
      // global, then empty, so a host always resolves to something.
      let catalogRaw: string | undefined
      try {
        const res = await fetch('/config.json', { cache: 'no-store' })
        if (res.ok) {
          const cfg = (await res.json()) as { iamTenantConfigJson?: string }
          catalogRaw = cfg.iamTenantConfigJson
        }
      } catch {
        // network/parse error → fall back below
      }
      if (!catalogRaw) {
        catalogRaw = (window as unknown as { __ID_CATALOG__?: string }).__ID_CATALOG__
      }
      const t = resolveTenant(window.location.hostname, { catalog: parseCatalog(catalogRaw) })
      if (cancelled) return
      setTenant(t)
      try {
        const b = await loadBrand(t.brandPackage)
        if (cancelled) return
        setBrand(b)
        document.title = idBrandLabel(b, t.orgId)
        const fav = document.getElementById('favicon') as HTMLLinkElement | null
        if (fav && b.faviconUrl) fav.href = b.faviconUrl
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  const client = useMemo(() => (tenant ? createAuthClient({ tenant }) : null), [tenant])

  if (error) return <div className="hanzo-id-error">{error}</div>
  if (!tenant || !brand || !client) return <div>Loading…</div>

  const path = window.location.pathname
  // Device-authorization approval (RFC 8628). Must precede the `/login` catch
  // since it lives under `/login/oauth/device`.
  if (path === '/login/oauth/device' || path.startsWith('/login/oauth/device/'))
    return <DeviceApproval client={client} brand={brand} />
  if (path === '/login' || path.startsWith('/login/')) return <Login client={client} brand={brand} />
  if (path === '/signup' || path.startsWith('/signup/')) return <Signup client={client} brand={brand} />
  if (path === '/forget' || path === '/forgot' || path.startsWith('/forg')) return <Forgot client={client} brand={brand} />
  if (path === '/callback' || path.startsWith('/callback/')) return <Callback tenant={tenant} brand={brand} />
  if (path === '/onboarding' || path.startsWith('/onboarding/')) return <Onboarding tenant={tenant} brand={brand} />
  return <Portal client={client} brand={brand} tenant={tenant} />
}
