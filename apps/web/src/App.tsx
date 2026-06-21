import { useEffect, useMemo, useState } from 'react'
import { loadBrand, parseCatalog, resolveTenant, type BrandContract, type TenantConfig } from '@hanzo/id-shared'
import { createAuthClient } from '@hanzo/id-auth'
import { Portal } from './pages/Portal'
import { Login } from './pages/Login'
import { Signup } from './pages/Signup'
import { Forgot } from './pages/Forgot'
import { Callback } from './pages/Callback'

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
    const runtimeCatalog = (window as unknown as { __ID_CATALOG__?: string }).__ID_CATALOG__
    const t = resolveTenant(window.location.hostname, { catalog: parseCatalog(runtimeCatalog) })
    setTenant(t)
    loadBrand(t.brandPackage, t.brandUrl)
      .then((b) => {
        setBrand(b)
        document.title = `Sign in — ${b.name}`
        const fav = document.getElementById('favicon') as HTMLLinkElement | null
        if (fav && b.faviconUrl) fav.href = b.faviconUrl
      })
      .catch((e) => setError(String(e)))
  }, [])

  const client = useMemo(() => (tenant ? createAuthClient({ tenant }) : null), [tenant])

  if (error) return <div className="hanzo-id-error">{error}</div>
  if (!tenant || !brand || !client) return <div>Loading…</div>

  // undefined = enabled; only an explicit `false` disables self-service signup.
  const signupEnabled = tenant.signupEnabled !== false
  const path = window.location.pathname
  if (path === '/login' || path.startsWith('/login/')) return <Login client={client} brand={brand} tenant={tenant} signupEnabled={signupEnabled} />
  if (path === '/signup' || path.startsWith('/signup/')) return signupEnabled ? <Signup client={client} brand={brand} tenant={tenant} /> : <Login client={client} brand={brand} tenant={tenant} signupEnabled={signupEnabled} />
  if (path === '/forget' || path === '/forgot' || path.startsWith('/forg')) return <Forgot client={client} brand={brand} tenant={tenant} />
  if (path === '/callback' || path.startsWith('/callback/')) return <Callback client={client} brand={brand} tenant={tenant} />
  return <Portal client={client} brand={brand} tenant={tenant} signupEnabled={signupEnabled} />
}
